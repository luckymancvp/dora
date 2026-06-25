import type { Document, Filter, WithId } from "mongodb";
import {
  getConversationsCollection,
  getMessagesCollection,
} from "@/lib/db/collections";
import { getShops } from "@/lib/services/shop-read";
import { mapConversation } from "@/lib/services/conversation-read";
import type {
  AgentPerformanceResponse,
  ShopAnalyticsResponse,
  ConversationDoc,
  MessageOverviewResponse,
  OverviewTotals,
  ShopMetricRow,
  ShopOverviewRow,
  TagOverviewRow,
  TagsOverviewResponse,
  UnreadConvItem,
} from "@/lib/types/etsy";

/** Tag đánh dấu đã xử lý — hội thoại có 1 trong các tag này KHÔNG tính là unread. */
const HANDLED_TAGS = ["handled", "approved"];

/** Giới hạn số hội thoại unread fetch về (oldest-first) để liệt kê + mở nhiều tab. */
const UNREAD_FETCH_LIMIT = 3000;
/** Giới hạn số hội thoại unread đính kèm mỗi shop/tag. */
const UNREAD_PER_BUCKET = 200;

/** Projection đủ field cho mapConversation() (xem conversation-read.ts). */
const UNREAD_PROJECTION = {
  "etsy.conversation_id": 1,
  "etsy.other_user": 1,
  "etsy.buyer_info.buyer_profile": 1,
  "etsy.excerpt": 1,
  "etsy.preview": 1,
  "etsy.title": 1,
  "etsy.message_count": 1,
  "etsy.has_replied": 1,
  lastMessageDate: 1,
  tags: 1,
  "user_data.user_id": 1,
} as const;

export interface AnalyticsOpts {
  from?: number | null; // unix giây
  to?: number | null; // unix giây
  shopIds?: number[];
}

/** Khoảng [from,to] trên lastMessageDate (unix giây). */
function dateClause(from?: number | null, to?: number | null): Record<string, number> | null {
  const range: Record<string, number> = {};
  if (typeof from === "number" && Number.isFinite(from)) range.$gte = from;
  if (typeof to === "number" && Number.isFinite(to)) range.$lte = to;
  return Object.keys(range).length > 0 ? range : null;
}

/** Match cơ bản cho collection conversations (date + shop). */
function buildBaseMatch(opts: AnalyticsOpts): Filter<ConversationDoc> {
  const m: Record<string, unknown> = {};
  const dc = dateClause(opts.from, opts.to);
  if (dc) m.lastMessageDate = dc;
  if (opts.shopIds && opts.shopIds.length > 0) {
    m["user_data.user_id"] = { $in: opts.shopIds };
  }
  return m as Filter<ConversationDoc>;
}

/**
 * Biểu thức aggregation: 1 nếu hội thoại là unread (has_replied=false và không có tag handled).
 * Dùng trong $cond để $sum.
 */
const UNREAD_EXPR = {
  $and: [
    { $eq: ["$etsy.has_replied", false] },
    {
      $eq: [
        { $size: { $setIntersection: [{ $ifNull: ["$tags", []] }, HANDLED_TAGS] } },
        0,
      ],
    },
  ],
};

/** Tổng Total/Unread/Completed cho 1 base match. */
async function computeTotals(base: Filter<ConversationDoc>): Promise<OverviewTotals> {
  const coll = await getConversationsCollection();
  const rows = await coll
    .aggregate<{ total: number; unread: number }>([
      { $match: base },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          unread: { $sum: { $cond: [UNREAD_EXPR, 1, 0] } },
        },
      },
    ])
    .toArray();
  const total = rows[0]?.total ?? 0;
  const unread = rows[0]?.unread ?? 0;
  return { total, unread, completed: Math.max(total - unread, 0) };
}

/**
 * Lấy danh sách hội thoại unread (oldest-first) trong phạm vi base match.
 * Trả về dạng đã map (có name/avatar/lastMessageDate/tags/shopUserId).
 */
async function fetchUnreadConversations(base: Filter<ConversationDoc>) {
  const coll = await getConversationsCollection();
  const filter: Filter<ConversationDoc> = {
    $and: [
      base,
      { "etsy.has_replied": false } as Filter<ConversationDoc>,
      { tags: { $nin: HANDLED_TAGS } } as Filter<ConversationDoc>,
    ],
  } as Filter<ConversationDoc>;

  const docs = (await coll
    .find(filter, { projection: UNREAD_PROJECTION })
    .sort({ lastMessageDate: 1, _id: 1 }) // cũ nhất lên đầu (để mở/ xử lý trước)
    .limit(UNREAD_FETCH_LIMIT)
    .toArray()) as WithId<ConversationDoc>[];

  return docs.map(mapConversation);
}

function toUnreadItem(
  c: {
    conversationId: number;
    name: string;
    avatar: string;
    lastMessageDate: number;
  },
  shop?: string,
): UnreadConvItem {
  return {
    conversationId: c.conversationId,
    name: c.name,
    avatar: c.avatar,
    lastMessageDate: c.lastMessageDate,
    ...(shop ? { shop } : {}),
  };
}

/** Đếm total + unread theo shop (group user_data.user_id). */
async function getShopCounts(base: Filter<ConversationDoc>) {
  const coll = await getConversationsCollection();
  return coll
    .aggregate<{ _id: number | null; shopName: string | null; total: number; unread: number }>([
      { $match: base },
      {
        $group: {
          _id: "$user_data.user_id",
          shopName: { $first: "$user_data.shop_name" },
          total: { $sum: 1 },
          unread: { $sum: { $cond: [UNREAD_EXPR, 1, 0] } },
        },
      },
      { $sort: { total: -1 } },
    ])
    .toArray();
}

/** Message Overview — tổng + breakdown theo shop + danh sách unread mỗi shop. */
export async function getMessageOverview(opts: AnalyticsOpts): Promise<MessageOverviewResponse> {
  const base = buildBaseMatch(opts);

  const [counts, unreadConvs, shops] = await Promise.all([
    getShopCounts(base),
    fetchUnreadConversations(base),
    getShops().catch(() => []),
  ]);

  // Bucket unread conversations theo shop.
  const unreadByShop = new Map<number, UnreadConvItem[]>();
  for (const c of unreadConvs) {
    const arr = unreadByShop.get(c.shopUserId) ?? [];
    if (arr.length < UNREAD_PER_BUCKET) arr.push(toUnreadItem(c));
    unreadByShop.set(c.shopUserId, arr);
  }

  // Map shop info (online + tên đẹp) từ getShops.
  const shopInfo = new Map(shops.map((s) => [s.userId, s]));

  const shopBreakdown: ShopOverviewRow[] = counts
    .filter((r) => typeof r._id === "number" && r._id > 0)
    .map((r) => {
      const shopId = r._id as number;
      const info = shopInfo.get(shopId);
      const total = r.total;
      const unread = r.unread;
      return {
        shopId,
        shopName: info?.shopName || r.shopName || `Shop ${shopId}`,
        online: info?.online ?? false,
        total,
        unread,
        completed: Math.max(total - unread, 0),
        unreadConversations: unreadByShop.get(shopId) ?? [],
      };
    })
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return b.total - a.total;
    });

  const totals = shopBreakdown.reduce<OverviewTotals>(
    (acc, s) => ({
      total: acc.total + s.total,
      unread: acc.unread + s.unread,
      completed: acc.completed + s.completed,
    }),
    { total: 0, unread: 0, completed: 0 },
  );

  return { totals, shopBreakdown };
}

/** Số đơn (distinct transaction_id trong receipt_history) theo từng shop. */
async function getOrderCountsByShop(base: Filter<ConversationDoc>): Promise<Map<number, number>> {
  const coll = await getConversationsCollection();
  const rows = await coll
    .aggregate<{ _id: number | null; orders: number }>([
      { $match: base },
      {
        $unwind: {
          path: "$etsy.buyer_info.receipt_history",
          preserveNullAndEmptyArrays: false,
        },
      },
      {
        $unwind: {
          path: "$etsy.buyer_info.receipt_history.transactions",
          preserveNullAndEmptyArrays: false,
        },
      },
      {
        $group: {
          _id: "$user_data.user_id",
          // Distinct transaction_id để không đếm trùng 1 đơn xuất hiện ở nhiều hội thoại.
          txs: { $addToSet: "$etsy.buyer_info.receipt_history.transactions.transaction_id" },
        },
      },
      { $project: { orders: { $size: "$txs" } } },
    ])
    .toArray();

  const map = new Map<number, number>();
  for (const r of rows) {
    if (typeof r._id === "number" && r._id > 0) map.set(r._id, r.orders);
  }
  return map;
}

/** Phân tích shop — số hội thoại + số đơn mỗi shop (cho bar chart đa chỉ số). */
export async function getShopAnalytics(opts: AnalyticsOpts): Promise<ShopAnalyticsResponse> {
  const base = buildBaseMatch(opts);
  const [counts, orderMap, shops] = await Promise.all([
    getShopCounts(base),
    getOrderCountsByShop(base),
    getShops().catch(() => []),
  ]);
  const shopInfo = new Map(shops.map((s) => [s.userId, s]));

  const items: ShopMetricRow[] = counts
    .filter((r) => typeof r._id === "number" && r._id > 0)
    .map((r) => {
      const shopId = r._id as number;
      return {
        shopId,
        shopName: shopInfo.get(shopId)?.shopName || r.shopName || `Shop ${shopId}`,
        conversations: r.total,
        orders: orderMap.get(shopId) ?? 0,
      };
    })
    .sort((a, b) => b.conversations - a.conversations);

  return { items };
}

/** Agent Performance — đếm tin nhắn nhân viên gửi (sender_email != ""), lọc theo created_at. */
export async function getAgentPerformance(opts: AnalyticsOpts): Promise<AgentPerformanceResponse> {
  const coll = await getMessagesCollection();
  const match: Document = { sender_email: { $ne: "" } };
  // created_at là Date — chuyển from/to (giây) sang Date.
  const range: Record<string, Date> = {};
  if (typeof opts.from === "number" && Number.isFinite(opts.from)) {
    range.$gte = new Date(opts.from * 1000);
  }
  if (typeof opts.to === "number" && Number.isFinite(opts.to)) {
    range.$lte = new Date(opts.to * 1000);
  }
  if (Object.keys(range).length > 0) match.created_at = range;

  const rows = await coll
    .aggregate<{ _id: string; messageCount: number; conversationCount: number }>([
      { $match: match },
      {
        $group: {
          _id: "$sender_email",
          messageCount: { $sum: 1 },
          conversationIds: { $addToSet: "$conversation_id" },
        },
      },
      {
        $project: {
          messageCount: 1,
          conversationCount: { $size: "$conversationIds" },
        },
      },
      { $sort: { messageCount: -1, _id: 1 } },
    ])
    .toArray();

  return {
    items: rows.map((r) => ({
      senderEmail: r._id,
      messageCount: r.messageCount,
      conversationCount: r.conversationCount,
    })),
  };
}

/** Tags Overview — tổng + breakdown theo tag (gồm bucket "No Tag"). */
export async function getTagsOverview(opts: AnalyticsOpts): Promise<TagsOverviewResponse> {
  const base = buildBaseMatch(opts);
  const coll = await getConversationsCollection();

  const [totals, unreadConvs, shops, taggedRows, untaggedRow] = await Promise.all([
    computeTotals(base),
    fetchUnreadConversations(base),
    getShops().catch(() => []),
    // Đếm total/unread theo từng tag.
    coll
      .aggregate<{ _id: string; total: number; unread: number }>([
        { $match: base },
        { $project: { tags: { $ifNull: ["$tags", []] }, isUnread: UNREAD_EXPR } },
        { $unwind: "$tags" },
        {
          $group: {
            _id: "$tags",
            total: { $sum: 1 },
            unread: { $sum: { $cond: ["$isUnread", 1, 0] } },
          },
        },
        { $sort: { total: -1, _id: 1 } },
      ])
      .toArray(),
    // Bucket "No Tag": tags rỗng/không tồn tại.
    coll
      .aggregate<{ total: number; unread: number }>([
        {
          $match: {
            $and: [base, { $or: [{ tags: { $exists: false } }, { tags: { $size: 0 } }] }],
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            unread: { $sum: { $cond: [UNREAD_EXPR, 1, 0] } },
          },
        },
      ])
      .toArray(),
  ]);

  // Map shopUserId → tên shop để gắn vào từng item (gộp theo tag nên cần biết shop nào).
  const shopNameById = new Map(shops.map((s) => [s.userId, s.shopName]));

  // Bucket unread conversations theo tag + No Tag.
  const unreadByTag = new Map<string, UnreadConvItem[]>();
  const unreadNoTag: UnreadConvItem[] = [];
  for (const c of unreadConvs) {
    const shopName =
      shopNameById.get(c.shopUserId) || (c.shopUserId ? `Shop ${c.shopUserId}` : "");
    const item = toUnreadItem(c, shopName);
    if (!c.tags || c.tags.length === 0) {
      if (unreadNoTag.length < UNREAD_PER_BUCKET) unreadNoTag.push(item);
      continue;
    }
    for (const t of c.tags) {
      const arr = unreadByTag.get(t) ?? [];
      if (arr.length < UNREAD_PER_BUCKET) arr.push(item);
      unreadByTag.set(t, arr);
    }
  }

  const tags: TagOverviewRow[] = taggedRows.map((r) => ({
    tag: r._id,
    untagged: false,
    total: r.total,
    unread: r.unread,
    unreadConversations: unreadByTag.get(r._id) ?? [],
  }));

  const noTagTotal = untaggedRow[0]?.total ?? 0;
  if (noTagTotal > 0) {
    tags.unshift({
      tag: "No Tag",
      untagged: true,
      total: noTagTotal,
      unread: untaggedRow[0]?.unread ?? 0,
      unreadConversations: unreadNoTag,
    });
  }

  return { totals, tags };
}
