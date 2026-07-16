# 02 — Backend changes: search nâng cao trong getOrders

## File sửa
- `lib/services/orders-read.ts` — hàm `getOrders`, block `if (search)` (~line 273-286).

Không đụng: route, type, projection (`LIST_PROJECTION` đã có `"data.transactions": 1`), hook.

## Logic mới
1. Giữ 2 clause regex `buyer.name` / `buyer.username` (không đổi).
2. Trích dãy số liền cuối query bằng `search.match(/(\d+)\s*$/)` để bỏ prefix chữ
   (vd `TEST-2914171501` → `2914171501`). Fallback `Number(search)` nếu không khớp regex.
3. Guard `Number.isFinite(asNum)` — chỉ push clause số khi hợp lệ, tránh `NaN`.
4. Khi hợp lệ, push cùng lúc 2 clause số:
   - `{ "data.order_id": asNum }` (đơn theo order ID)
   - `{ "data.transactions.transaction_id": asNum }` (Mongo tự dò array-of-subdoc bằng
     equality, KHÔNG dùng `$elemMatch` vì chỉ 1 điều kiện).

## Shape `$or` cuối cùng (khi query có số hợp lệ)
```js
{ $or: [
  { "data.buyer.name":     { $regex: search, $options: "i" } },
  { "data.buyer.username": { $regex: search, $options: "i" } },
  { "data.order_id": <num> },
  { "data.transactions.transaction_id": <num> },
] }
```
Khi query thuần chữ (không có số cuối): chỉ 2 clause regex.

## Ví dụ query match
| Query người dùng gõ | `asNum` | Kết quả |
|---------------------|---------|---------|
| `TEST-2914171501`   | 2914171501 | match `data.order_id` = 2914171501 hoặc transaction_id = 2914171501 |
| `2914171501`        | 2914171501 | như trên |
| `3891234567` (transactionId) | 3891234567 | match đơn chứa transaction có `transaction_id` = 3891234567 |
| `John`              | NaN → không push | chỉ regex buyer.name/username |
| `#2914171501`       | 2914171501 | regex số cuối vẫn bắt được |

## Kiểm tra type
`npx tsc --noEmit`: file `orders-read.ts` sạch. Lỗi duy nhất còn lại thuộc
`components/orders/OrderCard.tsx` (`OrderItemRow` — việc đang làm của frontend-engineer),
không liên quan backend.

---

# Vòng 2 — Cập nhật Mera ĐỘNG (Order Table Columns)

## File sửa
- `lib/services/mera-order.ts` — rewrite: fetch columns per-project, resolve `values`, update theo fieldKey.
- `app/api/mera/update/route.ts` — validate body `MeraUpdateRequest` unified (bỏ union `target`).
- `app/api/mera/resolve/route.ts` — KHÔNG đổi (pass-through, giờ trả thêm `columns`).
- `app/api/mera/statuses/route.ts` — KHÔNG đổi.

## Endpoints / shape
| Method | Path | Query/Body | Trả về |
|--------|------|-----------|--------|
| GET | `/api/mera/resolve` | `?store=&receiptId=` | `ResolveMeraOrderResponse { order, items[], columns[], reason }` |
| POST | `/api/mera/update` | `MeraUpdateRequest { updates, itemKey?, itemVersion?, orderId, orderVersion }` | `MeraUpdateResponse { item\|null, order\|null, splitApplied? }` |
| GET | `/api/mera/statuses` | — | `{ statuses: string[] }` |

## Fetch columns (fetchMeraColumns)
- `GET <origin>/api/v1/projects/:projectId/order-table-columns`, Bearer `MERA_INTERNAL_API_KEY` + `X-Actor-Email`.
- origin = `meraConfig()` đã strip `/api/v2` khỏi `MERA_API_BASE_URL` (giống getMeraStatuses dùng `/api/v1/statuses`). Không ghép thẳng vào base v2.
- Fallback `MERA_DEFAULT_COLUMNS` khi: `projectId` rỗng | status !== 200 | `{"columns":[]}` | lỗi/timeout (try/catch nuốt lỗi — KHÔNG fail resolve).

## Chuẩn hoá columns (normalizeColumns)
- Lọc `visible !== false`; bỏ `field_key` ngoài danh sách hợp lệ (order-scope keys ∪ `MERA_ITEM_FIELD_KEYS_ALL`); dedupe `fieldKey`; sort `position` tăng.
- `scope` = `MERA_ORDER_SCOPE_FIELD_KEYS.includes(fieldKey) ? "order" : "item"`.
- `editable = (config.editable !== false) AND fieldKey ∈ whitelist(scope)` (whitelist item = `MERA_EDITABLE_ITEM_FIELD_KEYS`, order = `MERA_EDITABLE_ORDER_FIELD_KEYS`).

## Resolve values (buildValues + resolveFieldValue)
- Chỉ resolve fieldKey CÓ trong columns đúng scope; luôn kèm `item_note` (item) / `note` (order).
- `item_note` → `item.note` (path `note`). Dot-path khác resolve bằng `getPath` (`tracking.code`, `customer.name`, `pricing.total`…).
- `provider_history` (mảng) → join `"provider - date - email"` mỗi dòng.
- Date ISO giữ nguyên string (client format). number/boolean → `String()`. null/object → `""`.

## Update — mapping fieldKey → PATCH body
- Tách `updates` theo scope; có field item-scope ⇒ cần `itemKey`+`itemVersion`; order-scope ⇒ cần `orderId`+`orderVersion`.
- **Item-scope** PATCH `/api/v2/order-items/:key` (kèm `version=itemVersion`):
  - `item_note` → field `note`; `quantity` ép int ≥0; scalar khác: field name = fieldKey (đã snake_case).
  - nested `tracking.*`/`shipping.*` → fetch item MỚI NHẤT (`GET /order-items/:key`), merge subfield vào object hiện tại, PATCH nguyên object (D7).
  - Giữ auto-split: 400 `ITEM_EDIT_REQUIRES_SPLIT` → `POST /orders/:id/split {split:true}` → retry 1 lần, `splitApplied=true`.
- **Order-scope** PATCH `/api/v2/orders/:id` (kèm `version=orderVersion`):
  - `export_count` ép int ≥0; scalar khác field name = fieldKey.
  - nested `customer.*`/`pricing.*` → fetch order MỚI NHẤT, merge, PATCH nguyên object.
- Response: scope không đổi = `null`. 409 ở scope nào → throw `version_conflict` với `latest` = object scope đó (item hoặc order). Status seam giữ nguyên: 400/409/502/503.

## Quy tắc editable (chốt)
`editable = config.editable(≠false) AND fieldKey ∈ whitelist(scope)`. Read-only kể cả khi admin bật: `order_id, item_key, items_count, created_at, order_date, conversation_id, provider, provider_history, designer.*, source_link` (không thuộc whitelist).

## Xác nhận giả định
- `project_id` đọc từ payload order Mera qua `firstString(raw, ["project_id","projectId","project.id"])` (alias phòng payload lệch). Nếu Mera KHÔNG trả → `projectId=""` → fallback `MERA_DEFAULT_COLUMNS` (panel vẫn chạy).

## Kiểm tra type
`npx tsc --noEmit` — EXIT 0, sạch toàn repo (backend + frontend đã đồng bộ type contract vòng 2).
