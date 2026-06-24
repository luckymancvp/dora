"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Search, ShoppingBag } from "lucide-react";
import { useShops } from "@/lib/hooks/useShops";
import { useOrders } from "@/lib/hooks/useOrders";
import { MobileMenuButton } from "@/components/sidebar";
import { OrdersList } from "@/components/orders/OrdersList";
import { OrderFilters } from "@/components/orders/OrderFilters";
import { OrdersPagination } from "@/components/orders/OrdersPagination";
import { FetchOrdersButton } from "@/components/orders/FetchOrdersButton";
import { MessageBuyerDialog } from "@/components/orders/MessageBuyerDialog";
import type { OrderFilters as Filters, OrderListItem, OrderTab } from "@/lib/types/etsy";

const TABS: OrderTab[] = ["New", "Completed"];

export default function OrdersPage() {
  const { data: shops } = useShops();
  const [filters, setFilters] = useState<Filters>({
    search: "",
    shopName: "",
    tab: "New",
    page: 1,
  });
  const [messageOrder, setMessageOrder] = useState<OrderListItem | null>(null);

  const { data, isLoading, isFetching, refetch } = useOrders(filters);

  // Đổi search/shop/tab → reset về trang 1.
  const patch = (p: Partial<Filters>) =>
    setFilters((f) => ({ ...f, ...p, page: "page" in p ? (p.page as number) : 1 }));

  const items = data?.items ?? [];

  // Khi đang search mà tab hiện tại không có kết quả nhưng tab kia có,
  // tự chuyển sang tab kia (tabCounts đã tính theo search) để khỏi phải bấm tay.
  useEffect(() => {
    if (!filters.search.trim() || isLoading || isFetching || !data) return;
    if (items.length > 0) return;
    const other: OrderTab = filters.tab === "New" ? "Completed" : "New";
    if ((data.tabCounts[other] ?? 0) > 0) patch({ tab: other });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.tab, data, isLoading, isFetching, items.length]);

  return (
    <div className="h-full overflow-y-auto">
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <MobileMenuButton className="-ml-1" />
        <ShoppingBag className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-medium tracking-tight text-foreground">Orders</h1>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <FetchOrdersButton shops={shops ?? []} onFetched={() => refetch()} />
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={filters.search}
          onChange={(e) => patch({ search: e.target.value })}
          placeholder="Tìm theo order ID, tên khách…"
          className="w-full rounded-xl border-0 bg-secondary py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Tabs */}
      <div className="mb-4 flex items-center gap-4 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => patch({ tab: t })}
            className={`-mb-px border-b-2 px-1 py-2 text-sm font-medium transition-colors ${
              filters.tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
            {data ? <span className="ml-1.5 text-muted-foreground">{data.tabCounts[t]}</span> : null}
          </button>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
        {/* Cột trái: list + pagination */}
        <div className="space-y-4">
          {isLoading ? (
            <div className="flex items-center gap-2 rounded-xl bg-secondary px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang tải đơn…
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
              {(() => {
                const other: OrderTab = filters.tab === "New" ? "Completed" : "New";
                const otherCount = data?.tabCounts[other] ?? 0;
                if (otherCount > 0) {
                  return (
                    <>
                      Không có đơn trong tab <strong className="text-foreground">{filters.tab}</strong>.
                      <br />
                      Có {otherCount} đơn ở tab{" "}
                      <button
                        onClick={() => patch({ tab: other })}
                        className="font-semibold text-primary hover:underline"
                      >
                        {other}
                      </button>
                      .
                    </>
                  );
                }
                return (
                  <>
                    Chưa có đơn nào.
                    <br />
                    Bấm <strong className="text-foreground">Fetch orders</strong> để lấy đơn từ Etsy.
                  </>
                );
              })()}
            </div>
          ) : (
            <>
              <OrdersList items={items} onMessage={setMessageOrder} />
              <OrdersPagination
                page={data?.page ?? 1}
                totalPages={data?.totalPages ?? 0}
                pageSize={data?.pageSize ?? 20}
                onPage={(p) => patch({ page: p })}
              />
            </>
          )}
        </div>

        {/* Cột phải: rail filter */}
        <div className="hidden md:block">
          <OrderFilters
            shops={shops ?? []}
            shopName={filters.shopName}
            onShopChange={(v) => patch({ shopName: v })}
          />
        </div>
      </div>

      {messageOrder && (
        <MessageBuyerDialog order={messageOrder} onClose={() => setMessageOrder(null)} />
      )}
    </div>
    </div>
  );
}
