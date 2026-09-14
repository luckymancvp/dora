import { ObjectId, type Filter, type WithId } from "mongodb";
import { getConversationsCollection } from "@/lib/db/collections";
import type {
  ConversationDoc,
  ConversationListItem,
  ConversationListResponse,
} from "@/lib/types/etsy";
import {
  asNumber,
  decodeHtmlEntities,
  firstNumber,
  firstString,
} from "@/lib/services/etsy-utils";
import { buildSearchClause } from "@/lib/services/search";

// Projection: chỉ lấy subfield cần cho sidebar, TRÁNH kéo nguyên blob etsy
// (buyer_info.receipt_history, coupons, detail.messages... rất nặng).
const LIST_PROJECTION = {
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

interface Cursor {
  d: number;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString()) as Cursor;
    if (typeof c.d === "number" && typeof c.id === "string") return c;
  } catch {
    /* ignore */
  }
  return null;
}

export function mapConversation(doc: WithId<ConversationDoc>): ConversationListItem {
  const etsy = doc.etsy ?? {};
  return {
    conversationId: asNumber(etsy["conversation_id"]) ?? 0,
    name: decodeHtmlEntities(
      firstString(etsy, [
        "other_user.display_name",
        "other_user.name",
        "buyer_info.buyer_profile.display_name",
        "buyer_info.buyer_profile.username",
      ]),
    ),
    avatar: firstString(etsy, [
      "other_user.im_avatar",
      "other_user.avatar_url",
      "buyer_info.buyer_profile.avatar_url",
    ]),
    excerpt: decodeHtmlEntities(firstString(etsy, ["excerpt", "preview", "title"])),
    lastMessageDate: doc.lastMessageDate ?? 0,
    messageCount: asNumber(etsy["message_count"]) ?? 0,
    hasReplied: etsy["has_replied"] === true,
    shopUserId: firstNumber(doc, ["user_data.user_id"]) ?? 0,
    tags: Array.isArray(doc.tags) ? doc.tags : [],
  };
}

export interface ConversationFilterOpts {
  cursor?: string | null;
  limit?: number;
  search?: string;
  notReplied?: boolean;
  hasOrder?: boolean;
  orderHelp?: boolean;
  hasNote?: boolean;
  shopIds?: number[];
  tags?: string[];
  sheetStatuses?: string[];
  sort?: "asc" | "desc";
  /** Khoảng lastMessageDate (unix giây). null/undefined = không giới hạn. */
  from?: number | null;
  to?: number | null;
  /** Chỉ lấy hội thoại có etsy.message_count < maxMessages. */
  maxMessages?: number | null;
  /** Đã chờ ≥ N giờ; cutoff tính bằng GIỜ SERVER tại thời điểm request. */
  waitingHours?: number | null;
}

export async function getConversations(
  opts: ConversationFilterOpts,
): Promise<ConversationListResponse> {
  const coll = await getConversationsCollection();
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);

  // Gom từng điều kiện thành clause rồi kết hợp bằng $and (mirror dora buildBaseFilter).
  const clauses: Record<string, unknown>[] = [];

  const asc = opts.sort === "asc";
  const cursor = decodeCursor(opts.cursor ?? null);
  // Cursor KHÔNG nằm trong `clauses`: nó là con trỏ phân trang, không phải điều kiện lọc.
  // Tách riêng để `total` (countDocuments) đếm trên đúng bộ lọc, không giảm dần theo trang.
  const cursorClause: Record<string, unknown> | null = cursor
    ? {
        $or: asc
          ? [
              { lastMessageDate: { $gt: cursor.d } },
              { lastMessageDate: cursor.d, _id: { $gt: new ObjectId(cursor.id) } },
            ]
          : [
              { lastMessageDate: { $lt: cursor.d } },
              { lastMessageDate: cursor.d, _id: { $lt: new ObjectId(cursor.id) } },
            ],
      }
    : null;

  // Tìm theo tên / nội dung tin nhắn / số đơn hàng (auto-detect, xem search.ts).
  const search = opts.search?.trim();
  if (search) {
    const sc = await buildSearchClause(search);
    if (sc) {
      clauses.push(sc);
    } else {
      // Có search nhưng không khớp gì → trả rỗng (tránh hiện toàn bộ danh sách).
      clauses.push({ _id: null });
    }
  }

  // Khoảng thời gian tin nhắn cuối — CÙNG semantics buildBaseMatch() của analytics.ts
  // (lastMessageDate $gte from / $lte to) để Board và Dashboard ra cùng một con số.
  const dateRange: Record<string, number> = {};
  if (typeof opts.from === "number" && Number.isFinite(opts.from)) dateRange.$gte = opts.from;
  if (typeof opts.to === "number" && Number.isFinite(opts.to)) dateRange.$lte = opts.to;
  if (Object.keys(dateRange).length > 0) clauses.push({ lastMessageDate: dateRange });

  // Dưới N tin nhắn. Nhánh `null` khớp CẢ doc thiếu field `etsy.message_count` — mirror
  // `asNumber(...) ?? 0` trong mapConversation (client vẫn coi thiếu = 0 và giữ lại doc đó),
  // nếu chỉ dùng $lt thì Mongo loại luôn doc thiếu field → lệch tập kết quả so với hiện tại.
  if (typeof opts.maxMessages === "number" && opts.maxMessages > 0) {
    clauses.push({
      $or: [
        { "etsy.message_count": { $lt: opts.maxMessages } },
        { "etsy.message_count": null },
      ],
    });
  }

  // Chờ ≥ N giờ. Cutoff tính theo GIỜ SERVER tại request → client chỉ gửi nguyên N (ổn định),
  // nhờ vậy không có giá trị dẫn xuất từ Date.now() lọt vào queryKey của TanStack.
  // LƯU Ý: đây là clause RIÊNG, KHÔNG merge vào object dateRange ở trên — cả hai đều ràng buộc
  // `lastMessageDate` nên merge sẽ ghi đè key và làm mất một trong hai điều kiện.
  if (typeof opts.waitingHours === "number" && opts.waitingHours > 0) {
    const cutoff = Math.floor(Date.now() / 1000) - opts.waitingHours * 3600;
    clauses.push({ lastMessageDate: { $lte: cutoff } });
  }

  // Help request
  if (opts.orderHelp) clauses.push({ "etsy.is_order_help_request": true });

  // Not Replied: chưa trả lời và chưa được đánh dấu xử lý
  if (opts.notReplied) {
    clauses.push({ "etsy.has_replied": false });
    clauses.push({ tags: { $nin: ["handled", "approved"] } });
  }

  // Has Order: buyer có đơn hàng
  if (opts.hasOrder) {
    clauses.push({ "etsy.buyer_info.past_order_history.total_orders": { $gt: 0 } });
  }

  // Has Note: hội thoại có ≥1 ghi chú (tận dụng sparse index notes.authorEmail)
  if (opts.hasNote) {
    clauses.push({ "notes.authorEmail": { $exists: true } });
  }

  // Lọc theo shop (user_data.user_id top-level)
  if (opts.shopIds && opts.shopIds.length > 0) {
    clauses.push({ "user_data.user_id": { $in: opts.shopIds } });
  }

  // Lọc theo tag: khớp bất kỳ tag nào được chọn.
  if (opts.tags && opts.tags.length > 0) {
    clauses.push({ tags: { $in: opts.tags } });
  }

  // Lọc theo trạng thái đơn sheet: khớp bất kỳ status nào được chọn.
  if (opts.sheetStatuses && opts.sheetStatuses.length > 0) {
    clauses.push({ sheetStatuses: { $in: opts.sheetStatuses } });
  }

  // Hai filter: bản KHÔNG cursor để đếm tổng, bản CÓ cursor để lấy trang hiện tại.
  const filterNoCursor: Filter<ConversationDoc> =
    clauses.length > 0 ? ({ $and: clauses } as Filter<ConversationDoc>) : {};
  const filter: Filter<ConversationDoc> = cursorClause
    ? ({ $and: [...clauses, cursorClause] } as Filter<ConversationDoc>)
    : filterNoCursor;

  // limit+1 để biết còn trang sau không.
  const sortDir = asc ? 1 : -1;
  // Count CHỈ ở trang đầu (cursor == null): các trang sau đếm lại cùng một filter cho cùng
  // một kết quả — thuần chi phí (filter có $or/$nin/$in trên field chưa index nên phải quét).
  // Chạy song song với find để không cộng dồn latency.
  const [docs, total] = await Promise.all([
    coll
      .find(filter, { projection: LIST_PROJECTION })
      .sort({ lastMessageDate: sortDir, _id: sortDir })
      .limit(limit + 1)
      .toArray() as Promise<WithId<ConversationDoc>[]>,
    cursorClause
      ? Promise.resolve<number | null>(null)
      : coll.countDocuments(filterNoCursor),
  ]);

  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ d: last.lastMessageDate ?? 0, id: last._id.toHexString() })
      : null;

  return { items: page.map(mapConversation), nextCursor, total };
}
