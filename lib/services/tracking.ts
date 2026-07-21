import { ObjectId, type Filter } from "mongodb";
import { getTrackingJobsCollection } from "@/lib/db/collections";
import {
  publishFetchShipments,
  publishSendTracking,
  type SendTrackingOrder,
} from "@/lib/services/ably-publish";
import {
  resolveCarrier,
  type ShipmentResultItem,
  type TrackingHistoryItem,
  type TrackingHistoryQuery,
  type TrackingHistoryResponse,
  type TrackingJob,
  type TrackingJobCounts,
  type TrackingJobOrder,
  type TrackingOrderInput,
} from "@/lib/types/tracking";
import { resolveShopIdByName } from "@/lib/services/shop-read";

/** Shop không có browser extension nào online → không thể GET/add tracking. */
export class ShopOfflineError extends Error {
  constructor(shopName: string) {
    super(`shop "${shopName}" không có browser nào online`);
    this.name = "ShopOfflineError";
  }
}

/** So tracking để verify: bỏ khoảng trắng, không phân biệt hoa thường. */
function normalizeCode(s: string): string {
  return s.trim().replace(/\s+/g, "").toUpperCase();
}

/** Map order_id → shipment có tracking_code (ưu tiên cái đầu tiên không rỗng). */
function indexShipments(shipments: ShipmentResultItem[]): Map<string, ShipmentResultItem> {
  const map = new Map<string, ShipmentResultItem>();
  for (const s of shipments) {
    const oid = String(s.order_id ?? "").trim();
    const code = String(s.tracking_code ?? "").trim();
    if (!oid || !code) continue;
    if (!map.has(oid)) map.set(oid, s);
  }
  return map;
}

export interface SerializedJob extends Omit<TrackingJob, "_id"> {
  id: string;
}

export function serializeJob(job: TrackingJob): SerializedJob {
  const { _id, ...rest } = job;
  return { id: _id.toHexString(), ...rest };
}

async function getJobDoc(id: string): Promise<TrackingJob | null> {
  let oid: ObjectId;
  try {
    oid = new ObjectId(id);
  } catch {
    return null;
  }
  const coll = await getTrackingJobsCollection();
  return coll.findOne({ _id: oid });
}

export async function getJob(id: string): Promise<SerializedJob | null> {
  const job = await getJobDoc(id);
  return job ? serializeJob(job) : null;
}

/* ---- Lịch sử add tracking (tab "Lịch sử" trang /tracking) ---- */

/**
 * Chỉ cần 3 field trong orders[] để tính counts → projection giới hạn field,
 * tránh kéo toàn bộ block orders (existing/verified/message…) khi list.
 */
type OrderCountFields = Pick<TrackingJobOrder, "selected" | "verify" | "add_status">;

/**
 * Tính TrackingJobCounts từ mảng orders. Logic PHẢI khớp 1:1 với `JobCard.summary`
 * trong app/tracking/page.tsx để số ở lịch sử == số hiển thị lúc chạy job.
 * Khác biệt duy nhất theo contract: `total = orders.length` (page.tsx dùng sent.length
 * cho "total" hiển thị), còn `selected` mới là số đơn đã gửi add (selected = true).
 */
export function summarizeJob(orders: OrderCountFields[]): TrackingJobCounts {
  const sent = orders.filter((o) => o.selected);
  return {
    total: orders.length,
    selected: sent.length,
    verified: sent.filter((o) => o.verify === "VERIFIED").length,
    mismatch: sent.filter((o) => o.verify === "MISMATCH").length,
    failed: sent.filter((o) => o.add_status === "FAILED").length,
    // SKIPPED nhưng không phải do FAILED (đã tách failed ở trên) → "bỏ qua xác minh".
    skipped: sent.filter((o) => o.verify === "SKIPPED" && o.add_status !== "FAILED").length,
  };
}

/** Shape doc sau projection cho list lịch sử (không kéo orders nặng). */
interface HistoryProjection {
  _id: ObjectId;
  shop_name: string;
  shop_id: number | null;
  sender_email: string;
  phase: TrackingJob["phase"];
  error?: string;
  created_at: Date;
  updated_at: Date;
  // Chỉ 3 field/đơn phục vụ đếm counts.
  orders: OrderCountFields[];
}

/**
 * List lịch sử job, phân trang offset + sort created_at desc. Không lọc theo
 * sender_email (mọi user tra chéo được — theo contract). Search q khớp CHÍNH XÁC
 * order_id/tracking_number trong orders[] (multikey index) — người dùng dán mã đầy đủ.
 */
export async function listJobHistory(
  query: TrackingHistoryQuery,
): Promise<TrackingHistoryResponse> {
  // Clamp phòng thủ: page ≥ 1, limit trong [1, 100] (mặc định 20) tránh kéo cả bảng.
  const page = Math.max(1, Math.floor(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Math.floor(query.limit) || 20));
  const q = (query.q ?? "").trim();
  const shop = (query.shop ?? "").trim();

  const filter: Filter<TrackingJob> = {};
  if (q) {
    // orders là mảng → so khớp element: match nếu BẤT KỲ đơn nào có order_id
    // hoặc tracking_number == q. Dùng index multikey idx_orders_*.
    filter.$or = [{ "orders.order_id": q }, { "orders.tracking_number": q }];
  }
  if (shop) filter.shop_name = shop;

  const coll = await getTrackingJobsCollection();

  // Projection: bỏ mọi field nặng của orders, chỉ giữ 3 field đếm counts.
  const projection = {
    shop_name: 1,
    shop_id: 1,
    sender_email: 1,
    phase: 1,
    error: 1,
    created_at: 1,
    updated_at: 1,
    "orders.selected": 1,
    "orders.verify": 1,
    "orders.add_status": 1,
  } as const;

  // Đếm + lấy trang song song để giảm round-trip.
  const [total, docs] = await Promise.all([
    coll.countDocuments(filter),
    coll
      .find(filter, { projection })
      .sort({ created_at: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray() as Promise<HistoryProjection[]>,
  ]);

  const items: TrackingHistoryItem[] = docs.map((d) => ({
    id: d._id.toHexString(),
    shop_name: d.shop_name,
    shop_id: d.shop_id ?? null,
    sender_email: d.sender_email,
    phase: d.phase,
    ...(d.error ? { error: d.error } : {}),
    counts: summarizeJob(Array.isArray(d.orders) ? d.orders : []),
    // created_at/updated_at là Date trong DB → ISO string đúng contract (đã "qua JSON").
    created_at: d.created_at.toISOString(),
    updated_at: d.updated_at.toISOString(),
  }));

  return {
    items,
    page,
    pageSize: limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

async function saveOrders(id: ObjectId, orders: TrackingJobOrder[], phase: TrackingJob["phase"]): Promise<void> {
  const coll = await getTrackingJobsCollection();
  await coll.updateOne({ _id: id }, { $set: { orders, phase, updated_at: new Date() } });
}

/**
 * Tạo job: lưu DB (phase PRECHECK) rồi publish fetch-shipments để extension
 * GET tracking hiện có. Ném ShopOfflineError nếu shop không online.
 */
export async function createJob(params: {
  shopName: string;
  shopId?: number | null;
  orders: TrackingOrderInput[];
  senderEmail: string;
}): Promise<SerializedJob> {
  const shopName = params.shopName.trim();
  // Etsy shop_id THẬT lấy từ dora-master.stores theo tên shop (KHÔNG dùng user_id).
  // Nếu không tra được → null, extension sẽ tự getShopId() từ tab đang login.
  const shopId = params.shopId ?? (await resolveShopIdByName(shopName));

  const orders: TrackingJobOrder[] = params.orders.map((o) => {
    const { carrier, other_carrier } = resolveCarrier(o.carrier);
    return {
      order_id: String(o.order_id).trim(),
      tracking_number: String(o.tracking_number).trim(),
      carrier,
      other_carrier,
      precheck: "PENDING",
      selected: false,
      add_status: "NEW",
      verify: "PENDING",
    };
  });

  const _id = new ObjectId();
  const now = new Date();
  const job: TrackingJob = {
    _id,
    shop_name: shopName,
    shop_id: shopId,
    client_id: "",
    sender_email: params.senderEmail,
    phase: "PRECHECK",
    orders,
    created_at: now,
    updated_at: now,
  };

  const coll = await getTrackingJobsCollection();
  await coll.insertOne(job);

  const orderIds = orders.map((o) => o.order_id);
  const clientId = await publishFetchShipments(shopName, { id: _id.toHexString(), shopId, orderIds });
  if (!clientId) {
    await coll.deleteOne({ _id });
    throw new ShopOfflineError(shopName);
  }
  await coll.updateOne({ _id }, { $set: { client_id: clientId } });
  job.client_id = clientId;
  return serializeJob(job);
}

/**
 * Xử lý kết quả GET shipments từ extension cho cả 2 phase:
 * - PRECHECK: đánh dấu mỗi đơn CLEAR (chưa có tracking) / EXISTS (đã có) → AWAIT_CONFIRM.
 * - VERIFY: so tracking trả về với tracking đã gửi → VERIFIED / MISMATCH → COMPLETED.
 */
export async function applyShipmentsResult(
  id: string,
  shipments: ShipmentResultItem[],
  error?: string,
): Promise<boolean> {
  const job = await getJobDoc(id);
  if (!job) return false;

  // GET shipments thất bại (vd shop_id sai) → KHÔNG được coi là "chưa có tracking".
  if (error) {
    const coll = await getTrackingJobsCollection();
    if (job.phase === "PRECHECK") {
      // Dừng job, báo lỗi để người dùng sửa rồi tạo lại — tránh add đè nhầm.
      await coll.updateOne(
        { _id: job._id },
        { $set: { phase: "COMPLETED", error, updated_at: new Date() } },
      );
      return true;
    }
    if (job.phase === "VERIFY") {
      // Đã add rồi nhưng không verify được → đánh dấu SKIPPED, không coi là MISMATCH.
      for (const o of job.orders) {
        if (o.add_status === "DONE" && o.verify === "PENDING") {
          o.verify = "SKIPPED";
          o.message = "Đã add nhưng không verify được: " + error;
        }
      }
      await coll.updateOne(
        { _id: job._id },
        { $set: { orders: job.orders, phase: "COMPLETED", error, updated_at: new Date() } },
      );
      return true;
    }
    return false;
  }

  const map = indexShipments(shipments);

  if (job.phase === "PRECHECK") {
    for (const o of job.orders) {
      const found = map.get(o.order_id);
      if (found) {
        o.precheck = "EXISTS";
        o.existing = { code: found.tracking_code, carrier_name: found.carrier_name };
        o.selected = false; // đơn đã có tracking: cần người dùng tick override
      } else {
        o.precheck = "CLEAR";
        o.selected = true; // đơn chưa có: mặc định chọn để add
      }
    }
    await saveOrders(job._id, job.orders, "AWAIT_CONFIRM");
    return true;
  }

  if (job.phase === "VERIFY") {
    for (const o of job.orders) {
      if (o.add_status !== "DONE") {
        if (o.verify === "PENDING") o.verify = "SKIPPED";
        continue;
      }
      const found = map.get(o.order_id);
      if (found && normalizeCode(found.tracking_code) === normalizeCode(o.tracking_number)) {
        o.verify = "VERIFIED";
        o.verified = { code: found.tracking_code, carrier_name: found.carrier_name };
      } else {
        o.verify = "MISMATCH";
        if (found) o.verified = { code: found.tracking_code, carrier_name: found.carrier_name };
        o.message = found
          ? "Tracking trên Etsy khác với tracking đã gửi"
          : "Không tìm thấy tracking trên Etsy sau khi add";
      }
    }
    await saveOrders(job._id, job.orders, "COMPLETED");
    return true;
  }

  // Phase khác (đã COMPLETED…) → bỏ qua kết quả muộn.
  return false;
}

/**
 * Người dùng xác nhận add các đơn đã chọn (orderIds). Set ADDING + publish send-tracking.
 * Ném ShopOfflineError nếu shop offline.
 */
export async function confirmAdd(id: string, orderIds: string[]): Promise<SerializedJob | null> {
  const job = await getJobDoc(id);
  if (!job) return null;

  const selectedSet = new Set(orderIds.map((s) => String(s).trim()));
  const toSend: SendTrackingOrder[] = [];
  for (const o of job.orders) {
    if (selectedSet.has(o.order_id)) {
      o.selected = true;
      o.add_status = "NEW";
      toSend.push({
        order_id: o.order_id,
        carrier: o.carrier,
        other_carrier: o.other_carrier,
        tracking_number: o.tracking_number,
      });
    } else {
      o.selected = false;
      if (o.add_status === "NEW") o.verify = "SKIPPED";
    }
  }

  if (toSend.length === 0) {
    throw new Error("không có đơn nào được chọn để add");
  }

  const clientId = await publishSendTracking(job.shop_name, {
    id: job._id.toHexString(),
    shopId: job.shop_id,
    orders: toSend,
  });
  if (!clientId) throw new ShopOfflineError(job.shop_name);

  await saveOrders(job._id, job.orders, "ADDING");
  const coll = await getTrackingJobsCollection();
  await coll.updateOne({ _id: job._id }, { $set: { client_id: clientId } });
  job.client_id = clientId;
  job.phase = "ADDING"; // saveOrders chỉ ghi DB; cập nhật in-memory để response trả đúng phase
  return serializeJob(job);
}

/**
 * Extension báo trạng thái add (cả batch): SENDING / DONE / FAILED.
 * DONE → chuyển VERIFY + publish fetch-shipments lần 2 để xác minh.
 */
export async function applyStatus(id: string, status: string): Promise<boolean> {
  const job = await getJobDoc(id);
  if (!job) return false;

  const isAddingOrder = (o: TrackingJobOrder) => o.selected && (o.add_status === "NEW" || o.add_status === "SENDING");

  if (status === "SENDING") {
    for (const o of job.orders) {
      if (o.selected && o.add_status === "NEW") o.add_status = "SENDING";
    }
    await saveOrders(job._id, job.orders, "ADDING");
    return true;
  }

  if (status === "FAILED") {
    for (const o of job.orders) {
      if (isAddingOrder(o)) {
        o.add_status = "FAILED";
        o.verify = "SKIPPED";
        o.message = "Extension báo add thất bại";
      }
    }
    await saveOrders(job._id, job.orders, "COMPLETED");
    return true;
  }

  if (status === "DONE") {
    const verifyIds: string[] = [];
    for (const o of job.orders) {
      if (isAddingOrder(o)) {
        o.add_status = "DONE";
        verifyIds.push(o.order_id);
      }
    }

    // Publish fetch-shipments lần 2 để verify. Nếu shop offline → bỏ verify, coi như xong.
    const clientId = verifyIds.length
      ? await publishFetchShipments(job.shop_name, {
          id: job._id.toHexString(),
          shopId: job.shop_id,
          orderIds: verifyIds,
        })
      : null;

    if (!clientId) {
      for (const o of job.orders) {
        if (o.add_status === "DONE" && o.verify === "PENDING") {
          o.verify = "SKIPPED";
          o.message = "Đã add nhưng không verify được (shop offline)";
        }
      }
      await saveOrders(job._id, job.orders, "COMPLETED");
      return true;
    }

    await saveOrders(job._id, job.orders, "VERIFY");
    const coll = await getTrackingJobsCollection();
    await coll.updateOne({ _id: job._id }, { $set: { client_id: clientId } });
    return true;
  }

  return false;
}
