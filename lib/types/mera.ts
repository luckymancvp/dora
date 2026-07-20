/**
 * Contract chung cho tính năng "Cập nhật Mera" — VÒNG 2 (panel field ĐỘNG).
 *
 * Một type – bốn tầng: service Mera (map snake_case → camelCase + resolve columns) →
 * route `json()` → hook `useMera` (cast `as T`) → component `MeraItemEditor`. KHÔNG tầng
 * nào được tự định nghĩa lại shape; mọi thay đổi shape phải sửa ở đây rồi báo cả backend + frontend.
 *
 * KHÁC vòng 1: panel không còn render danh sách field CỨNG. Server đọc cấu hình
 * "Order Table Columns" của Mera admin (per-project) → trả `columns: MeraColumn[]` đã
 * chuẩn hoá (lọc visible, sort position, editable = config AND patchable AND dora-1 hỗ trợ).
 * Giá trị field động chở qua `values: Record<fieldKey, string>` theo scope (item/order).
 * Update dùng `updates: Record<fieldKey, string>` — server map fieldKey → PATCH body.
 *
 * Nguồn dữ liệu: Mera Order API v2 qua fulfill backend (`.../api/v2`); cấu hình cột lấy qua
 * `GET <origin>/api/v1/projects/:projectId/order-table-columns` (xem _workspace/05_mera_columns_research.md).
 */

// ---- Sub-objects ----

/** Tracking của 1 item — hiển thị theo column `tracking.*`; editable tuỳ cấu hình. */
export interface MeraTracking {
  code: string;
  carrier: string;
  url: string;
}

// ---- Cấu hình cột động (Order Table Columns) ----

/**
 * 1 cột cấu hình của panel Mera (DTO camelCase; server map từ JSON snake_case của admin).
 * Server TRẢ ĐÃ CHUẨN HOÁ: chỉ `visible !== false`, sort tăng theo `position`, dedupe theo
 * `fieldKey`. `editable` là kết quả CUỐI CÙNG = `column.editable !== false` AND fieldKey thuộc
 * whitelist patch của scope tương ứng AND dora-1 hỗ trợ (xem MERA_EDITABLE_*_FIELD_KEYS).
 * Client KHÔNG tự tính editable — chỉ render read-only cell khi `editable === false`.
 */
export interface MeraColumn {
  /** id cột từ admin (hoặc `default-*` khi fallback). */
  id: string;
  /** Nhãn hiển thị (từ cấu hình admin; default có nhãn tiếng Anh khớp field_defs). */
  label: string;
  /** field_key gốc (vd `status`, `item_note`, `tracking.code`, `note`). Khoá của `values`/`updates`. */
  fieldKey: string;
  /** Phạm vi dữ liệu: `item` đọc/ghi trên order_items; `order` trên orders. Server tự phân loại. */
  scope: "order" | "item";
  /** Vị trí sắp xếp (tăng dần). */
  position: number;
  /** Luôn `true` sau khi server lọc (giữ field cho đầy đủ DTO admin). */
  visible: boolean;
  /** editable CUỐI CÙNG (đã giao config ∩ patchable ∩ dora-1 hỗ trợ). */
  editable: boolean;
}

// ---- DTO client (service map từ JSON snake_case của Mera API) ----

/**
 * 1 item của đơn Mera (nguồn: `order_items`). VÒNG 2: giá trị field động nằm trong `values`
 * (key = fieldKey item-scope, giá trị đã resolve về string hiển thị). Giữ vài field typed cho
 * UI core (không phụ thuộc cấu hình cột): `itemKey`/`version` (khoá + optimistic lock),
 * `note` (= item_note → order_items.note, trọng tâm vòng 2), `imageLink` (thumbnail read-only).
 */
export interface MeraOrderItem {
  /** `item_key` — khoá PATCH item: `<order_id>-<line_item_id>`. */
  itemKey: string;
  /** `order_id` — đơn cha. */
  orderId: string;
  /** `note` (field_key `item_note`) — Item Note → `order_items.note`. Cũng có trong `values["item_note"]`. */
  note: string;
  /** `image_link` — thumbnail, read-only; giữ để UI core không phụ thuộc columns. */
  imageLink: string;
  /** `version` — optimistic lock của item. */
  version: number;
  /**
   * Giá trị field item-scope đã resolve (key = fieldKey, vd `status`, `personalization`,
   * `customer_image`, `tracking.code`). Server chỉ điền các fieldKey của cột item-scope đang hiển thị
   * (+ luôn có `item_note`). Nested resolve theo dot-path (`item_note` → `item.note`).
   */
  values: Record<string, string>;
}

/**
 * Metadata đơn Mera (nguồn: `orders`). VÒNG 2: field order-scope chở qua `values`.
 * `projectId` để server fetch order-table-columns của đúng project.
 */
export interface MeraOrderSummary {
  /** `order_id` (vd `DAV-3999799511`). */
  orderId: string;
  /** `project_id` — dùng fetch cấu hình cột. Rỗng nếu Mera không trả (→ fallback default columns). */
  projectId: string;
  /** `store`. */
  store: string;
  /** `note` — Order Note (order-scope). Cũng có trong `values["note"]`. */
  note: string;
  /** `is_split_items` — điều kiện PATCH item; auto-split khi cần. */
  isSplitItems: boolean;
  /** `items_count`. */
  itemsCount: number;
  /** `version` — optimistic lock của order. */
  version: number;
  /** `customer.name`. */
  customerName: string;
  /**
   * Giá trị field order-scope đã resolve (key = fieldKey, vd `note`, `customer.name`,
   * `pricing.total`). Server chỉ điền fieldKey của cột order-scope đang hiển thị (+ luôn có `note`).
   */
  values: Record<string, string>;
}

/** Lý do resolve không có kết quả (soft, để UI hiển thị thông điệp phù hợp). */
export type MeraResolveReason = "not_found" | "not_configured" | null;

/**
 * Kết quả resolve 1 đơn trên Mera.
 * - `order === null && reason === "not_found"`: không có đơn khớp trên Mera.
 * - `reason === "not_configured"`: thiếu env MERA_* (soft, KHÔNG throw) → flow Sheet vẫn chạy.
 * - `order !== null && reason === null`: có đơn; `items` là danh sách item; `columns` là cấu hình
 *   cột đã chuẩn hoá (fallback MERA_DEFAULT_COLUMNS khi project chưa cấu hình / rỗng).
 */
export interface ResolveMeraOrderResponse {
  order: MeraOrderSummary | null;
  items: MeraOrderItem[];
  /** Cột đã lọc visible + sort position + editable final. `[]` khi order === null. */
  columns: MeraColumn[];
  reason: MeraResolveReason;
}

// ---- Update contract (POST /api/mera/update) ----

/**
 * Body cập nhật (UNIFIED — không còn discriminated union theo `target`).
 * `updates` = map fieldKey → giá trị string mới, TRỘN cả item-scope lẫn order-scope; server tự
 * tách theo scope, map fieldKey → PATCH body (item_note→note, nested `tracking.*`/`shipping.*`/
 * `customer.*`/`pricing.*` → merge với object hiện tại fetch mới rồi gửi NGUYÊN object).
 * - Có fieldKey item-scope → cần `itemKey` + `itemVersion` (else server 400).
 * - Có fieldKey order-scope → cần `orderId` + `orderVersion`.
 * Panel tách section: order-scope lưu ở cấp order (itemKey rỗng), item-scope lưu ở từng item card.
 */
export interface MeraUpdateRequest {
  /** fieldKey → giá trị string mới (chỉ field dirty). */
  updates: Record<string, string>;
  /** khoá item — bắt buộc khi `updates` có field item-scope. */
  itemKey?: string;
  /** optimistic lock item — bắt buộc khi có field item-scope. */
  itemVersion?: number;
  /** khoá order — luôn gửi (biết từ đơn đã resolve). */
  orderId: string;
  /** optimistic lock order — luôn gửi. */
  orderVersion: number;
}

/**
 * Response POST /api/mera/update. `item`/`order` chỉ khác null khi scope tương ứng có thay đổi.
 * `splitApplied` true nếu server auto-bật split trước khi PATCH item.
 */
export interface MeraUpdateResponse {
  item: MeraOrderItem | null;
  order: MeraOrderSummary | null;
  splitApplied?: boolean;
}

/**
 * Body lỗi 409 version_conflict — `latest` là object mới nhất (item hoặc order tuỳ scope xung đột).
 * Frontend đọc `latest` để toast + refetch/remount.
 */
export interface MeraConflictBody {
  error: string;
  code: "version_conflict";
  latest: MeraOrderItem | MeraOrderSummary;
}

// ---- Phân loại scope & whitelist patch (SINGLE SOURCE OF TRUTH cho server) ----
// Server import các set này để: (1) phân loại fieldKey → scope; (2) tính editable cuối.
// Frontend KHÔNG cần import (đã có `scope`/`editable` sẵn trong MeraColumn).

/**
 * fieldKey thuộc ORDER-scope (đọc/ghi trên `orders`). Mọi fieldKey KHÔNG nằm ở đây coi là ITEM-scope.
 * (Nguồn: order_table_fields.go group Order/Customer/Pricing — xem research §"Danh sách field_key".)
 */
export const MERA_ORDER_SCOPE_FIELD_KEYS: readonly string[] = [
  "order_id", "note", "channel", "store", "vat_ioss", "items_count", "export_count",
  "etsy_account", "created_at", "order_date", "conversation_id",
  "customer.name", "customer.email",
  "pricing.subtotal", "pricing.discount", "pricing.total", "pricing.currency",
];

/**
 * fieldKey ITEM-scope mà dora-1 PATCH được (order_items). Editable cuối = column.editable !== false
 * AND fieldKey ∈ set này. LOẠI các field read-only/phức tạp: provider, provider_history,
 * designer.*, source_link, item_key, items_count, product_history…
 * `item_note` map sang body field `note`; `tracking.*`/`shipping.*` gửi nguyên object (nested merge).
 */
export const MERA_EDITABLE_ITEM_FIELD_KEYS: readonly string[] = [
  "status", "item_note", "personalization", "customer_image", "design_link", "mockup_link",
  "image_link", "product_name", "quantity", "price", "product_type", "material",
  "fulfillment_cost", "ff_name_by_day",
  "tracking.code", "tracking.carrier", "tracking.url",
  "shipping.name", "shipping.street", "shipping.city", "shipping.state", "shipping.zip_code", "shipping.country",
];

/**
 * fieldKey ORDER-scope mà dora-1 PATCH được (orders). LOẠI read-only: order_id, created_at,
 * order_date, conversation_id, items_count. `customer.*`/`pricing.*` gửi nguyên object (nested merge).
 */
export const MERA_EDITABLE_ORDER_FIELD_KEYS: readonly string[] = [
  "note", "channel", "store", "vat_ioss", "etsy_account", "export_count",
  "customer.name", "customer.email",
  "pricing.subtotal", "pricing.discount", "pricing.total", "pricing.currency",
];

// ---- Form cố định của panel Mera (giao diện như panel Sheet) ----

/**
 * Field hiển thị trong form panel Mera — CỐ ĐỊNH như form Sheet (label trùng tên field Sheet
 * để `FieldInput` giữ nguyên behavior: Status → dropdown, Customer Image/Design/Mockup → preview,
 * Order Note/Personalization → textarea). "Order Note" ghi vào `order_items.note` (fieldKey
 * `item_note`) theo nghiệp vụ mới. Server luôn resolve đủ các fieldKey này vào `values`
 * bất kể cấu hình cột admin.
 */
export const MERA_FORM_FIELDS: readonly { label: string; fieldKey: string }[] = [
  { label: "Status",          fieldKey: "status" },
  { label: "Order Note",      fieldKey: "item_note" },
  { label: "Personalization", fieldKey: "personalization" },
  { label: "Customer Image",  fieldKey: "customer_image" },
  { label: "Design",          fieldKey: "design_link" },
  { label: "Mockup",          fieldKey: "mockup_link" },
];

/**
 * fieldKey item-scope mà server LUÔN resolve vào `item.values` (form cố định + tracking read-only),
 * union với fieldKey từ cấu hình cột admin.
 */
export const MERA_FORM_ITEM_FIELD_KEYS: readonly string[] = [
  ...MERA_FORM_FIELDS.map((f) => f.fieldKey),
  "tracking.code",
  "tracking.url",
];

// ---- Fallback columns khi project chưa cấu hình (columns rỗng) ----

/**
 * Danh sách cột MẶC ĐỊNH khi `GET .../order-table-columns` trả `{"columns": []}`.
 * Bám layout vòng 1 + trọng tâm vòng 2 (Item Note). `editable` đã là giá trị CUỐI (dora-1 hỗ trợ).
 * Server dùng nguyên list này (không cần lọc lại) khi order.projectId rỗng hoặc columns rỗng.
 */
export const MERA_DEFAULT_COLUMNS: MeraColumn[] = [
  { id: "default-status",          label: "Status",          fieldKey: "status",          scope: "item",  position: 0, visible: true, editable: true },
  { id: "default-note",            label: "Order Note",      fieldKey: "note",            scope: "order", position: 1, visible: true, editable: true },
  { id: "default-item_note",       label: "Item Note",       fieldKey: "item_note",       scope: "item",  position: 2, visible: true, editable: true },
  { id: "default-personalization", label: "Personalization", fieldKey: "personalization", scope: "item",  position: 3, visible: true, editable: true },
  { id: "default-customer_image",  label: "Customer Image",  fieldKey: "customer_image",  scope: "item",  position: 4, visible: true, editable: true },
  { id: "default-design_link",     label: "Design",          fieldKey: "design_link",     scope: "item",  position: 5, visible: true, editable: true },
  { id: "default-mockup_link",     label: "Mockup",          fieldKey: "mockup_link",     scope: "item",  position: 6, visible: true, editable: true },
  { id: "default-tracking_code",   label: "Tracking",        fieldKey: "tracking.code",   scope: "item",  position: 7, visible: true, editable: false },
];

/**
 * FALLBACK khi chưa fetch được status từ Mera (`useMeraStatuses` ↔ GET /api/mera/statuses).
 * Status trên Mera là CẤU HÌNH (collection `statuses`) nên luôn ưu tiên list fetch động; list này
 * chỉ dùng khi lỗi/thiếu env. `StatusSelect` prepend giá trị hiện tại nếu lạ → không mất data.
 */
export const MERA_STATUS_OPTIONS = [
  "NEW",
  "ON HOLD",
  "DESIGNING",
  "DESIGNED",
  "NEED REPAIR",
  "REPAIRED",
  "CONFIRMED",
  "PROCESSING",
  "WAITING CUSTOMER",
  "SHIPPING",
  "EXPORTING",
  "WAIT IMAGE",
  "EMAILED",
  "TRACKING",
  "DELIVERED",
  "CANCELLED",
] as const;
