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
  OrderCompletedStatus,
  OrderCountryFacet,
  OrderDateRange,
  OrderDelivery,
  OrderListItem,
  OrderPersonalization,
  OrderShipping,
  OrderSort,
  OrderTab,
  OrderTransaction,
  OrdersResponse,
  PersonalizationFile,
} from "@/lib/types/etsy";
import { DESTINATION_OTHER } from "@/lib/types/etsy";

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
    completedDate: firstNumber(data, ["fulfillment.completed_date"]) ?? 0,
    isCanceled: getPath(data, "is_canceled") === true,
    // Etsy có 2 cờ digital ở 2 tầng: cả đơn (is_download_only) và fulfillment
    // (is_fully_digital). Đơn mix vật lý + digital chỉ bật cờ ở transaction nên
    // KHÔNG tính là digital ở đây — khớp filter "Digital" của Etsy.
    isDigital:
      getPath(data, "fulfillment.is_fully_digital") === true ||
      getPath(data, "is_download_only") === true,
    isRefunded:
      getPath(data, "payment.is_fully_refunded") === true ||
      getPath(data, "payment.is_partially_refunded") === true,
    noteFromBuyer: decodeHtmlEntities(firstString(data, ["notes.note_from_buyer"])),
    isGift: getPath(data, "is_gift") === true,
    giftMessage: decodeHtmlEntities(firstString(data, ["gift_message"])),
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
  "data.fulfillment.completed_date": 1,
  "data.fulfillment.is_fully_digital": 1,
  "data.payment.is_fully_refunded": 1,
  "data.payment.is_partially_refunded": 1,
  "data.notes.note_from_buyer": 1,
  "data.is_canceled": 1,
  "data.is_download_only": 1,
  "data.is_gift": 1,
  "data.gift_message": 1,
  "data.transactions": 1,
  "data.shop_name": 1,
  "data.shop_id": 1,
  "data.business_id": 1,
  created_at: 1,
} as const;

/**
 * Đường dẫn tóm tắt trạng thái tracking của Etsy. Giá trị QUAN SÁT ĐƯỢC trong
 * data thật: "Delivered", "Pre-transit", "In transit", "No tracking" và cả nhãn
 * riêng của hãng vận chuyển ("Tracked on Royal Mail"). Vì tập giá trị KHÔNG đóng,
 * bucket "in-transit" định nghĩa bằng $nin các giá trị đã biết thay vì liệt kê —
 * nhãn hãng mới xuất hiện sau này vẫn rơi đúng vào "đang vận chuyển".
 */
const SUMMARY_PATH =
  "data.fulfillment.status.physical_status.shipping_status.tracking_status.summary";

/** Các summary có nghĩa riêng, KHÔNG thuộc bucket "đang vận chuyển". */
const NON_TRANSIT_SUMMARIES = ["Delivered", "Pre-transit", "No tracking", "", null];

/** Số giây của từng khoảng lọc thời gian. */
const DATE_RANGE_SECONDS: Record<Exclude<OrderDateRange, "all">, number> = {
  "30d": 30 * 86400,
  "90d": 90 * 86400,
  "365d": 365 * 86400,
};

/**
 * Sort spec theo lựa chọn "Sort by". Luôn kèm _id để tie-break — thiếu nó thì
 * hai đơn cùng mốc thời gian có thể đổi chỗ giữa các trang, gây lặp/nhảy đơn.
 */
const SORT_SPECS: Record<OrderSort, Record<string, 1 | -1>> = {
  newest: { "data.order_date": -1, _id: -1 },
  oldest: { "data.order_date": 1, _id: 1 },
  completed: { "data.fulfillment.completed_date": -1, _id: -1 },
  destination: { "data.fulfillment.to_address.country": 1, "data.order_date": -1, _id: -1 },
};

/** Số nước tối đa hiện trong rail Destination; phần còn lại gộp vào "Everywhere else". */
const COUNTRY_FACET_LIMIT = 12;

export interface OrdersQueryOpts {
  search?: string;
  shopName?: string;
  tab?: OrderTab;
  page?: number;
  sort?: OrderSort;
  dateRange?: OrderDateRange;
  delivery?: OrderDelivery;
  status?: OrderCompletedStatus;
  destination?: string;
  hasNote?: boolean;
  isGift?: boolean;
  isPersonalized?: boolean;
}

/**
 * Clause của nhóm "Completed status". Trả null khi "all" (không lọc).
 * Lưu ý $in/[null] của Mongo khớp CẢ document thiếu field, nên "no-tracking"
 * bắt được đơn chưa có block shipping_status mà không cần $exists riêng.
 */
function statusClause(status: OrderCompletedStatus): Record<string, unknown> | null {
  switch (status) {
    case "delivered":
      return { [SUMMARY_PATH]: "Delivered" };
    case "pre-transit":
      return { [SUMMARY_PATH]: "Pre-transit" };
    case "no-tracking":
      return { [SUMMARY_PATH]: { $in: ["No tracking", "", null] } };
    case "in-transit":
      return { [SUMMARY_PATH]: { $nin: NON_TRANSIT_SUMMARIES } };
    case "cancelled":
      return { "data.is_canceled": true };
    case "digital":
      return {
        $or: [{ "data.fulfillment.is_fully_digital": true }, { "data.is_download_only": true }],
      };
    default:
      return null;
  }
}

/**
 * Clause của nhóm "Delivery". Etsy lọc theo shipping LABEL
 * (fulfillment.shipments[]) nhưng mảng đó rỗng trong data ta sync, nên map sang
 * trạng thái hoàn tiền của đơn — xem OrderDelivery trong lib/types/etsy.ts.
 */
function deliveryClause(delivery: OrderDelivery): Record<string, unknown> | null {
  if (delivery === "refund") {
    return {
      $or: [
        { "data.payment.is_fully_refunded": true },
        { "data.payment.is_partially_refunded": true },
      ],
    };
  }
  if (delivery === "purchased") {
    return {
      "data.payment.is_fully_refunded": { $ne: true },
      "data.payment.is_partially_refunded": { $ne: true },
    };
  }
  return null;
}

/**
 * Clause lọc thời gian. Mốc so sánh đổi theo tab: tab Completed lọc theo ngày
 * HOÀN TẤT (giống "Completed date" của Etsy), tab New lọc theo ngày ĐẶT.
 */
function dateRangeClause(
  range: OrderDateRange,
  tab: OrderTab,
): Record<string, unknown> | null {
  if (range === "all") return null;
  const field =
    tab === "Completed" ? "data.fulfillment.completed_date" : "data.order_date";
  const from = Math.floor(Date.now() / 1000) - DATE_RANGE_SECONDS[range];
  return { [field]: { $gte: from } };
}

/**
 * Đếm số đơn theo nước nhận để dựng rail Destination từ dữ liệu THẬT (Etsy
 * hardcode 3 dòng; ở đây liệt kê nước có đơn kèm số lượng). Bỏ đơn thiếu địa chỉ.
 */
async function getCountryFacets(
  coll: Awaited<ReturnType<typeof getEtsyOrdersCollection>>,
  filter: Filter<EtsyOrderDoc>,
): Promise<OrderCountryFacet[]> {
  const rows = await coll
    .aggregate<{ _id: string; count: number }>([
      { $match: filter },
      { $group: { _id: "$data.fulfillment.to_address.country", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: COUNTRY_FACET_LIMIT },
    ])
    .toArray();
  return rows
    .filter((r) => typeof r._id === "string" && r._id.trim() !== "")
    .map((r) => ({ country: decodeHtmlEntities(r._id), count: r.count }));
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

  // --- Nhóm filter kiểu Etsy. Đẩy vào baseClauses (KHÔNG kèm tab) để tabCounts
  // của cả hai tab đều phản ánh đúng bộ lọc đang bật, giống search/shop ở trên.
  // NGOẠI LỆ: filter ngày nằm ngoài baseClauses vì mỗi tab so trên field khác
  // nhau (completed_date vs order_date); nhét chung sẽ làm badge tab kia đếm
  // bằng field của tab đang xem → số không khớp khi bấm sang.
  const dateRange = opts.dateRange ?? "all";

  const delivery = deliveryClause(opts.delivery ?? "all");
  if (delivery) baseClauses.push(delivery);

  const status = statusClause(opts.status ?? "all");
  if (status) baseClauses.push(status);

  // Ba checkbox "Order details": chỉ lọc khi được bật (bỏ tick = không ràng buộc).
  if (opts.hasNote) {
    // $nin kèm null loại luôn document thiếu field, không cần $exists riêng.
    baseClauses.push({ "data.notes.note_from_buyer": { $nin: ["", null] } });
  }
  if (opts.isGift) baseClauses.push({ "data.is_gift": true });
  if (opts.isPersonalized) {
    // is_personalizable chỉ nói LISTING cho phép personalize, chưa chắc khách đã
    // điền; variation kiểu *_Variation_Personalization mới là khách điền thật.
    // Lấy $or cả hai để không sót — thu hẹp lại sau khi có dữ liệu sync thật.
    baseClauses.push({
      $or: [
        { "data.transactions.is_personalizable": true },
        { "data.transactions.variations.type": { $regex: "Variation_Personalization$" } },
      ],
    });
  }

  // Helper: kết hợp base + các clause riêng (bỏ qua null) thành Filter.
  const withClause = (
    ...extras: (Record<string, unknown> | null)[]
  ): Filter<EtsyOrderDoc> =>
    ({ $and: [...baseClauses, ...extras.filter((e) => e !== null)] } as Filter<EtsyOrderDoc>);

  /** Filter đầy đủ của 1 tab, gồm cả clause ngày tính theo đúng field của tab đó. */
  const tabFilter = (t: OrderTab): Filter<EtsyOrderDoc> =>
    withClause(t === "Completed" ? completedTabClause : newTabClause, dateRangeClause(dateRange, t));

  // Facet nước PHẢI chạy trước phần còn lại: lựa chọn "Everywhere else" được
  // định nghĩa là "ngoài danh sách nước đang hiển thị", nên cần biết danh sách
  // đó mới dựng được clause. Facet tính trên tab hiện tại, CHƯA áp destination
  // — để rail luôn còn đường đổi sang nước khác.
  const countries = await getCountryFacets(coll, tabFilter(tab));

  const destination = opts.destination?.trim() ?? "";
  if (destination === DESTINATION_OTHER) {
    baseClauses.push({
      "data.fulfillment.to_address.country": { $nin: countries.map((c) => c.country) },
    });
  } else if (destination) {
    baseClauses.push({ "data.fulfillment.to_address.country": destination });
  }

  const filter = tabFilter(tab);
  const sortSpec = SORT_SPECS[opts.sort ?? "newest"] ?? SORT_SPECS.newest;

  // Đếm tổng theo tab + đếm cả 2 tab (badge) + lấy trang hiện tại song song.
  // Lưu ý: offset/skip sâu là O(n) — chấp nhận ở quy mô hiện tại.
  const [newCount, completedCount, docs, shopIdToName] = await Promise.all([
    coll.countDocuments(tabFilter("New")),
    coll.countDocuments(tabFilter("Completed")),
    coll
      .find(filter, { projection: LIST_PROJECTION })
      .sort(sortSpec)
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
    facets: { countries },
  };
}
