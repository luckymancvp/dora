"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type {
  TrackingHistoryQuery,
  TrackingHistoryResponse,
  TrackingJob,
} from "@/lib/types/tracking";

/**
 * Chi tiết 1 lượt add tracking: mirror `SerializedJob` phía service —
 * TrackingJob bỏ `_id`, thêm `id`, và ngày là ISO string (qua JSON).
 * Định nghĩa từ contract type (không redefine field), để component đọc `orders[]`.
 */
export type TrackingJobDetail = Omit<
  TrackingJob,
  "_id" | "created_at" | "updated_at"
> & {
  id: string;
  created_at: string;
  updated_at: string;
};

async function fetchTrackingHistory(
  query: TrackingHistoryQuery,
): Promise<TrackingHistoryResponse> {
  const params = new URLSearchParams();
  // Chỉ set q/shop khi non-empty — khớp cách route đọc searchParams (default "").
  if (query.q.trim()) params.set("q", query.q.trim());
  if (query.shop.trim()) params.set("shop", query.shop.trim());
  params.set("page", String(query.page));
  params.set("limit", String(query.limit));

  const res = await fetch(`/api/tracking/jobs?${params.toString()}`);
  if (!res.ok) throw new Error(`tracking history ${res.status}`);
  return (await res.json()) as TrackingHistoryResponse;
}

export function useTrackingHistory(query: TrackingHistoryQuery) {
  return useQuery({
    queryKey: ["tracking-history", query],
    queryFn: () => fetchTrackingHistory(query),
    // Giữ danh sách trang trước khi đổi trang/filter để UI không nhấp nháy.
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

async function fetchTrackingJob(id: string): Promise<TrackingJobDetail> {
  const res = await fetch(`/api/tracking/jobs/${id}`);
  if (!res.ok) throw new Error(`tracking job ${res.status}`);
  const data = (await res.json()) as { job: TrackingJobDetail };
  return data.job;
}

/** Chi tiết 1 lượt — chỉ fetch khi mở (enabled = có id). */
export function useTrackingJob(id: string | null) {
  return useQuery({
    queryKey: ["tracking-job", id],
    queryFn: () => fetchTrackingJob(id as string),
    enabled: !!id,
    staleTime: 10_000,
  });
}
