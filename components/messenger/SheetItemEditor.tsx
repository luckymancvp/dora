"use client";

import { useEffect, useRef, useState } from "react";
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

/** Thông báo lỗi lưu sheet (toast) — tách thông điệp "chưa kết nối Google". */
function toastSaveError(e: unknown) {
  if (e instanceof ApiError && e.code === "google_not_connected") {
    toast.error("Chưa kết nối Google. Vào Cài đặt để kết nối lại.");
  } else {
    toast.error(`Cập nhật sheet thất bại: ${e instanceof Error ? e.message : "lỗi không rõ"}`);
  }
}

// Field hiển thị dạng nhiều dòng (Customer Image: mỗi dòng 1 link ảnh).
const TEXTAREA_FIELDS = new Set(["Order Note", "Personalization", "Customer Image", "Design", "Mockup"]);
// Cột khoá (không cho sửa trong popup) vì là khoá khớp dòng.
const READONLY_FIELDS = new Set(["Item ID", "Order"]);

/** Mã code bấm để copy vào clipboard. */
function CopyCode({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* trình duyệt chặn clipboard → bỏ qua */
    }
  };
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void copy();
      }}
      title="Bấm để copy"
      className={"min-w-0 select-text text-left hover:text-primary " + (className ?? "")}
    >
      {value}
      {copied ? <span className="ml-1 text-xs text-success-foreground">đã copy</span> : null}
    </button>
  );
}

/** Preview các link ảnh trong Customer Image — mỗi ảnh có nút X để xoá. */
function ImagePreviews({ value, onChange }: { value: string; onChange?: (v: string) => void }) {
  const urls = value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (urls.length === 0) return null;

  const remove = (url: string) => {
    if (!onChange) return;
    const next = urls.filter((u) => u !== url).join("\n");
    onChange(next);
  };

  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {urls.map((u, i) => (
        <div key={`${i}-${u}`} className="group relative h-16 w-16 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={u}
            alt=""
            className="h-16 w-16 rounded-lg border border-border object-cover"
          />
          {onChange ? (
            <button
              type="button"
              onClick={() => remove(u)}
              aria-label="Xoá ảnh"
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-white opacity-0 transition-opacity hover:bg-black group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Trích file ID từ link Google Drive. */
function driveFileId(url: string): string | null {
  const m = url.match(/\/file\/d\/([^/?#]+)/) ?? url.match(/[?&]id=([^&]+)/);
  return m ? m[1] : null;
}

/** Preview ảnh cho link Google Drive (Design/Mockup) — dùng thumbnail API của Drive. */
function DriveLinkPreview({
  value,
  onChange,
}: {
  value: string;
  onChange?: (v: string) => void;
}) {
  const urls = value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (urls.length === 0) return null;

  const remove = (url: string) => {
    if (!onChange) return;
    const next = urls.filter((u) => u !== url).join("\n");
    onChange(next);
  };

  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {urls.map((u, i) => {
        const fileId = driveFileId(u);
        const thumb = fileId
          ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`
          : null;
        return (
          <div key={`${i}-${u}`} className="group relative h-16 w-16 shrink-0">
            <a href={u} target="_blank" rel="noreferrer" className="block h-full w-full">
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumb}
                  alt=""
                  className="h-16 w-16 rounded-lg border border-border object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground">
                  <ExternalLink className="h-4 w-4" />
                </div>
              )}
            </a>
            {onChange ? (
              <button
                type="button"
                onClick={() => remove(u)}
                aria-label="Xoá link"
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-white opacity-0 transition-opacity hover:bg-black group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Dropdown chọn Status có ô search (lọc nhanh khi danh sách dài). */
function StatusSelect({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Giữ giá trị hiện tại nếu chưa có trong danh sách (tránh mất khi sheet có status lạ).
  const allOptions = value && !options.includes(value) ? [value, ...options] : options;
  const filtered = q
    ? allOptions.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase()))
    : allOptions;

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQ("");
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border-0 bg-secondary px-2.5 py-1.5 text-left text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
      >
        <span className={value ? "truncate" : "truncate text-muted-foreground"}>
          {value || "— Chọn trạng thái —"}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {open ? (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          <div className="border-b border-border p-1.5">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm trạng thái…"
              className="w-full rounded-md bg-secondary px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => pick("")}
              className="block w-full px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-secondary"
            >
              — Chọn trạng thái —
            </button>
            {filtered.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => pick(o)}
                className={
                  "block w-full px-3 py-1.5 text-left text-sm hover:bg-secondary " +
                  (o === value ? "bg-accent font-semibold text-primary" : "text-foreground")
                }
              >
                {o}
              </button>
            ))}
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Không có kết quả</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 1 ô nhập field (dùng chung cho form inline & popup). */
function FieldInput({
  field,
  value,
  onChange,
  statusOptions,
  disabled,
  multiline,
}: {
  field: string;
  value: string;
  onChange: (v: string) => void;
  statusOptions: string[];
  disabled?: boolean;
  /** Buộc mọi trường (trừ Status) thành textarea nhiều dòng — dùng trong popup sửa-tất-cả. */
  multiline?: boolean;
}) {
  if (field === "Status") {
    return (
      <StatusSelect value={value} options={statusOptions} onChange={onChange} disabled={disabled} />
    );
  }
  // Ô khoá (Item ID/Order) giữ 1 dòng; còn lại nhiều dòng nếu là field text dài hoặc bật multiline.
  const asTextarea = !disabled && (multiline || TEXTAREA_FIELDS.has(field));
  if (asTextarea) {
    const isDriveLink = field === "Design" || field === "Mockup";
    const placeholder = field === "Customer Image"
      ? "Mỗi dòng 1 link ảnh…"
      : isDriveLink
      ? "Link Google Drive…"
      : undefined;
    return (
      <>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={field === "Order Note" || field === "Personalization" ? 3 : 2}
          placeholder={placeholder}
          className="w-full resize-y rounded-lg border-0 bg-secondary px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {field === "Customer Image" ? <ImagePreviews value={value} onChange={onChange} /> : null}
        {isDriveLink ? <DriveLinkPreview value={value} onChange={onChange} /> : null}
      </>
    );
  }
  return (
    <input
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border-0 bg-secondary px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
    />
  );
}

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
