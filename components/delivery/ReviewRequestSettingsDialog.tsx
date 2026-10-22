"use client";

import { useRef, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DoraScopeNote,
  ReviewErrorBox,
  ReviewProjectSelect,
  ReviewRequestModal,
  reviewProjectName,
} from "@/components/delivery/ReviewRequestModal";
import { useReviewRequestSettings, useSaveReviewRequestSettings } from "@/lib/hooks/useDelivery";
import {
  REVIEW_PREVIEW_SAMPLE_VARS,
  formatDateTimeVN,
  invalidTemplateMessage,
  invalidTemplateTokens,
  renderReviewTemplate,
  reviewRequestProjectId,
  reviewRequestVariables,
} from "@/lib/delivery/reviewRequest";
import {
  REVIEW_REQUEST_MAX_DAYS_MAX,
  REVIEW_REQUEST_MAX_DAYS_MIN,
  REVIEW_REQUEST_TEMPLATE_MAX,
} from "@/lib/types/delivery";
import type { DeliveryProjectsResponse, ReviewRequestSettings } from "@/lib/types/delivery";

export interface ReviewRequestSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Project của bộ lọc UI ('' | hex | dora | dora:<store>). */
  project: string;
  projects: DeliveryProjectsResponse | undefined;
}

/**
 * Dialog "Cài đặt Request reviews" (plan §6): mẫu tin (chèn biến + xem trước) và `max_days`
 * theo project đang xem / Dora. Bộ lọc "Tất cả" → chọn project trong dialog.
 */
export function ReviewRequestSettingsDialog(props: ReviewRequestSettingsDialogProps) {
  if (!props.open) return null;
  return <SettingsBody {...props} />;
}

function SettingsBody({ onClose, project, projects }: ReviewRequestSettingsDialogProps) {
  const mappedId = reviewRequestProjectId(project);
  const [picked, setPicked] = useState("");
  const projectId = mappedId ?? (picked || null);
  const settings = useReviewRequestSettings(projectId);

  return (
    <ReviewRequestModal title="Cài đặt Request reviews" onClose={onClose}>
      {mappedId ? (
        <p className="text-muted-foreground">
          Project: <span className="font-medium text-foreground">{reviewProjectName(mappedId, projects)}</span>
        </p>
      ) : (
        <ReviewProjectSelect value={picked} onChange={setPicked} projects={projects} />
      )}
      <DoraScopeNote project={project} />

      {!projectId ? (
        <p className="text-muted-foreground">Chọn project để xem / sửa mẫu tin.</p>
      ) : settings.isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Đang tải cài đặt…
        </div>
      ) : settings.error ? (
        <div className="space-y-2">
          <ReviewErrorBox error={settings.error} />
          <Button variant="outline" onClick={() => void settings.refetch()}>
            Thử lại
          </Button>
        </div>
      ) : settings.data ? (
        // key theo project: đổi project → form khởi tạo lại từ cài đặt của project đó.
        <SettingsForm key={projectId} projectId={projectId} settings={settings.data} onSaved={onClose} />
      ) : null}
    </ReviewRequestModal>
  );
}

function SettingsForm({
  projectId,
  settings,
  onSaved,
}: {
  projectId: string;
  settings: ReviewRequestSettings;
  onSaved: () => void;
}) {
  const [template, setTemplate] = useState(settings.template);
  const [maxDays, setMaxDays] = useState(String(settings.max_days));
  const ref = useRef<HTMLTextAreaElement>(null);
  const save = useSaveReviewRequestSettings();
  const variables = reviewRequestVariables(settings);

  const days = Number(maxDays);
  const daysValid =
    Number.isInteger(days) && days >= REVIEW_REQUEST_MAX_DAYS_MIN && days <= REVIEW_REQUEST_MAX_DAYS_MAX;
  // Biến sai dạng sẽ tới tay khách nguyên văn (Mera chỉ bắt {chữ_cái}) → báo + khoá Lưu (QA B5).
  const badTokens = invalidTemplateTokens(template);
  // Mẫu trống = Mera dùng mẫu mặc định → xem trước theo mẫu mặc định.
  const previewSource = template.trim() ? template : settings.default_template;

  /** Chèn biến tại con trỏ (thay vùng đang bôi đen); quá giới hạn ký tự thì không chèn. */
  const insertVariable = (token: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? template.length;
    const end = el?.selectionEnd ?? template.length;
    const next = template.slice(0, start) + token + template.slice(end);
    if (next.length > REVIEW_REQUEST_TEMPLATE_MAX) {
      toast.warning(`Mẫu tin tối đa ${REVIEW_REQUEST_TEMPLATE_MAX} ký tự`);
      return;
    }
    setTemplate(next);
    const caret = start + token.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  const handleSave = async () => {
    if (save.isPending || !daysValid || badTokens.length > 0) return;
    try {
      await save.mutateAsync({ project_id: projectId, template, max_days: days });
      toast.success("Đã lưu cài đặt Request reviews");
      onSaved();
    } catch {
      // Lỗi hiện trong dialog (save.error).
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {settings.is_default && (
          <span className="rounded bg-secondary px-1.5 py-0.5 font-medium text-foreground">Đang dùng mặc định</span>
        )}
        {settings.updated_by && <span>Sửa bởi {settings.updated_by}</span>}
        {settings.updated_at && <span>lúc {formatDateTimeVN(settings.updated_at)}</span>}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="review-request-template" className="font-medium text-foreground">
            Mẫu tin
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTemplate(settings.default_template)}
            disabled={!settings.default_template || template === settings.default_template}
          >
            Dùng mẫu mặc định
          </Button>
        </div>
        <textarea
          id="review-request-template"
          ref={ref}
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          maxLength={REVIEW_REQUEST_TEMPLATE_MAX}
          rows={9}
          placeholder={settings.default_template || "Nội dung tin xin review…"}
          className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 dark:bg-input/30"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs text-muted-foreground">Chèn biến:</span>
            {variables.map((v) => (
              <Button key={v} variant="outline" size="xs" onClick={() => insertVariable(v)} className="font-mono">
                {v}
              </Button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            {template.length}/{REVIEW_REQUEST_TEMPLATE_MAX}
          </span>
        </div>
        {badTokens.length > 0 && <p className="text-xs text-destructive">{invalidTemplateMessage(badTokens)}</p>}
      </div>

      <div className="space-y-1">
        <div className="font-medium text-foreground">
          Xem trước{!template.trim() && <span className="font-normal text-muted-foreground"> (mẫu mặc định)</span>}
        </div>
        <div className="whitespace-pre-wrap rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground">
          {previewSource ? renderReviewTemplate(previewSource, REVIEW_PREVIEW_SAMPLE_VARS) : "—"}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="review-request-max-days" className="font-medium text-foreground">
          Đơn giao trong
        </label>
        <Input
          id="review-request-max-days"
          type="number"
          inputMode="numeric"
          min={REVIEW_REQUEST_MAX_DAYS_MIN}
          max={REVIEW_REQUEST_MAX_DAYS_MAX}
          step={1}
          value={maxDays}
          onChange={(e) => setMaxDays(e.target.value)}
          aria-invalid={!daysValid}
          className="h-9 w-20"
        />
        <span className="text-foreground">ngày gần nhất</span>
        {!daysValid && (
          <span className="text-xs text-destructive">
            Nhập số nguyên {REVIEW_REQUEST_MAX_DAYS_MIN}–{REVIEW_REQUEST_MAX_DAYS_MAX}
          </span>
        )}
      </div>

      <ReviewErrorBox error={save.error} />

      <div className="flex justify-end">
        <Button size="lg" onClick={handleSave} disabled={save.isPending || !daysValid || badTokens.length > 0}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Lưu
        </Button>
      </div>
    </>
  );
}
