"use client";

import { ExternalLink, ImageIcon, Star } from "lucide-react";
import {
  MAX_REVIEW_STARS,
  formatReviewDateTime,
  formatReviewRating,
  normalizeReviewMessage,
  reviewStarCount,
  shortenReviewMessage,
} from "@/lib/delivery/review";
import type { EtsyReview } from "@/lib/types/delivery";
import { cn } from "@/lib/utils";

/*
 * Đánh giá sao Etsy — bản tối giản của Mera `components/review/ReviewStars.tsx`
 * (màn Giao hàng: cột Status + drawer). dora-1 không có Tooltip → popover hover bằng CSS.
 */

/** ★★★★☆ 4 — sao vàng theo rating 1–5. */
export function ReviewStars({
  rating,
  showNumber = true,
  size = "sm",
  className,
}: {
  rating: number | null | undefined;
  showNumber?: boolean;
  size?: "xs" | "sm";
  className?: string;
}) {
  const filled = reviewStarCount(rating);
  const icon = size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5";
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-px", className)}
      role="img"
      aria-label={`${formatReviewRating(rating)}/${MAX_REVIEW_STARS} sao`}
    >
      {Array.from({ length: MAX_REVIEW_STARS }, (_, i) => (
        <Star
          key={i}
          className={cn(
            icon,
            i < filled ? "fill-amber-400 text-amber-400" : "fill-zinc-200 text-zinc-200 dark:fill-zinc-700 dark:text-zinc-700",
          )}
        />
      ))}
      {showNumber && (
        <span className="ml-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
          {formatReviewRating(rating)}
        </span>
      )}
    </span>
  );
}

/** Nội dung đầy đủ: sao, ngày, toàn bộ lời nhận xét, ảnh khách + link review. */
export function ReviewDetail({
  review,
  label,
  interactive = false,
}: {
  review: EtsyReview;
  /** Nhãn item (tên sản phẩm / item_key) khi đơn có nhiều item. */
  label?: string;
  /** true = link bấm được (drawer); false = chỉ ghi chú (popover hover). */
  interactive?: boolean;
}) {
  const message = normalizeReviewMessage(review.message);
  return (
    <div className="space-y-1 text-left">
      {label && <div className="truncate text-[11px] text-muted-foreground">{label}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <ReviewStars rating={review.rating} />
        {review.review_created_at && (
          <span className="text-[11px] text-muted-foreground">{formatReviewDateTime(review.review_created_at)}</span>
        )}
      </div>
      <div className={cn("whitespace-pre-line break-words text-xs", !message && "italic text-muted-foreground")}>
        {message ? review.message?.trim() : "Khách chỉ chấm sao, không viết nhận xét."}
      </div>
      {(review.image_url || review.url) && (
        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          {review.image_url &&
            (interactive ? (
              <a
                href={review.image_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-blue-700 hover:underline dark:text-sky-400"
              >
                <ImageIcon className="h-3 w-3" />
                Ảnh khách
              </a>
            ) : (
              <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                <ImageIcon className="h-3 w-3" />
                Có ảnh khách đính kèm
              </span>
            ))}
          {review.url &&
            (interactive ? (
              <a
                href={review.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-blue-700 hover:underline dark:text-sky-400"
              >
                Xem trên Etsy
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="text-muted-foreground">Bấm sao để mở review trên Etsy</span>
            ))}
        </div>
      )}
    </div>
  );
}

/** 1 dòng: sao (bấm → review Etsy) + nhận xét rút gọn + icon ảnh khách; rê chuột → <ReviewDetail>. */
export function ReviewLine({
  review,
  label,
  maxChars = 60,
  className,
}: {
  review: EtsyReview;
  label?: string;
  maxChars?: number;
  className?: string;
}) {
  const short = shortenReviewMessage(review.message, maxChars);
  const stars = <ReviewStars rating={review.rating} size="xs" />;
  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <span className="group/review relative flex min-w-0 max-w-[260px] items-center gap-1">
        {review.url ? (
          <a href={review.url} target="_blank" rel="noreferrer" className="shrink-0" aria-label="Mở review trên Etsy">
            {stars}
          </a>
        ) : (
          stars
        )}
        {short && <span className="truncate text-xs text-muted-foreground">{short}</span>}
        <span className="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden w-72 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg group-hover/review:block">
          <ReviewDetail review={review} label={label} />
        </span>
      </span>
      {review.image_url && (
        <a
          href={review.image_url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-muted-foreground hover:text-blue-700"
          title="Ảnh khách đính kèm"
        >
          <ImageIcon className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}
