import type { Collection, Db } from "mongodb";
import clientPromise from "@/lib/mongodb-client";
import type { AutoReplyDoc, ConversationDoc, MessageDoc, MessageTemplateDoc } from "@/lib/types/etsy";
import type { SheetConfigDoc, SheetRowDoc } from "@/lib/types/sheets";
import type { OrderStatusDoc } from "@/lib/types/order-status";
import type { TrackingJob } from "@/lib/types/tracking";
import { ensureIndexes } from "@/lib/db/indexes";

// Lazy ensure index một lần cho mỗi process (cache global cho dev hot-reload).
declare global {
  // eslint-disable-next-line no-var
  var _indexesEnsured: Promise<void> | undefined;
}

// Tên DB: ưu tiên env MONGODB_DB, mặc định "meta_local"
// (không phụ thuộc default "test" của connection string).
const DB_NAME = process.env.MONGODB_DB || "meta_local";

export async function getDb(): Promise<Db> {
  const client = await clientPromise;
  const db = client.db(DB_NAME);

  if (!global._indexesEnsured) {
    global._indexesEnsured = ensureIndexes(db).catch((err) => {
      // Reset để lần sau thử lại nếu tạo index thất bại.
      global._indexesEnsured = undefined;
      throw err;
    });
  }
  await global._indexesEnsured;

  return db;
}

export async function getConversationsCollection(): Promise<Collection<ConversationDoc>> {
  const db = await getDb();
  return db.collection<ConversationDoc>("conversations");
}

export async function getMessagesCollection(): Promise<Collection<MessageDoc>> {
  const db = await getDb();
  return db.collection<MessageDoc>("messages");
}

export async function getAutoRepliesCollection(): Promise<Collection<AutoReplyDoc>> {
  const db = await getDb();
  return db.collection<AutoReplyDoc>("auto_reply_messages");
}

export async function getSheetConfigsCollection(): Promise<Collection<SheetConfigDoc>> {
  const db = await getDb();
  return db.collection<SheetConfigDoc>("sheet_configs");
}

export async function getSheetRowsCollection(): Promise<Collection<SheetRowDoc>> {
  const db = await getDb();
  return db.collection<SheetRowDoc>("sheet_rows");
}

export async function getOrderStatusesCollection(): Promise<Collection<OrderStatusDoc>> {
  const db = await getDb();
  return db.collection<OrderStatusDoc>("order_statuses");
}

export async function getMessageTemplatesCollection(): Promise<Collection<MessageTemplateDoc>> {
  const db = await getDb();
  return db.collection<MessageTemplateDoc>("message_templates");
}

export async function getTrackingJobsCollection(): Promise<Collection<TrackingJob>> {
  const db = await getDb();
  return db.collection<TrackingJob>("tracking_jobs");
}
