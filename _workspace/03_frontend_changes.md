# Frontend — Lịch sử add tracking (/tracking)

## File tạo mới
- `lib/hooks/useTrackingHistory.ts`
  - `useTrackingHistory(query: TrackingHistoryQuery)` → `useQuery`
    - queryKey: `["tracking-history", query]` (query = `{q, shop, page, limit}` — đủ mọi biến filter).
    - queryFn `fetchTrackingHistory`: `URLSearchParams` set `q`/`shop` chỉ khi trim non-empty; luôn set `page`, `limit`. Fetch `GET /api/tracking/jobs?...`, `throw` khi `!res.ok`, cast `as TrackingHistoryResponse` (contract chung, đọc **phẳng** `{items,page,pageSize,total,totalPages}`).
    - `placeholderData: keepPreviousData`, `staleTime: 10_000`.
  - `useTrackingJob(id: string | null)` → chi tiết 1 lượt
    - queryKey `["tracking-job", id]`, `enabled: !!id` (chỉ fetch khi mở dòng).
    - Đọc `GET /api/tracking/jobs/[id]` → cast `{ job: TrackingJobDetail }`, trả `data.job`.
    - `TrackingJobDetail` = `Omit<TrackingJob, "_id"|"created_at"|"updated_at"> & { id: string; created_at: string; updated_at: string }` (mirror `SerializedJob`, ngày là ISO string qua JSON). Dẫn xuất từ contract type, không redefine field.

- `components/tracking/HistorySection.tsx` — export `HistorySection`
  - State: `rawQ`/`q` (debounce 350ms → reset về trang 1), `shop` (select từ `useShops`), `page` (1-based), `openId` (dòng đang mở).
  - Dùng `useTrackingHistory({ q, shop, page, limit: 20 })`.

## File sửa
- `app/tracking/page.tsx`
  - Thêm import `HistorySection`.
  - Thêm state `tab: "add" | "history"` + tab bar ở đầu trang (pill segmented).
  - `tab === "add"` bọc TOÀN BỘ luồng cũ trong fragment `<>...</>` — không đổi logic input/JobCard/confirm/poll. `tab === "history"` render `<HistorySection />`.

## Field response được đọc (seam API↔UI)
Từ `TrackingHistoryResponse` (list — object PHẲNG, KHÔNG `{job}`):
- `data.items[]` → render danh sách. `data.page`, `data.totalPages`, `data.total` → phân trang + đếm.
- Mỗi `item: TrackingHistoryItem`:
  - `item.id` → key + param `useTrackingJob(id)`.
  - `item.shop_name` → tên shop (dòng).
  - `item.created_at` (ISO string) → `formatDateTime` (`new Date(iso).toLocaleString`).
  - `item.sender_email` → dòng phụ (fallback "—").
  - `item.phase` (`TrackingPhase`) → badge PHASE_LABEL; `item.error` (nếu có) ưu tiên → badge "Lỗi".
  - `item.counts` → badges: `total` ("N đơn"), `verified` (xanh), `mismatch`/`failed` (đỏ), `skipped` (xám). Đọc đủ 5 số + total.

Từ chi tiết (`TrackingJobDetail` qua `{ job }`):
- `job.orders[]: TrackingJobOrder` → bảng read-only: `order_id`, `tracking_number`, `carrierLabel(carrier, other_carrier)`, cột kết quả `ResultCell` (đọc `selected`, `verify`, `add_status`, `precheck`, `message`, `verified?.code`).

## Điểm QA chú ý
1. **Wrapper khác nhau**: list GET trả PHẲNG `{items,...}`; POST + GET-by-id trả `{job}`. Hook list cast `TrackingHistoryResponse`, hook detail đọc `data.job`. Nếu backend bọc list trong `{...}` khác → lệch.
2. **`created_at` là string** (không phải Date). `formatDateTime` chịu được string; nếu backend trả Date thật (không `.toISOString()`) thì JSON vẫn ra string — OK, nhưng nếu trả number/khác định dạng → hiển thị lệch.
3. **`counts` phải khớp `JobCard.summary`** trong page.tsx: `verified`/`mismatch`/`failed`/`skipped` tính trên `selected=true`, `total=orders.length`. QA so số ở lịch sử == số lúc chạy job.
4. **Search `q` khớp CHÍNH XÁC** order_id/tracking (không substring). QA test bằng mã đầy đủ. Debounce 350ms phía UI.
5. Filter `shop` = `shop_name` khớp chính xác; option lấy từ `useShops()` (`shopName`).
6. Endpoint `GET /api/tracking/jobs` do backend làm song song — nếu chưa sẵn, hook đã đúng contract, chỉ chờ route.

## Typecheck
`npx tsc --noEmit` → exit 0 (sạch).
