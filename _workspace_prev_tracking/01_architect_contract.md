# Contract — Lịch sử add tracking (/tracking)

Feature: trang `/tracking` bổ sung khu vực "Lịch sử" để truy vấn lại các lượt add tracking đã chạy (ai add, khi nào, shop nào, order/tracking nào, kết quả). Backend list summary + phân trang + search; xem chi tiết dùng lại `GET /api/tracking/jobs/[id]` đã có.

Giả định đã chốt (dữ liệu có sẵn, không cần hỏi lại): job lưu ở `meta_local.tracking_jobs` qua `getTrackingJobsCollection()`. Không có soft-delete → list tất cả job. Auth: dùng `auth()` như các route hiện có; KHÔNG lọc theo sender_email (mọi user thấy toàn bộ lịch sử, để tra chéo — nếu sau này cần lọc "của tôi" thì thêm param, ngoài phạm vi lần này).

---

## (a) Type contract — ĐÃ ghi vào `lib/types/tracking.ts`

Các type CHUNG cho cả 4 tầng (service → route → hook → component). Xem code thật trong file; tóm tắt:

- `TrackingJobCounts` — tóm tắt kết quả 1 job: `{ total, selected, verified, mismatch, failed, skipped }`. Tính trên đơn `selected = true` (khớp logic `summary` trong `JobCard` của page.tsx), riêng `total = orders.length`.
- `TrackingHistoryItem` — 1 dòng lịch sử (KHÔNG kèm `orders[]`): `{ id, shop_name, shop_id, sender_email, phase, error?, counts, created_at, updated_at }`. `id = _id.toHexString()`; `created_at/updated_at` là **ISO string** (đã qua JSON).
- `TrackingHistoryQuery` — `{ q, shop, page, limit }` (params URL của GET list).
- `TrackingHistoryResponse` — `{ items: TrackingHistoryItem[], page, pageSize, total, totalPages }` (mirror `OrdersResponse`).

Chi tiết 1 lượt: KHÔNG nằm trong list. Bấm 1 item → `GET /api/tracking/jobs/[id]` (đã có) → `SerializedJob` (có `orders[]`).

---

## (b) Task backend (backend-engineer)

**B1. Service `listJobHistory` trong `lib/services/tracking.ts`**
- Signature: `export async function listJobHistory(query: TrackingHistoryQuery): Promise<TrackingHistoryResponse>`.
- Build filter Mongo:
  - `q` (trim): khớp `orders.order_id` HOẶC `orders.tracking_number`. Vì là mảng, dùng `$or: [{ "orders.order_id": q }, { "orders.tracking_number": q }]` (khớp element trong array). Cân nhắc regex prefix nếu muốn search một phần; chốt: **khớp chính xác** order_id/tracking (người dùng dán mã đầy đủ) — nhanh, dùng được index multikey. Nếu q rỗng → bỏ điều kiện.
  - `shop` (trim): `shop_name: shop` (khớp chính xác) nếu có.
- Sort `{ created_at: -1 }`, skip `(page-1)*limit`, limit `limit`.
- Đếm `total = countDocuments(filter)`; `totalPages = Math.max(1, Math.ceil(total/limit))`.
- Map mỗi doc → `TrackingHistoryItem` qua helper `summarizeJob(job)` tính `counts` (đọc `orders[]`, KHÔNG trả `orders` ra ngoài) và `.toISOString()` cho ngày.
- Clamp: `page = max(1, page)`, `limit` mặc định 20, max 100.
- Helper `summarizeJob` tính counts theo đúng logic `JobCard.summary`:
  - `sent = orders.filter(o => o.selected)`
  - `total = orders.length`, `selected = sent.length`
  - `verified = sent.filter(o => o.verify === "VERIFIED").length`
  - `mismatch = sent.filter(o => o.verify === "MISMATCH").length`
  - `failed = sent.filter(o => o.add_status === "FAILED").length`
  - `skipped = sent.filter(o => o.verify === "SKIPPED" && o.add_status !== "FAILED").length`

**B2. Route `GET` trong `app/api/tracking/jobs/route.ts`** (thêm `GET`, giữ nguyên `POST`)
- `auth()` như POST; 401 nếu chưa đăng nhập.
- Parse `req.nextUrl.searchParams`: `q` (default ""), `shop` (default ""), `page` (parseInt, default 1), `limit` (parseInt, default 20). Ép kiểu an toàn.
- Gọi `listJobHistory({ q, shop, page, limit })` → `NextResponse.json(result)` (trả **nguyên** `TrackingHistoryResponse`, KHÔNG bọc thêm `{ job }`).
- Catch → 500 `{ error }` như convention.
- LƯU Ý seam: response là object phẳng (`items/page/...`), khác POST (`{ job }`). Hook phải đọc phẳng.

**B3. Index MongoDB `lib/db/indexes.ts`**
- `TRACKING_JOB_INDEXES` đã có `idx_created_at` ({created_at:-1}) và `idx_shop_created` ({shop_name:1, created_at:-1}) → đủ cho sort + filter shop.
- Thêm cho search q (multikey trên array):
  - `{ keys: { "orders.order_id": 1 }, options: { name: "idx_orders_order_id" } }`
  - `{ keys: { "orders.tracking_number": 1 }, options: { name: "idx_orders_tracking_number" } }`
- `ensureIndexes` idempotent (isAlreadyExistsError) → an toàn thêm.

---

## (c) Task frontend (frontend-engineer)

**F1. Hook `lib/hooks/useTrackingHistory.ts`** (mirror `useOrders.ts`)
- `import type { TrackingHistoryQuery, TrackingHistoryResponse } from "@/lib/types/tracking"`.
- `fetchTrackingHistory(q: TrackingHistoryQuery)`: build `URLSearchParams` — chỉ set `q`/`shop` khi trim non-empty; luôn set `page`, `limit`. `fetch("/api/tracking/jobs?"+params)`; `if(!res.ok) throw`; `return await res.json() as TrackingHistoryResponse`.
- `export function useTrackingHistory(query: TrackingHistoryQuery)` → `useQuery({ queryKey: ["tracking-history", query], queryFn, placeholderData: keepPreviousData, staleTime: 10_000 })`.

**F2. Component lịch sử — trong `app/tracking/page.tsx`**
- Thêm tab/section "Lịch sử" (đề xuất: 2 tab ở đầu trang — "Add mới" (UI hiện tại) và "Lịch sử"). Giữ nguyên toàn bộ logic input/JobCard hiện có.
- Component `HistorySection`:
  - State: `q` (input search debounce nhẹ hoặc submit), `shop` (select từ `useShops()`), `page` (1-based).
  - Gọi `useTrackingHistory({ q, shop, page, limit: 20 })`.
  - Bảng dòng lịch sử: cột `created_at` (format ngày giờ), `shop_name`, `sender_email` (người add), tóm tắt `counts` (badge: `verified` xanh, `mismatch`/`failed` đỏ, `skipped` xám, tổng `total` đơn), `phase`/`error` (badge trạng thái).
  - Phân trang: dùng `page`, `totalPages` từ response (nút prev/next, disable ở biên).
  - Click 1 dòng → mở chi tiết: fetch `GET /api/tracking/jobs/[id]` → `SerializedJob`, render bảng orders (tái dùng shape `Job`/`JobOrder` + `OrderStatusCell` sẵn có; cân nhắc tách các sub-component dùng chung nếu tiện, không bắt buộc).
- Reuse `carrierLabel` từ `lib/types/tracking`. Có thể thay type inline `Job`/`JobOrder` trong page bằng import từ lib/types nếu muốn (không bắt buộc, ngoài phạm vi contract).

---

## (d) Bảng seam API↔UI

| Field | Ai GHI (backend) | Ai ĐỌC (frontend) | Ghi chú |
|---|---|---|---|
| `items[].id` | `listJobHistory` = `_id.toHexString()` | key list + param `GET /api/tracking/jobs/[id]` | hex string |
| `items[].shop_name` | doc.shop_name | cột Shop + so với filter `shop` | khớp chính xác filter |
| `items[].sender_email` | doc.sender_email | cột "Người add" | |
| `items[].phase` | doc.phase (`TrackingPhase`) | badge trạng thái | union 5 giá trị |
| `items[].error?` | doc.error nếu có | badge "Lỗi" (ưu tiên hơn phase) | optional |
| `items[].counts.total` | orders.length | "N đơn" | |
| `items[].counts.verified/mismatch/failed/skipped/selected` | `summarizeJob` (logic = JobCard.summary) | badge kết quả | PHẢI khớp logic page.tsx |
| `items[].created_at/updated_at` | `.toISOString()` | format ngày giờ | **ISO string**, không phải Date |
| `page` / `pageSize` / `total` / `totalPages` | listJobHistory (clamp page≥1, limit≤100) | phân trang prev/next | mirror OrdersResponse |
| query `q` | route đọc searchParams → filter `orders.order_id`/`orders.tracking_number` | hook set khi non-empty | **khớp chính xác** mã |
| query `shop` | route → filter `shop_name` | hook set khi non-empty | |
| query `page`/`limit` | route parseInt default 1/20 | hook luôn set | |
| Response wrapper | **object phẳng** `{items,...}` (KHÁC POST `{job}`) | hook đọc phẳng | dễ lệch — GHI RÕ |
| Chi tiết orders[] | KHÔNG trong list → `GET /api/tracking/jobs/[id]` → `SerializedJob` | click item mới fetch | tránh payload nặng |

---

## Điểm rủi ro lệch shape (cho QA)
1. GET list trả object phẳng, POST trả `{ job }` — cùng route file, dễ nhầm wrapper.
2. `created_at` là string ở list (JSON) nhưng `SerializedJob` khai `Date` — component chi tiết nhận string thực tế; format phải chịu được string.
3. `counts` phải khớp 1:1 với `JobCard.summary` để số ở lịch sử == số hiển thị lúc chạy job.
4. Search `q` khớp chính xác (không partial) — QA test với mã đầy đủ, không test substring.
