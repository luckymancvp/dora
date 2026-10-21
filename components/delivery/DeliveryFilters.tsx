"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { selectClass } from "@/components/delivery/DeliveryToolbar";
import {
  DELIVERED_NO_REVIEW,
  DELIVERED_NO_REVIEW_HINT,
  DELIVERED_NO_REVIEW_LABEL,
  DELIVERED_REVIEWED,
  DELIVERED_REVIEWED_HINT,
  DELIVERED_REVIEWED_LABEL,
  REVIEW_STAR_OPTIONS,
  deliveredRatingCountKey,
  isDeliveredReviewTab,
  isReviewStars,
  trackingTabCount,
  type TrackingUrlState,
} from "@/lib/delivery/deliveryTracking";
import type { DeliveryTrackingListResponse } from "@/lib/types/delivery";
import { cn } from "@/lib/utils";

/** Gõ xong bao lâu mới đẩy ô tìm lên URL (→ gọi API) — như Mera. */
const SEARCH_DEBOUNCE_MS = 400;

const REVIEW_OPTIONS = [
  { key: DELIVERED_NO_REVIEW, label: DELIVERED_NO_REVIEW_LABEL, hint: DELIVERED_NO_REVIEW_HINT },
  { key: DELIVERED_REVIEWED, label: DELIVERED_REVIEWED_LABEL, hint: DELIVERED_REVIEWED_HINT },
] as const;

/**
 * Thanh lọc: tìm (q) · shop · fulfill · review (+ theo sao) · ngày Paid/Ship từ–đến · Tải lại.
 * `data` = response list hiện tại (nguồn option shop/fulfill + số đếm review); undefined khi chưa tải.
 */
export function DeliveryFilters({
  filters,
  data,
  loading,
  onChange,
  onReload,
}: {
  filters: TrackingUrlState;
  data: DeliveryTrackingListResponse | undefined;
  loading: boolean;
  onChange: (patch: Partial<TrackingUrlState>) => void;
  onReload: () => void;
}) {
  const [qInput, setQInput] = useState(filters.q);

  useEffect(() => {
    if (qInput.trim() === filters.q.trim()) return;
    const t = setTimeout(() => onChange({ q: qInput }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [qInput, filters.q, onChange]);

  const counts = data?.counts;
  const stores = data?.stores ?? [];
  const providers = data?.providers ?? [];

  // Ô Review gộp cả số sao: "rating:N" = Delivered · Reviewed + `?rating=N`.
  const reviewValue =
    filters.status === DELIVERED_REVIEWED && filters.rating
      ? `rating:${filters.rating}`
      : isDeliveredReviewTab(filters.status)
        ? filters.status
        : "";

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onChange({ q: qInput });
          }}
          placeholder="Tìm mã tracking / Order ID"
          className={cn(selectClass, "w-72 pl-8 pr-8")}
        />
        {qInput && (
          <button
            type="button"
            onClick={() => {
              setQInput("");
              onChange({ q: "" });
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Xoá tìm kiếm"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <select
        value={filters.store}
        onChange={(e) => onChange({ store: e.target.value })}
        className={cn(selectClass, "min-w-[180px]")}
        title="Lọc theo shop"
        aria-label="Lọc theo shop"
      >
        <option value="">Tất cả shop</option>
        {/* Shop đang chọn qua URL nhưng không còn trong danh sách vẫn hiện để bỏ chọn được. */}
        {filters.store && !stores.some((s) => s.store === filters.store) && (
          <option value={filters.store}>{filters.store}</option>
        )}
        {stores.map((s) => (
          <option key={s.store} value={s.store}>
            {s.store} ({s.count.toLocaleString()})
          </option>
        ))}
      </select>

      <select
        value={filters.provider}
        onChange={(e) => onChange({ provider: e.target.value })}
        className={cn(selectClass, "min-w-[150px]")}
        title="Lọc theo bên fulfill (cột Fulfill)"
        aria-label="Lọc theo fulfill"
      >
        <option value="">Tất cả fulfill</option>
        {filters.provider && !providers.some((p) => p.provider === filters.provider) && (
          <option value={filters.provider}>{filters.provider}</option>
        )}
        {providers.map((p) => (
          <option key={p.provider} value={p.provider}>
            {p.provider} ({p.count.toLocaleString()})
          </option>
        ))}
      </select>

      <select
        value={reviewValue}
        onChange={(e) => {
          const v = e.target.value;
          const stars = v.startsWith("rating:") ? Number(v.slice("rating:".length)) : NaN;
          if (isReviewStars(stars)) {
            onChange({ status: DELIVERED_REVIEWED, rating: stars });
            return;
          }
          // Bỏ lọc review → về tab Delivered (đang đứng trong nhóm đã giao).
          onChange({
            status: v === DELIVERED_NO_REVIEW || v === DELIVERED_REVIEWED ? v : "delivered",
            rating: null,
          });
        }}
        className={cn(selectClass, "min-w-[150px]", reviewValue && "border-primary text-primary")}
        title={
          filters.status === DELIVERED_REVIEWED && filters.rating
            ? `Delivered, at least one item reviewed ${filters.rating}★ on Etsy. Latest delivered first.`
            : (REVIEW_OPTIONS.find((o) => o.key === reviewValue)?.hint ?? "Delivered codes by Etsy review")
        }
        aria-label="Filter by review"
      >
        <option value="">All reviews</option>
        {REVIEW_OPTIONS.map((o) => {
          const n = trackingTabCount(counts, o.key);
          return (
            <option key={o.key} value={o.key}>
              {o.label}
              {n == null ? "" : ` (${n.toLocaleString()})`}
            </option>
          );
        })}
        <optgroup label="Reviewed · by stars">
          {REVIEW_STAR_OPTIONS.map((stars) => {
            const n = counts ? counts[deliveredRatingCountKey(stars)] : undefined;
            return (
              <option key={stars} value={`rating:${stars}`}>
                {"★".repeat(stars)}
                {"☆".repeat(5 - stars)} {stars} sao{n == null ? "" : ` (${n.toLocaleString()})`}
              </option>
            );
          })}
        </optgroup>
      </select>

      <div className="flex items-center gap-2 text-sm">
        <select
          value={filters.dateField}
          onChange={(e) => onChange({ dateField: e.target.value === "ship" ? "ship" : "paid" })}
          className={selectClass}
          title="Lọc theo ngày thanh toán hay ngày gửi hàng"
          aria-label="Loại ngày"
        >
          <option value="paid">Ngày Paid</option>
          <option value="ship">Ngày Ship</option>
        </select>
        <input
          type="date"
          value={filters.from}
          max={filters.to || undefined}
          onChange={(e) => onChange({ from: e.target.value })}
          className={selectClass}
          aria-label="Từ ngày"
        />
        <span className="text-muted-foreground">→</span>
        <input
          type="date"
          value={filters.to}
          min={filters.from || undefined}
          onChange={(e) => onChange({ to: e.target.value })}
          className={selectClass}
          aria-label="Đến ngày"
        />
        {(filters.from || filters.to) && (
          <Button variant="ghost" size="sm" onClick={() => onChange({ from: "", to: "" })}>
            Bỏ lọc ngày
          </Button>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={onReload}
          title="Tải lại danh sách từ Mera (không đọc Etsy)"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Tải lại
        </Button>
      </div>
    </div>
  );
}
