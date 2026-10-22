"use client";

import { Download, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeliveryUtilsDropdown } from "@/components/delivery/DeliveryUtilsDropdown";
import { doraProjectLabel } from "@/lib/delivery/deliveryTracking";
import { DORA_PROJECT_ID, doraShopProjectId, isDoraProjectId } from "@/lib/types/delivery";
import type { DeliveryProjectsResponse } from "@/lib/types/delivery";

export const selectClass =
  "h-9 rounded-lg border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 dark:bg-input/30";

/**
 * Select Project (Tất cả · project Mera · "Dora" · "Dora - {shop} (n)") + nút Export XLSX + dropdown Utils
 * (Request reviews / Cài đặt Request reviews).
 * `doraShops === null` (Mera chưa có endpoint Dora) → ẩn option Dora (S3).
 */
export function DeliveryToolbar({
  project,
  projects,
  onProjectChange,
  exportProgress,
  exportDisabled,
  onExport,
  onRequestReviews,
  onReviewTemplates,
  onReviewSettings,
  selectedCount,
  loading,
  onReload,
}: {
  project: string;
  projects: DeliveryProjectsResponse | undefined;
  onProjectChange: (project: string) => void;
  /** null = không export; "12/340" = đang gom. */
  exportProgress: string | null;
  exportDisabled: boolean;
  onExport: () => void;
  onRequestReviews: () => void;
  onReviewTemplates: () => void;
  onReviewSettings: () => void;
  /** Số mã đang chọn (badge trên mục Request reviews). */
  selectedCount: number;
  /** Danh sách đang tải (không tính lần tải ngầm của Request reviews). */
  loading: boolean;
  onReload: () => void;
}) {
  const doraShops = projects?.doraShops ?? null;
  const showDora = doraShops !== null || isDoraProjectId(project);
  // Project/shop đang chọn qua URL nhưng không còn trong danh sách vẫn hiện để bỏ chọn được.
  const orphanDoraShop =
    isDoraProjectId(project) &&
    project !== DORA_PROJECT_ID &&
    !(doraShops ?? []).some((s) => doraShopProjectId(s.store) === project);
  const orphanProject =
    !!project && !isDoraProjectId(project) && !!projects && !projects.projects.some((p) => p.id === project);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      <Button
        variant="outline"
        size="lg"
        disabled={loading}
        onClick={onReload}
        title="Tải lại danh sách từ Mera (không đọc Etsy)"
      >
        <RefreshCw className="h-3.5 w-3.5" /> Tải lại
      </Button>
      <Button
        variant="outline"
        size="lg"
        onClick={onExport}
        disabled={exportProgress != null || exportDisabled}
        title="Export toàn bộ kết quả của bộ lọc đang chọn (mọi trang) ra XLSX — 1 dòng / item"
      >
        {exportProgress != null ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang export {exportProgress}
          </>
        ) : (
          <>
            <Download className="h-4 w-4" />
            Export XLSX
          </>
        )}
      </Button>
      <DeliveryUtilsDropdown
        onRequestReviews={onRequestReviews}
        onReviewTemplates={onReviewTemplates}
        onReviewSettings={onReviewSettings}
        selectedCount={selectedCount}
      />
      <label htmlFor="delivery-project" className="text-sm font-medium text-foreground">
        Project:
      </label>
      <select
        id="delivery-project"
        value={project}
        onChange={(e) => onProjectChange(e.target.value)}
        className={`${selectClass} min-w-[200px]`}
      >
        <option value="">Tất cả</option>
        {orphanProject && <option value={project}>{project}</option>}
        {(projects?.projects ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        {showDora && <option value={DORA_PROJECT_ID}>Dora</option>}
        {orphanDoraShop && <option value={project}>{doraProjectLabel(project)}</option>}
        {(doraShops ?? []).map((s) => (
          <option key={s.store} value={doraShopProjectId(s.store)}>
            Dora - {s.store} ({s.count.toLocaleString()})
          </option>
        ))}
      </select>
    </div>
  );
}
