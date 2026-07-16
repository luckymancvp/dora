"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { jsonFetch } from "@/lib/hooks/useSheets";
import type {
  MeraUpdateRequest,
  MeraUpdateResponse,
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

// ---- Cập nhật Mera (write-back UNIFIED — vòng 2) ----
// Gộp useUpdateMeraItem + useUpdateMeraNote thành 1 hook: body MeraUpdateRequest
// (updates: Record<fieldKey,value> trộn cả item-scope lẫn order-scope), server tự tách scope.
// Cast MeraUpdateResponse ({item|null, order|null, splitApplied?}). invalidate ["mera-order"]
// để remount editor với version mới sau khi lưu.
export function useUpdateMera() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MeraUpdateRequest) =>
      jsonFetch<MeraUpdateResponse>("/api/mera/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mera-order"] });
    },
  });
}
