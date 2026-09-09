"use client";

import { useMemo } from "react";
import type { OrderListItem } from "@/lib/types/etsy";
import { OrderCard } from "@/components/orders/OrderCard";

/**
 * Tiêu chí gom nhóm — PHẢI khớp cột đang sort ở service, nếu không nhóm sẽ vỡ
 * vụn (vd sort theo nước mà gom theo ngày thì mỗi đơn thành một nhóm).
 */
export type OrderGroupBy = "orderDate" | "completedDate" | "country";

/** Nhãn ngày (vd "23 Jun, 2026"). */
function dayLabel(unix: number): string {
  if (!unix) return "Không rõ ngày";
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function groupLabel(o: OrderListItem, groupBy: OrderGroupBy): string {
  if (groupBy === "completedDate") return `Completed ${dayLabel(o.completedDate)}`;
  if (groupBy === "country") return o.toAddress.country || "Không rõ nước";
  return `Ordered ${dayLabel(o.orderDate)}`;
}

/** Gom đơn theo nhãn, giữ nguyên thứ tự service đã sort. */
function groupOrders(
  items: OrderListItem[],
  groupBy: OrderGroupBy,
): { label: string; orders: OrderListItem[] }[] {
  const groups: { label: string; orders: OrderListItem[] }[] = [];
  for (const o of items) {
    const label = groupLabel(o, groupBy);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.orders.push(o);
    else groups.push({ label, orders: [o] });
  }
  return groups;
}

export function OrdersList({
  items,
  groupBy,
  onMessage,
  onUpdate,
}: {
  items: OrderListItem[];
  groupBy: OrderGroupBy;
  onMessage: (order: OrderListItem) => void;
  onUpdate: (order: OrderListItem) => void;
}) {
  const groups = useMemo(() => groupOrders(items, groupBy), [items, groupBy]);

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.label} className="space-y-3">
          <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-1 backdrop-blur">
            <span className="text-sm font-medium text-foreground">{g.label}</span>
            <span className="ml-2 text-sm text-muted-foreground">{g.orders.length}</span>
          </div>
          {g.orders.map((o) => (
            <OrderCard key={o.id} order={o} onMessage={onMessage} onUpdate={onUpdate} />
          ))}
        </div>
      ))}
    </div>
  );
}
