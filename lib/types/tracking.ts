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

/**
 * Kết quả xác minh 1 đơn sau khi add (phase VERIFY).
 *
 * VERIFIED chỉ khi shipment Etsy trả về khớp CẢ HAI: mã tracking + carrier_name
 * (so với other_carrier đã gửi). Trước đây chỉ so mã → đơn add sai carrier vẫn
 * báo "đã xác minh" trong khi Etsy hiện "No tracking".
 *
 * Verify CỐ Ý không xét `is_shipped`: verify GET chạy chỉ vài giây sau POST add,
 * không có bằng chứng Etsy kịp cập nhật `isShipped` trong khoảng đó, nên dùng nó
 * làm điều kiện đạt/không đạt có nguy cơ báo động giả hàng loạt.
 *
 * Các trạng thái lỗi được TÁCH RIÊNG để người dùng biết phải sửa gì:
 * - NOT_FOUND         : Etsy không trả shipment nào cho đơn → add không ăn.
 * - CODE_MISMATCH     : Etsy có tracking nhưng mã khác mã đã gửi.
 * - CARRIER_MISMATCH  : mã khớp nhưng carrier Etsy ghi khác tên đã gửi.
 * - MISMATCH          : LEGACY — chỉ tồn tại trong job CŨ đã lưu trong MongoDB
 *                       (lúc đó chưa tách 3 ca trên). KHÔNG ghi mới giá trị này.
 * - SKIPPED           : không add (bỏ tick) hoặc add xong nhưng không verify được.
 */
export type VerifyState =
  | "PENDING"
  | "VERIFIED"
  | "NOT_FOUND"
  | "CODE_MISMATCH"
  | "CARRIER_MISMATCH"
  | "MISMATCH"
  | "SKIPPED";

/**
 * Các VerifyState tính là "đơn có vấn đề sau khi add" (đã add nhưng không đạt
 * xác minh). Dùng chung cho đếm counts và tô màu ở UI — thêm state mới CHỈ cần
 * thêm vào đây, mọi nơi tự cập nhật.
 */
export const VERIFY_FAILURE_STATES = [
  "NOT_FOUND",
  "CODE_MISMATCH",
  "CARRIER_MISMATCH",
  "MISMATCH",
] as const satisfies readonly VerifyState[];

export type VerifyFailureState = (typeof VERIFY_FAILURE_STATES)[number];

/** Đơn đã add nhưng xác minh KHÔNG đạt (gồm cả giá trị legacy MISMATCH). */
export function isVerifyFailure(v: VerifyState): v is VerifyFailureState {
  return (VERIFY_FAILURE_STATES as readonly VerifyState[]).includes(v);
}

/** Nhãn ngắn hiển thị badge/cột trạng thái. Record đủ mọi giá trị → thêm state mới là lỗi compile. */
export const VERIFY_LABEL: Record<VerifyState, string> = {
  PENDING: "Chờ xác minh",
  VERIFIED: "Đã add & xác minh",
  NOT_FOUND: "Không thấy tracking trên Etsy",
  CODE_MISMATCH: "Mã tracking lệch",
  CARRIER_MISMATCH: "Carrier lệch",
  MISMATCH: "Lệch tracking",
  SKIPPED: "Bỏ qua",
};

/**
 * Một cặp tracking (mã + carrier) đọc được từ Etsy.
 * Dùng cho cả `existing` (pre-check) lẫn `verified` (sau khi add).
 */
export interface TrackingValue {
  code: string;
  /** Tên carrier ĐÚNG NHƯ ETSY TRẢ VỀ (để đối chiếu với other_carrier đã gửi). */
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
  /**
   * Tracking thực tế Etsy trả về sau khi add (bước verify) — nguồn đối chiếu.
   * Khi verify != VERIFIED, đây là cái Etsy ĐANG CÓ (có thể gộp nhiều mã bằng ", ").
   * Giá trị ĐÃ GỬI luôn nằm ở `tracking_number` + `other_carrier` của chính đơn này.
   */
  verified?: TrackingValue;
  /** Câu giải thích tiếng Việt cho người vận hành (nêu rõ giá trị gửi vs Etsy trả). */
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
  /** verify === "VERIFIED" (khớp cả mã + carrier). */
  verified: number;
  /**
   * Tổng số đơn đã add nhưng xác minh KHÔNG đạt = isVerifyFailure(verify).
   * Gộp cả 3 ca mới lẫn giá trị legacy "MISMATCH" của job cũ → badge "N lệch"
   * hiện có KHÔNG vỡ khi xem lại lịch sử cũ.
   */
  mismatch: number;
  /** Chi tiết của `mismatch` — verify === "NOT_FOUND". */
  not_found: number;
  /** Chi tiết của `mismatch` — verify === "CODE_MISMATCH". */
  code_mismatch: number;
  /** Chi tiết của `mismatch` — verify === "CARRIER_MISMATCH". */
  carrier_mismatch: number;
  /** add_status === "FAILED". */
  failed: number;
  /** verify === "SKIPPED" và add_status !== "FAILED" (bỏ qua xác minh). */
  skipped: number;
}

/**
 * Field tối thiểu để đếm counts. Service dùng làm projection MongoDB (không kéo
 * existing/verified/message nặng), page.tsx dùng luôn TrackingJobOrder (structural).
 */
export type TrackingOrderCountFields = Pick<
  TrackingJobOrder,
  "selected" | "verify" | "add_status"
>;

/**
 * NGUỒN DUY NHẤT tính TrackingJobCounts — hàm thuần, không đụng DB, nên CẢ HAI
 * phía dùng chung được:
 *   - backend: `summarizeJob` trong lib/services/tracking.ts (list lịch sử)
 *   - frontend: `JobCard.summary` trong app/tracking/page.tsx (job đang chạy)
 * Ràng buộc "logic phải khớp 1:1" trước đây chỉ là comment nên dễ trôi; giờ khớp
 * do dùng CHUNG hàm này. TUYỆT ĐỐI không copy lại logic đếm ở nơi khác.
 *
 * Lưu ý hiển thị: page.tsx in "Hoàn tất N đơn" với N = số đơn ĐÃ GỬI → dùng
 * `counts.selected`, KHÔNG phải `counts.total` (= orders.length).
 */
export function summarizeTrackingOrders(
  orders: readonly TrackingOrderCountFields[],
): TrackingJobCounts {
  const sent = orders.filter((o) => o.selected);
  const countVerify = (v: VerifyState) => sent.filter((o) => o.verify === v).length;
  return {
    total: orders.length,
    selected: sent.length,
    verified: countVerify("VERIFIED"),
    mismatch: sent.filter((o) => isVerifyFailure(o.verify)).length,
    not_found: countVerify("NOT_FOUND"),
    code_mismatch: countVerify("CODE_MISMATCH"),
    carrier_mismatch: countVerify("CARRIER_MISMATCH"),
    failed: sent.filter((o) => o.add_status === "FAILED").length,
    // SKIPPED nhưng không phải do FAILED (đã tách failed ở trên) → "bỏ qua xác minh".
    skipped: sent.filter((o) => o.verify === "SKIPPED" && o.add_status !== "FAILED").length,
  };
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

/**
 * Shipment đã normalize do extension trả về (snake_case).
 * SHAPE NÀY DO dora-extension QUYẾT ĐỊNH — KHÔNG được đổi từ phía dora-1.
 */
export interface ShipmentResultItem {
  order_id: string;
  /** Mã tracking Etsy đang lưu — so với TrackingJobOrder.tracking_number. */
  tracking_code: string;
  /** Tên carrier Etsy đang lưu — so với TrackingJobOrder.other_carrier. */
  carrier_name: string;
  tracking_url?: string;
  /**
   * Etsy đã đánh dấu đơn/shipment là đã ship chưa. Extension gửi lên (optional vì
   * bản cũ có thể không có). Verify CỐ Ý KHÔNG dùng field này để quyết định đạt/không
   * đạt — xem ghi chú ở VerifyState. Giữ lại vì đây là shape extension gửi.
   */
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
