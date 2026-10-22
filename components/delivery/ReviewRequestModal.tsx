"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { selectClass } from "@/components/delivery/DeliveryToolbar";
import { DeliveryApiError } from "@/lib/hooks/useDelivery";
import { reviewRequestErrorText } from "@/lib/delivery/reviewRequest";
import { DORA_PROJECT_ID, isDoraProjectId } from "@/lib/types/delivery";
import type { DeliveryProjectsResponse } from "@/lib/types/delivery";

/**
 * Phần dùng chung của 2 dialog Request reviews: khung modal (overlay fixed + Esc, khuôn drawer
 * hiện có — không thêm thư viện), select project (khi bộ lọc đang là "Tất cả"), câu lỗi API.
 */

export function ReviewRequestModal({
  title,
  onClose,
  children,
  footer,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
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
          className="pointer-events-auto flex max-h-[calc(100vh-6rem)] w-full max-w-2xl flex-col rounded-xl border border-border bg-background shadow-xl"
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
