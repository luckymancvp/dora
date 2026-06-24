import type { Filter } from "mongodb";
import { getEtsyOrdersCollection } from "@/lib/db/collections";
import { asNumber, asString, isObject } from "@/lib/services/etsy-utils";
import type { EtsyOrderDoc, EtsyRaw } from "@/lib/types/etsy";

/**
 * Body POST /v1/extension/orders/sync — payload thô từ extension
 * (fetchOrderList của Etsy + context). Mirror dora-backend Orders_OrdersCollection.
 */
interface OrdersSyncBody {
  orders?: EtsyRaw[];
  buyers?: EtsyRaw[];
  order_states?: EtsyRaw[];
  /** Context shop hiện tại (extension gắn payload.context = getContext()). */
  context?: { data?: { current_shop?: { shop_id?: number; shop_name?: string } } };
  [key: string]: unknown;
}

/**
 * Enrich 1 order: gắn `buyer` (tìm theo buyer_id) + `order_state_name`
 * (tìm theo order_state_id). Mirror Orders_OrdersCollection.AppendBuyerAndOrderState.
 */
function enrichOrder(order: EtsyRaw, buyers: EtsyRaw[], states: EtsyRaw[]): void {
  const buyerId = asNumber(order["buyer_id"]);
  if (buyerId !== undefined) {
    const b = buyers.find((x) => isObject(x) && asNumber(x["buyer_id"]) === buyerId);
    if (b) order["buyer"] = b;
  }
  // order_state_id là chuỗi; order_states[].order_state_id là số → so khớp dạng chuỗi.
  const stateId = asString(order["order_state_id"]);
  if (stateId) {
    const s = states.find((x) => {
      if (!isObject(x)) return false;
      const n = asNumber(x["order_state_id"]);
      return n !== undefined && String(n) === stateId;
    });
    if (s) order["order_state_name"] = asString(s["name"]);
  }
}

/**
 * Upsert đơn vào dora-master.etsy_orders (key: data.order_id), enrich buyer +
 * order_state_name trước khi lưu. Mirror dora-backend order_service.SyncOrders
 * (chỉ phần etsy_orders, không map sang collection `orders`).
 */
export async function syncOrderList(
  body: OrdersSyncBody,
): Promise<{ synced: number; newOrderIds: number[] }> {
  const orders = Array.isArray(body.orders) ? body.orders : [];
  const buyers = Array.isArray(body.buyers) ? body.buyers : [];
  const states = Array.isArray(body.order_states) ? body.order_states : [];
  if (orders.length === 0) return { synced: 0, newOrderIds: [] };

  // Shop của lần sync này (Etsy fetch order theo shopId nên từng order không nhúng
  // shop). Gắn vào mỗi order để trang Orders resolve đúng tên shop (vd "Chanilea").
  const currentShop = body.context?.data?.current_shop;
  const shopId = asNumber(currentShop?.shop_id);
  const shopName = asString(currentShop?.shop_name);

  const coll = await getEtsyOrdersCollection();
  const now = new Date();
  const newOrderIds: number[] = [];
  let synced = 0;

  for (const order of orders) {
    if (!isObject(order)) continue;
    const orderId = asNumber(order["order_id"]);
    if (orderId === undefined) continue;

    enrichOrder(order, buyers, states);

    // Gắn shop từ context (không ghi đè nếu order đã tự có).
    if (shopId !== undefined && asNumber(order["shop_id"]) === undefined) order["shop_id"] = shopId;
    if (shopName && !asString(order["shop_name"])) order["shop_name"] = shopName;

    const res = await coll.updateOne(
      { "data.order_id": orderId } as Filter<EtsyOrderDoc>,
      {
        $set: { data: order, updated_at: now },
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    );

    synced++;
    if (res.upsertedCount > 0) newOrderIds.push(orderId);
  }

  return { synced, newOrderIds };
}
