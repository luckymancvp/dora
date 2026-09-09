"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { DEFAULT_ORDER_FILTERS } from "@/lib/types/etsy";
import type { OrderFilters, OrdersResponse } from "@/lib/types/etsy";

async function fetchOrders(filters: OrderFilters): Promise<OrdersResponse> {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.shopName.trim()) params.set("shopName", filters.shopName.trim());
  params.set("tab", filters.tab);
  params.set("page", String(filters.page));

  // Chỉ gửi filter khác mặc định — URL gọn và route đã có default tương ứng.
  if (filters.sort !== DEFAULT_ORDER_FILTERS.sort) params.set("sort", filters.sort);
  if (filters.dateRange !== DEFAULT_ORDER_FILTERS.dateRange) {
    params.set("dateRange", filters.dateRange);
  }
  if (filters.delivery !== DEFAULT_ORDER_FILTERS.delivery) params.set("delivery", filters.delivery);
  if (filters.status !== DEFAULT_ORDER_FILTERS.status) params.set("status", filters.status);
  if (filters.destination) params.set("destination", filters.destination);
  if (filters.hasNote) params.set("hasNote", "1");
  if (filters.isGift) params.set("isGift", "1");
  if (filters.isPersonalized) params.set("isPersonalized", "1");

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
