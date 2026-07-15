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
