import { ObjectId, type Filter } from "mongodb";
import { getTrackingJobsCollection } from "@/lib/db/collections";
import {
  publishFetchShipments,
  publishSendTracking,
  type SendTrackingOrder,
} from "@/lib/services/ably-publish";
import {
  resolveCarrier,
  summarizeTrackingOrders,
  type ShipmentResultItem,
  type TrackingHistoryItem,
  type TrackingHistoryQuery,
  type TrackingHistoryResponse,
  type TrackingJob,
  type TrackingJobCounts,
  type TrackingJobOrder,
  type TrackingOrderCountFields,
  type TrackingOrderInput,
  type TrackingValue,
  type VerifyState,
} from "@/lib/types/tracking";
import { resolveShopIdByName } from "@/lib/services/shop-read";

/*
 * GHI CHÚ CHỦ ĐÍCH: verify KHÔNG xét `is_shipped`.
 *
 * Đã từng có nhánh coi `is_shipped === false` là lỗi ("Etsy chưa đánh dấu đã ship") nhưng
 * đã gỡ bỏ. Lý do: verify GET chạy chỉ vài giây sau POST add, không có bằng chứng Etsy kịp
 * cập nhật `isShipped` trong khoảng đó — dùng nó làm điều kiện đạt/không đạt thì đơn add
 * ĐÚNG cũng có thể bị báo đỏ hàng loạt. Rủi ro lớn hơn lợi ích.
 *
 * Nếu sau này muốn thêm lại: phải ĐO trước bằng dữ liệu Etsy thật đọc ngay sau khi add
 * (không phải số liệu từ luồng sync đơn), đừng bật dựa trên suy luận.
 */

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

/**
 * So carrier để verify: thường hoá + gộp mọi ký tự không phải chữ/số thành 1 khoảng trắng
 * → "US Standard" == "us-standard" == "US  Standard".
 *
 * CỐ Ý KHÔNG fuzzy hơn (không có bảng alias USPS ↔ "US Postal Service"): alias sai còn
 * nguy hiểm hơn cảnh báo thừa — nó sẽ báo "đã xác minh" cho đơn thực tế add sai carrier,
 * đúng cái bug đang sửa. Nếu Etsy hay đổi tên thật, mở issue riêng để nới ở CHÍNH hàm này.
 */
function normalizeCarrier(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Carrier Etsy trả về có khớp carrier đã gửi không.
 * Etsy trả carrier_name RỖNG = KHÔNG khớp (không có bằng chứng nào cho thấy carrier đúng),
 * chứ không được coi "rỗng == rỗng" là khớp — đó là nguồn của kết luận VERIFIED giả.
 */
function carrierMatches(sent: string, fromEtsy: string): boolean {
  const etsy = normalizeCarrier(fromEtsy);
  if (!etsy) return false;
  return normalizeCarrier(sent) === etsy;
}

/**
 * Map order_id → TẤT CẢ shipment có tracking_code của đơn đó.
 * Một đơn Etsy có thể có nhiều shipment (add thêm tracking mới vào đơn đã có tracking cũ),
 * nên KHÔNG được chỉ giữ cái đầu tiên — verify sẽ so nhầm với tracking cũ → MISMATCH giả.
 */
function indexShipments(shipments: ShipmentResultItem[]): Map<string, ShipmentResultItem[]> {
  const map = new Map<string, ShipmentResultItem[]>();
  for (const s of shipments) {
    const oid = String(s.order_id ?? "").trim();
    const code = String(s.tracking_code ?? "").trim();
    if (!oid || !code) continue;
    const list = map.get(oid);
    if (list) list.push(s);
    else map.set(oid, [s]);
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
 * Tính TrackingJobCounts từ mảng orders.
 *
 * LOGIC ĐẾM KHÔNG SỐNG Ở ĐÂY: nó nằm ở `summarizeTrackingOrders` trong
 * lib/types/tracking.ts và được DÙNG CHUNG với `JobCard.summary` ở app/tracking/page.tsx.
 * Trước đây hai bên tự copy logic, chỉ ràng buộc nhau bằng comment "phải khớp 1:1" nên
 * dễ trôi (job đang chạy và lịch sử ra số khác nhau). Giữ wrapper này vì `listJobHistory`
 * đã gọi theo tên và nó là điểm vào rõ nghĩa của tầng service.
 */
export function summarizeJob(orders: TrackingOrderCountFields[]): TrackingJobCounts {
  return summarizeTrackingOrders(orders);
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
  // Chỉ 3 field/đơn phục vụ đếm counts (projection giới hạn field, tránh kéo
  // toàn bộ block orders: existing/verified/message… khi list lịch sử).
  orders: TrackingOrderCountFields[];
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

/** Kết quả phân loại 1 đơn ở phase VERIFY (thuần, không đụng DB → dễ suy luận/test). */
interface VerifyOutcome {
  verify: VerifyState;
  /** Không set với VERIFIED "sạch" (theo contract §2). */
  message?: string;
  /** Cái Etsy ĐANG CÓ, để người dùng đối chiếu trên bảng. Không set khi Etsy không trả gì. */
  verified?: TrackingValue;
}

/**
 * Phân loại kết quả verify 1 đơn: so shipment Etsy trả về với cái đã gửi.
 *
 * VERIFIED phải khớp CẢ HAI: mã tracking + carrier. Trước đây chỉ so mã → đơn add sai
 * carrier vẫn báo "đã xác minh" trong khi Etsy hiện "No tracking".
 *
 * Thứ tự phân loại chạy tuần tự, ưu tiên từ "sai nặng" xuống "sai nhẹ" để message nói
 * đúng cái người vận hành cần sửa trước.
 */
function classifyVerify(o: TrackingJobOrder, list: ShipmentResultItem[]): VerifyOutcome {
  // 1. Etsy không trả shipment nào có mã cho đơn này → add không ăn.
  if (list.length === 0) {
    return {
      verify: "NOT_FOUND",
      message: `Không tìm thấy tracking nào trên Etsy sau khi add (đã gửi ${o.tracking_number} · ${o.other_carrier})`,
    };
  }

  const sentCode = normalizeCode(o.tracking_number);
  const codeHits = list.filter((s) => normalizeCode(String(s.tracking_code ?? "")) === sentCode);

  // 2. Etsy có tracking nhưng không mã nào trùng mã đã gửi.
  if (codeHits.length === 0) {
    const first = list[0];
    return {
      verify: "CODE_MISMATCH",
      message: `Mã tracking trên Etsy khác mã đã gửi — đã gửi ${o.tracking_number}, Etsy đang có ${list
        .map((s) => s.tracking_code)
        .join(", ")}`,
      verified: {
        // Gộp mọi mã Etsy đang có: đơn có thể mang nhiều shipment, in đủ để người dùng soi.
        code: list.map((s) => s.tracking_code).join(", "),
        carrier_name: String(first?.carrier_name ?? ""),
      },
    };
  }

  /*
   * 3. Có ít nhất 1 shipment khớp mã → chọn shipment "TỐT NHẤT" trong số đó.
   * Một đơn Etsy có thể mang nhiều shipment (xem indexShipments): nếu bạ đâu lấy đó,
   * một shipment cũ/khác carrier có thể đè kết quả của shipment vừa add đúng → báo lệch giả.
   * Ưu tiên shipment khớp carrier; không có cái nào khớp thì lấy cái đầu tiên Etsy trả.
   */
  const best = codeHits.find((s) => carrierMatches(o.other_carrier, String(s.carrier_name ?? ""))) ?? codeHits[0];

  const bestCarrier = String(best.carrier_name ?? "");
  const verified: TrackingValue = {
    code: best.tracking_code,
    carrier_name: bestCarrier,
  };

  // 3a. Mã khớp nhưng không shipment nào khớp carrier → add nhầm carrier.
  if (!carrierMatches(o.other_carrier, bestCarrier)) {
    return {
      verify: "CARRIER_MISMATCH",
      // Carrier rỗng ≠ carrier khác: Etsy không ghi nhận carrier nào cho shipment này.
      // Nói đúng bản chất để người vận hành biết phải mở đơn xem, thay vì đi tìm hãng tên "?".
      message: bestCarrier.trim()
        ? `Mã tracking khớp nhưng carrier lệch — đã gửi "${o.other_carrier}", Etsy ghi "${bestCarrier.trim()}"`
        : `Mã tracking khớp nhưng Etsy KHÔNG ghi nhận carrier nào — đã gửi "${o.other_carrier}"`,
      verified,
    };
  }

  // 3b. Khớp cả mã lẫn carrier → VERIFIED, không set message.
  return { verify: "VERIFIED", verified };
}

/**
 * Xử lý kết quả GET shipments từ extension cho cả 2 phase:
 * - PRECHECK: đánh dấu mỗi đơn CLEAR (chưa có tracking) / EXISTS (đã có) → AWAIT_CONFIRM.
 * - VERIFY: so tracking Etsy trả về với cái đã gửi → VERIFIED, hoặc 1 trong 3 ca lỗi
 *   NOT_FOUND / CODE_MISMATCH / CARRIER_MISMATCH (xem classifyVerify)
 *   → COMPLETED. KHÔNG bao giờ ghi "MISMATCH" nữa (giá trị legacy, chỉ đọc từ job cũ).
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
      const found = map.get(o.order_id)?.[0];
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
        // Đơn không add được / không chọn: giữ SKIPPED, không đưa vào 4 ca lỗi verify
        // (chúng chỉ nói về đơn ĐÃ add xong nhưng xác minh không đạt).
        if (o.verify === "PENDING") o.verify = "SKIPPED";
        continue;
      }
      const outcome = classifyVerify(o, map.get(o.order_id) ?? []);
      o.verify = outcome.verify;
      // Ghi đè/xoá hẳn message + verified cũ: verify có thể chạy lại (extension gửi
      // kết quả lần 2), để sót dữ liệu lần trước là nói dối người vận hành.
      if (outcome.message) o.message = outcome.message;
      else delete o.message;
      if (outcome.verified) o.verified = outcome.verified;
      else delete o.verified;
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
