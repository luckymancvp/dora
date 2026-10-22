"use client";

import { useEffect } from "react";
import { Loader2, X } from "lucide-react";
import { selectClass } from "@/components/delivery/DeliveryToolbar";
import { DeliveryApiError } from "@/lib/hooks/useDelivery";
import {
  REVIEW_PREVIEW_SAMPLE_VARS,
  renderReviewTemplate,
  reviewRequestErrorText,
} from "@/lib/delivery/reviewRequest";
import { DORA_PROJECT_ID, isDoraProjectId } from "@/lib/types/delivery";
import type { DeliveryProjectsResponse, ReviewRequestTemplate } from "@/lib/types/delivery";

/**
 * Phần dùng chung của các dialog Request reviews: khung modal (overlay fixed + Esc, khuôn drawer
 * hiện có — không thêm thư viện), select project (khi bộ lọc đang là "Tất cả"), select mẫu tin +
 * khung xem trước (§11), câu lỗi API.
 */

export function ReviewRequestModal({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Rộng hơn (dialog quản lý mẫu: danh sách + form cạnh nhau). */
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:pt-16">
        <div
          role="dialog"
          aria-modal="true"
          className={`pointer-events-auto flex max-h-[calc(100vh-6rem)] w-full ${wide ? "max-w-4xl" : "max-w-2xl"} flex-col rounded-xl border border-border bg-background shadow-xl`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Đóng"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">{children}</div>
          {footer && <div className="border-t border-border px-5 py-3">{footer}</div>}
        </div>
      </div>
    </>
  );
}

/** Tên hiển thị của project_id review-requests (hex | "dora"). */
export function reviewProjectName(projectId: string, projects: DeliveryProjectsResponse | undefined): string {
  if (projectId === DORA_PROJECT_ID) return "Dora";
  return projects?.projects.find((p) => p.id === projectId)?.name || projectId;
}

/**
 * Bộ lọc đang là `dora:<store>` — cài đặt/chạy tự động áp dụng cho CẢ Dora (Mera chỉ có project "dora").
 */
export function DoraScopeNote({ project }: { project: string }) {
  if (!isDoraProjectId(project) || project === DORA_PROJECT_ID) return null;
  return <p className="text-xs text-muted-foreground">Áp dụng cho toàn bộ Dora (mọi shop), không riêng shop đang lọc.</p>;
}

/** Select project bắt buộc (bộ lọc "Tất cả"): project Mera + "Dora" khi Mera hỗ trợ Dora. */
export function ReviewProjectSelect({
  value,
  onChange,
  projects,
}: {
  value: string;
  onChange: (projectId: string) => void;
  projects: DeliveryProjectsResponse | undefined;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="review-request-project" className="font-medium text-foreground">
        Project:
      </label>
      <select
        id="review-request-project"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${selectClass} min-w-[220px]`}
      >
        <option value="">— Chọn project —</option>
        {(projects?.projects ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        {projects?.doraShops != null && <option value={DORA_PROJECT_ID}>Dora</option>}
      </select>
    </div>
  );
}

/** Câu lỗi hiển thị cho mọi lỗi hook review-requests. */
export function reviewRequestError(e: unknown): string {
  if (e instanceof DeliveryApiError) return reviewRequestErrorText(e.body, e.message);
  return e instanceof Error ? e.message : "Lỗi không rõ";
}

export function ReviewErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {reviewRequestError(error)}
    </div>
  );
}

/**
 * Select mẫu tin (§11) — luôn có 1 mẫu được chọn (mặc định `default`). Đang tải / lỗi → chỉ hiện
 * mẫu đang chọn để form vẫn gửi được bằng `template_id` hiện tại. `value` không còn trong thư viện
 * (bị xoá ở nơi khác) → giữ nguyên, hiện option "(đã xoá)" + câu báo (QA MT-3); dialog tự khoá nút.
 */
export function ReviewTemplateSelect({
  value,
  onChange,
  templates,
  loading,
}: {
  value: string;
  onChange: (templateId: string) => void;
  templates: ReviewRequestTemplate[] | undefined;
  loading: boolean;
}) {
  const items = templates ?? [];
  const missing = items.length > 0 && !items.some((t) => t.id === value);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="review-request-template-select" className="font-medium text-foreground">
          Mẫu tin:
        </label>
        <select
          id="review-request-template-select"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={items.length === 0}
          className={`${selectClass} min-w-[260px] max-w-full`}
        >
          {items.length === 0 && <option value={value}>{loading ? "Đang tải mẫu…" : value}</option>}
          {missing && <option value={value}>(đã xoá) {value}</option>}
          {items.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title || t.id}
              {t.is_system ? " (mặc định)" : ""}
            </option>
          ))}
        </select>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {missing && <p className="text-xs text-destructive">Mẫu đang chọn đã bị xoá — chọn mẫu khác.</p>}
    </div>
  );
}

/** Khung "Xem trước" nội dung mẫu với dữ liệu mẫu (REVIEW_PREVIEW_SAMPLE_VARS). Trống → "—". */
export function ReviewTemplatePreview({ content, label = "Xem trước" }: { content: string; label?: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="font-medium text-foreground">
        {label}{" "}
        <span className="font-normal text-xs text-muted-foreground">
          (dữ liệu mẫu: {REVIEW_PREVIEW_SAMPLE_VARS.buyer_name} · {REVIEW_PREVIEW_SAMPLE_VARS.order_id} ·{" "}
          {REVIEW_PREVIEW_SAMPLE_VARS.shop_name})
        </span>
      </div>
      <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground">
        {content.trim() ? renderReviewTemplate(content, REVIEW_PREVIEW_SAMPLE_VARS) : "—"}
      </div>
    </div>
  );
}
