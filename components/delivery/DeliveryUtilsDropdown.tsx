"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Send, Settings, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Nút "Utils" màn Giao hàng (khuôn Mera `features/orders/components/UtilsDropdown.tsx`, plan
 * request-reviews §6, §11): menu thuần Tailwind, đóng khi click ra ngoài / Esc / chọn mục.
 */
export function DeliveryUtilsDropdown({
  onRequestReviews,
  onReviewTemplates,
  onReviewSettings,
  selectedCount,
}: {
  onRequestReviews: () => void;
  /** §11: quản lý thư viện mẫu tin dùng chung. */
  onReviewTemplates: () => void;
  onReviewSettings: () => void;
  /** Số mã đang chọn — > 0 thì "Request reviews" là gửi tay cho các mã đó. */
  selectedCount: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={ref} className="relative">
      <Button variant="outline" size="lg" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <Wrench className="h-4 w-4" />
        Utils
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[240px] rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={pick(onRequestReviews)}
            className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
            title={
              selectedCount > 0
                ? `Gửi tay tin xin review cho ${selectedCount} mã đang chọn`
                : "Chạy tự động cho project đang xem"
            }
          >
            <Send className="h-4 w-4" />
            Request reviews
            {selectedCount > 0 && (
              <span className="ml-auto rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                {selectedCount.toLocaleString()}
              </span>
            )}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={pick(onReviewTemplates)}
            className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
          >
            <FileText className="h-4 w-4" />
            Mẫu tin Request reviews
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={pick(onReviewSettings)}
            className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
          >
            <Settings className="h-4 w-4" />
            Cài đặt Request reviews
          </button>
        </div>
      )}
    </div>
  );
}
