import type { Filter } from "mongodb";
import { getOrderConversationsCollection } from "@/lib/db/collections";
import {
  asNumber,
  asString,
  brToNewline,
  decodeHtmlEntities,
  firstNumber,
  firstString,
  isObject,
} from "@/lib/services/etsy-utils";
import type {
  EtsyRaw,
  MessageItem,
  OrderConversationDoc,
  OrderConversationSyncBody,
} from "@/lib/types/etsy";

export interface OrderConversationSyncResult {
  received: number;
  saved: number;
  skipped: number;
}

/**
 * Bóc lớp bọc của payload Etsy: response có thể là {convo:{...}}, {conversation:{...}}
 * hoặc chính object convo. (Shape chưa được chốt bằng response thật — xem chú thích
 * trong parseOrderConvoMessages.)
 */
export function unwrapConvo(raw: unknown): EtsyRaw | null {
  if (!isObject(raw)) return null;
  for (const key of ["convo", "conversation"]) {
    const inner = raw[key];
    if (isObject(inner)) return inner;
  }
  return raw;
}

/** convo_id của hội thoại theo đơn; null khi đơn chưa có hội thoại nào. */
export function pickConversationId(root: EtsyRaw): number | null {
  const id = firstNumber(root, ["convo_id", "convoId", "conversation_id", "conversationId", "id"]);
  return id !== undefined && id > 0 ? id : null;
}

const MESSAGE_ARRAY_KEYS = ["messages", "message_list", "convo_messages", "items"];

function pickRawMessages(root: EtsyRaw): EtsyRaw[] {
  for (const key of MESSAGE_ARRAY_KEYS) {
    const v = root[key];
    if (Array.isArray(v)) return v.filter(isObject);
  }
  return [];
}

/** Etsy trả lúc unix giây, lúc ms, lúc chuỗi ISO → quy về unix GIÂY (0 nếu không đọc được). */
function toUnixSeconds(v: unknown): number {
  const n = asNumber(v);
  // 1e11 giây = năm 5138 → giá trị lớn hơn chắc chắn là mili-giây.
  if (n !== undefined && n > 0) return n > 1e11 ? Math.floor(n / 1000) : Math.floor(n);
  if (typeof v === "string" && v.trim() !== "") {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return Math.floor(t / 1000);
  }
  return 0;
}

const IMAGE_ARRAY_KEYS = ["images", "attachments", "image_attachments"];

function pickImages(m: EtsyRaw): string[] {
  const out: string[] = [];
  for (const key of IMAGE_ARRAY_KEYS) {
    const v = m[key];
    if (!Array.isArray(v)) continue;
    for (const item of v) {
      if (typeof item === "string" && item) {
        out.push(item);
      } else if (isObject(item)) {
        const url = firstString(item, [
          "url",
          "image_data.url",
          "full_url",
          "src",
          "thumbnail_url",
        ]);
        if (url) out.push(url);
      }
    }
  }
  return out;
}

const SHOP_FLAG_KEYS = [
  "is_from_shop",
  "is_shop",
  "is_seller",
  "is_from_seller",
  "from_seller",
  "sent_by_seller",
  "is_owner",
];
const BUYER_FLAG_KEYS = ["is_from_buyer", "is_buyer", "from_buyer"];
const SHOP_TYPE_VALUES = new Set(["shop", "seller", "merchant", "owner"]);

/**
 * Tin này do shop gửi hay khách gửi. Ưu tiên cờ boolean, rồi tới field kiểu
 * (sender_type/author_type), cuối cùng so tên người gửi với tên shop.
 * Mặc định false (coi là của khách) khi không có tín hiệu nào.
 */
function isFromShop(m: EtsyRaw, shopName: string): boolean {
  for (const k of SHOP_FLAG_KEYS) if (m[k] === true) return true;
  for (const k of BUYER_FLAG_KEYS) if (m[k] === true) return false;

  const type = firstString(m, ["sender_type", "author_type", "from", "direction"]).toLowerCase();
  if (SHOP_TYPE_VALUES.has(type)) return true;
  if (type === "buyer" || type === "customer") return false;

  const sender = firstString(m, ["sender_name", "from_name", "display_name", "author_name"]);
  if (shopName && sender && sender.trim().toLowerCase() === shopName.trim().toLowerCase()) {
    return true;
  }
  return false;
}

/**
 * Parse RAW convo của trang đơn → MessageItem (cùng type mà khung chat đang dùng).
 *
 * CẢNH BÁO: shape của mission-control/orders/convos/{orderId} chưa được xác nhận bằng
 * response thật, nên parser dò nhiều tên field. Doc gốc luôn được lưu ở
 * order_conversations.etsy → khi có mẫu thật chỉ cần sửa hàm này, KHÔNG phải sync lại.
 */
export function parseOrderConvoMessages(
  root: EtsyRaw,
  opts: { orderId: number; shopName?: string },
): MessageItem[] {
  const shopName = opts.shopName ?? asString(root["shop_name"]);
  const raws = pickRawMessages(root);

  const items = raws.map((m, i) => {
    const fromMe = isFromShop(m, shopName);
    const rawId = firstString(m, [
      "conversation_message_id",
      "message_id",
      "convo_message_id",
      "id",
    ]);
    const numId = firstNumber(m, [
      "conversation_message_id",
      "message_id",
      "convo_message_id",
      "id",
    ]);
    const id = rawId || (numId !== undefined ? String(numId) : `order-${opts.orderId}-${i}`);
    const text = firstString(m, ["message_body", "message", "body", "text", "content"]);
    return {
      id,
      message: brToNewline(decodeHtmlEntities(text)),
      senderId: firstNumber(m, ["sender_id", "from_user_id", "user_id", "author_id"]) ?? 0,
      fromMe,
      createDate: toUnixSeconds(
        m["create_date"] ??
          m["created_date"] ??
          m["creation_tsz"] ??
          m["timestamp"] ??
          m["sent_date"] ??
          m["date"],
      ),
      messageOrder: firstNumber(m, ["message_order"]) ?? i,
      isSystem: m["is_system_message"] === true,
      images: pickImages(m),
      senderEmail: "",
      senderName:
        firstString(m, ["sender_name", "from_name", "display_name", "author_name"]) ||
        (fromMe ? shopName : ""),
      senderAvatar: firstString(m, [
        "avatar_url",
        "sender_avatar",
        "shop_avatar_url",
        "image_url_75x75",
      ]),
    } satisfies MessageItem;
  });

  // Cũ → mới. Payload thiếu ngày (createDate=0) thì giữ nguyên thứ tự Etsy trả.
  const hasDates = items.some((m) => m.createDate > 0);
  if (hasDates) items.sort((a, b) => a.createDate - b.createDate || a.messageOrder - b.messageOrder);
  return items;
}

/**
 * Ghi hội thoại theo đơn mà extension GET từ trang đơn (mission-control).
 * Upsert theo order_id — mỗi lần GET Etsy trả nguyên thread nên THAY THẾ bản cũ.
 * Đơn chưa có hội thoại vẫn được ghi (conversation_id=null) để biết là "đã fetch rồi".
 */
export async function saveOrderConversations(
  body: OrderConversationSyncBody,
): Promise<OrderConversationSyncResult> {
  const orders = Array.isArray(body.orders) ? body.orders : [];
  const shopName = asString(body.shop_name);
  const shopId = asNumber(body.shop_id);
  if (orders.length === 0) return { received: 0, saved: 0, skipped: 0 };

  const coll = await getOrderConversationsCollection();
  const now = new Date();
  let saved = 0;
  let skipped = 0;

  for (const item of orders) {
    const orderId = isObject(item) ? asNumber(item.order_id) : undefined;
    const root = isObject(item) ? unwrapConvo(item.convo) : null;
    if (orderId === undefined || orderId <= 0 || !root) {
      skipped++;
      continue;
    }

    const messageCount = parseOrderConvoMessages(root, { orderId, shopName }).length;
    // shop_id chỉ set khi đọc được — tránh ghi null đè lên giá trị cũ.
    const set: Partial<OrderConversationDoc> = {
      shop_name: shopName,
      conversation_id: pickConversationId(root),
      etsy: root,
      message_count: messageCount,
      fetched_at: now,
      updated_at: now,
    };
    if (shopId !== undefined) set.shop_id = shopId;

    await coll.updateOne(
      { order_id: orderId } as Filter<OrderConversationDoc>,
      { $set: set, $setOnInsert: { order_id: orderId, created_at: now } },
      { upsert: true },
    );
    saved++;
  }

  return { received: orders.length, saved, skipped };
}
