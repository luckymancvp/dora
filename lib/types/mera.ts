/**
 * Contract chung cho tính năng "Cập nhật Mera" (nhánh song song với "Cập nhật Sheet").
 *
 * Một type – bốn tầng: service Mera (map snake_case → camelCase) → route `json()`
 * → hook `useMera` (cast `as T`) → component `MeraItemEditor`. KHÔNG tầng nào được
 * tự định nghĩa lại shape; mọi thay đổi shape phải sửa ở đây rồi báo cả backend + frontend.
 *
 * Nguồn dữ liệu: Mera Order API v2 qua fulfill backend
 * (`https://mera-fulfill-api.pamoteam.top/api/v2`, xem docs/order-api-v2.md).
 * DTO camelCase để khớp convention của lib/types/sheets.ts (không phơi snake_case ra client).
 */

// ---- Sub-objects ----

/** Tracking của 1 item — CHỈ ĐỌC trên panel (Mera là nguồn ghi). */
export interface MeraTracking {
  code: string;
  carrier: string;
  url: string;
}

// ---- DTO client (service map từ JSON snake_case của Mera API) ----

/**
 * 1 item của đơn Mera (nguồn: `order_items`, xem §3/§5 order-api-v2.md).
 * Form nhanh sửa 5 field chính; popup "sửa toàn bộ field" mở thêm các field
 * user-managed còn lại. Bỏ các field dạng object/array phức tạp (provider,
 * shipping, designer) — chưa sửa được từ panel.
 * `version` dùng cho optimistic locking khi PATCH.
 */
export interface MeraOrderItem {
  /** `item_key` — khoá PATCH item: `<order_id>-<line_item_id>`. */
  itemKey: string;
  /** `order_id` — đơn cha. */
  orderId: string;
  /** `status` — editable. */
  status: string;
  /** `personalization` — editable. */
  personalization: string;
  /** `customer_image` — editable (nhiều dòng, mỗi dòng 1 link ảnh). */
  customerImage: string;
  /** `design_link` — editable. */
  designLink: string;
  /** `mockup_link` — editable. */
  mockupLink: string;
  /** `tracking` — chỉ đọc ở form nhanh, editable trong popup toàn bộ field. */
  tracking: MeraTracking;
  /** `image_link` — thumbnail, chỉ đọc. */
  imageLink: string;
  /** `product_name` — editable (popup). */
  productName: string;
  /** `quantity` — editable (popup, số nguyên). */
  quantity: number;
  /** `price` — editable (popup, chuỗi số theo Mera). */
  price: string;
  /** `product_type` — editable (popup). */
  productType: string;
  /** `material` — editable (popup). */
  material: string;
  /** `fulfillment_cost` — editable (popup). */
  fulfillmentCost: string;
  /** `ff_name_by_day` — editable (popup). */
  ffNameByDay: string;
  /** `version` — optimistic lock của item. */
  version: number;
}

/**
 * Metadata đơn Mera (nguồn: `orders`, xem §2 order-api-v2.md).
 * Chỉ `note` là editable ở panel (order-level). `version` riêng của order.
 */
export interface MeraOrderSummary {
  /** `order_id` (vd `DAV-3999799511`). */
  orderId: string;
  /** `store`. */
  store: string;
  /** `note` — editable (order-level). */
  note: string;
  /** `is_split_items` — điều kiện PATCH item; auto-split khi cần. */
  isSplitItems: boolean;
  /** `items_count`. */
  itemsCount: number;
  /** `version` — optimistic lock của order. */
  version: number;
  /** `customer.name`. */
  customerName: string;
}

/** Lý do resolve không có kết quả (soft, để UI hiển thị thông điệp phù hợp). */
export type MeraResolveReason = "not_found" | "not_configured" | null;

/**
 * Kết quả resolve 1 đơn trên Mera.
 * - `order === null && reason === "not_found"`: không có đơn khớp trên Mera.
 * - `reason === "not_configured"`: thiếu env MERA_* (soft, KHÔNG throw) → flow Sheet vẫn chạy.
 * - `order !== null && reason === null`: có đơn; `items` là danh sách item của đơn.
 */
export interface ResolveMeraOrderResponse {
  order: MeraOrderSummary | null;
  items: MeraOrderItem[];
  reason: MeraResolveReason;
}

// ---- Update contract (POST /api/mera/update) ----

/**
 * Các field item được phép sửa (camelCase). Whitelist ở service; client chỉ gửi field dirty.
 * Mọi giá trị là string (khớp draft của form); service tự ép kiểu:
 * - `quantity` → số nguyên (bỏ qua nếu parse hỏng).
 * - `trackingCode/trackingCarrier/trackingUrl` → gộp thành object `tracking` (client
 *   gửi CẢ 3 khi có 1 field tracking dirty, vì Mera thay nguyên object).
 */
export interface MeraItemUpdates {
  status?: string;
  personalization?: string;
  customerImage?: string;
  designLink?: string;
  mockupLink?: string;
  productName?: string;
  quantity?: string;
  price?: string;
  productType?: string;
  material?: string;
  trackingCode?: string;
  trackingCarrier?: string;
  trackingUrl?: string;
  fulfillmentCost?: string;
  ffNameByDay?: string;
}

/** Body cập nhật 1 item. */
export interface MeraUpdateItemRequest {
  target: "item";
  itemKey: string;
  version: number;
  updates: MeraItemUpdates;
}

/** Body cập nhật note order-level. */
export interface MeraUpdateOrderRequest {
  target: "order";
  orderId: string;
  version: number;
  note: string;
}

/** Discriminated union body của POST /api/mera/update (backend + frontend dùng chung). */
export type MeraUpdateRequest = MeraUpdateItemRequest | MeraUpdateOrderRequest;

/** Response khi target = "item". `splitApplied` true nếu server auto-bật split trước khi PATCH. */
export interface MeraUpdateItemResponse {
  item: MeraOrderItem;
  splitApplied?: boolean;
}

/** Response khi target = "order". */
export interface MeraUpdateOrderResponse {
  order: MeraOrderSummary;
}

/** Union response của POST /api/mera/update. */
export type MeraUpdateResponse = MeraUpdateItemResponse | MeraUpdateOrderResponse;

/**
 * Body lỗi 409 version_conflict — `latest` là object mới nhất (item hoặc order tuỳ target).
 * Frontend đọc `latest` để toast + refetch/remount (nhất quán pattern `expected` của Sheet).
 */
export interface MeraConflictBody {
  error: string;
  code: "version_conflict";
  latest: MeraOrderItem | MeraOrderSummary;
}

// ---- Hằng dùng chung UI ----

/**
 * Field item được phép sửa: `key` = khoá MeraOrderItem (camelCase),
 * `label` = TÊN field khớp đúng Sheet để tái dùng `FieldInput` (switch theo label:
 * "Personalization"/"Customer Image"/"Design"/"Mockup" → textarea + preview ảnh; "Status" → StatusSelect).
 */
export const MERA_EDITABLE_ITEM_FIELDS = [
  { key: "status", label: "Status" },
  { key: "personalization", label: "Personalization" },
  { key: "customerImage", label: "Customer Image" },
  { key: "designLink", label: "Design" },
  { key: "mockupLink", label: "Mockup" },
] as const satisfies ReadonlyArray<{ key: keyof MeraItemUpdates; label: string }>;

/**
 * TOÀN BỘ field item sửa được trong popup "sửa toàn bộ field" (mirror SheetRowDialog).
 * 5 field đầu trùng form nhanh (label khớp Sheet để FieldInput render đúng behavior);
 * phần còn lại là các field user-managed bổ sung của Mera (§5 order-api-v2.md).
 */
export const MERA_FULL_ITEM_FIELDS = [
  ...MERA_EDITABLE_ITEM_FIELDS,
  { key: "productName", label: "Product Name" },
  { key: "quantity", label: "Quantity" },
  { key: "price", label: "Price" },
  { key: "productType", label: "Product Type" },
  { key: "material", label: "Material" },
  { key: "trackingCode", label: "Tracking Code" },
  { key: "trackingCarrier", label: "Tracking Carrier" },
  { key: "trackingUrl", label: "Tracking URL" },
  { key: "fulfillmentCost", label: "Fulfillment Cost" },
  { key: "ffNameByDay", label: "FF Name By Day" },
] as const satisfies ReadonlyArray<{ key: keyof MeraItemUpdates; label: string }>;

/**
 * FALLBACK khi chưa fetch được status từ Mera (`useMeraStatuses` ↔ GET /api/mera/statuses
 * ↔ Mera GET /api/v1/statuses). Status trên Mera là CẤU HÌNH (collection `statuses`,
 * sửa được từ UI) nên luôn ưu tiên danh sách fetch động; list này chỉ dùng khi lỗi/thiếu env
 * (khớp DefaultStatuses seed của mera-fulfill-backend).
 * `StatusSelect` prepend giá trị hiện tại nếu lạ → không mất data khi status ngoài danh sách.
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
