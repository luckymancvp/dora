import clientPromise from "@/lib/mongodb-client";

/**
 * Hội thoại được NHÂN VIÊN gắn tay vào đơn ở Mera Fulfill (drawer "Gắn hội thoại").
 *
 * Ca cần: khách mua guest rồi nhắn bằng tài khoản khác ⇒ hội thoại không có
 * receipt_history và buyer_id lệch ⇒ sidebar "Lịch sử đơn hàng" + grounding AI không
 * thấy đơn. Mera lưu liên kết ở `<MERA_FULFILL_DB>.dora_order_links`
 * {order_id: "DAC-4189068249", conversation_id: <int64>, created_by, created_at}
 * — cùng Mongo server, cùng user doraApp ⇒ dora-1 đọc thẳng (CHỈ ĐỌC; gắn/gỡ làm ở Mera).
 *
 * MERA_FULFILL_DB: prod "mera_fulfill_master" (mặc định), local "mera_fulfill_local".
 */
const MERA_FULFILL_DB = process.env.MERA_FULFILL_DB || "mera_fulfill_master";

interface MeraOrderLinkDoc {
  order_id?: string;
  conversation_id?: number;
}

/**
 * order_id của Mera ("<PREFIX>-<receipt>" hoặc reship "<PREFIX>-<receipt>-<seq>") → receipt Etsy.
 * Không phải đơn Etsy (Shopify "COGI#1059", Amazon "COMZ-111-…") ⇒ null.
 */
export function receiptFromMeraOrderId(orderId: string): number | null {
  const m = /(?:^|[^\d])(\d{9,12})(?:-\d{1,4})?$/.exec((orderId || "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Chiều ngược: các hội thoại được gắn tay với BẤT KỲ receipt nào trong tập cho trước
 * (dùng cho bộ lọc Status — xem mera-status-index.ts). Liên kết gắn tay nên số lượng nhỏ ⇒ đọc hết
 * rồi lọc phía dora-1 (order_id là chuỗi có tiền tố, không $in theo receipt được). Lỗi ⇒ [].
 */
export async function getMeraLinkedConversationIds(receiptIds: Set<number>): Promise<number[]> {
  if (receiptIds.size === 0) return [];
  try {
    const client = await clientPromise;
    const docs = await client
      .db(MERA_FULFILL_DB)
      .collection<MeraOrderLinkDoc>("dora_order_links")
      .find({}, { projection: { order_id: 1, conversation_id: 1, _id: 0 } })
      .toArray();
    const out = new Set<number>();
    for (const d of docs) {
      const r = receiptFromMeraOrderId(d.order_id ?? "");
      const c = Number(d.conversation_id);
      if (r != null && receiptIds.has(r) && Number.isFinite(c) && c > 0) out.add(c);
    }
    return [...out];
  } catch (err) {
    console.error("[mera-links] getMeraLinkedConversationIds failed:", err);
    return [];
  }
}

/** Receipt Etsy của các đơn Mera đã gắn tay với hội thoại này. Lỗi ⇒ [] (không chặn trang). */
export async function getMeraLinkedReceiptIds(conversationId: number): Promise<number[]> {
  if (!conversationId || conversationId <= 0) return [];
  try {
    const client = await clientPromise;
    const docs = await client
      .db(MERA_FULFILL_DB)
      .collection<MeraOrderLinkDoc>("dora_order_links")
      .find({ conversation_id: conversationId }, { projection: { order_id: 1 } })
      .limit(20)
      .toArray();
    const out: number[] = [];
    for (const d of docs) {
      const r = receiptFromMeraOrderId(d.order_id ?? "");
      if (r != null && !out.includes(r)) out.push(r);
    }
    return out;
  } catch (err) {
    console.error("[mera-links] getMeraLinkedReceiptIds failed:", err);
    return [];
  }
}
