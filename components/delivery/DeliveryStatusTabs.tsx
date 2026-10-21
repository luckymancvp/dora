"use client";

import {
  DELIVERY_STATUSES,
  DELIVERY_STATUS_HINTS,
  DELIVERY_STATUS_LABELS,
  isDeliveredReviewTab,
  trackingTabCount,
} from "@/lib/delivery/deliveryTracking";
import type { DeliveryStatusCounts, TrackingTab } from "@/lib/types/delivery";
import { cn } from "@/lib/utils";

const TABS: { key: TrackingTab; label: string; hint?: string }[] = [
  { key: "", label: "All" },
  ...DELIVERY_STATUSES.map((s) => ({ key: s, label: DELIVERY_STATUS_LABELS[s], hint: DELIVERY_STATUS_HINTS[s] })),
];

/**
 * Tab trạng thái + số đếm. "No review" / "Reviewed" không phải tab: nằm ở ô Review trên thanh lọc
 * (vẫn là `?status=`), khi chọn thì tab Delivered sáng (như Mera).
 */
export function DeliveryStatusTabs({
  status,
  counts,
  onChange,
}: {
  status: TrackingTab;
  /** undefined = chưa có dữ liệu → hiện "–". */
  counts: Partial<DeliveryStatusCounts> | undefined;
  onChange: (tab: TrackingTab) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border">
      {TABS.map((t) => {
        const active = status === t.key || (t.key === "delivered" && isDeliveredReviewTab(status));
        const n = trackingTabCount(counts, t.key);
        return (
          <button
            key={t.key || "all"}
            type="button"
            title={t.hint}
            onClick={() => onChange(t.key)}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-primary font-semibold text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            <span className={cn("ml-1.5 rounded-full px-1.5 text-xs", active ? "bg-primary/10" : "bg-secondary")}>
              {n == null ? "–" : n.toLocaleString()}
            </span>
          </button>
        );
      })}
    </div>
  );
}
