"use client";

import { forwardRef } from "react";
import { DeliveryRow } from "@/components/delivery/DeliveryRow";
import {
  pageSelectState,
  selectBlockReason,
  selectionShopCounts,
  type TrackingSelection,
} from "@/lib/delivery/trackingSelection";
import type { DeliveryTracking } from "@/lib/types/delivery";

interface Props {
  /** undefined = chưa có dữ liệu lần nào. */
  rows: DeliveryTracking[] | undefined;
  loading: boolean;
  refreshingIds: Set<string>;
  selection: TrackingSelection;
  onToggleRow: (row: DeliveryTracking) => void;
  onTogglePage: () => void;
  onRefresh: (row: DeliveryTracking) => void;
  onCopyCode: (code: string) => void;
  onOpenHistory: (rowId: string) => void;
  copiedId: string | null;
  onCopyId: (text: string) => void;
  showDelivered: boolean;
}

/** Bảng mã tracking: ô chọn cả trang (≤50 mã / shop) + cột như màn Tracking của Mera. */
export const DeliveryTable = forwardRef<HTMLDivElement, Props>(function DeliveryTable(
  {
    rows,
    loading,
    refreshingIds,
    selection,
    onToggleRow,
    onTogglePage,
    onRefresh,
    onCopyCode,
    onOpenHistory,
    copiedId,
    onCopyId,
    showDelivered,
  },
  ref,
) {
  const pageRows = rows ?? [];
  const selCounts = selectionShopCounts(selection);
  const pageSel = pageSelectState(selection, pageRows);

  return (
    <div ref={ref} className="max-h-[calc(100vh-300px)] overflow-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-secondary text-xs uppercase text-muted-foreground">
          <tr className="[&>th]:whitespace-nowrap [&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-semibold">
            <th className="w-8 !pr-0">
              <input
                type="checkbox"
                className="h-4 w-4 align-middle accent-primary"
                checked={pageSel === "all"}
                ref={(el) => {
                  if (el) el.indeterminate = pageSel === "some";
                }}
                onChange={onTogglePage}
                disabled={pageRows.length === 0}
                title="Chọn / bỏ chọn các mã của trang này (tối đa 50 mã / shop)"
                aria-label="Chọn cả trang"
              />
            </th>
            <th>Tracking Number</th>
            <th>Order ID</th>
            <th>Fulfill</th>
            <th>Status</th>
            <th>Transit Time</th>
            <th>{showDelivered ? "Date (Paid / Ship / Giao)" : "Date (Paid / Ship)"}</th>
            <th className="!text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {pageRows.map((row) => (
            <DeliveryRow
              key={row.id}
              row={row}
              refreshing={refreshingIds.has(row.id)}
              onRefresh={onRefresh}
              onCopyCode={onCopyCode}
              onOpenHistory={onOpenHistory}
              copiedId={copiedId}
              onCopyId={onCopyId}
              showDelivered={showDelivered}
              selected={selection.has(row.id)}
              selectBlocked={selectBlockReason(row, selection, selCounts)}
              onToggleSelect={onToggleRow}
            />
          ))}
          {rows && rows.length === 0 && !loading && (
            <tr>
              <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                Không có mã tracking nào khớp bộ lọc.
              </td>
            </tr>
          )}
          {!rows && loading && (
            <tr>
              <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                Đang tải…
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
});
