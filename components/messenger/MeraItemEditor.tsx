"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Loader2, RefreshCw, Save } from "lucide-react";
import {
  useMeraStatuses,
  useResolveMeraOrder,
  useUpdateMera,
} from "@/lib/hooks/useMera";
import { ApiError } from "@/lib/hooks/useSheets";
import {
  MERA_FORM_FIELDS,
  MERA_STATUS_OPTIONS,
  type MeraOrderItem,
  type MeraOrderSummary,
} from "@/lib/types/mera";
import { CopyCode, FieldInput } from "@/components/messenger/field-editors";

/** Thông báo lỗi lưu Mera (toast) — tách riêng version_conflict để refetch/remount. */
function meraSaveError(e: unknown, onConflict: () => void) {
  if (e instanceof ApiError && e.code === "version_conflict") {
    toast.error("Dữ liệu đã bị sửa bởi người khác — đã tải lại dữ liệu mới");
    onConflict();
    return;
  }
  if (e instanceof ApiError && e.code === "mera_not_configured") {
    toast.error("Chưa cấu hình Mera API.");
    return;
  }
  if (e instanceof ApiError && e.code === "mera_unavailable") {
    toast.error("Không kết nối được Mera.");
    return;
  }
  toast.error(`Cập nhật Mera thất bại: ${e instanceof Error ? e.message : "lỗi không rõ"}`);
}

/**
 * 1 item Mera khớp đơn — form CỐ ĐỊNH như panel Sheet (MERA_FORM_FIELDS, label trùng tên
 * field Sheet để FieldInput giữ nguyên behavior). "Order Note" ghi vào `order_items.note`
 * (fieldKey `item_note`). Tracking chỉ đọc.
 */
function MeraItemMatchEditor({
  item,
  order,
  statusOptions,
  onSaved,
}: {
  item: MeraOrderItem;
  order: MeraOrderSummary;
  statusOptions: string[];
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(MERA_FORM_FIELDS.map((f) => [f.fieldKey, item.values[f.fieldKey] ?? ""])),
  );
  const [open, setOpen] = useState(true);
  const update = useUpdateMera();

  // Tracking (chỉ đọc) — hiện khi Mera có dữ liệu, trống thì ẩn.
  const trackingCode = (item.values["tracking.code"] ?? "").trim();
  const trackingUrl = (item.values["tracking.url"] ?? "").trim();

  const dirtyFields = MERA_FORM_FIELDS.filter(
    (f) => (draft[f.fieldKey] ?? "") !== (item.values[f.fieldKey] ?? ""),
  );

  const save = async () => {
    if (dirtyFields.length === 0) return;
    const updates = Object.fromEntries(
      dirtyFields.map((f) => [f.fieldKey, draft[f.fieldKey] ?? ""]),
    );
    try {
      const res = await update.mutateAsync({
        updates,
        itemKey: item.itemKey,
        itemVersion: item.version,
        orderId: order.orderId,
        orderVersion: order.version,
      });
      toast.success(
        `Cập nhật Mera thành công (${dirtyFields.length} trường)` +
          (res.splitApplied ? " · đã bật split items trên Mera" : ""),
      );
      onSaved();
    } catch (e) {
      meraSaveError(e, onSaved);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      {/* Header item: ẩn/hiện riêng từng item + item_key */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Thu gọn item" : "Mở item"}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={"h-3.5 w-3.5 transition-transform " + (open ? "" : "-rotate-90")} />
        </button>
        <CopyCode value={item.itemKey} className="flex-1 break-all text-xs font-bold text-foreground" />
        {!open && dirtyFields.length > 0 ? (
          <span className="shrink-0 text-[11px] text-warning-foreground">• chưa lưu</span>
        ) : null}
      </div>

      {open ? (
        <>
          {trackingCode || trackingUrl ? (
            <div className="mt-2 flex items-start gap-1.5 text-xs">
              <span className="shrink-0 font-semibold text-foreground">Tracking:</span>
              {trackingUrl ? (
                <a
                  href={trackingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-primary hover:underline"
                >
                  {trackingCode || trackingUrl}
                </a>
              ) : (
                <CopyCode value={trackingCode} className="break-all text-muted-foreground" />
              )}
            </div>
          ) : null}

          <div className="mt-2 flex flex-col gap-2.5">
            {MERA_FORM_FIELDS.map((f) => (
              <label key={f.fieldKey} className="block">
                <span className="mb-1 block text-xs font-semibold text-foreground">{f.label}</span>
                <FieldInput
                  field={f.label}
                  value={draft[f.fieldKey] ?? ""}
                  onChange={(v) => setDraft((d) => ({ ...d, [f.fieldKey]: v }))}
                  statusOptions={statusOptions}
                />
              </label>
            ))}
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <button
              onClick={save}
              disabled={update.isPending || dirtyFields.length === 0}
              className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:bg-input-strong"
            >
              {update.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Lưu
            </button>
            {dirtyFields.length > 0 ? (
              <span className="text-xs text-muted-foreground">{dirtyFields.length} thay đổi chưa lưu</span>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Card cập nhật Mera cho 1 ĐƠN (receipt) — liệt kê tất cả item của đơn, form như panel Sheet. */
export function MeraReceiptEditor({
  store,
  receiptId,
}: {
  store: string;
  receiptId: number;
}) {
  const [open, setOpen] = useState(true);

  const resolve = useResolveMeraOrder({ store, receiptId, enabled: open });
  const order = resolve.data?.order ?? null;
  const items = resolve.data?.items ?? [];
  const reason = resolve.data?.reason ?? null;

  // Status là CẤU HÌNH trên Mera (sửa được từ UI Mera) → fetch động, fallback hardcode.
  const statusesQuery = useMeraStatuses(open);
  const statusOptions = statusesQuery.data?.statuses?.length
    ? statusesQuery.data.statuses
    : [...MERA_STATUS_OPTIONS];

  const orderCode = order?.orderId || `#${receiptId}`;
  const busy = resolve.isFetching;

  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-2 p-2.5">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Thu gọn" : "Mở rộng"}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={"h-4 w-4 transition-transform " + (open ? "" : "-rotate-90")} />
        </button>
        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
          Mera
        </span>
        <CopyCode value={orderCode} className="flex-1 break-all text-xs font-bold text-foreground" />
        {open && items.length > 1 ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">{items.length} dòng</span>
        ) : null}
        <button
          onClick={() => resolve.refetch()}
          disabled={busy}
          aria-label="Làm mới"
          title="Tải lại từ Mera"
          className="shrink-0 text-muted-foreground hover:text-primary disabled:opacity-50"
        >
          <RefreshCw className={"h-3.5 w-3.5 " + (busy ? "animate-spin" : "")} />
        </button>
      </div>

      {open ? (
        <div className="border-t border-border p-2.5">
          {resolve.isLoading ? (
            <p className="text-xs text-muted-foreground">Đang tìm trên Mera…</p>
          ) : resolve.isError ? (
            (() => {
              const e = resolve.error;
              if (e instanceof ApiError && e.code === "mera_unavailable") {
                return <p className="text-xs text-destructive">Không kết nối được Mera.</p>;
              }
              return <p className="text-xs text-destructive">Lỗi tra cứu Mera.</p>;
            })()
          ) : !order ? (
            <p className="text-xs text-muted-foreground">
              {reason === "not_configured"
                ? "Chưa cấu hình Mera API (MERA_API_BASE_URL / MERA_INTERNAL_API_KEY)."
                : "Không tìm thấy đơn trên Mera."}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {items.map((it) => (
                // key gồm version item → remount fill dữ liệu mới sau khi lưu/conflict.
                <MeraItemMatchEditor
                  key={`${it.itemKey}-${it.version}`}
                  item={it}
                  order={order}
                  statusOptions={statusOptions}
                  onSaved={() => resolve.refetch()}
                />
              ))}
              {items.length === 0 ? (
                <p className="text-xs text-muted-foreground">Đơn không có item nào.</p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
