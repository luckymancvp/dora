"use client";

import {
  keepPreviousData,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { buildDeliveryTrackingQuery } from "@/lib/delivery/deliveryTracking";
import type {
  BulkRefreshJob,
  BulkRefreshRequest,
  DeliveryApiErrorBody,
  DeliveryProjectsResponse,
  DeliveryTracking,
  DeliveryTrackingDetail,
  DeliveryTrackingListParams,
  DeliveryTrackingOrder,
  DeliveryTrackingListResponse,
  ReviewRequestPreview,
  ReviewRequestProjectBody,
  ReviewRequestRunResult,
  ReviewRequestSendRequest,
  ReviewRequestSendResult,
  ReviewRequestSettings,
  ReviewRequestSettingsUpdate,
  ReviewRequestSummary,
} from "@/lib/types/delivery";

/**
 * Hook màn Giao hàng (/delivery) — gọi proxy `app/api/delivery/*` (contract §3.3, §4.1).
 * Lỗi giữ NGUYÊN body (`code`, `shop`, `retry_after`…) để component phân nhánh câu báo
 * (refreshErrorMessage) — vì thế KHÔNG dùng `jsonFetch` của useSheets (chỉ giữ message).
 */

export class DeliveryApiError extends Error {
  status: number;
  code?: string;
  body: DeliveryApiErrorBody;

  constructor(status: number, body: DeliveryApiErrorBody) {
    super(body.error || String(status));
    this.name = "DeliveryApiError";
    this.status = status;
    this.code = body.code;
    this.body = body;
  }
}

/** fetch + ném DeliveryApiError khi !res.ok. Mọi 2xx (kể cả 202 của bulk-refresh) là thành công. */
async function deliveryFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let body: DeliveryApiErrorBody = { error: String(res.status) };
    try {
      const j: unknown = await res.json();
      if (j && typeof j === "object" && typeof (j as { error?: unknown }).error === "string") {
        body = j as DeliveryApiErrorBody;
      }
    } catch {
      // Body không phải JSON — giữ { error: "<status>" }.
    }
    throw new DeliveryApiError(res.status, body);
  }
  return (await res.json()) as T;
}

/** GET /api/delivery — dùng chung cho hook list và export XLSX (không qua cache). */
export async function fetchDeliveryList(
  p: DeliveryTrackingListParams,
  signal?: AbortSignal,
): Promise<DeliveryTrackingListResponse> {
  const qs = buildDeliveryTrackingQuery(p);
  return deliveryFetch<DeliveryTrackingListResponse>(`/api/delivery${qs ? `?${qs}` : ""}`, { signal });
}

export function useDeliveryTrackings(p: DeliveryTrackingListParams) {
  return useQuery({
    queryKey: ["delivery", "list", p],
    queryFn: ({ signal }) => fetchDeliveryList(p, signal),
    // Giữ rows trang trước khi đổi trang/filter để bảng không nhấp nháy.
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useDeliveryTracking(id: string | null) {
  return useQuery({
    queryKey: ["delivery", "detail", id],
    queryFn: ({ signal }) =>
      deliveryFetch<DeliveryTrackingDetail>(`/api/delivery/${encodeURIComponent(id ?? "")}`, { signal }),
    enabled: !!id,
  });
}

export function useDeliveryProjects() {
  return useQuery({
    queryKey: ["delivery", "projects"],
    queryFn: ({ signal }) => deliveryFetch<DeliveryProjectsResponse>("/api/delivery/projects", { signal }),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Field chỉ có ở detail/refresh — không chép vào dòng bảng (giữ state list nhẹ, đúng shape DeliveryTracking). */
function rowFromDetail(prev: DeliveryTracking, d: DeliveryTrackingDetail): DeliveryTracking {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const {
    events: _events,
    flags: _flags,
    review_check: _reviewCheck,
    review_error: _reviewError,
    mera_carrier: _meraCarrier,
    status_changed_at: _statusChangedAt,
    first_event_at: _firstEventAt,
    error_count: _errorCount,
    hidden: _hidden,
    created_at: _createdAt,
    updated_at: _updatedAt,
    ...rest
  } = d;
  /* eslint-enable @typescript-eslint/no-unused-vars */
  return { ...prev, ...rest, orders: mergeScopedOrders(prev.orders, rest.orders) };
}

/** Khoá 1 đơn trên mã: cùng order_id có thể có ở cả Mera lẫn sheet Dora, ở shop khác nhau. */
function orderKey(o: DeliveryTrackingOrder): string {
  return `${o.order_id}\u0000${o.source ?? "mera"}\u0000${o.store}`;
}

/**
 * List chỉ trả đơn trong PHẠM VI đang xem (vd `dora:<store>` → chỉ đơn Dora của shop đó), còn
 * detail/refresh trả đơn của MỌI project + Dora. Giữ tập đơn của dòng; chỉ thay đơn khớp khoá bằng
 * bản mới của detail; detail thiếu đơn nào → giữ bản cũ. Không thêm đơn ngoài phạm vi (sai cột
 * Order ID + sai số mã/shop khi chọn làm mới hàng loạt).
 */
function mergeScopedOrders(
  prev: DeliveryTrackingOrder[],
  fresh: DeliveryTrackingOrder[] | undefined,
): DeliveryTrackingOrder[] {
  if (!fresh?.length) return prev;
  const byKey = new Map(fresh.map((o) => [orderKey(o), o]));
  return prev.map((o) => byKey.get(orderKey(o)) ?? o);
}

const REFRESH_MUTATION_KEY = ["delivery", "refresh"] as const;

/** POST /api/delivery/:id/refresh — đọc lại Etsy 1 mã; vá detail + dòng trong mọi list đang cache. */
export function useRefreshDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: REFRESH_MUTATION_KEY,
    mutationFn: (id: string) =>
      deliveryFetch<DeliveryTrackingDetail>(`/api/delivery/${encodeURIComponent(id)}/refresh`, {
        method: "POST",
      }),
    onSuccess: (detail, id) => {
      qc.setQueryData<DeliveryTrackingDetail>(["delivery", "detail", id], detail);
      qc.setQueriesData<DeliveryTrackingListResponse>({ queryKey: ["delivery", "list"] }, (old) => {
        if (!old || !old.items.some((it) => it.id === id)) return old;
        return { ...old, items: old.items.map((it) => (it.id === id ? rowFromDetail(it, detail) : it)) };
      });
    },
  });
}

/** id các mã đang làm mới (mọi lời gọi useRefreshDelivery đang chạy) — spinner theo dòng. */
export function useRefreshingDeliveryIds(): Set<string> {
  const ids = useMutationState({
    filters: { mutationKey: REFRESH_MUTATION_KEY, status: "pending" },
    select: (m) => m.state.variables as string,
  });
  return new Set(ids);
}

/** POST /api/delivery/bulk-refresh (202) — job đặt sẵn vào cache để useBulkRefreshJob hỏi tiếp từ đó. */
export function useStartBulkRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => {
      const body: BulkRefreshRequest = { ids };
      return deliveryFetch<BulkRefreshJob>("/api/delivery/bulk-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    onSuccess: (job) => {
      qc.setQueryData<BulkRefreshJob>(["delivery", "bulk", job.id], job);
    },
  });
}

/** Tiến độ làm mới hàng loạt: hỏi 3s/lần tới khi `done` (hoặc lỗi). */
export function useBulkRefreshJob(jobId: string | null) {
  return useQuery({
    queryKey: ["delivery", "bulk", jobId],
    queryFn: ({ signal }) =>
      deliveryFetch<BulkRefreshJob>(`/api/delivery/bulk-refresh/${encodeURIComponent(jobId ?? "")}`, {
        signal,
      }),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data?.done || q.state.status === "error" ? false : 3000),
    retry: false,
  });
}

// =====================================================================================
// Request reviews — proxy `app/api/delivery/review-requests/*` (contract _workspace/01 §3.3, §4.1).
// `projectId` = hex | "dora" (reviewRequestProjectId) — null = chưa chọn project → không gọi.
// =====================================================================================

const RR_KEY = ["delivery", "review-requests"] as const;

function jsonPost(body: unknown, method: "POST" | "PUT" = "POST"): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function projectQuery(projectId: string): string {
  return new URLSearchParams({ project_id: projectId }).toString();
}

export function useReviewRequestSettings(projectId: string | null) {
  return useQuery({
    queryKey: [...RR_KEY, "settings", projectId],
    queryFn: ({ signal }) =>
      deliveryFetch<ReviewRequestSettings>(
        `/api/delivery/review-requests/settings?${projectQuery(projectId ?? "")}`,
        { signal },
      ),
    enabled: !!projectId,
    staleTime: 60_000,
  });
}

/** PUT settings — đặt kết quả vào cache settings của project; preview phải tính lại (max_days đổi). */
export function useSaveReviewRequestSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReviewRequestSettingsUpdate) =>
      deliveryFetch<ReviewRequestSettings>("/api/delivery/review-requests/settings", jsonPost(body, "PUT")),
    onSuccess: (res, body) => {
      qc.setQueryData<ReviewRequestSettings>([...RR_KEY, "settings", body.project_id], res);
      void qc.invalidateQueries({ queryKey: [...RR_KEY, "preview"] });
    },
  });
}

/** Preview chạy tự động — luôn tính mới mỗi lần mở dialog (không cache, không retry). */
export function useReviewRequestPreview(projectId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [...RR_KEY, "preview", projectId],
    queryFn: ({ signal }) => {
      const body: ReviewRequestProjectBody = { project_id: projectId ?? "" };
      return deliveryFetch<ReviewRequestPreview>("/api/delivery/review-requests/preview", {
        ...jsonPost(body),
        signal,
      });
    },
    enabled: enabled && !!projectId,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/** Sau run/send: dòng bảng (badge) + summary đổi; preview cũ hết đúng. */
function useAfterReviewRequestQueued() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["delivery", "list"] });
    void qc.invalidateQueries({ queryKey: [...RR_KEY, "summary"] });
    qc.removeQueries({ queryKey: [...RR_KEY, "preview"] });
  };
}

export function useRunReviewRequests() {
  const afterQueued = useAfterReviewRequestQueued();
  return useMutation({
    mutationFn: (projectId: string) => {
      const body: ReviewRequestProjectBody = { project_id: projectId };
      return deliveryFetch<ReviewRequestRunResult>("/api/delivery/review-requests/run", jsonPost(body));
    },
    onSuccess: afterQueued,
  });
}

export function useSendReviewRequests() {
  const afterQueued = useAfterReviewRequestQueued();
  return useMutation({
    mutationFn: (body: ReviewRequestSendRequest) =>
      deliveryFetch<ReviewRequestSendResult>("/api/delivery/review-requests/send", jsonPost(body)),
    onSuccess: afterQueued,
  });
}

/** Đếm hàng đợi của project — hỏi lại 10s/lần khi còn tin chờ/đang gửi. */
export function useReviewRequestSummary(projectId: string | null) {
  return useQuery({
    queryKey: [...RR_KEY, "summary", projectId],
    queryFn: ({ signal }) =>
      deliveryFetch<ReviewRequestSummary>(
        `/api/delivery/review-requests/summary?${projectQuery(projectId ?? "")}`,
        { signal },
      ),
    enabled: !!projectId,
    refetchInterval: (q) => {
      const d = q.state.data;
      return d && d.queued + d.sending > 0 ? 10_000 : false;
    },
  });
}
