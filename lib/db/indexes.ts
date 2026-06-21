import type { Db, IndexSpecification, CreateIndexesOptions } from "mongodb";

/**
 * Tạo index cho các collection tin nhắn. Idempotent: bỏ qua lỗi "index đã tồn tại".
 * Mirror dora-backend/services/db_indexes.go — cần thiết cho hàng triệu bản ghi.
 */
type IndexDef = { keys: IndexSpecification; options: CreateIndexesOptions };

const CONVERSATION_INDEXES: IndexDef[] = [
  // Key upsert + dedup conversation
  {
    keys: { "etsy.conversation_id": 1 },
    options: { name: "uq_etsy_conversation_id", unique: true },
  },
  // Sort inbox + cursor pagination: phải compound với _id để sort
  // {lastMessageDate:-1, _id:-1} được index phục vụ (tránh in-memory SORT khi nhiều bản ghi).
  {
    keys: { lastMessageDate: -1, _id: -1 },
    options: { name: "idx_lastMessageDate_id" },
  },
  { keys: { updated_at: -1 }, options: { name: "idx_updated_at" } },
  // Tìm theo số đơn hàng: khớp receipt_id (multikey, trong mảng receipt_history) và order_id.
  {
    keys: { "etsy.buyer_info.receipt_history.receipt_id": 1 },
    options: { name: "idx_receipt_id" },
  },
  { keys: { "etsy.order_info.order_id": 1 }, options: { name: "idx_order_id" } },
  // Lọc "Has note": multikey sparse — chỉ index doc có ≥1 note (hỗ trợ truy vấn $exists).
  {
    keys: { "notes.authorEmail": 1 },
    options: { name: "idx_notes_author", sparse: true },
  },
  // Lọc theo trạng thái đơn sheet (sheetStatuses là mảng → multikey index).
  {
    keys: { sheetStatuses: 1 },
    options: { name: "idx_sheet_statuses", sparse: true },
  },
];

const MESSAGE_INDEXES: IndexDef[] = [
  // Dedup + cho phép bulk upsert nhanh. sparse: bỏ qua doc thiếu field.
  {
    keys: { "etsy.conversation_message_id": 1 },
    options: { name: "uq_etsy_conversation_message_id", unique: true, sparse: true },
  },
  // Lấy message mới nhất / phân trang trong 1 conversation
  {
    keys: { "etsy.conversation_id": 1, "etsy.message_order": -1 },
    options: { name: "idx_conv_message_order" },
  },
  { keys: { conversation_id: 1 }, options: { name: "idx_conversation_id" } },
  // Tìm theo nội dung tin nhắn. Mỗi collection chỉ 1 text index; nội dung ở etsy.message
  // (top-level `message` chỉ set lúc insert, không cập nhật).
  // default_language "none": không stem/stopword → khớp token thô, hợp với đa ngôn ngữ + số đơn.
  // language_override trỏ field không tồn tại để BỎ QUA field `language` của payload Etsy
  // (vd "pl") — nếu không Mongo coi đó là ngôn ngữ/doc và build index thất bại.
  {
    keys: { "etsy.message": "text" },
    options: {
      name: "txt_etsy_message",
      default_language: "none",
      language_override: "_tlang",
    },
  },
];

const MESSAGE_TEMPLATE_INDEXES: IndexDef[] = [
  { keys: { email: 1 }, options: { name: "idx_email" } },
  { keys: { created_at: -1 }, options: { name: "idx_created_at" } },
];

const AUTO_REPLY_INDEXES: IndexDef[] = [
  // Khớp runtime: lọc enabled=true rồi so token chuẩn hoá; chống trùng trigger.
  { keys: { enabled: 1 }, options: { name: "idx_enabled" } },
  { keys: { normalized_triggers: 1 }, options: { name: "idx_normalized_triggers" } },
];

const SHEET_CONFIG_INDEXES: IndexDef[] = [
  { keys: { spreadsheetId: 1 }, options: { name: "uq_spreadsheet_id", unique: true } },
  { keys: { enabled: 1, order: 1 }, options: { name: "idx_enabled_order" } },
];

const SHEET_ROW_INDEXES: IndexDef[] = [
  // Khoá tra cứu: từ Etsy biết receipt_id (+ transaction_id) → khớp mọi sheet (fallback tự nhiên).
  { keys: { receiptTxKey: 1 }, options: { name: "idx_receipt_tx_key" } },
  { keys: { receiptKey: 1 }, options: { name: "idx_receipt_key" } },
  // Upsert theo dòng khi đồng bộ + dọn dòng cũ theo config.
  {
    keys: { spreadsheetId: 1, itemId: 1 },
    options: { name: "uq_spreadsheet_item", unique: true },
  },
  { keys: { configId: 1 }, options: { name: "idx_config_id" } },
];

const TRACKING_JOB_INDEXES: IndexDef[] = [
  // Liệt kê job gần nhất + dọn job cũ.
  { keys: { created_at: -1 }, options: { name: "idx_created_at" } },
  { keys: { shop_name: 1, created_at: -1 }, options: { name: "idx_shop_created" } },
];

function isAlreadyExistsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("already exists") ||
    msg.includes("IndexOptionsConflict") ||
    msg.includes("index with name") ||
    msg.includes("An equivalent index already exists")
  );
}

async function createIndexes(db: Db, collName: string, defs: IndexDef[]): Promise<void> {
  const coll = db.collection(collName);
  for (const def of defs) {
    try {
      await coll.createIndex(def.keys, def.options);
    } catch (err) {
      if (isAlreadyExistsError(err)) continue;
      throw err;
    }
  }
}

export async function ensureIndexes(db: Db): Promise<void> {
  await createIndexes(db, "conversations", CONVERSATION_INDEXES);
  await createIndexes(db, "messages", MESSAGE_INDEXES);
  await createIndexes(db, "auto_reply_messages", AUTO_REPLY_INDEXES);
  await createIndexes(db, "sheet_configs", SHEET_CONFIG_INDEXES);
  await createIndexes(db, "sheet_rows", SHEET_ROW_INDEXES);
  await createIndexes(db, "message_templates", MESSAGE_TEMPLATE_INDEXES);
  await createIndexes(db, "tracking_jobs", TRACKING_JOB_INDEXES);
}
