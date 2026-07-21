# 01 — Architect Contract: Orders (transactionId + copy ảnh fullxfull + search nâng cao)

> Tính năng nhỏ, chạm trang Orders. Nguyên tắc: KHÔNG phình type. Đa số dữ liệu đã có sẵn ở tầng dưới.

## 0. Kết luận khảo sát (đọc code thật)

| Điểm | Trạng thái thực tế |
|------|--------------------|
| `OrderTransaction.transactionId` | **ĐÃ CÓ** trong `lib/types/etsy.ts:283`; `mapTransactions` đã gán từ `data.transactions[].transaction_id` (`orders-read.ts:101`); projection `LIST_PROJECTION` đã có `"data.transactions": 1` (`orders-read.ts:236`). ⇒ Feature 1 KHÔNG cần đổi backend/type, chỉ render frontend. |
| Ảnh sản phẩm | `t.image` = `product.image_url_75x75` (`orders-read.ts:104`) — URL Etsy dạng `...il_75x75.<id>_<hash>.jpg`. |
| Search hiện tại | `orders-read.ts:272-281`: regex `buyer.name`/`buyer.username`; nếu `Number(search)` hữu hạn → `data.order_id` exact. Prefix `TEST-...` làm `Number()` = NaN ⇒ KHÔNG match order. Chưa search theo transactionId. |
| Search param đường ống | `page.tsx` → `filters.search` → `useOrders` set query `search` → `route.ts` `sp.get("search")` → `getOrders({search})`. Param name ổn định = `search`. KHÔNG đổi tên param. |
| Utils string sẵn có | `lib/format.ts` (client-safe, thuần string) — nơi đặt hàm transform URL. `lib/utils.ts` chỉ có `cn()`. |

## 1. Type contract

**KHÔNG thêm/sửa field type nào.** Cả 3 tính năng dùng type đã tồn tại:

- `OrderTransaction { transactionId: number; image: string; ... }` — `lib/types/etsy.ts:281-298`.
- `OrderFilters { search: string; ... }` — `lib/types/etsy.ts:378`.
- `OrdersResponse` / `OrderListItem` — giữ nguyên.

**Hàm mới (contract dùng chung FE, thuần string, không phụ thuộc DOM):**

```ts
// lib/format.ts
/**
 * Đổi URL ảnh Etsy sang bản gốc: il_<W>x<H>. → il_fullxfull.
 * Tổng quát mọi kích thước (75x75, 170x135, 300x300…). Không match → trả nguyên.
 */
export function etsyFullResUrl(url: string): string
```

- Regex khuyến nghị: `url.replace(/il_\d+x\d+\./, "il_fullxfull.")`. Chỉ thay lần đầu (URL Etsy chỉ có 1 token `il_WxH.`). Guard `if (!url) return url`.
- Đặt ở `lib/format.ts` để tái dùng (OrderCard, và sau này conversation-detail nếu cần). KHÔNG đặt inline trong component.

## 2. Task backend (`backend-engineer`)

| # | File | Việc |
|---|------|------|
| B1 | `lib/services/orders-read.ts` (hàm `getOrders`, block `if (search)` ~line 272-281) | Nâng cấp search: (a) trích **dãy số cuối** của query để bỏ prefix chữ. Rule: `const m = search.match(/(\d+)\s*$/); const num = m ? Number(m[1]) : Number(search);`. Nếu `Number.isFinite(num)` → push `{ "data.order_id": num }` **và** `{ "data.transactions.transaction_id": num }` vào mảng `$or`. (b) Giữ nguyên 2 clause regex `buyer.name`/`buyer.username`. |
| B2 | `lib/services/orders-read.ts` (`LIST_PROJECTION`) | KHÔNG đổi — `data.transactions` đã include cả `transaction_id`. Chỉ xác nhận (đọc để chắc). |

**Ràng buộc B1:** ID Etsy ~10 chữ số nằm trong JS safe int (< 2^53) ⇒ `Number()` an toàn, KHÔNG cần chuyển sang chuỗi. Query `"data.transactions.transaction_id"` match array-of-subdoc bằng equality — Mongo tự dò từng phần tử, đúng ý. Đừng dùng `$elemMatch` (không cần vì chỉ 1 điều kiện).

**Không đụng:** `route.ts` (param `search` giữ nguyên), type, hook. Feature 1 & 2 không có task backend.

## 3. Task frontend (`frontend-engineer`)

| # | File | Việc |
|---|------|------|
| F1 | `lib/format.ts` | Thêm hàm `etsyFullResUrl(url)` theo contract mục 1. |
| F2 | `components/orders/OrderCard.tsx` (block map `order.transactions`, ~line 94-124) | Hiển thị **transactionId** cho mỗi item. Vị trí gợi ý: cạnh/dưới dòng `Quantity` (line 108), dạng mảnh phụ `text-xs text-muted-foreground`, vd `#{t.transactionId}`. Bám tông màu hiện có, không thêm màu mới. |
| F3 | `components/orders/OrderCard.tsx` (ảnh `t.image`, ~line 96-105; và optionally `PersonalizationPhotos`) | Thêm nút/hành vi **"Copy ảnh"** copy `etsyFullResUrl(t.image)` vào clipboard (`navigator.clipboard.writeText`). UI: nút nhỏ overlay góc ảnh hoặc icon cạnh title. Dùng lucide `Copy` (+ `Check` khi copied) đồng bộ style nút hiện có. State copied cục bộ per-item. |
| F4 | `app/orders/page.tsx` (input search, line 70-75) | (Tùy chọn, nhẹ) cập nhật `placeholder` gợi ý tìm thêm theo transaction/prefix, vd `"Tìm theo order ID, transaction ID, tên khách…"`. Không đổi logic. |

**Ràng buộc FE:** copy dùng `navigator.clipboard` (component đã `"use client"`). Nếu muốn copy cả ảnh khách upload thì cũng bọc qua `etsyFullResUrl` — nhưng ưu tiên đúng yêu cầu là ảnh sản phẩm Etsy (`il_` pattern). `etsyFullResUrl` an toàn với URL không phải `il_WxH` (trả nguyên) nên gọi vô hại.

## 4. Bảng seam API↔UI (đầu vào cho `qa-integration`)

| Seam | Service (nguồn) | API param/field | Hook / Query key | Component đọc | Điều QA so khớp |
|------|-----------------|-----------------|------------------|---------------|-----------------|
| transactionId | `mapTransactions` gán `transactionId` (orders-read.ts:101) từ `data.transactions[].transaction_id` | nằm trong `OrdersResponse.items[].transactions[]` | key `["orders", filters]`; cast `as OrdersResponse` | `OrderCard` map `t.transactionId` (line 95, 108) | field tên `transactionId` (camelCase) khớp cả 2 phía; giá trị > 0, không phải 0/undefined trên đơn thật |
| Search prefix (TEST-2914171501 → 2914171501) | `getOrders` block search (B1) trích dãy số cuối → `data.order_id` | query `?search=` (encode nguyên chuỗi user gõ, KHÔNG strip ở FE) | `fetchOrders` set `search` nếu `.trim()` | input `page.tsx:71` | strip prefix xảy ra **ở backend**, FE gửi raw. QA: gõ `TEST-<orderId>` phải ra đúng đơn |
| Search theo transactionId | `getOrders` push `{ "data.transactions.transaction_id": num }` (B1) | cùng param `search` | cùng | cùng input | gõ transactionId của 1 item → ra đơn chứa item đó |
| Copy ảnh fullxfull | (không qua API — transform tại FE) | — | — | `etsyFullResUrl(t.image)` trong `OrderCard` | `il_75x75.` / `il_170x135.` / `il_300x300.` … đều → `il_fullxfull.`; URL không match giữ nguyên |

**Rủi ro QA lưu ý:**
1. `Number(search)` cho chuỗi số dài — xác nhận không mất precision (Etsy id < 2^53, OK).
2. Search giờ có tối đa 4 clause `$or` (2 regex + order_id + transaction_id). Regex không anchor ⇒ với query toàn số, regex trên `buyer.name` vô hại (không match số). Không rớt performance đáng kể ở quy mô hiện tại.
3. Đảm bảo B1 chỉ push clause số khi `Number.isFinite` — tránh push `{order_id: NaN}`.

## 5. Giả định đã chốt
- Nguồn transactionId: `data.transactions[].transaction_id` trong collection `etsy_orders` (DB `meta_local`) — ĐÃ xác nhận có trong doc & projection, không cần fetch nguồn khác.
- "Strip prefix" hiểu là lấy **dãy số liền cuối** query (khớp ví dụ `TEST-2914171501`). Nếu user sau này cần match số ở giữa chuỗi → mở rộng sau.
