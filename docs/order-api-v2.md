# Order API V2 — Designer & Fulfill Backends

Base URL:
- **Fulfill:** `https://mera-fulfill-api.pamoteam.top/api/v2`
- **Designer:** `https://mera-designer-api.pamoteam.top/api/v2`

API dùng chung (shared controller tại `mera-shared/pkg/orderhttp`) được expose bởi cả `mera-designer-backend` và `mera-fulfill-backend`.  
Yêu cầu authentication (JWT hoặc Internal API Key).

---

## Authentication

API hỗ trợ 2 cơ chế xác thực:

### 1. Internal API Key (dành cho hệ thống bên ngoài)

Không expire, bypass role checks. Phù hợp cho service-to-service.

**Cấu hình** — set env var ở designer/fulfill backend:
```
INTERNAL_API_KEY=<your-secret-key>
```

**Gọi API — không cần biết user:**
```bash
curl -H "Authorization: Bearer <your-secret-key>" \
  https://mera-fulfill-api.pamoteam.top/api/v2/orders
```

**Gọi API — kèm thông tin user để ghi audit:**
```bash
curl -H "Authorization: Bearer <your-secret-key>" \
     -H "X-Actor-Email: nguyen@company.com" \
  https://mera-fulfill-api.pamoteam.top/api/v2/orders
```

Khi có `X-Actor-Email`, audit log sẽ ghi đúng user thực hiện thay đổi. Nếu không truyền, mặc định ghi `"email": "internal-service"`.

> **Lưu ý:** `X-Actor-ID` không bắt buộc. Nếu gọi từ hệ thống bên ngoài không biết Mera user ID, chỉ cần truyền `X-Actor-Email` là đủ.

### 2. JWT (dành cho người dùng đăng nhập qua Google OAuth)

JWT được cấp sau khi user đăng nhập qua `mera-admin-backend`. Truyền qua header hoặc query param (cho SSE):

```bash
# Header
curl -H "Authorization: Bearer <jwt-token>" \
  https://mera-fulfill-api.pamoteam.top/api/v2/orders

# Query param (SSE EventSource)
GET /api/v2/orders?token=<jwt-token>
```

---

## Get Projects (v1)

```
GET /api/v1/projects
```

Lấy danh sách projects. Dùng để lấy `project_id` cho filter orders.

Endpoint này có trên cả 3 backend (admin, designer, fulfill). Ở designer và fulfill nó là proxy gọi về admin backend.

**Gọi qua fulfill backend:**

```bash
curl -H "Authorization: Bearer <INTERNAL_API_KEY>" \
     -H "X-Actor-Email: cuonglm@pamoteam.com" \
  https://mera-fulfill-api.pamoteam.top/api/v1/projects
```

- **JWT:** chỉ trả projects mà user là thành viên.
- **Internal API Key:** trả tất cả projects (không filter theo user).
- **`X-Actor-ID`:** không bắt buộc. Nếu gọi từ hệ thống bên ngoài, chỉ cần truyền `X-Actor-Email`.

### Response `200 OK`

```json
{
  "projects": [
    {
      "id": "64a1b2c3d4e5f6a7b8c9d0e1",
      "name": "DavShop",
      "team_member_ids": ["64a1b2c3d4e5f6a7b8c9d0e2"]
    }
  ]
}
```

Dùng `id` từ response này làm `project_id` khi gọi `GET /api/v2/orders?project_id=<id>`.

---

## Mục lục

0. [Authentication](#authentication)
1. [List Orders](#1-list-orders)
2. [Get Order](#2-get-order)
3. [Get Order Items](#3-get-order-items)
4. [Patch Order](#4-patch-order)
5. [Patch Item](#5-patch-item)
6. [Bulk Patch Items](#6-bulk-patch-items)
7. [Create Order](#7-create-order)
8. [Delete Order](#8-delete-order)
9. [Toggle Split Items](#9-toggle-split-items)
10. [Split Item By Quantity](#10-split-item-by-quantity)
11. [Get Distinct Stores](#11-get-distinct-stores)
12. [Get Order History](#12-get-order-history)
13. [Get Item History](#13-get-item-history)
14. [Order-Items Endpoints Summary](#14-order-items-endpoints-summary)
15. [Data Models](#data-models)
16. [Field Ownership](#field-ownership)
17. [Optimistic Locking](#optimistic-locking)
18. [Audit Trail](#audit-trail)
19. [Realtime Events](#realtime-events)

---

## 1. List Orders

```
GET /api/v2/orders
```

Trả về danh sách đơn hàng phân trang, hỗ trợ filter và search.

### Query Parameters

| Param | Type | Default | Mô tả |
|-------|------|---------|-------|
| `page` | int | `1` | Trang hiện tại |
| `page_size` | int | `50` | Số dòng/trang (max 500) |
| `channel` | string | — | Filter theo channel (`etsy`, `manual`, ...) |
| `status` | string | — | Filter theo 1 status (so sánh với items) |
| `statuses` | string[] | — | Filter theo nhiều status (`?statuses=NEW&statuses=DESIGNING`) |
| `store` | string | — | Filter theo tên store |
| `provider` | string | — | Filter theo provider (so sánh với items) |
| `designer` | string | — | Filter theo designer ID (so sánh với items) |
| `project_id` | string | — | Filter theo project ID |
| `q` | string | — | Full-text search (order_id, customer name/email, store, item_key) |
| `date_from` | string (`YYYY-MM-DD`) | — | Lọc đơn có `created_at >= date_from` (00:00:00 ngày đó, UTC) |
| `date_to` | string (`YYYY-MM-DD`) | — | Lọc đơn có `created_at <= date_to` (tự động đẩy về 23:59:59 cuối ngày, UTC) |
| `include_items` | string | `false` | Set `true` để kèm items trong mỗi order |

**Ghi chú filter theo thời gian:**
- Filter áp lên field `created_at` của order (thời điểm đơn được tạo trong hệ thống Mera, không phải `order_date` từ Etsy).
- Định dạng bắt buộc là `YYYY-MM-DD`. Giá trị sai định dạng sẽ bị bỏ qua (không trả lỗi).
- `date_to` được tự động cộng thêm 23h59m59s, nên `?date_from=2025-01-15&date_to=2025-01-15` sẽ trả về tất cả đơn trong ngày 15/01.
- Có thể dùng riêng lẻ: chỉ `date_from` (từ ngày X về sau) hoặc chỉ `date_to` (từ đầu đến ngày X).

**Ví dụ:**
```bash
# Đơn tạo trong tuần qua
curl -H "Authorization: Bearer $TOKEN" \
  "https://mera-fulfill-api.pamoteam.top/api/v2/orders?date_from=2026-05-30&date_to=2026-06-06"

# Kết hợp với status filter
curl -H "Authorization: Bearer $TOKEN" \
  "https://mera-fulfill-api.pamoteam.top/api/v2/orders?date_from=2026-06-01&statuses=NEW&statuses=DESIGNING"
```

### Response `200 OK`

```json
{
  "orders": [
    {
      "id": "683abc1234567890abcdef01",
      "order_id": "DAV-3999799511",
      "channel": "etsy",
      "shop_id": "12345",
      "etsy_account": "",
      "store": "DavShop",
      "project_id": "abc123",
      "note": "",
      "customer": { "name": "John Doe", "email": "john@example.com" },
      "pricing": {
        "currency": "USD",
        "subtotal": "25.00",
        "discount": "0.00",
        "total": "25.00"
      },
      "vat_ioss": "",
      "export_count": 0,
      "is_split_items": true,
      "is_deleted": false,
      "last_changed_fields": ["status"],
      "last_updated_source": "ingest",
      "version": 3,
      "created_at": "2025-01-15T10:30:00Z",
      "updated_at": "2025-01-16T08:00:00Z",
      "updated_by": "user@example.com",
      "order_date": "2025-01-15T10:30:00Z",
      "items_count": 2,
      "total_quantity": 5,
      "items": []
    }
  ],
  "total": 150,
  "page": 1,
  "page_size": 50,
  "total_pages": 3
}
```

---

## 2. Get Order

```
GET /api/v2/orders/:order_id
```

### Path Parameters

| Param | Mô tả |
|-------|-------|
| `order_id` | ID đơn hàng (vd: `DAV-3999799511`) |

### Response `200 OK`

Trả về object Order đầy đủ (xem [Data Models](#data-models)).

### Response `404 Not Found`

```json
{ "error": "order not found" }
```

---

## 3. Get Order Items

```
GET /api/v2/orders/:order_id/items
```

### Response `200 OK`

```json
{
  "items": [
    {
      "id": "683abc1234567890abcdef02",
      "item_key": "DAV-3999799511-4986531800",
      "order_id": "DAV-3999799511",
      "etsy_line_item_id": "4986531800",

      "status": "NEW",
      "provider": [],
      "material": "",
      "designer": { "id": "", "name": "" },

      "shipping": {
        "name": "John Doe",
        "street": "123 Main St",
        "city": "New York",
        "state": "NY",
        "zip_code": "10001",
        "country": "US"
      },

      "image_link": "https://...",
      "price": "12.50",
      "quantity": 1,
      "product_name": "Custom Necklace",
      "personalization": "Name: Jane",
      "product_type": "necklace",

      "design_link": "",
      "customer_image": "",
      "mockup_link": "",

      "tracking": { "code": "", "carrier": "", "url": "" },
      "fulfillment_cost": "",
      "ff_name_by_day": "",

      "version": 2,
      "created_at": "2025-01-15T10:30:00Z",
      "updated_at": "2025-01-16T08:00:00Z",
      "updated_by": "user@example.com"
    }
  ]
}
```

---

## 4. Patch Order

```
PATCH /api/v2/orders/:order_id
```

Sửa các field user-managed trên đơn hàng. Sử dụng [optimistic locking](#optimistic-locking) qua field `version`.

### Request Body

```json
{
  "version": 3,
  "note": "Updated from external system",
  "store": "NewStoreName"
}
```

**Bắt buộc:** `version` (integer) — phải khớp version hiện tại của order.

### Allowed Fields (User-Managed Order)

| Field | Type | Mô tả |
|-------|------|-------|
| `note` | string | Ghi chú |
| `customer` | object | `{ "name": "...", "email": "..." }` |
| `pricing` | object | `{ "currency": "...", "subtotal": "...", "discount": "...", "total": "..." }` |
| `channel` | string | Kênh bán hàng |
| `store` | string | Tên store |
| `vat_ioss` | string | VAT/IOSS |
| `etsy_account` | string | Tài khoản Etsy |
| `export_count` | int | Số lần export |
| `is_split_items` | bool | Bật/tắt split items |
| `is_deleted` | bool | Soft delete |

> **Không được phép** PATCH qua endpoint này: `provider`, `material`, `shipping`, `tracking`, `mockup_link`, `fulfillment_cost`, `ff_name_by_day` — các field này thuộc về `order_items`, dùng [Patch Item](#5-patch-item).

### Response `200 OK`

Trả về order đã cập nhật (version tăng 1).

### Response `400 Bad Request`

```json
{
  "error": "cannot modify source-managed or system fields",
  "rejected_fields": ["shipping"]
}
```

### Response `409 Conflict`

```json
{
  "error": "version_conflict",
  "latest": { /* order object mới nhất */ }
}
```

---

## 5. Patch Item

```
PATCH /api/v2/order-items/:item_key
```

Sửa 1 item trong đơn hàng. Yêu cầu order phải bật `is_split_items = true` hoặc order chỉ có 1 item.

### Request Body

```json
{
  "version": 2,
  "status": "DESIGNING",
  "design_link": "https://drive.google.com/...",
  "product_type": "necklace",
  "shipping": {
    "name": "Jane Doe",
    "street": "456 New St",
    "city": "Austin",
    "state": "TX",
    "zip_code": "78701",
    "country": "US"
  }
}
```

### Allowed Fields (User-Managed Item)

| Field | Type | Mô tả |
|-------|------|-------|
| `status` | string | Trạng thái item |
| `provider` | string | Nhà cung cấp |
| `material` | string | Chất liệu |
| `shipping` | object | Địa chỉ giao hàng riêng của item |
| `product_name` | string | Tên sản phẩm |
| `quantity` | int | Số lượng |
| `image_link` | string | Link ảnh |
| `price` | string | Giá item |
| `product_type` | string | Loại sản phẩm |
| `design_link` | string | Link design |
| `customer_image` | string | Ảnh khách hàng |
| `mockup_link` | string | Link mockup |
| `tracking` | object | `{ "code": "...", "carrier": "...", "url": "..." }` |
| `personalization` | string | Personalization |
| `designer` | object | `{ "id": "...", "name": "..." }` |
| `fulfillment_cost` | string | Chi phí fulfillment |
| `ff_name_by_day` | string | FF name by day |

### Response `200 OK`

Trả về item đã cập nhật.

### Response `400 Bad Request` — Split chưa bật

```json
{
  "error": "ITEM_EDIT_REQUIRES_SPLIT",
  "message": "enable split items on the order before editing individual items"
}
```

### Response `409 Conflict`

```json
{
  "error": "version_conflict",
  "latest": { /* item object mới nhất */ }
}
```

---

## 6. Bulk Patch Items

```
PATCH /api/v2/orders/:order_id/items/bulk
```

Sửa cùng 1 bộ field cho nhiều items trong 1 order (transaction).

### Request Body

```json
{
  "item_keys": [
    "DAV-3999799511-4986531800",
    "DAV-3999799511-4986531801"
  ],
  "fields": {
    "status": "CONFIRMED",
    "provider": "ProviderB"
  }
}
```

**Lưu ý:** `fields` phải nằm trong danh sách [Allowed Item Fields](#allowed-fields-user-managed-item).

### Response `200 OK`

```json
{
  "items": [ /* danh sách items đã cập nhật */ ]
}
```

### Response `400 Bad Request`

```json
{ "error": "some item_keys not found in this order", "missing": ["..."] }
```

### Response `409 Conflict`

```json
{
  "error": "version_conflict",
  "items": [ /* items mới nhất */ ]
}
```

---

## 7. Create Order

```
POST /api/v2/orders
```

Tạo đơn hàng mới (manual order).

### Request Body

```json
{
  "order_id": "",
  "channel": "manual",
  "store": "MyStore",
  "note": "Manual order",
  "customer": {
    "name": "Customer Name",
    "email": "customer@example.com"
  },
  "shipping": {
    "name": "Customer Name",
    "street": "123 Street",
    "city": "City",
    "state": "State",
    "zip_code": "12345",
    "country": "US"
  },
  "pricing": {
    "currency": "USD",
    "subtotal": "50.00",
    "discount": "0.00",
    "total": "50.00"
  },
  "items": [
    {
      "product_name": "Custom Ring",
      "quantity": 2,
      "personalization": "Size 7",
      "image_link": "https://..."
    }
  ]
}
```

- Nếu `order_id` rỗng → tự sinh `manual-<uuid>`.
- Nếu `channel` rỗng → mặc định `manual`.
- `is_split_items` tự bật nếu có > 1 item.
- Mỗi item nếu không có `item_key` → tự sinh `<order_id>-<random>`.
- `shipping` trong request được copy vào tất cả items được tạo.

### Response `201 Created`

```json
{
  "order": { /* order object */ },
  "items": [ /* item objects, mỗi item có shipping đã được copy */ ]
}
```

---

## 8. Delete Order

```
DELETE /api/v2/orders/:order_id
```

Soft delete — set `is_deleted = true`, không xóa khỏi DB.

### Response `200 OK`

```json
{ "message": "order deleted" }
```

### Response `404 Not Found`

```json
{ "error": "order not found" }
```

---

## 9. Toggle Split Items

```
POST /api/v2/orders/:order_id/split
```

Bật/tắt chế độ split items cho order.

- **ON (`split: true`):** Set `is_split_items = true`. Sau đó có thể PATCH từng item riêng (status, provider, material, shipping, ...).
- **OFF (`split: false`):** Set `is_split_items = false`. Item data không đổi, chỉ ảnh hưởng đến điều kiện cho phép PATCH item.

### Request Body

```json
{ "split": true }
```

### Response `200 OK`

```json
{
  "order": { /* order đã cập nhật */ },
  "items": [ /* danh sách items */ ]
}
```

---

## 10. Split Item By Quantity

```
POST /api/v2/orders/:order_id/items/:item_key/split-quantity
```

Tách 1 item có `quantity > 1` thành N items riêng biệt (mỗi item quantity = 1).

### Request Body

```json
{
  "personalizations": ["Name: Jane", "Name: John", "Name: Alice"]
}
```

- Số phần tử `personalizations` phải bằng `quantity` hiện tại của item.
- Item gốc giữ nguyên `item_key`, các item mới có suffix `-1`, `-2`, ...
- Mỗi item mới kế thừa `shipping` từ item gốc.

### Response `200 OK`

```json
{
  "items": [ /* tất cả items sau khi split */ ]
}
```

### Response `400 Bad Request`

```json
{ "error": "item quantity must be > 1 to split" }
```

---

## 11. Get Distinct Stores

```
GET /api/v2/orders/stores
```

Trả về danh sách tên store duy nhất từ các order active.

### Response `200 OK`

```json
{
  "stores": ["DavShop", "MyStore", "AnotherShop"]
}
```

---

## 12. Get Order History

```
GET /api/v2/orders/:order_id/history
```

Trả về lịch sử thay đổi (audit trail) của 1 order.

### Query Parameters

| Param | Type | Default | Mô tả |
|-------|------|---------|-------|
| `field` | string | — | Filter theo field cụ thể (vd: `note`) |
| `include_items` | string | `false` | Kèm audit events của items |
| `limit` | int | `50` | Số events tối đa |
| `cursor` | string | — | Cursor cho pagination |

### Response `200 OK`

```json
{
  "events": [
    {
      "id": "evt_abc123",
      "entity_type": "order",
      "entity_id": "DAV-3999799511",
      "order_id": "DAV-3999799511",
      "action": "update",
      "changes": [
        { "path": "note", "from": "", "to": "Rush order" }
      ],
      "actor": { "type": "user", "id": "user123", "email": "user@example.com" },
      "meta": { "source": "admin-api", "request_id": "..." },
      "at": "2025-01-16T08:00:00Z",
      "version_before": 2,
      "version_after": 3
    }
  ],
  "next_cursor": "..."
}
```

---

## 13. Get Item History

```
GET /api/v2/order-items/:item_key/history
```

Trả về lịch sử thay đổi của 1 item.

### Query Parameters

| Param | Type | Default | Mô tả |
|-------|------|---------|-------|
| `field` | string | — | Filter theo field |
| `limit` | int | `50` | Số events tối đa |
| `cursor` | string | — | Cursor cho pagination |

### Response `200 OK`

Cấu trúc giống [Order History](#12-get-order-history) nhưng `entity_type = "order_item"`.

---

## 14. Order-Items Endpoints Summary

Tổng hợp các endpoint thao tác trực tiếp trên item thông qua `item_key` (không cần biết `order_id`).

### Route prefix

```
/api/v2/order-items/:item_key
```

`item_key` có format: `<order_id>-<line_item_id>`, ví dụ: `DAT-4019091621-5021368067`.

### Danh sách endpoints

| Method | Path | Mô tả | Section |
|--------|------|-------|---------|
| `PATCH` | `/api/v2/order-items/:item_key` | Sửa 1 item | [§5](#5-patch-item) |
| `GET` | `/api/v2/order-items/:item_key/history` | Lịch sử thay đổi item | [§13](#13-get-item-history) |

> **Lưu ý:** Hiện tại **không có** endpoint `GET /api/v2/order-items/:item_key` để lấy thông tin 1 item đơn lẻ.  
> Để đọc thông tin item, sử dụng `GET /api/v2/orders/:order_id/items` ([§3](#3-get-order-items)) rồi filter theo `item_key` phía client, hoặc dùng `GET /api/v2/orders/:order_id?include_items=true`.

### Ví dụ sử dụng

#### Patch item `DAT-4019091621-5021368067`

```bash
curl -X PATCH http://localhost:8080/api/v2/order-items/DAT-4019091621-5021368067 \
  -H "Content-Type: application/json" \
  -d '{
    "version": 2,
    "status": "DESIGNING",
    "design_link": "https://drive.google.com/file/d/xxx",
    "product_type": "necklace",
    "tracking": { "code": "1Z999AA10123456784", "carrier": "UPS", "url": "" }
  }'
```

Response `200 OK`:

```json
{
  "id": "683abc1234567890abcdef02",
  "item_key": "DAT-4019091621-5021368067",
  "order_id": "DAT-4019091621",
  "etsy_line_item_id": "5021368067",

  "status": "DESIGNING",
  "provider": [],
  "material": "",
  "designer": { "id": "", "name": "" },

  "shipping": {
    "name": "Anna Smith",
    "street": "789 Oak Ave",
    "city": "Portland",
    "state": "OR",
    "zip_code": "97201",
    "country": "US"
  },

  "image_link": "https://...",
  "price": "15.00",
  "quantity": 1,
  "product_name": "Custom Pendant",
  "personalization": "Name: Anna",
  "product_type": "necklace",

  "design_link": "https://drive.google.com/file/d/xxx",
  "customer_image": "",
  "mockup_link": "",

  "tracking": { "code": "1Z999AA10123456784", "carrier": "UPS", "url": "" },
  "fulfillment_cost": "",
  "ff_name_by_day": "",

  "version": 3,
  "created_at": "2025-06-01T10:00:00Z",
  "updated_at": "2025-06-02T14:30:00Z",
  "updated_by": "user@example.com"
}
```

#### Xem lịch sử item `DAT-4019091621-5021368067`

```bash
curl http://localhost:8080/api/v2/order-items/DAT-4019091621-5021368067/history?field=status&limit=10
```

Response `200 OK`:

```json
{
  "events": [
    {
      "id": "evt_xyz789",
      "entity_type": "order_item",
      "entity_id": "DAT-4019091621-5021368067",
      "order_id": "DAT-4019091621",
      "action": "update",
      "changes": [
        { "path": "status", "from": "NEW", "to": "DESIGNING" }
      ],
      "actor": { "type": "system", "id": "", "email": "" },
      "meta": { "source": "admin-api", "request_id": "..." },
      "at": "2025-06-02T14:30:00Z",
      "version_before": 2,
      "version_after": 3
    }
  ],
  "next_cursor": ""
}
```

### Điều kiện chỉnh sửa item

Để PATCH 1 item, order cha phải thỏa 1 trong 2 điều kiện:

1. `is_split_items = true` trên order, **hoặc**
2. Order chỉ có đúng 1 item (effective count = 1, không tính items đã bị xóa/ẩn)

Nếu không thỏa → trả `400`:

```json
{
  "error": "ITEM_EDIT_REQUIRES_SPLIT",
  "message": "enable split items on the order before editing individual items"
}
```

### Lấy thông tin item đơn lẻ (workaround)

Vì chưa có `GET /api/v2/order-items/:item_key`, để lấy thông tin item `DAT-4019091621-5021368067`:

```bash
# Lấy tất cả items của order DAT-4019091621, filter phía client
curl http://localhost:8080/api/v2/orders/DAT-4019091621/items
```

Từ response, tìm object có `"item_key": "DAT-4019091621-5021368067"`.

---

## Data Models

### Order

`orders` collection chỉ lưu metadata đơn hàng, thông tin khách hàng, pricing, và flags. Các trường vận hành theo từng item (shipping, tracking, provider, ...) nằm ở `order_items`.

```json
{
  "id": "MongoDB ObjectID",
  "order_id": "DAV-3999799511",
  "channel": "etsy",
  "shop_id": "12345",
  "etsy_account": "",
  "store": "DavShop",
  "project_id": "abc123",

  "note": "",
  "customer": { "name": "John Doe", "email": "john@example.com" },
  "pricing": {
    "currency": "USD",
    "subtotal": "25.00",
    "discount": "0.00",
    "total": "25.00"
  },
  "vat_ioss": "",

  "export_count": 0,
  "is_split_items": false,

  "is_deleted": false,
  "deleted_at": null,
  "deleted_by": "",

  "last_changed_fields": ["note"],
  "last_updated_source": "admin-api",

  "version": 3,
  "created_at": "2025-01-15T10:30:00Z",
  "updated_at": "2025-01-16T08:00:00Z",
  "updated_by": "user@example.com",
  "order_date": "2025-01-15T10:30:00Z"
}
```

### OrderItem

Mỗi item lưu đầy đủ thông tin vận hành, bao gồm **shipping riêng**. Khi ingest, shipping được copy từ địa chỉ giao hàng của order nguồn (Etsy). Sau đó có thể sửa shipping từng item độc lập.

```json
{
  "id": "MongoDB ObjectID",
  "item_key": "DAV-3999799511-4986531800",
  "order_id": "DAV-3999799511",
  "etsy_line_item_id": "4986531800",

  "status": "NEW",
  "provider": [
    { "provider": "ProviderA", "exported_at": "2025-01-20T08:00:00Z", "user_email": "user@example.com" }
  ],
  "material": "",
  "designer": { "id": "", "name": "" },

  "shipping": {
    "name": "John Doe",
    "street": "123 Main St",
    "city": "New York",
    "state": "NY",
    "zip_code": "10001",
    "country": "US"
  },

  "image_link": "https://...",
  "price": "12.50",
  "quantity": 1,
  "product_name": "Custom Necklace",
  "personalization": "Name: Jane",
  "product_type": "necklace",

  "design_link": "",
  "customer_image": "",
  "mockup_link": "",

  "tracking": { "code": "", "carrier": "", "url": "" },
  "fulfillment_cost": "",
  "ff_name_by_day": "",

  "version": 2,
  "created_at": "2025-01-15T10:30:00Z",
  "updated_at": "2025-01-16T08:00:00Z",
  "updated_by": "user@example.com"
}
```

---

## Field Ownership

Hệ thống phân biệt 2 loại field:

### Source-Managed Fields (Order)

Các field này được quản lý bởi nguồn dữ liệu (Dora extension, Gmail sync, Etsy API). Khi ingest, chỉ các field này bị ghi đè:

`order_id`, `channel`, `shop_id`, `etsy_account`, `store`, `customer`, `pricing`, `vat_ioss`, `created_at`, `project_id`, `order_date`

### User-Managed Fields (Order)

Các field user/system bên ngoài được phép PATCH qua `PATCH /api/v2/orders/:order_id`:

`note`, `customer`, `pricing`, `channel`, `store`, `vat_ioss`, `etsy_account`, `export_count`, `is_split_items`, `is_deleted`

> `customer` và `pricing` nằm ở cả 2 nhóm — ingest ghi đè, nhưng user cũng có thể sửa (cho manual orders hoặc corrections).

### Source-Managed Fields (OrderItem)

Khi ingest cập nhật item, chỉ các field sau bị ghi đè:

`item_key`, `order_id`, `etsy_line_item_id`, `product_name`, `personalization`, `quantity`, `image_link`, `price`

Khi **tạo mới** item từ ingest, `shipping` được set từ địa chỉ giao hàng của order nguồn. Sau đó shipping là user-managed (không bị overwrite khi ingest update lại).

### User-Managed Fields (OrderItem)

Các field được phép PATCH qua `PATCH /api/v2/order-items/:item_key`:

`status`, `provider`, `material`, `shipping`, `product_name`, `quantity`, `image_link`, `price`, `product_type`, `design_link`, `customer_image`, `mockup_link`, `tracking`, `personalization`, `designer`, `fulfillment_cost`, `ff_name_by_day`

### System Fields (không thể PATCH)

`version`, `created_at`, `updated_at`, `updated_by`, `id`, `_id` — tự động quản lý bởi hệ thống.

---

## Optimistic Locking

Mọi PATCH request đều yêu cầu field `version` trong body. Giá trị phải khớp với version hiện tại của document trong DB.

**Flow:**

1. Client GET order → nhận `version: 3`
2. Client PATCH với `{ "version": 3, "note": "updated" }`
3. Server kiểm tra version khớp → cập nhật, tăng version lên 4
4. Nếu version không khớp (ai đó đã sửa trước) → trả `409 Conflict` kèm object mới nhất

```
409 Conflict
{
  "error": "version_conflict",
  "latest": { /* object mới nhất với version hiện tại */ }
}
```

Client nên retry: đọc `latest`, merge changes, gửi lại PATCH với version mới.

---

## Audit Trail

Mọi thay đổi qua API đều được ghi audit event vào collection `audit_events` trong database `mera_orders`.

### Audit Event Structure

```json
{
  "id": "evt_...",
  "entity_type": "order",
  "entity_id": "DAV-3999799511",
  "order_id": "DAV-3999799511",
  "action": "update",
  "changes": [
    { "path": "note", "from": "", "to": "Rush order" }
  ],
  "actor": { "type": "user", "id": "user-123", "email": "nguyen@company.com" },
  "meta": {
    "source": "designer-web",
    "request_id": "...",
    "ip": "192.168.1.1",
    "user_agent": "MySystem/1.0"
  },
  "at": "2025-01-16T08:00:00Z",
  "version_before": 2,
  "version_after": 3
}
```

### Actor theo cơ chế xác thực

| Cơ chế | `actor.id` | `actor.email` |
|--------|-----------|---------------|
| JWT (Google login) | MongoDB ObjectID của user | email Google |
| Internal API Key + `X-Actor-*` headers | giá trị `X-Actor-ID` | giá trị `X-Actor-Email` |
| Internal API Key không có headers | `""` | `"internal-service"` |

### Action Types

| Action | Mô tả |
|--------|-------|
| `create` | Tạo order mới |
| `update` | Sửa order/item |
| `bulk_update` | Sửa nhiều items cùng lúc |
| `soft_delete` | Xóa mềm |
| `split_on` | Bật split items |
| `split_off` | Tắt split items |
| `ingest_created` | Tạo từ ingest (Dora/Gmail/Etsy API) |
| `ingest_updated` | Cập nhật từ ingest |

### Source

Với API v2 trên admin backend, `meta.source` = `"admin-api"`.

---

## Realtime Events

Khi order/item thay đổi qua API, hệ thống broadcast SSE event tới Designer và Fulfill backends (nếu đã cấu hình `DESIGNER_BACKEND_URL` / `FULFILL_BACKEND_URL`).

### Event Types

| Event | Trigger |
|-------|---------|
| `entity.created` | Tạo order mới |
| `entity.updated` | Sửa order hoặc item |
| `entity.deleted` | Soft delete order |
| `entity.bulk_updated` | Bulk patch items |
| `entity.split_changed` | Toggle split |

### Event Payload

```json
{
  "type": "entity.updated",
  "entity_type": "order_item",
  "entity_id": "DAV-3999799511-4986531800",
  "order_id": "DAV-3999799511",
  "version": 4,
  "changed_fields": ["status", "tracking"],
  "updated_at": "2025-01-16T08:00:00Z",
  "item_keys": ["DAV-3999799511-4986531800"]
}
```

---

## Error Codes

| HTTP Status | Mô tả |
|-------------|-------|
| `200` | Thành công |
| `201` | Tạo thành công |
| `400` | Request không hợp lệ (thiếu version, field không được phép, ...) |
| `404` | Order/Item không tìm thấy |
| `409` | Version conflict (optimistic locking) |
| `500` | Lỗi server |

### Lỗi thường gặp

```json
// Thiếu version
{ "error": "version (integer) is required" }

// Field không được phép sửa (gửi shipping/tracking/provider lên order endpoint)
{ "error": "cannot modify source-managed or system fields", "rejected_fields": ["shipping"] }

// Không có field nào để update
{ "error": "no fields to update" }

// Chưa bật split mà sửa item
{ "error": "ITEM_EDIT_REQUIRES_SPLIT", "message": "enable split items on the order before editing individual items" }

// Item không thuộc order
{ "error": "some item_keys not found in this order", "missing": ["..."] }
```
