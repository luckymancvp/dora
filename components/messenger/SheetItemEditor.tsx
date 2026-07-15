"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ExternalLink,
  Loader2,
  RefreshCw,
  Save,
  ChevronDown,
  Maximize2,
  X,
} from "lucide-react";
import {
  useResolveSheetRow,
  useUpdateSheetRow,
  useStatusNames,
  ApiError,
} from "@/lib/hooks/useSheets";
import { EDITABLE_SHEET_FIELDS, type OrderRowMatch } from "@/lib/types/sheets";
import { CopyCode, FieldInput, toastSaveError } from "@/components/messenger/field-editors";

// Cột khoá (không cho sửa trong popup) vì là khoá khớp dòng.
const READONLY_FIELDS = new Set(["Item ID", "Order"]);

/** Popup sửa TOÀN BỘ field của dòng sheet. */
function SheetRowDialog({
  match,
  onClose,
  onSaved,
}: {
  match: OrderRowMatch;
  onClose: () => void;
  onSaved: () => void;
}) {
  const headers = match.headers.filter((h) => h && h.trim());
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(headers.map((h) => [h, match.values[h] ?? ""])),
  );
  const statusNames = useStatusNames();
  const updateRow = useUpdateSheetRow();

  const dirty = headers.filter(
    (h) => !READONLY_FIELDS.has(h) && (draft[h] ?? "") !== (match.values[h] ?? ""),
  );

  const save = async () => {
    if (dirty.length === 0) {
      onClose();
      return;
    }
    const updates = Object.fromEntries(dirty.map((h) => [h, draft[h] ?? ""]));
    const expected = Object.fromEntries(dirty.map((h) => [h, match.values[h] ?? ""]));
    try {
      await updateRow.mutateAsync({
        configId: match.configId,
        itemId: match.itemId,
        rowNumber: match.rowNumber,
        updates,
        expected,
      });
      toast.success(`Cập nhật sheet thành công (${dirty.length} trường)`);
      onSaved();
      onClose();
    } catch (e) {
      toastSaveError(e);
    }
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
            <h3 className="truncate font-bold text-foreground">{match.itemId}</h3>
            <p className="truncate text-xs text-muted-foreground">
              {match.spreadsheetTitle} · {match.dataTabName} · dòng {match.rowNumber}
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
            {headers.map((h) => (
              <label key={h} className="block">
                <span className="mb-1 block text-xs font-semibold text-foreground">
                  {h}
                  {READONLY_FIELDS.has(h) ? (
                    <span className="ml-1 font-normal text-muted-foreground">(khoá)</span>
                  ) : null}
                </span>
                <FieldInput
                  field={h}
                  value={draft[h] ?? ""}
                  onChange={(v) => setDraft((d) => ({ ...d, [h]: v }))}
                  statusOptions={statusNames}
                  disabled={READONLY_FIELDS.has(h)}
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
            onClick={save}
            disabled={updateRow.isPending}
            className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:bg-input-strong"
          >
            {updateRow.isPending ? (
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

/** 1 dòng sheet khớp đơn: Item ID + popup sửa-tất-cả + form sửa nhanh các field chính. */
function MatchEditor({ match, onSaved }: { match: OrderRowMatch; onSaved: () => void }) {
  const fields = EDITABLE_SHEET_FIELDS.filter((f) => f in match.values);
  // Tracking (chỉ đọc) — hiện khi sheet có dữ liệu, trống thì ẩn.
  const tracking = (match.values["Tracking"] ?? "").trim();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f, match.values[f] ?? ""])),
  );
  const [open, setOpen] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const statusNames = useStatusNames();
  const updateRow = useUpdateSheetRow();

  const dirtyFields = fields.filter((f) => (draft[f] ?? "") !== (match.values[f] ?? ""));

  const save = async () => {
    if (dirtyFields.length === 0) return;
    const updates = Object.fromEntries(dirtyFields.map((f) => [f, draft[f] ?? ""]));
    const expected = Object.fromEntries(dirtyFields.map((f) => [f, match.values[f] ?? ""]));
    try {
      await updateRow.mutateAsync({
        configId: match.configId,
        itemId: match.itemId,
        rowNumber: match.rowNumber,
        updates,
        expected,
      });
      toast.success(`Cập nhật sheet thành công (${dirtyFields.length} trường)`);
      onSaved();
    } catch (e) {
      toastSaveError(e);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      {/* Header item: ẩn/hiện riêng từng item + Item ID + popup + mở sheet */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Thu gọn item" : "Mở item"}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={"h-3.5 w-3.5 transition-transform " + (open ? "" : "-rotate-90")} />
        </button>
        <CopyCode value={match.itemId} className="flex-1 break-all text-xs font-bold text-foreground" />
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
        <a
          href={match.spreadsheetUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-muted-foreground hover:text-primary"
          aria-label="Mở sheet"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {open ? (
        <>
          {tracking ? (
            <div className="mt-2 flex items-start gap-1.5 text-xs">
              <span className="shrink-0 font-semibold text-foreground">Tracking:</span>
              {/^https?:\/\//.test(tracking) ? (
                <a
                  href={tracking}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-primary hover:underline"
                >
                  {tracking}
                </a>
              ) : (
                <CopyCode value={tracking} className="break-all text-muted-foreground" />
              )}
            </div>
          ) : null}

          <div className="mt-2 flex flex-col gap-2.5">
            {fields.map((f) => (
              <label key={f} className="block">
                <span className="mb-1 block text-xs font-semibold text-foreground">{f}</span>
                <FieldInput
                  field={f}
                  value={draft[f] ?? ""}
                  onChange={(v) => setDraft((d) => ({ ...d, [f]: v }))}
                  statusOptions={statusNames}
                />
              </label>
            ))}
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <button
              onClick={save}
              disabled={updateRow.isPending || dirtyFields.length === 0}
              className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:bg-input-strong"
            >
              {updateRow.isPending ? (
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
        <SheetRowDialog match={match} onClose={() => setDialogOpen(false)} onSaved={onSaved} />
      ) : null}
    </div>
  );
}

/** Card cập nhật Sheet cho 1 ĐƠN (receipt) — liệt kê TẤT CẢ dòng/transaction của đơn trong sheet. */
export function SheetReceiptEditor({
  store,
  receiptId,
}: {
  store: string;
  receiptId: number;
}) {
  // Mặc định mở → tra cứu đơn ngay khi vào hội thoại. Bỏ transactionId → lấy cả đơn.
  const [open, setOpen] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const resolve = useResolveSheetRow({ store, receiptId, enabled: open });
  const matches = resolve.data?.matches ?? [];
  // Mã đơn để hiển thị: cột "Order" (prefix-receipt) nếu có, không thì #receiptId.
  const orderCode = matches[0]?.values?.["Order"] || `#${receiptId}`;

  const refresh = async () => {
    setSyncing(true);
    try {
      const ids = [...new Set(matches.map((m) => m.configId))];
      await Promise.all(
        ids.map((id) => fetch(`/api/sheets/configs/${id}/sync`, { method: "POST" })),
      );
      await resolve.refetch();
    } finally {
      setSyncing(false);
    }
  };

  const busy = syncing || resolve.isFetching;

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
        <CopyCode value={orderCode} className="flex-1 break-all text-xs font-bold text-foreground" />
        {open && matches.length > 1 ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">{matches.length} dòng</span>
        ) : null}
        <button
          onClick={refresh}
          disabled={busy}
          aria-label="Làm mới"
          title="Đồng bộ lại từ sheet"
          className="shrink-0 text-muted-foreground hover:text-primary disabled:opacity-50"
        >
          <RefreshCw className={"h-3.5 w-3.5 " + (busy ? "animate-spin" : "")} />
        </button>
      </div>

      {open ? (
        <div className="border-t border-border p-2.5">
          {resolve.isLoading ? (
            <p className="text-xs text-muted-foreground">Đang tìm trong sheet…</p>
          ) : resolve.isError ? (
            (() => {
              const e = resolve.error;
              if (e instanceof ApiError && e.code === "google_not_connected") {
                return (
                  <p className="text-xs text-warning-foreground">
                    Chưa kết nối Google.{" "}
                    <Link href="/settings" className="font-semibold text-primary underline">
                      Kết nối
                    </Link>
                  </p>
                );
              }
              return <p className="text-xs text-destructive">Lỗi tra cứu sheet.</p>;
            })()
          ) : matches.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {resolve.data?.reason === "no_configs"
                ? "Chưa cấu hình sheet nào."
                : "Không tìm thấy trong sheet."}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {matches.map((m) => {
                // key gồm chữ ký giá trị → remount fill dữ liệu mới sau khi đồng bộ.
                const sig = EDITABLE_SHEET_FIELDS.map((f) => m.values[f] ?? "").join("");
                return (
                  <MatchEditor
                    key={`${m.configId}-${m.rowNumber}-${sig}`}
                    match={m}
                    onSaved={() => resolve.refetch()}
                  />
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
