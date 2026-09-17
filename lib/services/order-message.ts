import { getOrderMessagesCollection } from "@/lib/db/collections";
import type { MessageStatus, OrderMessageDoc } from "@/lib/types/etsy";

export interface OrderMessageStatus {
  id: string;
  status: MessageStatus;
  convoId: number;
  error: string;
  orderId: string;
}

/**
 * Ghi lại 1 yêu cầu nhắn khách theo đơn trước khi publish Ably (status NEW).
 * Không có doc này thì extension báo DONE/FAILED chẳng có chỗ nào để ghi, và UI
 * buộc phải đoán là "đã gửi" ngay khi publish xong — kể cả khi Etsy từ chối.
 */
export async function createOrderMessage(doc: {
  id: string;
  shopName: string;
  orderId: string;
  message: string;
  attachments: string[];
  senderEmail: string;
}): Promise<void> {
  const coll = await getOrderMessagesCollection();
  const now = new Date();
  await coll.insertOne({
    id: doc.id,
    shop_name: doc.shopName,
    order_id: doc.orderId,
    message: doc.message,
    attachments: doc.attachments,
    sender_email: doc.senderEmail,
    status: "NEW",
    created_at: now,
    updated_at: now,
  });
}

const VALID_STATUS = new Set<MessageStatus>(["NEW", "SENDING", "DONE", "FAILED"]);

/**
 * Extension báo trạng thái gửi về (SENDING/DONE/FAILED).
 * Trả false nếu id không tồn tại — extension vẫn nuốt lỗi nên chỉ để log.
 */
export async function applyOrderMessageStatus(
  id: string,
  input: { status: string; convo_id?: unknown; error?: unknown },
): Promise<boolean> {
  const status = String(input.status).toUpperCase() as MessageStatus;
  if (!VALID_STATUS.has(status)) return false;

  const set: Partial<OrderMessageDoc> = { status, updated_at: new Date() };
  const convoId = Number(input.convo_id);
  if (Number.isFinite(convoId) && convoId > 0) set.convo_id = convoId;
  if (typeof input.error === "string" && input.error) set.error = input.error;

  const coll = await getOrderMessagesCollection();
  const res = await coll.updateOne({ id }, { $set: set });
  return res.matchedCount > 0;
}

/** Trạng thái hiện tại để panel "Nhắn khách" poll sau khi bấm Gửi. */
export async function getOrderMessageStatus(id: string): Promise<OrderMessageStatus | null> {
  const coll = await getOrderMessagesCollection();
  const doc = await coll.findOne({ id }, { projection: { _id: 0 } });
  if (!doc) return null;
  return {
    id: doc.id,
    status: doc.status,
    convoId: doc.convo_id ?? 0,
    error: doc.error ?? "",
    orderId: doc.order_id,
  };
}
