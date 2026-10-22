"use client";

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DoraScopeNote,
  ReviewErrorBox,
  ReviewProjectSelect,
  ReviewRequestModal,
  ReviewTemplatePreview,
  ReviewTemplateSelect,
  reviewProjectName,
  reviewRequestError,
} from "@/components/delivery/ReviewRequestModal";
import {
  useReviewRequestPreview,
  useReviewRequestSummary,
  useReviewRequestTemplates,
  useRunReviewRequests,
  useSendReviewRequests,
} from "@/lib/hooks/useDelivery";
import { formatDate } from "@/lib/delivery/deliveryTracking";
import {
  MANUAL_WARNING_LABEL,
  SEND_WARNING_LABEL,
  buildManualSendPlan,
  formatDateTimeVN,
  invalidTemplateMessage,
  invalidTemplateTokens,
  manualWarnings,
  pickReviewTemplate,
  reviewRequestProjectId,
  skipReasonLabel,
  skippedCountEntries,
  skippedCountsSummary,
} from "@/lib/delivery/reviewRequest";
import type { TrackingSelection } from "@/lib/delivery/trackingSelection";
import { REVIEW_REQUEST_DEFAULT_TEMPLATE_ID, REVIEW_REQUEST_TEMPLATE_MAX } from "@/lib/types/delivery";
import type {
  DeliveryProjectsResponse,
  DeliveryTracking,
  ReviewRequestPreviewSample,
  ReviewRequestRunResult,
  ReviewRequestSendResult,
  ReviewRequestSummary,
} from "@/lib/types/delivery";

/** Số dòng liệt kê trong toast cảnh báo/bỏ qua sau khi gửi tay. */
const TOAST_LIST_MAX = 5;
/** Số tin lỗi gần đây hiện ở chân dialog. */
const FAILED_SHOWN = 5;

export interface RequestReviewsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Project của bộ lọc UI ('' | hex | dora | dora:<store>). */
  project: string;
  selection: TrackingSelection;
  /** Dòng (đang có trong cache) của các mã đang chọn — mã ở trang chưa tải thì không có. */
  selectedRows: DeliveryTracking[];
  projects: DeliveryProjectsResponse | undefined;
  /** Gửi tay thành công → bỏ chọn. */
  onSent: () => void;
}

/**
 * Dialog "Request reviews" (plan request-reviews §6, §11, contract §4.3):
 * có mã đang chọn ⇒ GỬI TAY (chọn mẫu → đổ vào ô soạn); không chọn ⇒ CHẠY TỰ ĐỘNG cho project đang
 * xem (chọn mẫu bắt buộc → preview → xác nhận).
 */
export function RequestReviewsDialog(props: RequestReviewsDialogProps) {
  if (!props.open) return null;
  // Mount lại mỗi lần mở → nội dung soạn / project chọn không dính từ lần trước.
  return <RequestReviewsBody {...props} />;
}

function RequestReviewsBody({ onClose, project, selection, selectedRows, projects, onSent }: RequestReviewsDialogProps) {
  const mappedId = reviewRequestProjectId(project);
  const manual = selection.size > 0;
  const [picked, setPicked] = useState("");
  // Gửi tay không cần chọn project (vắng = mọi đơn của mã); tự động bắt buộc có project.
  const projectId = mappedId ?? (manual ? null : picked || null);
  const summary = useReviewRequestSummary(projectId);

  return (
    <ReviewRequestModal
      title={manual ? `Request reviews — gửi tay ${selection.size.toLocaleString()} mã` : "Request reviews — chạy tự động"}
      onClose={onClose}
      footer={<SummaryFooter projectId={projectId} data={summary.data} error={summary.error} />}
    >
      {manual ? (
        <ManualSend
          projectId={mappedId}
          selection={selection}
          selectedRows={selectedRows}
          onDone={() => {
            onSent();
            onClose();
          }}
        />
      ) : (
        <>
          {mappedId ? (
            <p className="text-muted-foreground">
              Project: <span className="font-medium text-foreground">{reviewProjectName(mappedId, projects)}</span>
            </p>
          ) : (
            <ReviewProjectSelect value={picked} onChange={setPicked} projects={projects} />
          )}
          <DoraScopeNote project={project} />
          {projectId ? (
            <AutoRun projectId={projectId} onDone={onClose} />
          ) : (
            <p className="text-muted-foreground">Chọn project để xem các đơn sẽ được gửi tin xin review.</p>
          )}
        </>
      )}
    </ReviewRequestModal>
  );
}

// ---- Gửi tay ----

function ManualSend({
  projectId,
  selection,
  selectedRows,
  onDone,
}: {
  /** project_id đã map của bộ lọc; null (Tất cả) = không giới hạn project. */
  projectId: string | null;
  selection: TrackingSelection;
  selectedRows: DeliveryTracking[];
  onDone: () => void;
}) {
  const [message, setMessage] = useState("");
  const [templateId, setTemplateId] = useState<string>(REVIEW_REQUEST_DEFAULT_TEMPLATE_ID);
  const templates = useReviewRequestTemplates();
  const send = useSendReviewRequests();
  // Giữ id đã chọn kể cả khi mẫu bị xoá ở nơi khác (QA MT-3): select hiện "(đã xoá)"; chỉ gửi được
  // khi ô soạn có nội dung (Mera dùng `message`, không cần mẫu còn tồn tại).
  const tpl = pickReviewTemplate(templates.data?.items, templateId);
  const templateMissing = !!templates.data && !tpl;
  const effectiveTemplateId = templateId;

  const rows = useMemo(() => selectedRows.filter((r) => selection.has(r.id)), [selectedRows, selection]);
  const offPage = Math.max(0, selection.size - rows.length);
  const warnings = useMemo(() => manualWarnings(rows), [rows]);
  const warnByOrder = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const w of warnings) {
      const k = `${w.order_id}\u0000${w.store}`;
      m.set(k, [...(m.get(k) ?? []), MANUAL_WARNING_LABEL[w.kind]]);
    }
    return m;
  }, [warnings]);

  // Biến sai dạng ({ buyer_name }, {shop-name}, {{…}}) sẽ tới tay khách nguyên văn → chặn gửi (QA B5).
  const badTokens = useMemo(() => invalidTemplateTokens(message), [message]);
  // tracking_id → code: Mera chỉ trả tracking_id cho lý do "not_found" (QA N1).
  const codeById = useMemo(() => new Map(rows.map((r) => [r.id, r.code])), [rows]);

  const placeholder = templateMissing
    ? "Mẫu đã bị xoá — chọn mẫu khác hoặc tự soạn nội dung"
    : tpl?.content || "Trống = dùng mẫu đang chọn";

  // §13: order_id bị bỏ tích (mặc định tích hết). Dialog mount lại mỗi lần mở → tự reset.
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const plan = useMemo(
    () =>
      buildManualSendPlan({
        selectionIds: [...selection.keys()],
        rows,
        excluded,
        templateId: effectiveTemplateId,
        message,
        projectId,
      }),
    [selection, rows, excluded, effectiveTemplateId, message, projectId],
  );
  const allOrderIds = useMemo(() => [...new Set(rows.flatMap((r) => r.orders.map((o) => o.order_id)))], [rows]);
  const toggleOrder = (orderId: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  const allIncluded = plan.included === plan.total;
  const toggleAll = () => setExcluded(allIncluded ? new Set(allOrderIds) : new Set());
  // Mã ở trang khác vẫn gửi (không biết đơn) → chỉ khoá nút khi không còn đơn nào và không có mã ngoài trang.
  const nothingToSend = plan.request.ids.length === 0 || (plan.included === 0 && offPage === 0);
  const blockedByTemplate = templateMissing && !message.trim();

  /** Chọn mẫu → đổ nội dung vào ô soạn (sửa tiếp được). Đang soạn khác mẫu cũ → hỏi trước khi thay. */
  const pickTemplate = (id: string) => {
    const next = pickReviewTemplate(templates.data?.items, id);
    const edited = message.trim() !== "" && message !== (tpl?.content ?? "");
    if (edited && !confirm("Thay nội dung đang soạn bằng mẫu vừa chọn?")) return;
    setTemplateId(id);
    setMessage(next?.content ?? "");
  };

  const handleSend = async () => {
    if (send.isPending || badTokens.length > 0 || nothingToSend || blockedByTemplate) return;
    try {
      // Ô soạn trống ⇒ Mera dùng mẫu `template_id`; có nội dung ⇒ dùng `message`, kèm `template_id`
      // để sổ ghi giữ mẫu gốc (§11). Đơn bỏ tích ⇒ bỏ mã / `exclude_order_ids` (§13).
      const res = await send.mutateAsync(plan.request);
      reportSendResult(res, codeById);
      onDone();
    } catch {
      // Lỗi hiện trong dialog (send.error) — giữ nội dung để gửi lại.
    }
  };

  return (
    <>
      <ReviewTemplateSelect
        value={effectiveTemplateId}
        onChange={pickTemplate}
        templates={templates.data?.items}
        loading={templates.isLoading}
      />
      {templates.error && <ReviewErrorBox error={templates.error} />}

      <div className="space-y-1">
        <label htmlFor="review-request-message" className="font-medium text-foreground">
          Nội dung
        </label>
        <textarea
          id="review-request-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={REVIEW_REQUEST_TEMPLATE_MAX}
          rows={6}
          placeholder={placeholder}
          className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 dark:bg-input/30"
        />
        <div className="flex justify-between gap-2 text-xs text-muted-foreground">
          <span>Để trống = gửi đúng mẫu đang chọn. Biến: {"{buyer_name}"}, {"{order_id}"}, {"{shop_name}"}.</span>
          <span className="whitespace-nowrap">
            {message.length}/{REVIEW_REQUEST_TEMPLATE_MAX}
          </span>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-medium text-foreground">Đơn sẽ gửi</div>
          {plan.total > 0 && (
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">
                Gửi <span className="font-medium text-foreground">{plan.included.toLocaleString()}</span> /{" "}
                {plan.total.toLocaleString()} đơn
              </span>
              <Button variant="ghost" size="xs" onClick={toggleAll}>
                {allIncluded ? "Bỏ chọn tất cả" : "Chọn tất cả"}
              </Button>
            </div>
          )}
        </div>
        <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
          {rows.length === 0 ? (
            <p className="px-3 py-2 text-muted-foreground">Không có dòng nào của các mã đã chọn trên trang đang tải.</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id} className="px-3 py-1.5">
                  <div className="font-mono text-xs text-muted-foreground">{r.code}</div>
                  {r.orders.length === 0 ? (
                    <div className="text-xs text-muted-foreground">Mã không có đơn</div>
                  ) : (
                    r.orders.map((o, i) => {
                      const warn = warnByOrder.get(`${o.order_id}\u0000${o.store}`);
                      const off = excluded.has(o.order_id);
                      return (
                        <label
                          key={`${o.order_id}-${i}`}
                          className={`flex cursor-pointer flex-wrap items-center gap-x-2 text-xs ${off ? "opacity-50" : ""}`}
                        >
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-primary"
                            checked={!off}
                            onChange={() => toggleOrder(o.order_id)}
                            aria-label={`Gửi đơn ${o.order_id}`}
                          />
                          <span className={`font-mono text-foreground ${off ? "line-through" : ""}`}>{o.order_id}</span>
                          <span className="text-muted-foreground">· {o.store || "—"}</span>
                          {warn && (
                            <span className="inline-flex items-center gap-1 text-warning">
                              <AlertTriangle className="h-3 w-3" />
                              {warn.join(", ")}
                            </span>
                          )}
                        </label>
                      );
                    })
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        {offPage > 0 && <p className="text-xs text-muted-foreground">+ {offPage.toLocaleString()} mã ở trang khác</p>}
        {warnings.length > 0 && (
          <p className="text-xs text-warning">
            {warnings.length.toLocaleString()} cảnh báo — vẫn gửi được (gửi tay không lọc theo hội thoại / review).
          </p>
        )}
      </div>

      {badTokens.length > 0 && <p className="text-xs text-destructive">{invalidTemplateMessage(badTokens)}</p>}

      <ReviewErrorBox error={send.error} />

      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={handleSend}
          disabled={send.isPending || nothingToSend || blockedByTemplate || badTokens.length > 0}
        >
          {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Gửi {plan.included.toLocaleString()} đơn
          {offPage > 0 && ` + ${offPage.toLocaleString()} mã trang khác`}
        </Button>
      </div>
    </>
  );
}

/**
 * Toast kết quả gửi tay: số tin xếp hàng + cảnh báo / bỏ qua (≤ TOAST_LIST_MAX dòng).
 * queued 0 → 1 toast cảnh báo kèm lý do (không phải toast xanh).
 */
function reportSendResult(res: ReviewRequestSendResult, codeById: Map<string, string>) {
  // §13: đơn người dùng tự bỏ tích ("excluded") không liệt kê như lỗi — chỉ đếm trung tính.
  const skipped = res.skipped.filter((s) => s.reason !== "excluded");
  const excludedCount = res.skipped.length - skipped.length;
  const excludedNote = excludedCount > 0 ? `Đã bỏ ${excludedCount.toLocaleString()} đơn khỏi danh sách` : "";
  const skippedLines = skipped.map((s) => {
    const who = s.order_id || s.tracking_code || codeById.get(s.tracking_id) || s.tracking_id || "—";
    return `${who}: ${skipReasonLabel(s.reason)}`;
  });
  if (res.queued > 0) {
    toast.success(`Đã xếp hàng ${res.queued.toLocaleString()} tin`, excludedNote ? { description: excludedNote } : undefined);
    if (skippedLines.length > 0) {
      toast.warning(`Bỏ qua ${skipped.length.toLocaleString()} đơn/mã`, { description: listLines(skippedLines) });
    }
  } else {
    toast.warning("Không xếp hàng được tin nào", {
      description:
        skippedLines.length > 0 ? listLines(skippedLines) : excludedNote || "Mera không trả lý do.",
    });
  }

  if (res.warnings.length > 0) {
    toast.warning(`${res.warnings.length.toLocaleString()} đơn có cảnh báo`, {
      description: listLines(
        res.warnings.map((w) => `${w.order_id || "—"}: ${SEND_WARNING_LABEL[w.kind] ?? w.kind}`),
      ),
    });
  }
}

/** Toast kết quả chạy tự động; queued 0 → cảnh báo kèm lý do bỏ qua. */
function reportRunResult(res: ReviewRequestRunResult) {
  const reasons = skippedCountsSummary(res.skipped);
  if (res.queued > 0) {
    const checking =
      res.checking > 0 ? ` (${res.checking.toLocaleString()} đơn kiểm lại hội thoại trước khi gửi)` : "";
    toast.success(
      `Đã xếp hàng ${res.queued.toLocaleString()} đơn${checking}`,
      reasons ? { description: `Bỏ qua: ${reasons}` } : undefined,
    );
  } else {
    toast.warning("Không xếp hàng đơn nào", {
      description: reasons ? `Bỏ qua: ${reasons}` : "Không có đơn ứng viên.",
    });
  }
}

function listLines(lines: string[]): React.ReactNode {
  const shown = lines.slice(0, TOAST_LIST_MAX);
  const more = lines.length - shown.length;
  return (
    <div className="space-y-0.5">
      {shown.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
      {more > 0 && <div>+{more.toLocaleString()} khác</div>}
    </div>
  );
}

// ---- Chạy tự động ----

function AutoRun({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [templateId, setTemplateId] = useState<string>(REVIEW_REQUEST_DEFAULT_TEMPLATE_ID);
  const templates = useReviewRequestTemplates();
  // Giữ id đã chọn kể cả khi mẫu bị xoá ở nơi khác (QA MT-3): select hiện "(đã xoá)", không xem trước /
  // không chạy cho tới khi chọn mẫu khác. Chưa tải xong → id đang chọn ("default").
  const tpl = pickReviewTemplate(templates.data?.items, templateId);
  const templateMissing = !!templates.data && !tpl;
  const effectiveTemplateId = templateId;
  const preview = useReviewRequestPreview(projectId, effectiveTemplateId, !templateMissing);
  const run = useRunReviewRequests();

  const handleRun = async () => {
    if (run.isPending || templateMissing) return;
    try {
      const res = await run.mutateAsync({ project_id: projectId, template_id: effectiveTemplateId });
      reportRunResult(res);
      onDone();
    } catch {
      // Lỗi hiện trong dialog (run.error).
    }
  };

  return (
    <>
      <ReviewTemplateSelect
        value={effectiveTemplateId}
        onChange={(id) => {
          setTemplateId(id);
          run.reset();
        }}
        templates={templates.data?.items}
        loading={templates.isLoading}
      />
      {templates.error && <ReviewErrorBox error={templates.error} />}
      {tpl && <ReviewTemplatePreview content={tpl.content} label="Nội dung sẽ gửi" />}

      {!templateMissing && <AutoRunPreview preview={preview} run={run} onRun={handleRun} />}
    </>
  );
}

function AutoRunPreview({
  preview,
  run,
  onRun,
}: {
  preview: ReturnType<typeof useReviewRequestPreview>;
  run: ReturnType<typeof useRunReviewRequests>;
  onRun: () => void;
}) {
  const data = preview.data;
  if (preview.isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Đang tính đơn ứng viên…
      </div>
    );
  }
  if (preview.error) {
    return (
      <div className="space-y-2">
        <ReviewErrorBox error={preview.error} />
        <Button variant="outline" onClick={() => void preview.refetch()}>
          Thử lại
        </Button>
      </div>
    );
  }
  if (!data) return null;
  // Mọi lý do > 0 (gồm send_blocked_env / shop_offline / … và key lạ — nhãn fallback = tên key).
  const skipped = skippedCountEntries(data.skipped, false);

  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2">
        <Stat label="Sẽ gửi" value={data.candidates} strong />
        <Stat
          label="Trong đó cần kiểm lại hội thoại trên Etsy"
          value={data.will_check_conversation}
          hint="Chưa thấy hội thoại — nhờ extension đọc lại từ Etsy trước khi gửi; có hội thoại thì bỏ qua."
        />
      </div>

      <div className="space-y-1">
        <div className="font-medium text-foreground">Bỏ qua</div>
        {skipped.length === 0 ? (
          <p className="text-xs text-muted-foreground">Không có.</p>
        ) : (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {skipped.map(([k, n]) => (
              <li key={k}>
                {skipReasonLabel(k)}: <span className="font-medium text-foreground">{n.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.sample.length > 0 && (
        <CandidateList sample={data.sample} candidates={data.candidates} truncated={data.sample_truncated} />
      )}

      <ReviewErrorBox error={run.error} />

      <div className="flex items-center justify-end gap-3">
        {data.candidates === 0 && <span className="text-xs text-muted-foreground">Không có đơn nào để gửi.</span>}
        <Button size="lg" onClick={onRun} disabled={run.isPending || data.candidates === 0}>
          {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Xác nhận gửi
        </Button>
      </div>
    </>
  );
}

/** Chiều cao 1 dòng danh sách ứng viên (px) — cố định để ảo hoá. */
const CANDIDATE_ROW_HEIGHT = 28;
const CANDIDATE_GRID = "grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_5.5rem_minmax(0,1.5fr)] gap-x-2 px-2";

/**
 * Toàn bộ đơn sẽ gửi (plan §14a: `sample` = mọi ứng viên, Mera cắt ở 5000 + `sample_truncated`).
 * Có thể tới hàng nghìn dòng → ảo hoá bằng @tanstack/react-virtual, header đứng ngoài vùng cuộn.
 */
function CandidateList({
  sample,
  candidates,
  truncated,
}: {
  sample: ReviewRequestPreviewSample[];
  candidates: number;
  truncated: boolean;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: sample.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CANDIDATE_ROW_HEIGHT,
    overscan: 12,
  });

  return (
    <div className="space-y-1">
      <div className="font-medium text-foreground">
        Đơn sẽ gửi{" "}
        <span className="font-normal text-muted-foreground">
          {truncated
            ? `(hiện ${sample.length.toLocaleString()} / ${candidates.toLocaleString()} đơn)`
            : `(${sample.length.toLocaleString()} đơn)`}
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-border text-xs">
        <div className={`${CANDIDATE_GRID} bg-secondary py-1 font-medium text-muted-foreground`}>
          <span>Order ID</span>
          <span>Shop</span>
          <span>Tracking</span>
          <span>Giao</span>
          <span>Hội thoại</span>
        </div>
        <div ref={parentRef} className="max-h-72 overflow-y-auto">
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((v) => {
              const s = sample[v.index];
              return (
                <div
                  key={v.key}
                  className={`${CANDIDATE_GRID} absolute left-0 top-0 w-full items-center border-b border-border`}
                  style={{ height: CANDIDATE_ROW_HEIGHT, transform: `translateY(${v.start}px)` }}
                >
                  <span className="truncate font-mono text-foreground">{s.order_id || "—"}</span>
                  <span className="truncate">{s.shop_name || s.store || "—"}</span>
                  <span className="truncate font-mono">{s.tracking_code || "—"}</span>
                  <span className="whitespace-nowrap">{formatDate(s.delivered_at)}</span>
                  <span className="truncate text-muted-foreground">
                    {s.has_conversation === true
                      ? "Đã có"
                      : s.has_conversation === false
                        ? "Chưa có — kiểm lại trước khi gửi"
                        : "Chưa xác định"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {truncated && (
        <p className="text-xs text-muted-foreground">
          Danh sách chỉ hiện {sample.length.toLocaleString()} đơn đầu (mới giao trước); &quot;Xác nhận gửi&quot; vẫn xếp
          hàng đủ {candidates.toLocaleString()} đơn.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, hint, strong }: { label: string; value: number; hint?: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2" title={hint}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={strong ? "text-xl font-semibold text-foreground" : "text-lg text-foreground"}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

// ---- Chân dialog: hàng đợi của project ----

function SummaryFooter({
  projectId,
  data,
  error,
}: {
  projectId: string | null;
  data: ReviewRequestSummary | undefined;
  error: unknown;
}) {
  if (!projectId) {
    return <p className="text-xs text-muted-foreground">Chọn một project trên bộ lọc để xem hàng đợi gửi.</p>;
  }
  if (error) return <p className="text-xs text-muted-foreground">Không đọc được hàng đợi: {reviewRequestError(error)}</p>;
  if (!data) {
    return (
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Đang tải hàng đợi…
      </p>
    );
  }
  const failed = data.failed_recent.slice(0, FAILED_SHOWN);
  return (
    <div className="space-y-1 text-xs">
      <p className="text-muted-foreground">
        Đang chờ <span className="font-medium text-foreground">{data.queued.toLocaleString()}</span>
        {data.checking > 0 && <> (trong đó kiểm hội thoại {data.checking.toLocaleString()})</>} · Đang gửi{" "}
        <span className="font-medium text-foreground">{data.sending.toLocaleString()}</span> · Đã gửi hôm nay{" "}
        <span className="font-medium text-foreground">{data.sent_today.toLocaleString()}</span>
      </p>
      {failed.length > 0 && (
        <div>
          <div className="text-destructive">Lỗi gần đây:</div>
          <ul className="space-y-0.5">
            {failed.map((f, i) => (
              <li key={`${f.order_id}-${i}`} className="text-muted-foreground">
                <span className="font-mono text-foreground">{f.order_id || "—"}</span> · {f.shop_name || "—"} —{" "}
                {f.unconfirmed === true ? (
                  <span
                    className="text-amber-700 dark:text-amber-300"
                    title="Không rõ buyer đã nhận tin chưa — hệ thống đang kiểm lại"
                  >
                    Chưa xác nhận{f.error ? ` (${f.error})` : ""}
                  </span>
                ) : (
                  <span className="text-destructive">{f.error || "lỗi không rõ"}</span>
                )}
                {f.at && <span> ({formatDateTimeVN(f.at)})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
