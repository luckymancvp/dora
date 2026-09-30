"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  AgentPerformanceResponse,
  AiEffectivenessResponse,
  AnalyticsFilters,
  CompletedConversationsResponse,
  CompletedScope,
  ShopAnalyticsResponse,
  MessageOverviewResponse,
  TagsOverviewResponse,
} from "@/lib/types/etsy";

function buildParams(filters: AnalyticsFilters): string {
  const params = new URLSearchParams();
  if (filters.from != null) params.set("from", String(filters.from));
  if (filters.to != null) params.set("to", String(filters.to));
  if (filters.shopIds.length > 0) params.set("shopIds", filters.shopIds.join(","));
  return params.toString();
}

async function fetchJson<T>(path: string, filters: AnalyticsFilters): Promise<T> {
  const qs = buildParams(filters);
  const res = await fetch(`${path}${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

// Auto-refresh 10s (mirror DORA poll). staleTime ngắn hơn để không refetch thừa.
const COMMON = { refetchInterval: 10_000, staleTime: 8_000 } as const;

export function useMessageOverview(filters: AnalyticsFilters) {
  return useQuery({
    queryKey: ["analytics", "overview", filters],
    queryFn: () => fetchJson<MessageOverviewResponse>("/api/analytics/overview", filters),
    ...COMMON,
  });
}

export function useShopAnalytics(filters: AnalyticsFilters) {
  return useQuery({
    queryKey: ["analytics", "shops", filters],
    queryFn: () => fetchJson<ShopAnalyticsResponse>("/api/analytics/shops", filters),
    ...COMMON,
  });
}

export function useAgentPerformance(filters: AnalyticsFilters) {
  return useQuery({
    queryKey: ["analytics", "agents", filters],
    queryFn: () =>
      fetchJson<AgentPerformanceResponse>("/api/analytics/agent-performance", filters),
    ...COMMON,
  });
}

export function useAiEffectiveness(filters: AnalyticsFilters) {
  return useQuery({
    queryKey: ["analytics", "ai-effectiveness", filters],
    queryFn: () =>
      fetchJson<AiEffectivenessResponse>("/api/analytics/ai-effectiveness", filters),
    ...COMMON,
  });
}

export function useTagsOverview(filters: AnalyticsFilters) {
  return useQuery({
    queryKey: ["analytics", "tags", filters],
    queryFn: () => fetchJson<TagsOverviewResponse>("/api/analytics/tags-overview", filters),
    ...COMMON,
  });
}

/** Key cache cho danh sách tin đã xong theo phạm vi (dùng với queryClient.fetchQuery). */
export function completedConversationsKey(filters: AnalyticsFilters, scope: CompletedScope) {
  return ["analytics", "completed", filters, scope] as const;
}

/**
 * Lấy danh sách hội thoại đã xong theo phạm vi — lazy, chỉ gọi khi bấm mở (KHÔNG phải useQuery).
 * Gửi đúng 1 tham số phạm vi: tag / untagged=1 / shopId.
 */
export async function fetchCompletedConversations(
  filters: AnalyticsFilters,
  scope: CompletedScope,
): Promise<CompletedConversationsResponse> {
  const params = new URLSearchParams(buildParams(filters));
  if (scope.kind === "tag") params.set("tag", scope.tag);
  else if (scope.kind === "untagged") params.set("untagged", "1");
  else params.set("shopId", String(scope.shopId));
  const res = await fetch(`/api/analytics/completed-conversations?${params.toString()}`);
  if (!res.ok) throw new Error(`completed-conversations ${res.status}`);
  return (await res.json()) as CompletedConversationsResponse;
}
