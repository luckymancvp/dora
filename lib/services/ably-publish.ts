import * as Ably from "ably";

// Channel/event khớp dora-backend: PushMessage("all", "new-message-event", ...)
export const ABLY_CHANNEL = "all";
export const NEW_MESSAGE_EVENT = "new-message-event";

declare global {
  // eslint-disable-next-line no-var
  var _ablyRest: Ably.Rest | undefined;
}

function getRest(): Ably.Rest | null {
  const key = process.env.ABLY_KEY;
  if (!key) return null;
  if (!global._ablyRest) global._ablyRest = new Ably.Rest({ key });
  return global._ablyRest;
}

// Event/channel cho luồng GỬI tin (extension nghe trên channel = shop_name).
export const CHAT_MESSAGE_EVENT = "chat-message";

// Event tracking (extension đã subscribe sẵn trên channel = shop_name).
export const FETCH_SHIPMENTS_EVENT = "fetch-shipments";
export const SEND_TRACKING_EVENT = "send-tracking";

// Event yêu cầu extension GET lại ảnh khách upload ("Your Photo").
export const FETCH_PERSONALIZATION_EVENT = "fetch-personalization";

// Event trigger extension sync đơn từ Etsy về (channel = shop_name).
export const FETCH_ORDERS_EVENT = "fetch-orders";

// Event nhắn khách theo đơn (extension tự tạo hội thoại mới nếu chưa có).
export const SEND_ORDER_MESSAGE_EVENT = "send-order-message";

/**
 * Chọn 1 browser extension đang online trên channel của shop (presence) —
 * lấy client cuối để đảm bảo chỉ 1 client xử lý. Trả null nếu không có ai online.
 */
async function pickTargetClient(channel: Ably.RestChannel): Promise<string | null> {
  const presence = await channel.presence.get();
  const members = presence.items ?? [];
  if (members.length === 0) return null;
  return members[members.length - 1].clientId ?? null;
}

/**
 * Publish 1 event mỗi conversation có message mới (best-effort, không throw).
 * Frontend nghe event này để refetch realtime.
 */
export async function publishNewMessages(conversationIds: number[]): Promise<void> {
  const rest = getRest();
  if (!rest || conversationIds.length === 0) return;
  const channel = rest.channels.get(ABLY_CHANNEL);
  await Promise.all(
    conversationIds.map((id) =>
      channel
        .publish(NEW_MESSAGE_EVENT, { conversation_id: id })
        .catch((e) => console.warn("[ably] publish failed:", e?.message ?? e)),
    ),
  );
}

/**
 * Đẩy yêu cầu gửi tin tới 1 browser extension đang online (mirror DORA
 * PushMessageOnly1Browser): channel = shop_name, event "chat-message".
 * Trả về clientId được nhắm tới, hoặc null nếu không có browser nào online.
 */
export async function publishChatMessage(
  shopName: string,
  data: { conversation_id: number; message: { id: string; message: string; attachments: string[] } },
): Promise<string | null> {
  const rest = getRest();
  if (!rest || !shopName) return null;
  const channel = rest.channels.get(shopName);

  const targetClientId = await pickTargetClient(channel);
  if (!targetClientId) return null;

  await channel.publish(CHAT_MESSAGE_EVENT, { ...data, clientId: targetClientId });
  return targetClientId;
}

/**
 * Yêu cầu extension GET shipments của các đơn (event "fetch-shipments").
 * Extension trả kết quả về POST /v1/extension/trackings/shipments-result kèm `id`.
 * Trả clientId được nhắm tới, hoặc null nếu shop không có browser online.
 */
export async function publishFetchShipments(
  shopName: string,
  data: { id: string; shopId: number | null; orderIds: string[] },
): Promise<string | null> {
  const rest = getRest();
  if (!rest || !shopName) return null;
  const channel = rest.channels.get(shopName);

  const targetClientId = await pickTargetClient(channel);
  if (!targetClientId) return null;

  await channel.publish(FETCH_SHIPMENTS_EVENT, { ...data, clientId: targetClientId });
  return targetClientId;
}

export interface SendTrackingOrder {
  order_id: string;
  carrier: number;
  other_carrier: string;
  tracking_number: string;
  note?: string;
  ship_date?: number;
}

/**
 * Yêu cầu extension add tracking lên Etsy (event "send-tracking").
 * Extension báo trạng thái về POST /v1/extension/trackings/status/{id}.
 * Trả clientId được nhắm tới, hoặc null nếu shop không có browser online.
 */
export async function publishSendTracking(
  shopName: string,
  data: { id: string; shopId: number | null; orders: SendTrackingOrder[] },
): Promise<string | null> {
  const rest = getRest();
  if (!rest || !shopName) return null;
  const channel = rest.channels.get(shopName);

  const targetClientId = await pickTargetClient(channel);
  if (!targetClientId) return null;

  await channel.publish(SEND_TRACKING_EVENT, { ...data, clientId: targetClientId });
  return targetClientId;
}

/**
 * Yêu cầu extension GET lại ảnh khách upload cho các đơn của hội thoại (event "fetch-personalization").
 * Extension fetch từ Etsy rồi POST về dora-backend (extension/personalization-files).
 * Trả clientId được nhắm tới, hoặc null nếu shop không có browser online.
 */
export async function publishFetchPersonalization(
  shopName: string,
  data: { conversation_id: number; receipt_ids: number[] },
): Promise<string | null> {
  const rest = getRest();
  if (!rest || !shopName) return null;
  const channel = rest.channels.get(shopName);

  const targetClientId = await pickTargetClient(channel);
  if (!targetClientId) return null;

  await channel.publish(FETCH_PERSONALIZATION_EVENT, { ...data, clientId: targetClientId });
  return targetClientId;
}

/**
 * Trigger extension sync đơn từ Etsy về (event "fetch-orders", channel = shop_name).
 * Extension nhận {date_from, date_to} (ISO date), fetch rồi POST về backend → etsy_orders.
 * KHÔNG báo kết quả về app này → fire-and-forget; frontend tự refetch sau.
 * Trả clientId được nhắm tới, hoặc null nếu shop không có browser online.
 */
export async function publishFetchOrders(
  shopName: string,
  data: { date_from?: string; date_to?: string },
): Promise<string | null> {
  const rest = getRest();
  if (!rest || !shopName) return null;
  const channel = rest.channels.get(shopName);

  const targetClientId = await pickTargetClient(channel);
  if (!targetClientId) return null;

  // Extension handler "fetch-orders" KHÔNG lọc theo clientId; vẫn gửi để biết shop online.
  await channel.publish(FETCH_ORDERS_EVENT, data);
  return targetClientId;
}

/**
 * Nhắn khách theo đơn (event "send-order-message", channel = shop_name).
 * Extension getOrderConvo → gửi vào hội thoại cũ, hoặc tạo hội thoại mới + gửi tin đầu.
 * Trạng thái báo về Go backend (KHÔNG về app này) → fire-and-forget.
 * Trả clientId được nhắm tới, hoặc null nếu shop không có browser online.
 */
export async function publishSendOrderMessage(
  shopName: string,
  data: { id: string; order_id: string; message: string },
): Promise<string | null> {
  const rest = getRest();
  if (!rest || !shopName) return null;
  const channel = rest.channels.get(shopName);

  const targetClientId = await pickTargetClient(channel);
  if (!targetClientId) return null;

  await channel.publish(SEND_ORDER_MESSAGE_EVENT, { ...data, clientId: targetClientId });
  return targetClientId;
}

/**
 * Tập shop_name đang online (extension enter presence trên channel "all-shops").
 * Mirror dora AblyService.GetOnlineShops.
 */
export async function getOnlineShopNames(): Promise<Set<string>> {
  const rest = getRest();
  const names = new Set<string>();
  if (!rest) return names;
  try {
    const presence = await rest.channels.get("all-shops").presence.get();
    for (const m of presence.items ?? []) {
      const data = m.data as { shop_name?: string } | undefined;
      if (data?.shop_name) names.add(data.shop_name);
    }
  } catch (e) {
    console.warn("[ably] presence all-shops failed:", (e as Error)?.message);
  }
  return names;
}
