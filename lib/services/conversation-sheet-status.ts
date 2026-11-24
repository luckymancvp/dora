import "server-only";

import type { AnyBulkWriteOperation } from "mongodb";
import { getConversationsCollection, getSheetRowsCollection } from "@/lib/db/collections";
import type { ConversationDoc } from "@/lib/types/etsy";
import { asNumber, getPath, isObject } from "@/lib/services/etsy-utils";

/** Lấy status duy nhất từ sheet_rows cho danh sách receiptIds. */
async function fetchStatusesForReceipts(receiptIds: number[]): Promise<string[]> {
  const rowsColl = await getSheetRowsCollection();
  const rows = await rowsColl
    .find({ receiptKey: { $in: receiptIds.map(String) } }, { projection: { "values.Status": 1 } })
    .toArray();
  const seen = new Set<string>();
  for (const row of rows) {
    const s = row.values?.["Status"];
    if (typeof s === "string" && s.trim()) seen.add(s.trim());
  }
  return [...seen];
}

/**
 * Receipt của hội thoại: etsy.buyer_info.receipt_history + mã đơn ở etsy.order_details.
 * Khách guest có receipt_history RỖNG, nhưng hội thoại mở từ trang đơn vẫn mang mã đơn trong
 * order_details — thiếu nguồn này thì hội thoại guest không bao giờ có sheetStatuses.
 */
function extractReceiptIds(etsy: Record<string, unknown>): number[] {
  const rawList = getPath(etsy, "buyer_info.receipt_history");
  const ids = new Set<number>();
  if (Array.isArray(rawList)) {
    for (const r of rawList) {
      const id = isObject(r) ? asNumber(r["receipt_id"]) ?? 0 : 0;
      if (id) ids.add(id);
    }
  }
  const orderId = asNumber(getPath(etsy, "order_details.order_info.order_id")) ?? 0;
  if (orderId) ids.add(orderId);
  return [...ids];
}

/** Projection đủ cho extractReceiptIds (tránh kéo nguyên blob etsy). */
const RECEIPT_SOURCES_PROJECTION = {
  "etsy.conversation_id": 1,
  "etsy.buyer_info.receipt_history.receipt_id": 1,
  "etsy.order_details.order_info.order_id": 1,
} as const;

/**
 * Tính lại sheetStatuses cho hội thoại sở hữu receiptId sau khi ghi Status.
 * Gọi từ writeOrderRow khi field "Status" thay đổi.
 */
export async function refreshConversationSheetStatuses(receiptId: number): Promise<void> {
  const convColl = await getConversationsCollection();
  // Một đơn có thể thuộc nhiều hội thoại (khách nhắn + hội thoại mở từ trang đơn) → cập nhật hết.
  const convs = await convColl
    .find(
      {
        $or: [
          { "etsy.buyer_info.receipt_history.receipt_id": receiptId },
          { "etsy.order_details.order_info.order_id": receiptId },
        ],
      },
      { projection: RECEIPT_SOURCES_PROJECTION },
    )
    .toArray();

  for (const conv of convs) {
    const convId = asNumber(conv.etsy["conversation_id"]);
    if (!convId) continue;

    const receiptIds = extractReceiptIds(conv.etsy as Record<string, unknown>);
    if (receiptIds.length === 0) continue;

    const statuses = await fetchStatusesForReceipts(receiptIds);
    await convColl.updateOne(
      { "etsy.conversation_id": convId },
      { $set: { sheetStatuses: statuses } },
    );
  }
}

/**
 * Bulk refresh sheetStatuses cho tất cả hội thoại bị ảnh hưởng sau syncSheetNow.
 * 2 query + 1 bulkWrite — không loop theo từng conversation.
 * @param syncedReceiptIds - receiptIds (số nguyên) vừa được sync
 */
export async function bulkRefreshSheetStatuses(syncedReceiptIds: number[]): Promise<void> {
  if (syncedReceiptIds.length === 0) return;

  const convColl = await getConversationsCollection();
  const rowsColl = await getSheetRowsCollection();

  // Tìm tất cả conversations có bất kỳ receiptId nào vừa sync.
  const convs = await convColl
    .find(
      {
        $or: [
          { "etsy.buyer_info.receipt_history.receipt_id": { $in: syncedReceiptIds } },
          { "etsy.order_details.order_info.order_id": { $in: syncedReceiptIds } },
        ],
      },
      { projection: RECEIPT_SOURCES_PROJECTION },
    )
    .toArray();
  if (convs.length === 0) return;

  // Gom TẤT CẢ receiptIds của các conversations bị ảnh hưởng.
  const allReceiptIds = new Set<number>();
  const convReceiptMap = new Map<number, number[]>();
  for (const conv of convs) {
    const convId = asNumber(conv.etsy["conversation_id"]);
    if (!convId) continue;
    const ids = extractReceiptIds(conv.etsy as Record<string, unknown>);
    convReceiptMap.set(convId, ids);
    for (const id of ids) allReceiptIds.add(id);
  }
  if (allReceiptIds.size === 0) return;

  // 1 query lấy toàn bộ status của tất cả receipts liên quan.
  const rows = await rowsColl
    .find(
      { receiptKey: { $in: [...allReceiptIds].map(String) } },
      { projection: { receiptKey: 1, "values.Status": 1 } },
    )
    .toArray();

  const receiptToStatuses = new Map<number, Set<string>>();
  for (const row of rows) {
    const rid = Number(row.receiptKey);
    const s = row.values?.["Status"];
    if (typeof s !== "string" || !s.trim()) continue;
    if (!receiptToStatuses.has(rid)) receiptToStatuses.set(rid, new Set());
    receiptToStatuses.get(rid)!.add(s.trim());
  }

  // Bulk update — 1 op/conversation.
  const ops: AnyBulkWriteOperation<ConversationDoc>[] = [];
  for (const [convId, receiptIds] of convReceiptMap) {
    const statuses = new Set<string>();
    for (const rid of receiptIds) {
      const s = receiptToStatuses.get(rid);
      if (s) for (const st of s) statuses.add(st);
    }
    ops.push({
      updateOne: {
        filter: { "etsy.conversation_id": convId },
        update: { $set: { sheetStatuses: [...statuses] } },
      },
    });
  }
  if (ops.length > 0) await convColl.bulkWrite(ops, { ordered: false });
}
