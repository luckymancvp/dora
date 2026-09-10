import "server-only";

import { ObjectId } from "mongodb";
import { getSheetConfigsCollection, getSheetRowsCollection } from "@/lib/db/collections";
import { GoogleNotConnectedError } from "@/lib/google/auth";
import { normalizeStore } from "@/lib/google/sheet-utils";
import { canonicalOrderKey, resolvePrefixRoute, type PrefixRoute } from "@/lib/types/sheets";
import { listCarrierRules } from "@/lib/services/carrier-rule";
import { getMeraOrderStatuses } from "@/lib/services/mera-order";
import {
  parseSpreadsheet,
  SpreadsheetParseError,
  trimTrailingBlankRows,
} from "@/lib/services/spreadsheet-parse";
import { syncSheetIfStale } from "@/lib/services/sheet-sync";
import { detectImportProfile } from "@/lib/services/tracking-import-profile";
import { evaluateCarrierRules } from "@/lib/types/carrier-rule";
import {
  columnKey,
  IMPORT_MAX_ROWS,
  isProcessing,
  normalizeOrderId,
  type ImportCarrierSource,
  type ImportCheckedRow,
  type ImportCheckCounts,
  type ImportCheckResponse,
  type ImportColumn,
  type ImportMappedRow,
  type ImportPreviewResponse,
  type ImportRowState,
  type ImportSkipReason,
} from "@/lib/types/tracking-import";

/** Lỗi nghiệp vụ import (mang HTTP status cho errorResponse). */
export class TrackingImportError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Parse file upload → ma trận ô + mô tả cột + profile tự nhận diện.
 * Nhận .csv (mọi delimiter) và .xlsx. Trả CẢ dòng 1 (tiêu đề) vì cần nó để mô tả cột và học
 * signature; FE bỏ dòng 1 khi map dữ liệu, nên đổi cột/nguồn không phải upload lại.
 */
export async function previewImportFile(opts: {
  fileName: string;
  buffer: Buffer;
}): Promise<ImportPreviewResponse> {
  let raw: string[][];
  try {
    raw = await parseSpreadsheet(opts.fileName, opts.buffer);
  } catch (err) {
    // Lỗi đọc file là lỗi người dùng (400/…) → giữ nguyên status, đổi sang lỗi của tầng import.
    if (err instanceof SpreadsheetParseError) throw new TrackingImportError(err.status, err.message);
    throw err;
  }
  const all = trimTrailingBlankRows(raw);
  const truncated = all.length > IMPORT_MAX_ROWS;
  const rows = truncated ? all.slice(0, IMPORT_MAX_ROWS) : all;

  if (rows.length === 0) throw new TrackingImportError(400, "File không có dữ liệu");

  // Số cột = cột nhiều nhất trong các dòng (dòng CSV có thể ngắn hơn header).
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const header = rows[0] ?? [];
  const columns: ImportColumn[] = [];
  for (let c = 0; c < width; c++) {
    const samples: string[] = [];
    for (let r = 1; r < rows.length && samples.length < 3; r++) {
      const v = (rows[r][c] ?? "").trim();
      if (v) samples.push(v);
    }
    columns.push({ key: columnKey(c), header: (header[c] ?? "").trim(), samples });
  }

  const matchedProfileId = await detectImportProfile(header.map((h) => h ?? ""));

  return {
    fileName: opts.fileName,
    columns,
    // Chuẩn hoá độ dài mọi dòng về `width` để FE index theo cột không bị undefined.
    rows: rows.map((r) => Array.from({ length: width }, (_, c) => (r[c] ?? "").trim())),
    rowCount: rows.length,
    truncated,
    matchedProfileId,
  };
}

// ---- Tra status: Sheet (ưu tiên) → Mera ----

/** Đọc cột "Status" của 1 dòng sheet, không phân biệt hoa/thường tên header. */
function statusOfSheetRow(values: Record<string, string>): string {
  for (const [k, v] of Object.entries(values)) {
    if (k.trim().toLowerCase() === "status") return (v ?? "").trim();
  }
  return "";
}

/** 1 đơn cần tra: receipt id đã chuẩn hoá + order id nguyên văn (còn tiền tố) để định tuyến. */
interface LookupOrder {
  receiptId: string;
  rawOrderId: string;
}

/** Kết quả tra Sheet cho 1 đơn. */
interface SheetHit {
  /**
   * true = THỰC SỰ có dòng trong sheet. Phân biệt với bản ghi chỉ mang store đã định tuyến
   * (đơn có tiền tố nhưng sheet không có dòng nào) — nếu lẫn, "không thấy đơn" sẽ bị báo nhầm
   * thành "tìm thấy đơn nhưng không có Status".
   */
  found: boolean;
  statuses: string[];
  /** Store suy từ tiền tố (rỗng nếu order id không mang tiền tố đã đăng ký). */
  store: string;
}

/**
 * Tra status trên Google Sheet cho NHIỀU đơn trong 1 query.
 *
 * ĐỊNH TUYẾN THEO TIỀN TỐ: order id của bên gia công mang tiền tố store (`IRS-4167469772`).
 * Tab "Prefix" của mỗi sheet (cột A Store, cột B tiền tố) cho biết tiền tố nào thuộc sheet nào,
 * nên 1 file gộp đơn của nhiều shop vẫn tra được đúng sheet cho từng dòng. Đơn không mang tiền
 * tố đã đăng ký thì fallback dò mọi sheet đang bật (hành vi cũ).
 *
 * Khác `resolveOrderRow` (1 đơn/lần): prime sync 1 lần cho mọi config rồi `$in` một phát —
 * import vài trăm dòng mà gọi resolveOrderRow từng dòng sẽ lặp sync + query n lần.
 */
async function sheetStatuses(opts: {
  /** Shop đang chọn ở khối import — chỉ dùng để ưu tiên sheet khi đơn KHÔNG có tiền tố. */
  storeName: string;
  orders: LookupOrder[];
}): Promise<Map<string, SheetHit>> {
  const out = new Map<string, SheetHit>();
  if (opts.orders.length === 0) return out;

  const configs = await getSheetConfigsCollection();
  const enabled = await configs.find({ enabled: true }).sort({ order: 1 }).toArray();
  if (enabled.length === 0) return out;

  // Sheet của đúng store dò trước; sheet chưa từng sync (cold) phải chờ, warm thì refresh nền.
  const store = normalizeStore(opts.storeName);
  const prioritized = [...enabled].sort((a, b) => {
    const am = a.shopNames?.some((s) => normalizeStore(s) === store) ? 0 : 1;
    const bm = b.shopNames?.some((s) => normalizeStore(s) === store) ? 0 : 1;
    return am - bm || a.order - b.order;
  });
  await Promise.all(
    prioritized.map(async (cfg) => {
      if (cfg.lastSyncedAt) {
        void syncSheetIfStale(cfg).catch(() => {});
        return;
      }
      try {
        await syncSheetIfStale(cfg);
      } catch (e) {
        // Chưa kết nối Google là lỗi cấu hình thật → để route báo 409 mời kết nối lại.
        if (e instanceof GoogleNotConnectedError) throw e;
      }
    }),
  );

  // Bảng tiền tố gom từ mọi sheet đang bật (đọc lại sau sync để có `prefixes` vừa cập nhật).
  const synced = await configs.find({ enabled: true }).sort({ order: 1 }).toArray();
  const routes: PrefixRoute<ObjectId>[] = synced.flatMap((cfg) =>
    (cfg.prefixes ?? []).map((p) => ({
      configId: cfg._id,
      store: p.store,
      prefix: p.prefix.trim().toUpperCase(),
    })),
  );

  const routeOf = new Map<string, PrefixRoute<ObjectId> | null>();
  for (const o of opts.orders) {
    if (!routeOf.has(o.receiptId)) {
      routeOf.set(o.receiptId, resolvePrefixRoute(o.rawOrderId, routes));
    }
  }

  const rowsColl = await getSheetRowsCollection();
  const found = await rowsColl
    .find({
      receiptKey: { $in: [...new Set(opts.orders.map((o) => o.receiptId))] },
      configId: { $in: synced.map((c) => c._id) },
    })
    .project<{
      receiptKey: string;
      configId: ObjectId;
      order: string;
      store: string;
      values: Record<string, string>;
    }>({ receiptKey: 1, configId: 1, order: 1, store: 1, values: 1 })
    .toArray();

  const byReceipt = new Map<string, typeof found>();
  for (const r of found) {
    const list = byReceipt.get(r.receiptKey);
    if (list) list.push(r);
    else byReceipt.set(r.receiptKey, [r]);
  }

  const rawById = new Map(opts.orders.map((o) => [o.receiptId, o.rawOrderId]));

  for (const [receiptId, candidates] of byReceipt) {
    const route = routeOf.get(receiptId) ?? null;
    const wantKey = canonicalOrderKey(rawById.get(receiptId) ?? "");

    // Chọn dòng theo ĐỘ CHẮC CHẮN giảm dần. Định tuyến tiền tố là ƯU TIÊN, KHÔNG phải loại trừ:
    // cùng một tiền tố có thể được khai ở nhiều sheet (vd sheet TEST và sheet thật đều có "IRC-"),
    // lọc cứng theo sheet đã route sẽ vứt mất dòng đúng nằm ở sheet kia.
    //   1. Cột "Order" khớp đúng `prefix-số đơn` (IRC-4118353972) — bằng chứng mạnh nhất.
    //   2. Dòng nằm trong sheet đã định tuyến theo tiền tố.
    //   3. Bất kỳ dòng nào trùng số đơn (đơn không có tiền tố, hoặc sheet thiếu cột Order).
    const exact = wantKey
      ? candidates.filter((r) => r.order && canonicalOrderKey(r.order) === wantKey)
      : [];
    const routed = route ? candidates.filter((r) => route.configId.equals(r.configId)) : [];
    const chosen = exact.length > 0 ? exact : routed.length > 0 ? routed : candidates;
    if (chosen.length === 0) continue;

    const statuses: string[] = [];
    for (const r of chosen) {
      const status = statusOfSheetRow(r.values ?? {});
      // Đơn nhiều transaction ⇒ nhiều dòng sheet; gom status phân biệt để UI thấy trường hợp lệch.
      if (status && !statuses.includes(status)) statuses.push(status);
    }
    // Store: ưu tiên tiền tố; không có thì lấy cột "Store" của chính dòng khớp được.
    const store = route?.store || chosen.find((r) => r.store)?.store || "";
    out.set(receiptId, { found: true, statuses, store });
  }

  // Đơn có tiền tố nhưng KHÔNG có dòng nào trùng số đơn ở bất kỳ sheet nào: vẫn ghi store đã
  // định tuyến để UI nói được "thuộc shop X nhưng không thấy đơn".
  for (const [receiptId, route] of routeOf) {
    if (route && !out.has(receiptId)) {
      out.set(receiptId, { found: false, statuses: [], store: route.store });
    }
  }
  return out;
}

/** Kết luận trạng thái 1 dòng từ danh sách status tra được. */
function decide(
  statuses: string[],
): { state: ImportRowState; message: string; reason: ImportSkipReason } {
  if (statuses.length === 0) {
    return {
      state: "SKIPPED_STATUS",
      message: "Tìm thấy đơn nhưng không có Status",
      reason: "no_status",
    };
  }
  const processing = statuses.filter(isProcessing);
  if (processing.length === 0) {
    return {
      state: "SKIPPED_STATUS",
      message: `Status ${statuses.join(", ")} — bỏ qua`,
      reason: "status",
    };
  }
  if (processing.length < statuses.length) {
    // Đơn nhiều item/dòng, chỉ một phần đang Processing → vẫn cho add nhưng nói rõ để người dùng quyết.
    return { state: "ELIGIBLE", message: `Status lệch: ${statuses.join(", ")}`, reason: "" };
  }
  return { state: "ELIGIBLE", message: "", reason: "" };
}

/**
 * Tra status cho các dòng đã map cột, đánh dấu dòng được phép add tracking.
 * Thứ tự nguồn: Google Sheet (ưu tiên) → Mera cho các đơn Sheet không có.
 * Chỉ dòng status PROCESSING mới ELIGIBLE; mọi trạng thái khác bị bỏ qua.
 */
export async function checkImportRows(opts: {
  /** Gợi ý ưu tiên sheet; rỗng cũng được — store thật suy từ tiền tố order id. */
  storeName?: string;
  rows: ImportMappedRow[];
  actorEmail: string;
}): Promise<ImportCheckResponse> {
  const storeHint = (opts.storeName ?? "").trim();
  // Quy tắc suy carrier từ số tracking — chỉ dùng khi dòng KHÔNG có carrier sẵn.
  // Đọc 1 lần cho cả lượt (danh sách nhỏ, dùng lại cho mọi dòng).
  const carrierRules = await listCarrierRules();

  // Chuẩn hoá + validate từng dòng trước; chỉ dòng hợp lệ mới tốn lượt tra Sheet/Mera.
  // seen: receipt id → số dòng đầu tiên mang nó, để báo trùng CHỈ RÕ dòng nào.
  const seen = new Map<string, number>();
  const prepared = opts.rows.map((r) => {
    const raw_order_id = (r.order_id ?? "").trim();
    const tracking_number = (r.tracking_number ?? "").trim();
    const order_id = normalizeOrderId(raw_order_id);

    // Chốt carrier: ô trong file → quy tắc theo số tracking. Không ra được thì bỏ trống,
    // dòng đó bị loại bên dưới (không có carrier thì không add tracking lên Etsy được).
    const fileCarrier = (r.carrier ?? "").trim();
    const matchedRule = fileCarrier ? null : evaluateCarrierRules(tracking_number, carrierRules);
    const carrier = fileCarrier || matchedRule?.carrier || "";
    const carrierSource: ImportCarrierSource = fileCarrier ? "file" : matchedRule ? "rule" : "none";

    const missing: string[] = [];
    if (!order_id) missing.push("Order ID");
    if (!tracking_number) missing.push("Tracking");

    let invalidMessage = missing.length > 0 ? `Thiếu ${missing.join(", ")}` : "";
    let invalidReason: ImportSkipReason = invalidMessage ? "missing_field" : "";
    const dupOf = invalidMessage ? undefined : seen.get(order_id);
    // Carrier tách riêng: thiếu carrier KHÔNG phải lỗi dữ liệu file mà là thiếu quy tắc,
    // nên nói thẳng chỗ cần sửa thay vì chỉ "Thiếu Carrier".
    if (!invalidMessage && !carrier) {
      invalidMessage = "Không suy được carrier — thêm quy tắc ở tab Cấu hình import";
      invalidReason = "no_carrier";
    }
    if (dupOf !== undefined) {
      // Cùng 1 đơn Etsy xuất hiện nhiều dòng (vd 2 kiện cùng đơn): giữ dòng đầu, các dòng sau
      // đánh lỗi để không add đè tracking lên nhau. Nêu rõ dòng nào để đối chiếu trong file.
      invalidMessage = `Đơn ${order_id} đã có ở dòng ${dupOf} — bỏ dòng này để không add đè`;
      invalidReason = "duplicate";
    }
    if (!invalidMessage) seen.set(order_id, r.rowNumber);

    return {
      rowNumber: r.rowNumber,
      raw_order_id,
      order_id,
      tracking_number,
      carrier,
      carrierSource,
      carrierRule: matchedRule?.rule.id ?? "",
      invalidMessage,
      invalidReason,
    };
  });

  // Giữ CẢ order id nguyên văn: tiền tố ("IRS-") là thứ định tuyến về đúng sheet/store.
  const lookupOrders = [
    ...new Map(
      prepared
        .filter((p) => !p.invalidMessage)
        .map((p) => [p.order_id, { receiptId: p.order_id, rawOrderId: p.raw_order_id }]),
    ).values(),
  ];

  const fromSheet = await sheetStatuses({ storeName: storeHint, orders: lookupOrders });

  // Sheet là nguồn ưu tiên, nhưng "có dòng mà cột Status trống" thì coi như CHƯA tra được →
  // vẫn hỏi Mera. Chỉ đơn đã có status trên Sheet mới bỏ qua Mera.
  const unresolved = lookupOrders.filter(
    (o) => (fromSheet.get(o.receiptId)?.statuses.length ?? 0) === 0,
  );

  const mera = await getMeraOrderStatuses({
    // Store suy từ tiền tố chính xác hơn shop đang chọn ở khối (1 file gộp đơn nhiều shop);
    // đơn không có tiền tố thì rơi về shop của khối.
    receipts: unresolved.map((o) => ({
      receiptId: o.receiptId,
      storeName: fromSheet.get(o.receiptId)?.store || storeHint,
    })),
    actorEmail: opts.actorEmail,
  });

  const rows: ImportCheckedRow[] = prepared.map((p) => {
    if (p.invalidMessage) {
      return {
        rowNumber: p.rowNumber,
        order_id: p.order_id,
        raw_order_id: p.raw_order_id,
        tracking_number: p.tracking_number,
        carrier: p.carrier,
        carrierSource: p.carrierSource,
        carrierRule: p.carrierRule,
        store: "",
        state: "INVALID",
        reason: p.invalidReason,
        source: null,
        statuses: [],
        message: p.invalidMessage,
      };
    }

    const sheetHit = fromSheet.get(p.order_id);
    const meraHit = mera.statuses.get(p.order_id);
    // Shop: tiền tố → cột Store của dòng sheet → store Mera ghi nhận. Nhánh Mera cứu các đơn
    // có tiền tố chưa khai trong tab Prefix nào (vd COVH-) — vẫn phân loại được shop.
    const store = sheetHit?.store || meraHit?.store || "";

    // Ưu tiên Sheet CÓ status; Sheet có dòng nhưng status trống thì nhường Mera (nếu Mera có).
    // `found` mới là điều kiện chốt: bản ghi chỉ-định-tuyến (found=false) KHÔNG được coi là
    // "đã tra ra ở Sheet", nếu không đơn không tồn tại sẽ bị báo là thiếu Status.
    const useSheet =
      (sheetHit?.statuses.length ?? 0) > 0 || (sheetHit?.found === true && meraHit === undefined);
    const statuses = useSheet ? sheetHit?.statuses : meraHit?.statuses;

    if (!statuses) {
      return {
        rowNumber: p.rowNumber,
        order_id: p.order_id,
        raw_order_id: p.raw_order_id,
        tracking_number: p.tracking_number,
        carrier: p.carrier,
        carrierSource: p.carrierSource,
        carrierRule: p.carrierRule,
        store,
        state: "NOT_FOUND",
        reason: "not_found",
        source: null,
        statuses: [],
        message: store
          ? `Thuộc shop ${store} (theo tiền tố) nhưng không thấy đơn trong sheet của shop đó`
          : mera.unavailable
            ? "Không thấy trên Sheet (chưa tra được Mera)"
            : "Không thấy đơn trên Sheet lẫn Mera",
      };
    }

    const { state, message, reason } = decide(statuses);
    return {
      rowNumber: p.rowNumber,
      order_id: p.order_id,
      raw_order_id: p.raw_order_id,
      tracking_number: p.tracking_number,
      carrier: p.carrier,
      carrierSource: p.carrierSource,
      carrierRule: p.carrierRule,
      store,
      state,
      reason,
      source: useSheet ? "sheet" : "mera",
      statuses,
      message,
    };
  });

  const counts: ImportCheckCounts = {
    total: rows.length,
    eligible: rows.filter((r) => r.state === "ELIGIBLE").length,
    skippedStatus: rows.filter((r) => r.state === "SKIPPED_STATUS").length,
    notFound: rows.filter((r) => r.state === "NOT_FOUND").length,
    invalid: rows.filter((r) => r.state === "INVALID").length,
  };

  return { rows, counts, meraUnavailable: mera.unavailable };
}
