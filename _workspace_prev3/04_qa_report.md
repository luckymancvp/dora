# 04 — QA tích hợp: so khớp chéo bản sửa VERIFY (add tracking)

**Phạm vi:** seam S1–S5 của `_workspace/01_architect_contract.md §5`, sau khi backend (`lib/services/tracking.ts`) và frontend (`app/tracking/page.tsx`, `components/tracking/HistorySection.tsx`) báo xong.
**Phương pháp:** đọc đồng thời 4 tầng + chạy CODE THẬT (trích nguyên văn `classifyVerify`/`indexShipments`/`carrierMatches`/`summarizeTrackingOrders` từ file nguồn, compile bằng tsc của repo rồi chạy) + truy vấn MongoDB THẬT (read-only).

---

## 0. Kết quả kiểm chứng bắt buộc (nguyên văn)

```
$ npx tsc --noEmit
EXIT=0        (không có output)

$ npm run build
… ƒ /api/tracking/jobs
  ƒ /api/tracking/jobs/[id]
  ƒ /v1/extension/trackings/shipments-result
  ○ /tracking
BUILD_EXIT=0
```

Cả hai sạch. Không còn `TS2305 VerifyFailureCell` (đã export ở `HistorySection.tsx:356`), không còn `TS2739` ở `summarizeJob`.

## 0.1 Ca 4171062664 — chạy trên code thật

Payload mô phỏng đúng normalize của extension (`dora-extension/libs/ably.js:362-372`), đơn `other_carrier = "US Standard"`, `tracking_number = 9214490416422002819594`:

| Ca | `carrier_name` Etsy | `is_shipped` | Kết quả THẬT |
|---|---|---|---|
| A | `US Standard` | `false` | **`NOT_SHIPPED`** — `Etsy nhận tracking 9214490416422002819594 (US Standard) nhưng CHƯA đánh dấu đã ship — đơn vẫn hiện "No tracking" trên Etsy` |
| B | `USPS` | `false` | **`CARRIER_MISMATCH`** — `Mã tracking khớp nhưng carrier lệch — đã gửi "US Standard", Etsy ghi "USPS"` |
| C | `""` | `false` | **`CARRIER_MISMATCH`** — `… Etsy ghi "?"` |
| D | *(không shipment)* | — | **`NOT_FOUND`** |
| E | shipment có nhưng `tracking_code=""` | `false` | **`NOT_FOUND`** |
| F | `US Standard` | `undefined` | `VERIFIED` (thoái hoá extension cũ, đúng contract §4) |

→ **Ca 4171062664 KHÔNG còn ra `VERIFIED` ở mọi biến thể thực tế.** Bug gốc đã đóng.

---

## FINDING

### CHẶN MERGE
Không có. Build/typecheck sạch, không seam nào lệch field, counts S2 = S3.

### NÊN SỬA

**N1 · S5 · tầng 1↔payload extension — lý do của `=== false` không còn đúng, cờ là lá chắn DUY NHẤT**
Backend chọn `is_shipped === false` (không phải `!== true`) với lập luận "extension cũ không gửi field → báo lỗi giả hàng loạt" (`02_backend_changes.md §2`).
Bằng chứng code THẬT đang chạy: `dora-extension/libs/ably.js:369` và `libs/etsy-tracking.js:233` đều là
`is_shipped: !!(t.isShipped ?? false)` → **luôn là boolean, không bao giờ `undefined`**.
Hệ quả: (a) lựa chọn của backend KHÔNG bỏ lọt ca 4171062664 (ca A ở trên đã chứng minh) — quyết định đúng, giữ nguyên; (b) nhưng nhánh `undefined` **không bao giờ chạy với extension hiện tại**, nó chỉ che cho bản extension thật sự cũ (thiếu hẳn field). Etsy trả thiếu `tracking.isShipped` sẽ bị extension ép thành `false` → dora-1 kết luận `NOT_SHIPPED`, đúng cái "báo động giả" mà cờ định tránh.
**Sửa gợi ý:** sửa comment `lib/services/tracking.ts:307-309` cho đúng sự thật (nhánh undefined chỉ dành cho extension đời cũ), và coi `TREAT_NOT_SHIPPED_AS_FAILURE` là lá chắn duy nhất — chạy canary 1 shop trước khi bật rộng.

**N2 · S1 · tầng 1→4 — `message` của đơn SKIPPED sau khi add KHÔNG BAO GIỜ hiển thị, job COMPLETED vẫn báo "đang xác minh…"**
Service ghi `verify="SKIPPED"` + `message` ở 2 chỗ: `lib/services/tracking.ts:422-425` (GET shipments lỗi ở phase VERIFY) và `:574-578` ("Đã add nhưng không verify được (shop offline)").
FE không có nhánh nào cho ca này:
- `app/tracking/page.tsx:911-912` → rơi vào `o.add_status === "DONE"` → in **"Đã gửi, đang xác minh…"**, mà poll đã dừng ở `page.tsx:573` khi `phase === "COMPLETED"` → đứng vĩnh viễn.
- `components/tracking/HistorySection.tsx:401-402` → in "Đã gửi".
Ca shop-offline (`:573-581`) KHÔNG set `job.error` nên cũng không có banner đỏ — người vận hành tưởng hệ thống đang chạy, trong khi đơn chưa hề được xác minh.
**Sửa gợi ý (FE):** trước nhánh `add_status === "DONE"`, thêm `if (o.verify === "SKIPPED" && o.message)` → icon xám/warning + `VERIFY_LABEL.SKIPPED` + `o.message`. Áp dụng cho CẢ HAI cell.

**N3 · S1 · tầng 1 — nhánh carrier không có cờ hạ cấp, message "?" vô nghĩa khi Etsy trả carrier rỗng**
`carrierMatches` (`lib/services/tracking.ts:75-79`) trả `false` khi carrier Etsy rỗng → `CARRIER_MISMATCH` màu đỏ với message `… Etsy ghi "?"` (ca C). Logic phòng thủ đúng, nhưng thông điệp không nói cho người dùng biết là **Etsy không trả tên carrier**, chứ không phải "carrier lệch"; và khác với `is_shipped`, nhánh carrier KHÔNG có hằng số hạ cấp nào nếu Etsy đổi cách đặt tên hàng loạt.
Dữ liệu thật (28 shipment trong `dora-master.order_tracking.trackings[]`): **0 bản ghi có `carrier_name` rỗng**, mọi giá trị đều là chuỗi người dùng tự nhập được Etsy trả nguyên văn (`USPS`, `USSS`, `uus`/`UUS`, `uss`, `UPPS`, `Vietnam Post`, `Australia Post`, `Royal Mail`, `17track`) → giả định A3 **được dữ liệu thật ủng hộ**, `normalizeCarrier` (lowercase) xử lý đúng ca `uus` vs `UUS`. Rủi ro thấp nhưng nên tách message riêng.
**Sửa gợi ý:** nếu `normalizeCarrier(etsy) === ""` → message `Etsy không trả tên carrier cho shipment này — không xác minh được carrier (đã gửi "${other_carrier}")`.

### GHI NHẬN

**G1 · A2 vẫn CHƯA được xác nhận đủ — số thật: 19 `true` / 9 `false`**
`dora-master.order_tracking` (ghi bởi CÙNG normalizer của extension): `is_shipped=true` 19 bản ghi, `false` 9 bản ghi. Vậy Etsy **có** trả `true` thường xuyên → `TREAT_NOT_SHIPPED_AS_FAILURE = true` không biến mọi đơn thành lỗi. Nhưng 9/28 ≈ 32% là `false`, và tập này trộn đơn cũ/đơn sync thường, không phải "ngay sau khi add" → chưa chứng minh được A2. **Đề nghị:** chạy 1 shop canary, đọc `counts.not_shipped`; nếu tăng vọt thì đổi `lib/services/tracking.ts:39` thành `false` (đã kiểm chứng ở G2 là đủ 1 dòng).

**G2 · Cờ `TREAT_NOT_SHIPPED_AS_FAILURE` THỰC SỰ là chỗ sửa duy nhất — đã kiểm chứng**
`grep -rn "is_shipped|isShipped" app lib components`: ngoài `lib/services/tracking.ts`, chỉ còn `components/tracking/HistorySection.tsx:336-337` (trong `EtsyEcho`, chỉ chọn CHUỖI hiển thị) và các comment. Không tầng nào (counts, badge, màu, message) tự suy ra "chưa ship". `summarizeTrackingOrders` chỉ đọc `verify/selected/add_status`. Contract §4 được tuân thủ.
(`lib/services/orders-tracking.ts:41` cũng có `is_shipped` nhưng thuộc luồng Orders khác, không tham gia quyết định verify.)

**G3 · S2 ↔ S3 counts — KHỚP TUYỆT ĐỐI, projection đủ field**
`HistoryProjection.orders` khai `TrackingOrderCountFields` (`tracking.ts:151`) và projection Mongo lấy đúng `orders.selected/verify/add_status` (`:187-189`) — đúng bằng tập field `summarizeTrackingOrders` đọc (`lib/types/tracking.ts:198-212`). Chạy thật trên cùng job (1 NOT_SHIPPED + 1 VERIFIED + 1 SKIPPED/không chọn):
```
S3 (client, orders đầy đủ) : {"total":3,"selected":2,"verified":1,"mismatch":1,…,"not_shipped":1,…}
S2 (server, sau projection): {"total":3,"selected":2,"verified":1,"mismatch":1,…,"not_shipped":1,…}
KHỚP: true
```
Không có bug "counts lịch sử sai âm thầm". `counts.not_shipped` mà `CountBadges` render được projection phủ.

**G4 · Backward-compat job cũ — không vỡ, không NaN**
Chạy thật `summarizeTrackingOrders`:
- doc legacy `verify:"MISMATCH"` → `mismatch:1` (vào badge "N lệch"), render qua `VerifyFailureCell` với nhãn `VERIFY_LABEL.MISMATCH = "Lệch tracking"`, icon đỏ. `failureBreakdown` (`page.tsx:120-121`) in phần dư là "Lệch tracking: N". Đúng contract.
- `verified` vắng mặt → `EtsyEcho` trả `null`, không render gì (`HistorySection.tsx:334`). `is_shipped` `undefined` **không** bị render thành "chưa ship" (`:336-337` so `=== true`/`=== false`). ✔
- Không có giá trị nào ra `NaN`/`undefined` trong counts.
- **Lưu ý:** doc thiếu HẲN field `verify` → mọi count = 0 trong im lặng (`total/selected` vẫn đúng), UI rơi vào nhánh "—". DB thật hiện có **0 doc** như vậy (`orders.verify $exists:false` = 0) nên chỉ là rủi ro lý thuyết.

**G5 · Chọn shipment tốt nhất — biểu thức ba ngôi ĐÚNG như mô tả**
`lib/services/tracking.ts:350-354`: `(carrierMatch ? 4 : 0) + (is_shipped===true ? 2 : is_shipped===undefined ? 1 : 0)`. Điểm tối đa khi KHÔNG khớp carrier là 2 < 4 = điểm tối thiểu khi khớp carrier ⇒ khớp carrier luôn thắng, không có ca đảo thứ tự. Chạy thật:
- shipment CŨ mã khác + shipment MỚI đúng → `VERIFIED` (không bị tracking cũ đè). ✔
- 2 shipment cùng mã: cũ (carrier lệch, shipped) vs mới (carrier khớp, chưa ship) → `NOT_SHIPPED` (ưu tiên carrier — đúng thiết kế). ✔
- 2 shipment cùng mã + cùng carrier khớp, một `false` một `true` → `VERIFIED`. ✔
- mọi shipment khớp mã đều lệch carrier → `CARRIER_MISMATCH`. ✔

**G6 · `CODE_MISMATCH` nhiều mã — FE KHÔNG render như mã đơn lẻ, nhưng ghép carrier gây hiểu nhầm**
`verified.code = "AAA111, BBB222"` (`tracking.ts:336`) đi vào `EtsyEcho` → `Etsy đang có: AAA111, BBB222 · USPS`, thẻ `<span className="block text-xs text-muted-foreground">`, **không font-mono**, không nằm trong ngữ cảnh "mã đơn lẻ" → không đọc nhầm thành 1 mã. Hai điểm nhỏ:
1. `carrier_name` chỉ là của `list[0]` nhưng đứng cạnh TOÀN BỘ danh sách mã → ngầm hiểu mọi mã cùng carrier đó.
2. `o.message` đã liệt kê y hệt danh sách mã ⇒ dòng `EtsyEcho` lặp lại thông tin.
**Sửa gợi ý (FE, không chặn):** trong `EtsyEcho`, nếu `value.code.includes(", ")` thì bỏ phần carrier (hoặc đổi thành `Etsy đang có N mã: …`).

**G7 · Rủi ro `NOT_FOUND` giả từ phía extension (ngoài phạm vi repo này)**
`ably.js:354-365` suy `order_id` từ map ngược `ordersToShipments`; shipment không có trong map → `order_id = ''` → `indexShipments` (`tracking.ts:89-91`) bỏ qua → đơn ra `NOT_FOUND` dù Etsy có tracking. Hướng lỗi AN TOÀN (báo động thừa, không báo VERIFIED giả) nên chỉ ghi nhận. KHÔNG sửa repo extension.

**G8 · DB thật là `dora`, KHÔNG phải `meta_local` như contract A4 ghi**
`.env.local` đặt `MONGODB_DB="dora"`; mặc định trong code là `meta_local` (`lib/db/collections.ts:21`). Kiểm chứng: `dora.tracking_jobs` có 13 job, `meta_local.tracking_jobs` có **0**. Contract §8 A4 và `02_backend_changes.md §4` ghi "DB `meta_local`" → ai debug theo tài liệu sẽ soi nhầm DB rỗng. Chỉ là sai tài liệu, code đúng (`getTrackingJobsCollection` → `getDb()` → env). `tracking_jobs` không đụng `dora-master` ✔.

**G9 · Hai tab mô tả lệch nhau ở 1 ca nhỏ (tồn tại từ trước)**
Đơn `precheck="EXISTS"`, không chọn: tab Lịch sử in "Đã có sẵn — không add" (`HistorySection.tsx:393-399`), tab job đang chạy in "Bỏ qua" (`page.tsx:917-918`) — do thứ tự nhánh khác nhau. Mọi ca xác minh KHÔNG đạt thì đã dùng CHUNG `VerifyFailureCell` nên giống hệt nhau ✔.

**G10 · Seam S1/S2 sạch ở cả 4 tầng**
- Field FE đọc ⊆ field service ghi: `verify/add_status/selected/precheck/message/verified.{code,carrier_name,is_shipped}/existing.*/order_id/tracking_number/carrier/other_carrier` — không field nào FE đọc mà service không bao giờ ghi, và ngược lại không field verify nào service ghi mà UI bỏ qua (trừ N2).
- Route `/api/tracking/jobs/[id]` (`route.ts:18`) trả `{ job }` = `serializeJob` pass-through, không lọc field → `verified.is_shipped` sống sót tới UI ✔.
- `/v1/extension/trackings/shipments-result` (`route.ts:21-22`) pass thẳng `ShipmentResultItem[]`, không remap → **không nuốt `is_shipped`** ✔ (đây là chỗ dễ chết nhất của bản sửa này).
- Hook `useTrackingHistory` gửi `q/shop/page/limit`, route đọc đủ 4 (`app/api/tracking/jobs/route.ts:18-24`) ✔. queryKey `["tracking-history", query]` chứa cả 4 biến filter → không kẹt cache; `["tracking-job", id]` ✔.
- Type contract dùng CHUNG, không còn bản sao cục bộ ở `page.tsx` (3 chỗ cast đều là `TrackingJobDetail`) ✔.

---

## Kết luận

1. **Ca 4171062664 giờ báo lỗi ĐÚNG:** `NOT_SHIPPED` (nếu Etsy ghi đúng "US Standard") hoặc `CARRIER_MISMATCH` (nếu Etsy ghi tên khác) — không còn đường nào ra `VERIFIED`. Chạy trên code thật, không phải suy luận.
2. Lựa chọn `is_shipped === false` của backend **đúng, không bỏ lọt ca lỗi**, nhưng lý do ghi trong tài liệu đã lỗi thời (N1).
3. Không có finding CHẶN MERGE. N2 nên sửa trước khi giao cho người vận hành (job COMPLETED vẫn hiện "đang xác minh…").
4. Rủi ro còn lại là **vận hành, không phải tích hợp**: chưa chứng minh Etsy luôn `isShipped=true` ngay sau add (G1) → cần canary; cờ hạ cấp đã kiểm chứng là sửa 1 dòng (G2).
