import clientPromise from "@/lib/mongodb-client";
import { getEtsyOrdersCollection, getSheetRowsCollection } from "@/lib/db/collections";
import {
  getMeraLinkedConversationIds,
  receiptFromMeraOrderId,
} from "@/lib/services/mera-links";

/**
 * Hội thoại có đơn đang ở một status TRÊN MERA — phục vụ bộ lọc "Status" của danh sách hội thoại.
 *
 * Vì sao cần: `conversations.sheetStatuses` chỉ được tính từ Google Sheet (`sheet_rows`). Từ khi các
 * shop chuyển sang quản lý đơn ở Mera, đơn mới KHÔNG còn dòng nào trên Sheet ⇒ hội thoại của các
 * đơn đó không có `sheetStatuses` ⇒ lọc Status bỏ sót, dù sidebar vẫn hiện đúng status (lấy từ Mera).
 *
 * Mera lưu ở `<MERA_ORDERS_DB>.order_items` {order_id: "DAC-4234778302", status: "TRACKING"} —
 * cùng Mongo server, cùng user doraApp ⇒ đọc thẳng như mera-links.ts (CHỈ ĐỌC).
 *
 * MERA_ORDERS_DB: prod "mera_orders_master" (mặc định), dev "mera_orders_dev".
 */
const MERA_ORDERS_DB = process.env.MERA_ORDERS_DB || "mera_orders_master";

/** Status Mera đổi liên tục nhưng danh sách lọc không cần tươi từng giây — cache ngắn theo process. */
const CACHE_TTL_MS = 60 * 1000;

interface MeraOrderItemDoc {
  order_id?: string;
  status?: string;
}

/** Danh sách status đang dùng ít đổi hơn nhiều so với đơn nào ở status nào → cache dài hơn. */
const IN_USE_TTL_MS = 5 * 60 * 1000;
let inUseCache: { at: number; statuses: Promise<string[]> } | null = null;

/**
 * Các status ĐANG có trên đơn Mera (distinct order_items.status) — cho dropdown bộ lọc Status.
 * Khác danh sách status cấu hình (/api/v1/statuses): đơn còn mang cả status hệ thống tự gán như
 * "NO PRODUCT TYPE" / "NO BASE TEMPLATE" không nằm trong cấu hình, nên chỉ dựa cấu hình thì
 * không chọn lọc được các đơn đó. Lỗi đọc Mera ⇒ [] (dropdown vẫn còn danh sách của dora-1).
 */
export async function getMeraStatusesInUse(): Promise<string[]> {
  const now = Date.now();
  if (inUseCache && now - inUseCache.at < IN_USE_TTL_MS) return inUseCache.statuses;
  const statuses = (async () => {
    const client = await clientPromise;
    const raw = await client
      .db(MERA_ORDERS_DB)
      .collection<MeraOrderItemDoc>("order_items")
      .distinct("status");
    const names = new Set<string>();
    for (const s of raw) if (typeof s === "string" && s.trim()) names.add(s.trim());
    return [...names].sort((a, b) => a.localeCompare(b));
  })().catch((err) => {
    console.error("[mera-status-index] getMeraStatusesInUse failed:", err);
    inUseCache = null; // không giữ kết quả lỗi
    return [] as string[];
  });
  inUseCache = { at: now, statuses };
  return statuses;
}

/**
 * Các khoá để khớp hội thoại với đơn Mera — mirror ĐÚNG các nguồn đơn của sidebar
 * (conversation-detail.ts): receipt nhúng, đơn theo buyer của khách guest, đơn gắn tay ở Mera.
 */
export interface MeraStatusMatch {
  /** Receipt Etsy: khớp receipt_history nhúng hoặc mã đơn ở etsy.order_details. */
  receiptIds: number[];
  /** buyer_id của các đơn đó: khớp khách guest (receipt_history rỗng) qua etsy.other_user.user_id. */
  buyerIds: number[];
  /** Hội thoại được nhân viên gắn tay vào các đơn đó ở Mera Fulfill. */
  conversationIds: number[];
}

const EMPTY: MeraStatusMatch = { receiptIds: [], buyerIds: [], conversationIds: [] };

const cache = new Map<string, { at: number; match: Promise<MeraStatusMatch> }>();

/** buyer_id của các đơn (cùng khoá với receiptHistoryFromOrders của sidebar). Lỗi ⇒ []. */
async function buyerIdsOfOrders(receiptIds: number[]): Promise<number[]> {
  try {
    const orders = await getEtsyOrdersCollection();
    const docs = await orders
      .find(
        { "data.order_id": { $in: receiptIds } },
        { projection: { "data.buyer_id": 1, "data.buyer.buyer_id": 1, _id: 0 } },
      )
      .toArray();
    const ids = new Set<number>();
    for (const d of docs) {
      const data = (d as { data?: { buyer_id?: unknown; buyer?: { buyer_id?: unknown } } }).data;
      for (const v of [data?.buyer_id, data?.buyer?.buyer_id]) {
        if (typeof v === "number" && Number.isFinite(v) && v > 0) ids.add(v);
      }
    }
    return [...ids];
  } catch (err) {
    console.error("[mera-status-index] buyerIdsOfOrders failed:", err);
    return [];
  }
}

async function loadMatch(status: string): Promise<MeraStatusMatch> {
  const client = await clientPromise;
  const items = await client
    .db(MERA_ORDERS_DB)
    .collection<MeraOrderItemDoc>("order_items")
    .find({ status }, { projection: { order_id: 1, _id: 0 } })
    .toArray();

  // order_id không phải đơn Etsy (Shopify "COGI#1059"…) ⇒ receiptFromMeraOrderId trả null, bỏ qua.
  const ids = new Set<number>();
  for (const it of items) {
    const r = receiptFromMeraOrderId(it.order_id ?? "");
    if (r != null) ids.add(r);
  }
  if (ids.size === 0) return EMPTY;

  // Đơn có CẢ trên Sheet lẫn Mera (giai đoạn chuyển đổi): sidebar ưu tiên Sheet, nên bộ lọc cũng để
  // Sheet quyết định (qua sheetStatuses) — nếu không sẽ lọc ra hội thoại mà sidebar hiện status khác.
  const rows = await getSheetRowsCollection();
  const onSheet = await rows.distinct("receiptKey", { receiptKey: { $in: [...ids].map(String) } });
  for (const key of onSheet) ids.delete(Number(key));
  if (ids.size === 0) return EMPTY;

  const receiptIds = [...ids];
  const [buyerIds, conversationIds] = await Promise.all([
    buyerIdsOfOrders(receiptIds),
    getMeraLinkedConversationIds(ids),
  ]);
  return { receiptIds, buyerIds, conversationIds };
}

/**
 * Khoá khớp hội thoại cho các đơn (không có trên Sheet) mà Mera ghi nhận đang ở một trong các status.
 * Lỗi đọc Mera ⇒ rỗng (không chặn danh sách; bộ lọc vẫn chạy theo Sheet như trước).
 */
export async function getMeraStatusMatch(statuses: string[]): Promise<MeraStatusMatch> {
  const now = Date.now();
  const parts = await Promise.all(
    [...new Set(statuses)].map((status) => {
      const hit = cache.get(status);
      if (hit && now - hit.at < CACHE_TTL_MS) return hit.match;
      const match = loadMatch(status).catch((err) => {
        console.error("[mera-status-index] loadMatch failed:", err);
        cache.delete(status); // không giữ kết quả lỗi — lần sau thử lại ngay
        return EMPTY;
      });
      cache.set(status, { at: now, match });
      return match;
    }),
  );
  return {
    receiptIds: [...new Set(parts.flatMap((p) => p.receiptIds))],
    buyerIds: [...new Set(parts.flatMap((p) => p.buyerIds))],
    conversationIds: [...new Set(parts.flatMap((p) => p.conversationIds))],
  };
}
