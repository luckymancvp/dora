# 03 — Frontend: hiển thị đầy đủ trạng thái verify (bản sửa "Add & xác minh" sai)

**File đã sửa (chỉ 2):**
- `app/tracking/page.tsx`
- `components/tracking/HistorySection.tsx`

KHÔNG chạm `lib/types/tracking.ts` (architect) và `lib/services/tracking.ts` (backend-engineer).

---

## 1. `app/tracking/page.tsx` — bỏ type cục bộ (contract §3 / §7.1)

Xoá `Precheck / AddStatus / VerifyState / Phase / JobOrder / Job` khai cục bộ, thay bằng type chung:

| Type cục bộ (đã xoá) | Thay bằng | Nơi dùng |
|---|---|---|
| `JobOrder` | `TrackingJobOrder` (`@/lib/types/tracking`) | `missingFields`, `OrderStatusCell` |
| `Phase` | `TrackingPhase` (`@/lib/types/tracking`) | `phases` state, `onPhase`, `PhaseBadge` (`Record<TrackingPhase, string>`), `OrderStatusCell` |
| `Job` | `TrackingJobDetail` (`@/lib/hooks/useTrackingHistory`) | `jobs` state, `JobCard` props/state, 3 chỗ `as { job?: … }` |
| `Precheck` / `AddStatus` / `VerifyState` | không import lẻ — đã nằm trong `TrackingJobOrder` | — |

`Job → TrackingJobDetail` (không phải `TrackingJob`) vì response đã qua JSON: `created_at/updated_at` là string, `_id` → `id`. Cùng type mà `HistorySection`/`useTrackingJob` đang dùng → hai component về chung một nguồn.

Fetch `as { job?: TrackingJobDetail; error?: string }` ở: `startJobs` (POST /api/tracking/jobs), `pollJob` (GET /api/tracking/jobs/[id]), `submitAdd` (POST /api/tracking/jobs/[id]/add).

Đã thêm comment khối giải thích vì sao không được tái lập bản sao type.

## 2. `JobCard.summary` → dùng chung `summarizeTrackingOrders`

Body cũ (5 dòng tự đếm, chỉ biết `verify === "MISMATCH"`) bị thay hoàn toàn bằng
`summarizeTrackingOrders(job.orders)` — cùng hàm mà `summarizeJob` của service gọi.
Ràng buộc "phải khớp 1:1" không còn là comment nữa.

## 3. Dòng tóm tắt cuối job (`page.tsx`)

- `summary.total` → **`summary.selected`** (số đơn ĐÃ GỬI add, không phải `orders.length`).
- `"{n} lệch tracking"` → `"{n} chưa đạt xác minh"` (nay `mismatch` gộp 4 ca mới + legacy).
- Thêm dòng breakdown `text-xs text-muted-foreground` khi `mismatch > 0`, sinh bởi hàm mới
  `failureBreakdown(counts)`; nhãn lấy từ `VERIFY_LABEL` (không viết lại chuỗi), ví dụ:
  `Carrier lệch: 2 · Etsy chưa đánh dấu đã ship: 1`.
  Phần dư `mismatch − (not_found + code_mismatch + carrier_mismatch + not_shipped)` được in là
  `Lệch tracking: N` — chính là đơn legacy `MISMATCH` của job cũ trong Mongo.

## 4. Cell trạng thái — MỘT implementation dùng chung cho cả 2 tab

`components/tracking/HistorySection.tsx` export thêm `VerifyFailureCell` (+ helper nội bộ `EtsyEcho`).
`page.tsx` import và dùng lại → tab "Add tracking" (job đang chạy) và tab "Lịch sử" mô tả cùng một đơn **giống hệt nhau**, không còn 2 đoạn JSX song song.

- `OrderStatusCell` (page.tsx): `o.verify === "MISMATCH" || o.add_status === "FAILED"`
  → **`isVerifyFailure(o.verify) || o.add_status === "FAILED"`** → `<VerifyFailureCell order={o} />`.
- `ResultCell` (HistorySection.tsx): đổi y hệt.
- Nhánh `VERIFIED` ở cả hai: dùng `VERIFY_LABEL.VERIFIED`, và nếu backend vẫn đính `message`
  (ca hạ cấp `TREAT_NOT_SHIPPED_AS_FAILURE = false`) thì in message đó dạng ghi chú mờ.

### Bảng: VerifyState → nhãn + màu + thông tin đối chiếu hiển thị

Nhãn KHÔNG hardcode ở component — lấy từ `VERIFY_LABEL` trong `lib/types/tracking.ts`.

| `o.verify` | Nhãn (`VERIFY_LABEL`) | Icon + màu | Dòng phụ hiển thị |
|---|---|---|---|
| `PENDING` | *(không vào cell này)* | `text-muted-foreground` | "Đã gửi, đang xác minh…" / "Đang gửi…" theo `add_status` |
| `VERIFIED` | Đã add & xác minh | `CheckCircle2` · `text-success` | `o.message` (nếu có) dạng ghi chú mờ |
| `NOT_FOUND` | Không thấy tracking trên Etsy | `XCircle` · `text-destructive` | `o.message` + `Etsy đang có: …` |
| `CODE_MISMATCH` | Mã tracking lệch | `XCircle` · `text-destructive` | `o.message` + `Etsy đang có: <code> · <carrier>` |
| `CARRIER_MISMATCH` | Carrier lệch | `XCircle` · `text-destructive` | `o.message` + `Etsy đang có: <code> · <carrier>` |
| `NOT_SHIPPED` | Etsy chưa đánh dấu đã ship | `AlertTriangle` · **`text-warning`** | `o.message` + `Etsy đang có: <code> · <carrier> · CHƯA đánh dấu ship` |
| `MISMATCH` (legacy) | Lệch tracking | `XCircle` · `text-destructive` | `o.message` + `Etsy đang có: …` (job cũ không có `is_shipped` → không in gì thêm) |
| `SKIPPED` | Bỏ qua | `text-muted-foreground` | — (nếu `add_status === "FAILED"` thì vào `VerifyFailureCell` với nhãn "Add thất bại") |

Thông tin đối chiếu (`EtsyEcho`, đọc `o.verified`):
- `code` + `carrier_name` (bỏ phần rỗng) — so bằng mắt với cột **Tracking** và **Carrier** của chính dòng đó (= giá trị ĐÃ GỬI).
- `is_shipped === true` → thêm `đã đánh dấu ship`; `=== false` → `CHƯA đánh dấu ship`;
  **`undefined` → không render gì** (job cũ / extension cũ = KHÔNG CÓ THÔNG TIN, không suy thành "chưa ship").
- `o.verified` undefined → không render dòng phụ nào → UI lịch sử cũ không vỡ.

### Ràng buộc §4 đã tuân thủ

FE **không** đọc `verified.is_shipped` để quyết định thành/bại. `grep is_shipped` trong 2 file chỉ ra 2 chỗ, cả hai nằm trong `EtsyEcho` và chỉ chọn CHUỖI hiển thị. Mọi quyết định thành/bại suy từ `o.verify` (qua `isVerifyFailure`), nên cờ `TREAT_NOT_SHIPPED_AS_FAILURE` vẫn là chỗ sửa DUY NHẤT.

## 5. `CountBadges` (HistorySection.tsx)

Giữ nguyên badge `{counts.mismatch} lệch` (destructive) → lịch sử cũ không vỡ.
Thêm badge phụ `{counts.not_shipped} chưa ship` (`bg-warning/15 text-warning`) khi `> 0` — là **chi tiết của** `mismatch`, không cộng thêm.

---

## 6. Field FE đọc (cho qa-integration)

| Nơi | Field đọc |
|---|---|
| `OrderStatusCell` / `ResultCell` / `VerifyFailureCell` | `o.verify`, `o.add_status`, `o.selected`, `o.precheck`, `o.message`, `o.verified?.code`, `o.verified?.carrier_name`, `o.verified?.is_shipped`, `o.existing?.code`, `o.existing?.carrier_name`, `o.order_id`, `o.tracking_number`, `o.carrier`, `o.other_carrier` |
| `JobCard.summary` (S3) | `job.orders[].{selected, verify, add_status}` qua `summarizeTrackingOrders`; render `summary.{selected, verified, mismatch, failed, skipped, not_found, code_mismatch, carrier_mismatch, not_shipped}` |
| `CountBadges` (S2) | `counts.{total, verified, mismatch, not_shipped, failed, skipped}` |
| `JobCard` | `job.{id, shop_name, phase, error, orders}` |

**queryKey không đổi:** `["tracking-history", query]` và `["tracking-job", id]` (`lib/hooks/useTrackingHistory.ts`). `JobCard` vẫn poll `setInterval` 2s (ngoài TanStack Query) — nguyên trạng, không thuộc phạm vi bản sửa này.

⚠️ Điểm QA cần soi: `counts.not_shipped` giờ được render → projection Mongo của `listJobHistory` phải phủ `orders.selected/verify/add_status` (seam S4). `summarizeTrackingOrders` chỉ cần 3 field đó nên không cần nới projection.

---

## 7. Kết quả typecheck (thật)

```
$ npx tsc --noEmit
EXIT=0
```

Không có output — **sạch toàn repo**. Lỗi `lib/services/tracking.ts(93,3) TS2739` mà contract §6 dự báo đã không còn xuất hiện (backend-engineer đã sửa `summarizeJob` trước khi mình chạy).

`npx eslint` không chạy được: repo không có `eslint.config.*` (ESLint 10 bỏ `.eslintrc`) — không phải lỗi do bản sửa này.
