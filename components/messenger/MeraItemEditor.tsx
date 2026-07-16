"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Loader2, Maximize2, RefreshCw, Save, X } from "lucide-react";
import {
  useMeraStatuses,
  useResolveMeraOrder,
  useUpdateMeraItem,
  useUpdateMeraNote,
} from "@/lib/hooks/useMera";
import { ApiError } from "@/lib/hooks/useSheets";
import {
  MERA_EDITABLE_ITEM_FIELDS,
  MERA_FULL_ITEM_FIELDS,
  MERA_STATUS_OPTIONS,
  type MeraItemUpdates,
  type MeraOrderItem,
  type MeraOrderSummary,
} from "@/lib/types/mera";
import { CopyCode, FieldInput } from "@/components/messenger/field-editors";

// Khoá field ảo cho Order Note (note nằm ở cấp ORDER trên Mera nhưng hiển thị
// trong card item để giữ đúng layout của Sheet editor cũ).
const NOTE_KEY = "orderNote";

// 3 field tracking gửi CÙNG NHAU khi có 1 field dirty (Mera thay nguyên object tracking).
const TRACKING_KEYS = ["trackingCode", "trackingCarrier", "trackingUrl"] as const;

/** Đọc giá trị hiển thị của 1 field (kể cả field ảo note + tracking lồng + quantity số). */
function fieldValue(item: MeraOrderItem, order: MeraOrderSummary, key: string): string {
  switch (key) {
    case NOTE_KEY:
      return order.note ?? "";
    case "trackingCode":
      return item.tracking?.code ?? "";
    case "trackingCarrier":
      return item.tracking?.carrier ?? "";
    case "trackingUrl":
      return item.tracking?.url ?? "";
    case "quantity":
      return item.quantity ? String(item.quantity) : "";
    default:
      return (item[key as keyof MeraOrderItem] as string) ?? "";
  }
}

/** Thông báo lỗi lưu Mera (toast) — tách riêng version_conflict để refetch. */
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

/** Hook dùng chung: lưu bộ field dirty (item PATCH + note PATCH nếu có) rồi toast. */
function useSaveMeraFields(item: MeraOrderItem, order: MeraOrderSummary, onSaved: () => void) {
  const updateItem = useUpdateMeraItem();
  const updateNote = useUpdateMeraNote();

  const save = async (
    dirtyKeys: string[],
    draft: Record<string, string>,
  ): Promise<boolean> => {
    if (dirtyKeys.length === 0) return false;
    // Tracking gửi trọn bộ 3 field khi có 1 field dirty (Mera thay nguyên object).
    let itemKeys = dirtyKeys.filter((k) => k !== NOTE_KEY);
    if (itemKeys.some((k) => (TRACKING_KEYS as readonly string[]).includes(k))) {
      itemKeys = [...new Set([...itemKeys, ...TRACKING_KEYS])];
    }
    const noteDirty = dirtyKeys.includes(NOTE_KEY);
    try {
      let splitApplied = false;
      if (itemKeys.length > 0) {
        const updates = Object.fromEntries(
          itemKeys.map((k) => [k, draft[k] ?? fieldValue(item, order, k)]),
        ) as MeraItemUpdates;
        const res = await updateItem.mutateAsync({
          target: "item",
          itemKey: item.itemKey,
          version: item.version,
          updates,
        });
        splitApplied = Boolean(res.splitApplied);
      }
      if (noteDirty) {
        await updateNote.mutateAsync({
          target: "order",
          orderId: order.orderId,
          version: order.version,
          note: draft[NOTE_KEY] ?? "",
        });
      }
      toast.success(
        `Cập nhật Mera thành công (${dirtyKeys.length} trường)` +
          (splitApplied ? " · đã bật split items trên Mera" : ""),
      );
      onSaved();
      return true;
    } catch (e) {
      meraSaveError(e, onSaved);
      return false;
    }
  };

  return { save, pending: updateItem.isPending || updateNote.isPending };
}

/** Popup sửa TOÀN BỘ field user-managed của item (mirror SheetRowDialog). */
function MeraRowDialog({
  item,
  order,
  statusOptions,
  onClose,
  onSaved,
}: {
  item: MeraOrderItem;
  order: MeraOrderSummary;
  statusOptions: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const allFields: { key: string; label: string }[] = [
    ...MERA_FULL_ITEM_FIELDS,
    { key: NOTE_KEY, label: "Order Note" },
  ];
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(allFields.map(({ key }) => [key, fieldValue(item, order, key)])),
  );
  const { save, pending } = useSaveMeraFields(item, order, onSaved);

  const dirty = allFields.filter(({ key }) => (draft[key] ?? "") !== fieldValue(item, order, key));

  const onSave = async () => {
    if (dirty.length === 0) {
      onClose();
      return;
    }
    const ok = await save(
      dirty.map(({ key }) => key),
      draft,
    );
    if (ok) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate font-bold text-foreground">{item.itemKey}</h3>
            <p className="truncate text-xs text-muted-foreground">
              Mera · {order.store || order.orderId}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Đóng"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="flex flex-col gap-3">
            {allFields.map(({ key, label }) => (
              <label key={key} className="block">
                <span className="mb-1 block text-xs font-semibold text-foreground">{label}</span>
                <FieldInput
                  field={label}
                  value={draft[key] ?? ""}
                  onChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
                  statusOptions={statusOptions}
                  multiline
                />
              </label>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-full bg-secondary px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            Đóng
          </button>
          <button
            onClick={onSave}
            disabled={pending}
            className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:bg-input-strong"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Lưu {dirty.length > 0 ? `(${dirty.length})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 1 item Mera khớp đơn — layout GIỐNG HỆT MatchEditor của Sheet:
 * header item_key + popup sửa toàn bộ field + form nhanh
 * Status / Order Note / Personalization / Customer Image / Design / Mockup.
 * Order Note thuộc cấp order trên Mera → lưu qua PATCH order, các field còn lại PATCH item.
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
  // Thứ tự field theo layout Sheet cũ: Status, Order Note, rồi các field còn lại.
  const displayFields: { key: string; label: string }[] = [
    ...MERA_EDITABLE_ITEM_FIELDS.filter(({ key }) => key === "status"),
    { key: NOTE_KEY, label: "Order Note" },
    ...MERA_EDITABLE_ITEM_FIELDS.filter(({ key }) => key !== "status"),
  ];

  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(displayFields.map(({ key }) => [key, fieldValue(item, order, key)])),
  );
  const [open, setOpen] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { save, pending } = useSaveMeraFields(item, order, onSaved);

  const dirtyFields = displayFields.filter(
    ({ key }) => (draft[key] ?? "") !== fieldValue(item, order, key),
  );

  const tracking = item.tracking;
  const hasTracking = Boolean(tracking?.code || tracking?.url);

  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      {/* Header item: ẩn/hiện riêng từng item + item_key + popup toàn bộ field */}
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
        <button
          onClick={() => setDialogOpen(true)}
          aria-label="Sửa toàn bộ field"
          title="Sửa toàn bộ field"
          className="shrink-0 text-muted-foreground hover:text-primary"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {open ? (
        <>
          {hasTracking ? (
            <div className="mt-2 flex items-start gap-1.5 text-xs">
              <span className="shrink-0 font-semibold text-foreground">Tracking:</span>
              {tracking.url ? (
                <a
                  href={tracking.url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-primary hover:underline"
                >
                  {tracking.code || tracking.url}
                  {tracking.carrier ? ` · ${tracking.carrier}` : ""}
                </a>
              ) : (
                <CopyCode
                  value={tracking.carrier ? `${tracking.code} · ${tracking.carrier}` : tracking.code}
                  className="break-all text-muted-foreground"
                />
              )}
            </div>
          ) : null}

          <div className="mt-2 flex flex-col gap-2.5">
            {displayFields.map(({ key, label }) => (
              <label key={key} className="block">
                <span className="mb-1 block text-xs font-semibold text-foreground">{label}</span>
                <FieldInput
                  field={label}
                  value={draft[key] ?? ""}
                  onChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
                  statusOptions={statusOptions}
                />
              </label>
            ))}
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <button
              onClick={() =>
                save(
                  dirtyFields.map(({ key }) => key),
                  draft,
                )
              }
              disabled={pending || dirtyFields.length === 0}
              className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:bg-input-strong"
            >
              {pending ? (
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

      {dialogOpen ? (
        <MeraRowDialog
          item={item}
          order={order}
          statusOptions={statusOptions}
          onClose={() => setDialogOpen(false)}
          onSaved={onSaved}
        />
      ) : null}
    </div>
  );
}

/** Card cập nhật Mera cho 1 ĐƠN (receipt) — layout giống hệt SheetReceiptEditor. */
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
                // key gồm version item + version order → remount fill dữ liệu mới sau khi lưu/conflict.
                <MeraItemMatchEditor
                  key={`${it.itemKey}-${it.version}-${order.version}`}
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
