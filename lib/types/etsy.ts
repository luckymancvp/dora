import type { ObjectId } from "mongodb";

/**
 * Raw Etsy payload — giữ nguyên dạng tự do để đảm bảo chính xác.
 * Mirror field `etsy bson.M` trong dora-backend (models/conversation.go, models/message.go).
 */
export type EtsyRaw = Record<string, unknown>;

/** Trạng thái gửi message — mirror models/message.go (MessageStatus). */
export type MessageStatus = "NEW" | "SENDING" | "DONE" | "FAILED";

/**
 * Collection `conversations` — key upsert: etsy.conversation_id
 * Mirror dora-backend/models/conversation.go
 */
export interface ConversationDoc {
  _id?: ObjectId;
  etsy: EtsyRaw;
  user_data?: EtsyRaw | null;
  tags: string[];
  note: string;
  /** Ghi chú nhiều người dùng (thread). Mỗi note do 1 nhân viên tạo, tự sửa/xoá. */
  notes?: NoteEntry[];
  /** Gợi ý AI gần nhất (agree/neutral/apologize + tag). Mirror DORA suggested_messages. */
  suggested_messages?: AIResponse | null;
  /** Trạng thái đơn trên sheet (denormalized từ sheet_rows.values.Status). Dùng để lọc nhanh. */
  sheetStatuses?: string[];
  lastMessageDate: number;
  created_at: Date;
  updated_at: Date;
}

/** 1 phương án trả lời do AI sinh — label (cho nhân viên chọn) + text (gửi cho khách). */
export interface AISuggestionOption {
  /** Nhãn ngắn mô tả hướng tiếp cận của đáp án (tiếng Việt, cho nhân viên). */
  label: string;
  /** Nội dung tin nhắn hoàn chỉnh, sẵn sàng gửi (đúng ngôn ngữ của khách). */
  text: string;
}

/**
 * Kết quả gợi ý AI cho 1 hội thoại.
 * 3 phương án trả lời (hướng tiếp cận khác nhau, không ép tông cứng) + tag phân loại.
 */
export interface AIResponse {
  options: AISuggestionOption[];
  suggested_tag?: string;
  tag_reason?: string;
}

/** 1 ghi chú lưu trong conversation doc (top-level field `notes`). */
export interface NoteEntry {
  id: string;
  authorEmail: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Collection `messages` — dedup theo etsy.conversation_message_id
 * Mirror dora-backend/models/message.go
 */
export interface MessageDoc {
  _id?: ObjectId;
  etsy: EtsyRaw;
  conversation_id: number;
  message: string;
  attachments: string[];
  sender_email: string;
  status: MessageStatus | "";
  created_at: Date;
  updated_at: Date;
}

/**
 * Collection `auto_reply_messages` — quy tắc tự trả lời.
 * Mirror dora-backend/models/auto_reply_message.go.
 * Khớp khi normalized incoming === 1 trong normalized_triggers (so khớp token tuyệt đối).
 */
export interface AutoReplyDoc {
  _id?: ObjectId;
  email: string;
  trigger: string;
  normalized_triggers: string[];
  reply: string;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Body của POST /v1/extension/conversations/sync (Etsy message-list-data). */
export interface ConversationSyncBody {
  conversations?: EtsyRaw[];
  user_data?: EtsyRaw | null;
  [key: string]: unknown;
}

/** Body của POST /v1/extension/messages/sync. */
export interface MessageSyncBody {
  messages?: EtsyRaw[];
}

// ---- DTO gọn cho frontend (KHÔNG trả nguyên blob etsy) ----

/** 1 dòng hội thoại trong sidebar. */
export interface ConversationListItem {
  conversationId: number;
  name: string;
  avatar: string;
  excerpt: string;
  lastMessageDate: number;
  messageCount: number;
  hasReplied: boolean;
  shopUserId: number;
  /** Tag cấp hội thoại (ConversationDoc.tags) — hiển thị pill ở dòng danh sách. */
  tags: string[];
}

/** 1 tin nhắn trong khung chat. */
export interface MessageItem {
  id: string;
  message: string;
  senderId: number;
  fromMe: boolean;
  createDate: number;
  messageOrder: number;
  isSystem: boolean;
  images: string[];
  /** Email nhân viên đã gửi (tin đi); rỗng với tin từ Etsy. */
  senderEmail: string;
  /** Tên/avatar nhân viên gửi (join từ users). */
  senderName: string;
  senderAvatar: string;
}

/** Shop kèm trạng thái online (filter theo shop). */
export interface ShopItem {
  userId: number;
  shopName: string;
  avatar: string;
  online: boolean;
}

/** Bộ lọc danh sách hội thoại. */
export interface ConversationFilters {
  search: string;
  notReplied: boolean;
  hasOrder: boolean;
  orderHelp: boolean;
  hasNote: boolean;
  shopIds: number[];
  /** Lọc theo tag (khớp bất kỳ tag nào trong danh sách). */
  tags: string[];
  /** Lọc theo trạng thái đơn trên sheet (khớp bất kỳ status nào). */
  sheetStatuses: string[];
  /** Thứ tự sắp xếp theo thời gian tin nhắn cuối. "asc" = cũ nhất trước. */
  sort: "asc" | "desc";
}

/** 1 ghi chú trả về client (đã join tên/avatar tác giả). */
export interface NoteItem {
  id: string;
  body: string;
  authorEmail: string;
  authorName: string;
  authorAvatar: string;
  /** unix seconds (để tái dùng timeAgo). */
  createdAt: number;
  updatedAt: number;
  /** true nếu note thuộc về user đang đăng nhập (được phép sửa/xoá). */
  mine: boolean;
}

/** Phản hồi danh sách ghi chú của 1 hội thoại. */
export interface NotesResponse {
  conversationId: number;
  items: NoteItem[];
}

/** Phản hồi danh sách tag của 1 hội thoại. */
export interface TagsResponse {
  conversationId: number;
  tags: string[];
}

/** Số lượng hội thoại gắn 1 tag (dùng cho dropdown lọc). */
export interface TagStat {
  tag: string;
  count: number;
}

/** Phản hồi thống kê tag. */
export interface TagStatsResponse {
  stats: TagStat[];
}

/** Phản hồi list có cursor để load tiếp. */
export interface ConversationListResponse {
  items: ConversationListItem[];
  nextCursor: string | null;
}

/** 1 ảnh khách upload ("Your Photo") cho 1 transaction (etsy personalization file). */
export interface PersonalizationFile {
  url: string;
  thumbnailUrl: string;
  filename: string;
}

/**
 * Document collection `personalization_files` — 1 doc / 1 receipt (order).
 * Mirror dora-backend/models/personalization_file.go. Lưu tách khỏi conversation
 * để không bị shallow-merge của conversation sync ghi đè (GET 1 lần).
 */
export interface PersonalizationFileDoc {
  _id?: ObjectId;
  receipt_id: number;
  shop_name?: string;
  transactions: { transaction_id: number; files: { url: string; thumbnail_url: string; filename: string }[] }[];
  fetched_at?: Date;
  updated_at?: Date;
}

/** 1 dòng sản phẩm trong đơn (receipt_history[].transactions). */
export interface ReceiptTransaction {
  transactionId: number;
  title: string;
  image: string;
  quantity: number;
  value: string;
  /** Ảnh khách upload trực tiếp (enrich từ extension qua endpoint personalization-files). */
  personalizationFiles: PersonalizationFile[];
}

/** 1 đơn hàng trong lịch sử mua của khách (etsy.buyer_info.receipt_history). */
export interface ReceiptHistoryItem {
  receiptId: number;
  date: string;
  value: string;
  state: string;
  isShipped: boolean;
  isDigitalDelivery: boolean;
  totalQty: number;
  transactions: ReceiptTransaction[];
}

/** Phản hồi chi tiết hội thoại cho sidebar phải (receipt_history + store để map sheet). */
export interface ConversationDetailResponse {
  conversationId: number;
  /** Tên shop/store (user_data.shop_name) — dùng để ưu tiên dò sheet đúng store. */
  storeName: string;
  receiptHistory: ReceiptHistoryItem[];
}

// ---- Orders (collection dora-master.etsy_orders) ----

/**
 * Collection `dora-master.etsy_orders` — 1 doc / 1 đơn Etsy.
 * Mirror dora-backend/models/etsy_order.go: `data` là raw order (đã enrich
 * `buyer` + `order_state_name`); key upsert là data.order_id.
 */
export interface EtsyOrderDoc {
  _id?: ObjectId;
  data: EtsyRaw;
  created_at: Date;
  updated_at: Date;
}

/** Tab trên trang Orders (mirror Etsy: New / Completed). */
export type OrderTab = "New" | "Completed";

/** 1 dòng sản phẩm trong đơn (data.transactions[]). */
export interface OrderTransaction {
  transactionId: number;
  listingId: number;
  title: string;
  /** Ảnh sản phẩm (product.image_url_75x75). */
  image: string;
  quantity: number;
  /** Các variation thường (Size/Color/Style…), KHÔNG gồm Personalization. */
  variations: { property: string; value: string }[];
  /** Nội dung Personalization của khách (giữ xuống dòng để render multi-line). */
  personalization: string;
  /** Ảnh khách upload ("Your Photo") — enrich từ personalization_files theo transaction_id. */
  personalizationFiles: PersonalizationFile[];
}

/** 1 mã tracking của 1 shipment (1 đơn có thể có NHIỀU shipment/tracking). */
export interface TrackingEntry {
  tracking_code: string;
  carrier_name: string;
  tracking_url: string;
  is_shipped: boolean;
  is_delivered: boolean;
}

/**
 * Document collection `dora-master.order_tracking` — 1 doc / 1 đơn, NHIỀU tracking.
 * Lưu tracking thật mà extension GET qua /shipments/by-order khi fetch đơn — vì
 * payload list order của Etsy KHÔNG nhúng số tracking. Mỗi đơn có thể nhiều shipment.
 */
export interface OrderTrackingDoc {
  _id?: ObjectId;
  order_id: number;
  trackings: TrackingEntry[];
  updated_at: Date;
}

/** 1 tracking đã resolve cho frontend. */
export interface OrderTracking {
  code: string;
  carrier: string;
  url: string;
  isDelivered: boolean;
}

/** Trạng thái giao của đơn (từ data.fulfillment, không cần fetch thêm). */
export interface OrderShipping {
  /** Tóm tắt tracking_status của Etsy: "Delivered" / "In transit"… ("" nếu chưa ship). */
  statusSummary: string;
  wasShipped: boolean;
  /** unix giây ship thật (0 nếu chưa). */
  shipDate: number;
}

/** Địa chỉ giao hàng (data.fulfillment.to_address). */
export interface OrderAddress {
  name: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

/** 1 đơn hàng trên trang Orders (DTO gọn cho frontend). */
export interface OrderListItem {
  id: string;
  orderId: number;
  /** unix giây (data.order_date) — dùng group theo ngày + format. */
  orderDate: number;
  /** Tên shop đã resolve (có thể rỗng nếu không xác định được). */
  shopName: string;
  /** Trạng thái thô từ Etsy (data.order_state_name) — hiển thị pill. */
  stateName: string;
  tab: OrderTab;
  buyerName: string;
  /** Tổng tiền đã format (vd "AU$35.39"). */
  total: string;
  /** Mã/coupon đã áp (rỗng nếu không có). */
  coupon: string;
  /** unix giây dự kiến dispatch (0 nếu không có). */
  dispatchBy: number;
  /** Phương thức giao (vd "Standard Delivery"). */
  shippingMethod: string;
  /** Trạng thái giao từ data order (Delivered/Shipped + ngày). */
  shipping: OrderShipping;
  /** Danh sách tracking thật (1 đơn có thể nhiều mã); rỗng nếu chưa GET. */
  trackings: OrderTracking[];
  toAddress: OrderAddress;
  transactions: OrderTransaction[];
}

/** Bộ lọc danh sách đơn. */
export interface OrderFilters {
  search: string;
  shopName: string;
  tab: OrderTab;
  page: number;
}

/** Phản hồi GET /api/orders (phân trang offset/page). */
export interface OrdersResponse {
  items: OrderListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** Số đơn theo từng tab (tính trên cùng filter search/shop) để hiện badge. */
  tabCounts: { New: number; Completed: number };
}

/** Tin nhắn đang gửi (chưa được Etsy xác nhận) — hiển thị tách khỏi list đã fetch. */
export interface PendingMessage {
  localId: string;
  serverId: string | null;
  text: string;
  status: "sending" | "failed";
}

/** Phản hồi messages có cursor (load tin cũ hơn). */
export interface MessageListResponse {
  conversationId: number;
  shopUserId: number;
  name: string;
  avatar: string;
  items: MessageItem[];
  nextCursor: string | null;
}

// ---- DTO Dashboard / Analytics ----

/** Bộ lọc chung cho các API analytics (from/to là unix giây; rỗng = All Time). */
export interface AnalyticsFilters {
  from: number | null;
  to: number | null;
  shopIds: number[];
}

/** 1 hội thoại chưa trả lời (rút gọn) — dùng cho dropdown + nút mở nhiều tab. */
export interface UnreadConvItem {
  conversationId: number;
  name: string;
  avatar: string;
  lastMessageDate: number;
}

/** Tổng quan 3 thẻ (Total/Unread/Completed). */
export interface OverviewTotals {
  total: number;
  unread: number;
  completed: number;
}

/** 1 dòng shop trong Message Overview. */
export interface ShopOverviewRow {
  shopId: number;
  shopName: string;
  online: boolean;
  total: number;
  unread: number;
  completed: number;
  unreadConversations: UnreadConvItem[];
}

/** Phản hồi GET /api/analytics/overview. */
export interface MessageOverviewResponse {
  totals: OverviewTotals;
  shopBreakdown: ShopOverviewRow[];
}

/** 1 dòng chỉ số shop (Phân tích shop). */
export interface ShopMetricRow {
  shopId: number;
  shopName: string;
  /** Số hội thoại trong khoảng. */
  conversations: number;
  /** Số đơn (distinct transaction_id trong receipt_history của khách). */
  orders: number;
}

/** Chỉ số có thể vẽ biểu đồ trong panel Phân tích shop. */
export type ShopMetricKey = "conversations" | "orders";

/** Phản hồi GET /api/analytics/shops. */
export interface ShopAnalyticsResponse {
  items: ShopMetricRow[];
}

/** 1 dòng nhân viên trong Agent Performance. */
export interface AgentPerfRow {
  senderEmail: string;
  messageCount: number;
  conversationCount: number;
}

/** Phản hồi GET /api/analytics/agent-performance. */
export interface AgentPerformanceResponse {
  items: AgentPerfRow[];
}

/** 1 dòng tag trong Tags Overview. `untagged=true` là bucket "No Tag". */
export interface TagOverviewRow {
  tag: string;
  untagged: boolean;
  total: number;
  unread: number;
  unreadConversations: UnreadConvItem[];
}

/** Phản hồi GET /api/analytics/tags-overview. */
export interface TagsOverviewResponse {
  totals: OverviewTotals;
  tags: TagOverviewRow[];
}

/** Collection `message_templates` — mẫu câu sẵn do nhân viên tạo. */
export interface MessageTemplateDoc {
  _id?: ObjectId;
  email: string;
  title: string;
  content: string;
  created_at: Date;
  updated_at: Date;
}

/** DTO mẫu câu sẵn trả về client. */
export interface MessageTemplate {
  _id: string;
  email: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}
