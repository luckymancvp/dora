"use client";

import { useEffect } from "react";
import { SquarePen, X } from "lucide-react";
import { useResolveSheetRow, ApiError } from "@/lib/hooks/useSheets";
import { useResolveMeraOrder } from "@/lib/hooks/useMera";
import { SheetReceiptEditor } from "@/components/messenger/SheetItemEditor";
import { MeraReceiptEditor } from "@/components/messenger/MeraItemEditor";
import type { OrderListItem } from "@/lib/types/etsy";

/**
 * Sidebar trượt từ phải để CẬP NHẬT 1 ĐƠN.
 * Ưu tiên Google Sheet: resolve Sheet trước — có match → SheetReceiptEditor.
 * Sheet 0 match HOẶC Sheet lỗi → thử Mera (useResolveMeraOrder) — có đơn → MeraReceiptEditor.
 * Cả hai rỗng → thông báo không tìm thấy.
 */
export function OrderUpdateSidebar({
  order,
  onClose,
}: {
  order: OrderListItem;
  onClose: () => void;
}) {
  const store = order.shopName;
  const receiptId = order.orderId;

  // Bước 1: Sheet.
  const sheet = useResolveSheetRow({ store, receiptId });
  const matches = sheet.data?.matches ?? [];
  const sheetHasMatch = matches.length > 0;
  // Sheet đã xong (thành công 0 match) hoặc lỗi → mở nhánh Mera.
  const tryMera = (sheet.isSuccess && matches.length === 0) || sheet.isError;

  // Bước 2: Mera (chỉ fetch khi Sheet không match/lỗi).
  const mera = useResolveMeraOrder({ store, receiptId, enabled: tryMera });
  const meraOrder = mera.data?.order ?? null;

  // Đóng bằng phím Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lỗi Sheet (không phải chưa-kết-nối) → notice phụ khi đã rớt sang Mera.
  const sheetErrored = sheet.isError;

  return (
    // Panel non-modal: không overlay, trang chính vẫn click được.
    <div
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-background shadow-xl"
      role="dialog"
    >
      <div className="flex items-start justify-between gap-2 border-b border-border p-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <SquarePen className="h-5 w-5 text-primary" />
            Cập nhật
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

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {sheet.isLoading ? (
          <p className="text-xs text-muted-foreground">Đang tìm trong Sheet…</p>
        ) : sheetHasMatch ? (
          <SheetReceiptEditor store={store} receiptId={receiptId} />
        ) : (
          <>
            {sheetErrored ? (
              <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                {sheet.error instanceof ApiError && sheet.error.code === "google_not_connected"
                  ? "Chưa kết nối Google — đang thử tra cứu trên Mera."
                  : "Lỗi tra cứu Sheet — đang thử tra cứu trên Mera."}
              </p>
            ) : null}

            {mera.isLoading ? (
              <p className="text-xs text-muted-foreground">Đang tìm trên Mera…</p>
            ) : meraOrder ? (
              <MeraReceiptEditor store={store} receiptId={receiptId} />
            ) : mera.isError ? (
              <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                <p>
                  {mera.error instanceof ApiError && mera.error.status === 502
                    ? "Không kết nối được Mera."
                    : "Lỗi tra cứu Mera."}
                </p>
                <button
                  onClick={() => mera.refetch()}
                  className="mt-2 text-xs font-medium text-primary hover:underline"
                >
                  Thử lại
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                <p>Không tìm thấy đơn ở Sheet lẫn Mera.</p>
                {sheet.data?.reason === "no_configs" ? (
                  <p className="mt-1 text-xs">Chưa cấu hình sheet nào.</p>
                ) : mera.data?.reason === "not_configured" ? (
                  <p className="mt-1 text-xs">
                    Chưa cấu hình Mera API (MERA_API_BASE_URL / MERA_INTERNAL_API_KEY).
                  </p>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
