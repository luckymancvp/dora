import type { DeliveryTracking } from "@/lib/types/delivery";

/**
 * Chọn nhiều mã trên màn Giao hàng để làm mới hàng loạt: tối đa BULK_MAX_PER_SHOP mã / shop (BE
 * kiểm lại — 1 lượt đọc Etsy của shop nhận ≤50 đơn). Mã mang đơn của 2 shop tính vào cả 2.
 * Lựa chọn giữ qua các trang (id → shop của mã).
 * Chép nguyên văn `mera-fulfill-frontend/src/lib/trackingSelection.ts`.
 */
export const BULK_MAX_PER_SHOP = 50;

/** id mã → các shop của nó. */
export type TrackingSelection = Map<string, string[]>;

/** Shop của một mã (đơn đang hiện, bỏ rỗng + trùng). */
export function rowShops(row: Pick<DeliveryTracking, "orders">): string[] {
  const out: string[] = [];
  for (const o of row.orders ?? []) {
    const s = (o.store || "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export function selectionShopCounts(sel: TrackingSelection): Map<string, number> {
  const m = new Map<string, number>();
  for (const shops of sel.values()) for (const s of shops) m.set(s, (m.get(s) ?? 0) + 1);
  return m;
}

/** Lý do không tick được mã này; null = tick được (hoặc đang được chọn). */
export function selectBlockReason(
  row: DeliveryTracking,
  sel: TrackingSelection,
  counts = selectionShopCounts(sel),
): string | null {
  if (sel.has(row.id)) return null;
  const shops = rowShops(row);
  if (shops.length === 0) return "Mã không có đơn Etsy để đọc";
  const full = shops.find((s) => (counts.get(s) ?? 0) >= BULK_MAX_PER_SHOP);
  return full ? `Shop ${full} đã chọn đủ ${BULK_MAX_PER_SHOP} mã` : null;
}

/** Tick / bỏ tick 1 mã (tôn trọng giới hạn). */
export function toggleSelection(sel: TrackingSelection, row: DeliveryTracking): TrackingSelection {
  const next = new Map(sel);
  if (next.has(row.id)) next.delete(row.id);
  else if (!selectBlockReason(row, sel)) next.set(row.id, rowShops(row));
  return next;
}

/**
 * Ô chọn cả trang: còn mã chọn được → thêm lần lượt tới khi shop đủ 50; không còn → bỏ chọn các mã
 * của trang. Trả kèm số mã bị bỏ qua vì shop đã đủ.
 */
export function togglePage(
  sel: TrackingSelection,
  rows: DeliveryTracking[],
): { next: TrackingSelection; skipped: number } {
  const counts = selectionShopCounts(sel);
  const selectable = rows.filter((r) => !sel.has(r.id) && !selectBlockReason(r, sel, counts));
  const next = new Map(sel);
  if (selectable.length === 0) {
    for (const r of rows) next.delete(r.id);
    return { next, skipped: 0 };
  }
  let skipped = rows.filter((r) => !sel.has(r.id) && rowShops(r).length > 0).length - selectable.length;
  for (const r of selectable) {
    if (selectBlockReason(r, next)) {
      skipped++;
      continue;
    }
    next.set(r.id, rowShops(r));
  }
  return { next, skipped };
}

/** Trạng thái ô chọn cả trang. */
export function pageSelectState(sel: TrackingSelection, rows: DeliveryTracking[]): "none" | "some" | "all" {
  const n = rows.filter((r) => sel.has(r.id)).length;
  if (n === 0) return "none";
  return n === rows.filter((r) => rowShops(r).length > 0).length ? "all" : "some";
}
