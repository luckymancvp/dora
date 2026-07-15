"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { jsonFetch } from "@/lib/hooks/useSheets";
import type {
  MeraUpdateItemRequest,
  MeraUpdateItemResponse,
  MeraUpdateOrderRequest,
  MeraUpdateOrderResponse,
  ResolveMeraOrderResponse,
} from "@/lib/types/mera";

// ---- Resolve đơn trên Mera ----
// Nhánh song song với useResolveSheetRow: chỉ fetch khi Sheet không match hoặc lỗi (enabled).
// queryKey ["mera-order", receiptId] tách hẳn ["sheet-row", ...] → không double-fetch.
export function useResolveMeraOrder(params: {
  store: string;
  receiptId: number;
  enabled?: boolean;
}) {
  const { store, receiptId, enabled = true } = params;
  return useQuery({
    queryKey: ["mera-order", receiptId],
    queryFn: () => {
      const qs = new URLSearchParams({ store, receiptId: String(receiptId) });
      return jsonFetch<ResolveMeraOrderResponse>(`/api/mera/resolve?${qs.toString()}`);
    },
    enabled: enabled && Number.isFinite(receiptId),
    staleTime: 30_000,
    retry: false,
  });
}

// ---- Danh sách status cấu hình trên Mera ----
// Đọc từ /api/mera/statuses (Mera cho sửa status qua UI nên KHÔNG hardcode).
// Ít đổi → staleTime 5 phút; lỗi/thiếu env → component fallback MERA_STATUS_OPTIONS.
export function useMeraStatuses(enabled = true) {
  return useQuery({
    queryKey: ["mera-statuses"],
    queryFn: () => jsonFetch<{ statuses: string[] }>("/api/mera/statuses"),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

// ---- Cập nhật 1 item Mera (write-back) ----
export function useUpdateMeraItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MeraUpdateItemRequest) =>
      jsonFetch<MeraUpdateItemResponse>("/api/mera/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      // Kéo lại đơn để remount editor với version mới.
      qc.invalidateQueries({ queryKey: ["mera-order"] });
    },
  });
}

// ---- Cập nhật note order-level ----
export function useUpdateMeraNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MeraUpdateOrderRequest) =>
      jsonFetch<MeraUpdateOrderResponse>("/api/mera/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mera-order"] });
    },
  });
}
