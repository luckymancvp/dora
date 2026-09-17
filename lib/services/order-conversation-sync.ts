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
 * Bóc lớp bọc của payload Etsy. Thực tế Etsy trả thẳng object convo
 * (type "Common_Convo", có convo_id/messages), nhưng vẫn chịu được dạng bọc
 * {convo:{...}} / {conversation:{...}} phòng khi Etsy đổi.
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

/** Tuỳ chọn parse — xem parseOrderConvoMessages. */
export interface OrderConvoParseOpts {
  orderId: number;
  /** Tên đăng nhập shop (vd "CusGiftsCo") — KHÁC tên hiển thị trên tin ("Custom Delights"). */
  shopName?: string;
  /** user_id của shop (stores → current_user.user_id). Cách nhận biết tin shop CHÍNH XÁC nhất. */
  shopUserId?: number;
  /** buyer_id của đơn — dùng khi thiếu shopUserId: hội thoại chỉ có 2 phía. */
  buyerId?: number;
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
 * Tin này do shop gửi hay khách gửi.
 *
 * Payload thật (`Common_Convo_Message`) KHÔNG có cờ nào phân biệt hai phía — chỉ có
 * `sender_user_id`. Nên phải SO ID: bằng user_id của shop thì là tin đi, hoặc (khi
 * chưa resolve được shop) khác buyer_id của đơn thì cũng là tin đi — hội thoại chỉ
 * có 2 phía. Mấy nhánh cờ/tên bên dưới chỉ là lưới đỡ cho payload lạ.
 *
 * Cẩn thận: `sender_display_name` là tên HIỂN THỊ ("Custom Delights") chứ không phải
 * shop_name ("CusGiftsCo") — so hai cái đó với nhau luôn sai, đừng dựa vào.
 */
function isFromShop(m: EtsyRaw, senderId: number, opts: OrderConvoParseOpts): boolean {
  if (senderId > 0) {
    if (opts.shopUserId && opts.shopUserId > 0) return senderId === opts.shopUserId;
    if (opts.buyerId && opts.buyerId > 0) return senderId !== opts.buyerId;
  }

  for (const k of SHOP_FLAG_KEYS) if (m[k] === true) return true;
  for (const k of BUYER_FLAG_KEYS) if (m[k] === true) return false;

  const type = firstString(m, ["sender_type", "author_type", "from", "direction"]).toLowerCase();
  if (SHOP_TYPE_VALUES.has(type)) return true;
  if (type === "buyer" || type === "customer") return false;

  const shopName = opts.shopName ?? "";
  const sender = firstString(m, [
    "sender_display_name",
    "sender_name",
    "from_name",
    "display_name",
    "author_name",
  ]);
  if (shopName && sender && sender.trim().toLowerCase() === shopName.trim().toLowerCase()) {
    return true;
  }
  return false;
}

/**
 * Parse RAW convo của trang đơn → MessageItem (cùng type mà khung chat đang dùng).
 *
 * Shape thật (đã xác nhận trên dữ liệu production, `Common_Convo_Message`):
 *   { convo_message_id, sender_user_id, sender_display_name, sender_avatar_url,
 *     message_body (có thể chứa HTML), create_date (unix giây), timestamp ("Sept 8, 2026"),
 *     is_system_message, is_admin, attachments: [] }
 * Các tên field khác vẫn được dò làm lưới đỡ. Doc gốc luôn nằm ở `order_conversations.etsy`
 * → sửa hàm này là đủ, KHÔNG phải sync lại từ Etsy.
 */
export function parseOrderConvoMessages(root: EtsyRaw, opts: OrderConvoParseOpts): MessageItem[] {
  const shopName = opts.shopName ?? asString(root["shop_name"]);
  const raws = pickRawMessages(root);

  const items = raws.map((m, i) => {
    const senderId =
      firstNumber(m, ["sender_user_id", "sender_id", "from_user_id", "user_id", "author_id"]) ?? 0;
    const fromMe = isFromShop(m, senderId, { ...opts, shopName });
    const rawId = firstString(m, [
      "convo_message_id",
      "conversation_message_id",
      "message_id",
      "id",
    ]);
    const numId = firstNumber(m, [
      "convo_message_id",
      "conversation_message_id",
      "message_id",
      "id",
    ]);
    const id = rawId || (numId !== undefined ? String(numId) : `order-${opts.orderId}-${i}`);
    const text = firstString(m, ["message_body", "message", "body", "text", "content"]);
    return {
      id,
      message: brToNewline(decodeHtmlEntities(text)),
      senderId,
      fromMe,
      // `timestamp` của payload này là chuỗi hiển thị ("Sept 8, 2026") — chỉ dùng khi
      // thiếu create_date, vì nó mất phần giờ nên sort kém chính xác.
      createDate: toUnixSeconds(
        m["create_date"] ??
          m["created_date"] ??
          m["creation_tsz"] ??
          m["sent_date"] ??
          m["date"] ??
          m["timestamp"],
      ),
      messageOrder: firstNumber(m, ["message_order"]) ?? i,
      isSystem: m["is_system_message"] === true,
      images: pickImages(m),
      senderEmail: "",
      senderName:
        firstString(m, [
          "sender_display_name",
          "sender_name",
          "from_name",
          "display_name",
          "author_name",
        ]) || (fromMe ? shopName : ""),
      senderAvatar: firstString(m, [
        "sender_avatar_url",
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
