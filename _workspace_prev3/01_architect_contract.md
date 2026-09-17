# 01 — Hợp đồng kiểu: sửa lỗi VERIFY của chức năng Add Tracking

**Trạng thái:** đã chốt. File type ĐÃ SỬA: `lib/types/tracking.ts` (file duy nhất architect chạm).
**Phạm vi:** chỉ repo `D:\Pamo\dora-1`. KHÔNG sửa `dora-extension`, KHÔNG đổi shape payload extension gửi lên.

---

## 0. Bug đang sửa (tóm tắt 1 dòng)

`lib/services/tracking.ts:310-334` kết luận `VERIFIED` chỉ dựa trên `tracking_code`, bỏ qua `carrier_name` và `is_shipped` → đơn 4171062664 (shop CusGiftsCo, carrier "US Standard") báo "Đã add & xác minh" trong khi Etsy hiện "No tracking".

**Điều kiện VERIFIED MỚI = khớp CẢ BA:**
1. `normalizeCode(shipment.tracking_code) === normalizeCode(order.tracking_number)`
2. `normalizeCarrier(shipment.carrier_name) === normalizeCarrier(order.other_carrier)`
3. `shipment.is_shipped !== false` (xem §4 — `undefined` KHÔNG phải lỗi)

---

## 1. Type contract (đã có trong `lib/types/tracking.ts`)

### 1.1 `VerifyState` — mở rộng, giữ giá trị legacy

```ts
export type VerifyState =
  | "PENDING" | "VERIFIED"
  | "NOT_FOUND" | "CODE_MISMATCH" | "CARRIER_MISMATCH" | "NOT_SHIPPED"
  | "MISMATCH"   // LEGACY — chỉ đọc từ doc cũ, KHÔNG BAO GIỜ ghi mới
  | "SKIPPED";
```

| State | Ý nghĩa | Ai ghi |
|---|---|---|
| `PENDING` | chưa tới lượt verify | createJob |
| `VERIFIED` | khớp cả 3 điều kiện | applyShipmentsResult (VERIFY) |
| `NOT_FOUND` | Etsy không trả shipment nào cho đơn | applyShipmentsResult (VERIFY) |
| `CODE_MISMATCH` | Etsy có tracking nhưng mã khác mã đã gửi | applyShipmentsResult (VERIFY) |
| `CARRIER_MISMATCH` | mã khớp, carrier Etsy ghi khác `other_carrier` đã gửi | applyShipmentsResult (VERIFY) |
| `NOT_SHIPPED` | mã + carrier khớp nhưng `is_shipped === false` | applyShipmentsResult (VERIFY) |
| `MISMATCH` | **legacy**, job cũ trong Mongo | không ai ghi mới |
| `SKIPPED` | không add / add xong nhưng không verify được | confirmAdd, applyStatus |

**Backward-compat MongoDB:** giữ `"MISMATCH"` trong union là BẮT BUỘC. Hàng nghìn doc `tracking_jobs` cũ có giá trị này; bỏ đi thì `TrackingJobOrder` không mô tả đúng dữ liệu DB và UI lịch sử rơi xuống nhánh `—`.

### 1.2 Helper phân loại (dùng chung BE + FE)

```ts
export const VERIFY_FAILURE_STATES = ["NOT_FOUND","CODE_MISMATCH","CARRIER_MISMATCH","NOT_SHIPPED","MISMATCH"] as const;
export function isVerifyFailure(v: VerifyState): v is VerifyFailureState;
export const VERIFY_LABEL: Record<VerifyState, string>;   // nhãn ngắn tiếng Việt, đủ 8 giá trị
```

`VERIFY_LABEL` là `Record<VerifyState, string>` **cố ý** — thêm state mới mà quên nhãn = lỗi compile.

### 1.3 `TrackingValue` — thêm `is_shipped` (optional)

```ts
export interface TrackingValue {
  code: string;
  carrier_name: string;   // ĐÚNG NHƯ ETSY TRẢ (để đối chiếu)
  is_shipped?: boolean;   // optional: doc cũ / extension cũ → undefined
}
```

**Backward-compat:** optional, không phải `| null`. Doc cũ thiếu field → `undefined` → UI không render gì thêm, không vỡ. **Cấm** hiểu `undefined` là `false`.

Giá trị ĐÃ GỬI không lặp lại trong `TrackingValue` — nó đã nằm sẵn ở `order.tracking_number` + `order.other_carrier`. Đối chiếu "gửi vs Etsy trả" = đọc 2 nguồn đó cạnh nhau.

### 1.4 `TrackingJobCounts` — thêm breakdown, giữ `mismatch` làm tổng

```ts
export interface TrackingJobCounts {
  total; selected; verified;
  mismatch;          // = số đơn isVerifyFailure(verify) — GỘP cả 4 ca mới + legacy MISMATCH
  not_found; code_mismatch; carrier_mismatch; not_shipped;   // breakdown của mismatch
  failed; skipped;
}
```

`mismatch` giữ nguyên ngữ nghĩa "đơn có vấn đề" → badge "N lệch" ở `HistorySection.CountBadges` và khối summary ở `page.tsx` **không vỡ**, breakdown là tùy chọn hiển thị thêm.

### 1.5 `summarizeTrackingOrders` — NGUỒN DUY NHẤT tính counts

```ts
export type TrackingOrderCountFields = Pick<TrackingJobOrder, "selected"|"verify"|"add_status">;
export function summarizeTrackingOrders(orders: readonly TrackingOrderCountFields[]): TrackingJobCounts;
```

Ràng buộc cũ ở `lib/services/tracking.ts:86-90` ("logic PHẢI khớp 1:1 với `JobCard.summary`") chỉ là **comment** → dễ trôi. Giờ khớp **do dùng chung hàm**:
- BE: `summarizeJob(orders)` → `return summarizeTrackingOrders(orders)`.
- FE: `JobCard.summary` → `summarizeTrackingOrders(job.orders)`.

Hàm thuần, không import mongodb → client component import an toàn (tiền lệ: `carrierLabel` đã được `page.tsx` import).

> Khác biệt hiển thị: page.tsx in "Hoàn tất **N** đơn" với N = số đơn đã gửi → dùng `counts.selected`, **KHÔNG** dùng `counts.total` (= `orders.length`).

### 1.6 `ShipmentResultItem` — chỉ thêm comment, KHÔNG đổi shape

Shape do extension quyết định. Chỉ ghi rõ ngữ nghĩa `is_shipped?: boolean` (optional, `undefined` = không có thông tin).

---

## 2. Message chuẩn tiếng Việt cho từng ca

Backend ghi vào `order.message`. Mỗi message phải nêu **giá trị đã gửi vs giá trị Etsy trả**. Dùng đúng chuỗi dưới (QA sẽ so khớp):

| verify | `message` |
|---|---|
| `VERIFIED` | *(không set message)* |
| `NOT_FOUND` | `Không tìm thấy tracking nào trên Etsy sau khi add (đã gửi ${tracking_number} · ${other_carrier})` |
| `CODE_MISMATCH` | `Mã tracking trên Etsy khác mã đã gửi — đã gửi ${tracking_number}, Etsy đang có ${codes}` |
| `CARRIER_MISMATCH` | `Mã tracking khớp nhưng carrier lệch — đã gửi "${other_carrier}", Etsy ghi "${etsy_carrier}"` |
| `NOT_SHIPPED` | `Etsy nhận tracking ${code} (${etsy_carrier}) nhưng CHƯA đánh dấu đã ship — đơn vẫn hiện "No tracking" trên Etsy` |
| `NOT_SHIPPED` khi đã hạ cấp (§4) | `Đã add ${code} (${etsy_carrier}) nhưng Etsy chưa đánh dấu đã ship — kiểm tra lại trên Etsy nếu đơn vẫn hiện "No tracking"` |
| `SKIPPED` (lỗi fetch) | giữ nguyên chuỗi hiện có |

- `${codes}` = `list.map(s => s.tracking_code).join(", ")` (đơn có thể có nhiều shipment).
- `${etsy_carrier}` = `carrier_name` của shipment liên quan, rỗng thì in `?`.

**Thứ tự phân loại (bắt buộc, chạy tuần tự):**
1. `list` rỗng → `NOT_FOUND`
2. không shipment nào khớp mã → `CODE_MISMATCH` (`verified` = gộp mã Etsy đang có, `carrier_name` của `list[0]`)
3. có shipment khớp mã:
   - chọn **shipment khớp mã + khớp carrier** nếu có; nếu không có shipment nào vừa khớp mã vừa khớp carrier → `CARRIER_MISMATCH` (lấy shipment khớp mã đầu tiên làm `verified`)
   - shipment đã chọn có `is_shipped === false` → `NOT_SHIPPED` (hoặc `VERIFIED` khi hạ cấp, §4)
   - còn lại → `VERIFIED`
4. Mọi nhánh đều set `o.verified = { code, carrier_name, is_shipped }` từ shipment liên quan.

**Quy tắc so carrier** (backend tự implement trong service, đặt cạnh `normalizeCode`):
```
normalizeCarrier(s) = s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
```
→ "US Standard" == "us  standard" == "US-Standard". Cố ý KHÔNG fuzzy hơn (không viết alias USPS↔"US Postal Service") ở bản này: alias sai còn nguy hiểm hơn cảnh báo thừa. Nếu thực tế Etsy hay đổi tên, mở issue riêng.

---

## 3. Quyết định về seam type trùng lặp ở `app/tracking/page.tsx`

**Quyết định: XOÁ bản sao cục bộ, import type dùng chung.**

`page.tsx:32-57` tự khai `Precheck / AddStatus / VerifyState / Phase / JobOrder / Job`, trong khi `components/tracking/HistorySection.tsx` đã import `TrackingJobOrder` từ `lib/types/tracking` → **hai component đọc cùng một document Mongo qua hai định nghĩa type khác nhau**.

Lý do phải xoá (bằng chứng cụ thể từ bản chạy `npx tsc --noEmit` sau khi đổi type):
- Sau khi `VerifyState` mọc thêm 4 giá trị, **`page.tsx` không hề báo lỗi** — chỉ `lib/services/tracking.ts` báo. Nghĩa là UI sẽ im lặng rơi vào nhánh mặc định `—` cho cả 4 trạng thái lỗi mới, người dùng không thấy gì. Đây đúng là class bug đang sửa: server đổi ngữ nghĩa, UI không biết.
- Bản sao cục bộ chỉ "tình cờ" đúng; không có cơ chế nào giữ nó đúng.
- Sau khi import chung, `Record<VerifyState, ...>` và `switch` exhaustive trở thành **hàng rào compile-time** cho mọi lần mở rộng sau này.

Ánh xạ thay thế trong `page.tsx`:

| Type cục bộ (xoá) | Thay bằng |
|---|---|
| `Precheck` | `PrecheckState` từ `@/lib/types/tracking` |
| `AddStatus` | `AddStatus` từ `@/lib/types/tracking` |
| `VerifyState` | `VerifyState` từ `@/lib/types/tracking` |
| `Phase` | `TrackingPhase` từ `@/lib/types/tracking` |
| `JobOrder` | `TrackingJobOrder` từ `@/lib/types/tracking` |
| `Job` | `TrackingJobDetail` từ `@/lib/hooks/useTrackingHistory` |

`Job` → `TrackingJobDetail` (không phải `TrackingJob`) vì response API đã qua JSON: `created_at/updated_at` là **string**, `_id` thành `id`. `TrackingJobDetail` đã mô tả đúng điều đó và `HistorySection` đang dùng nó → cả hai component về chung một nguồn.

---

## 4. Cơ chế hạ cấp `is_shipped` — CHỈ MỘT CHỖ SỬA

**Rủi ro:** chưa xác nhận bằng dữ liệu Etsy thật rằng `isShipped` luôn `true` ngay sau khi add. Có thể Etsy trả `false` cho cả đơn add đúng → bản sửa này biến thành "báo động giả hàng loạt".

**Thiết kế:** một hằng số duy nhất ở đầu `lib/services/tracking.ts`:

```ts
/**
 * Verify có coi `is_shipped === false` là LỖI hay chỉ CẢNH BÁO.
 *
 * true  → đơn khớp mã + carrier nhưng Etsy chưa đánh dấu shipped ⇒ verify = "NOT_SHIPPED" (lỗi).
 * false → vẫn tính VERIFIED, chỉ đính message cảnh báo.
 *
 * ĐÂY LÀ CHỖ DUY NHẤT cần sửa để hạ cấp/nâng cấp nhánh is_shipped.
 * Không sửa thêm ở bất kỳ file nào khác: counts, badge, màu sắc đều suy ra từ
 * `verify` nên tự động đi theo.
 */
const TREAT_NOT_SHIPPED_AS_FAILURE = true;
```

Dùng đúng 1 lần, trong hàm phân loại:
```ts
verify = TREAT_NOT_SHIPPED_AS_FAILURE ? "NOT_SHIPPED" : "VERIFIED";
message = TREAT_NOT_SHIPPED_AS_FAILURE ? <msg lỗi> : <msg cảnh báo>;   // xem §2
```

Vì sao đúng 1 chỗ là đủ: khi hạ cấp, service ghi thẳng `VERIFIED` xuống Mongo → `summarizeTrackingOrders` đếm vào `verified`, `mismatch` giảm, `OrderStatusCell`/`ResultCell` render nhánh success, `counts.not_shipped` = 0. Không tầng nào có logic riêng về `is_shipped`.

**Cấm:** FE không được tự đọc `verified.is_shipped` để quyết định thành công/thất bại (chỉ được dùng để hiển thị thông tin phụ). Nếu FE tự quyết, hằng số trên mất tác dụng và ta có 2 chỗ sửa.

---

## 5. Bảng seam (đầu vào cho `qa-integration`)

| # | Dữ liệu | Service trả gì | Route `json()` gì | Hook cast gì | Component đọc field nào |
|---|---|---|---|---|---|
| S1 | Kết quả verify 1 đơn | `applyShipmentsResult` ghi Mongo: `orders[].verify: VerifyState`, `orders[].verified: TrackingValue`, `orders[].message` | `GET /api/tracking/jobs/[id]` → `{ job: SerializedJob }` | `useTrackingJob` → `{ job: TrackingJobDetail }`; `page.tsx` `pollJob` fetch thẳng → `{ job: TrackingJobDetail }` | `OrderStatusCell` (page.tsx:853) + `ResultCell` (HistorySection.tsx:317) đọc `o.verify`, `o.message`, `o.verified?.code`, `o.verified?.carrier_name` |
| S2 | Counts lịch sử | `listJobHistory` → `TrackingHistoryResponse`, `counts` từ `summarizeJob` → `summarizeTrackingOrders` | `GET /api/tracking/jobs` → shape PHẲNG `{items,page,pageSize,total,totalPages}` (KHÁC POST bọc `{job}`) | `useTrackingHistory` cast `as TrackingHistoryResponse`, queryKey `["tracking-history", query]` | `CountBadges` đọc `counts.{total,verified,mismatch,failed,skipped}` (+ breakdown mới nếu dùng) |
| S3 | Counts job đang chạy | *(không qua API)* `JobCard.summary` tính client-side từ `job.orders` | — | queryKey: không (poll `setInterval` 2s) | khối summary `page.tsx:686-717` đọc `summary.{total→selected,verified,mismatch,failed,skipped}` |
| S4 | Projection Mongo ↔ counts | projection `orders.selected/verify/add_status` (`tracking.ts:143-154`) | — | — | phải phủ đủ field `TrackingOrderCountFields` đọc |
| S5 | Payload extension → verify | `applyShipmentsResult(id, shipments, error)` đọc `ShipmentResultItem.{tracking_code, carrier_name, is_shipped}` | `POST /v1/extension/trackings/shipments-result` → `{ ok }` | — (extension gọi) | — |

**Điểm QA phải soi nhất:** S1 và S3 — `page.tsx` từng có type cục bộ nên compiler KHÔNG bắt được lệch; sau khi FE làm task §7.1 thì compiler mới là hàng rào. S2↔S3 phải cho cùng con số trên cùng một job.

---

## 6. Task backend (`backend-engineer`)

**File: `lib/services/tracking.ts`** (file duy nhất backend cần sửa)

1. **Thêm hằng số hạ cấp** `TREAT_NOT_SHIPPED_AS_FAILURE = true` ở đầu file, kèm comment đúng như §4.
2. **Thêm `normalizeCarrier()`** cạnh `normalizeCode()` (§2), có comment giải thích vì sao không fuzzy.
3. **Viết lại nhánh `job.phase === "VERIFY"`** (hiện `:310-334`) theo thứ tự phân loại ở §2:
   - `NOT_FOUND` / `CODE_MISMATCH` / `CARRIER_MISMATCH` / `NOT_SHIPPED` / `VERIFIED`
   - luôn set `o.verified = { code, carrier_name, is_shipped }`
   - **`is_shipped === false` mới là lỗi; `undefined` bỏ qua** (extension cũ)
   - message đúng chuỗi ở §2
   - KHÔNG bao giờ ghi `"MISMATCH"` nữa
4. **`summarizeJob`**: giữ tên + chữ ký export (đang dùng ở `listJobHistory:174`), nhưng body chỉ còn `return summarizeTrackingOrders(orders);`. Đổi alias `OrderCountFields` → import `TrackingOrderCountFields` từ types. Thay comment `:85-90` bằng ghi chú "logic sống ở `lib/types/tracking.ts#summarizeTrackingOrders`, dùng chung với page.tsx".
5. **Cập nhật comment đầu `applyShipmentsResult` (`:251-255`)**: mô tả 4 ca lỗi mới thay vì "VERIFIED / MISMATCH".
6. Không đổi projection (`orders.selected/verify/add_status` vẫn đủ). Không đổi shape response của bất kỳ route nào.
7. Không sửa `app/v1/extension/trackings/shipments-result/route.ts` (đã pass thẳng `ShipmentResultItem[]`).

**Lỗi typecheck phải khử:** `lib/services/tracking.ts(93,3) TS2739` — `summarizeJob` thiếu `not_found, code_mismatch, carrier_mismatch, not_shipped` (được giải quyết bởi task 4).

---

## 7. Task frontend (`frontend-engineer`)

### 7.1 `app/tracking/page.tsx` — bỏ type cục bộ (bắt buộc, §3)
- Xoá `:32-57` (`Precheck/AddStatus/VerifyState/Phase/JobOrder/Job`), import theo bảng ánh xạ §3.
- `import type { TrackingJobDetail } from "@/lib/hooks/useTrackingHistory"` cho `Job`; đổi các chỗ `as { job?: Job }` thành `as { job?: TrackingJobDetail; error?: string }`.
- `PhaseBadge` giữ `Record<TrackingPhase, string>` (đã đủ 5 giá trị).

### 7.2 `app/tracking/page.tsx` — `JobCard.summary` (`:629-637`)
- Thay toàn bộ body bằng `summarizeTrackingOrders(job.orders)` (import từ types).
- Khối render `:686-717`: đổi `summary.total` → `summary.selected`; điều kiện tô cảnh báo dùng `summary.mismatch || summary.failed` (giữ nguyên, nay `mismatch` đã gồm 4 ca mới).
- Thêm dòng breakdown khi `> 0`, ví dụ: `2 chưa ship · 1 carrier lệch` từ `summary.not_shipped / carrier_mismatch / code_mismatch / not_found`.

### 7.3 `app/tracking/page.tsx` — `OrderStatusCell` (`:853-895`)
- Nhánh `o.verify === "MISMATCH" || o.add_status === "FAILED"` → đổi thành `isVerifyFailure(o.verify) || o.add_status === "FAILED"`.
- Hiển thị: icon đỏ + `o.message` + phần đối chiếu `(Etsy: ${o.verified.code}${carrier ? " · " + carrier : ""})`.
- Ca `NOT_SHIPPED` nên dùng **màu warning** (không phải destructive) — Etsy ĐÃ nhận tracking, chỉ chưa đánh dấu ship; dùng `VERIFY_LABEL[o.verify]` làm nhãn ngắn.

### 7.4 `components/tracking/HistorySection.tsx`
- `ResultCell` (`:328`): cùng cách đổi như 7.3 (`isVerifyFailure`), cùng cách hiển thị để lịch sử và job đang chạy nói **giống hệt nhau**.
- `CountBadges` (`:225-253`): giữ badge `mismatch` "N lệch"; thêm badge phụ cho `not_shipped` (warning) khi `> 0`. Doc cũ (legacy `MISMATCH`) vẫn rơi vào badge "N lệch" → không vỡ.

### 7.5 Cấm
- KHÔNG tự đọc `verified.is_shipped` để quyết định thành/bại (§4). Chỉ hiển thị.
- KHÔNG copy lại logic đếm counts; luôn gọi `summarizeTrackingOrders`.

---

## 8. Giả định đã chốt (không có dữ liệu Etsy thật để xác nhận)

| # | Giả định | Nếu sai thì sửa ở đâu |
|---|---|---|
| A1 | Extension hiện tại có gửi `is_shipped` trong `ShipmentResultItem` | nếu không gửi → mọi đơn `undefined` → không ai bị `NOT_SHIPPED`, hệ thống thoái hoá về hành vi "mã + carrier" (an toàn, không cần sửa) |
| A2 | Etsy trả `isShipped: true` ngay sau khi add thành công | sai → đổi `TREAT_NOT_SHIPPED_AS_FAILURE = false` (§4), 1 dòng |
| A3 | Etsy lưu `carrier_name` gần đúng chuỗi người dùng nhập vào `other_carrier` | sai → nới `normalizeCarrier` hoặc thêm bảng alias, chỉ trong `lib/services/tracking.ts` |
| A4 | Dữ liệu ở `meta_local` (collection `tracking_jobs`), không đụng `dora-master` | — |
| A5 | Job cũ trong Mongo giữ nguyên, không migrate | phải giữ `"MISMATCH"` trong union (§1.1) |
