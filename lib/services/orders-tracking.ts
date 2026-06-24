import type { Filter } from "mongodb";
import { getOrderTrackingCollection } from "@/lib/db/collections";
import { asNumber, asString, isObject } from "@/lib/services/etsy-utils";
import type { OrderTracking, OrderTrackingDoc, TrackingEntry } from "@/lib/types/etsy";

/**
 * 1 shipment đã normalize từ extension (libs/etsy-tracking normalizeShipments):
 * { order_id, tracking_code, carrier_name, tracking_url, is_shipped, is_delivered }.
 */
export interface ShipmentInput {
  order_id?: string | number;
  tracking_code?: string;
  carrier_name?: string;
  tracking_url?: string;
  is_shipped?: boolean;
  is_delivered?: boolean;
}

/**
 * Upsert tracking thật theo order_id vào dora-master.order_tracking.
 * 1 đơn có thể nhiều shipment → gom theo order_id thành mảng (dedupe theo mã),
 * THAY THẾ toàn bộ mảng cũ (mỗi lần GET /shipments/by-order trả đủ shipment của đơn).
 * Bỏ qua shipment thiếu order_id hoặc thiếu tracking_code. Trả số đơn đã ghi.
 */
export async function saveOrderShipments(shipments: ShipmentInput[]): Promise<number> {
  if (!Array.isArray(shipments) || shipments.length === 0) return 0;

  // order_id → (tracking_code → entry) để gom nhiều shipment + dedupe theo mã.
  const byOrder = new Map<number, Map<string, TrackingEntry>>();
  for (const s of shipments) {
    if (!isObject(s)) continue;
    const orderId = asNumber(s.order_id);
    const code = asString(s.tracking_code).trim();
    if (orderId === undefined || !code) continue;
    if (!byOrder.has(orderId)) byOrder.set(orderId, new Map());
    byOrder.get(orderId)!.set(code, {
      tracking_code: code,
      carrier_name: asString(s.carrier_name),
      tracking_url: asString(s.tracking_url),
      is_shipped: s.is_shipped === true,
      is_delivered: s.is_delivered === true,
    });
  }
  if (byOrder.size === 0) return 0;

  const coll = await getOrderTrackingCollection();
  const now = new Date();
  for (const [orderId, entries] of byOrder) {
    await coll.updateOne(
      { order_id: orderId } as Filter<OrderTrackingDoc>,
      {
        $set: { trackings: [...entries.values()], updated_at: now },
        $setOnInsert: { order_id: orderId },
      },
      { upsert: true },
    );
  }
  return byOrder.size;
}

/** Map order_id → danh sách tracking đã resolve (đọc 1 lần khi list). */
export async function getOrderTrackingMap(
  orderIds: number[],
): Promise<Map<number, OrderTracking[]>> {
  const map = new Map<number, OrderTracking[]>();
  if (orderIds.length === 0) return map;
  const coll = await getOrderTrackingCollection();
  const docs = await coll
    .find({ order_id: { $in: orderIds } } as Filter<OrderTrackingDoc>)
    .toArray();
  for (const d of docs) {
    const list = (d.trackings ?? [])
      .filter((t) => t.tracking_code)
      .map((t) => ({
        code: t.tracking_code,
        carrier: t.carrier_name ?? "",
        url: t.tracking_url ?? "",
        isDelivered: t.is_delivered === true,
      }));
    if (list.length > 0) map.set(d.order_id, list);
  }
  return map;
}
