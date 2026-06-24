import type { WithId } from "mongodb";
import { getConversationsCollection, getEtsyOrdersCollection } from "@/lib/db/collections";
import { getConversationMessages } from "@/lib/services/message-read";
import { asNumber, asString, decodeHtmlEntities, firstString, getPath } from "@/lib/services/etsy-utils";
import type { ConversationDoc, EtsyOrderDoc, MessageItem } from "@/lib/types/etsy";

export interface OrderConversationResponse {
  /** conversation_id nếu khách đã có hội thoại (khớp theo username), null nếu chưa. */
  conversationId: number | null;
  buyerName: string;
  buyerUsername: string;
  /** Avatar khách (để hiện bong bóng giống trang Messenger). */
  buyerAvatar: string;
  /** Toàn bộ tin nhắn (cũ → mới) nếu có hội thoại. */
  messages: MessageItem[];
}

/**
 * Lấy hội thoại hiện có của khách trong 1 đơn (nếu đã từng nhắn).
 * Dò order trong etsy_orders → buyer.username → tìm conversation khớp username
 * (lấy hội thoại có tin mới nhất) → trả full messages để hiển thị trước khi nhắn.
 */
export async function getOrderConversation(orderId: number): Promise<OrderConversationResponse> {
  const orders = await getEtsyOrdersCollection();
  const order = (await orders.findOne(
    { "data.order_id": orderId },
    { projection: { "data.buyer": 1, "data.buyer_id": 1 } },
  )) as WithId<EtsyOrderDoc> | null;

  const buyerName = order
    ? decodeHtmlEntities(firstString(order.data, ["buyer.name", "buyer.username"]))
    : "";
  const username = order ? asString(getPath(order.data, "buyer.username")) : "";
  const buyerId = order
    ? asNumber(getPath(order.data, "buyer.buyer_id")) ?? asNumber(getPath(order.data, "buyer_id"))
    : undefined;
  if (!username && buyerId === undefined) {
    return { conversationId: null, buyerName, buyerUsername: username, buyerAvatar: "", messages: [] };
  }

  // Khớp hội thoại theo user_id (ổn định nhất) hoặc username của khách.
  const or: Record<string, unknown>[] = [];
  if (buyerId !== undefined) or.push({ "etsy.other_user.user_id": buyerId });
  if (username) {
    or.push(
      { "etsy.buyer_info.buyer_profile.username": username },
      { "etsy.other_user.username": username },
    );
  }

  const convColl = await getConversationsCollection();
  const conv = (await convColl.findOne(
    { $or: or } as Parameters<typeof convColl.findOne>[0],
    { projection: { "etsy.conversation_id": 1 }, sort: { lastMessageDate: -1 } },
  )) as WithId<ConversationDoc> | null;

  const conversationId = conv ? asNumber(getPath(conv, "etsy.conversation_id")) ?? null : null;
  if (!conversationId) {
    return { conversationId: null, buyerName, buyerUsername: username, buyerAvatar: "", messages: [] };
  }

  // Lấy nhiều tin nhất (newest 100) — đủ để xem lại ngữ cảnh trước khi trả lời.
  const msgs = await getConversationMessages({ conversationId, limit: 100 });
  return {
    conversationId,
    buyerName: buyerName || msgs.name,
    buyerUsername: username,
    buyerAvatar: msgs.avatar,
    messages: msgs.items,
  };
}
