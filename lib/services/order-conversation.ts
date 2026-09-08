import type { WithId } from "mongodb";
import {
  getConversationsCollection,
  getEtsyOrdersCollection,
  getOrderConversationsCollection,
} from "@/lib/db/collections";
import { getConversationMessages } from "@/lib/services/message-read";
import { parseOrderConvoMessages } from "@/lib/services/order-conversation-sync";
import { asNumber, asString, decodeHtmlEntities, firstString, getPath } from "@/lib/services/etsy-utils";
import type {
  ConversationDoc,
  EtsyOrderDoc,
  MessageItem,
  OrderConversationDoc,
} from "@/lib/types/etsy";

/** Nguồn của thread đang hiển thị — quyết định có link sang /messages được không. */
export type OrderConversationSource = "inbox" | "order" | "none";

export interface OrderConversationResponse {
  /** conversation_id nếu khách đã có hội thoại (khớp theo username), null nếu chưa. */
  conversationId: number | null;
  buyerName: string;
  buyerUsername: string;
  /** Avatar khách (để hiện bong bóng giống trang Messenger). */
  buyerAvatar: string;
  /** Toàn bộ tin nhắn (cũ → mới) nếu có hội thoại. */
  messages: MessageItem[];
  /**
   * "inbox": hội thoại đã sync qua Messenger (có đủ tin, mở được trang /messages).
   * "order": thread lấy từ TRANG ĐƠN — khách guest / khách chưa trả lời chỉ có ở đây,
   *          KHÔNG mở được trang Messenger vì hội thoại không nằm trong inbox.
   * "none":  chưa có gì.
   */
  source: OrderConversationSource;
  /** unix giây lần cuối extension GET thread từ trang đơn (0 nếu chưa bao giờ). */
  fetchedAt: number;
}

/**
 * Lấy hội thoại hiện có của khách trong 1 đơn (nếu đã từng nhắn).
 *
 * Hai nguồn, ưu tiên theo thứ tự:
 * 1. `conversations` (inbox sync) — dò order → buyer.username/user_id → conversation.
 * 2. `order_conversations` (extension GET từ trang đơn) — nguồn DUY NHẤT cho khách guest
 *    hoặc khách chưa trả lời: thread đó không xuất hiện trong inbox nên (1) luôn trượt.
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
  const buyerAvatar = order ? firstString(order.data, ["buyer.avatar_url"]) : "";
  const buyerId = order
    ? asNumber(getPath(order.data, "buyer.buyer_id")) ?? asNumber(getPath(order.data, "buyer_id"))
    : undefined;

  // Khớp hội thoại theo user_id (ổn định nhất) hoặc username của khách.
  const or: Record<string, unknown>[] = [];
  if (buyerId !== undefined) or.push({ "etsy.other_user.user_id": buyerId });
  if (username) {
    or.push(
      { "etsy.buyer_info.buyer_profile.username": username },
      { "etsy.other_user.username": username },
    );
  }

  if (or.length > 0) {
    const convColl = await getConversationsCollection();
    const conv = (await convColl.findOne(
      { $or: or } as Parameters<typeof convColl.findOne>[0],
      { projection: { "etsy.conversation_id": 1 }, sort: { lastMessageDate: -1 } },
    )) as WithId<ConversationDoc> | null;

    const conversationId = conv ? asNumber(getPath(conv, "etsy.conversation_id")) ?? null : null;
    if (conversationId) {
      // Lấy nhiều tin nhất (newest 100) — đủ để xem lại ngữ cảnh trước khi trả lời.
      const msgs = await getConversationMessages({ conversationId, limit: 100 });
      return {
        conversationId,
        buyerName: buyerName || msgs.name,
        buyerUsername: username,
        buyerAvatar: msgs.avatar || buyerAvatar,
        messages: msgs.items,
        source: "inbox",
        fetchedAt: 0,
      };
    }
  }

  // Fallback: thread lấy từ trang đơn (khách guest / khách chưa trả lời).
  const orderConvColl = await getOrderConversationsCollection();
  const doc = (await orderConvColl.findOne({
    order_id: orderId,
  })) as WithId<OrderConversationDoc> | null;

  const fetchedAt = doc?.fetched_at ? Math.floor(doc.fetched_at.getTime() / 1000) : 0;
  if (!doc) {
    return {
      conversationId: null,
      buyerName,
      buyerUsername: username,
      buyerAvatar,
      messages: [],
      source: "none",
      fetchedAt: 0,
    };
  }

  const messages = parseOrderConvoMessages(doc.etsy ?? {}, {
    orderId,
    shopName: doc.shop_name ?? "",
  });
  return {
    conversationId: doc.conversation_id ?? null,
    buyerName: buyerName || firstString(doc.etsy ?? {}, ["buyer_name", "buyerName"]),
    buyerUsername:
      username || firstString(doc.etsy ?? {}, ["buyer_user_name", "buyerUserName"]),
    buyerAvatar,
    messages,
    source: messages.length > 0 ? "order" : "none",
    fetchedAt,
  };
}
