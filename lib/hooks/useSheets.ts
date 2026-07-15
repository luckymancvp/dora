"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  GoogleStatus,
  OrderRowMatch,
  ResolveOrderResponse,
  SheetConfigDTO,
} from "@/lib/types/sheets";
import type { OrderStatusDTO } from "@/lib/types/order-status";

/** Lỗi mang code để UI phân biệt "chưa kết nối Google". */
export class ApiError extends Error {
  code?: string;
  status: number;
  /** Object mới nhất từ server khi lỗi optimistic-lock (409 version_conflict) — dùng để refetch/remount. */
  latest?: unknown;
  constructor(status: number, message: string, code?: string, latest?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.latest = latest;
  }
}

/** Fetch JSON + ném ApiError mang code/latest. Export để useMera tái dùng cùng khuôn. */
export async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let code: string | undefined;
    let latest: unknown;
    let message = `${res.status}`;
    try {
      const data = (await res.json()) as { error?: string; code?: string; latest?: unknown };
      if (data.error) message = data.error;
      code = data.code;
      latest = data.latest;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message, code, latest);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ---- Google connection status ----
export function useGoogleStatus() {
  return useQuery({
    queryKey: ["google-status"],
    queryFn: () => jsonFetch<GoogleStatus>("/api/google/status"),
    staleTime: 30_000,
  });
}

// ---- Sheet configs (CRUD + sync) ----
export function useSheetConfigs() {
  const qc = useQueryClient();
  const key = ["sheet-configs"];
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      jsonFetch<{ configs: SheetConfigDTO[] }>("/api/sheets/configs").then((d) => d.configs),
  });

  const add = useMutation({
    mutationFn: (input: { url: string; dataTabName?: string; prefixTabName?: string }) =>
      jsonFetch<{ config: SheetConfigDTO }>("/api/sheets/configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<SheetConfigDTO> }) =>
      jsonFetch<{ config: SheetConfigDTO }>(`/api/sheets/configs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      jsonFetch<void>(`/api/sheets/configs/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const sync = useMutation({
    mutationFn: (id: string) =>
      jsonFetch<{ rowCount: number; lastSyncedAt: number | null }>(
        `/api/sheets/configs/${id}/sync`,
        { method: "POST" },
      ),
    onSuccess: invalidate,
  });

  return { configs: query.data ?? [], query, add, update, remove, sync };
}

// ---- Auto-sync định kỳ (2 phút/lần, không cần bấm nút) ----
// Poll endpoint sync-stale: server tự quyết sheet nào cần sync (TTL) + chống trùng (cờ atomic).
// Mount 1 lần ở Providers (toàn app). Sync xong → invalidate để UI Cài đặt & panel đơn cập nhật.
const AUTO_SYNC_INTERVAL_MS = 2 * 60 * 1000;

export function useSheetAutoSync(enabled: boolean) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["sheet-auto-sync"],
    queryFn: async () => {
      const res = await jsonFetch<{ synced: number; skipped: number; reason?: string }>(
        "/api/sheets/sync-stale",
        { method: "POST" },
      );
      // Có sheet vừa sync xong → chỉ làm mới bảng đếm ở trang Cài đặt.
      // CỐ Ý KHÔNG invalidate ["sheet-row"]: panel "Cập nhật Sheet" là trình soạn thảo,
      // refetch nền có thể đổi `sig` → remount MatchEditor → mất nội dung đang gõ dở.
      // Người dùng tự bấm nút 🔄 trên panel khi muốn kéo dữ liệu mới.
      if (res.synced > 0) {
        qc.invalidateQueries({ queryKey: ["sheet-configs"] });
      }
      return res;
    },
    enabled,
    refetchInterval: AUTO_SYNC_INTERVAL_MS,
    staleTime: AUTO_SYNC_INTERVAL_MS,
    retry: false,
  });
}

// ---- Resolve order rows ----
// Bỏ transactionId → trả TẤT CẢ dòng của đơn (receipt). Có transactionId → đúng 1 item.
export function useResolveSheetRow(params: {
  store: string;
  receiptId: number;
  transactionId?: number;
  enabled?: boolean;
}) {
  const { store, receiptId, transactionId, enabled = true } = params;
  return useQuery({
    queryKey: ["sheet-row", receiptId, transactionId ?? null],
    queryFn: () => {
      const qs = new URLSearchParams({ store, receiptId: String(receiptId) });
      if (transactionId != null) qs.set("transactionId", String(transactionId));
      return jsonFetch<ResolveOrderResponse>(`/api/sheets/resolve?${qs.toString()}`);
    },
    enabled: enabled && Number.isFinite(receiptId),
    staleTime: 30_000,
    retry: false,
  });
}

// ---- Update (write-back) ----
export function useUpdateSheetRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      configId: string;
      itemId: string;
      rowNumber: number;
      updates: Record<string, string>;
      expected?: Record<string, string>;
    }) =>
      jsonFetch<{ match: OrderRowMatch }>("/api/sheets/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      // Cập nhật cache resolve cho item này.
      qc.invalidateQueries({ queryKey: ["sheet-row"] });
      return data;
    },
  });
}

// ---- Order statuses (CRUD + nguồn cho dropdown Status) ----
export function useOrderStatuses() {
  const qc = useQueryClient();
  const key = ["order-statuses"];
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      jsonFetch<{ statuses: OrderStatusDTO[] }>("/api/order-statuses").then((d) => d.statuses),
    staleTime: 5 * 60_000,
  });

  const add = useMutation({
    mutationFn: (input: { name: string; color?: string; description?: string }) =>
      jsonFetch<{ status: OrderStatusDTO }>("/api/order-statuses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<OrderStatusDTO> }) =>
      jsonFetch<{ status: OrderStatusDTO }>(`/api/order-statuses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      jsonFetch<void>(`/api/order-statuses/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  return { statuses: query.data ?? [], query, add, update, remove };
}

/** Tên trạng thái (đã loại trùng, theo display_order) cho dropdown Status. */
export function useStatusNames(): string[] {
  const { statuses } = useOrderStatuses();
  const seen = new Set<string>();
  const names: string[] = [];
  for (const s of statuses) {
    if (s.name && !seen.has(s.name)) {
      seen.add(s.name);
      names.push(s.name);
    }
  }
  return names;
}
