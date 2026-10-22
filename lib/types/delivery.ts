/**
 * Màn "Giao hàng" (/delivery) — tracking chung Mera ↔ dora-1.
 *
 * Nguồn sự thật duy nhất là Mera (`shipment_trackings`, fulfill backend). dora-1:
 *   (1) ĐẨY mã từ Google Sheet sang Mera (`POST /api/v2/delivery-trackings/external-refs`);
 *   (2) PROXY màn tracking của Mera qua `app/api/delivery/*` (meraFetch, internal key = thấy mọi project).
 *
 * Phần A mirror NGUYÊN VĂN shape JSON của Mera (snake_case, bám `mera-fulfill-frontend/src/types/deliveryTracking.ts`)
 * để route chỉ chuyển tiếp, không map field. Phần B là DTO riêng của dora-1 (camelCase). Phần C là hợp đồng push.
 * Plan: D:\Pamo\Mera\_workspace\delivery-tracking\04_dora_shared_plan.md — contract dora-1: _workspace/01_architect_contract.md.
 */

// =====================================================================================
// A. Shape Mera (pass-through)
// =====================================================================================

/** Đánh giá sao Etsy của 1 item (mirror `mera-shared/frontend/etsy-review/types.ts`). */
export interface EtsyReview {
  /** 1–5; 0 nếu Etsy không trả số. */
  rating: number;
  /** "" = khách chỉ chấm sao. */
  message: string;
  image_url: string;
  url: string;
  review_created_at: string | null;
  fetched_at: string;
  transaction_id: string;
}

/** Trạng thái giao đã chuẩn hoá (Mera derive). */
export type DeliveryStatus =
  | "pre_shipment"
  | "transit"
  | "out_for_delivery"
  | "delivered"
  | "exception"
  | "not_found"
  | "not_on_etsy"
  | "expired"
  | "querying";

export interface DeliveryEvent {
  /** RFC3339. */
  time: string;
  desc: string;
  location?: string;
}

export interface DeliveryTrackingOrderItem {
  /** Mera: item key Mera. Dora: Item ID sheet (`DAV-3857326378-4818293405`). */
  item_key: string;
  product_name: string;
  /** Mera: Bên in; Dora: cột "Bên in" (đã làm sạch). */
  latest_provider?: string;
  /** Mera: status item Mera; Dora: Status dòng sheet lúc push. */
  status?: string;
  /** null = chưa có / chưa đọc. Ref Dora luôn null ở v1 (review lưu theo item_key Mera). */
  review: EtsyReview | null;
}

/** Nguồn của 1 đơn trên mã: sync Mera hay push từ sheet dora-1. Vắng (BE cũ) = "mera". */
export type DeliveryOrderSource = "mera" | "dora_sheet";

export interface DeliveryTrackingOrder {
  order_id: string;
  store: string;
  /** Hex project Mera; đơn Dora = "dora". */
  project_id?: string;
  etsy_receipt_id?: string;
  reship_root?: string;
  ship_group?: string;
  paid_at?: string | null;
  /** false = Etsy không có mã này trên receipt; null = receipt chưa đọc lần nào. */
  on_etsy: boolean | null;
  /** MỚI (plan §5). Vắng = "mera". */
  source?: DeliveryOrderSource;
  items: DeliveryTrackingOrderItem[];
  /**
   * Request reviews (plan request-reviews §5): bản ghi sổ `review_requests` của đơn này.
   * null = chưa từng xin review; vắng = Mera BE cũ (coi như null). Badge cột Status đọc field này.
   */
  review_request?: DeliveryOrderReviewRequest | null;
}

export interface DeliveryTracking {
  id: string;
  code: string;
  carrier: string;
  tracking_url?: string;
  status: DeliveryStatus;
  /** majorTrackingState gốc của Etsy. */
  major_state?: string;
  latest_event?: DeliveryEvent | null;
  transit_days?: number | null;
  paid_at?: string | null;
  mailing_date?: string | null;
  delivered_at?: string | null;
  /** Route dora-1 bảo đảm luôn là mảng. */
  orders: DeliveryTrackingOrder[];
  last_checked_at?: string | null;
  next_check_at?: string | null;
  last_error?: string;
  last_error_at?: string | null;
  check_count?: number;
}

/** Kết quả đọc đánh giá kèm nút làm mới (chỉ khi mã delivered). */
export interface DeliveryReviewCheck {
  receipts: number;
  item_reviews: number;
  error: string;
}

/** GET detail / POST refresh (Mera trả thẳng doc; route dora-1 bóc `{tracking}` nếu có). */
export interface DeliveryTrackingDetail extends DeliveryTracking {
  /** Mới → cũ, ≤100. Route dora-1 bảo đảm luôn là mảng. */
  events: DeliveryEvent[];
  /** Chỉ có trong response refresh: null = mã chưa delivered nên không đọc review. */
  review_check?: DeliveryReviewCheck | null;
  review_error?: string;
  flags?: {
    is_shipped: boolean;
    is_in_transit: boolean;
    is_out_for_delivery: boolean;
    is_delivered: boolean;
    should_have_events: boolean;
    is_etsy_only_tracking: boolean;
    /** false = extension cũ (chỉ is_shipped/is_delivered đáng tin). */
    detailed: boolean;
  };
  mera_carrier?: string;
  status_changed_at?: string | null;
  first_event_at?: string | null;
  error_count?: number;
  hidden?: boolean;
  created_at?: string;
  updated_at?: string;
}

/** Tab "Đã giao · chưa đánh giá" → `status=delivered&review=none&sort=delivered_desc`. */
export type DeliveredNoReviewTab = "delivered_no_review";
/** Tab "Đã giao · có đánh giá" → `status=delivered&review=any&sort=delivered_desc`. */
export type DeliveredReviewedTab = "delivered_reviewed";
/** '' = All. */
export type TrackingTab = "" | DeliveryStatus | DeliveredNoReviewTab | DeliveredReviewedTab;

export type ReviewStars = 1 | 2 | 3 | 4 | 5;
export type DeliveredRatingCountKey = `delivered_rating_${ReviewStars}`;

/** Đếm theo tab — bỏ qua status & review, giữ project/q/shop/fulfill/ngày. */
export type DeliveryStatusCounts = Record<
  "all" | DeliveryStatus | DeliveredNoReviewTab | DeliveredRatingCountKey,
  number
>;

export interface DeliveryStoreCount {
  store: string;
  count: number;
}

export interface DeliveryProviderCount {
  provider: string;
  count: number;
}

/** GET /api/delivery — route dora-1 bảo đảm: items[].orders là mảng, counts là object, stores/providers là mảng. */
export interface DeliveryTrackingListResponse {
  items: DeliveryTracking[];
  total: number;
  page: number;
  limit: number;
  /** Key thiếu → coi là 0. */
  counts: Partial<DeliveryStatusCounts>;
  /** Shop trong phạm vi project đang xem (bỏ qua status/q/ngày/shop). */
  stores: DeliveryStoreCount[];
  /** Bên fulfill trong phạm vi project. */
  providers: DeliveryProviderCount[];
}

/** "requested" (plan §14) = ngày xin review (`sent_at` sổ ghi); Mera ngầm review_request=sent nếu không lọc. */
export type DeliveryDateField = "paid" | "ship" | "requested";
export type DeliveryReviewFilter = "none" | "any";
/**
 * Lọc "Xin review" (plan §14), xét theo đơn trong phạm vi đang xem: sent = có đơn đã gửi; pending = có đơn
 * queued|checking|sending; failed = có đơn failed (gồm unconfirmed); none = không đơn nào đã gửi / đang chờ.
 */
export type DeliveryReviewRequestFilter = "sent" | "none" | "pending" | "failed";
export type DeliveryTrackingSort = "delivered_desc";

/**
 * Tham số list phía FE (camelCase) — `buildDeliveryTrackingQuery` (lib/delivery/deliveryTracking.ts)
 * chuyển thành query Mera (snake_case). Route /api/delivery nhận ĐÚNG query string Mera đó.
 */
export interface DeliveryTrackingListParams {
  /** '' = mọi project (gồm Dora); hex | DORA_PROJECT_ID | `dora:<store>`. */
  projectId?: string;
  status?: DeliveryStatus | "";
  q?: string;
  store?: string;
  provider?: string;
  dateField?: DeliveryDateField;
  /** YYYY-MM-DD (ngày VN). */
  from?: string;
  to?: string;
  review?: DeliveryReviewFilter | "";
  rating?: ReviewStars | null;
  /** Query `review_request`; ""/vắng = không lọc. Giá trị lạ → Mera 400 invalid_review_request. */
  reviewRequest?: DeliveryReviewRequestFilter | "";
  sort?: DeliveryTrackingSort | "";
  page?: number;
  limit?: number;
}

/** Tiến độ 1 shop của lượt làm mới hàng loạt. */
export interface BulkRefreshShop {
  shop: string;
  codes: number;
  receipts: number;
  phase: "queued" | "shipments" | "reviews" | "done" | "failed";
  updated: number;
  failed: number;
  review_receipts: number;
  reviews_read: number;
  item_reviews: number;
  error: string;
  review_error: string;
}

/** POST /api/delivery/bulk-refresh (202) và GET /api/delivery/bulk-refresh/[job] (200). */
export interface BulkRefreshJob {
  id: string;
  created_by: string;
  done: boolean;
  codes: number;
  no_receipt: string[];
  shops: BulkRefreshShop[];
  started_at: string;
  finished_at: string | null;
}

export interface BulkRefreshRequest {
  ids: string[];
}

// =====================================================================================
// B. DTO riêng dora-1
// =====================================================================================

/** Project ảo Dora trên Mera (plan §5). `dora:<store>` = một shop Dora. */
export const DORA_PROJECT_ID = "dora";
export const DORA_SHOP_PROJECT_PREFIX = "dora:";

export function doraShopProjectId(store: string): string {
  return `${DORA_SHOP_PROJECT_PREFIX}${store}`;
}

/** "dora" | "dora:<store>". */
export function isDoraProjectId(projectId: string): boolean {
  return projectId === DORA_PROJECT_ID || projectId.startsWith(DORA_SHOP_PROJECT_PREFIX);
}

export interface DeliveryProject {
  /** ObjectID hex của project Mera. */
  id: string;
  name: string;
}

/**
 * GET /api/delivery/projects — nguyên liệu dựng select Project:
 * "Tất cả" ('') · từng `projects[]` · "Dora" (DORA_PROJECT_ID) · "Dora - {store}" (doraShopProjectId).
 */
export interface DeliveryProjectsResponse {
  /** Mera `GET /api/v1/projects` (internal key = mọi project), chỉ giữ {id,name}, sort theo name. */
  projects: DeliveryProject[];
  /**
   * Mera `GET /api/v2/delivery-trackings/dora-shops`, sort theo store.
   * null = Mera chưa hỗ trợ Dora (endpoint lỗi / chưa deploy) → FE ẩn option Dora.
   */
  doraShops: DeliveryStoreCount[] | null;
}

/**
 * Body lỗi của mọi route /api/delivery/*. Lỗi Mera được chuyển tiếp NGUYÊN body (gồm field phụ);
 * lỗi hạ tầng dora-1 dùng code riêng (mera_unavailable / mera_not_configured / mera_auth_failed / mera_bad_response).
 */
export interface DeliveryApiErrorBody {
  /** Câu tiếng Việt hiển thị được. */
  error: string;
  code?: string;
  /** shop_offline / shop_busy / etsy_read_failed / shop_blocked_env / too_many_per_shop / shop_bulk_running. */
  shop?: string;
  /** too_soon. */
  retry_after?: number;
  /** shop_offline. */
  detail?: string;
  /** forbidden_project (bulk). */
  codes?: string[];
  /** too_many_per_shop. */
  count?: number;
  limit?: number;
  /**
   * invalid_template (POST/PUT review-requests/templates) / invalid_message (send): token biến không hợp lệ,
   * vd "{name}", theo thứ tự xuất hiện; [] khi lỗi chỉ do độ dài.
   */
  unknown_vars?: string[];
}

// =====================================================================================
// C. Hợp đồng push dora-1 → Mera (plan §4) — dùng bởi lib/services/delivery-push.ts
// =====================================================================================

export const DELIVERY_PUSH_SOURCE = "dora_sheet";
export const DELIVERY_PUSH_ACTOR = "dora-1-system";
export const DELIVERY_PUSH_CHUNK_SIZE = 1000;
export const DELIVERY_PUSH_WINDOW_DAYS = 60;

/** 1 dòng sheet_rows có Tracking (mọi Status). */
export interface DeliveryPushRow {
  /** SheetRowDoc.itemId. */
  item_id: string;
  /** SheetRowDoc.order (prefix-receipt); rỗng → itemId bỏ đoạn "-<tx>" cuối. */
  order_id: string;
  /** SheetRowDoc.receiptKey. */
  etsy_receipt_id: string;
  store: string;
  /** values["Tracking"].trim() (Mera tự chuẩn hoá UPPER/bỏ khoảng trắng). */
  code: string;
  /** evaluateCarrierRules(code, rules)?.carrier ?? "". */
  carrier: string;
  /** values["Status"].trim().toUpperCase(). */
  sheet_status: string;
  /** values["Product Name"].trim(). */
  product_name: string;
  /** values["Bên in"].trim(); số thuần (vd "21.5", "3") → "". */
  provider: string;
  /** Date ("YYYY-MM-DD") + Time ("H:mm:ss", thiếu → 00:00:00) → "YYYY-MM-DDTHH:mm:ss+07:00"; không parse được → null. */
  paid_at: string | null;
}

export interface DeliveryPushRequest {
  source: typeof DELIVERY_PUSH_SOURCE;
  /** sheet_config._id (hex). */
  scope: string;
  /** crypto.randomUUID(), một giá trị cho mọi chunk của 1 snapshot. */
  snapshot_id: string;
  /** 1-based. */
  chunk: number;
  /** ≥ 1 (snapshot rỗng = 1 chunk rows: []). */
  chunk_total: number;
  /** 00:00 giờ VN của (hôm nay VN − 60 ngày), dạng "YYYY-MM-DDT00:00:00+07:00"; mọi chunk cùng giá trị. */
  window_from: string;
  /** ≤ DELIVERY_PUSH_CHUNK_SIZE. */
  rows: DeliveryPushRow[];
}

/** 202 — chunk chưa đủ. */
export interface DeliveryPushChunkAccepted {
  snapshot_id: string;
  received: number;
  chunk_total: number;
  done: false;
  /**
   * Chỉ ở chunk CUỐI: Mera đang áp dụng chính snapshot này (lượt gửi trước bị timeout/ngắt) —
   * gửi lại NGUYÊN body chunk cuối sau ít giây để nhận kết quả đã lưu.
   */
  applying?: true;
}

export interface DeliveryPushApplied {
  rows: number;
  upserted_refs: number;
  removed_refs: number;
  new_codes: number;
  skipped_mera_shop: number;
  skipped_invalid: number;
}

/** 200 — chunk cuối, snapshot đã áp dụng. */
export interface DeliveryPushDone {
  snapshot_id: string;
  done: true;
  applied: DeliveryPushApplied;
}

export type DeliveryPushOutcome =
  | "pushed"
  | "skipped_unchanged"
  | "skipped_locked"
  | "disabled"
  | "superseded"
  | "failed";

/** Kết quả push 1 sheet_config (service trả về, cron route liệt kê). */
export interface DeliveryPushResult {
  configId: string;
  title: string;
  outcome: DeliveryPushOutcome;
  /** Số dòng trong snapshot (0 khi skipped/disabled). */
  rows: number;
  chunks: number;
  applied: DeliveryPushApplied | null;
  /** outcome = failed/superseded: "<httpStatus> <code>: <message>". */
  error: string | null;
}

/** GET /api/cron/delivery-push. */
export interface DeliveryPushCronResponse {
  ok: true;
  results: DeliveryPushResult[];
}

// =====================================================================================
// D. Request reviews (plan D:\Pamo\Mera\_workspace\request-reviews\01_plan.md §3–§5, §8)
//    Mirror NGUYÊN VĂN JSON Mera `/api/v2/review-requests/*` (snake_case). Proxy dora-1:
//    `app/api/delivery/review-requests/*` (contract _workspace/01 §3). project_id = hex | "dora"
//    (UI dora-1: "dora" và "dora:<store>" đều → "dora"; "Tất cả" phải chọn project trước).
// =====================================================================================

/** Trạng thái 1 doc sổ `review_requests`. `checking` = đang chờ extension đọc lại hội thoại từ Etsy. */
export type ReviewRequestStatus = "checking" | "queued" | "sending" | "sent" | "failed" | "skipped";
export type ReviewRequestMode = "auto" | "manual";

/** Lý do bỏ qua (skip_reason của sổ ghi / khoá đếm trong preview/run). */
export type ReviewRequestSkipReason =
  | "has_conversation"
  | "reviewed"
  | "already_requested"
  | "conversation_unknown"
  | "shop_offline";

/** `orders[].review_request` trên list/detail delivery-tracking (badge dòng). */
export interface DeliveryOrderReviewRequest {
  status: ReviewRequestStatus;
  mode: ReviewRequestMode;
  /** RFC3339; null khi chưa gửi xong. */
  sent_at: string | null;
  /** "" khi không lỗi. */
  error: string;
  /** Chỉ có nghĩa khi status = "skipped"; vắng/"" ở trạng thái khác (rollout lag: có thể vắng hẳn). */
  skip_reason?: ReviewRequestSkipReason | "";
  /**
   * Chỉ có (true) khi status = "failed" mà không rõ kết quả (Mera "unconfirmed"/"interrupted": dora-1 chưa
   * báo DONE/FAILED) — buyer có thể ĐÃ nhận tin. Vắng = false. Badge "Chưa xác nhận" thay "Gửi lỗi".
   */
  unconfirmed?: boolean;
}

/** Biến mẫu tin mặc định — FE dùng khi `variables` Mera trả rỗng. Dạng có ngoặc nhọn. */
export const REVIEW_REQUEST_VARIABLES = ["{buyer_name}", "{order_id}", "{shop_name}"] as const;
export const REVIEW_REQUEST_TEMPLATE_MAX = 2000;
export const REVIEW_REQUEST_MAX_DAYS_MIN = 1;
export const REVIEW_REQUEST_MAX_DAYS_MAX = 30;
export const REVIEW_REQUEST_MAX_DAYS_DEFAULT = 7;

/**
 * GET/PUT /api/delivery/review-requests/settings. Từ §11 (nhiều mẫu tin) settings CHỈ còn `max_days` theo
 * project / Dora — mẫu tin chuyển sang thư viện chung (`/templates`).
 */
export interface ReviewRequestSettings {
  /** hex | "dora". */
  project_id: string;
  /**
   * @deprecated §11: mẫu tin nằm ở thư viện (`ReviewRequestTemplate`). Chỉ có khi Mera bản cũ còn trả
   * (rollout lag) — route dora-1 giữ field khi là chuỗi, vắng thì bỏ hẳn. FE KHÔNG dùng cho luồng mới.
   */
  template?: string;
  /** 1–30. Cửa sổ ứng viên = đơn giao trong max_days ngày gần nhất. */
  max_days: number;
  /** true = chưa có doc cài đặt, đang dùng mặc định. */
  is_default: boolean;
  /** @deprecated §11 — như `template` (mẫu mặc định nay là item `id: "default"` của thư viện). */
  default_template?: string;
  /** Token biến, vd "{buyer_name}". Route dora-1 bảo đảm là mảng (rỗng → FE dùng REVIEW_REQUEST_VARIABLES). */
  variables: string[];
  /** "" khi is_default. */
  updated_by: string;
  updated_at: string | null;
}

/** PUT body. */
export interface ReviewRequestSettingsUpdate {
  project_id: string;
  max_days: number;
  /**
   * @deprecated §11 — Mera mới bỏ qua. Route dora-1 chỉ chuyển tiếp khi client gửi chuỗi (giữ tương thích
   * Mera bản cũ: ở đó template "" = về mẫu mặc định). FE mới KHÔNG gửi.
   */
  template?: string;
}

/** Body chung của preview / run (chỉ project). @deprecated §11 — dùng ReviewRequestPreviewRequest / ReviewRequestRunRequest. */
export interface ReviewRequestProjectBody {
  project_id: string;
}

// --- §11 Thư viện mẫu tin (dùng chung toàn hệ thống: mọi project + Dora) ---

/** Id ảo của mẫu mặc định hệ thống (§3.1) — luôn có, đứng đầu danh sách, không sửa/xoá. */
export const REVIEW_REQUEST_DEFAULT_TEMPLATE_ID = "default";
export const REVIEW_REQUEST_TEMPLATE_TITLE_MAX = 100;

/** 1 mẫu trong thư viện. Route dora-1 bảo đảm đủ key (chuỗi vắng → "", updated_at vắng → null). */
export interface ReviewRequestTemplate {
  /** ObjectId hex, hoặc "default" cho mẫu hệ thống. */
  id: string;
  /** ≤ REVIEW_REQUEST_TEMPLATE_TITLE_MAX; duy nhất không phân biệt hoa thường (Mera kiểm). */
  title: string;
  /** ≤ REVIEW_REQUEST_TEMPLATE_MAX; chỉ được chứa biến REVIEW_REQUEST_VARIABLES (Mera kiểm, B5). */
  content: string;
  /**
   * true = mẫu hệ thống (`default`): không xoá được (403 system_template), tiêu đề cố định; từ §15 nội dung
   * SỬA ĐƯỢC (xem `editable`).
   */
  is_system: boolean;
  /** §15: true = mẫu `default` đang dùng bản sửa (khác nội dung gốc) → FE hiện "Khôi phục mẫu gốc". Vắng → false. */
  customized: boolean;
  /** §15: sửa được nội dung (Mera trả true cho mọi mẫu, kể cả `default`). Mera cũ không trả → `!is_system`. */
  editable: boolean;
  /** Email; "" với mẫu hệ thống / Mera không trả. */
  created_by: string;
  updated_by: string;
  /** RFC3339; null với mẫu hệ thống / Mera không trả. */
  updated_at: string | null;
}

/** GET /api/delivery/review-requests/templates. Route dora-1 bảo đảm items/variables là mảng. */
export interface ReviewRequestTemplatesResponse {
  /** Thứ tự giữ nguyên Mera (`default` đứng đầu). Item không có id bị route bỏ (không chọn/sửa được). */
  items: ReviewRequestTemplate[];
  /** Như ReviewRequestSettings.variables — rỗng → FE dùng REVIEW_REQUEST_VARIABLES. */
  variables: string[];
}

/**
 * Body POST /templates (tạo) và PUT /templates/:id (sửa). dora-1 chỉ kiểm KIỂU (chuỗi); Mera kiểm giá trị:
 * 400 invalid_title | invalid_template (+unknown_vars) | duplicate_title, 403 system_template, 404 template_not_found.
 */
export interface ReviewRequestTemplateInput {
  title: string;
  content: string;
}

/**
 * Body PUT /templates/:id. `title` bắt buộc với mẫu thường (route dora-1 kiểm); với id "default" (§15) tiêu đề
 * cố định ⇒ `title` tuỳ chọn (Mera bỏ qua / đòi bằng "Mẫu mặc định"). ReviewRequestTemplateInput gán được vào đây.
 */
export interface ReviewRequestTemplateUpdate {
  content: string;
  title?: string;
}

/** DELETE /api/delivery/review-requests/templates/:id → 200. */
export interface ReviewRequestTemplateDeleteResult {
  ok: true;
}

/** POST /api/delivery/review-requests/preview body. */
export interface ReviewRequestPreviewRequest {
  project_id: string;
  /** Vắng / "" (sau trim) = Mera dùng mẫu mặc định. Route dora-1 bỏ field khi rỗng. */
  template_id?: string;
}

/** POST /api/delivery/review-requests/run body. */
export interface ReviewRequestRunRequest {
  project_id: string;
  /**
   * BẮT BUỘC (§11 T2: chọn mẫu lúc chạy). Thiếu / "" → dora-1 trả 400 template_required; id không tồn tại
   * → Mera 404 template_not_found (dora-1 không kiểm tồn tại).
   */
  template_id: string;
}

/**
 * Đếm đơn bị loại (preview/run), theo lý do. Route dora-1 GIỮ MỌI key số Mera trả (Mera có thể thêm
 * lý do mới trước khi dora-1 kịp cập nhật — FE render key > 0, key lạ hiện nguyên tên) và bảo đảm 3
 * key gốc luôn có (thiếu → 0). Key đã biết khác: vắng = 0.
 */
export interface ReviewRequestSkippedCounts {
  has_conversation: number;
  reviewed: number;
  already_requested: number;
  /** Shop không được phép gửi ở môi trường này (DORA_SEND_SHOP_PREFIX, vd dev chỉ ZZTEST-). */
  send_blocked_env?: number;
  shop_offline?: number;
  conversation_unknown?: number;
  manual_failed?: number;
  [reason: string]: number | undefined;
}

/**
 * 1 đơn mẫu trong preview (≤20). Route dora-1 bảo đảm đủ key: chuỗi vắng → "", delivered_at /
 * has_conversation vắng → null.
 */
export interface ReviewRequestPreviewSample {
  order_id: string;
  etsy_receipt_id: string;
  /** hex | "dora" — project của đơn. */
  project_id: string;
  /** DeliveryTracking.id. */
  tracking_id: string;
  shop_name: string;
  store: string;
  tracking_code: string;
  /** RFC3339; null khi Mera không trả. */
  delivered_at: string | null;
  /**
   * Kết quả resolver hội thoại: false = chưa thấy hội thoại → sẽ nhờ extension kiểm lại trước khi gửi
   * (tính vào will_check_conversation); null = chưa xác định.
   */
  has_conversation: boolean | null;
}

/** POST /api/delivery/review-requests/preview. */
export interface ReviewRequestPreview {
  /** Mẫu Mera đã dùng để xem trước (§11). "" khi Mera bản cũ không trả. */
  template_id: string;
  /** Số đơn sẽ được xếp hàng (sau khi trừ skipped). */
  candidates: number;
  /** Trong candidates: số đơn cần kiểm lại hội thoại từ Etsy trước khi gửi. */
  will_check_conversation: number;
  skipped: ReviewRequestSkippedCounts;
  /**
   * §14: TOÀN BỘ ứng viên (delivered_at mới → cũ), Mera cắt an toàn ở 5000. Route dora-1 bảo đảm là mảng.
   * (Tên "sample" giữ nguyên từ API cũ ≤20.)
   */
  sample: ReviewRequestPreviewSample[];
  /** true = Mera đã cắt `sample` ở giới hạn 5000 (< candidates). Vắng (Mera cũ) → false. */
  sample_truncated: boolean;
}

/** POST /api/delivery/review-requests/run — ghi hàng đợi, KHÔNG chờ gửi xong. */
export interface ReviewRequestRunResult {
  /** Đơn nhận vào hàng đợi (mọi đơn bắt đầu ở "checking": đọc lại hội thoại trước khi gửi). */
  queued: number;
  /** Trong queued: số đơn đang chờ đọc lại hội thoại. Vắng → 0. */
  checking: number;
  skipped: ReviewRequestSkippedCounts;
}

/** POST /api/delivery/review-requests/send body. */
export interface ReviewRequestSendRequest {
  /** DeliveryTracking.id; ≤ BULK_MAX_PER_SHOP mã / shop (Mera kiểm lại). */
  ids: string[];
  /**
   * Nội dung soạn tay (đã sửa từ mẫu). Khác rỗng ⇒ Mera dùng message; vắng / "" (sau trim) ⇒ dùng
   * `template_id`. Route dora-1 bỏ field khi rỗng.
   */
  message?: string;
  /**
   * §11: mẫu đang chọn trong dropdown. Vắng cả message lẫn template_id ⇒ Mera dùng "default". Gửi kèm cả
   * khi có message để Mera lưu mẫu gốc (+ edited). Route dora-1 bỏ field khi "" (sau trim).
   */
  template_id?: string;
  /**
   * §13: order_id (như `orders[].order_id`) người dùng bỏ tích trong "Đơn sẽ gửi" — Mera không xếp hàng,
   * không ghi sổ, trả trong `skipped[]` với reason "excluded". Route dora-1 bỏ field khi mảng rỗng.
   */
  exclude_order_ids?: string[];
  /**
   * hex | "dora" — giới hạn đơn được xếp hàng vào project đang xem (mã có đơn ở nhiều project).
   * Vắng = Mera xếp hàng mọi đơn của mã. Route dora-1 chuyển tiếp nguyên, "" (sau trim) → bỏ field.
   */
  project_id?: string;
}

/** Cảnh báo (không chặn) khi gửi tay. */
export interface ReviewRequestSendWarning {
  order_id: string;
  kind: "already_requested" | "reviewed";
}

/** Đơn/mã không xếp hàng được khi gửi tay. Route dora-1 bảo đảm đủ key (chuỗi vắng → ""). */
export interface ReviewRequestSendSkipped {
  /** "" khi cả mã bị bỏ (vd không tìm thấy tracking). */
  order_id: string;
  /** DeliveryTracking.id — với reason "not_found" Mera CHỈ có field này (FE map sang code từ dòng đang chọn). */
  tracking_id: string;
  tracking_code: string;
  /** Mã lý do Mera (vd "not_found", "no_orders", "sending"); FE hiện nguyên văn nếu không biết. */
  reason: string;
}

/** POST /api/delivery/review-requests/send. Route dora-1 bảo đảm warnings/skipped là mảng. */
export interface ReviewRequestSendResult {
  queued: number;
  warnings: ReviewRequestSendWarning[];
  skipped: ReviewRequestSendSkipped[];
}

/** Route dora-1 bảo đảm đủ key (chuỗi vắng → "", at vắng → null). */
export interface ReviewRequestFailedItem {
  order_id: string;
  shop_name: string;
  error: string;
  /** RFC3339 — thời điểm lần lỗi; null khi Mera không trả. */
  at: string | null;
  /** true = lỗi "chưa xác nhận" (không rõ buyer đã nhận tin chưa). Route dora-1: chỉ giữ khi === true. */
  unconfirmed?: boolean;
}

/** GET /api/delivery/review-requests/summary?project_id=. Route dora-1 bảo đảm failed_recent là mảng. */
export interface ReviewRequestSummary {
  /** Đang chờ gửi — ĐÃ GỒM checking. */
  queued: number;
  /** Trong queued: số đơn đang chờ đọc lại hội thoại. Vắng → 0. */
  checking: number;
  sending: number;
  sent_today: number;
  failed_recent: ReviewRequestFailedItem[];
}

// --- Endpoint máy dora-1 (Mera fulfill gọi) — POST /api/machine/order-conversations/fetch ---

export const MACHINE_ORDER_CONVO_FETCH_MAX = 50;

export interface MachineOrderConvoFetchRequest {
  shopName: string;
  /** Etsy receipt id, số nguyên dương; 1..MACHINE_ORDER_CONVO_FETCH_MAX (sau khi bỏ trùng). */
  orderIds: number[];
}

/** 200. `requestedAt` = giờ server dora-1 lấy NGAY TRƯỚC publish (ISO) — Mera so với order_conversations.fetched_at. */
export interface MachineOrderConvoFetchResponse {
  ok: true;
  requestedAt: string;
}

/** 409 — không có extension online cho shop. */
export interface MachineOrderConvoFetchOffline {
  ok: false;
  error: string;
  code: "shop_offline";
}
