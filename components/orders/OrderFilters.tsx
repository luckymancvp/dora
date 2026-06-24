"use client";

import type { ShopItem } from "@/lib/types/etsy";

/** Rail bộ lọc bên phải (giống Etsy) — hiện chỉ lọc theo shop + nhãn sort. */
export function OrderFilters({
  shops,
  shopName,
  onShopChange,
}: {
  shops: ShopItem[];
  shopName: string;
  onShopChange: (v: string) => void;
}) {
  return (
    <div className="space-y-5 rounded-2xl border border-border p-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Shop</h3>
        <select
          value={shopName}
          onChange={(e) => onShopChange(e.target.value)}
          className="w-full rounded-xl border-0 bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Tất cả shop</option>
          {shops.map((s) => (
            <option key={s.userId} value={s.shopName}>
              {s.online ? "🟢" : "⚪"} {s.shopName}
            </option>
          ))}
        </select>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold text-foreground">Sort by</h3>
        <p className="text-sm text-muted-foreground">Newest first</p>
      </div>
    </div>
  );
}
