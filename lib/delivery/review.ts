import type { EtsyReview } from "@/lib/types/delivery";

/**
 * Helper thuần đánh giá sao Etsy — phần màn Giao hàng cần, chép từ
 * `mera-shared/frontend/etsy-review/review.ts` (bỏ cache/batch by-items: dora-1 không đọc review riêng).
 */

export const MAX_REVIEW_STARS = 5;

/** Số sao tô màu: làm tròn, kẹp 0..5; giá trị lạ (NaN/null) → 0. */
export function reviewStarCount(rating: number | null | undefined): number {
  if (rating == null || !Number.isFinite(rating)) return 0;
  return Math.min(MAX_REVIEW_STARS, Math.max(0, Math.round(rating)));
}

/** Số hiển thị cạnh sao ("5", "4.5"); không hợp lệ / 0 (Etsy không trả số) → "—". */
export function formatReviewRating(rating: number | null | undefined): string {
  if (rating == null || !Number.isFinite(rating) || rating <= 0) return "—";
  const r = Math.min(MAX_REVIEW_STARS, Math.max(0, rating));
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Ngày giờ khách đánh giá kiểu vi-VN "dd/MM/yyyy HH:mm"; rỗng / không hợp lệ → "—". */
export function formatReviewDateTime(iso: string | null | undefined): string {
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

/** Gộp khoảng trắng/xuống dòng thành 1 dòng. */
export function normalizeReviewMessage(message: string | null | undefined): string {
  return (message ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Lời nhận xét rút gọn 1 dòng: gộp khoảng trắng, cắt ở `max` ký tự (ưu tiên ranh giới từ) + "…".
 * Đếm theo code point để không cắt đôi emoji.
 */
export function shortenReviewMessage(message: string | null | undefined, max = 80): string {
  const text = normalizeReviewMessage(message);
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  let cut = chars.slice(0, max).join("");
  const space = cut.lastIndexOf(" ");
  if (space >= max * 0.6) cut = cut.slice(0, space);
  return `${cut.replace(/[\s.,;:!?-]+$/u, "")}…`;
}

/** Item có đánh giá để hiện (BE trả null khi chưa có; rating 0 vẫn là review thật). */
export function hasReview(review: EtsyReview | null | undefined): review is EtsyReview {
  return !!review;
}

export interface ItemReviewRef {
  order_id: string;
  item_key: string;
  product_name: string;
  review: EtsyReview;
}

/** Các item có đánh giá trong danh sách đơn (giữ thứ tự đơn → item). */
export function collectItemReviews(
  orders: { order_id: string; items: { item_key: string; product_name: string; review?: EtsyReview | null }[] }[],
): ItemReviewRef[] {
  const out: ItemReviewRef[] = [];
  for (const o of orders) {
    for (const it of o.items ?? []) {
      if (hasReview(it.review)) {
        out.push({ order_id: o.order_id, item_key: it.item_key, product_name: it.product_name, review: it.review });
      }
    }
  }
  return out;
}
