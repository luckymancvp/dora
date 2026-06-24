import type { WithId } from "mongodb";
import {
  getConversationsCollection,
  getDb,
  getMessagesCollection,
} from "@/lib/db/collections";
import type {
  ConversationDoc,
  MessageDoc,
  MessageItem,
  MessageListResponse,
} from "@/lib/types/etsy";
import {
  asNumber,
  asString,
  brToNewline,
  decodeHtmlEntities,
  firstNumber,
  firstString,
} from "@/lib/services/etsy-utils";

const MSG_PROJECTION = {
  "etsy.conversation_message_id": 1,
  "etsy.message": 1,
  "etsy.sender_id": 1,
  "etsy.create_date": 1,
  "etsy.message_order": 1,
  "etsy.is_system_message": 1,
  "etsy.images": 1,
  attachments: 1,
  sender_email: 1,
} as const;

export interface UserInfo {
  name: string;
  image: string;
}

/** Map email → thông tin nhân viên (từ collection users của next-auth, ở db mặc định). */
export async function getUsersByEmail(emails: string[]): Promise<Map<string, UserInfo>> {
  const map = new Map<string, UserInfo>();
  if (emails.length === 0) return map;
  // users do next-auth adapter ghi vào cùng db meta_local (xem auth.ts).
  const db = await getDb();
  const users = await db
    .collection("users")
    .find({ email: { $in: emails } }, { projection: { email: 1, name: 1, image: 1 } })
    .toArray();
  for (const u of users) {
    if (typeof u.email === "string") {
      map.set(u.email, {
        name: typeof u.name === "string" ? u.name : "",
        image: typeof u.image === "string" ? u.image : "",
      });
    }
  }
  return map;
}

const CONV_HEADER_PROJECTION = {
  "etsy.other_user": 1,
  "etsy.buyer_info.buyer_profile": 1,
  "user_data.user_id": 1,
  "user_data.shop_name": 1,
  "user_data.shop_avatar_url": 1,
  "user_data.avatar_url": 1,
  // Fallback khi hội thoại chỉ được sync qua detail (chưa có user_data top-level):
  // shop nằm trong etsy.user_data. Thiếu nó → shopUserId=0 → tin của shop bị hiểu
  // nhầm là của khách (fromMe=false).
  "etsy.user_data.user_id": 1,
  "etsy.user_data.shop_name": 1,
  "etsy.user_data.shop_avatar_url": 1,
  "etsy.user_data.avatar_url": 1,
} as const;

function mapMessage(
  doc: WithId<MessageDoc>,
  shopUserId: number,
  users: Map<string, UserInfo>,
  shop: { name: string; avatar: string },
): MessageItem {
  const etsy = doc.etsy ?? {};
  const senderId = asNumber(etsy["sender_id"]) ?? 0;
  const rawImages = etsy["images"];
  const etsyImages: string[] = [];
  if (Array.isArray(rawImages)) {
    for (const img of rawImages) {
      if (typeof img === "string" && img) {
        etsyImages.push(img);
      } else if (img !== null && typeof img === "object") {
        const o = img as Record<string, unknown>;
        const imageData = o["image_data"];
        const url =
          (imageData !== null && typeof imageData === "object"
            ? (imageData as Record<string, unknown>)["url"]
            : null) ?? o["url"];
        if (typeof url === "string" && url) etsyImages.push(url);
      }
    }
  }
  const docAttachments = Array.isArray(doc.attachments)
    ? doc.attachments.filter((x): x is string => typeof x === "string" && x !== "")
    : [];
  const images = etsyImages.length > 0 ? etsyImages : docAttachments;
  const senderEmail = typeof doc.sender_email === "string" ? doc.sender_email : "";
  const user = senderEmail ? users.get(senderEmail) : undefined;
  const fromMe = shopUserId !== 0 && senderId === shopUserId;
  // Tin của shop nhưng gửi thẳng từ Etsy (không có nhân viên/sender_email) →
  // dùng tên & avatar của shop thay cho fallback "?".
  const senderName = user?.name ?? (senderEmail ? senderEmail.split("@")[0] : "");
  const senderAvatar = user?.image ?? "";
  return {
    id: String(etsy["conversation_message_id"] ?? doc._id.toHexString()),
    message: brToNewline(decodeHtmlEntities(asString(etsy["message"]))),
    senderId,
    fromMe,
    createDate: asNumber(etsy["create_date"]) ?? 0,
    messageOrder: asNumber(etsy["message_order"]) ?? 0,
    isSystem: etsy["is_system_message"] === true,
    images,
    senderEmail,
    senderName: senderName || (fromMe ? shop.name : ""),
    senderAvatar: senderAvatar || (fromMe ? shop.avatar : ""),
  };
}

export async function getConversationMessages(opts: {
  conversationId: number;
  before?: number | null;
  limit?: number;
}): Promise<MessageListResponse> {
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 100);
  const convColl = await getConversationsCollection();
  const msgColl = await getMessagesCollection();

  const conv = (await convColl.findOne(
    { "etsy.conversation_id": opts.conversationId },
    { projection: CONV_HEADER_PROJECTION },
  )) as WithId<ConversationDoc> | null;

  const shopUserId = conv
    ? firstNumber(conv, ["user_data.user_id", "etsy.user_data.user_id"]) ?? 0
    : 0;
  const shop = {
    name: conv ? firstString(conv, ["user_data.shop_name", "etsy.user_data.shop_name"]) : "",
    avatar: conv
      ? firstString(conv, [
          "user_data.shop_avatar_url",
          "user_data.avatar_url",
          "etsy.user_data.shop_avatar_url",
          "etsy.user_data.avatar_url",
        ])
      : "",
  };
  const name = conv
    ? decodeHtmlEntities(
        firstString(conv.etsy ?? {}, [
          "other_user.display_name",
          "other_user.name",
          "buyer_info.buyer_profile.display_name",
          "buyer_info.buyer_profile.username",
        ]),
      )
    : "";
  const avatar = conv
    ? firstString(conv.etsy ?? {}, [
        "other_user.im_avatar",
        "other_user.avatar_url",
        "buyer_info.buyer_profile.avatar_url",
      ])
    : "";

  const filter: Record<string, unknown> = { "etsy.conversation_id": opts.conversationId };
  if (typeof opts.before === "number") {
    filter["etsy.message_order"] = { $lt: opts.before };
  }

  // Lấy N message mới nhất (desc), +1 để biết còn cũ hơn không.
  const docs = (await msgColl
    .find(filter, { projection: MSG_PROJECTION })
    .sort({ "etsy.message_order": -1 })
    .limit(limit + 1)
    .toArray()) as WithId<MessageDoc>[];

  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;

  // nextCursor = message_order nhỏ nhất đã trả (để load tin cũ hơn).
  const oldest = page[page.length - 1];
  const nextCursor =
    hasMore && oldest ? String(asNumber(oldest.etsy?.["message_order"]) ?? "") : null;

  // Join thông tin nhân viên gửi (theo sender_email) để hiện avatar/tên.
  const emails = [
    ...new Set(
      page
        .map((d) => (typeof d.sender_email === "string" ? d.sender_email : ""))
        .filter((e) => e !== ""),
    ),
  ];
  const users = await getUsersByEmail(emails);

  // Đảo về thứ tự tăng dần (cũ → mới) để hiển thị.
  const items = page.map((d) => mapMessage(d, shopUserId, users, shop)).reverse();

  return {
    conversationId: opts.conversationId,
    shopUserId,
    name,
    avatar,
    items,
    nextCursor,
  };
}
