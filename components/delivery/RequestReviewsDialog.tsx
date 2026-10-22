"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DoraScopeNote,
  ReviewErrorBox,
  ReviewProjectSelect,
  ReviewRequestModal,
  reviewProjectName,
  reviewRequestError,
} from "@/components/delivery/ReviewRequestModal";
import {
  useReviewRequestPreview,
  useReviewRequestSettings,
  useReviewRequestSummary,
  useRunReviewRequests,
  useSendReviewRequests,
} from "@/lib/hooks/useDelivery";
import { formatDate } from "@/lib/delivery/deliveryTracking";
import {
  MANUAL_WARNING_LABEL,
  SEND_WARNING_LABEL,
  formatDateTimeVN,
  invalidTemplateMessage,
  invalidTemplateTokens,
  manualWarnings,
  reviewRequestProjectId,
  skipReasonLabel,
  skippedCountEntries,
  skippedCountsSummary,
} from "@/lib/delivery/reviewRequest";
import type { TrackingSelection } from "@/lib/delivery/trackingSelection";
import { REVIEW_REQUEST_TEMPLATE_MAX } from "@/lib/types/delivery";
import type {
  DeliveryProjectsResponse,
  DeliveryTracking,
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
 * Dialog "Request reviews" (plan request-reviews §6, contract §4.3):
 * có mã đang chọn ⇒ GỬI TAY; không chọn ⇒ CHẠY TỰ ĐỘNG cho project đang xem (preview → xác nhận).
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
  const settings = useReviewRequestSettings(projectId);
  const send = useSendReviewRequests();

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

  const placeholder = projectId
    ? settings.data?.template || settings.data?.default_template || "Trống = dùng mẫu của project"
    : "Trống = dùng mẫu của từng project";

  const handleSend = async () => {
    if (send.isPending || badTokens.length > 0) return;
    const text = message.trim();
    try {
      const res = await send.mutateAsync({
        ids: [...selection.keys()],
        ...(text ? { message: text } : {}),
        ...(projectId ? { project_id: projectId } : {}),
      });
      reportSendResult(res, codeById);
      onDone();
    } catch {
      // Lỗi hiện trong dialog (send.error) — giữ nội dung để gửi lại.
    }
  };

  return (
    <>
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
          <span>Để trống = dùng mẫu đã cài của project từng đơn. Biến: {"{buyer_name}"}, {"{order_id}"}, {"{shop_name}"}.</span>
          <span className="whitespace-nowrap">
            {message.length}/{REVIEW_REQUEST_TEMPLATE_MAX}
          </span>
        </div>
      </div>

      <div className="space-y-1">
        <div className="font-medium text-foreground">Đơn sẽ gửi</div>
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
                      return (
                        <div key={`${o.order_id}-${i}`} className="flex flex-wrap items-center gap-x-2 text-xs">
                          <span className="font-mono text-foreground">{o.order_id}</span>
                          <span className="text-muted-foreground">· {o.store || "—"}</span>
                          {warn && (
                            <span className="inline-flex items-center gap-1 text-warning">
                              <AlertTriangle className="h-3 w-3" />
                              {warn.join(", ")}
                            </span>
                          )}
                        </div>
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
        <Button size="lg" onClick={handleSend} disabled={send.isPending || selection.size === 0 || badTokens.length > 0}>
          {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Gửi
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
  const skippedLines = res.skipped.map((s) => {
    const who = s.order_id || s.tracking_code || codeById.get(s.tracking_id) || s.tracking_id || "—";
    return `${who}: ${skipReasonLabel(s.reason)}`;
  });
  if (res.queued > 0) {
    toast.success(`Đã xếp hàng ${res.queued.toLocaleString()} tin`);
    if (skippedLines.length > 0) {
      toast.warning(`Bỏ qua ${res.skipped.length.toLocaleString()} đơn/mã`, { description: listLines(skippedLines) });
    }
  } else {
    toast.warning("Không xếp hàng được tin nào", {
      description: skippedLines.length > 0 ? listLines(skippedLines) : "Mera không trả lý do.",
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
  const preview = useReviewRequestPreview(projectId, true);
  const run = useRunReviewRequests();
  const data = preview.data;

  const handleRun = async () => {
    if (run.isPending) return;
    try {
      const res = await run.mutateAsync(projectId);
      reportRunResult(res);
      onDone();
    } catch {
      // Lỗi hiện trong dialog (run.error).
    }
  };

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
        <div className="space-y-1">
          <div className="font-medium text-foreground">
            Đơn mẫu ({Math.min(data.sample.length, 20).toLocaleString()} / {data.candidates.toLocaleString()})
          </div>
          <div className="max-h-64 overflow-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-secondary text-left text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 font-medium">Order ID</th>
                  <th className="px-2 py-1 font-medium">Shop</th>
                  <th className="px-2 py-1 font-medium">Tracking</th>
                  <th className="px-2 py-1 font-medium">Giao</th>
                  <th className="px-2 py-1 font-medium">Hội thoại</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.sample.slice(0, 20).map((s, i) => (
                  <tr key={`${s.order_id}-${i}`}>
                    <td className="px-2 py-1 font-mono text-foreground">{s.order_id || "—"}</td>
                    <td className="px-2 py-1">{s.shop_name || s.store || "—"}</td>
                    <td className="px-2 py-1 font-mono">{s.tracking_code || "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1">{formatDate(s.delivered_at)}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-muted-foreground">
                      {s.has_conversation === true
                        ? "Đã có"
                        : s.has_conversation === false
                          ? "Chưa có — kiểm lại trước khi gửi"
                          : "Chưa xác định"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ReviewErrorBox error={run.error} />

      <div className="flex items-center justify-end gap-3">
        {data.candidates === 0 && <span className="text-xs text-muted-foreground">Không có đơn nào để gửi.</span>}
        <Button size="lg" onClick={handleRun} disabled={run.isPending || data.candidates === 0}>
          {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Xác nhận gửi
        </Button>
      </div>
    </>
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
