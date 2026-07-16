"use client";

import { useResolveSheetRow, ApiError } from "@/lib/hooks/useSheets";
import { useResolveMeraOrder } from "@/lib/hooks/useMera";
import { SheetReceiptEditor } from "@/components/messenger/SheetItemEditor";
import { MeraReceiptEditor } from "@/components/messenger/MeraItemEditor";

/**
 * Cập nhật 1 đơn (receipt) trong panel lịch sử hội thoại.
 * Cùng logic ưu tiên như OrderUpdateSidebar: resolve Sheet trước —
 * có match → SheetReceiptEditor; Sheet 0 match/lỗi → thử Mera → MeraReceiptEditor;
 * cả hai rỗng → thông báo không tìm thấy.
 */
export function ReceiptUpdateEditor({
  store,
  receiptId,
}: {
  store: string;
  receiptId: number;
}) {
  // Bước 1: Sheet. SheetReceiptEditor cũng dùng cùng queryKey ["sheet-row", receiptId, null]
  // → TanStack dedupe, không double-fetch.
  const sheet = useResolveSheetRow({ store, receiptId });
  const matches = sheet.data?.matches ?? [];
  const sheetHasMatch = matches.length > 0;
  const tryMera = (sheet.isSuccess && matches.length === 0) || sheet.isError;

  // Bước 2: Mera (chỉ fetch khi Sheet không match/lỗi).
  const mera = useResolveMeraOrder({ store, receiptId, enabled: tryMera });
  const meraOrder = mera.data?.order ?? null;

  if (sheet.isLoading) {
    return <p className="px-1 text-xs text-muted-foreground">Đang tìm trong Sheet…</p>;
  }

  if (sheetHasMatch) {
    return <SheetReceiptEditor store={store} receiptId={receiptId} />;
  }

  return (
    <div className="flex flex-col gap-2">
      {sheet.isError ? (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          {sheet.error instanceof ApiError && sheet.error.code === "google_not_connected"
            ? "Chưa kết nối Google — đang thử tra cứu trên Mera."
            : "Lỗi tra cứu Sheet — đang thử tra cứu trên Mera."}
        </p>
      ) : null}

      {mera.isLoading ? (
        <p className="px-1 text-xs text-muted-foreground">Đang tìm trên Mera…</p>
      ) : meraOrder ? (
        <MeraReceiptEditor store={store} receiptId={receiptId} />
      ) : mera.isError ? (
        <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
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
        <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          <p>Không tìm thấy đơn #{receiptId} ở Sheet lẫn Mera.</p>
          {sheet.data?.reason === "no_configs" ? (
            <p className="mt-1">Chưa cấu hình sheet nào.</p>
          ) : mera.data?.reason === "not_configured" ? (
            <p className="mt-1">Chưa cấu hình Mera API.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
