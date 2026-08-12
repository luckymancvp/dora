import { ObjectId } from "mongodb";
import { getConversationsCollection, getMessagesCollection } from "@/lib/db/collections";
import type { ConversationDoc, EtsyRaw, MessageDoc, MessageStatus } from "@/lib/types/etsy";
import { asNumber, firstNumber, firstString } from "@/lib/services/etsy-utils";
import { publishChatMessage, publishNewMessages } from "@/lib/services/ably-publish";
import { resolveShopNameByUserId } from "@/lib/services/shop-read";
import { captureSentReply } from "@/lib/services/ai/learning";

export interface CreatedMessage {
  id: string;
  conversationId: number;
  status: MessageStatus;
  /** Chỉ có khi FAILED — vì sao không đẩy được tới extension. */
  reason?: "shop-unknown" | "no-browser";
}

/**
 * Tạo tin nhắn đi (mirror DORA web MessageService.CreateMessage):
 * insert doc status NEW + etsy temp, rồi push Ably "chat-message" tới 1 browser extension.
 * Không có browser online → đánh FAILED.
 */
export async function createOutgoingMessage(
  conversationId: number,
  text: string,
  senderEmail: string,
  attachments: string[] = [],
): Promise<CreatedMessage> {
  const convColl = await getConversationsCollection();
  const msgColl = await getMessagesCollection();

  const conv = (await convColl.findOne(
    { "etsy.conversation_id": conversationId },
    { projection: { "user_data": 1, "etsy.user_data": 1 } },
  )) as ConversationDoc | null;
  if (!conv) throw new Error("conversation not found");

  const shopUserId =
    firstNumber(conv, ["user_data.user_id", "etsy.user_data.user_id"]) ?? 0;
  // Etsy đôi khi trả user_data "rút gọn" (shop_name = null) cho hội thoại chỉ sync
  // qua detail → channel Ably rỗng và tin luôn FAILED. Dò tiếp theo user_id shop.
  let shopName = firstString(conv, ["user_data.shop_name", "etsy.user_data.shop_name"]);
  if (!shopName && shopUserId) {
    shopName = await resolveShopNameByUserId(shopUserId);
  }

  const _id = new ObjectId();
  const now = new Date();
  const tempCmid = `tmp-${_id.toHexString()}-${Date.now()}`;

  const doc: MessageDoc = {
    _id,
    conversation_id: conversationId,
    message: text,
    attachments,
    sender_email: senderEmail,
    status: "NEW",
    created_at: now,
    updated_at: now,
    etsy: {
      conversation_id: conversationId,
      message: text,
      sender_id: shopUserId,
      create_date: Math.floor(Date.now() / 1000),
      conversation_message_id: tempCmid,
    },
  };
  await msgColl.insertOne(doc);

  // GĐ3: vòng lặp học + đo lường acceptance (chạy nền, không chặn/không làm hỏng gửi).
  void captureSentReply({
    conversationId,
    shopId: shopUserId,
    shopName,
    sentText: text,
    senderEmail,
  }).catch((e) => console.error("[send] captureSentReply:", (e as Error)?.message));

  // Đẩy tới extension. Không có browser → FAILED.
  let targeted: string | null = null;
  try {
    targeted = await publishChatMessage(shopName, {
      conversation_id: conversationId,
      message: { id: _id.toHexString(), message: text, attachments },
    });
  } catch (e) {
    console.warn("[send] publishChatMessage error:", (e as Error)?.message);
  }

  if (!targeted) {
    const reason = shopName ? "no-browser" : "shop-unknown";
    console.warn(
      `[send] conv ${conversationId} FAILED (${reason}) shop="${shopName}" shopUserId=${shopUserId}`,
    );
    await msgColl.updateOne({ _id }, { $set: { status: "FAILED", updated_at: new Date() } });
    return { id: _id.toHexString(), conversationId, status: "FAILED", reason };
  }

  return { id: _id.toHexString(), conversationId, status: "NEW" };
}

export async function getMessageStatus(id: string): Promise<MessageDoc | null> {
  const msgColl = await getMessagesCollection();
  let oid: ObjectId;
  try {
    oid = new ObjectId(id);
  } catch {
    return null;
  }
  return msgColl.findOne({ _id: oid });
}

/**
 * Cập nhật trạng thái tin (mirror DORA UpdateMessageStatus) — endpoint cho extension.
 * DONE kèm etsy thật: xử lý dedup nếu auto-sync đã chèn message với conversation_message_id thật.
 */
export async function updateMessageStatus(
  id: string,
  status: MessageStatus,
  messageEtsy?: EtsyRaw | null,
): Promise<boolean> {
  const msgColl = await getMessagesCollection();
  let oid: ObjectId;
  try {
    oid = new ObjectId(id);
  } catch {
    return false;
  }

  if (status === "DONE") {
    const realCmid = messageEtsy?.["conversation_message_id"];
    if (realCmid !== undefined && realCmid !== null) {
      // Nếu đã có doc khác mang conversation_message_id thật (do auto-sync) → gộp.
      const existing = await msgColl.findOne({
        "etsy.conversation_message_id": realCmid,
        _id: { $ne: oid },
      });
      if (existing) {
        await msgColl.deleteOne({ _id: oid });
        await msgColl.updateOne(
          { _id: existing._id },
          { $set: { status: "DONE", updated_at: new Date() } },
        );
        await afterDone(existing.conversation_id);
        return true;
      }
    }
    const set: Partial<MessageDoc> = { status: "DONE", updated_at: new Date() };
    if (messageEtsy) set.etsy = messageEtsy;
    const res = await msgColl.updateOne(
      { _id: oid, status: { $in: ["NEW", "SENDING"] } },
      { $set: set },
    );
    if (res.matchedCount > 0) {
      const doc = await msgColl.findOne({ _id: oid }, { projection: { conversation_id: 1 } });
      await afterDone(doc?.conversation_id ?? 0);
    }
    return res.matchedCount > 0;
  }

  // SENDING / FAILED / khác
  const filter: Record<string, unknown> = { _id: oid };
  if (status === "SENDING") filter.status = "NEW";
  if (status === "FAILED") filter.status = { $in: ["NEW", "SENDING"] };

  const set: Partial<MessageDoc> = { status, updated_at: new Date() };
  if (messageEtsy) set.etsy = messageEtsy;
  const res = await msgColl.updateOne(filter, { $set: set });
  return res.matchedCount > 0;
}

async function afterDone(conversationId: number): Promise<void> {
  if (conversationId) {
    // Báo các web client refetch để thấy tin thật (đúng thứ tự message_order).
    await publishNewMessages([conversationId]).catch(() => {});
  }
}
