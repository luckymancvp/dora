import "server-only";

import { asNumber, firstString, getPath } from "@/lib/services/etsy-utils";
import { normalizeStore } from "@/lib/google/sheet-utils";
import {
  MERA_DEFAULT_COLUMNS,
  MERA_EDITABLE_ITEM_FIELD_KEYS,
  MERA_EDITABLE_ORDER_FIELD_KEYS,
  MERA_ORDER_SCOPE_FIELD_KEYS,
  type MeraColumn,
  type MeraOrderItem,
  type MeraOrderSummary,
  type MeraUpdateRequest,
  type MeraUpdateResponse,
  type ResolveMeraOrderResponse,
} from "@/lib/types/mera";

/**
 * Service gọi Mera Order API (qua fulfill backend) — NƠI DUY NHẤT map snake_case → camelCase.
 * Server-only: dùng Internal API Key (không expire) + X-Actor-Email để ghi audit đúng người.
 * Xem docs/order-api-v2.md và lib/types/mera.ts (type contract).
 *
 * VÒNG 2: panel render field ĐỘNG theo cấu hình "Order Table Columns" của Mera admin.
 * - `resolveMeraOrder` fetch thêm columns (per-project) + resolve `values` theo fieldKey.
 * - `updateMeraOrder` nhận `updates: Record<fieldKey,string>` trộn 2 scope, tự tách + map PATCH body.
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
  // caller tự truyền path đầy đủ "/api/v2/..." hoặc "/api/v1/..." (statuses + order-table-columns ở v1).
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

// ---- Helpers dùng chung ----

/** Đọc mảng theo key một cách phòng thủ (payload có thể thiếu field/không phải mảng). */
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** true nếu object thuần (không phải array/null) — dùng khi merge nested object trước PATCH. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Thời điểm tạo (ms) để chọn đơn mới nhất; parse hỏng → 0 (đẩy xuống cuối). */
function createdAtMs(raw: unknown): number {
  const s = firstString(raw, ["created_at"]);
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Toàn bộ field_key ITEM-scope hợp lệ (nguồn: order_table_fields.go group Item — research §"Danh sách").
 * Dùng để LỌC field_key lạ khỏi columns (đừng render cột rác). Kết hợp MERA_ORDER_SCOPE_FIELD_KEYS
 * cho order-scope. Set này rộng hơn whitelist patch (gồm cả field read-only như provider/source_link).
 */
const MERA_ITEM_FIELD_KEYS_ALL: readonly string[] = [
  "item_key", "status", "item_note", "provider", "provider_history", "material",
  "designer.name", "source_link", "product_name", "quantity", "personalization",
  "image_link", "design_link", "customer_image", "mockup_link", "price", "product_type",
  "fulfillment_cost", "ff_name_by_day",
  "tracking.code", "tracking.carrier", "tracking.url",
  "shipping.name", "shipping.street", "shipping.city", "shipping.state", "shipping.zip_code", "shipping.country",
];

/** field_key có nằm trong danh sách hợp lệ (order-scope hoặc item-scope)? */
function isKnownFieldKey(fieldKey: string): boolean {
  return MERA_ORDER_SCOPE_FIELD_KEYS.includes(fieldKey) || MERA_ITEM_FIELD_KEYS_ALL.includes(fieldKey);
}

/** Phân scope theo fieldKey: nằm trong set order-scope thì "order", còn lại "item". */
function scopeOf(fieldKey: string): "order" | "item" {
  return MERA_ORDER_SCOPE_FIELD_KEYS.includes(fieldKey) ? "order" : "item";
}

/**
 * Chuyển giá trị leaf (từ getPath) về string hiển thị.
 * - string giữ nguyên (kể cả date ISO — client tự format, tránh mất chính xác timezone).
 * - number/boolean → String(). null/undefined/object → "".
 */
function stringifyLeaf(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return String(v);
  return "";
}

/**
 * Resolve giá trị 1 fieldKey trên 1 object (order hoặc item) → string hiển thị.
 * Bắt chước getValueByPath của mera frontend:
 * - `item_note` là alias của `item.note` (Item Note giờ ở cấp item — trọng tâm vòng 2).
 * - `provider_history` là mảng lịch sử → join "provider - date - email" mỗi dòng.
 * - còn lại: getPath theo dot-path (`tracking.code`, `customer.name`, `pricing.total`…).
 */
function resolveFieldValue(raw: unknown, fieldKey: string): string {
  // item_note KHÔNG có path "item_note" trong payload — nó ánh xạ tới field `note` của order_items.
  if (fieldKey === "item_note") return firstString(raw, ["note"]);

  // provider_history: mảng object lịch sử đổi nhà cung cấp → gộp thành text nhiều dòng.
  if (fieldKey === "provider_history") {
    const rows = asArray(getPath(raw, "provider_history")).map((h) => {
      const provider = firstString(h, ["provider", "name"]);
      const date = firstString(h, ["date", "changed_at", "created_at", "at"]);
      const email = firstString(h, ["email", "actor_email", "by"]);
      return [provider, date, email].filter(Boolean).join(" - ");
    });
    return rows.filter(Boolean).join("\n");
  }

  return stringifyLeaf(getPath(raw, fieldKey));
}

/**
 * Build `values: Record<fieldKey,string>` cho 1 object theo danh sách fieldKey cần hiển thị.
 * `always` là fieldKey LUÔN kèm dù không có trong columns (note ổn định cho UI):
 * item → "item_note"; order → "note".
 */
function buildValues(raw: unknown, fieldKeys: string[], always: string): Record<string, string> {
  const values: Record<string, string> = {};
  const keys = new Set<string>([always, ...fieldKeys]);
  for (const fk of keys) values[fk] = resolveFieldValue(raw, fk);
  return values;
}

// ---- Map snake_case (Mera JSON) → camelCase (DTO). ----

/**
 * Map 1 item Mera (order_items JSON) → MeraOrderItem. Parse phòng thủ vì shape không đảm bảo.
 * `fieldKeys` = fieldKey item-scope cần điền vào `values` (từ columns đang hiển thị). Luôn kèm `item_note`.
 */
function mapItem(raw: unknown, fieldKeys: string[]): MeraOrderItem {
  return {
    itemKey: firstString(raw, ["item_key"]),
    orderId: firstString(raw, ["order_id"]),
    // note = item_note → order_items.note (trọng tâm vòng 2, giữ typed cho UI core).
    note: firstString(raw, ["note"]),
    imageLink: firstString(raw, ["image_link"]),
    version: asNumber(getPath(raw, "version")) ?? 0,
    values: buildValues(raw, fieldKeys, "item_note"),
  };
}

/**
 * Map 1 order Mera (orders JSON) → MeraOrderSummary. `customer.name` flatten.
 * `fieldKeys` = fieldKey order-scope cần điền vào `values`. Luôn kèm `note`.
 * `projectId` (`project_id`) dùng fetch order-table-columns của đúng project — xác nhận field tại
 * docs/order-api-v2.md Data Models. Nếu payload thật đổi tên → thêm alias vào firstString bên dưới.
 */
function mapOrder(raw: unknown, fieldKeys: string[]): MeraOrderSummary {
  return {
    orderId: firstString(raw, ["order_id"]),
    // project_id: khoá fetch cấu hình cột. Rỗng → resolve fallback MERA_DEFAULT_COLUMNS.
    projectId: firstString(raw, ["project_id", "projectId", "project.id"]),
    store: firstString(raw, ["store"]),
    note: firstString(raw, ["note"]),
    // Chỉ true khi đúng boolean true — payload có thể trả thiếu field (→ mặc định false).
    isSplitItems: getPath(raw, "is_split_items") === true,
    itemsCount: asNumber(getPath(raw, "items_count")) ?? 0,
    version: asNumber(getPath(raw, "version")) ?? 0,
    customerName: firstString(raw, ["customer.name"]),
    values: buildValues(raw, fieldKeys, "note"),
  };
}

// ---- Cấu hình cột động (Order Table Columns) ----

/**
 * Chuẩn hoá danh sách cột từ JSON admin (snake_case) → MeraColumn[] đã sẵn sàng cho client:
 * lọc `visible !== false`, bỏ field_key lạ, dedupe fieldKey, sort `position` tăng, và tính
 * `editable` CUỐI = `config.editable !== false` AND fieldKey ∈ whitelist patch của scope tương ứng.
 */
function normalizeColumns(rawColumns: unknown): MeraColumn[] {
  const seen = new Set<string>();
  const cols: MeraColumn[] = [];

  for (const raw of asArray(rawColumns)) {
    const fieldKey = firstString(raw, ["field_key", "fieldKey"]);
    if (!fieldKey) continue;
    // Ẩn cột admin tắt hiển thị. (editable normalize nil→true ở backend nên chỉ check visible.)
    if (getPath(raw, "visible") === false) continue;
    // Bỏ field_key ngoài danh sách hợp lệ để không render cột rác/không resolve được.
    if (!isKnownFieldKey(fieldKey)) continue;
    // Dedupe: giữ cấu hình xuất hiện trước (position sẽ sort lại sau).
    if (seen.has(fieldKey)) continue;
    seen.add(fieldKey);

    const scope = scopeOf(fieldKey);
    const configEditable = getPath(raw, "editable") !== false;
    const whitelist = scope === "order" ? MERA_EDITABLE_ORDER_FIELD_KEYS : MERA_EDITABLE_ITEM_FIELD_KEYS;
    // editable cuối = admin bật AND dora-1 PATCH được field này (whitelist scope).
    const editable = configEditable && whitelist.includes(fieldKey);

    cols.push({
      id: firstString(raw, ["id"]) || `col-${fieldKey}`,
      label: firstString(raw, ["label"]) || fieldKey,
      fieldKey,
      scope,
      position: asNumber(getPath(raw, "position")) ?? 0,
      visible: true,
      editable,
    });
  }

  cols.sort((a, b) => a.position - b.position);
  return cols;
}

/**
 * Lấy cấu hình cột của 1 project qua fulfill proxy
 * `GET <origin>/api/v1/projects/:projectId/order-table-columns` (Bearer INTERNAL_API_KEY).
 * meraConfig() đã đưa base về origin (bỏ /api/v2) nên path v1 ghép thẳng là đúng (giống getMeraStatuses).
 * KHÔNG được làm fail cả resolve: projectId rỗng / status !== 200 / columns [] / lỗi mạng → fallback
 * MERA_DEFAULT_COLUMNS (panel vẫn chạy với layout mặc định).
 */
async function fetchMeraColumns(projectId: string, actorEmail: string): Promise<MeraColumn[]> {
  // Không có project_id (Mera không trả) → dùng mặc định, khỏi gọi API.
  if (!projectId) return MERA_DEFAULT_COLUMNS;

  try {
    const { status, data } = await meraFetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/order-table-columns`,
      { actorEmail },
    );
    if (status !== 200) return MERA_DEFAULT_COLUMNS;
    const cols = normalizeColumns(getPath(data, "columns"));
    // Project chưa cấu hình → {"columns": []} → fallback mặc định.
    return cols.length > 0 ? cols : MERA_DEFAULT_COLUMNS;
  } catch {
    // Lỗi/timeout khi fetch columns KHÔNG được kéo sập resolve — panel vẫn hiển thị field mặc định.
    return MERA_DEFAULT_COLUMNS;
  }
}

// ---- Public API ----

/**
 * Tra cứu 1 đơn Mera theo receiptId (transaction Etsy). Nhánh song song với resolve Sheet.
 * - Thiếu env → reason "not_configured" (SOFT, KHÔNG throw): flow Sheet vẫn chạy bình thường.
 * - Có env: GET /orders?q=<receiptId> rồi lọc phía dora-1 vì `q` là full-text (có thể lẫn đơn khác).
 * VÒNG 2: sau khi chọn đơn → fetch columns theo project + resolve `values` đúng cột hiển thị.
 */
export async function resolveMeraOrder(opts: {
  storeName: string;
  receiptId: number;
  actorEmail: string;
}): Promise<ResolveMeraOrderResponse> {
  // Soft path: chưa cấu hình Mera → không coi là lỗi, chỉ báo lý do để UI hiển thị nhẹ.
  if (!meraConfig()) return { order: null, items: [], columns: [], reason: "not_configured" };

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

  if (rawOrders.length === 0) return { order: null, items: [], columns: [], reason: "not_found" };

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

  // projectId cần đọc TRƯỚC để fetch columns; mapOrder cũng đọc lại (rẻ, giữ tách bạch).
  const projectId = firstString(chosen, ["project_id", "projectId", "project.id"]);
  const columns = await fetchMeraColumns(projectId, opts.actorEmail);

  // Tách fieldKey theo scope để chỉ resolve `values` đúng cột đang hiển thị (đừng đổ hết field).
  const orderFieldKeys = columns.filter((c) => c.scope === "order").map((c) => c.fieldKey);
  const itemFieldKeys = columns.filter((c) => c.scope === "item").map((c) => c.fieldKey);

  const order = mapOrder(chosen, orderFieldKeys);

  // items lấy từ include_items; nếu rỗng (đơn cũ / API không kèm) → fallback gọi items riêng.
  let rawItems = asArray(getPath(chosen, "items"));
  if (rawItems.length === 0 && order.orderId) {
    const { data: itemsData } = await meraFetch(
      `/api/v2/orders/${encodeURIComponent(order.orderId)}/items`,
      { actorEmail: opts.actorEmail },
    );
    rawItems = asArray(getPath(itemsData, "items"));
  }

  return { order, items: rawItems.map((it) => mapItem(it, itemFieldKeys)), columns, reason: null };
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

// ---- Update: map fieldKey → PATCH body (unified 2 scope) ----

/** Unwrap payload có thể bọc trong {item:...}/{order:...} hoặc trả object trực tiếp. */
function unwrap(data: unknown, wrapKey: "item" | "order"): unknown {
  const inner = getPath(data, wrapKey);
  return isPlainObject(inner) ? inner : data;
}

/**
 * Gộp 1 nested object (tracking/shipping/customer/pricing) trước PATCH: copy toàn bộ subfield
 * hiện tại từ `current` rồi ghi đè subfield thay đổi. Mera PATCH nhận NGUYÊN object nên phải gửi
 * đủ (nếu gửi thiếu, Mera coi như xoá subfield khác). `changes` = fieldKey→val của riêng scope này.
 */
function mergeNestedObject(
  current: unknown,
  parent: string,
  changes: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  const base = getPath(current, parent);
  if (isPlainObject(base)) {
    for (const [k, v] of Object.entries(base)) result[k] = stringifyLeaf(v);
  }
  for (const [fk, val] of Object.entries(changes)) {
    if (fk.startsWith(`${parent}.`)) result[fk.slice(parent.length + 1)] = val;
  }
  return result;
}

/**
 * Build PATCH body cho MỘT scope (item hoặc order) từ map fieldKey→val.
 * - `item_note` → field `note` (item-scope). Scalar khác: field name = fieldKey (đã snake_case).
 * - Số (`quantity`/`export_count`) ép int hợp lệ, bỏ nếu parse hỏng.
 * - Nested (`tracking.*`/`shipping.*`/`customer.*`/`pricing.*`): fetch object MỚI NHẤT rồi merge (D7).
 * Trả body KHÔNG kèm version (caller tự thêm version của scope tương ứng).
 */
async function buildScopeBody(
  fields: Record<string, string>,
  fetchCurrent: () => Promise<unknown>,
  actorEmail: string,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {};
  const nestedParents = new Set<string>();
  for (const fk of Object.keys(fields)) {
    if (fk.includes(".")) nestedParents.add(fk.split(".")[0]);
  }

  // Chỉ fetch object hiện tại khi có field nested (tránh gọi thừa khi chỉ sửa scalar).
  const current = nestedParents.size > 0 ? await fetchCurrent() : null;

  for (const [fk, val] of Object.entries(fields)) {
    if (fk.includes(".")) continue; // nested xử lý riêng bên dưới
    if (fk === "item_note") {
      body.note = val; // Item Note → order_items.note
      continue;
    }
    if (fk === "quantity" || fk === "export_count") {
      const n = asNumber(val);
      if (n !== undefined && Number.isInteger(n) && n >= 0) body[fk] = n;
      continue;
    }
    // Scalar còn lại: fieldKey chính là tên field snake_case của Mera → gán thẳng.
    body[fk] = val;
  }

  for (const parent of nestedParents) {
    body[parent] = mergeNestedObject(current, parent, fields);
  }

  // actorEmail giữ trong closure fetchCurrent; tham số này chỉ để nhắc caller truyền đúng người.
  void actorEmail;
  return body;
}

/**
 * PATCH item với auto-split + retry:
 * - 400 ITEM_EDIT_REQUIRES_SPLIT → bật split cho order rồi PATCH lại đúng 1 lần (splitApplied=true).
 * - 200 → mapItem(res.data). 409 → throw version_conflict (latest item). Lỗi khác → throw nguyên message.
 */
async function patchItem(opts: {
  itemKey: string;
  orderId: string;
  body: Record<string, unknown>;
  itemFieldKeys: string[];
  actorEmail: string;
}): Promise<{ item: MeraOrderItem; splitApplied: boolean }> {
  const path = `/api/v2/order-items/${encodeURIComponent(opts.itemKey)}`;
  const patch = () => meraFetch(path, { method: "PATCH", body: opts.body, actorEmail: opts.actorEmail });

  let res = await patch();
  let splitApplied = false;

  // Order chưa bật split & có >1 item → Mera chặn sửa item lẻ. Ta bật split rồi thử lại.
  if (res.status === 400 && firstString(res.data, ["error"]) === "ITEM_EDIT_REQUIRES_SPLIT") {
    if (opts.orderId) {
      await meraFetch(`/api/v2/orders/${encodeURIComponent(opts.orderId)}/split`, {
        method: "POST",
        body: { split: true },
        actorEmail: opts.actorEmail,
      });
      res = await patch(); // retry đúng 1 lần
      splitApplied = true;
    }
  }

  if (res.status === 200) {
    return { item: mapItem(unwrap(res.data, "item"), opts.itemFieldKeys), splitApplied };
  }
  if (res.status === 409) {
    throw new MeraApiError(409, "version_conflict", {
      message: "Item đã bị sửa bởi người khác",
      latest: mapItem(getPath(res.data, "latest"), opts.itemFieldKeys),
    });
  }
  throw new MeraApiError(res.status, undefined, {
    message: firstString(res.data, ["message", "error"]) || `Mera trả ${res.status}`,
  });
}

/**
 * PATCH order. 200 → mapOrder. 409 → version_conflict (latest order). Lỗi khác → throw message.
 */
async function patchOrder(opts: {
  orderId: string;
  body: Record<string, unknown>;
  orderFieldKeys: string[];
  actorEmail: string;
}): Promise<{ order: MeraOrderSummary }> {
  const res = await meraFetch(`/api/v2/orders/${encodeURIComponent(opts.orderId)}`, {
    method: "PATCH",
    body: opts.body,
    actorEmail: opts.actorEmail,
  });

  if (res.status === 200) return { order: mapOrder(unwrap(res.data, "order"), opts.orderFieldKeys) };
  if (res.status === 409) {
    throw new MeraApiError(409, "version_conflict", {
      message: "Đơn đã bị sửa bởi người khác",
      latest: mapOrder(getPath(res.data, "latest"), opts.orderFieldKeys),
    });
  }
  throw new MeraApiError(res.status, undefined, {
    message: firstString(res.data, ["message", "error"]) || `Mera trả ${res.status}`,
  });
}

/**
 * Cập nhật đơn Mera theo fieldKey (unified 2 scope). Tách `updates` thành item-scope/order-scope,
 * map fieldKey → PATCH body, gọi PATCH tương ứng. Trả `{ item, order, splitApplied }` — scope không
 * đổi = null. 409 ở scope nào → throw version_conflict với latest đúng loại scope đó.
 */
export async function updateMeraOrder(
  opts: MeraUpdateRequest & { actorEmail: string },
): Promise<MeraUpdateResponse> {
  const updates = opts.updates ?? {};
  const itemFields: Record<string, string> = {};
  const orderFields: Record<string, string> = {};
  for (const [fk, val] of Object.entries(updates)) {
    if (scopeOf(fk) === "order") orderFields[fk] = val;
    else itemFields[fk] = val;
  }

  const hasItem = Object.keys(itemFields).length > 0;
  const hasOrder = Object.keys(orderFields).length > 0;
  if (!hasItem && !hasOrder) {
    throw new MeraApiError(400, undefined, { message: "updates rỗng" });
  }

  let item: MeraOrderItem | null = null;
  let order: MeraOrderSummary | null = null;
  let splitApplied = false;

  // ---- Item-scope ----
  if (hasItem) {
    if (!opts.itemKey || typeof opts.itemVersion !== "number") {
      throw new MeraApiError(400, undefined, { message: "thiếu itemKey/itemVersion cho field item-scope" });
    }
    const itemKey = opts.itemKey;
    const itemVersion = opts.itemVersion;
    // fieldKeys resolve về values của item trả về = các field vừa sửa (+ item_note luôn kèm).
    const itemFieldKeys = Object.keys(itemFields);
    const body = {
      version: itemVersion,
      ...(await buildScopeBody(
        itemFields,
        // Fetch item MỚI NHẤT để merge nested (tracking/shipping) trước PATCH.
        () => meraFetch(`/api/v2/order-items/${encodeURIComponent(itemKey)}`, { actorEmail: opts.actorEmail }).then((r) => unwrap(r.data, "item")),
        opts.actorEmail,
      )),
    };
    const r = await patchItem({ itemKey, orderId: opts.orderId, body, itemFieldKeys, actorEmail: opts.actorEmail });
    item = r.item;
    splitApplied = r.splitApplied;
  }

  // ---- Order-scope ----
  if (hasOrder) {
    if (!opts.orderId || typeof opts.orderVersion !== "number") {
      throw new MeraApiError(400, undefined, { message: "thiếu orderId/orderVersion cho field order-scope" });
    }
    const orderId = opts.orderId;
    const orderVersion = opts.orderVersion;
    const orderFieldKeys = Object.keys(orderFields);
    const body = {
      version: orderVersion,
      ...(await buildScopeBody(
        orderFields,
        // Fetch order MỚI NHẤT để merge nested (customer/pricing) trước PATCH.
        () => meraFetch(`/api/v2/orders/${encodeURIComponent(orderId)}`, { actorEmail: opts.actorEmail }).then((r) => unwrap(r.data, "order")),
        opts.actorEmail,
      )),
    };
    const r = await patchOrder({ orderId, body, orderFieldKeys, actorEmail: opts.actorEmail });
    order = r.order;
  }

  return { item, order, splitApplied };
}
