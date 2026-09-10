"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { jsonFetch } from "@/lib/hooks/useSheets";
import type { CarrierRule, CarrierRuleSetDTO } from "@/lib/types/carrier-rule";

const KEY = ["carrier-rules"];

/** Bộ quy tắc suy carrier từ số tracking (dùng chung mọi nguồn import). */
export function useCarrierRules() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => jsonFetch<CarrierRuleSetDTO>("/api/tracking/carrier-rules"),
    staleTime: 60_000,
  });
}

/**
 * Lưu TOÀN BỘ danh sách (PUT thay vì PATCH từng dòng): thứ tự quy tắc là ngữ nghĩa
 * (khớp đầu tiên thắng) nên ghi nguyên khối mới đúng và tránh trạng thái nửa vời.
 */
export function useSaveCarrierRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rules: CarrierRule[]) =>
      jsonFetch<CarrierRuleSetDTO>("/api/tracking/carrier-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules }),
      }),
    onSuccess: (data) => {
      // Set thẳng cache từ response (server đã chuẩn hoá) thay vì refetch thừa một vòng.
      qc.setQueryData(KEY, data);
    },
  });
}
