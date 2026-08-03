"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTabs } from "@/lib/store/tabs";
import type { ConversationDetailResponse, MessageListResponse } from "@/lib/types/etsy";
import type { ResolveOrderResponse } from "@/lib/types/sheets";

const WINDOW_SIZE = 15;
// Gợi ý AI TỐN Gemini token (mỗi cái = 1 generateContent + 1 embedding), nên
// KHÔNG prefetch cả cửa sổ 15 như messages/detail (chỉ là đọc DB rẻ). Chỉ
// warm tab đang mở + vài tab kế — phần lớn hội thoại trong window không được
// mở ra xem, sinh gợi ý cho chúng là đốt token vô ích. Tab active vẫn được
// ConversationView tự fetch khi mở; đây chỉ là buffer nhìn trước. Chỉnh số này
// để cân bằng chi phí/độ mượt khi lướt nhanh giữa các tab.
const AI_PREFETCH_SIZE = 3;
const DEBOUNCE_MS = 300;
const CONCURRENCY = 5;
const BATCH_SHEET_LIMIT = 50;

async function runChunked<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency = CONCURRENCY,
): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    await Promise.allSettled(items.slice(i, i + concurrency).map(fn));
  }
}

export function usePrefetchTabs() {
  const { openTabs, activeTabId } = useTabs();
  const qc = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (activeTabId === null || openTabs.length === 0) return;

    // Không prefetch trên mạng chậm.
    const conn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
    if (conn?.effectiveType === "slow-2g" || conn?.effectiveType === "2g") return;

    const activeIndex = openTabs.indexOf(activeTabId);
    if (activeIndex === -1) return;
    const windowIds = openTabs.slice(activeIndex, activeIndex + WINDOW_SIZE);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void (async () => {
        // Phase 1: Messages — prefetch 1 page đầu cho mỗi tab trong window.
        await runChunked(windowIds, async (id) => {
          await qc.prefetchInfiniteQuery({
            queryKey: ["messages", id],
            queryFn: ({ pageParam }: { pageParam: string | null }) => {
              const params = new URLSearchParams({ limit: "40" });
              if (pageParam) params.set("before", pageParam);
              return fetch(`/api/conversations/${id}/messages?${params.toString()}`).then(
                (r): Promise<MessageListResponse> =>
                  r.ok ? r.json() : Promise.reject(new Error(`messages ${r.status}`)),
              );
            },
            initialPageParam: null as string | null,
            getNextPageParam: (last: MessageListResponse) => last.nextCursor,
            pages: 1,
            staleTime: 30_000,
          });
        });

        // Phase 2: Conversation detail (storeName + receiptHistory).
        await runChunked(windowIds, async (id) => {
          await qc.prefetchQuery({
            queryKey: ["conversation-detail", id],
            queryFn: (): Promise<ConversationDetailResponse> =>
              fetch(`/api/conversations/${id}/detail`).then((r) =>
                r.ok ? r.json() : Promise.reject(new Error(`detail ${r.status}`)),
              ),
            staleTime: 5 * 60_000,
          });
        });

        // Phase 3: Sheet batch — 1 request duy nhất thay cho N×M request riêng lẻ.
        const batchItems: { store: string; receiptId: number }[] = [];
        for (const id of windowIds) {
          const detail = qc.getQueryData<ConversationDetailResponse>(["conversation-detail", id]);
          if (!detail) continue;
          for (const receipt of detail.receiptHistory) {
            // Chỉ thêm nếu chưa có trong cache (tránh request thừa).
            const cached = qc.getQueryData(["sheet-row", receipt.receiptId, null]);
            if (!cached) {
              batchItems.push({ store: detail.storeName, receiptId: receipt.receiptId });
            }
          }
        }
        if (batchItems.length > 0) {
          try {
            const res = await fetch("/api/sheets/resolve-batch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ items: batchItems.slice(0, BATCH_SHEET_LIMIT) }),
            });
            if (res.ok) {
              const data = (await res.json()) as { results: (ResolveOrderResponse | null)[] };
              for (let i = 0; i < batchItems.length && i < data.results.length; i++) {
                const result = data.results[i];
                if (result) {
                  qc.setQueryData(["sheet-row", batchItems[i].receiptId, null], result);
                }
              }
            }
          } catch {
            // Lỗi batch không block — panel sẽ tự fetch khi mở.
          }
        }

        // Phase 4: AI suggestion với guidance rỗng — swallow errors, không critical.
        // Giới hạn ở AI_PREFETCH_SIZE tab đầu (không phải cả window) vì mỗi gợi ý
        // gọi Gemini tốn token; đây là nguồn tốn token lớn nhất của tính năng.
        const aiIds = windowIds.slice(0, AI_PREFETCH_SIZE);
        await runChunked(aiIds, async (id) => {
          await qc
            .prefetchQuery({
              queryKey: ["ai-suggestion", id, ""],
              queryFn: () =>
                fetch(`/api/conversations/${id}/ai`).then((r) =>
                  r.ok ? r.json() : Promise.reject(new Error(`ai ${r.status}`)),
                ),
              staleTime: 5 * 60_000,
            })
            .catch(() => {});
        });
      })();
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [openTabs, activeTabId, qc]);
}
