"use client";

import { useMemo, useState } from "react";
import { DownloadCloud, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import type { ShopItem } from "@/lib/types/etsy";

/** ISO yyyy-mm-dd của hôm nay lùi `days` ngày (để default khoảng fetch). */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Một lần fetch cho 1 shop. */
async function fetchOneShop(
  shopName: string,
  dateFrom: string,
  dateTo: string,
): Promise<{ shopName: string; ok: boolean; offline?: boolean; error?: string }> {
  try {
    const res = await fetch("/api/orders/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shopName, date_from: dateFrom, date_to: dateTo }),
    });
    const data = (await res.json()) as { error?: string; code?: string };
    if (!res.ok) {
      return { shopName, ok: false, offline: data.code === "shop_offline", error: data.error };
    }
    return { shopName, ok: true };
  } catch (e) {
    return { shopName, ok: false, error: e instanceof Error ? e.message : "Lỗi mạng" };
  }
}

/** Nút "Fetch orders from Etsy" — chọn nhiều shop cùng lúc (channel Ably = shop_name). */
export function FetchOrdersButton({
  shops,
  onFetched,
}: {
  shops: ShopItem[];
  onFetched?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [customShops, setCustomShops] = useState(""); // tên shop tự nhập, phân tách bằng phẩy/xuống dòng
  const [dateFrom, setDateFrom] = useState(() => isoDaysAgo(3));
  const [dateTo, setDateTo] = useState(() => isoDaysAgo(0));
  const [loading, setLoading] = useState(false);

  // Gộp shop đã tick + shop tự nhập (loại trùng, giữ thứ tự).
  const shopNames = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (name: string) => {
      const n = name.trim();
      if (!n || seen.has(n.toLowerCase())) return;
      seen.add(n.toLowerCase());
      out.push(n);
    };
    for (const s of shops) if (selected[s.shopName]) add(s.shopName);
    for (const c of customShops.split(/[\n,]/)) add(c);
    return out;
  }, [shops, selected, customShops]);

  const selectedCount = shops.filter((s) => selected[s.shopName]).length;
  const allSelected = shops.length > 0 && selectedCount === shops.length;

  const toggleAll = () =>
    setSelected(allSelected ? {} : Object.fromEntries(shops.map((s) => [s.shopName, true])));

  const submit = async () => {
    if (shopNames.length === 0) {
      toast.error("Hãy chọn ít nhất một shop để fetch đơn.");
      return;
    }
    setLoading(true);
    try {
      const results = await Promise.all(
        shopNames.map((name) => fetchOneShop(name, dateFrom, dateTo)),
      );
      const ok = results.filter((r) => r.ok);
      const offline = results.filter((r) => !r.ok && r.offline);
      const failed = results.filter((r) => !r.ok && !r.offline);

      if (ok.length > 0) {
        toast.success(
          `Đã yêu cầu fetch ${ok.length}/${shopNames.length} shop. Bấm Refresh sau ít phút để xem đơn mới.`,
        );
      }
      if (offline.length > 0) {
        toast.error(
          `${offline.length} shop chưa có extension online: ${offline
            .map((r) => r.shopName)
            .join(", ")}`,
        );
      }
      if (failed.length > 0) {
        toast.error(
          `${failed.length} shop lỗi: ${failed.map((r) => `${r.shopName} (${r.error ?? "?"})`).join(", ")}`,
        );
      }

      if (ok.length > 0) {
        setOpen(false);
        onFetched?.();
      }
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
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-xs text-muted-foreground">
                  Shop {selectedCount > 0 ? `(${selectedCount} đã chọn)` : ""}
                </label>
                {shops.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    {allSelected ? "Bỏ chọn" : "Chọn tất cả"}
                  </button>
                )}
              </div>
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl bg-secondary p-2">
                {shops.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground">
                    Chưa có shop nào — nhập tên shop bên dưới.
                  </p>
                ) : (
                  shops.map((s) => (
                    <label
                      key={s.userId}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-background"
                    >
                      <input
                        type="checkbox"
                        checked={!!selected[s.shopName]}
                        onChange={(e) =>
                          setSelected((p) => ({ ...p, [s.shopName]: e.target.checked }))
                        }
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="truncate">
                        {s.online ? "🟢" : "⚪"} {s.shopName}
                      </span>
                    </label>
                  ))
                )}
              </div>
              <input
                value={customShops}
                onChange={(e) => setCustomShops(e.target.value)}
                placeholder="Tự nhập thêm shop (cách nhau bằng dấu phẩy)…"
                className="mt-2 w-full rounded-xl border-0 bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
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
              disabled={loading || shopNames.length === 0}
              className="flex w-full items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:bg-input-strong"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <DownloadCloud className="h-4 w-4" />
              )}
              Yêu cầu fetch{shopNames.length > 0 ? ` (${shopNames.length} shop)` : ""}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
