"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { MobileMenuButton } from "@/components/sidebar";
import { BulkRefreshBar } from "@/components/delivery/BulkRefreshBar";
import { DeliveryEventsDrawer } from "@/components/delivery/DeliveryEventsDrawer";
import { DeliveryFilters } from "@/components/delivery/DeliveryFilters";
import { DeliveryPagination } from "@/components/delivery/DeliveryPagination";
import { DeliveryStatusTabs } from "@/components/delivery/DeliveryStatusTabs";
import { DeliveryTable } from "@/components/delivery/DeliveryTable";
import { DeliveryToolbar } from "@/components/delivery/DeliveryToolbar";
import { RequestReviewsDialog } from "@/components/delivery/RequestReviewsDialog";
import { ReviewRequestSettingsDialog } from "@/components/delivery/ReviewRequestSettingsDialog";
import { ReviewRequestTemplatesDialog } from "@/components/delivery/ReviewRequestTemplatesDialog";
import {
  DeliveryApiError,
  fetchDeliveryList,
  useDeliveryProjects,
  useDeliveryTrackings,
  useRefreshDelivery,
  useRefreshingDeliveryIds,
} from "@/lib/hooks/useDelivery";
import {
  deliveryStatusLabel,
  doraProjectLabel,
  isDeliveredReviewTab,
  parseTrackingUrl,
  refreshErrorMessage,
  refreshReviewSummary,
  trackingListParams,
  trackingUrlSearch,
  type TrackingUrlState,
} from "@/lib/delivery/deliveryTracking";
import { hasPendingReviewRequest } from "@/lib/delivery/reviewRequest";
import { exportTrackingXlsx } from "@/lib/delivery/trackingExport";
import { togglePage, toggleSelection, type TrackingSelection } from "@/lib/delivery/trackingSelection";
import type { BulkRefreshJob, DeliveryTracking, DeliveryTrackingListResponse } from "@/lib/types/delivery";

/**
 * Màn "Giao hàng" (/delivery) — tracking chung Mera ↔ dora-1, chép màn Tracking của Mera
 * (`mera-fulfill-frontend/src/pages/tracking/TrackingPage.tsx`).
 *
 * URL là nguồn sự thật của bộ lọc: đọc `window.location` lúc mount (không dùng useSearchParams để
 * khỏi cần Suspense boundary khi build — như trang Orders), ghi lại bằng `router.replace`.
 */
export function DeliveryPage() {
  // null = chưa đọc URL (SSR / lúc hydrate) → chưa gọi API với bộ lọc mặc định sai.
  // Chỉ dùng làm giá trị KHỞI TẠO của DeliveryScreen (sau đó state → URL một chiều).
  const search = useSyncExternalStore(noopSubscribe, readLocationSearch, readServerSearch);
  const initial = useMemo(
    () => (search == null ? null : parseTrackingUrl(new URLSearchParams(search))),
    [search],
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1600px] space-y-4 px-6 py-6">
        {initial ? (
          <DeliveryScreen initial={initial} />
        ) : (
          <>
            <DeliveryHeader />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang tải…
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const noopSubscribe = () => () => {};
const readLocationSearch = (): string | null => window.location.search;
const readServerSearch = (): string | null => null;

function DeliveryHeader({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <MobileMenuButton className="-ml-1" />
        <PackageCheck className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-foreground">Giao hàng</h1>
          <p className="text-sm text-muted-foreground">Trạng thái giao hàng theo mã tracking — dữ liệu đọc từ Etsy</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function DeliveryScreen({ initial }: { initial: TrackingUrlState }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<TrackingUrlState>(initial);

  // Bộ lọc → URL (reload / gửi link giữ nguyên). Chỉ replace khi khác URL hiện tại.
  useEffect(() => {
    const qs = trackingUrlSearch(filters).toString();
    if (qs === window.location.search.replace(/^\?/, "")) return;
    router.replace(qs ? `/delivery?${qs}` : "/delivery", { scroll: false });
  }, [filters, router]);

  const update = useCallback((patch: Partial<TrackingUrlState>) => {
    setFilters((cur) => {
      const next = { ...cur, ...patch };
      // Đổi bộ lọc bất kỳ (trừ chính trang) → về trang 1.
      if (patch.page === undefined) next.page = 1;
      return next;
    });
  }, []);

  const params = useMemo(() => trackingListParams(filters), [filters]);
  const list = useDeliveryTrackings(params);
  const projects = useDeliveryProjects();
  const data = list.data;
  // Lần tải ngầm (tự cập nhật badge Request reviews) không bật spinner; đổi bộ lọc / bấm "Tải lại" vẫn bật.
  const [manualReload, setManualReload] = useState(false);
  const reviewPolling = hasPendingReviewRequest(data?.items);
  const loading = list.isFetching && (!reviewPolling || list.isPlaceholderData || manualReload);
  const handleReload = useCallback(() => {
    setManualReload(true);
    void list.refetch().finally(() => setManualReload(false));
  }, [list]);
  const total = data?.total ?? 0;
  const showDelivered = isDeliveredReviewTab(filters.status);

  // ---- Làm mới 1 mã ----
  // mutateAsync (không dùng callback của mutate): nhiều dòng làm mới song song thì callback
  // per-call của mutate chỉ chạy cho lần gọi cuối → mất toast các dòng trước.
  const { mutateAsync: refreshAsync } = useRefreshDelivery();
  const refreshingIds = useRefreshingDeliveryIds();
  const handleRefresh = useCallback(
    async (row: DeliveryTracking) => {
      try {
        const d = await refreshAsync(row.id);
        toast.success(`${row.code}: ${deliveryStatusLabel(d.status)}${refreshReviewSummary(d.review_check)}`);
        // Đọc đánh giá lỗi không làm hỏng refresh — vận đơn đã cập nhật, chỉ cảnh báo phần review.
        if (d.review_error) toast.warning(`${row.code}: chưa đọc được đánh giá — ${d.review_error}`);
      } catch (e: unknown) {
        const apiErr = e instanceof DeliveryApiError ? e : null;
        const code = apiErr?.code ?? "";
        const fallback = e instanceof Error ? e.message : "";
        const msg = refreshErrorMessage(apiErr?.status, code, fallback, apiErr?.body.shop ?? "");
        if (apiErr?.status === 429 || code === "shop_busy") toast.warning(`${row.code}: ${msg}`);
        else toast.error(`${row.code}: ${msg}`);
        // Mera ghi last_error/last_error_at lên dòng sau 2 lỗi này → tải lại để thấy cảnh báo "dữ liệu có thể cũ".
        if (code === "shop_offline" || code === "etsy_read_failed") {
          void qc.invalidateQueries({ queryKey: ["delivery", "list"] });
          void qc.invalidateQueries({ queryKey: ["delivery", "detail", row.id] });
        }
      }
    },
    [refreshAsync, qc],
  );

  // ---- Copy ----
  const copyCode = useCallback((code: string) => {
    navigator.clipboard
      .writeText(code)
      .then(() => toast.success(`Đã copy ${code}`, { duration: 1500 }))
      .catch(() => toast.error("Không copy được"));
  }, []);
  // Copy Order ID — icon chuyển CheckCheck xanh 1.5s (như Mera).
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );
  const handleCopyId = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).catch(() => toast.error("Không copy được"));
    setCopiedId(text);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedId(null), 1500);
  }, []);

  // ---- Drawer ----
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const closeDrawer = useCallback(() => setDrawerId(null), []);
  const drawerRow = data?.items.find((r) => r.id === drawerId) ?? null;

  // ---- Chọn nhiều mã (≤50 / shop) — giữ qua các trang / bộ lọc ----
  const [selection, setSelection] = useState<TrackingSelection>(() => new Map());
  const pageRows = data?.items ?? [];
  const toggleRow = useCallback((row: DeliveryTracking) => setSelection((s) => toggleSelection(s, row)), []);
  const handleTogglePage = () => {
    const { next, skipped } = togglePage(selection, pageRows);
    setSelection(next);
    if (skipped > 0) toast.warning(`Bỏ qua ${skipped} mã vì shop đã chọn đủ 50`);
  };
  const handleBulkDone = useCallback(
    (job: BulkRefreshJob) => {
      const updated = job.shops.reduce((n, s) => n + s.updated, 0);
      const failed = job.shops.reduce((n, s) => n + s.failed, 0);
      const msg = `Làm mới hàng loạt xong: ${updated} mã cập nhật${failed ? `, ${failed} mã lỗi` : ""}`;
      if (failed) toast.warning(msg);
      else toast.success(msg);
      setSelection(new Map());
      void qc.invalidateQueries({ queryKey: ["delivery", "list"] });
      void qc.invalidateQueries({ queryKey: ["delivery", "detail"] });
    },
    [qc],
  );

  // ---- Request reviews (Utils) ----
  const [reviewDialog, setReviewDialog] = useState<"request" | "templates" | "settings" | null>(null);
  const closeReviewDialog = useCallback(() => setReviewDialog(null), []);
  // Gửi tay xong → bỏ chọn.
  const clearSelection = useCallback(() => setSelection(new Map()), []);
  const [selectedRows, setSelectedRows] = useState<DeliveryTracking[]>([]);
  // Lúc mở dialog: chụp dòng của các mã đang chọn từ MỌI list đang cache (lựa chọn giữ qua trang/bộ
  // lọc), trang hiện tại ưu tiên (mới nhất), bỏ trùng theo id. Mã ở trang chưa tải → dialog báo
  // "ở trang khác". Overlay modal chặn bảng nên lựa chọn không đổi khi dialog đang mở.
  const openRequestReviews = () => {
    const byId = new Map<string, DeliveryTracking>();
    const take = (items: DeliveryTracking[] | undefined) => {
      for (const it of items ?? []) if (selection.has(it.id) && !byId.has(it.id)) byId.set(it.id, it);
    };
    if (selection.size > 0) {
      take(data?.items);
      for (const [, d] of qc.getQueriesData<DeliveryTrackingListResponse>({ queryKey: ["delivery", "list"] })) {
        take(d?.items);
      }
    }
    setSelectedRows([...byId.values()]);
    setReviewDialog("request");
  };

  // ---- Export XLSX: toàn bộ kết quả của bộ lọc (mọi trang) ----
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const handleExport = async () => {
    if (exportProgress != null) return;
    setExportProgress("0");
    try {
      const projectId = filters.project;
      const projectName = !projectId
        ? "all"
        : doraProjectLabel(projectId) || projects.data?.projects.find((p) => p.id === projectId)?.name || projectId;
      const today = new Date().toISOString().slice(0, 10);
      const n = await exportTrackingXlsx(
        fetchDeliveryList,
        trackingListParams(filters, false),
        `tracking_${projectName.replace(/[^\w.-]+/g, "_")}${filters.status ? `_${filters.status}` : ""}_${today}.xlsx`,
        (done, all) => setExportProgress(`${done}/${all}`),
      );
      toast.success(`Đã export ${n.toLocaleString()} mã tracking`);
    } catch (e: unknown) {
      toast.error(`Export lỗi: ${e instanceof Error ? e.message : "không rõ"}`);
    } finally {
      setExportProgress(null);
    }
  };

  // ---- Phân trang ----
  const tableRef = useRef<HTMLDivElement>(null);
  const totalPages = Math.max(1, Math.ceil(total / filters.limit));
  const goPage = (p: number) => {
    update({ page: Math.min(Math.max(1, p), totalPages) });
    tableRef.current?.scrollTo({ top: 0 });
  };

  return (
    <>
      <DeliveryHeader>
        <DeliveryToolbar
          project={filters.project}
          projects={projects.data}
          // Shop/fulfill thuộc project — đổi project thì bỏ lọc shop/fulfill.
          onProjectChange={(project) => update({ project, store: "", provider: "" })}
          exportProgress={exportProgress}
          exportDisabled={data != null && total === 0}
          onExport={handleExport}
          onRequestReviews={openRequestReviews}
          onReviewTemplates={() => setReviewDialog("templates")}
          onReviewSettings={() => setReviewDialog("settings")}
          selectedCount={selection.size}
          loading={loading}
          onReload={handleReload}
        />
      </DeliveryHeader>

      {projects.error && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
          Không tải được danh sách project: {projects.error.message}
        </div>
      )}

      <DeliveryStatusTabs
        status={filters.status}
        counts={data?.counts}
        onChange={(status) => update({ status, rating: null })}
      />

      <DeliveryFilters filters={filters} data={data} onChange={update} />

      {list.error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {list.error.message || "Không tải được danh sách tracking"}
        </div>
      )}

      <BulkRefreshBar selection={selection} onClear={() => setSelection(new Map())} onDone={handleBulkDone} />

      <DeliveryTable
        ref={tableRef}
        rows={data?.items}
        loading={loading}
        refreshingIds={refreshingIds}
        selection={selection}
        onToggleRow={toggleRow}
        onTogglePage={handleTogglePage}
        onRefresh={handleRefresh}
        onCopyCode={copyCode}
        onOpenHistory={setDrawerId}
        copiedId={copiedId}
        onCopyId={handleCopyId}
        showDelivered={showDelivered}
      />

      <DeliveryPagination
        page={filters.page}
        limit={filters.limit}
        total={total}
        loading={loading}
        onPage={goPage}
        onLimit={(limit) => update({ limit })}
      />

      <DeliveryEventsDrawer
        tracking={drawerRow}
        onClose={closeDrawer}
        onRefresh={handleRefresh}
        refreshing={!!drawerRow && refreshingIds.has(drawerRow.id)}
      />

      <RequestReviewsDialog
        open={reviewDialog === "request"}
        onClose={closeReviewDialog}
        project={filters.project}
        selection={selection}
        selectedRows={selectedRows}
        projects={projects.data}
        onSent={clearSelection}
      />

      <ReviewRequestTemplatesDialog open={reviewDialog === "templates"} onClose={closeReviewDialog} />

      <ReviewRequestSettingsDialog
        open={reviewDialog === "settings"}
        onClose={closeReviewDialog}
        project={filters.project}
        projects={projects.data}
      />
    </>
  );
}
