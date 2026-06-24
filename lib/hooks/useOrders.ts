"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { OrderFilters, OrdersResponse } from "@/lib/types/etsy";

async function fetchOrders(filters: OrderFilters): Promise<OrdersResponse> {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.shopName.trim()) params.set("shopName", filters.shopName.trim());
  params.set("tab", filters.tab);
  params.set("page", String(filters.page));

  const res = await fetch(`/api/orders?${params.toString()}`);
  if (!res.ok) throw new Error(`orders ${res.status}`);
  return (await res.json()) as OrdersResponse;
}

export function useOrders(filters: OrderFilters) {
  return useQuery({
    queryKey: ["orders", filters],
    queryFn: () => fetchOrders(filters),
    // Giữ rows trang trước khi đổi trang/filter để UI không nhấp nháy.
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}
