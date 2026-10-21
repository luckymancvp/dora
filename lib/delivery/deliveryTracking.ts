/**
 * Logic thuần cho màn Giao hàng (/delivery): nhãn/màu trạng thái, format thời gian,
 * query string gửi API, đọc/ghi bộ lọc trên URL, câu lỗi của nút làm mới.
 *
 * Chép từ `mera-fulfill-frontend/src/lib/deliveryTracking.ts` (contract §4.2). Khác Mera:
 *   - Không có `TRACKING_ALL_PROJECTS` / project đã nhớ: `project` '' = Tất cả (A12).
 *   - Không có `trackingOrderIds` (dora-1 không gắn icon hội thoại Dora — A10).
 *   - Hằng/hàm project Dora dùng chung `@/lib/types/delivery` (DORA_PROJECT_ID, doraShopProjectId…).
 */
import {
  DORA_PROJECT_ID,
  DORA_SHOP_PROJECT_PREFIX,
  isDoraProjectId,
} from "@/lib/types/delivery";
import type {
  DeliveredNoReviewTab,
  DeliveredRatingCountKey,
  DeliveredReviewedTab,
  DeliveryDateField,
  DeliveryStatus,
  DeliveryStatusCounts,
  DeliveryTrackingListParams,
  ReviewStars,
  TrackingTab,
} from "@/lib/types/delivery";

/** Thứ tự tab trên màn (sau tab "All"). */
export const DELIVERY_STATUSES: DeliveryStatus[] = [
  "pre_shipment",
  "transit",
  "out_for_delivery",
  "delivered",
  "exception",
  "not_found",
  "not_on_etsy",
  "expired",
  "querying",
];

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  pre_shipment: "Pre-shipment",
  transit: "Transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  exception: "Exception",
  not_found: "Not found",
  not_on_etsy: "Không có trên Etsy",
  expired: "Expired",
  querying: "Querying",
};

/** Giải thích ngắn (tooltip) cho từng trạng thái. */
export const DELIVERY_STATUS_HINTS: Record<DeliveryStatus, string> = {
  pre_shipment: "Đã tạo nhãn, hãng chưa nhận hàng",
  transit: "Đang vận chuyển",
  out_for_delivery: "Đang giao tới người nhận",
  delivered: "Đã giao",
  exception: "Có sự cố (giao thất bại, hoàn hàng, cảnh báo…)",
  not_found: "Quá 7 ngày từ ngày gửi mà hãng chưa có sự kiện nào",
  not_on_etsy: "Mã có trên Mera nhưng Etsy không có trên receipt",
  expired: "Quá 30 ngày — đã ngừng theo dõi, giữ trạng thái cuối",
  querying: "Chưa đọc được từ Etsy lần nào",
};

const BADGE_CLASSES: Record<DeliveryStatus, string> = {
  pre_shipment: "bg-slate-100 text-slate-700 border-slate-200",
  transit: "bg-blue-100 text-blue-800 border-blue-200",
  out_for_delivery: "bg-indigo-100 text-indigo-800 border-indigo-200",
  delivered: "bg-green-100 text-green-800 border-green-200",
  exception: "bg-red-100 text-red-800 border-red-200",
  not_found: "bg-amber-100 text-amber-800 border-amber-200",
  not_on_etsy: "bg-orange-100 text-orange-800 border-orange-200",
  expired: "bg-zinc-200 text-zinc-600 border-zinc-300",
  querying: "bg-purple-100 text-purple-800 border-purple-200",
};

export function isDeliveryStatus(v: unknown): v is DeliveryStatus {
  return typeof v === "string" && (DELIVERY_STATUSES as string[]).includes(v);
}

/** Tab "Đã giao · chưa đánh giá" — giá trị `?status=` trên URL và key trong `counts`. */
export const DELIVERED_NO_REVIEW: DeliveredNoReviewTab = "delivered_no_review";
export const DELIVERED_NO_REVIEW_LABEL = "Delivered · No review";
export const DELIVERED_NO_REVIEW_HINT =
  "Delivered, no item has an Etsy review yet — ask for one. Latest delivered first.";

/** Tab "Đã giao · có đánh giá" — giá trị `?status=` trên URL. */
export const DELIVERED_REVIEWED: DeliveredReviewedTab = "delivered_reviewed";
export const DELIVERED_REVIEWED_LABEL = "Delivered · Reviewed";
export const DELIVERED_REVIEWED_HINT =
  "Delivered, at least one item has an Etsy review. Latest delivered first.";

/** Số sao chọn được ở ô Review (lọc "Delivered · Reviewed" theo sao), 5 → 1. */
export const REVIEW_STAR_OPTIONS: ReviewStars[] = [5, 4, 3, 2, 1];

export function isReviewStars(v: unknown): v is ReviewStars {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;
}

/** Key `counts` của mã delivered có đánh giá N sao. */
export function deliveredRatingCountKey(stars: ReviewStars): DeliveredRatingCountKey {
  return `delivered_rating_${stars}`;
}

/** Tab hợp lệ trên URL (không gồm '' = All). */
export function isTrackingTab(v: unknown): v is Exclude<TrackingTab, ""> {
  return v === DELIVERED_NO_REVIEW || v === DELIVERED_REVIEWED || isDeliveryStatus(v);
}

/** Tab đã giao lọc theo đánh giá (cột Date hiện thêm ngày giao). */
export function isDeliveredReviewTab(tab: TrackingTab): boolean {
  return tab === DELIVERED_NO_REVIEW || tab === DELIVERED_REVIEWED;
}

/** Tab → tham số lọc gửi BE: tab chưa/có đánh giá = delivered + review=none/any + mới giao trước. */
export function trackingTabListParams(
  tab: TrackingTab,
): Pick<DeliveryTrackingListParams, "status" | "review" | "sort"> {
  if (tab === DELIVERED_NO_REVIEW) return { status: "delivered", review: "none", sort: "delivered_desc" };
  if (tab === DELIVERED_REVIEWED) return { status: "delivered", review: "any", sort: "delivered_desc" };
  return { status: tab };
}

/** Số trên tab; null = chưa có dữ liệu. "Có đánh giá" = delivered − chưa đánh giá (BE không gửi key riêng). */
export function trackingTabCount(
  counts: Partial<DeliveryStatusCounts> | undefined,
  tab: TrackingTab,
): number | null {
  if (!counts) return null;
  if (tab === DELIVERED_REVIEWED) {
    return Math.max(0, (counts.delivered ?? 0) - (counts[DELIVERED_NO_REVIEW] ?? 0));
  }
  return counts[tab === "" ? "all" : tab] ?? 0;
}

/** Nhãn hiển thị; status lạ (BE mới hơn FE) → hiện nguyên giá trị, không đoán. */
export function deliveryStatusLabel(status: string): string {
  return isDeliveryStatus(status) ? DELIVERY_STATUS_LABELS[status] : status || "—";
}

export function deliveryStatusBadgeClass(status: string): string {
  return isDeliveryStatus(status) ? BADGE_CLASSES[status] : "bg-zinc-100 text-zinc-700 border-zinc-200";
}

/** Transit time: số ngày nguyên ("6 ngày"); null/âm/NaN → "—". */
export function formatTransitDays(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days) || days < 0) return "—";
  const d = Math.floor(days);
  return `${d} ngày`;
}

/** Ngày giờ theo giờ máy, dạng dd/MM/yyyy HH:mm. Rỗng/không hợp lệ → "—". */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("vi-VN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

/** "5 phút trước" / "3 giờ trước" / "2 ngày trước" — cho last_checked_at. */
export function formatAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "chưa đọc lần nào";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const sec = Math.max(0, Math.floor((now.getTime() - t) / 1000));
  if (sec < 60) return "vừa xong";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} phút trước`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} giờ trước`;
  return `${Math.floor(h / 24)} ngày trước`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Query string cho GET /api/delivery (= query Mera, route chỉ chuyển tiếp — seam S1).
 * Bỏ field rỗng; project rỗng = mọi project (gồm Dora). `date_field` chỉ gửi khi có from/to.
 */
export function buildDeliveryTrackingQuery(p: DeliveryTrackingListParams): string {
  const qs = new URLSearchParams();
  if (p.projectId) qs.set("project_id", p.projectId);
  if (p.status) qs.set("status", p.status);
  if (p.review === "none" || p.review === "any") qs.set("review", p.review);
  if (p.review !== "none" && isReviewStars(p.rating)) qs.set("rating", String(p.rating));
  if (p.sort === "delivered_desc") qs.set("sort", p.sort);
  const q = p.q?.trim();
  if (q) qs.set("q", q);
  const store = p.store?.trim();
  if (store) qs.set("store", store);
  const provider = p.provider?.trim();
  if (provider) qs.set("provider", provider);
  const from = p.from && DATE_RE.test(p.from) ? p.from : "";
  const to = p.to && DATE_RE.test(p.to) ? p.to : "";
  if (from || to) {
    qs.set("date_field", p.dateField === "ship" ? "ship" : "paid");
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
  }
  if (p.page && p.page > 1) qs.set("page", String(p.page));
  if (p.limit) qs.set("limit", String(p.limit));
  return qs.toString();
}

export const TRACKING_PAGE_SIZES = [50, 100, 200];
export const DEFAULT_TRACKING_PAGE_SIZE = 50;

/** Nhãn hiển thị: `Dora` / `Dora - {shop}`; project khác → ''. */
export function doraProjectLabel(project: string): string {
  if (project === DORA_PROJECT_ID) return "Dora";
  if (isDoraProjectId(project) && project.length > DORA_SHOP_PROJECT_PREFIX.length) {
    return `Dora - ${project.slice(DORA_SHOP_PROJECT_PREFIX.length)}`;
  }
  return "";
}

/** Bộ lọc màn Giao hàng đọc từ URL (để reload / gửi link giữ nguyên). */
export interface TrackingUrlState {
  /** '' = Tất cả; hex = project Mera; `dora` / `dora:<store>` = project ảo Dora. */
  project: string;
  /** Tab đang chọn (`?status=`): status BE hoặc DELIVERED_NO_REVIEW/REVIEWED; '' = All. */
  status: TrackingTab;
  q: string;
  /** '' = mọi shop. */
  store: string;
  /** '' = mọi fulfill. */
  provider: string;
  /** `?rating=` — chỉ có nghĩa ở tab DELIVERED_REVIEWED (parse bỏ ở tab khác); null = mọi số sao. */
  rating: ReviewStars | null;
  dateField: DeliveryDateField;
  from: string;
  to: string;
  page: number;
  limit: number;
}

export function parseTrackingUrl(sp: URLSearchParams): TrackingUrlState {
  const status = sp.get("status") || "";
  const page = Number(sp.get("page"));
  const limit = Number(sp.get("limit"));
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const rating = Number(sp.get("rating"));
  return {
    project: sp.get("project") || "",
    status: isTrackingTab(status) ? status : "",
    rating: status === DELIVERED_REVIEWED && isReviewStars(rating) ? rating : null,
    q: sp.get("q") || "",
    store: sp.get("store") || "",
    provider: sp.get("provider") || "",
    dateField: sp.get("date_field") === "ship" ? "ship" : "paid",
    from: DATE_RE.test(from) ? from : "",
    to: DATE_RE.test(to) ? to : "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    limit: TRACKING_PAGE_SIZES.includes(limit) ? limit : DEFAULT_TRACKING_PAGE_SIZE,
  };
}

/** Ngược lại của parseTrackingUrl — chỉ ghi giá trị khác mặc định. */
export function trackingUrlSearch(s: TrackingUrlState): URLSearchParams {
  const sp = new URLSearchParams();
  if (s.project) sp.set("project", s.project);
  if (s.status) sp.set("status", s.status);
  if (s.q.trim()) sp.set("q", s.q.trim());
  if (s.store) sp.set("store", s.store);
  if (s.provider) sp.set("provider", s.provider);
  if (s.status === DELIVERED_REVIEWED && isReviewStars(s.rating)) sp.set("rating", String(s.rating));
  if (s.from || s.to) {
    if (s.dateField === "ship") sp.set("date_field", "ship");
    if (s.from) sp.set("from", s.from);
    if (s.to) sp.set("to", s.to);
  }
  if (s.page > 1) sp.set("page", String(s.page));
  if (s.limit !== DEFAULT_TRACKING_PAGE_SIZE) sp.set("limit", String(s.limit));
  return sp;
}

/** Bộ lọc URL → tham số list (bỏ page/limit nếu `withPage=false`, dùng cho export). */
export function trackingListParams(s: TrackingUrlState, withPage = true): DeliveryTrackingListParams {
  return {
    projectId: s.project,
    // Tab "Đã giao · chưa/có đánh giá" → status=delivered&review=none|any&sort=delivered_desc.
    ...trackingTabListParams(s.status),
    rating: s.rating,
    q: s.q,
    store: s.store,
    provider: s.provider,
    dateField: s.dateField,
    from: s.from,
    to: s.to,
    ...(withPage ? { page: s.page, limit: s.limit } : {}),
  };
}

/** Bên fulfill của 1 đơn trên màn: latest_provider các item, bỏ rỗng + trùng, giữ thứ tự. */
export function orderProviders(o: { items?: { latest_provider?: string | null }[] }): string[] {
  const out: string[] = [];
  for (const it of o.items ?? []) {
    const p = (it.latest_provider ?? "").trim();
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Phần đuôi toast của nút làm mới về đánh giá: '' khi không đọc review (mã chưa delivered). */
export function refreshReviewSummary(
  c: { receipts: number; item_reviews: number; error: string } | null | undefined,
): string {
  if (!c) return "";
  if (c.item_reviews > 0) return ` · ${c.item_reviews} đánh giá`;
  if (c.receipts > 0 && !c.error) return " · chưa có đánh giá";
  return "";
}

/**
 * Câu tiếng Việt cho lỗi của nút "Làm mới" một dòng.
 * `code` = field `code` của body lỗi BE (`{error, code, shop?}`); `shop` = tên shop BE trả kèm.
 */
export function refreshErrorMessage(
  status: number | undefined,
  code: string,
  fallback: string,
  shop = "",
): string {
  const s = shop ? `Shop ${shop}` : "Shop";
  if (code === "shop_offline") {
    return `${s} đang offline (không có trình duyệt nào mở extension Dora cho shop) — chưa đọc được, dữ liệu đang hiện có thể cũ.`;
  }
  if (code === "shop_busy") {
    return `${s} đang có một lần đọc Etsy khác — thử lại sau ít phút.`;
  }
  if (code === "too_soon" || status === 429) {
    return "Mã này vừa được làm mới — đợi khoảng 1 phút rồi thử lại.";
  }
  if (code === "etsy_read_failed") {
    // BE gửi sẵn câu tiếng Việt có chi tiết ("Không đọc được Etsy: …").
    return fallback || "Đọc Etsy thất bại — thử lại sau.";
  }
  if (code === "no_receipt") return "Mã này không còn đơn Etsy nào để đọc.";
  // Lỗi hạ tầng của proxy dora-1 (mera_unavailable / mera_not_configured / mera_auth_failed /
  // mera_bad_response — contract S10): route gửi sẵn câu tiếng Việt, không phải lỗi đọc Etsy.
  if (code.startsWith("mera_")) return fallback || "Không kết nối được Mera — thử lại sau.";
  if (code === "refresh_unavailable" || status === 503) {
    return "Server chưa cấu hình đọc Etsy (thiếu INTERNAL_API_KEY) — báo kỹ thuật.";
  }
  // 403 của môi trường local/dev (DELIVERY_TRACKING_SHOP_PREFIX) — không phải lỗi quyền project.
  if (code === "shop_blocked_env") {
    return fallback || `${s} không được đọc Etsy ở môi trường này (chỉ shop ZZTEST-…).`;
  }
  if (status === 502) return fallback || "Đọc Etsy thất bại — thử lại sau.";
  if (status === 403) return "Bạn không có quyền với project của mã này.";
  if (status === 404) return "Không tìm thấy mã tracking này (có thể đã bị gỡ).";
  return fallback || "Làm mới thất bại.";
}
