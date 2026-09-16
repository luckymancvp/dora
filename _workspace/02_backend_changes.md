# 02 — Backend: sửa verify Add Tracking

**File duy nhất đã sửa:** `lib/services/tracking.ts`.
KHÔNG chạm `lib/types/tracking.ts` (architect chốt), không chạm component/route/extension.

---

## 1. Đã sửa gì

| # | Chỗ | Thay đổi |
|---|---|---|
| 1 | đầu file (`:20-35`) | Thêm hằng `TREAT_NOT_SHIPPED_AS_FAILURE = true` + comment §4 (chỗ DUY NHẤT hạ cấp is_shipped) |
| 2 | cạnh `normalizeCode` (`:53-77`) | Thêm `normalizeCarrier()` (`trim → lowercase → [^a-z0-9]+ → " "`) + `carrierMatches()` (carrier Etsy rỗng = KHÔNG khớp) |
| 3 | `summarizeJob` (`:106-116`) | Body chỉ còn `return summarizeTrackingOrders(orders)`; param đổi sang `TrackingOrderCountFields` import từ types; xoá alias cục bộ `OrderCountFields`; comment mới trỏ logic về `lib/types/tracking.ts` |
| 4 | `HistoryProjection.orders` | Dùng `TrackingOrderCountFields` (projection giữ nguyên `orders.selected/verify/add_status`) |
| 5 | mới, trước `applyShipmentsResult` (`:288-390`) | `classifyVerify(o, list): VerifyOutcome` — hàm thuần phân loại 5 ca + `etsyCarrierText()` |
| 6 | comment `applyShipmentsResult` | Mô tả 4 ca lỗi mới thay vì "VERIFIED / MISMATCH" |
| 7 | nhánh `phase === "VERIFY"` (`:455-470`) | Gọi `classifyVerify`, ghi `verify` / `message` / `verified`; **xoá** `message`/`verified` cũ khi ca mới không có (verify có thể chạy lại) |

`"MISMATCH"` **không còn được ghi ở bất kỳ đâu** trong service (chỉ còn trong comment giải thích legacy). Kiểm chứng: `grep "MISMATCH"` → chỉ ra `CODE_MISMATCH` / `CARRIER_MISMATCH` + 3 dòng comment.

---

## 2. Bảng: ca lỗi → VerifyState → message

Điều kiện chạy tuần tự, dừng ở ca đầu tiên khớp.

| # | Điều kiện | `verify` | `message` ghi vào Mongo | `verified` |
|---|---|---|---|---|
| 1 | `list.length === 0` (Etsy không trả shipment nào CÓ MÃ cho đơn) | `NOT_FOUND` | `Không tìm thấy tracking nào trên Etsy sau khi add (đã gửi ${tracking_number} · ${other_carrier})` | *(xoá — Etsy không có gì để đối chiếu)* |
| 2 | có shipment nhưng không cái nào `normalizeCode` khớp | `CODE_MISMATCH` | `Mã tracking trên Etsy khác mã đã gửi — đã gửi ${tracking_number}, Etsy đang có ${codes}` | `code` = gộp mọi mã Etsy (`join(", ")`), `carrier_name` + `is_shipped` của `list[0]` |
| 3 | mã khớp, nhưng shipment tốt nhất KHÔNG khớp carrier | `CARRIER_MISMATCH` | `Mã tracking khớp nhưng carrier lệch — đã gửi "${other_carrier}", Etsy ghi "${etsy_carrier}"` | shipment tốt nhất |
| 4 | mã + carrier khớp, `is_shipped === false`, cờ = `true` | `NOT_SHIPPED` | `Etsy nhận tracking ${code} (${etsy_carrier}) nhưng CHƯA đánh dấu đã ship — đơn vẫn hiện "No tracking" trên Etsy` | shipment tốt nhất |
| 4' | như trên, cờ = `false` (hạ cấp) | `VERIFIED` | `Đã add ${code} (${etsy_carrier}) nhưng Etsy chưa đánh dấu đã ship — kiểm tra lại trên Etsy nếu đơn vẫn hiện "No tracking"` | shipment tốt nhất |
| 5 | khớp cả ba | `VERIFIED` | *(xoá message)* | shipment tốt nhất |

- `${etsy_carrier}` rỗng → in `?`.
- `verified.is_shipped` **chỉ được set khi Etsy trả đúng boolean**: `...(typeof best.is_shipped === "boolean" ? { is_shipped: best.is_shipped } : {})`. Extension cũ không gửi field → field vắng mặt trong Mongo = "không có thông tin", KHÔNG phải `false`.
- Điều kiện lỗi là `is_shipped === false`, **không** phải `!== true` — theo contract §1/§4 (`undefined` không chặn). Nếu để `!== true`, mọi shop dùng extension cũ sẽ báo `NOT_SHIPPED` giả hàng loạt.

### Nhánh khác gán `verify` (đã rà, vẫn nhất quán)

| Dòng | Ca | `verify` | Ghi chú |
|---|---|---|---|
| `:424` | lỗi GET shipments ở phase VERIFY | `SKIPPED` | đã add nhưng không verify được — đúng ngữ nghĩa SKIPPED, không phải 4 ca lỗi |
| `:460` | `add_status !== "DONE"` khi VERIFY | `SKIPPED` (chỉ khi đang `PENDING`) | 4 ca lỗi chỉ nói về đơn ĐÃ add xong |
| `:502` | `confirmAdd` — đơn không được chọn | `SKIPPED` | |
| `:547` | `applyStatus("FAILED")` | `SKIPPED` + `add_status = FAILED` | `summarizeTrackingOrders` đếm vào `failed`, không vào `skipped` |
| `:576` | shop offline lúc định verify | `SKIPPED` | |

Không nhánh nào ghi giá trị ngoài union mới.

---

## 3. Cách chọn shipment "tốt nhất"

Một đơn Etsy có thể có NHIỀU shipment (`indexShipments`, comment `:80-84`): add tracking mới vào đơn đã có tracking cũ. Nếu bạ đâu lấy đó, shipment CŨ (khác carrier, hoặc chưa ship) sẽ đè kết quả của shipment vừa add ĐÚNG → báo lệch giả.

Chọn trong tập `codeHits` (đã khớp mã), điểm cao nhất thắng, hoà điểm lấy cái Etsy trả trước:

```
score(s) = (carrierMatches(o.other_carrier, s.carrier_name) ? 4 : 0)
         + (s.is_shipped === true ? 2 : s.is_shipped === undefined ? 1 : 0)
```

- Khớp carrier (4) đè mọi thứ → nếu tồn tại shipment vừa khớp mã vừa khớp carrier, nó luôn được chọn ⇒ không bao giờ ra `CARRIER_MISMATCH` oan.
- Trong cùng mức carrier: `is_shipped === true` (2) > `undefined` (1) > `false` (0) ⇒ chỉ kết luận `NOT_SHIPPED` khi **mọi** shipment khớp mã+carrier đều `false`.

`carrierMatches` trả `false` khi carrier Etsy rỗng — rỗng không phải bằng chứng carrier đúng; coi "rỗng == rỗng" là khớp chính là nguồn của kết luận VERIFIED giả.

---

## 4. Seam cho QA / frontend (shape THẬT service ghi & trả)

Không đổi shape route nào. `GET /api/tracking/jobs/[id]` → `{ job: SerializedJob }`; `GET /api/tracking/jobs` → `{items,page,pageSize,total,totalPages}`; `POST /v1/extension/trackings/shipments-result` → `{ ok }`.

`orders[]` sau VERIFY (DB `meta_local`, collection `tracking_jobs`):

```jsonc
{
  "verify": "VERIFIED" | "NOT_FOUND" | "CODE_MISMATCH" | "CARRIER_MISMATCH" | "NOT_SHIPPED" | "SKIPPED",
  "message": "…",                 // VẮNG MẶT khi VERIFIED sạch (đã delete, không phải null)
  "verified": {                   // VẮNG MẶT ở ca NOT_FOUND
    "code": "…",                  // CODE_MISMATCH: nhiều mã gộp bằng ", "
    "carrier_name": "…",          // ĐÚNG NHƯ ETSY TRẢ, có thể là ""
    "is_shipped": true            // OPTIONAL — vắng mặt = không có thông tin, KHÔNG phải false
  }
}
```

Giá trị ĐÃ GỬI để đối chiếu vẫn ở `order.tracking_number` + `order.other_carrier` (không lặp trong `verified`).

Counts: `summarizeJob` → `summarizeTrackingOrders` ⇒ lịch sử (S2) và job đang chạy (S3) **bắt buộc** ra cùng số, miễn FE cũng gọi `summarizeTrackingOrders`.

---

## 5. Kết quả typecheck THẬT

`npx tsc --noEmit` — output nguyên văn, đúng 1 dòng:

```
app/tracking/page.tsx(26,26): error TS2305: Module '"@/components/tracking/HistorySection"' has no exported member 'VerifyFailureCell'.
```

- `lib/services/tracking.ts`: **0 lỗi**. `TS2739` ở dòng 93 (`summarizeJob` thiếu `not_found/code_mismatch/carrier_mismatch/not_shipped`) đã hết.
- Lỗi còn lại thuộc `app/tracking/page.tsx` ↔ `components/tracking/HistorySection.tsx` do frontend-engineer đang sửa song song (page.tsx import `VerifyFailureCell` mà HistorySection chưa export). **Không tự sửa** — ngoài phạm vi backend.

---

## 6. Rủi ro còn treo (giả định chưa xác nhận bằng dữ liệu Etsy thật)

| # | Giả định | Nếu sai |
|---|---|---|
| A1 | Extension có gửi `is_shipped` | không gửi → mọi đơn `undefined` → không ai bị `NOT_SHIPPED`, thoái hoá an toàn về "mã + carrier" |
| A2 | Etsy trả `isShipped: true` ngay sau add | sai → đổi `TREAT_NOT_SHIPPED_AS_FAILURE = false` (1 dòng, `lib/services/tracking.ts:35`); service ghi thẳng `VERIFIED` xuống Mongo nên counts/badge/màu ở mọi tầng tự đi theo, KHÔNG sửa thêm file nào |
| A3 | Etsy lưu `carrier_name` gần đúng chuỗi nhập ở `other_carrier` | sai → nới `normalizeCarrier` / thêm alias, chỉ trong file này. Cố ý chưa fuzzy: alias sai nguy hiểm hơn cảnh báo thừa |
