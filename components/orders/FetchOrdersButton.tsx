"use client";

import { useState } from "react";
import { DownloadCloud, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import type { ShopItem } from "@/lib/types/etsy";

/** ISO yyyy-mm-dd của hôm nay lùi `days` ngày (để default khoảng fetch). */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const CUSTOM = "__custom__";

/** Nút "Fetch orders from Etsy" — bắt buộc chọn shop (channel Ably = shop_name). */
export function FetchOrdersButton({
  shops,
  onFetched,
}: {
  shops: ShopItem[];
  onFetched?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [shopSelect, setShopSelect] = useState("");
  const [customShop, setCustomShop] = useState("");
  const [dateFrom, setDateFrom] = useState(() => isoDaysAgo(30));
  const [dateTo, setDateTo] = useState(() => isoDaysAgo(0));
  const [loading, setLoading] = useState(false);

  const shopName = shopSelect === CUSTOM ? customShop.trim() : shopSelect.trim();

  const submit = async () => {
    if (!shopName) {
      toast.error("Hãy chọn shop để fetch đơn.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/orders/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopName, date_from: dateFrom, date_to: dateTo }),
      });
      const data = (await res.json()) as { error?: string; code?: string };
      if (!res.ok) {
        toast.error(
          data.code === "shop_offline"
            ? "Shop chưa có extension online — hãy mở Etsy của shop này."
            : data.error ?? `Lỗi ${res.status}`,
        );
        return;
      }
      toast.success("Đã yêu cầu fetch đơn. Bấm Refresh sau ít phút để xem đơn mới.");
      setOpen(false);
      onFetched?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lỗi mạng");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
      >
        <DownloadCloud className="h-4 w-4" />
        Fetch orders
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-50 mt-2 w-80 space-y-3 rounded-2xl border border-border bg-background p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Fetch đơn từ Etsy</h3>
              <button
                onClick={() => setOpen(false)}
                className="rounded-full p-1 text-muted-foreground hover:bg-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Shop</label>
              <select
                value={shopSelect}
                onChange={(e) => setShopSelect(e.target.value)}
                className="w-full rounded-xl border-0 bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— Chọn shop —</option>
                {shops.map((s) => (
                  <option key={s.userId} value={s.shopName}>
                    {s.online ? "🟢" : "⚪"} {s.shopName}
                  </option>
                ))}
                <option value={CUSTOM}>✏️ Tự nhập tên shop…</option>
              </select>
              {shopSelect === CUSTOM && (
                <input
                  value={customShop}
                  onChange={(e) => setCustomShop(e.target.value)}
                  placeholder="Tên shop (đúng tên channel Ably)"
                  className="mt-2 w-full rounded-xl border-0 bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Từ ngày</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full rounded-xl border-0 bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Đến ngày</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full rounded-xl border-0 bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            <button
              onClick={submit}
              disabled={loading || !shopName}
              className="flex w-full items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:bg-input-strong"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <DownloadCloud className="h-4 w-4" />
              )}
              Yêu cầu fetch
            </button>
          </div>
        </>
      )}
    </div>
  );
}
