import { normalizeOrderId } from "@/lib/types/sheets";
import type { DeliveryTrackingOrder } from "@/lib/types/delivery";

/**
 * Link mở đơn trên trang Orders của dora-1 (trang đọc `?search=` lúc mount — A10).
 * Ưu tiên `etsy_receipt_id` (số receipt Etsy); thiếu → số đơn tách từ `order_id`
 * (`IRS-4167469772` → `4167469772`). Không có gì để tìm → `/orders`.
 */
export function doraOrdersLink(o: Pick<DeliveryTrackingOrder, "order_id" | "etsy_receipt_id">): string {
  const search = (o.etsy_receipt_id ?? "").trim() || normalizeOrderId(o.order_id ?? "");
  if (!search) return "/orders";
  return `/orders?${new URLSearchParams({ search }).toString()}`;
}

/** Đơn từ Google Sheet của dora-1 (push) — hiện nhãn "Dora". */
export function isDoraSheetOrder(o: Pick<DeliveryTrackingOrder, "source">): boolean {
  return o.source === "dora_sheet";
}
