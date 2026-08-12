import { getConversationsCollection, getMessagesCollection } from "@/lib/db/collections";
import type { ConversationDoc, ConversationSyncBody, EtsyRaw } from "@/lib/types/etsy";
import {
  asNumber,
  asString,
  extractLastMessageDate,
  getLastMessage,
  isObject,
} from "@/lib/services/etsy-utils";

/**
 * Chọn user_data (danh tính SHOP) để ghi top-level.
 *
 * Etsy có lúc trả bản "rút gọn" của chính shop: shop_name = null, is_seller = false,
 * is_frozen = true. Ghi đè bản này lên user_data tốt sẽ xoá mất tên shop → không
 * publish Ably được (channel = shop_name) và gửi tin luôn FAILED. Vì vậy: giữ bản cũ
 * khi bản mới cùng user_id nhưng mất shop_name.
 */
function pickShopUserData(incoming: EtsyRaw | null, existing: EtsyRaw | null): EtsyRaw | null {
  if (!incoming) return existing;
  if (!existing) return incoming;
  const incomingName = asString(incoming["shop_name"]).trim();
  if (incomingName) return incoming;
  const existingName = asString(existing["shop_name"]).trim();
  if (!existingName) return incoming;
  const sameUser = asNumber(incoming["user_id"]) === asNumber(existing["user_id"]);
  return sameUser ? existing : incoming;
}

/**
 * Port của dora-backend ConversationService.Sync (extension/services/conversation_service.go).
 * Trả về mảng conversation_id cần sync chi tiết message.
 */
export async function syncConversationList(body: ConversationSyncBody): Promise<number[]> {
  const conversations = Array.isArray(body.conversations) ? body.conversations : [];
  const userData = body.user_data ?? null;

  const needSync: number[] = [];
  for (const item of conversations) {
    if (!isObject(item)) continue;
    const result = await processSyncConversation(item, userData);
    if (result.needSync) needSync.push(result.conversationId);
  }
  return needSync;
}

async function processSyncConversation(
  item: EtsyRaw,
  userData: EtsyRaw | null,
): Promise<{ conversationId: number; needSync: boolean }> {
  const coll = await getConversationsCollection();
  const conversationId = asNumber(item["conversation_id"]);
  if (conversationId === undefined) return { conversationId: 0, needSync: false };

  const filter = { "etsy.conversation_id": conversationId };
  const existing = await coll.findOne(filter);
  const isNew = existing === null;

  let mergedEtsy: EtsyRaw = item;

  if (!isNew) {
    const newCount = asNumber(item["message_count"]);
    const oldCount = asNumber(existing.etsy["message_count"]);
    const newExcerpt = asString(item["excerpt"]);
    const oldExcerpt = asString(existing.etsy["excerpt"]);

    // Nếu message_count/excerpt giống nhau → kiểm tra message cuối đã có trong DB chưa.
    if (newCount === oldCount && newExcerpt === oldExcerpt) {
      const stillNeedSync = await checkLastMessageInDB(existing.etsy);
      if (!stillNeedSync) {
        return { conversationId, needSync: false };
      }
    }

    // Merge: giữ field cũ, overlay field mới.
    mergedEtsy = { ...existing.etsy };
    for (const [k, v] of Object.entries(item)) mergedEtsy[k] = v;
  }

  const lastMessageDate = extractLastMessageDate(mergedEtsy);
  const now = new Date();

  // Chỉ ghi khi biết shop — payload thiếu user_data mà vẫn $set thì xoá mất shop
  // đã lưu, hội thoại thành "không xác định shop" trong analytics.
  const shopUserData = pickShopUserData(userData, existing?.user_data ?? null);

  await coll.updateOne(
    filter,
    {
      $set: {
        etsy: mergedEtsy,
        ...(shopUserData ? { user_data: shopUserData } : {}),
        updated_at: now,
        lastMessageDate,
      },
      $setOnInsert: {
        created_at: now,
        tags: [] as string[],
        note: "",
      },
    },
    { upsert: true },
  );

  return { conversationId, needSync: true };
}

/** true = cần sync (message cuối chưa có trong messages collection). */
async function checkLastMessageInDB(etsy: EtsyRaw): Promise<boolean> {
  const last = getLastMessage(etsy);
  if (!last) return true;
  const messageId = last["conversation_message_id"];
  if (messageId === undefined || messageId === null) return true;

  const messages = await getMessagesCollection();
  const count = await messages.countDocuments({
    "etsy.conversation_message_id": messageId,
    $or: [{ status: "DONE" }, { status: "" }, { status: { $exists: false } }],
  });
  return count === 0;
}

/**
 * Port của ConversationService.MergeAndSync — merge conversation detail vào etsy,
 * tính has_replied + lastMessageDate, upsert theo etsy.conversation_id.
 */
export async function mergeAndSyncConversation(
  conversationId: number,
  body: EtsyRaw,
): Promise<void> {
  const coll = await getConversationsCollection();
  const filter = { "etsy.conversation_id": conversationId };
  const existing = await coll.findOne(filter);

  const mergedEtsy: EtsyRaw = existing ? { ...existing.etsy } : {};
  for (const [k, v] of Object.entries(body)) mergedEtsy[k] = v;
  mergedEtsy["conversation_id"] = conversationId;

  // shop_id từ user_data.user_id
  let shopId: number | undefined;
  const ud = body["user_data"];
  if (isObject(ud)) shopId = asNumber(ud["user_id"]);
  // Lấy user_data top-level từ existing nếu detail không kèm (giữ shop cho hội thoại
  // chỉ sync qua detail — nếu thiếu, tin của shop bị hiểu nhầm là của khách).
  // pickShopUserData còn chặn bản user_data rút gọn (mất shop_name) ghi đè bản tốt.
  const userData = pickShopUserData(isObject(ud) ? ud : null, existing?.user_data ?? null);

  // has_replied: mặc định false (an toàn), chỉ true khi message cuối là reply thật từ shop.
  let hasReplied = false;
  if (typeof body["has_replied"] === "boolean") hasReplied = body["has_replied"];

  const lastMessageDate = computeHasRepliedAndDate(mergedEtsy, shopId, (v) => {
    hasReplied = v;
  }, hasReplied);

  mergedEtsy["has_replied"] = hasReplied;

  const now = new Date();
  await coll.updateOne(
    filter,
    {
      $set: {
        etsy: mergedEtsy,
        ...(userData ? { user_data: userData } : {}),
        updated_at: now,
        lastMessageDate,
      },
      $setOnInsert: { created_at: now, tags: [] as string[], note: "" },
    },
    { upsert: true },
  );
}

/**
 * Tính lastMessageDate, đồng thời cập nhật has_replied qua callback (mirror logic Go).
 * Trả về lastMessageDate.
 */
function computeHasRepliedAndDate(
  etsy: EtsyRaw,
  shopId: number | undefined,
  setHasReplied: (v: boolean) => void,
  current: boolean,
): number {
  const last = getLastMessage(etsy);
  if (!last) return 0;

  const lastMessageDate = asNumber(last["create_date"]) ?? 0;

  if (shopId === undefined || shopId === 0) return lastMessageDate;

  const senderId = asNumber(last["sender_id"]);
  const messageFlags = asNumber(last["message_flags"]) ?? 0;
  const isSystem = last["is_system_message"] === true;
  const type = asString(last["type"]);

  if (senderId === undefined) {
    setHasReplied(current);
    return lastMessageDate;
  }

  if (isSystem || type === "system") {
    setHasReplied(false); // system message — không tính là shop reply
  } else if (senderId === shopId) {
    setHasReplied(messageFlags === 0); // flags != 0 = auto-reply → chưa coi là reply
  } else {
    setHasReplied(false); // message từ customer
  }

  return lastMessageDate;
}

export type { ConversationDoc };
