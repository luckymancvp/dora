import type { Collection, Db } from "mongodb";
import clientPromise from "@/lib/mongodb-client";
import type { AutoReplyDoc, ConversationDoc, EtsyOrderDoc, MessageDoc, MessageTemplateDoc, OrderTrackingDoc, PersonalizationFileDoc } from "@/lib/types/etsy";
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

// DB chứa thông tin shop (dora) — nơi có Etsy shop_id thật.
const STORES_DB_NAME = process.env.DORA_STORES_DB || "dora-master";

/** Document shop trong dora-master.stores (chỉ khai báo trường dùng tới). */
export interface StoreDoc {
  type?: string;
  name?: string;
  data?: {
    context?: {
      data?: {
        current_shop?: { shop_id?: number; shop_name?: string };
        current_user?: { user_id?: number };
      };
    };
  };
}

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

export async function getPersonalizationFilesCollection(): Promise<Collection<PersonalizationFileDoc>> {
  const db = await getDb();
  return db.collection<PersonalizationFileDoc>("personalization_files");
}

export async function getTrackingJobsCollection(): Promise<Collection<TrackingJob>> {
  const db = await getDb();
  return db.collection<TrackingJob>("tracking_jobs");
}

/** Collection shop của dora (DB khác: dora-master). Dùng để lấy Etsy shop_id thật. */
export async function getStoresCollection(): Promise<Collection<StoreDoc>> {
  const client = await clientPromise;
  return client.db(STORES_DB_NAME).collection<StoreDoc>("stores");
}

/**
 * Collection đơn hàng Etsy (DB dora-master, ghi bởi extension → dora-backend).
 * Bỏ qua getDb() (meta_local) vì collection nằm ở DB khác.
 */
export async function getEtsyOrdersCollection(): Promise<Collection<EtsyOrderDoc>> {
  const client = await clientPromise;
  return client.db(STORES_DB_NAME).collection<EtsyOrderDoc>("etsy_orders");
}

/**
 * Collection tracking thật theo đơn (DB dora-master, cạnh etsy_orders).
 * Ghi bởi extension qua /v1/extension/orders/tracking-sync; trang Orders đọc để
 * hiện số tracking (payload list order của Etsy không nhúng số tracking).
 */
export async function getOrderTrackingCollection(): Promise<Collection<OrderTrackingDoc>> {
  const client = await clientPromise;
  return client.db(STORES_DB_NAME).collection<OrderTrackingDoc>("order_tracking");
}
