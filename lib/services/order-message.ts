import { getOrderMessagesCollection } from "@/lib/db/collections";
import type { MessageStatus, OrderMessageDoc } from "@/lib/types/etsy";

export interface OrderMessageStatus {
  id: string;
  status: MessageStatus;
  convoId: number;
  error: string;
  orderId: string;
  /** Browser extension được đẩy tin; "" khi chưa ghi (doc cũ / publish chưa xong). */
  targetClientId: string;
  /** Cap của extension đó ([] = extension cũ) — Mera chỉ huỷ khi có claim_v2. */
  targetCaps: string[];
  afterId: string;
  lateDone: boolean;
  createdAt: Date;
  updatedAt: Date;
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
  /** id lô trước cùng đơn (Mera tách nhiều lô). */
  afterId?: string;
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
    ...(doc.afterId ? { after_id: doc.afterId } : {}),
    created_at: now,
    updated_at: now,
  });
}

/** Ghi browser được đẩy tin + caps (ngay sau publish, trước khi trả response cho caller). */
export async function setOrderMessageTarget(id: string, clientId: string, caps: string[]): Promise<void> {
  const coll = await getOrderMessagesCollection();
  await coll.updateOne({ id }, { $set: { target_client_id: clientId, target_caps: caps } });
}

/** Kết quả chuyển trạng thái — route map sang HTTP (200 / 409 / 404 / 400). */
export type OrderMessageTransition =
  | { ok: true; status: MessageStatus; already?: true; late_done?: true }
  | { ok: false; code: "invalid_transition"; status: MessageStatus; claimed_by?: string }
  | { ok: false; code: "not_found" | "invalid_status" };

type Decision = "apply" | "already" | "reject";

/** convo_id Etsy: số nguyên dương hoặc chuỗi toàn chữ số; khác (true, "abc", 1.5…) → 0. */
function parseConvoId(v: unknown): number {
  if (typeof v === "number") return Number.isSafeInteger(v) && v > 0 ? v : 0;
  if (typeof v === "string" && /^\d{1,16}$/.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isSafeInteger(n) && n > 0 ? n : 0;
  }
  return 0;
}

/**
 * Bảng chuyển trạng thái tin theo đơn (hợp đồng C2C4 §1.3, phía dora-1):
 *
 *   yêu cầu \ hiện tại     NEW     SENDING     DONE     FAILED       CANCELLED
 *   SENDING (claim)        apply   reject (*)  reject   reject       reject
 *   DONE có convo_id > 0   apply   apply       already  apply (late) apply (late)
 *   DONE không convo_id    apply²  apply       already  reject       reject
 *   FAILED                 apply   apply       reject   already      reject
 *
 * (*) claim lặp của chính client đã claim (claimed_by == client_id) → already.
 * ² Khác Dora: extension CŨ không claim send-order-message nên DONE/FAILED đến thẳng từ NEW.
 */
function decide(
  want: MessageStatus,
  cur: MessageStatus,
  evidence: boolean,
  clientId: string,
  claimedBy: string,
): Decision {
  switch (want) {
    case "SENDING":
      if (cur === "NEW") return "apply";
      if (cur === "SENDING" && clientId && claimedBy === clientId) return "already";
      return "reject";
    case "DONE":
      if (cur === "DONE") return "already";
      if (cur === "NEW" || cur === "SENDING") return "apply";
      if ((cur === "FAILED" || cur === "CANCELLED") && evidence) return "apply";
      return "reject";
    case "FAILED":
      if (cur === "NEW" || cur === "SENDING") return "apply";
      if (cur === "FAILED") return "already";
      return "reject";
    default:
      return "reject";
  }
}

// Route công khai chỉ nhận 3 trạng thái này; NEW (reset) và CANCELLED (chỉ qua route huỷ của
// Mera) → invalid_status.
const EXTENSION_STATUS = new Set<MessageStatus>(["SENDING", "DONE", "FAILED"]);

/**
 * Extension báo trạng thái về (claim SENDING, DONE/FAILED). Mọi ghi đều CAS theo trạng thái vừa
 * đọc: claim chỉ 1 tab thắng; tin Mera đã huỷ thì claim bị 409 và extension mới KHÔNG gửi.
 */
export async function applyOrderMessageStatus(
  id: string,
  input: { status: string; convo_id?: unknown; error?: unknown; client_id?: unknown },
): Promise<OrderMessageTransition> {
  const status = String(input.status ?? "").toUpperCase() as MessageStatus;
  if (!EXTENSION_STATUS.has(status)) return { ok: false, code: "invalid_status" };

  // Bằng chứng DONE muộn lấy từ BODY extension (convo_id Etsy thật), không từ doc đã lưu.
  const convoId = parseConvoId(input.convo_id);
  const evidence = status === "DONE" && convoId > 0;
  const clientId = typeof input.client_id === "string" ? input.client_id.trim() : "";

  const coll = await getOrderMessagesCollection();
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await coll.findOne(
      { id },
      { projection: { _id: 0, status: 1, claimed_by: 1 } },
    );
    if (!cur) return { ok: false, code: "not_found" };

    const curStatus = cur.status;
    const d = decide(status, curStatus, evidence, clientId, cur.claimed_by ?? "");
    if (d === "already") return { ok: true, status: curStatus, already: true };
    if (d === "reject") {
      return {
        ok: false,
        code: "invalid_transition",
        status: curStatus,
        ...(cur.claimed_by ? { claimed_by: cur.claimed_by } : {}),
      };
    }

    const now = new Date();
    const set: Partial<OrderMessageDoc> = { status, updated_at: now };
    let lateDone = false;
    if (status === "SENDING") {
      set.claimed_at = now;
      if (clientId) set.claimed_by = clientId;
    } else if (status === "DONE") {
      set.done_from = curStatus;
      if (curStatus === "FAILED" || curStatus === "CANCELLED") {
        lateDone = true;
        set.late_done = true;
      }
    }
    if (convoId > 0) set.convo_id = convoId;
    if (status === "FAILED" && typeof input.error === "string" && input.error) set.error = input.error;

    const res = await coll.updateOne({ id, status: curStatus }, { $set: set });
    if (res.matchedCount === 0) continue; // trạng thái vừa đổi giữa lúc đọc và ghi → tra lại
    if (lateDone) console.warn(`[order-message] ${id}: late DONE (was ${curStatus})`);
    return lateDone ? { ok: true, status, late_done: true } : { ok: true, status };
  }

  // Đua liên tục (hiếm): báo trạng thái hiện tại như 409 để caller không coi là thành công.
  const latest = await coll.findOne({ id }, { projection: { _id: 0, status: 1 } });
  if (!latest) return { ok: false, code: "not_found" };
  return { ok: false, code: "invalid_transition", status: latest.status };
}

/**
 * Mera huỷ tin còn NEW (CAS {id, status:NEW} → CANCELLED). Đã CANCELLED → already; trạng thái
 * khác → invalid_transition kèm trạng thái thật để Mera xử theo đó.
 */
export async function cancelOrderMessage(id: string, by: string): Promise<OrderMessageTransition> {
  const coll = await getOrderMessagesCollection();
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = new Date();
    const res = await coll.updateOne(
      { id, status: "NEW" },
      { $set: { status: "CANCELLED", cancelled_at: now, cancelled_by: by, updated_at: now } },
    );
    if (res.matchedCount > 0) return { ok: true, status: "CANCELLED" };

    const cur = await coll.findOne({ id }, { projection: { _id: 0, status: 1 } });
    if (!cur) return { ok: false, code: "not_found" };
    if (cur.status === "CANCELLED") return { ok: true, status: "CANCELLED", already: true };
    if (cur.status === "NEW") continue; // đua → thử lại
    return { ok: false, code: "invalid_transition", status: cur.status };
  }
  return { ok: false, code: "invalid_transition", status: "NEW" };
}

/** Trạng thái hiện tại để panel "Nhắn khách" (và Mera) poll sau khi bấm Gửi. */
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
    targetClientId: doc.target_client_id ?? "",
    targetCaps: doc.target_caps ?? [],
    afterId: doc.after_id ?? "",
    lateDone: doc.late_done ?? false,
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
  };
}
