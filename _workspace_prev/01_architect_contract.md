# 01 — Architect Contract: Tính năng "Cập nhật Mera"

Nguồn: plan `C:\Users\admin\.claude\plans\hi-n-t-i-c-sorted-pearl.md` + `docs/order-api-v2.md`.
Nguyên tắc: chốt type contract TRƯỚC → backend (§2–4 plan) và frontend (§5–6 plan) code song song, ráp ở seam API↔hook.

---

## 1. Type contract — nguồn duy nhất: `lib/types/mera.ts`

Cả 4 tầng import TỪ file này, không tự định nghĩa lại:
`service mera-order.ts` (map snake_case → camelCase) → `route /api/mera/*` (`NextResponse.json`) → `hook useMera.ts` (`jsonFetch<T>`) → `component MeraItemEditor.tsx`.

| Type | Vai trò | Field chính |
|---|---|---|
| `MeraTracking` | tracking item (chỉ đọc) | `code, carrier, url` |
| `MeraOrderItem` | 1 item của đơn Mera | `itemKey, orderId, status, personalization, customerImage, designLink, mockupLink, tracking, imageLink, productName, quantity, version` |
| `MeraOrderSummary` | metadata đơn (order-level) | `orderId, store, note, isSplitItems, itemsCount, version, customerName` |
| `MeraResolveReason` | `"not_found" \| "not_configured" \| null` | lý do resolve rỗng |
| `ResolveMeraOrderResponse` | body GET /api/mera/resolve | `{ order: MeraOrderSummary \| null, items: MeraOrderItem[], reason }` |
| `MeraItemUpdates` | field item editable (camelCase) | `status?, personalization?, customerImage?, designLink?, mockupLink?` |
| `MeraUpdateRequest` | body POST /api/mera/update (union) | `MeraUpdateItemRequest \| MeraUpdateOrderRequest` |
| `MeraUpdateResponse` | response POST update (union) | `{ item, splitApplied? } \| { order }` |
| `MeraConflictBody` | body lỗi 409 | `{ error, code: "version_conflict", latest }` |
| `MERA_EDITABLE_ITEM_FIELDS` | `{key,label}[]` | key = khoá MeraOrderItem, label = tên field Sheet (để FieldInput switch behavior) |
| `MERA_STATUS_OPTIONS` | hardcode status | NEW…CANCELLED |

**Quyết định chốt:**
- DTO **camelCase** (khớp `sheets.ts`), service chịu trách nhiệm map. Client không bao giờ thấy snake_case.
- `MERA_EDITABLE_ITEM_FIELDS[].label` PHẢI trùng tên field Sheet ("Status", "Personalization", "Customer Image", "Design", "Mockup") → `FieldInput` (tách sang `field-editors.tsx`) switch theo label nên Mera editor tự có textarea + preview ảnh, không cần code lại.
- `updates`/note chỉ gửi field DIRTY. `version` bắt buộc trong mọi PATCH (optimistic lock).

---

## 2. Task Backend (`backend-engineer`)

| # | File | Việc | Type liên quan |
|---|---|---|---|
| B1 | `.env.example` | Thêm `MERA_API_BASE_URL=https://mera-fulfill-api.pamoteam.top/api/v2` + `MERA_INTERNAL_API_KEY=` (rỗng) | — |
| B2 | `lib/services/mera-order.ts` (mới, `server-only`) | `MeraApiError extends Error` (`.status`, `.code`, `.latest`); `meraFetch()` private (env, auth headers, `X-Actor-Email`, `AbortSignal.timeout(15_000)`, `cache:"no-store"`); `resolveMeraOrder()`, `updateMeraItem()` (auto-split), `updateMeraOrderNote()` | trả `ResolveMeraOrderResponse`, `MeraOrderItem`, `MeraOrderSummary` |
| B3 | `app/api/mera/resolve/route.ts` (mới) | GET `?store=&receiptId=`, `requireEmail()`, validate receiptId, gọi `resolveMeraOrder({storeName, receiptId, actorEmail})`, catch → `errorResponse` | `ResolveMeraOrderResponse` |
| B4 | `app/api/mera/update/route.ts` (mới) | POST, parse `MeraUpdateRequest` union theo `target`; item→`updateMeraItem`→`{item, splitApplied?}`; order→`updateMeraOrderNote`→`{order}`; catch version_conflict → 409 `{error, code, latest}` | `MeraUpdateRequest`, `MeraUpdateResponse`, `MeraConflictBody` |
| B5 | `lib/http/api-helpers.ts` (sửa nhỏ) | `errorResponse` kèm `code` + `latest` vào body NẾU err có (generic) — để 409/503/502 mang code | — |

**Chi tiết service (khớp plan + docs):**
- `resolveMeraOrder`: env thiếu → `{order:null, items:[], reason:"not_configured"}` (KHÔNG throw). Có env → `GET /orders?q=<receiptId>&include_items=true&page_size=50`; lọc `order_id` kết thúc `-<receiptId>` hoặc `=== receiptId`, loại `is_deleted`; nhiều KQ → lọc `normalizeStore(store)` (tái dùng `lib/google/sheet-utils`); còn nhiều → mới nhất theo `created_at`. `items` rỗng → fallback `GET /orders/:order_id/items`. Không match → `reason:"not_found"`.
- `updateMeraItem`: whitelist 5 field, map camelCase→snake_case, `PATCH /order-items/:item_key {version, ...}`. `400 ITEM_EDIT_REQUIRES_SPLIT` → `POST /orders/:order_id/split {split:true}` rồi retry PATCH đúng 1 lần → set `splitApplied:true`. `409` → throw `MeraApiError(409,"version_conflict",{latest})` (KHÔNG auto-merge).
- `updateMeraOrderNote`: `PATCH /orders/:order_id {version, note}`. `409` tương tự.
- Env thiếu ở update → `MeraApiError(503,"mera_not_configured")`. Timeout/mạng → `MeraApiError(502,"mera_unavailable")`.

---

## 3. Task Frontend (`frontend-engineer`)

| # | File | Việc | Type liên quan |
|---|---|---|---|
| F1 | `lib/hooks/useSheets.ts` (sửa) | `ApiError` thêm field `latest?: unknown`; `jsonFetch` đọc `latest` từ body lỗi; **export `jsonFetch`** (bỏ private) để `useMera` tái dùng | `ApiError` |
| F2 | `lib/hooks/useMera.ts` (mới) | `useResolveMeraOrder({store, receiptId, enabled})` — `queryKey:["mera-order", receiptId]`, `staleTime:30_000`, `retry:false`; `useUpdateMeraItem()`, `useUpdateMeraNote()` — mutation POST `/api/mera/update`, `onSuccess` invalidate `["mera-order"]` | `ResolveMeraOrderResponse`, `MeraUpdateRequest`, `MeraUpdateResponse` |
| F3 | `components/messenger/field-editors.tsx` (mới) | Move THUẦN từ `SheetItemEditor.tsx` (~dòng 24–384): `StatusSelect`, `FieldInput`, `ImagePreviews`, `DriveLinkPreview`, `ImageLightbox`, `CopyCode`, `toastSaveError`, `TEXTAREA_FIELDS` → export. Không đổi logic | — |
| F4 | `components/messenger/SheetItemEditor.tsx` (sửa) | Import các thứ trên từ `field-editors.tsx` thay vì định nghĩa nội bộ. **Regression quan trọng nhất: flow Sheet cũ không vỡ** | — |
| F5 | `components/messenger/MeraItemEditor.tsx` (mới) | `MeraReceiptEditor({store, receiptId})` export chính: header `CopyCode(order.orderId)` + badge "Mera" + refresh; Note editor order-level (dùng `order.version`); list item key `${itemKey}-${version}`. `MeraItemMatchEditor` private: thumbnail `imageLink`, `productName`/`quantity`, Tracking read-only, map `MERA_EDITABLE_ITEM_FIELDS`→`FieldInput`, dirty tracking, chỉ gửi field dirty | tất cả type mera |
| F6 | `components/orders/OrderUpdateSidebar.tsx` (mới) | Copy khung `OrderSheetSidebar.tsx`; `useResolveSheetRow` trước, `tryMera = (sheet.isSuccess && matches.length===0) \|\| sheet.isError`; `useResolveMeraOrder({enabled:tryMera})`. Render: Sheet editor nếu match → Mera editor nếu có → cả 2 rỗng "Không tìm thấy đơn ở Sheet lẫn Mera." Badge nguồn | `ResolveMeraOrderResponse` |
| F7 | `components/orders/OrderCard.tsx` (sửa) | Label "Cập nhật Sheet" → "Cập nhật"; prop `onUpdateSheet` → `onUpdate` | — |
| F8 | `components/orders/OrdersList.tsx` (sửa) | Rename prop passthrough `onUpdateSheet` → `onUpdate` | — |
| F9 | `app/orders/page.tsx` (sửa) | state `sheetOrder` → `updateOrder`; render `OrderUpdateSidebar` thay `OrderSheetSidebar`. Xoá `OrderSheetSidebar.tsx` sau khi thay | — |

**Quyết định frontend:**
- Item editor remount khi `version` đổi (key `${itemKey}-${version}`) → fill data mới sau save/conflict.
- Lỗi save `version_conflict`: đọc `ApiError.latest` → toast "Item đã bị sửa bởi người khác — đã tải lại" + refetch/remount.
- States: "Đang tìm trên Mera…", `not_configured` → "Chưa cấu hình Mera API", 502 → "Không kết nối được Mera".
- `useResolveSheetRow` và `useResolveMeraOrder` cùng `store, receiptId` — query key khác nhau (`sheet-row` vs `mera-order`) nên không đụng nhau; Mera chỉ fetch khi Sheet không match hoặc lỗi (`enabled:tryMera`).

---

## 4. Bảng seam (ranh giới) — cho `qa-integration`

| Seam | Bên CHO | Bên NHẬN | Shape / khoá | Ghi chú |
|---|---|---|---|---|
| S1 resolve query | `useResolveMeraOrder` → URL | `GET /api/mera/resolve` | query `?store=<string>&receiptId=<number>` | receiptId không finite → 400 |
| S2 resolve body | route (`resolveMeraOrder`) | hook `jsonFetch<ResolveMeraOrderResponse>` | `{ order: MeraOrderSummary\|null, items: MeraOrderItem[], reason }` | reason ∈ `not_found\|not_configured\|null` |
| S3 query key | `useResolveMeraOrder` | TanStack cache | `["mera-order", receiptId]` | tách hẳn `["sheet-row", ...]` — không double-fetch |
| S4 update item req | `useUpdateMeraItem` | `POST /api/mera/update` | `{target:"item", itemKey, version, updates: MeraItemUpdates}` | updates chỉ field dirty (camelCase) |
| S5 update item res | route (`updateMeraItem`) | mutation `jsonFetch<MeraUpdateItemResponse>` | `{ item: MeraOrderItem, splitApplied?: boolean }` | splitApplied=true → toast "đã bật split items trên Mera" |
| S6 update note req | `useUpdateMeraNote` | `POST /api/mera/update` | `{target:"order", orderId, version, note}` | — |
| S7 update note res | route (`updateMeraOrderNote`) | mutation `jsonFetch<MeraUpdateOrderResponse>` | `{ order: MeraOrderSummary }` | order.version tăng |
| S8 field map UI | `MERA_EDITABLE_ITEM_FIELDS` | `FieldInput` (field-editors) | `{key: keyof MeraItemUpdates, label}` | label khớp Sheet → behavior textarea/preview |
| S9 component đọc | `MeraOrderItem`/`MeraOrderSummary` | `MeraItemEditor` | đọc `itemKey, version, imageLink, productName, quantity, tracking.*`; order `orderId, note, version` | Tracking read-only |

**Status code lỗi (seam lỗi — QA phải khớp):**

| HTTP | code (body) | Nguồn | Body | UI phản ứng |
|---|---|---|---|---|
| 409 | `version_conflict` | update item/order khi version lệch | `{error, code:"version_conflict", latest}` (`MeraConflictBody`) | toast + refetch/remount, đọc `ApiError.latest` |
| 503 | `mera_not_configured` | update khi thiếu env MERA_* | `{error, code:"mera_not_configured"}` | "Chưa cấu hình Mera API" |
| 502 | `mera_unavailable` | Mera down/timeout 15s | `{error, code:"mera_unavailable"}` | "Không kết nối được Mera" |
| — (200) | `reason:"not_configured"` | RESOLVE khi thiếu env (soft) | `{order:null, items:[], reason:"not_configured"}` | notice phụ, flow Sheet vẫn chạy |

> Lưu ý QA: resolve khi thiếu env trả **200 + reason** (soft), còn update thiếu env trả **503 + code** (hard). Hai đường xử lý env KHÁC nhau — đừng nhầm.

---

## 5. Quy ước mapping snake_case (Mera API) → camelCase (DTO)

Service `mera-order.ts` là NƠI DUY NHẤT map. Frontend không bao giờ chạm snake_case.

### MeraOrderItem (từ `order_items` JSON, §3/§5 docs)
| Mera JSON (snake) | DTO (camel) | Kiểu | Ghi chú |
|---|---|---|---|
| `item_key` | `itemKey` | string | khoá PATCH |
| `order_id` | `orderId` | string | |
| `status` | `status` | string | editable |
| `personalization` | `personalization` | string | editable |
| `customer_image` | `customerImage` | string | editable |
| `design_link` | `designLink` | string | editable |
| `mockup_link` | `mockupLink` | string | editable |
| `tracking.{code,carrier,url}` | `tracking.{code,carrier,url}` | MeraTracking | read-only |
| `image_link` | `imageLink` | string | thumbnail |
| `product_name` | `productName` | string | |
| `quantity` | `quantity` | number | |
| `version` | `version` | number | optimistic lock item |

### MeraOrderSummary (từ `orders` JSON, §1/§2 docs)
| Mera JSON (snake) | DTO (camel) | Kiểu | Ghi chú |
|---|---|---|---|
| `order_id` | `orderId` | string | |
| `store` | `store` | string | |
| `note` | `note` | string | editable |
| `is_split_items` | `isSplitItems` | boolean | điều kiện PATCH item |
| `items_count` | `itemsCount` | number | |
| `version` | `version` | number | optimistic lock order |
| `customer.name` | `customerName` | string | nested → flatten |

### Chiều NGƯỢC — updates camelCase → snake_case body PATCH (item)
| DTO (camel) | Mera body (snake) |
|---|---|
| `status` | `status` |
| `personalization` | `personalization` |
| `customerImage` | `customer_image` |
| `designLink` | `design_link` |
| `mockupLink` | `mockup_link` |

Order note: `note` → `note` (không đổi). PATCH order body: `{version, note}`.

---

## Giả định đã chốt (không có phản hồi bổ sung từ user)
- Mera gọi qua **fulfill** backend, auth Internal API Key + `X-Actor-Email` = email session next-auth của dora-1 (server-side only).
- `MERA_STATUS_OPTIONS` hardcode vì Mera KHÔNG có endpoint list status; StatusSelect prepend giá trị lạ → không mất data.
- Field editable Mera = đúng 5 field như Sheet (item: status/personalization/customer_image/design/mockup; order: note). Tracking chỉ đọc.
