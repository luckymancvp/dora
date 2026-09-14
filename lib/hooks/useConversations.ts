"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import type {
  ConversationFilters,
  ConversationListItem,
  ConversationListResponse,
} from "@/lib/types/etsy";

async function fetchConversations(
  cursor: string | null,
  filters: ConversationFilters,
): Promise<ConversationListResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (filters.search) params.set("search", filters.search);
  if (filters.notReplied) params.set("notReplied", "true");
  if (filters.hasOrder) params.set("hasOrder", "true");
  if (filters.orderHelp) params.set("orderHelp", "true");
  if (filters.hasNote) params.set("hasNote", "true");
  if (filters.shopIds.length > 0) params.set("shopIds", filters.shopIds.join(","));
  if (filters.tags.length > 0) params.set("tags", filters.tags.join(","));
  if (filters.sheetStatuses.length > 0) params.set("sheetStatuses", filters.sheetStatuses.join(","));
  if (filters.sort === "asc") params.set("sort", "asc");
  // Khoảng lastMessageDate — giá trị đã SNAPSHOT ở phía caller (xem ConversationFilters.from).
  // KHÔNG serialize filters.datePreset: nó thuần là state UI (highlight nút), from/to đã
  // quyết định hoàn toàn kết quả nên thêm vào query chỉ tạo thêm chỗ lệch.
  if (filters.from != null) params.set("from", String(filters.from));
  if (filters.to != null) params.set("to", String(filters.to));
  // Lọc ở SERVER để `total` khớp đúng tập người dùng thấy (không lọc lại ở client).
  if (filters.maxMessages != null) params.set("maxMessages", String(filters.maxMessages));
  if (filters.waitingHours != null) params.set("waitingHours", String(filters.waitingHours));
  params.set("limit", "30");
  const res = await fetch(`/api/conversations?${params.toString()}`);
  if (!res.ok) throw new Error(`conversations ${res.status}`);
  return (await res.json()) as ConversationListResponse;
}

export function useConversations(filters: ConversationFilters) {
  const query = useInfiniteQuery({
    queryKey: ["conversations", filters],
    queryFn: ({ pageParam }) => fetchConversations(pageParam, filters),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const items: ConversationListItem[] = query.data?.pages.flatMap((p) => p.items) ?? [];
  // Mẫu số thật: backend chỉ countDocuments ở trang ĐẦU (các trang sau trả null) nên
  // PHẢI đọc ở pages[0]. Nhờ vậy total không đổi khi nạp thêm trang.
  const total: number | null = query.data?.pages[0]?.total ?? null;
  return { ...query, items, total };
}
