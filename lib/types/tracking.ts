import type { ObjectId } from "mongodb";

/**
 * Tracking add lên Etsy qua extension (Ably). Một job = 1 shop + N đơn.
 * Luồng: PRECHECK (fetch-shipments) → AWAIT_CONFIRM → ADDING (send-tracking)
 * → VERIFY (fetch-shipments lần 2) → COMPLETED.
 */

export type TrackingPhase =
  | "PRECHECK"
  | "AWAIT_CONFIRM"
  | "ADDING"
  | "VERIFY"
  | "COMPLETED";

export type PrecheckState = "PENDING" | "CLEAR" | "EXISTS";
export type AddStatus = "NEW" | "SENDING" | "DONE" | "FAILED";
export type VerifyState = "PENDING" | "VERIFIED" | "MISMATCH" | "SKIPPED";

export interface TrackingValue {
  code: string;
  carrier_name: string;
}

export interface TrackingJobOrder {
  order_id: string;
  tracking_number: string;
  /** Etsy carrier id (-1 nếu dùng other_carrier). */
  carrier: number;
  other_carrier: string;
  precheck: PrecheckState;
  /** Tracking đã tồn tại trên Etsy lúc pre-check (khi precheck = EXISTS). */
  existing?: TrackingValue;
  /** Người dùng đã chọn đơn này để add (đơn EXISTS cần tick để override). */
  selected: boolean;
  add_status: AddStatus;
  verify: VerifyState;
  /** Tracking thực tế lấy lại sau khi add (bước verify). */
  verified?: TrackingValue;
  message?: string;
}

export interface TrackingJob {
  _id: ObjectId;
  shop_name: string;
  shop_id: number | null;
  /** clientId của browser extension được nhắm tới (presence). */
  client_id: string;
  sender_email: string;
  phase: TrackingPhase;
  orders: TrackingJobOrder[];
  /** Lỗi từ extension khi GET shipments (vd shop_id sai). Set thì FE báo lỗi, không coi là CLEAR. */
  error?: string;
  created_at: Date;
  updated_at: Date;
}

/* ---- Lịch sử add tracking (trang /tracking → tab "Lịch sử") ----
 *
 * Contract CHUNG cho luồng list lịch sử job. Cả 4 tầng dùng chung các type dưới:
 *   service (tracking.ts) trả `TrackingHistoryResponse`
 *     → route GET /api/tracking/jobs `json()` nguyên shape đó
 *       → hook useTrackingHistory cast `as TrackingHistoryResponse`
 *         → component History đọc `items[].` + phân trang.
 * Xem chi tiết 1 lượt: KHÔNG có trong list — bấm vào item gọi lại
 * GET /api/tracking/jobs/[id] (đã có) → `SerializedJob`.
 */

/**
 * Tóm tắt kết quả 1 job để hiển thị ở dòng lịch sử (không kèm mảng orders dài).
 * Tất cả tính trên các đơn đã gửi add (selected = true), khớp logic summary của JobCard.
 */
export interface TrackingJobCounts {
  /** Tổng số đơn trong job (orders.length) — hiển thị "N đơn". */
  total: number;
  /** Số đơn đã chọn để add (selected = true). */
  selected: number;
  /** verify === "VERIFIED". */
  verified: number;
  /** verify === "MISMATCH". */
  mismatch: number;
  /** add_status === "FAILED". */
  failed: number;
  /** verify === "SKIPPED" và add_status !== "FAILED" (bỏ qua xác minh). */
  skipped: number;
}

/**
 * 1 dòng lịch sử: bản tóm tắt 1 TrackingJob (KHÔNG kèm orders).
 * created_at/updated_at là ISO string (đã qua JSON ở ranh giới API↔hook).
 */
export interface TrackingHistoryItem {
  /** _id.toHexString() — dùng làm key list + param GET /api/tracking/jobs/[id]. */
  id: string;
  shop_name: string;
  shop_id: number | null;
  sender_email: string;
  phase: TrackingPhase;
  /** Lỗi PRECHECK/VERIFY nếu có (job dừng sớm) → hiển thị badge "Lỗi". */
  error?: string;
  counts: TrackingJobCounts;
  /** ISO 8601 (Date.toISOString()). */
  created_at: string;
  updated_at: string;
}

/** Query params đọc từ URL của GET /api/tracking/jobs (list lịch sử). */
export interface TrackingHistoryQuery {
  /** Search khớp order_id HOẶC tracking_number trong orders[]. Rỗng = không lọc. */
  q: string;
  /** Lọc theo shop_name (khớp chính xác). Rỗng = tất cả shop. */
  shop: string;
  /** Trang 1-based. */
  page: number;
  /** Số item / trang. */
  limit: number;
}

/** Phản hồi GET /api/tracking/jobs (phân trang offset/page, sort created_at desc). */
export interface TrackingHistoryResponse {
  items: TrackingHistoryItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Input mỗi dòng từ UI trước khi map carrier. */
export interface TrackingOrderInput {
  order_id: string;
  tracking_number: string;
  /** Tên carrier người dùng nhập (vd "Royal Mail"). */
  carrier: string;
}

/** Shipment đã normalize do extension trả về (snake_case). */
export interface ShipmentResultItem {
  order_id: string;
  tracking_code: string;
  carrier_name: string;
  tracking_url?: string;
  is_shipped?: boolean;
  is_delivered?: boolean;
}

/**
 * Tên bảng id CŨ (đã bỏ hẳn — id tự đoán, sai với Etsy: vd 6 tưởng Australia Post
 * nhưng Etsy hiểu là Canada Post; 5 bị Etsy nuốt mất tracking).
 * Chỉ để HIỂN THỊ đơn lịch sử đã lưu các id này = tên NGƯỜI DÙNG ĐÃ NHẬP lúc đó.
 */
const LEGACY_CARRIER_NAMES: Record<number, string> = {
  1: "USPS",
  2: "FedEx",
  3: "UPS",
  4: "DHL",
  5: "Canada Post",
  6: "Australia Post",
  7: "Royal Mail",
  8: "Deutsche Post",
  9: "La Poste",
  10: "Japan Post",
};

/** Tên carrier để hiển thị: -1 → other_carrier; id cũ trong lịch sử → tên đã nhập lúc đó. */
export function carrierLabel(carrier: number, other_carrier: string): string {
  if (carrier === -1) return other_carrier.trim();
  return LEGACY_CARRIER_NAMES[carrier] ?? other_carrier.trim();
}

/**
 * KHÔNG map tên → id nữa: Etsy nhận nguyên văn tên người dùng nhập qua
 * other_carrier (carrier = -1). Đảm bảo cái gì nhập vào là cái đó lên Etsy.
 */
export function resolveCarrier(input: string): { carrier: number; other_carrier: string } {
  return { carrier: -1, other_carrier: input.trim() };
}
