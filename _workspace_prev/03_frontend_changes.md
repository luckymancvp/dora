# 03 — Frontend changes: transactionId + copy ảnh fullxfull + placeholder search

## File sửa

| # | File | Việc |
|---|------|------|
| F1 | `lib/format.ts` | Thêm `etsyFullResUrl(url: string): string` — regex `url.replace(/il_\d+x\d+\./, "il_fullxfull.")`, guard `if (!url) return url`; URL không match trả nguyên. Thuần string, client-safe. |
| F2 | `components/orders/OrderCard.tsx` | Hiển thị transactionId cho mỗi item (`#{t.transactionId}`), style `text-xs text-muted-foreground`, đặt ngay dưới dòng Quantity. |
| F3 | `components/orders/OrderCard.tsx` | Nút copy nhỏ overlay góc phải trên thumbnail, copy `etsyFullResUrl(t.image)` qua `navigator.clipboard.writeText`, toast (sonner) + icon Copy→Check. |
| F4 | `app/orders/page.tsx` | Placeholder search: `"Tìm theo order ID, transaction ID, tên khách…"`. Không đổi logic. |

## Field đọc từ đâu (không thêm/sửa type)

- `OrderTransaction.transactionId: number` — `lib/types/etsy.ts:283`. Đọc qua `order.transactions[].transactionId` (đã có sẵn trong `OrdersResponse`, `mapTransactions` đã gán).
- `OrderTransaction.image: string` — URL ảnh Etsy sản phẩm (`il_75x75.`…). Nguồn copy.
- Search: FE gửi raw `filters.search` như cũ — KHÔNG strip prefix ở FE (backend B1 xử lý). Chỉ đổi placeholder.

## Hành vi copy (F3)

- Refactor block map transaction thành component con `OrderItemRow` để giữ state `copied` cục bộ per-item.
- Nút copy: `group relative` trên wrapper ảnh, nút `opacity-0 group-hover:opacity-100` góc phải-trên.
- Click → `navigator.clipboard.writeText(etsyFullResUrl(t.image))`. URL `il_75x75.`/`il_170x135.`/`il_300x300.` đều thành `il_fullxfull.`; URL không match giữ nguyên (an toàn).
- Thành công: `toast.success("Đã copy địa chỉ ảnh (fullxfull)")`, icon đổi Check 1.5s. Lỗi: `toast.error(...)`.

## Cho qa-integration

- queryKey: `["orders", filters]` (không đổi) — cast `as OrdersResponse`.
- Field component đọc: `t.transactionId` (render `#...`), `t.image` (copy sau khi qua `etsyFullResUrl`).
- Transform copy chỉ ở FE, không qua API.

## Kiểm tra

- `npx tsc --noEmit` → pass, không lỗi type.

---

# Vòng 2 — Panel "Cập nhật Mera" render ĐỘNG theo Order Table Columns

## File sửa

| # | File | Việc |
|---|------|------|
| F1 | `lib/hooks/useMera.ts` | **Gộp** `useUpdateMeraItem` + `useUpdateMeraNote` → 1 hook `useUpdateMera()`. Body `MeraUpdateRequest` (`{updates, itemKey?, itemVersion?, orderId, orderVersion}`), cast `MeraUpdateResponse`, `invalidate ["mera-order"]`. `useResolveMeraOrder`/`useMeraStatuses` giữ nguyên. |
| F2 | `components/messenger/field-editors.tsx` | Thêm `MeraFieldRenderer` (+ helper `meraFieldKind`, `MeraReadOnlyCell`). Chọn editor theo **fieldKey** (không theo label Sheet), tái dùng `StatusSelect`/`ImagePreviews`/`DriveLinkPreview`/textarea/input. `FieldInput` cũ giữ nguyên cho Sheet editor. |
| F3 | `components/messenger/MeraItemEditor.tsx` | Viết lại render động: đọc `columns` từ resolve, tách scope, section order-scope + item card theo columns. Bỏ `MeraRowDialog` popup, bỏ block tracking bespoke, bỏ mọi field cứng. |
| F4 | `components/orders/OrderUpdateSidebar.tsx` | KHÔNG đổi — chỉ đọc `mera.data.order`/`reason`, vẫn có trong shape mới. |

## Cách render động

- `MeraReceiptEditor` đọc `resolve.data.columns` → `orderColumns = filter(scope==="order")`, `itemColumns = filter(scope==="item")`.
- **Order-scope section** (`MeraOrderScopeSection`): render 1 lần ở đầu panel, chỉ khi `orderColumns.length>0`. Đọc `order.values[fieldKey]`. Lưu: `{updates, orderId, orderVersion}` (không itemKey). Remount key `order-${order.version}`.
- **Item card** (`MeraItemMatchEditor`): render theo `itemColumns`, đọc `item.values[fieldKey]`. Lưu: `{updates, itemKey, itemVersion, orderId, orderVersion}`. Remount key `${itemKey}-${version}-${order.version}`.
- **Renderer theo fieldKey** (`meraFieldKind`): `status`→StatusSelect; `customer_image`→textarea+ImagePreviews; `design_link`/`mockup_link`/`source_link`→textarea+DriveLinkPreview; chứa `note`/`personalization`→textarea; chứa `link`/`url`/`image`→textarea link; còn lại→input. `editable===false`→`MeraReadOnlyCell` (link→anchor/preview, khác→CopyCode). Client KHÔNG tự tính editable — tin `column.editable` từ server.
- **Dirty tracking theo fieldKey**: `draft[fieldKey] !== values[fieldKey]` VÀ `column.editable`. `updates` chỉ gồm field dirty. Label = `column.label`.
- **Giữ vòng 1**: remount theo version, 409→`meraSaveError` toast + `onSaved`(refetch/remount), `splitApplied`→toast ghi chú, states loading/not_configured/mera_unavailable(502).

## Field component đọc (cho qa-integration)

- Hook: `useUpdateMera` (POST `/api/mera/update`), queryKey resolve `["mera-order", receiptId]`, statuses `["mera-statuses"]`.
- Type tiêu thụ: `ResolveMeraOrderResponse` (order, items, **columns**, reason), `MeraUpdateRequest`/`MeraUpdateResponse`, `MeraColumn`, `MeraOrderItem`, `MeraOrderSummary`.
- Component đọc: `columns[].{fieldKey,label,scope,editable,position}`; `order.values[fieldKey]` (order-scope); `item.values[fieldKey]` (item-scope); `order.version`/`item.version` (optimistic lock); `res.splitApplied`.
- Key `updates` = fieldKey (snake/dot, KHÔNG camelCase). Không đọc field typed đã bỏ (status/tracking/... đọc qua `values`).

## Kiểm tra vòng 2

- `npx tsc --noEmit`: sạch lỗi ở file frontend (`useMera.ts`, `field-editors.tsx`, `MeraItemEditor.tsx`, `OrderUpdateSidebar.tsx`).
- Còn lỗi ở `lib/services/mera-order.ts` + `app/api/mera/update/route.ts` — **backend-engineer đang sửa song song** cùng contract v2 (target/version cũ, thiếu columns/values/projectId). Không thuộc phạm vi frontend.
