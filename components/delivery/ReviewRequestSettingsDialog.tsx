"use client";

import { useState } from "react";
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
import { formatDateTimeVN, reviewRequestProjectId } from "@/lib/delivery/reviewRequest";
import { REVIEW_REQUEST_MAX_DAYS_MAX, REVIEW_REQUEST_MAX_DAYS_MIN } from "@/lib/types/delivery";
import type { DeliveryProjectsResponse, ReviewRequestSettings } from "@/lib/types/delivery";

export interface ReviewRequestSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Project của bộ lọc UI ('' | hex | dora | dora:<store>). */
  project: string;
  projects: DeliveryProjectsResponse | undefined;
}

/**
 * Dialog "Cài đặt Request reviews" (plan §6, §11): chỉ còn `max_days` theo project đang xem / Dora —
 * mẫu tin chuyển sang thư viện chung (dialog "Mẫu tin Request reviews"). Bộ lọc "Tất cả" → chọn
 * project trong dialog.
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
        <p className="text-muted-foreground">Chọn project để xem / sửa cài đặt.</p>
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
  const [maxDays, setMaxDays] = useState(String(settings.max_days));
  const save = useSaveReviewRequestSettings();

  const days = Number(maxDays);
  const daysValid =
    Number.isInteger(days) && days >= REVIEW_REQUEST_MAX_DAYS_MIN && days <= REVIEW_REQUEST_MAX_DAYS_MAX;

  const handleSave = async () => {
    if (save.isPending || !daysValid) return;
    try {
      // §11: mẫu tin nằm ở thư viện, Mera mới bỏ qua `template`. Nhưng GET còn trả `template` (Mera bản cũ /
      // rollout lag) thì gửi lại NGUYÊN VĂN — Mera cũ ghi `template: ""` khi vắng, làm mất mẫu riêng của
      // project trước khi bước nhập thư viện kịp chạy (QA MT-1).
      await save.mutateAsync({
        project_id: projectId,
        max_days: days,
        ...(typeof settings.template === "string" ? { template: settings.template } : {}),
      });
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
      <p className="text-xs text-muted-foreground">
        Mẫu tin dùng chung mọi project — sửa ở Utils → &quot;Mẫu tin Request reviews&quot;, chọn mẫu lúc gửi.
      </p>

      <ReviewErrorBox error={save.error} />

      <div className="flex justify-end">
        <Button size="lg" onClick={handleSave} disabled={save.isPending || !daysValid}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Lưu
        </Button>
      </div>
    </>
  );
}
