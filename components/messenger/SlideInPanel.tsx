"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Lớp width cho desktop (≥lg). Khai báo tĩnh để Tailwind quét được (không nội suy động).
const LG_WIDTH: Record<string, string> = {
  "w-80": "lg:w-80",
  "w-96": "lg:w-96",
};

/**
 * Wrapper hiển thị panel phụ (đơn hàng / ghi chú).
 * - Desktop (≥lg): trượt bên phải, animate bề rộng 0 → widthClass + fade in.
 * - Mobile (<lg): overlay phủ kín màn hình (panel con tự có nút đóng).
 * - Đóng: animate về 0 rồi mới unmount (sau khi transition kết thúc) → tránh fetch khi đang đóng.
 */
export function SlideInPanel({
  open,
  children,
  widthClass = "w-80",
}: {
  open: boolean;
  children: ReactNode;
  /** Bề rộng panel khi mở (Tailwind width class). Mặc định w-80 (320px). */
  widthClass?: string;
}) {
  // render: có gắn DOM hay không. shown: trạng thái mở (để chạy transition).
  const [render, setRender] = useState(open);
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) {
      setRender(true);
      // Double rAF: đảm bảo trình duyệt đã paint trạng thái w-0 trước khi chuyển sang
      // w-80, nếu không transition sẽ bị bỏ qua (nhảy thẳng tới trạng thái mở).
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    setShown(false); // bắt đầu animate đóng; unmount ở onTransitionEnd.
    // Mobile (<lg) là overlay không có transition → onTransitionEnd không bắn,
    // nên phải unmount ngay (nếu không nút đóng sẽ không tắt được panel).
    if (!window.matchMedia("(min-width: 1024px)").matches) {
      setRender(false);
    }
  }, [open]);

  if (!render) return null;

  const lgWidth = LG_WIDTH[widthClass] ?? "lg:w-80";

  return (
    <div
      className={cn(
        // Mobile: overlay phủ kín màn hình. Desktop (≥lg): panel trượt bên phải, animate bề rộng.
        "fixed inset-0 z-50 h-full bg-card",
        "lg:static lg:z-auto lg:shrink-0 lg:overflow-hidden lg:bg-transparent lg:transition-all lg:duration-300 lg:ease-in-out",
        shown ? cn(lgWidth, "lg:opacity-100") : "lg:w-0 lg:opacity-0",
      )}
      onTransitionEnd={() => {
        if (!open) setRender(false);
      }}
    >
      <div className={cn("h-full w-full", lgWidth)}>{children}</div>
    </div>
  );
}
