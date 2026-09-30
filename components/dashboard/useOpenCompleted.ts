"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  completedConversationsKey,
  fetchCompletedConversations,
} from "@/lib/hooks/useAnalytics";
import type { AnalyticsFilters, CompletedScope } from "@/lib/types/etsy";
import { useOpenMultiple } from "./useOpenMultiple";

/** Chuỗi định danh phạm vi — để biết nút nào đang tải. */
export function completedScopeKey(scope: CompletedScope): string {
  if (scope.kind === "tag") return `tag:${scope.tag}`;
  if (scope.kind === "untagged") return "untagged";
  return `shop:${scope.shopId}`;
}

/**
 * Mở các hội thoại "Đã xong" theo phạm vi (tag / No Tag / shop): tải danh sách lúc bấm
 * (lazy) rồi chuyển cho bảng /open-multiple qua useOpenMultiple.
 */
export function useOpenCompleted(filters: AnalyticsFilters) {
  const queryClient = useQueryClient();
  const openMultiple = useOpenMultiple();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  // Ref chặn click trùng ngay lập tức (state cập nhật trễ 1 nhịp render).
  const pendingRef = useRef<string | null>(null);

  const openCompleted = useCallback(
    async (scope: CompletedScope, shopName?: string): Promise<void> => {
      const key = completedScopeKey(scope);
      if (pendingRef.current === key) return;
      pendingRef.current = key;
      setPendingKey(key);
      try {
        const data = await queryClient.fetchQuery({
          queryKey: completedConversationsKey(filters, scope),
          queryFn: () => fetchCompletedConversations(filters, scope),
          staleTime: 8_000,
        });
        // Bảng shop: đính tên shop giống nút mở tin chưa trả lời.
        const items =
          shopName != null ? data.items.map((c) => ({ ...c, shop: shopName })) : data.items;
        if (items.length === 0) {
          toast.info("Không có tin đã xong trong phạm vi này");
          return;
        }
        openMultiple(items);
        if (data.truncated) {
          toast.info(`Chỉ mở ${items.length}/${data.total} tin đã xong mới nhất`);
        }
      } catch {
        toast.error("Không tải được danh sách tin đã xong");
      } finally {
        if (pendingRef.current === key) {
          pendingRef.current = null;
          setPendingKey(null);
        }
      }
    },
    [queryClient, openMultiple, filters],
  );

  return { openCompleted, pendingKey };
}
