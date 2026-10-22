"use client";

import {
  keepPreviousData,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { buildDeliveryTrackingQuery } from "@/lib/delivery/deliveryTracking";
import { REVIEW_PENDING_POLL_MS, hasPendingReviewRequest } from "@/lib/delivery/reviewRequest";
import { REVIEW_REQUEST_DEFAULT_TEMPLATE_ID } from "@/lib/types/delivery";
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
  ReviewRequestPreviewRequest,
  ReviewRequestRunRequest,
  ReviewRequestRunResult,
  ReviewRequestSendRequest,
  ReviewRequestSendResult,
  ReviewRequestSettings,
  ReviewRequestSettingsUpdate,
  ReviewRequestSummary,
  ReviewRequestTemplate,
  ReviewRequestTemplateDeleteResult,
  ReviewRequestTemplateInput,
  ReviewRequestTemplateUpdate,
  ReviewRequestTemplatesResponse,
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
    // Còn đơn "Đang chờ gửi" (Request reviews) → tự tải lại tới khi worker Mera gửi xong.
    refetchInterval: (q) =>
      hasPendingReviewRequest(q.state.data?.items) ? REVIEW_PENDING_POLL_MS : false,
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
const RR_TEMPLATES_KEY = [...RR_KEY, "templates"] as const;

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

/** PUT settings (§11: chỉ max_days) — đặt kết quả vào cache settings của project; preview phải tính lại. */
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

/**
 * Preview chạy tự động — luôn tính mới mỗi lần mở dialog (không cache, không retry).
 * `templateId` (§11) nằm trong key: đổi mẫu = hỏi lại Mera (Mera kiểm mẫu còn tồn tại).
 */
export function useReviewRequestPreview(projectId: string | null, templateId: string, enabled: boolean) {
  const onTemplateError = useRefetchTemplatesOnNotFound();
  return useQuery({
    queryKey: [...RR_KEY, "preview", projectId, templateId],
    queryFn: async ({ signal }) => {
      const body: ReviewRequestPreviewRequest = { project_id: projectId ?? "", template_id: templateId };
      try {
        return await deliveryFetch<ReviewRequestPreview>("/api/delivery/review-requests/preview", {
          ...jsonPost(body),
          signal,
        });
      } catch (e) {
        onTemplateError(e);
        throw e;
      }
    },
    enabled: enabled && !!projectId,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/**
 * 404 `template_not_found` (mẫu vừa bị xoá ở nơi khác) từ preview / run / send → tải lại thư viện để
 * select hiện "(đã xoá)" (QA MT-3).
 */
function useRefetchTemplatesOnNotFound() {
  const qc = useQueryClient();
  return (e: unknown) => {
    if (e instanceof DeliveryApiError && e.code === "template_not_found") {
      void qc.invalidateQueries({ queryKey: RR_TEMPLATES_KEY });
    }
  };
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
  const onTemplateError = useRefetchTemplatesOnNotFound();
  return useMutation({
    mutationFn: (body: ReviewRequestRunRequest) =>
      deliveryFetch<ReviewRequestRunResult>("/api/delivery/review-requests/run", jsonPost(body)),
    onSuccess: afterQueued,
    onError: onTemplateError,
  });
}

export function useSendReviewRequests() {
  const afterQueued = useAfterReviewRequestQueued();
  const onTemplateError = useRefetchTemplatesOnNotFound();
  return useMutation({
    mutationFn: (body: ReviewRequestSendRequest) =>
      deliveryFetch<ReviewRequestSendResult>("/api/delivery/review-requests/send", jsonPost(body)),
    onSuccess: afterQueued,
    onError: onTemplateError,
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

// ---- §11 Thư viện mẫu tin (dùng chung mọi project + Dora) ----

const TEMPLATES_URL = "/api/delivery/review-requests/templates";

function templateUrl(id: string): string {
  return `${TEMPLATES_URL}/${encodeURIComponent(id)}`;
}

/** GET thư viện mẫu — `default` (is_system) đứng đầu. Dùng chung cho dialog quản lý + 2 dialog gửi. */
export function useReviewRequestTemplates() {
  return useQuery({
    queryKey: RR_TEMPLATES_KEY,
    queryFn: ({ signal }) => deliveryFetch<ReviewRequestTemplatesResponse>(TEMPLATES_URL, { signal }),
    staleTime: 60_000,
  });
}

/**
 * Sau tạo / sửa / xoá: vá cache ngay (form đọc lại mẫu vừa lưu, không nhấp nháy bản cũ) rồi hỏi lại
 * Mera để lấy thứ tự / người sửa chuẩn.
 */
function useAfterTemplateChanged() {
  const qc = useQueryClient();
  const refetch = () => void qc.invalidateQueries({ queryKey: RR_TEMPLATES_KEY });
  return {
    patch: (fn: (items: ReviewRequestTemplate[]) => ReviewRequestTemplate[]) => {
      qc.setQueryData<ReviewRequestTemplatesResponse>(RR_TEMPLATES_KEY, (old) =>
        old ? { ...old, items: fn(old.items) } : old,
      );
      refetch();
    },
    // Lỗi (vd template_not_found: mẫu vừa bị người khác xoá / duplicate_title) → danh sách có thể đã cũ.
    refetch,
  };
}

export function useCreateReviewRequestTemplate() {
  const after = useAfterTemplateChanged();
  return useMutation({
    mutationFn: (body: ReviewRequestTemplateInput) =>
      deliveryFetch<ReviewRequestTemplate>(TEMPLATES_URL, jsonPost(body)),
    onSuccess: (tpl) => after.patch((items) => [...items.filter((t) => t.id !== tpl.id), tpl]),
    onError: after.refetch,
  });
}

export function useUpdateReviewRequestTemplate() {
  const after = useAfterTemplateChanged();
  return useMutation({
    // §15: mẫu `default` chỉ gửi `{content}` (tiêu đề cố định) — `title` vắng thì không gửi.
    mutationFn: ({ id, title, content }: ReviewRequestTemplateUpdate & { id: string }) => {
      const body: ReviewRequestTemplateUpdate = title === undefined ? { content } : { title, content };
      return deliveryFetch<ReviewRequestTemplate>(templateUrl(id), jsonPost(body, "PUT"));
    },
    onSuccess: (tpl) => after.patch((items) => items.map((t) => (t.id === tpl.id ? tpl : t))),
    onError: after.refetch,
  });
}

export function useDeleteReviewRequestTemplate() {
  const after = useAfterTemplateChanged();
  return useMutation({
    mutationFn: (id: string) =>
      deliveryFetch<ReviewRequestTemplateDeleteResult>(templateUrl(id), { method: "DELETE" }),
    onSuccess: (_res, id) => after.patch((items) => items.filter((t) => t.id !== id)),
    onError: after.refetch,
  });
}

/** §15: POST /templates/default/reset — khôi phục nội dung gốc của mẫu mặc định hệ thống. */
export function useResetDefaultReviewRequestTemplate() {
  const after = useAfterTemplateChanged();
  return useMutation({
    mutationFn: () =>
      deliveryFetch<ReviewRequestTemplate>(`${templateUrl(REVIEW_REQUEST_DEFAULT_TEMPLATE_ID)}/reset`, {
        method: "POST",
      }),
    onSuccess: (tpl) => after.patch((items) => items.map((t) => (t.id === tpl.id ? tpl : t))),
    onError: after.refetch,
  });
}
