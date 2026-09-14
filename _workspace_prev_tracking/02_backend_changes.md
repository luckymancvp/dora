# Backend — Lịch sử add tracking

## File đã sửa
- `lib/services/tracking.ts` — thêm `summarizeJob(orders)` + `listJobHistory(query)`.
- `app/api/tracking/jobs/route.ts` — thêm handler `GET` (giữ nguyên `POST`).
- `lib/db/indexes.ts` — thêm 2 index multikey `orders.order_id`, `orders.tracking_number` vào `TRACKING_JOB_INDEXES`.

## Endpoint
`GET /api/tracking/jobs`

### Query params (đều optional, parse phòng thủ)
| param | kiểu | default | ghi chú |
|---|---|---|---|
| `q` | string | "" | khớp **CHÍNH XÁC** order_id HOẶC tracking_number trong orders[] (không partial) |
| `shop` | string | "" | khớp chính xác `shop_name` |
| `page` | int | 1 | clamp ≥ 1 |
| `limit` | int | 20 | clamp [1, 100] |

Auth: `auth()` → 401 nếu chưa đăng nhập. KHÔNG lọc theo sender_email (mọi user thấy toàn bộ).

### Response — object PHẲNG `TrackingHistoryResponse` (KHÔNG bọc `{ job }`)
```json
{
  "items": [
    {
      "id": "665f1a2b3c4d5e6f70819200",
      "shop_name": "MyShop",
      "shop_id": 12345678,
      "sender_email": "tu@doubletees.net",
      "phase": "COMPLETED",
      "error": "shop_id sai",            // chỉ có khi job.error tồn tại; nếu không → field vắng mặt
      "counts": {
        "total": 10,      // orders.length
        "selected": 8,    // selected = true
        "verified": 6,
        "mismatch": 1,
        "failed": 1,
        "skipped": 0
      },
      "created_at": "2026-07-20T08:15:30.000Z",
      "updated_at": "2026-07-20T08:16:02.000Z"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 137,
  "totalPages": 7
}
```

Chi tiết 1 lượt (orders[]): KHÔNG có trong list → click item gọi `GET /api/tracking/jobs/[id]` (đã có) → `SerializedJob`.

## Điểm QA cần chú ý
1. **Wrapper lệch:** GET trả phẳng `{items,...}`, POST trả `{ job }` — cùng route file. Hook phải đọc phẳng.
2. **`created_at`/`updated_at` là ISO string** ở list (đã `.toISOString()`), khác `SerializedJob` khai `Date`. Component chi tiết nhận string thực tế.
3. **`error` là optional field** — chỉ xuất hiện trong JSON khi job có lỗi (không set `undefined`). FE dùng `item.error` guard.
4. **`counts` khớp `JobCard.summary`** trong page.tsx, TRỪ `total`: contract định nghĩa `total = orders.length` (page.tsx hiển thị `sent.length`); `selected` mới = số đơn đã gửi (selected=true). Đã comment trong `summarizeJob`.
5. **Search `q` khớp CHÍNH XÁC** (không substring) — QA test bằng mã đầy đủ, không test một phần.
6. Projection chỉ kéo `orders.{selected,verify,add_status}` để đếm — không có order_id/tracking trong list payload (đúng contract, gọn payload).

## Typecheck
`npx tsc --noEmit` — sạch, không lỗi.
