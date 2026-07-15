"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ExternalLink, X } from "lucide-react";
import { ApiError } from "@/lib/hooks/useSheets";

/** Thông báo lỗi lưu sheet (toast) — tách thông điệp "chưa kết nối Google". */
export function toastSaveError(e: unknown) {
  if (e instanceof ApiError && e.code === "google_not_connected") {
    toast.error("Chưa kết nối Google. Vào Cài đặt để kết nối lại.");
  } else {
    toast.error(`Cập nhật sheet thất bại: ${e instanceof Error ? e.message : "lỗi không rõ"}`);
  }
}

// Field hiển thị dạng nhiều dòng (Customer Image: mỗi dòng 1 link ảnh).
export const TEXTAREA_FIELDS = new Set(["Order Note", "Personalization", "Customer Image", "Design", "Mockup"]);

/** Mã code bấm để copy vào clipboard. */
export function CopyCode({ value, className }: { value: string; className?: string }) {
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

/** Lightbox xem ảnh full — bấm nền hoặc nút X để đóng. */
export function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label="Mở ảnh ở tab khác"
          title="Mở ảnh ở tab khác"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
      />
    </div>
  );
}

/** Preview các link ảnh trong Customer Image — bấm ảnh xem to, có nút mở link & nút X xoá. */
export function ImagePreviews({ value, onChange }: { value: string; onChange?: (v: string) => void }) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  // Chỉ preview ảnh cho link https (bỏ qua text/ghi chú không phải link ảnh).
  const urls = value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => /^https:\/\//i.test(s));
  if (urls.length === 0) return null;

  const remove = (url: string) => {
    if (!onChange) return;
    const next = urls.filter((u) => u !== url).join("\n");
    onChange(next);
  };

  return (
    <>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {urls.map((u, i) => (
          <div key={`${i}-${u}`} className="group relative h-16 w-16 shrink-0">
            <button
              type="button"
              onClick={() => setLightbox(u)}
              aria-label="Xem ảnh"
              className="block h-16 w-16 cursor-zoom-in overflow-hidden rounded-lg border border-border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="" className="h-16 w-16 object-cover" />
            </button>
            {/* Icon mở link ảnh ở tab khác (góc dưới-phải) */}
            <a
              href={u}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              aria-label="Mở ảnh ở tab khác"
              title="Mở ảnh ở tab khác"
              className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-md bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
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
      {lightbox ? <ImageLightbox url={lightbox} onClose={() => setLightbox(null)} /> : null}
    </>
  );
}

/** Trích file ID từ link Google Drive. */
function driveFileId(url: string): string | null {
  const m = url.match(/\/file\/d\/([^/?#]+)/) ?? url.match(/[?&]id=([^&]+)/);
  return m ? m[1] : null;
}

/** Preview ảnh cho link Google Drive (Design/Mockup) — dùng thumbnail API của Drive. */
export function DriveLinkPreview({
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
export function StatusSelect({
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
export function FieldInput({
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
