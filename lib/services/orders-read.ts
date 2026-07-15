import type { Filter, WithId } from "mongodb";
import { getEtsyOrdersCollection } from "@/lib/db/collections";
import { getShopIdNameMap, resolveShopIdByName } from "@/lib/services/shop-read";
import {
  asNumber,
  asString,
  decodeHtmlEntities,
  firstNumber,
  firstString,
  getPath,
  isObject,
} from "@/lib/services/etsy-utils";
import { getOrderTrackingMap } from "@/lib/services/orders-tracking";
import { getPersonalizationFilesCollection } from "@/lib/db/collections";
import type {
  EtsyOrderDoc,
  OrderAddress,
  OrderListItem,
  OrderPersonalization,
  OrderShipping,
  OrderTab,
  OrderTransaction,
  OrdersResponse,
  PersonalizationFile,
} from "@/lib/types/etsy";

export const ORDERS_PAGE_SIZE = 20;

/**
 * Trạng thái Etsy được xem là "Completed" (tab Completed). Còn lại → tab New.
 * Chỉ "Completed" được xác nhận từ dữ liệu mẫu; re-tune sau lần sync thật bằng
 * db.etsy_orders.distinct("data.order_state_name").
 */
const COMPLETED_STATES = ["Completed", "Shipped", "Closed"];

export function classifyTab(stateName: string): OrderTab {
  return COMPLETED_STATES.includes(stateName) ? "Completed" : "New";
}

/**
 * Format tiền: ưu tiên formatted_value của Etsy, fallback dựng từ value(cents)
 * + currency_code qua Intl. Trả "" nếu không có dữ liệu.
 */
function formatMoney(money: unknown): string {
  if (!isObject(money)) return "";
  const formatted = asString(money["formatted_value"]);
  if (formatted) return formatted;
  const value = asNumber(money["value"]);
  if (value === undefined) return "";
  const currency = asString(money["currency_code"]) || "USD";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value / 100);
  } catch {
    return `${(value / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * Resolve tên shop của 1 đơn. Trường shop trong etsy_orders KHÔNG chắc chắn nên
 * thử lần lượt nhiều nguồn — CHỖ DUY NHẤT để chỉnh sau lần sync thật đầu tiên.
 */
function resolveOrderShop(data: unknown, shopIdToName: Map<number, string>): string {
  // shop_id → map (nguồn chuẩn từ stores) ưu tiên, kế đó shop_name gắn lúc sync.
  // KHÔNG fallback fulfillment.from_address.name vì đó là tên cá nhân người bán,
  // không phải tên shop (bug "Hoang Phan Tuan" thay vì "Chanilea").
  const shopId = firstNumber(data, ["shop_id", "business_id"]);
  if (shopId !== undefined && shopIdToName.has(shopId)) {
    return shopIdToName.get(shopId) as string;
  }
  return firstString(data, ["shop_name"]);
}

/**
 * Tách variations: mỗi variation kiểu personalization là 1 dòng có nhãn riêng
 * (1 transaction có thể có NHIỀU: "Personalization", "Back Side", "Your Photo"…),
 * còn lại là option thường. KHÔNG gộp/ghi đè — trước đây gán đè nên chỉ dòng cuối
 * ("Your Photo: 1 file") sống sót, nuốt mất text thật của khách.
 */
function mapTransactions(data: unknown): OrderTransaction[] {
  const raw = getPath(data, "transactions");
  if (!Array.isArray(raw)) return [];
  return raw.map((t): OrderTransaction => {
    const variations: { property: string; value: string }[] = [];
    const personalizations: OrderPersonalization[] = [];
    const vraw = getPath(t, "variations");
    if (Array.isArray(vraw)) {
      for (const v of vraw) {
        const property = decodeHtmlEntities(firstString(v, ["property"]));
        const value = decodeHtmlEntities(firstString(v, ["value"]));
        const type = firstString(v, ["type"]);
        const isPersonalization =
          property.toLowerCase() === "personalization" || type.endsWith("Variation_Personalization");
        if (isPersonalization) {
          if (value) personalizations.push({ label: property || "Personalization", value });
        } else if (property || value) {
          variations.push({ property, value });
        }
      }
    }
    return {
      transactionId: asNumber(getPath(t, "transaction_id")) ?? 0,
      listingId: asNumber(getPath(t, "listing_id")) ?? 0,
      title: decodeHtmlEntities(firstString(t, ["product.title", "title"])),
      image: firstString(t, ["product.image_url_75x75", "image_url_75x75", "image"]),
      quantity: asNumber(getPath(t, "quantity")) ?? 0,
      variations,
      personalizations,
      // Ảnh khách upload gắn sau bằng attachPersonalization (đọc personalization_files).
      personalizationFiles: [],
    };
  });
}

/** Trạng thái giao từ data.fulfillment (không cần fetch thêm). */
function mapShipping(data: unknown): OrderShipping {
  return {
    statusSummary: firstString(data, [
      "fulfillment.status.physical_status.shipping_status.tracking_status.summary",
    ]),
    wasShipped: getPath(data, "fulfillment.was_shipped") === true,
    shipDate:
      firstNumber(data, [
        "fulfillment.status.physical_status.shipping_status.actual_ship_date",
        "fulfillment.actual_ship_date",
      ]) ?? 0,
  };
}

function mapAddress(data: unknown): OrderAddress {
  const a = getPath(data, "fulfillment.to_address");
  return {
    name: decodeHtmlEntities(firstString(a, ["name"])),
    line1: decodeHtmlEntities(firstString(a, ["first_line"])),
    line2: decodeHtmlEntities(firstString(a, ["second_line"])),
    city: decodeHtmlEntities(firstString(a, ["city"])),
    state: decodeHtmlEntities(firstString(a, ["state"])),
    zip: firstString(a, ["zip"]),
    country: decodeHtmlEntities(firstString(a, ["country"])),
  };
}

export function mapOrder(
  doc: WithId<EtsyOrderDoc>,
  shopIdToName: Map<number, string>,
): OrderListItem {
  const data = doc.data ?? {};
  const stateName = asString(getPath(data, "order_state_name"));
  return {
    id: doc._id.toHexString(),
    orderId: asNumber(getPath(data, "order_id")) ?? 0,
    orderDate: asNumber(getPath(data, "order_date")) ?? 0,
    shopName: resolveOrderShop(data, shopIdToName),
    stateName,
    tab: classifyTab(stateName),
    buyerName: decodeHtmlEntities(firstString(data, ["buyer.name", "buyer.username"])),
    total: formatMoney(
      getPath(data, "payment.cost_breakdown.total_cost") ??
        getPath(data, "payment.cost_breakdown.buyer_cost") ??
        getPath(data, "payment.cost_breakdown.adjusted_total_cost"),
    ),
    coupon: firstString(data, [
      "payment.coupon.code",
      "payment.coupon.short_display_name",
      "payment.coupon.title",
    ]),
    dispatchBy:
      firstNumber(data, [
        "fulfillment.expected_ship_date",
        "fulfillment.expected_or_actual_ship_date",
        "fulfillment.actual_ship_date",
      ]) ?? 0,
    shippingMethod: decodeHtmlEntities(firstString(data, ["fulfillment.shipping_method"])),
    shipping: mapShipping(data),
    trackings: [], // gắn sau từ order_tracking trong getOrders.
    toAddress: mapAddress(data),
    transactions: mapTransactions(data),
  };
}

/**
 * Gắn ảnh khách upload ("Your Photo") vào từng transaction của các đơn.
 * Đọc personalization_files theo receipt_id (= order_id), map files theo transaction_id.
 * Mirror conversation-detail.attachPersonalizationFiles.
 */
async function attachPersonalization(items: OrderListItem[]): Promise<void> {
  const orderIds = items.map((i) => i.orderId).filter((id) => id > 0);
  if (orderIds.length === 0) return;

  const coll = await getPersonalizationFilesCollection();
  const docs = await coll.find({ receipt_id: { $in: orderIds } }).toArray();

  // order_id → (transaction_id → files)
  const byOrder = new Map<number, Map<number, PersonalizationFile[]>>();
  for (const d of docs) {
    const byTx = new Map<number, PersonalizationFile[]>();
    for (const tx of d.transactions ?? []) {
      const files = (tx.files ?? [])
        .map((f) => ({
          url: asString(f.url),
          thumbnailUrl: asString(f.thumbnail_url),
          filename: asString(f.filename),
        }))
        .filter((f) => f.url || f.thumbnailUrl);
      if (files.length > 0) byTx.set(tx.transaction_id, files);
    }
    if (byTx.size > 0) byOrder.set(d.receipt_id, byTx);
  }

  for (const item of items) {
    const byTx = byOrder.get(item.orderId);
    if (!byTx) continue;
    for (const t of item.transactions) {
      t.personalizationFiles = byTx.get(t.transactionId) ?? [];
    }
  }
}

// Projection: chỉ field cần cho list/card, tránh kéo các block nặng (actions, tax…).
const LIST_PROJECTION = {
  "data.order_id": 1,
  "data.order_date": 1,
  "data.order_state_name": 1,
  "data.buyer.name": 1,
  "data.buyer.username": 1,
  "data.payment.coupon": 1,
  "data.payment.cost_breakdown.total_cost": 1,
  "data.payment.cost_breakdown.buyer_cost": 1,
  "data.payment.cost_breakdown.adjusted_total_cost": 1,
  "data.fulfillment.shipping_method": 1,
  "data.fulfillment.expected_ship_date": 1,
  "data.fulfillment.expected_or_actual_ship_date": 1,
  "data.fulfillment.actual_ship_date": 1,
  "data.fulfillment.was_shipped": 1,
  "data.fulfillment.status.physical_status.shipping_status": 1,
  "data.fulfillment.to_address": 1,
  "data.transactions": 1,
  "data.shop_name": 1,
  "data.shop_id": 1,
  "data.business_id": 1,
  created_at: 1,
} as const;

export interface OrdersQueryOpts {
  search?: string;
  shopName?: string;
  tab?: OrderTab;
  page?: number;
}

export async function getOrders(opts: OrdersQueryOpts): Promise<OrdersResponse> {
  const coll = await getEtsyOrdersCollection();
  const page = Math.max(1, opts.page ?? 1);
  const skip = (page - 1) * ORDERS_PAGE_SIZE;

  // Clause chung (search/shop) — KHÔNG gồm tab; dùng để đếm cả 2 tab.
  const baseClauses: Record<string, unknown>[] = [];

  const tab: OrderTab = opts.tab === "Completed" ? "Completed" : "New";
  const newTabClause = { "data.order_state_name": { $nin: COMPLETED_STATES } };
  const completedTabClause = { "data.order_state_name": { $in: COMPLETED_STATES } };

  const shopName = opts.shopName?.trim();
  if (shopName) {
    const shopId = await resolveShopIdByName(shopName);
    const or: Record<string, unknown>[] = [{ "data.shop_name": shopName }];
    if (shopId !== null) {
      or.push({ "data.shop_id": shopId }, { "data.business_id": shopId });
    }
    baseClauses.push({ $or: or });
  }

  const search = opts.search?.trim();
  if (search) {
    const or: Record<string, unknown>[] = [
      { "data.buyer.name": { $regex: search, $options: "i" } },
      { "data.buyer.username": { $regex: search, $options: "i" } },
    ];
    // Trích dãy số LIỀN CUỐI query để bỏ prefix chữ (vd "TEST-2914171501" → 2914171501).
    // Người bán hay copy mã kèm prefix nội bộ; Number("TEST-...") = NaN nên phải regex trước.
    // Fallback Number(search) cho trường hợp gõ thuần số không khớp regex.
    const m = search.match(/(\d+)\s*$/);
    const asNum = m ? Number(m[1]) : Number(search);
    // Chỉ push clause số khi hữu hạn — tránh nhét {order_id: NaN} làm hỏng $or.
    if (Number.isFinite(asNum)) {
      // order_id exact + transaction_id: Mongo tự dò array-of-subdoc bằng equality,
      // KHÔNG cần $elemMatch vì chỉ 1 điều kiện trên mỗi phần tử.
      or.push({ "data.order_id": asNum }, { "data.transactions.transaction_id": asNum });
    }
    baseClauses.push({ $or: or });
  }

  // Helper: kết hợp base + 1 clause thành Filter.
  const withClause = (extra: Record<string, unknown>): Filter<EtsyOrderDoc> =>
    ({ $and: [...baseClauses, extra] } as Filter<EtsyOrderDoc>);

  const filter = withClause(tab === "Completed" ? completedTabClause : newTabClause);

  // Đếm tổng theo tab + đếm cả 2 tab (badge) + lấy trang hiện tại song song.
  // Lưu ý: offset/skip sâu là O(n) — chấp nhận ở quy mô hiện tại.
  const [newCount, completedCount, docs, shopIdToName] = await Promise.all([
    coll.countDocuments(withClause(newTabClause)),
    coll.countDocuments(withClause(completedTabClause)),
    coll
      .find(filter, { projection: LIST_PROJECTION })
      .sort({ "data.order_date": -1, _id: -1 })
      .skip(skip)
      .limit(ORDERS_PAGE_SIZE)
      .toArray() as Promise<WithId<EtsyOrderDoc>[]>,
    getShopIdNameMap(),
  ]);

  const total = tab === "Completed" ? completedCount : newCount;

  const items = docs.map((d) => mapOrder(d, shopIdToName));

  // Enrich tracking thật + ảnh khách (đọc song song theo order_id của trang hiện tại).
  const orderIds = items.map((i) => i.orderId).filter((id) => id > 0);
  const [trackingMap] = await Promise.all([
    getOrderTrackingMap(orderIds),
    attachPersonalization(items),
  ]);
  for (const item of items) {
    item.trackings = trackingMap.get(item.orderId) ?? [];
  }

  return {
    items,
    page,
    pageSize: ORDERS_PAGE_SIZE,
    total,
    totalPages: Math.ceil(total / ORDERS_PAGE_SIZE),
    tabCounts: { New: newCount, Completed: completedCount },
  };
}
