import type { WithId } from "mongodb";
import {
  getConversationsCollection,
  getEtsyOrdersCollection,
  getPersonalizationFilesCollection,
} from "@/lib/db/collections";
import { mapOrder } from "@/lib/services/orders-read";
import type {
  ConversationDoc,
  ConversationDetailResponse,
  EtsyOrderDoc,
  PersonalizationFile,
  ReceiptHistoryItem,
  ReceiptTransaction,
} from "@/lib/types/etsy";
import {
  asNumber,
  asString,
  decodeHtmlEntities,
  getPath,
  isObject,
} from "@/lib/services/etsy-utils";

// Lấy receipt_history (field nặng, bị loại khỏi list projection) + tên store để map sheet
// + user_id của khách để fallback dò etsy_orders khi receipt_history rỗng (guest buyer).
const DETAIL_PROJECTION = {
  "etsy.buyer_info.receipt_history": 1,
  "etsy.other_user.user_id": 1,
  "user_data.shop_name": 1,
} as const;

function mapPersonalizationFile(raw: unknown): PersonalizationFile {
  const f = isObject(raw) ? raw : {};
  return {
    url: asString(f["url"]),
    thumbnailUrl: asString(f["thumbnailUrl"]) || asString(f["thumbnail_url"]),
    filename: asString(f["filename"]),
  };
}

function mapTransaction(raw: unknown): ReceiptTransaction {
  const t = isObject(raw) ? raw : {};
  return {
    transactionId: asNumber(t["transaction_id"]) ?? 0,
    title: decodeHtmlEntities(asString(t["title"])),
    image: asString(t["image"]),
    quantity: asNumber(t["quantity"]) ?? 0,
    value: asString(t["value"]),
    // Ảnh khách upload lưu ở collection riêng `personalization_files`, gắn sau bằng attachPersonalizationFiles.
    personalizationFiles: [],
  };
}

/**
 * Gắn ảnh khách upload ("Your Photo") vào từng transaction theo transaction_id.
 * Đọc từ collection `personalization_files` (key receipt_id) — không phụ thuộc receipt_history.
 */
async function attachPersonalizationFiles(receipts: ReceiptHistoryItem[]): Promise<void> {
  const receiptIds = receipts.map((r) => r.receiptId).filter((id) => id > 0);
  if (receiptIds.length === 0) return;

  const coll = await getPersonalizationFilesCollection();
  const docs = await coll.find({ receipt_id: { $in: receiptIds } }).toArray();

  const byTx = new Map<number, PersonalizationFile[]>();
  for (const d of docs) {
    for (const tx of d.transactions ?? []) {
      const files = (tx.files ?? []).map(mapPersonalizationFile).filter((f) => f.url || f.thumbnailUrl);
      if (files.length > 0) byTx.set(tx.transaction_id, files);
    }
  }

  for (const r of receipts) {
    for (const tx of r.transactions) {
      tx.personalizationFiles = byTx.get(tx.transactionId) ?? [];
    }
  }
}

function mapReceipt(raw: unknown): ReceiptHistoryItem {
  const r = isObject(raw) ? raw : {};
  const rawTx = r["transactions"];
  const transactions = Array.isArray(rawTx) ? rawTx.map(mapTransaction) : [];
  return {
    receiptId: asNumber(r["receipt_id"]) ?? 0,
    date: asString(r["date"]),
    value: asString(r["value"]),
    state: asString(r["state"]),
    isShipped: r["is_shipped"] === true,
    isDigitalDelivery: r["is_digital_delivery"] === true,
    totalQty: asNumber(r["total_qty"]) ?? 0,
    transactions,
  };
}

/** Số đơn tối đa lấy từ etsy_orders khi fallback (đủ cho sidebar, tránh kéo cả lịch sử dài). */
const FALLBACK_ORDERS_LIMIT = 20;

/** unix giây → "Jun 11, 2023" (khớp format date của receipt_history Etsy). Trả "" nếu không có. */
function fmtReceiptDate(unixSec: number): string {
  if (!unixSec || unixSec <= 0) return "";
  const d = new Date(unixSec * 1000);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * Fallback khi conversation KHÔNG có receipt_history nhúng (điển hình: guest buyer —
 * payload Etsy trả buyer_info.receipt_history = [] dù khách có đơn thật).
 * Join ngược sang dora-master.etsy_orders theo buyer_id — cùng khóa với
 * order-conversation.ts / ai/order-context.ts — rồi map về shape ReceiptHistoryItem
 * (receipt_id của Etsy chính là order_id nên personalization_files vẫn gắn đúng).
 */
async function receiptHistoryFromOrders(buyerId: number): Promise<ReceiptHistoryItem[]> {
  if (!buyerId || buyerId <= 0) return [];
  try {
    const coll = await getEtsyOrdersCollection();
    const docs = (await coll
      .find({ $or: [{ "data.buyer_id": buyerId }, { "data.buyer.buyer_id": buyerId }] })
      .sort({ "data.order_date": -1, _id: -1 })
      .limit(FALLBACK_ORDERS_LIMIT)
      .toArray()) as WithId<EtsyOrderDoc>[];

    // shopName không cần cho sidebar → map rỗng (giống order-context).
    return docs.map((d) => {
      const o = mapOrder(d, new Map<number, string>());
      return {
        receiptId: o.orderId,
        date: fmtReceiptDate(o.orderDate),
        value: o.total,
        state: o.stateName,
        isShipped: o.shipping.wasShipped,
        // Payload order không có cờ digital delivery → mặc định false (chỉ ảnh hưởng badge).
        isDigitalDelivery: false,
        totalQty: o.transactions.reduce((s, t) => s + (t.quantity || 0), 0),
        transactions: o.transactions.map((t) => ({
          transactionId: t.transactionId,
          title: t.title,
          image: t.image,
          quantity: t.quantity,
          // Order payload không có giá từng transaction → "" (UI hiện "—").
          value: "",
          personalizationFiles: [],
        })),
      };
    });
  } catch (err) {
    // Fallback hỏng thì sidebar chỉ trống như cũ — không chặn phần còn lại của trang.
    console.error("[conversation-detail] receiptHistoryFromOrders failed:", err);
    return [];
  }
}

/** Lấy lịch sử đơn hàng (receipt_history) của 1 hội thoại cho sidebar phải. */
export async function getConversationReceiptHistory(
  conversationId: number,
): Promise<ConversationDetailResponse> {
  const coll = await getConversationsCollection();
  const doc = (await coll.findOne(
    { "etsy.conversation_id": conversationId },
    { projection: DETAIL_PROJECTION },
  )) as WithId<ConversationDoc> | null;

  const rawList = doc ? getPath(doc.etsy, "buyer_info.receipt_history") : undefined;
  let receiptHistory = Array.isArray(rawList) ? rawList.map(mapReceipt) : [];
  const storeName = asString(getPath(doc?.user_data ?? {}, "shop_name"));

  // Guest buyer: Etsy trả receipt_history rỗng dù khách có đơn → dò etsy_orders theo buyer_id.
  if (receiptHistory.length === 0 && doc) {
    const buyerId = asNumber(getPath(doc.etsy, "other_user.user_id")) ?? 0;
    receiptHistory = await receiptHistoryFromOrders(buyerId);
  }

  await attachPersonalizationFiles(receiptHistory);

  return { conversationId, storeName, receiptHistory };
}
