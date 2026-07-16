# 06 — Architect Contract v2: Panel Mera field ĐỘNG (Order Table Columns) + Item Note

> Vòng 2. Nguồn sự thật khảo sát: `_workspace/05_mera_columns_research.md`. Diff so với vòng 1 (`01_architect_contract.md` + `lib/types/mera.ts` cũ). CHỈ sửa `lib/types/mera.ts` (đã xong) + doc này. KHÔNG code service/route/component ở bước architect.

## 0. Quyết định lớn (chốt)

| # | Vấn đề | Quyết định |
|---|--------|-----------|
| D1 | Chuẩn hoá columns ở đâu | **Server**. `resolveMeraOrder` trả `columns` đã: lọc `visible!==false`, sort `position` tăng, dedupe `fieldKey`, và `editable` = giá trị CUỐI (`config.editable!==false` AND fieldKey ∈ whitelist patch của scope AND dora-1 hỗ trợ). Client render "câm" theo `editable`, KHÔNG tự tính. |
| D2 | Chở giá trị field động | Thêm `values: Record<fieldKey,string>` cho `MeraOrderItem` (item-scope) và `MeraOrderSummary` (order-scope). Giá trị đã resolve về string hiển thị (nested dot-path; `item_note`→`item.note`). |
| D3 | Field typed giữ lại | Item: `itemKey, orderId, version` (structural), `note` (=item_note, trọng tâm vòng 2), `imageLink` (thumbnail read-only). Order: `orderId, projectId, store, note, isSplitItems, itemsCount, version, customerName`. Các field khác (status, personalization, tracking, price…) CHUYỂN vào `values` — bỏ typed cứng. |
| D4 | Update request | **Bỏ discriminated union `target`**. Dùng 1 body `MeraUpdateRequest` với `updates: Record<fieldKey,string>` trộn cả 2 scope. Server tách scope, map fieldKey→PATCH body. Có field item-scope ⇒ cần `itemKey`+`itemVersion`; có field order-scope ⇒ cần `orderId`+`orderVersion`. |
| D5 | Fallback columns | `MERA_DEFAULT_COLUMNS` (8 cột) khi `order.projectId` rỗng hoặc admin trả `{"columns":[]}`. Gồm: status, note(order), item_note, personalization, customer_image, design_link, mockup_link (editable) + tracking.code (read-only). |
| D6 | Migration type cũ | XOÁ `MeraItemUpdates`, `MERA_EDITABLE_ITEM_FIELDS`, `MERA_FULL_ITEM_FIELDS`, `MeraUpdateItemRequest/Response`, `MeraUpdateOrderRequest/Response`, `MeraUpdateRequest` (union cũ). Thay bằng `MeraColumn`, `MERA_DEFAULT_COLUMNS`, `MERA_*_FIELD_KEYS`, `MeraUpdateRequest/Response` mới. Giữ `MeraTracking`, `MeraResolveReason`, `MeraConflictBody`, `MERA_STATUS_OPTIONS`. |
| D7 | Nested fieldKey | `tracking.*`, `shipping.*` (item), `customer.*`, `pricing.*` (order): PATCH Mera nhận NGUYÊN object → server **fetch item/order mới trước khi PATCH**, merge subfield đổi vào object hiện tại, gửi cả object. |
| D8 | item_note → note | fieldKey `item_note` map sang PATCH body field `note` của `PATCH /api/v2/order-items/:key`. Đây là trọng tâm vòng 2 (Note giờ ở cấp item). |

## 1. Type contract mới (đã ghi `lib/types/mera.ts`)

### 1.1 Thêm mới
- `MeraColumn { id, label, fieldKey, scope: "order"|"item", position, visible, editable }` — DTO cột đã chuẩn hoá.
- `MERA_DEFAULT_COLUMNS: MeraColumn[]` — fallback 8 cột.
- `MERA_ORDER_SCOPE_FIELD_KEYS`, `MERA_EDITABLE_ITEM_FIELD_KEYS`, `MERA_EDITABLE_ORDER_FIELD_KEYS` — **server import** để phân scope + tính editable (single source of truth). Frontend không cần import.

### 1.2 Sửa
- `ResolveMeraOrderResponse` **+ `columns: MeraColumn[]`** (đứng cạnh `order/items/reason`).
- `MeraOrderItem`: bỏ `status/personalization/customerImage/designLink/mockupLink/tracking/productName/quantity/price/productType/material/fulfillmentCost/ffNameByDay`; **thêm `note`, `values`**; giữ `itemKey/orderId/imageLink/version`.
- `MeraOrderSummary`: **thêm `projectId`, `values`**; giữ phần còn lại.
- `MeraUpdateRequest` = `{ updates, itemKey?, itemVersion?, orderId, orderVersion }`.
- `MeraUpdateResponse` = `{ item: MeraOrderItem|null, order: MeraOrderSummary|null, splitApplied? }`.

### 1.3 Giữ nguyên
`MeraTracking`, `MeraResolveReason`, `MeraConflictBody` (latest vẫn union item|order), `MERA_STATUS_OPTIONS`.

## 2. Task backend (`backend-engineer`) — chỉ đụng `lib/services/mera-order.ts`, `app/api/mera/*`

| # | File | Việc |
|---|------|------|
| B1 | `mera-order.ts` `mapItem` | Trả shape mới: `itemKey/orderId/note(=item.note)/imageLink/version` + build `values`. `values` điền theo danh sách fieldKey item-scope của `columns` (nhận thêm tham số columns) — resolve nested dot-path (`getPath`), `item_note`→`item.note`, số → String(). Luôn kèm `item_note`. |
| B2 | `mera-order.ts` `mapOrder` | Thêm `projectId` (`firstString(raw,["project_id"])`) + `values` (fieldKey order-scope, luôn kèm `note`). |
| B3 | `mera-order.ts` **hàm mới** `fetchMeraColumns(projectId, actorEmail)` | Derive origin: `new URL(MERA_API_BASE_URL).origin` rồi `GET /api/v1/projects/:projectId/order-table-columns` (Bearer INTERNAL_API_KEY). Map `field_key→fieldKey`, phân `scope` bằng `MERA_ORDER_SCOPE_FIELD_KEYS`, lọc `visible!==false`, dedupe fieldKey, sort `position`, tính `editable = col.editable!==false && (scope==="order" ? MERA_EDITABLE_ORDER_FIELD_KEYS : MERA_EDITABLE_ITEM_FIELD_KEYS).includes(fieldKey)`. Rỗng/lỗi/projectId rỗng → `MERA_DEFAULT_COLUMNS`. **Lưu ý:** `meraConfig()` đang normalize bỏ `/api/v2`; columns ở `/api/v1/...` nên ghép path `/api/v1/projects/...` là đúng (base đã về origin). |
| B4 | `mera-order.ts` `resolveMeraOrder` | Sau khi chọn `order`: gọi `fetchMeraColumns(order.projectId)` → `columns`; truyền columns vào `mapItem`/`mapOrder` để resolve values đúng cột hiển thị. Trả `{ order, items, columns, reason:null }`. Nhánh soft/not_found trả `columns: []`. |
| B5 | `mera-order.ts` **thay** `updateMeraItem`/`updateMeraOrderNote` → `updateMeraOrder(opts)` | Nhận `MeraUpdateRequest` + actorEmail. Tách `updates` theo scope (dùng `MERA_ORDER_SCOPE_FIELD_KEYS`). **Item-scope**: build body từ fieldKey→field (item_note→note, dot nested gom theo parent tracking/shipping — fetch item hiện tại `GET /order-items/:key` merge object rồi PATCH kèm `itemVersion`; giữ nguyên logic 400 ITEM_EDIT_REQUIRES_SPLIT→split→retry). **Order-scope**: tương tự với `GET /orders/:id` merge customer/pricing → PATCH kèm `orderVersion`. Trả `{ item, order, splitApplied }`, phần scope không đổi = null. 409 ở scope nào → throw `version_conflict` với `latest` = object scope đó. |
| B6 | `app/api/mera/update/route.ts` | Đổi validate: body `MeraUpdateRequest` (updates là object không rỗng, orderId string, orderVersion number; nếu có key item-scope thì itemKey/itemVersion phải có). Gọi `updateMeraOrder`. Response `MeraUpdateResponse`. Shape endpoint (POST, json) KHÔNG đổi. |
| B7 | `app/api/mera/resolve/route.ts` | KHÔNG đổi (đã trả nguyên `ResolveMeraOrderResponse`, giờ có thêm `columns`). Xác nhận pass-through. |
| B8 | `app/api/mera/statuses/route.ts` | KHÔNG đổi. |

**Ràng buộc backend:**
- `values` chỉ resolve fieldKey CÓ trong columns (đừng đổ hết field) — trừ `note`(order)/`item_note`(item) luôn kèm để UI note ổn định.
- Nested merge phải fetch OBJECT mới trước PATCH (D7); không patch subfield lẻ.
- editable tính ở server; frontend tin tuyệt đối.

## 3. Task frontend (`frontend-engineer`) — `MeraItemEditor.tsx` (+ có thể `field-editors.tsx` renderer)

| # | Việc |
|---|------|
| F1 | `MeraReceiptEditor`: đọc `columns` từ `resolve.data.columns`. Tách `orderColumns = columns.filter(scope==="order")`, `itemColumns = columns.filter(scope==="item")`. |
| F2 | **Order-scope section** (mới): render 1 LẦN ở đầu panel (trên list item) — chỉ khi `orderColumns.length>0`. Mỗi cột đọc `order.values[fieldKey]`, lưu qua 1 request `{ updates:{fieldKey:val…}, orderId, orderVersion }` (itemKey rỗng). Note order-level chỉ hiện khi columns có `note`. |
| F3 | **Item card** (`MeraItemMatchEditor`): render động theo `itemColumns`, mỗi cột đọc `item.values[fieldKey]`. Save gom field item-scope dirty → `{ updates, itemKey, itemVersion, orderId, orderVersion }`. Item note hiện khi itemColumns có `item_note`. |
| F4 | **Renderer chọn theo fieldKey** (thay switch theo label cũ). Đề xuất helper `meraFieldEditor(fieldKey)`: `status`→`StatusSelect`; `customer_image`→textarea+`ImagePreviews`; `design_link`/`mockup_link`→textarea+`DriveLinkPreview`; fieldKey chứa `note`/`personalization`→textarea; fieldKey chứa `link`/`url`/`image`→textarea (link nhiều dòng); còn lại→input 1 dòng. `editable===false`→ read-only cell (`CopyCode`/link, KHÔNG input). Tận dụng `FieldInput` bằng cách map fieldKey→`field` label khi trùng ("Status"/"Customer Image"/"Design"/"Mockup"), hoặc mở rộng `FieldInput` nhận `fieldKey`. |
| F5 | `useMera.ts`: **gộp** `useUpdateMeraItem`+`useUpdateMeraNote` → 1 hook `useUpdateMera` (POST `/api/mera/update`, body `MeraUpdateRequest`, cast `MeraUpdateResponse`, `invalidate ["mera-order"]`). Cập nhật import type. |
| F6 | Bỏ mọi tham chiếu `MERA_EDITABLE_ITEM_FIELDS`/`MERA_FULL_ITEM_FIELDS`/`MeraItemUpdates`/`NOTE_KEY` cứng. Popup "sửa toàn bộ field" (Maximize2): giữ nếu muốn nhưng render cùng `itemColumns` (không còn danh sách cứng) — hoặc bỏ, tuỳ. |
| F7 | Remount key item card giữ `${itemKey}-${version}-${order.version}` để fill lại sau save/conflict. |

**Ràng buộc frontend:** đọc value luôn từ `values[fieldKey]` (không đọc field typed đã bỏ). Không tự quyết editable. Tracking hiển thị qua column `tracking.*` (read-only cell) — bỏ block tracking bespoke cũ để tránh phân kỳ.

## 4. Bảng seam API↔UI (đầu vào cho `qa-integration`)

| Seam | Service (nguồn) | API field | Hook / Query key | Component đọc | QA so khớp |
|------|-----------------|-----------|------------------|---------------|-----------|
| columns | `fetchMeraColumns` → chuẩn hoá (B3) | `ResolveMeraOrderResponse.columns[]` | `["mera-order", receiptId]`; cast `ResolveMeraOrderResponse` | `MeraReceiptEditor` chia scope | `fieldKey/scope/editable/position` khớp cả 2 phía; sort tăng position; visible đã lọc |
| item values | `mapItem` điền `values[fieldKey]` (B1) theo columns item-scope | `items[].values` (Record) | cùng | item card đọc `item.values[fieldKey]` | key = fieldKey (snake/dot, KHÔNG camelCase); có `item_note`; nested `tracking.code` resolve đúng |
| order values | `mapOrder` điền `values` (B2) | `order.values` | cùng | order-scope section đọc `order.values[fieldKey]` | có `note`; `customer.name`/`pricing.*` nếu cấu hình |
| item note | `mapItem` `note = item.note` (item_note) | `items[].note` + `values["item_note"]` | cù| item card | note là ITEM-scope, ghi về `order_items.note` |
| update (item) | `updateMeraOrder` tách item-scope, item_note→note, nested merge (B5) | POST body `MeraUpdateRequest.updates` (fieldKey) | `useUpdateMera`; cast `MeraUpdateResponse` | item card save | `updates` key = fieldKey; server map đúng; `item` trả về non-null |
| update (order) | `updateMeraOrder` tách order-scope | cùng body, itemKey rỗng | cùng | order-scope section save | order-scope only ⇒ `order` non-null, `item` null |
| split | 400 ITEM_EDIT_REQUIRES_SPLIT→split→retry (B5) | `MeraUpdateResponse.splitApplied` | cùng | toast "đã bật split" | giữ hành vi vòng 1 |
| conflict | 409 → `version_conflict` + `latest` (scope) | `MeraConflictBody` | `useUpdateMera` onError | toast + refetch/remount | `latest` đúng loại scope xung đột |
| statuses | `getMeraStatuses` | `{statuses:string[]}` | `["mera-statuses"]` | `StatusSelect` cho column `status` | fallback `MERA_STATUS_OPTIONS` khi rỗng |

## 5. Quy tắc editable cuối (chốt)
`column.editable = configEditable(≠false) AND fieldKey ∈ whitelist(scope) AND dora-1 hỗ trợ`.
- Whitelist item = `MERA_EDITABLE_ITEM_FIELD_KEYS`; order = `MERA_EDITABLE_ORDER_FIELD_KEYS`.
- Read-only kể cả khi admin bật editable: `order_id, item_key, items_count, created_at, order_date, conversation_id, provider, provider_history, designer.*, source_link` (không có trong whitelist ⇒ editable=false).
- `tracking.*`/`shipping.*`/`customer.*`/`pricing.*` editable NẾU trong whitelist → nested merge khi PATCH (D7).

## 6. Giả định đã chốt (không rõ → chốt, không bịa)
- Cấu hình cột lấy qua **fulfill proxy** `<origin>/api/v1/projects/:id/order-table-columns` (khuyến nghị research §Endpoint), Bearer `MERA_INTERNAL_API_KEY`. origin derive từ `MERA_API_BASE_URL`.
- `project_id` có trong payload order Mera (field `project_id`). Nếu Mera KHÔNG trả → `projectId=""` → fallback `MERA_DEFAULT_COLUMNS` (an toàn, panel vẫn chạy). Backend cần xác nhận field name khi code; nếu khác (`projectId`/`project`) thì map thêm alias trong `firstString`.
- Note trọng tâm vòng 2 = `item_note`→`order_items.note`; Order Note (`note` order-scope) VẪN giữ trong default columns để không mất tính năng cũ.
