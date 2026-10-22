"use client";

import { useRef, useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ReviewErrorBox,
  ReviewRequestModal,
  ReviewTemplatePreview,
} from "@/components/delivery/ReviewRequestModal";
import {
  DeliveryApiError,
  useCreateReviewRequestTemplate,
  useDeleteReviewRequestTemplate,
  useReviewRequestTemplates,
  useUpdateReviewRequestTemplate,
} from "@/lib/hooks/useDelivery";
import {
  formatDateTimeVN,
  invalidTemplateMessage,
  invalidTemplateTokens,
  pickReviewTemplate,
  reviewRequestVariables,
  normalizeReviewTemplateTitle,
  reviewTemplateTitleError,
  reviewTextLength,
} from "@/lib/delivery/reviewRequest";
import {
  REVIEW_REQUEST_DEFAULT_TEMPLATE_ID,
  REVIEW_REQUEST_TEMPLATE_MAX,
  REVIEW_REQUEST_TEMPLATE_TITLE_MAX,
} from "@/lib/types/delivery";
import type { ReviewRequestTemplateInput } from "@/lib/types/delivery";

/** Id giả của form "Thêm mẫu" (chưa lưu) — không trùng id Mera (ObjectId hex | "default"). */
const NEW_ID = "__new__";
const EMPTY: ReviewRequestTemplateInput = { title: "", content: "" };

export interface ReviewRequestTemplatesDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Dialog "Mẫu tin Request reviews" (plan §11): quản lý thư viện mẫu dùng chung mọi project + Dora —
 * danh sách, thêm / sửa / xoá (xác nhận), chèn biến, xem trước, kiểm biến như B5 + tiêu đề ≤ 100.
 * Mẫu hệ thống `default` chỉ xem. Có thay đổi chưa lưu → hỏi lại trước khi đổi mẫu / đóng.
 */
export function ReviewRequestTemplatesDialog(props: ReviewRequestTemplatesDialogProps) {
  if (!props.open) return null;
  // Mount lại mỗi lần mở → bản nháp không dính từ lần trước.
  return <TemplatesBody onClose={props.onClose} />;
}

function TemplatesBody({ onClose }: { onClose: () => void }) {
  const templates = useReviewRequestTemplates();
  const create = useCreateReviewRequestTemplate();
  const update = useUpdateReviewRequestTemplate();
  const remove = useDeleteReviewRequestTemplate();
  const ref = useRef<HTMLTextAreaElement>(null);

  const [selId, setSelId] = useState<string>(REVIEW_REQUEST_DEFAULT_TEMPLATE_ID);
  // null = chưa sửa gì → form hiện đúng mẫu đang chọn (không chép state từ props).
  const [draft, setDraft] = useState<ReviewRequestTemplateInput | null>(null);

  const items = templates.data?.items;
  const variables = reviewRequestVariables(templates.data);
  const isNew = selId === NEW_ID;
  const current = isNew ? null : pickReviewTemplate(items, selId);
  // Mẫu đang mở bị xoá ở nơi khác (refetch thấy mất) → không hiện bản nháp trong khung chỉ đọc; báo và
  // cho giữ bản nháp thành mẫu mới hoặc đóng (QA MT-3 / MT-9d).
  const deletedElsewhere = !isNew && !!items && !current;
  const source: ReviewRequestTemplateInput = current ? { title: current.title, content: current.content } : EMPTY;
  const value = draft ?? source;
  const readOnly = !isNew && (!current || current.is_system);
  const dirty = draft != null && (draft.title !== source.title || draft.content !== source.content);

  const titleErr = readOnly ? "" : reviewTemplateTitleError(value.title, items, current?.id ?? null);
  const badTokens = readOnly ? [] : invalidTemplateTokens(value.content);
  const contentEmpty = !value.content.trim();
  const pending = create.isPending || update.isPending || remove.isPending;
  const canSave = !readOnly && dirty && !titleErr && !contentEmpty && badTokens.length === 0 && !pending;
  const mutationError = isNew ? create.error : (update.error ?? remove.error);

  const resetMutations = () => {
    create.reset();
    update.reset();
    remove.reset();
  };

  /** Có bản nháp chưa lưu → hỏi trước khi bỏ. */
  const guard = (fn: () => void) => {
    if (dirty && !confirm("Bỏ các thay đổi chưa lưu?")) return;
    fn();
  };

  const select = (id: string) =>
    guard(() => {
      setSelId(id);
      setDraft(null);
      resetMutations();
    });

  const handleClose = () => guard(onClose);

  const edit = (patch: Partial<ReviewRequestTemplateInput>) => setDraft({ ...value, ...patch });

  /** Chèn biến tại con trỏ (thay vùng đang bôi đen); quá giới hạn ký tự thì không chèn. */
  const insertVariable = (token: string) => {
    if (readOnly) return;
    const el = ref.current;
    const text = value.content;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + token + text.slice(end);
    if (next.length > REVIEW_REQUEST_TEMPLATE_MAX) {
      toast.warning(`Mẫu tin tối đa ${REVIEW_REQUEST_TEMPLATE_MAX} ký tự`);
      return;
    }
    edit({ content: next });
    const caret = start + token.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  const handleSave = async () => {
    if (!canSave) return;
    const input: ReviewRequestTemplateInput = { title: normalizeReviewTemplateTitle(value.title), content: value.content };
    try {
      if (isNew) {
        const tpl = await create.mutateAsync(input);
        toast.success(`Đã tạo mẫu "${tpl.title}"`);
        setSelId(tpl.id);
      } else if (current) {
        const tpl = await update.mutateAsync({ id: current.id, ...input });
        toast.success(`Đã lưu mẫu "${tpl.title}"`);
        setSelId(tpl.id);
      }
      setDraft(null);
    } catch (e) {
      // Mẫu vừa bị xoá ở nơi khác → giữ nội dung đang soạn thành form "Thêm mẫu" để lưu lại được.
      if (!isNew && e instanceof DeliveryApiError && e.code === "template_not_found") {
        setSelId(NEW_ID);
        setDraft(input);
        update.reset();
        toast.warning("Mẫu đã bị xoá — nội dung đang soạn được giữ lại dưới dạng mẫu mới");
      }
      // Lỗi khác hiện trong dialog (mutationError).
    }
  };

  const handleDelete = async () => {
    if (!current || current.is_system || pending) return;
    if (!confirm(`Xoá mẫu "${current.title}"? Trigger đang dùng mẫu này sẽ chạy lỗi cho tới khi chọn mẫu khác.`)) {
      return;
    }
    try {
      await remove.mutateAsync(current.id);
      toast.success(`Đã xoá mẫu "${current.title}"`);
      setSelId(REVIEW_REQUEST_DEFAULT_TEMPLATE_ID);
      setDraft(null);
    } catch {
      // Lỗi hiện trong dialog (mutationError).
    }
  };

  return (
    <ReviewRequestModal wide title="Mẫu tin Request reviews" onClose={handleClose}>
      <p className="text-xs text-muted-foreground">
        Thư viện dùng chung cho mọi project và Dora. Chọn mẫu khi gửi tay, khi chạy tự động và trong cấu hình trigger.
      </p>

      {templates.isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Đang tải mẫu tin…
        </div>
      ) : templates.error && !templates.data ? (
        <div className="space-y-2">
          <ReviewErrorBox error={templates.error} />
          <Button variant="outline" onClick={() => void templates.refetch()}>
            Thử lại
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[15rem_minmax(0,1fr)]">
          {/* ---- Danh sách ---- */}
          <div className="space-y-2">
            <Button variant="outline" size="sm" className="w-full" onClick={() => select(NEW_ID)} disabled={isNew}>
              <Plus className="h-3.5 w-3.5" /> Thêm mẫu
            </Button>
            <ul className="max-h-[55vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {isNew && (
                <li className="bg-primary/10 px-3 py-2 text-sm font-medium text-primary">Mẫu mới (chưa lưu)</li>
              )}
              {(items ?? []).length === 0 && !isNew && (
                <li className="px-3 py-2 text-xs text-muted-foreground">Chưa có mẫu nào.</li>
              )}
              {(items ?? []).map((t) => {
                const active = !isNew && current?.id === t.id;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => !active && select(t.id)}
                      className={`w-full px-3 py-2 text-left transition-colors ${active ? "bg-primary/10" : "hover:bg-muted"}`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`min-w-0 flex-1 truncate text-sm ${active ? "font-medium text-primary" : "text-foreground"}`}>
                          {t.title || t.id}
                        </span>
                        {t.is_system && (
                          <span className="shrink-0 rounded bg-secondary px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
                            Hệ thống
                          </span>
                        )}
                      </div>
                      {(t.updated_by || t.updated_at) && (
                        <div className="truncate text-[11px] text-muted-foreground">
                          {[t.updated_by, formatDateTimeVN(t.updated_at)].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* ---- Form ---- */}
          {deletedElsewhere ? (
            <div className="min-w-0 space-y-3">
              <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
                Mẫu đang mở đã bị xoá ở nơi khác.
                {dirty ? " Nội dung đang soạn chưa lưu — có thể giữ lại thành mẫu mới." : ""}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSelId(REVIEW_REQUEST_DEFAULT_TEMPLATE_ID);
                    setDraft(null);
                    resetMutations();
                  }}
                >
                  {dirty ? "Bỏ bản nháp" : "Đóng mẫu"}
                </Button>
                {dirty && (
                  <Button
                    onClick={() => {
                      setSelId(NEW_ID);
                      resetMutations();
                    }}
                  >
                    <Plus className="h-4 w-4" /> Giữ thành mẫu mới
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {isNew ? (
                  <span>Mẫu mới</span>
                ) : current?.is_system ? (
                  <span className="rounded bg-secondary px-1.5 py-0.5 font-medium text-foreground">
                    Mẫu mặc định của hệ thống — chỉ xem, không sửa / xoá
                  </span>
                ) : current ? (
                  <>
                    {current.created_by && <span>Tạo bởi {current.created_by}</span>}
                    {current.updated_by && <span>· Sửa bởi {current.updated_by}</span>}
                    {current.updated_at && <span>lúc {formatDateTimeVN(current.updated_at)}</span>}
                  </>
                ) : null}
              </div>

              <div className="space-y-1">
                <label htmlFor="review-template-title" className="font-medium text-foreground">
                  Tiêu đề
                </label>
                <Input
                  id="review-template-title"
                  value={value.title}
                  onChange={(e) => edit({ title: e.target.value })}
                  readOnly={readOnly}
                  placeholder="vd: Xin review — giọng thân thiện"
                  aria-invalid={draft != null && !!titleErr}
                  className="h-9"
                />
                <div className="flex justify-between gap-2 text-xs">
                  <span className="text-destructive">{draft != null ? titleErr : ""}</span>
                  {!readOnly && (
                    <span className="whitespace-nowrap text-muted-foreground">
                      {reviewTextLength(normalizeReviewTemplateTitle(value.title))}/{REVIEW_REQUEST_TEMPLATE_TITLE_MAX}
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="review-template-content" className="font-medium text-foreground">
                  Nội dung
                </label>
                <textarea
                  id="review-template-content"
                  ref={ref}
                  value={value.content}
                  onChange={(e) => edit({ content: e.target.value })}
                  readOnly={readOnly}
                  maxLength={REVIEW_REQUEST_TEMPLATE_MAX}
                  rows={8}
                  placeholder="Nội dung tin xin review…"
                  className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground read-only:bg-secondary/40 focus:outline-none focus:ring-2 focus:ring-ring/50 dark:bg-input/30"
                />
                {!readOnly && (
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
                      {value.content.length}/{REVIEW_REQUEST_TEMPLATE_MAX}
                    </span>
                  </div>
                )}
                {badTokens.length > 0 && <p className="text-xs text-destructive">{invalidTemplateMessage(badTokens)}</p>}
                {!readOnly && draft != null && contentEmpty && (
                  <p className="text-xs text-destructive">Nhập nội dung mẫu</p>
                )}
              </div>

              <ReviewTemplatePreview content={value.content} />

              <ReviewErrorBox error={mutationError} />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  {!isNew && current && !current.is_system && (
                    <Button variant="destructive" onClick={handleDelete} disabled={pending}>
                      {remove.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      Xoá
                    </Button>
                  )}
                </div>
                {!readOnly && (
                  <div className="flex items-center gap-2">
                    {dirty && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setDraft(null);
                          resetMutations();
                        }}
                        disabled={pending}
                      >
                        Huỷ thay đổi
                      </Button>
                    )}
                    <Button size="lg" onClick={handleSave} disabled={!canSave}>
                      {create.isPending || update.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      {isNew ? "Tạo mẫu" : "Lưu"}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </ReviewRequestModal>
  );
}
