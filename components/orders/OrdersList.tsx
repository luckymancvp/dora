"use client";

import { useMemo } from "react";
import type { OrderListItem } from "@/lib/types/etsy";
import { OrderCard } from "@/components/orders/OrderCard";

/** Nhãn group theo ngày đặt (vd "23 Jun, 2026"). */
function dayLabel(unix: number): string {
  if (!unix) return "Không rõ ngày";
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Gom đơn theo ngày đặt, giữ thứ tự đã sort (mới → cũ). */
function groupByDate(items: OrderListItem[]): { label: string; orders: OrderListItem[] }[] {
  const groups: { label: string; orders: OrderListItem[] }[] = [];
  for (const o of items) {
    const label = dayLabel(o.orderDate);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.orders.push(o);
    else groups.push({ label, orders: [o] });
  }
  return groups;
}

export function OrdersList({
  items,
  onMessage,
}: {
  items: OrderListItem[];
  onMessage: (order: OrderListItem) => void;
}) {
  const groups = useMemo(() => groupByDate(items), [items]);

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.label} className="space-y-3">
          <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-1 backdrop-blur">
            <span className="text-sm font-medium text-foreground">
              Ordered {g.label}
            </span>
            <span className="ml-2 text-sm text-muted-foreground">{g.orders.length}</span>
          </div>
          {g.orders.map((o) => (
            <OrderCard key={o.id} order={o} onMessage={onMessage} />
          ))}
        </div>
      ))}
    </div>
  );
}
