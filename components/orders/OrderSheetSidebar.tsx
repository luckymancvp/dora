"use client";

import { useEffect } from "react";
import { FileSpreadsheet, X } from "lucide-react";
import { SheetReceiptEditor } from "@/components/messenger/SheetItemEditor";
import type { OrderListItem } from "@/lib/types/etsy";

/**
 * Sidebar trượt từ phải để cập nhật Google Sheet theo 1 ĐƠN.
 * Tái dùng SheetReceiptEditor (liệt kê tất cả dòng/transaction của đơn trong sheet).
 */
export function OrderSheetSidebar({
  order,
  onClose,
}: {
  order: OrderListItem;
  onClose: () => void;
}) {
  const noShop = !order.shopName.trim();

  // Đóng bằng phím Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    // Panel không chặn tương tác (non-modal): không có overlay, trang chính vẫn click được.
    <div
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-background shadow-xl"
      role="dialog"
    >
        <div className="flex items-start justify-between gap-2 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              Cập nhật Sheet
            </h2>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {order.buyerName || "Khách"} · Order #{order.orderId}
              {order.shopName ? ` · ${order.shopName}` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {noShop ? (
            <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
              Không xác định được shop của đơn này nên chưa thể tra cứu sheet.
            </p>
          ) : (
            <SheetReceiptEditor store={order.shopName} receiptId={order.orderId} />
          )}
      </div>
    </div>
  );
}
