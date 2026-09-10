import "server-only";

import { ObjectId, type WithId } from "mongodb";
import { getTrackingImportProfilesCollection } from "@/lib/db/collections";
import {
  columnIndex,
  normalizeHeader,
  signatureScore,
  SIGNATURE_MATCH_THRESHOLD,
  type TrackingImportProfileDoc,
  type TrackingImportProfileDTO,
  type TrackingImportProfileInput,
} from "@/lib/types/tracking-import";

/** Lỗi nghiệp vụ profile import (mang HTTP status cho errorResponse). */
export class TrackingImportProfileError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function toDTO(doc: WithId<TrackingImportProfileDoc>): TrackingImportProfileDTO {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    orderIdColumn: doc.orderIdColumn,
    trackingColumn: doc.trackingColumn ?? "",
    carrierColumn: doc.carrierColumn ?? "",
    signature: doc.signature ?? [],
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

/** Chuẩn hoá + validate 1 chữ cái cột. `required` = false cho phép rỗng (cột carrier). */
function normColumn(raw: unknown, label: string, required: boolean): string {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) {
    if (required) throw new TrackingImportProfileError(400, `Cột ${label} bắt buộc`);
    return "";
  }
  if (columnIndex(s) < 0) {
    throw new TrackingImportProfileError(400, `Cột ${label} không hợp lệ (dùng chữ cái A, B, C…)`);
  }
  return s;
}

/** Chuẩn hoá payload create/update về đúng shape doc (ném lỗi 400 nếu sai). */
function normalizeInput(input: Partial<TrackingImportProfileInput>): Partial<TrackingImportProfileDoc> {
  const out: Partial<TrackingImportProfileDoc> = {};

  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new TrackingImportProfileError(400, "Tên nguồn bắt buộc");
    out.name = name;
    out.nameKey = name.toLowerCase();
  }
  if (input.orderIdColumn !== undefined) {
    out.orderIdColumn = normColumn(input.orderIdColumn, "Order ID", true);
  }
  if (input.trackingColumn !== undefined) {
    out.trackingColumn = normColumn(input.trackingColumn, "Tracking", true);
  }
  if (input.carrierColumn !== undefined) {
    out.carrierColumn = normColumn(input.carrierColumn, "Carrier", false);
  }
  if (input.signature !== undefined) {
    out.signature = (Array.isArray(input.signature) ? input.signature : [])
      .map((h) => normalizeHeader(String(h ?? "")))
      .filter(Boolean);
  }

  // KHÔNG bắt buộc cột Carrier: quy tắc suy carrier từ số tracking (collection `carrier_rules`)
  // lấp chỗ trống. Dòng nào cuối cùng vẫn không ra carrier thì bị BỎ QUA lúc kiểm tra, kèm lý do.
  return out;
}

export async function listImportProfiles(): Promise<TrackingImportProfileDTO[]> {
  const coll = await getTrackingImportProfilesCollection();
  const docs = await coll.find({}).sort({ nameKey: 1 }).toArray();
  return docs.map(toDTO);
}

export async function createImportProfile(
  input: TrackingImportProfileInput,
  ownerEmail: string,
): Promise<TrackingImportProfileDTO> {
  // Ép đủ field bắt buộc (create khác patch: thiếu = lỗi, không phải "giữ nguyên").
  const norm = normalizeInput({
    name: input.name,
    orderIdColumn: input.orderIdColumn,
    trackingColumn: input.trackingColumn,
    carrierColumn: input.carrierColumn ?? "",
    signature: input.signature ?? [],
  });

  const now = new Date();
  const doc: TrackingImportProfileDoc = {
    name: norm.name!,
    nameKey: norm.nameKey!,
    orderIdColumn: norm.orderIdColumn!,
    trackingColumn: norm.trackingColumn!,
    carrierColumn: norm.carrierColumn ?? "",
    signature: norm.signature ?? [],
    ownerEmail,
    createdAt: now,
    updatedAt: now,
  };

  const coll = await getTrackingImportProfilesCollection();
  try {
    const res = await coll.insertOne(doc);
    return toDTO({ ...doc, _id: res.insertedId });
  } catch (err) {
    if ((err as { code?: number })?.code === 11000) {
      throw new TrackingImportProfileError(409, `Đã có nguồn tên "${doc.name}"`);
    }
    throw err;
  }
}

export async function updateImportProfile(
  id: string,
  patch: Partial<TrackingImportProfileInput>,
): Promise<TrackingImportProfileDTO> {
  if (!ObjectId.isValid(id)) throw new TrackingImportProfileError(400, "id không hợp lệ");
  const coll = await getTrackingImportProfilesCollection();
  const merged = normalizeInput(patch);

  try {
    const res = await coll.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { ...merged, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!res) throw new TrackingImportProfileError(404, "Không tìm thấy nguồn");
    return toDTO(res);
  } catch (err) {
    if ((err as { code?: number })?.code === 11000) {
      throw new TrackingImportProfileError(409, `Đã có nguồn tên "${merged.name}"`);
    }
    throw err;
  }
}

export async function deleteImportProfile(id: string): Promise<void> {
  if (!ObjectId.isValid(id)) throw new TrackingImportProfileError(400, "id không hợp lệ");
  const coll = await getTrackingImportProfilesCollection();
  const res = await coll.deleteOne({ _id: new ObjectId(id) });
  if (res.deletedCount === 0) throw new TrackingImportProfileError(404, "Không tìm thấy nguồn");
}

/**
 * Đoán profile của file vừa upload theo header ("import đúng bên là tự nhận luôn").
 * Chỉ trả khi điểm Jaccard ≥ SIGNATURE_MATCH_THRESHOLD — dưới ngưỡng thì để người dùng tự chọn
 * thay vì map nhầm cột (map nhầm = add sai tracking lên Etsy, không undo được).
 */
export async function detectImportProfile(headers: string[]): Promise<string | null> {
  const sig = headers.map((h) => normalizeHeader(h)).filter(Boolean);
  if (sig.length === 0) return null;

  const coll = await getTrackingImportProfilesCollection();
  const docs = await coll.find({ signature: { $ne: [] } }).toArray();

  let bestId: string | null = null;
  let bestScore = 0;
  for (const d of docs) {
    const score = signatureScore(sig, d.signature ?? []);
    if (score > bestScore) {
      bestScore = score;
      bestId = d._id.toHexString();
    }
  }
  return bestScore >= SIGNATURE_MATCH_THRESHOLD ? bestId : null;
}
