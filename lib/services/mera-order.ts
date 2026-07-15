import "server-only";

import { asNumber, firstString, getPath } from "@/lib/services/etsy-utils";
import { normalizeStore } from "@/lib/google/sheet-utils";
import type {
  MeraItemUpdates,
  MeraOrderItem,
  MeraOrderSummary,
  ResolveMeraOrderResponse,
} from "@/lib/types/mera";

/**
 * Service gọi Mera Order API (qua fulfill backend) — NƠI DUY NHẤT map snake_case → camelCase.
 * Server-only: dùng Internal API Key (không expire) + X-Actor-Email để ghi audit đúng người.
 * Xem docs/order-api-v2.md và lib/types/mera.ts (type contract).
 */

/**
 * Lỗi từ tầng Mera. `code` là mã ngữ nghĩa NỘI BỘ của dora-1 (version_conflict /
 * mera_unavailable / mera_not_configured) để route map ra body + status cho FE.
 * `latest` là object DTO mới nhất khi 409 (item hoặc order) để FE refetch/remount.
 */
export class MeraApiError extends Error {
  status: number;
  code?: string;
  latest?: unknown;
  constructor(status: number, code?: string, opts?: { message?: string; latest?: unknown }) {
    super(opts?.message ?? code ?? `Mera API error ${status}`);
    this.name = "MeraApiError";
    this.status = status;
    this.code = code;
    this.latest = opts?.latest;
  }
}

/** Cấu hình Mera từ env; null nếu thiếu (để phân nhánh soft/hard tuỳ resolve vs update). */
function meraConfig(): { base: string; key: string } | null {
  const base = process.env.MERA_API_BASE_URL?.trim();
  const key = process.env.MERA_INTERNAL_API_KEY?.trim();
  if (!base || !key) return null;
  // Chuẩn hoá về DOMAIN GỐC (bỏ trailing slash + hậu tố /api/v2 nếu có) —
  // caller tự truyền path đầy đủ "/api/v2/..." hoặc "/api/v1/..." (statuses nằm ở v1).
  const normalized = base.replace(/\/+$/, "").replace(/\/api\/v2$/, "");
  return { base: normalized, key };
}

interface MeraFetchInit {
  method?: string;
  body?: unknown;
  /** email session next-auth → header X-Actor-Email để audit đúng người thao tác. */
  actorEmail: string;
}

/**
 * Fetch thấp tầng tới Mera. KHÔNG throw theo HTTP status (trả nguyên {status, data})
 * để caller tự phân nhánh 400 ITEM_EDIT_REQUIRES_SPLIT / 409 version_conflict.
 * Chỉ throw khi thiếu env (503) hoặc mạng/timeout (502) — hai lỗi "hạ tầng" thật sự.
 */
async function meraFetch(
  path: string,
  init: MeraFetchInit,
): Promise<{ status: number; data: unknown }> {
  const cfg = meraConfig();
  // Thiếu env ở đường update là lỗi CỨNG (503). resolve đã tự xử lý soft trước khi tới đây.
  if (!cfg) throw new MeraApiError(503, "mera_not_configured", { message: "Chưa cấu hình Mera API" });

  let res: Response;
  try {
    res = await fetch(`${cfg.base}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        "X-Actor-Email": init.actorEmail,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      // Timeout 15s: Mera qua mạng nội bộ, quá 15s coi như không kết nối được.
      signal: AbortSignal.timeout(15_000),
      // Không cache: đây là dữ liệu vận hành cần tươi (resolve/update).
      cache: "no-store",
    });
  } catch {
    // Abort (timeout) hoặc lỗi mạng → Mera coi như down.
    throw new MeraApiError(502, "mera_unavailable", { message: "Không kết nối được Mera" });
  }

  // Parse phòng thủ: body lỗi/không phải JSON → data = null, caller tự xử theo status.
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

// ---- Map snake_case (Mera JSON) → camelCase (DTO). Chỉ giữ field panel cần. ----

/** Map 1 item Mera (order_items JSON) → MeraOrderItem. Parse phòng thủ vì shape không đảm bảo. */
function mapItem(raw: unknown): MeraOrderItem {
  return {
    itemKey: firstString(raw, ["item_key"]),
    orderId: firstString(raw, ["order_id"]),
    status: firstString(raw, ["status"]),
    personalization: firstString(raw, ["personalization"]),
    customerImage: firstString(raw, ["customer_image"]),
    designLink: firstString(raw, ["design_link"]),
    mockupLink: firstString(raw, ["mockup_link"]),
    tracking: {
      code: firstString(raw, ["tracking.code"]),
      carrier: firstString(raw, ["tracking.carrier"]),
      url: firstString(raw, ["tracking.url"]),
    },
    imageLink: firstString(raw, ["image_link"]),
    productName: firstString(raw, ["product_name"]),
    quantity: asNumber(getPath(raw, "quantity")) ?? 0,
    price: firstString(raw, ["price"]),
    productType: firstString(raw, ["product_type"]),
    material: firstString(raw, ["material"]),
    fulfillmentCost: firstString(raw, ["fulfillment_cost"]),
    ffNameByDay: firstString(raw, ["ff_name_by_day"]),
    version: asNumber(getPath(raw, "version")) ?? 0,
  };
}

/** Map 1 order Mera (orders JSON) → MeraOrderSummary. `customer.name` flatten. */
function mapOrder(raw: unknown): MeraOrderSummary {
  return {
    orderId: firstString(raw, ["order_id"]),
    store: firstString(raw, ["store"]),
    note: firstString(raw, ["note"]),
    // Chỉ true khi đúng boolean true — payload có thể trả thiếu field (→ mặc định false).
    isSplitItems: getPath(raw, "is_split_items") === true,
    itemsCount: asNumber(getPath(raw, "items_count")) ?? 0,
    version: asNumber(getPath(raw, "version")) ?? 0,
    customerName: firstString(raw, ["customer.name"]),
  };
}

/** Đọc mảng theo key một cách phòng thủ (payload có thể thiếu field/không phải mảng). */
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Thời điểm tạo (ms) để chọn đơn mới nhất; parse hỏng → 0 (đẩy xuống cuối). */
function createdAtMs(raw: unknown): number {
  const s = firstString(raw, ["created_at"]);
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

// ---- Public API ----

/**
 * Tra cứu 1 đơn Mera theo receiptId (transaction Etsy). Nhánh song song với resolve Sheet.
 * - Thiếu env → reason "not_configured" (SOFT, KHÔNG throw): flow Sheet vẫn chạy bình thường.
 * - Có env: GET /orders?q=<receiptId> rồi lọc phía dora-1 vì `q` là full-text (có thể lẫn đơn khác).
 */
export async function resolveMeraOrder(opts: {
  storeName: string;
  receiptId: number;
  actorEmail: string;
}): Promise<ResolveMeraOrderResponse> {
  // Soft path: chưa cấu hình Mera → không coi là lỗi, chỉ báo lý do để UI hiển thị nhẹ.
  if (!meraConfig()) return { order: null, items: [], reason: "not_configured" };

  const receipt = String(opts.receiptId);
  const { data } = await meraFetch(
    `/api/v2/orders?q=${encodeURIComponent(receipt)}&include_items=true&page_size=50`,
    { actorEmail: opts.actorEmail },
  );

  // Lọc đúng đơn theo order_id: kết thúc "-<receiptId>" (prefix store, vd DAV-3999799511)
  // hoặc trùng nguyên receiptId. Loại đơn đã soft-delete.
  const rawOrders = asArray(getPath(data, "orders")).filter((o) => {
    if (getPath(o, "is_deleted") === true) return false;
    const orderId = firstString(o, ["order_id"]);
    return orderId.endsWith(`-${receipt}`) || orderId === receipt;
  });

  if (rawOrders.length === 0) return { order: null, items: [], reason: "not_found" };

  // Nhiều KQ → thu hẹp theo store (chuẩn hoá như resolve Sheet). Chỉ áp khi còn >=1 để
  // không "lọc mất" đơn khi tên store trên Mera lệch với tên gửi từ Etsy.
  let candidates = rawOrders;
  if (candidates.length > 1 && opts.storeName.trim()) {
    const store = normalizeStore(opts.storeName);
    const byStore = candidates.filter((o) => normalizeStore(firstString(o, ["store"])) === store);
    if (byStore.length > 0) candidates = byStore;
  }

  // Còn nhiều → lấy đơn mới nhất theo created_at.
  const chosen = candidates.reduce((a, b) => (createdAtMs(b) > createdAtMs(a) ? b : a));
  const order = mapOrder(chosen);

  // items lấy từ include_items; nếu rỗng (đơn cũ / API không kèm) → fallback gọi items riêng.
  let rawItems = asArray(getPath(chosen, "items"));
  if (rawItems.length === 0 && order.orderId) {
    const { data: itemsData } = await meraFetch(
      `/api/v2/orders/${encodeURIComponent(order.orderId)}/items`,
      { actorEmail: opts.actorEmail },
    );
    rawItems = asArray(getPath(itemsData, "items"));
  }

  return { order, items: rawItems.map(mapItem), reason: null };
}

/**
 * Danh sách status cấu hình trên Mera (GET /api/v1/statuses — collection `statuses`,
 * chỉnh được từ UI Mera). Trả tên status theo thứ tự `order`. Thiếu env → [] (soft,
 * UI fallback về MERA_STATUS_OPTIONS).
 */
export async function getMeraStatuses(opts: { actorEmail: string }): Promise<string[]> {
  if (!meraConfig()) return [];
  const { status, data } = await meraFetch(`/api/v1/statuses`, { actorEmail: opts.actorEmail });
  if (status !== 200) return [];
  const rows = asArray(data)
    .map((s) => ({
      name: firstString(s, ["name"]),
      order: asNumber(getPath(s, "order")) ?? 0,
    }))
    .filter((s) => s.name);
  rows.sort((a, b) => a.order - b.order);
  return rows.map((s) => s.name);
}

/**
 * DTO camelCase → body PATCH snake_case (chỉ field whitelist có mặt).
 * Ép kiểu tại đây: `quantity` → int (bỏ qua nếu parse hỏng);
 * `trackingCode/Carrier/Url` → gộp object `tracking` (Mera thay nguyên object,
 * client đã gửi đủ cả 3 khi có 1 field tracking dirty).
 */
function itemUpdatesToBody(updates: MeraItemUpdates): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (updates.status !== undefined) body.status = updates.status;
  if (updates.personalization !== undefined) body.personalization = updates.personalization;
  if (updates.customerImage !== undefined) body.customer_image = updates.customerImage;
  if (updates.designLink !== undefined) body.design_link = updates.designLink;
  if (updates.mockupLink !== undefined) body.mockup_link = updates.mockupLink;
  if (updates.productName !== undefined) body.product_name = updates.productName;
  if (updates.price !== undefined) body.price = updates.price;
  if (updates.productType !== undefined) body.product_type = updates.productType;
  if (updates.material !== undefined) body.material = updates.material;
  if (updates.fulfillmentCost !== undefined) body.fulfillment_cost = updates.fulfillmentCost;
  if (updates.ffNameByDay !== undefined) body.ff_name_by_day = updates.ffNameByDay;
  if (updates.quantity !== undefined) {
    const qty = asNumber(updates.quantity);
    if (qty !== undefined && Number.isInteger(qty) && qty > 0) body.quantity = qty;
  }
  if (
    updates.trackingCode !== undefined ||
    updates.trackingCarrier !== undefined ||
    updates.trackingUrl !== undefined
  ) {
    body.tracking = {
      code: updates.trackingCode ?? "",
      carrier: updates.trackingCarrier ?? "",
      url: updates.trackingUrl ?? "",
    };
  }
  return body;
}

/**
 * Cập nhật 1 item Mera. Optimistic lock qua `version`.
 * - 400 ITEM_EDIT_REQUIRES_SPLIT → tự bật split cho order rồi retry PATCH đúng 1 lần
 *   (set splitApplied=true để UI báo "đã bật split items").
 * - 409 → throw version_conflict kèm `latest` (KHÔNG auto-merge, để UI reload).
 */
export async function updateMeraItem(opts: {
  itemKey: string;
  version: number;
  updates: MeraItemUpdates;
  actorEmail: string;
}): Promise<{ item: MeraOrderItem; splitApplied?: boolean }> {
  const body = { version: opts.version, ...itemUpdatesToBody(opts.updates) };
  const path = `/api/v2/order-items/${encodeURIComponent(opts.itemKey)}`;

  const patch = () => meraFetch(path, { method: "PATCH", body, actorEmail: opts.actorEmail });

  let res = await patch();
  let splitApplied = false;

  // Order chưa bật split & có >1 item → Mera chặn sửa item lẻ. Ta bật split rồi thử lại.
  if (res.status === 400 && firstString(res.data, ["error"]) === "ITEM_EDIT_REQUIRES_SPLIT") {
    // order_id = item_key bỏ đoạn line_item_id cuối (order_id có thể chứa "-", vd DAV-3999799511).
    const orderId = opts.itemKey.slice(0, opts.itemKey.lastIndexOf("-"));
    if (orderId) {
      await meraFetch(`/api/v2/orders/${encodeURIComponent(orderId)}/split`, {
        method: "POST",
        body: { split: true },
        actorEmail: opts.actorEmail,
      });
      res = await patch(); // retry đúng 1 lần
      splitApplied = true;
    }
  }

  if (res.status === 200) {
    return splitApplied ? { item: mapItem(res.data), splitApplied: true } : { item: mapItem(res.data) };
  }
  if (res.status === 409) {
    throw new MeraApiError(409, "version_conflict", {
      message: "Item đã bị sửa bởi người khác",
      latest: mapItem(getPath(res.data, "latest")),
    });
  }
  // Lỗi khác: dùng message từ Mera nếu có để dễ chẩn đoán.
  throw new MeraApiError(res.status, undefined, {
    message: firstString(res.data, ["message", "error"]) || `Mera trả ${res.status}`,
  });
}

/**
 * Cập nhật note order-level. Optimistic lock qua `version`.
 * 409 → version_conflict kèm `latest` (order mới nhất).
 */
export async function updateMeraOrderNote(opts: {
  orderId: string;
  version: number;
  note: string;
  actorEmail: string;
}): Promise<{ order: MeraOrderSummary }> {
  const res = await meraFetch(`/api/v2/orders/${encodeURIComponent(opts.orderId)}`, {
    method: "PATCH",
    body: { version: opts.version, note: opts.note },
    actorEmail: opts.actorEmail,
  });

  if (res.status === 200) return { order: mapOrder(res.data) };
  if (res.status === 409) {
    throw new MeraApiError(409, "version_conflict", {
      message: "Đơn đã bị sửa bởi người khác",
      latest: mapOrder(getPath(res.data, "latest")),
    });
  }
  throw new MeraApiError(res.status, undefined, {
    message: firstString(res.data, ["message", "error"]) || `Mera trả ${res.status}`,
  });
}
