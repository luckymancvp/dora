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

export type DeliveryDateField = "paid" | "ship";
export type DeliveryReviewFilter = "none" | "any";
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
