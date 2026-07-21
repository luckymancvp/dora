# Nghiên cứu: Order Table Columns của Mera (cho vòng 2 — panel Mera động)

Yêu cầu user: panel Mera trong dora-1 render field theo cấu hình "Order Table Columns" của mera admin (per-project), thay vì danh sách field cứng. Note giờ dùng cấp item (`order_items.note`, field_key `item_note`).

## Endpoint lấy cấu hình cột

- **Qua fulfill/designer (proxy, KHUYẾN NGHỊ cho dora-1 vì dùng chung base + INTERNAL_API_KEY hiện có):**
  `GET <origin>/api/v1/projects/:projectId/order-table-columns` — fulfill proxy sang admin, forward nguyên Authorization header (`mera-fulfill-backend/internal/services/admin_service.go:305-312`). Lưu ý: MERA_API_BASE_URL của dora-1 đang là `.../api/v2` → phải derive origin (`new URL(base).origin`) rồi ghép `/api/v1/...`.
- Gọi thẳng admin: `GET https://api-admin.mera.pamoteam.top/api/projects/:id/order-table-columns` (KHÔNG có /v1) — không cần vì proxy đã có.
- **Auth:** cả 3 backend chấp nhận `Authorization: Bearer <INTERNAL_API_KEY>` (`is_internal=true`, bypass role checks). Admin/fulfill/designer dùng CÙNG key mỗi môi trường (đã xác nhận configs khớp).
- Field defs khả dụng: `GET /api/order-table-fields` (chỉ trên admin) → `{"fields":[{key,label,group}]}` — dora-1 không bắt buộc gọi.

## Shape response

```json
{ "columns": [ { "id": "...", "label": "...", "field_key": "...", "position": 0, "visible": true, "editable": true, "width": 120 } ] }
```
- `editable` là *bool nhưng backend normalize nil→true trước khi trả (`project_handler.go:218-222`). Semantic chuẩn (mera frontend): **hiện khi `visible !== false`, sửa được khi `editable !== false`**, sort theo `position` tăng dần, dedupe theo field_key.
- Project chưa cấu hình → `{"columns": []}` (mảng rỗng, không null, KHÔNG có default seed). dora-1 tự fallback danh sách mặc định.

## Danh sách field_key hợp lệ (order_table_fields.go, group = scope)

**Order:** `order_id`, `note` (= Order Note, order-level), `channel`, `store`, `vat_ioss`, `items_count`, `export_count`, `etsy_account`, `created_at`, `order_date`, `conversation_id`
**Customer:** `customer.name`, `customer.email` (buyer Etsy, KHÔNG phải người nhận)
**Pricing:** `pricing.subtotal`, `pricing.discount`, `pricing.total`, `pricing.currency`
**Item:** `item_key`, `status`, `item_note` (**= Item Note → item.note**), `provider`, `provider_history`, `material`, `designer.name`, `source_link`, `product_name`, `quantity`, `personalization`, `image_link`, `design_link`, `customer_image`, `mockup_link`, `price`, `product_type`, `fulfillment_cost`, `ff_name_by_day`, `tracking.code`, `tracking.carrier`, `tracking.url`, `shipping.name`, `shipping.street`, `shipping.city`, `shipping.state`, `shipping.zip_code`, `shipping.country`

## Resolve giá trị (bắt chước getValueByPath của mera frontend, OrderTable.tsx:296-330)

- `item_note` → `item.note`; dot-path resolve từ gốc theo scope: order-scope (`order_id, note, vat_ioss, channel, store, created_at, export_count, etsy_account, customer.*, pricing.*`) từ order; item-scope (`status, personalization, image_link, design_link, customer_image, mockup_link, tracking.*, shipping.*, product_name, quantity, price, product_type, material, designer.*, provider, fulfillment_cost, ff_name_by_day`) từ item; còn lại default order.

## PATCH-ability (validation.go của mera-shared)

- **Item user-managed (PATCH /api/v2/order-items/:key):** `status, note, provider, material, shipping, product_name, quantity, image_link, price, product_type, design_link, customer_image, mockup_link, tracking, personalization, designer, fulfillment_cost, ff_name_by_day`. `item.note` xác nhận có tại models.go:94 + validation.go:32.
- **Order user-managed (PATCH /api/v2/orders/:id):** `note, customer, pricing, channel, store, vat_ioss, etsy_account, export_count, is_split_items, is_deleted`.
- Field hiển thị được nhưng KHÔNG patch được (read-only trong dora-1): `order_id, item_key, items_count, created_at, order_date, conversation_id, provider_history, designer.name (patch phức tạp — để read-only), provider (list — read-only), source_link` — quy tắc: editable cuối = `column.editable !== false` AND fieldKey thuộc whitelist patch AND dora-1 hỗ trợ.
- Nested (`tracking.*`, `shipping.*`, `customer.*`, `pricing.*`): PATCH của Mera nhận NGUYÊN OBJECT — muốn sửa 1 subfield phải merge với object hiện tại rồi gửi cả object.
