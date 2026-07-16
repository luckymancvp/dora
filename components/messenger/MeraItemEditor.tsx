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
  MERA_STATUS_OPTIONS,
  type MeraColumn,
  type MeraOrderItem,
  type MeraOrderSummary,
} from "@/lib/types/mera";
import { CopyCode, MeraFieldRenderer } from "@/components/messenger/field-editors";

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
 * Lưới field động: render mỗi cột bằng MeraFieldRenderer (chọn editor theo fieldKey).
 * Đọc value từ `values[fieldKey]`; server đã tính `editable` → client render "câm".
 */
function MeraFieldsGrid({
  columns,
  draft,
  setDraft,
  statusOptions,
}: {
  columns: MeraColumn[];
  draft: Record<string, string>;
  setDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  statusOptions: string[];
}) {
  return (
    <div className="mt-2 flex flex-col gap-2.5">
      {columns.map((col) => (
        <label key={col.fieldKey} className="block">
          <span className="mb-1 block text-xs font-semibold text-foreground">{col.label}</span>
          <MeraFieldRenderer
            fieldKey={col.fieldKey}
            value={draft[col.fieldKey] ?? ""}
            onChange={(v) => setDraft((d) => ({ ...d, [col.fieldKey]: v }))}
            editable={col.editable}
            statusOptions={statusOptions}
          />
        </label>
      ))}
    </div>
  );
}

/** Nút Lưu + đếm số field chưa lưu (dùng chung cho order-scope & item-scope). */
function SaveBar({
  dirtyCount,
  pending,
  onSave,
}: {
  dirtyCount: number;
  pending: boolean;
  onSave: () => void;
}) {
  return (
    <div className="mt-2.5 flex items-center gap-2">
      <button
        onClick={onSave}
        disabled={pending || dirtyCount === 0}
        className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:bg-input-strong"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        Lưu
      </button>
      {dirtyCount > 0 ? (
        <span className="text-xs text-muted-foreground">{dirtyCount} thay đổi chưa lưu</span>
      ) : null}
    </div>
  );
}

/**
 * Section ORDER-scope: render 1 LẦN ở đầu panel (trên list item).
 * Đọc `order.values[fieldKey]`; lưu qua 1 request `{ updates, orderId, orderVersion }` (itemKey rỗng).
 */
function MeraOrderScopeSection({
  order,
  columns,
  statusOptions,
  onSaved,
}: {
  order: MeraOrderSummary;
  columns: MeraColumn[];
  statusOptions: string[];
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(columns.map((c) => [c.fieldKey, order.values[c.fieldKey] ?? ""])),
  );
  const update = useUpdateMera();

  const dirty = columns.filter(
    (c) => c.editable && (draft[c.fieldKey] ?? "") !== (order.values[c.fieldKey] ?? ""),
  );

  const onSave = async () => {
    if (dirty.length === 0) return;
    const updates = Object.fromEntries(dirty.map((c) => [c.fieldKey, draft[c.fieldKey] ?? ""]));
    try {
      await update.mutateAsync({
        updates,
        orderId: order.orderId,
        orderVersion: order.version,
      });
      toast.success(`Cập nhật Mera (đơn) thành công (${dirty.length} trường)`);
      onSaved();
    } catch (e) {
      meraSaveError(e, onSaved);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-2.5">
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
          Đơn
        </span>
        <span className="text-xs text-muted-foreground">Field cấp đơn hàng</span>
      </div>
      <MeraFieldsGrid
        columns={columns}
        draft={draft}
        setDraft={setDraft}
        statusOptions={statusOptions}
      />
      <SaveBar dirtyCount={dirty.length} pending={update.isPending} onSave={onSave} />
    </div>
  );
}

/**
 * 1 item Mera khớp đơn — render ĐỘNG theo `itemColumns`.
 * Đọc `item.values[fieldKey]`; save gom field item-scope dirty →
 * `{ updates, itemKey, itemVersion, orderId, orderVersion }`.
 */
function MeraItemMatchEditor({
  item,
  order,
  columns,
  statusOptions,
  onSaved,
}: {
  item: MeraOrderItem;
  order: MeraOrderSummary;
  columns: MeraColumn[];
  statusOptions: string[];
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(columns.map((c) => [c.fieldKey, item.values[c.fieldKey] ?? ""])),
  );
  const [open, setOpen] = useState(true);
  const update = useUpdateMera();

  const dirty = columns.filter(
    (c) => c.editable && (draft[c.fieldKey] ?? "") !== (item.values[c.fieldKey] ?? ""),
  );

  const onSave = async () => {
    if (dirty.length === 0) return;
    const updates = Object.fromEntries(dirty.map((c) => [c.fieldKey, draft[c.fieldKey] ?? ""]));
    try {
      const res = await update.mutateAsync({
        updates,
        itemKey: item.itemKey,
        itemVersion: item.version,
        orderId: order.orderId,
        orderVersion: order.version,
      });
      toast.success(
        `Cập nhật Mera thành công (${dirty.length} trường)` +
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
        {!open && dirty.length > 0 ? (
          <span className="shrink-0 text-[11px] text-warning-foreground">• chưa lưu</span>
        ) : null}
      </div>

      {open ? (
        <>
          <MeraFieldsGrid
            columns={columns}
            draft={draft}
            setDraft={setDraft}
            statusOptions={statusOptions}
          />
          <SaveBar dirtyCount={dirty.length} pending={update.isPending} onSave={onSave} />
        </>
      ) : null}
    </div>
  );
}

/** Card cập nhật Mera cho 1 ĐƠN (receipt) — render động theo columns từ cấu hình admin. */
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
  const columns = resolve.data?.columns ?? [];
  const reason = resolve.data?.reason ?? null;

  // Tách cột theo scope (server đã set scope trong MeraColumn).
  const orderColumns = columns.filter((c) => c.scope === "order");
  const itemColumns = columns.filter((c) => c.scope === "item");

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
              {/* Section order-scope: chỉ hiện khi có cột order-scope. Remount theo order.version. */}
              {orderColumns.length > 0 ? (
                <MeraOrderScopeSection
                  key={`order-${order.version}`}
                  order={order}
                  columns={orderColumns}
                  statusOptions={statusOptions}
                  onSaved={() => resolve.refetch()}
                />
              ) : null}

              {items.map((it) => (
                // key gồm version item + version order → remount fill dữ liệu mới sau khi lưu/conflict.
                <MeraItemMatchEditor
                  key={`${it.itemKey}-${it.version}-${order.version}`}
                  item={it}
                  order={order}
                  columns={itemColumns}
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
