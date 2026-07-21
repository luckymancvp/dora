# QA Integration Report — Lịch sử add tracking

## QA lượt 1 — backend (frontend làm song song, chưa QA hook/component)

Phạm vi: so khớp chéo 4 tầng backend cho seam list lịch sử job. Frontend (hook/component) sẽ QA ở lượt sau.

### Kết quả tổng
- `npx tsc --noEmit` → **exit 0, sạch** (không lỗi type).
- **Không có finding CHẶN MERGE, không có NÊN SỬA.** Backend khớp contract 1:1. Không sửa code.
- 3 ghi nhận (GHI NHẬN) để lượt QA frontend đối chiếu.

### So khớp chéo từng seam (contract (d) ↔ code thật)

| Seam | Contract | Code thật | Kết luận |
|---|---|---|---|
| `id` | `_id.toHexString()` | `services/tracking.ts:162` | OK |
| `shop_name` | doc.shop_name | projection `:143` + map `:163` | OK |
| `shop_id` | number\|null | `:164` `d.shop_id ?? null`, type `types/tracking.ts:96` | OK |
| `sender_email` | doc.sender_email | `:165` | OK |
| `phase` | TrackingPhase | `:166` | OK |
| `error?` | optional, vắng khi không lỗi | `:167` spread `...(d.error ? {error} : {})` — JSON omit đúng | OK |
| `counts.*` | summarizeJob = JobCard.summary | xem mục "counts" dưới | OK |
| `created_at/updated_at` | ISO string | `:170-171` `.toISOString()` | OK |
| Response wrapper | object PHẲNG (khác POST `{job}`) | `route.ts:26` `NextResponse.json(result)` — không bọc; POST `:75` vẫn `{job}` | OK |
| query `q` | filter orders.order_id/tracking_number, khớp CHÍNH XÁC | `route.ts:21` → `services:130` `$or:[{"orders.order_id":q},{"orders.tracking_number":q}]` | OK |
| query `shop` | filter shop_name | `services:132` `filter.shop_name = shop` | OK |
| query `page/limit` | parseInt default 1/20, clamp | `route.ts:18-24` + clamp `services:121-122` (page≥1, limit[1,100]) | OK |
| chi tiết orders[] | KHÔNG trong list | projection chỉ 3 field/đơn `services:145-147` | OK |

### Projection ↔ summarizeJob (kiểm field đọc mà service phải trả)
`summarizeJob` (`services/tracking.ts:85-96`) đọc đúng 3 field: `o.selected`, `o.verify`, `o.add_status`.
Projection (`:145-147`) kéo đúng `orders.selected` + `orders.verify` + `orders.add_status`.
→ **Không thiếu field**. Guard `Array.isArray(d.orders) ? d.orders : []` (`:168`) phòng thủ khi orders vắng.

### counts ↔ JobCard.summary (page.tsx:520-528)
Logic `verified/mismatch/failed/skipped` khớp **1:1** với page.tsx `:523-526`:
- verified = sent.filter(verify==="VERIFIED")
- mismatch = sent.filter(verify==="MISMATCH")
- failed = sent.filter(add_status==="FAILED")
- skipped = sent.filter(verify==="SKIPPED" && add_status!=="FAILED")

Khác biệt `total`: page.tsx `total = sent.length` (hiển thị), summarizeJob `total = orders.length` + thêm `selected = sent.length`.
→ **Đúng theo contract** (line 13/86 định nghĩa `total = orders.length`, `selected = số selected=true`). KHÔNG phải bug — là override có chủ đích, đã document ở backend note #4.

### DB đúng chưa (bug đặc thù meta_local vs dora-master)
`getTrackingJobsCollection()` (`collections.ts:104-107`) dùng `getDb()` → `DB_NAME = meta_local` (`:17`).
→ **Đúng** `meta_local.tracking_jobs` theo contract. Không nhầm sang `dora-master` (đó là stores/etsy_orders/order_tracking).

### Index (indexes.ts)
`TRACKING_JOB_INDEXES` (`:95-106`) trên collection `tracking_jobs` (`:152`):
- `idx_created_at {created_at:-1}` — sort list ✓
- `idx_shop_created {shop_name:1, created_at:-1}` — filter shop + sort ✓
- `idx_orders_order_id {"orders.order_id":1}` — multikey search q ✓
- `idx_orders_tracking_number {"orders.tracking_number":1}` — multikey search q ✓
Tên field khớp filter `services:130`. `ensureIndexes` idempotent (isAlreadyExistsError) → an toàn.

---

## GHI NHẬN (chuyển tiếp cho lượt QA frontend — chưa phải bug backend)

**G1. Wrapper phẳng vs `{job}`.** GET trả phẳng `{items,page,pageSize,total,totalPages}`; POST trả `{job}` — cùng file route. Hook `useTrackingHistory` PHẢI đọc phẳng (`res.json() as TrackingHistoryResponse`), KHÔNG `.job`. Cần verify ở lượt FE.

**G2. `created_at` là string.** List trả ISO string; `SerializedJob` (dùng cho chi tiết `[id]`) khai `Date`. Component chi tiết thực tế nhận string qua JSON — hàm format ngày ở FE phải chịu được string. Verify ở lượt FE.

**G3. `error` optional omit.** Field `error` vắng mặt trong JSON khi job không lỗi (không phải `null`/`undefined` tường minh). FE dùng `item.error &&` guard, không giả định luôn có key.

## Đã sửa
Không có (không phát hiện lệch tầng thật ở backend).

## tsc
`npx tsc --noEmit` → exit 0, không lỗi.

---

## QA lượt 2 — toàn tuyến (frontend seam: hook + component + tab)

Phạm vi: so khớp chéo 4 tầng cho seam frontend của "Lịch sử add tracking". Xác nhận 3 GHI NHẬN lượt 1 (G1/G2/G3), hook↔route params, component↔contract↔service, và luồng add cũ.

### Kết quả tổng
- `npx tsc --noEmit` → **exit 0, sạch**.
- `npm run build` → **exit 0**, `/tracking` compile OK. Không lỗi thuộc tính năng này.
- **0 CHẶN MERGE, 0 NÊN SỬA.** Không sửa code. 1 GHI NHẬN mới (F1).

### 3 GHI NHẬN lượt 1 — đã đóng ở frontend
| Ghi nhận | Điểm FE | Kết luận |
|---|---|---|
| **G1** đọc object PHẲNG, không `.job` | `useTrackingHistory.ts:36` cast `TrackingHistoryResponse`; đọc `data.items/page/totalPages/total` (`HistorySection.tsx:72-74,146`). Route `route.ts:26` `json(result)` phẳng | OK — khớp |
| **G2** `created_at` ISO string, không gọi method Date trực tiếp | `HistorySection.tsx:35-45` `formatDateTime` bọc `new Date(iso)` + guard `Number.isNaN` fallback; gọi tại `:197` | OK — không gọi `.toLocaleString` trực tiếp trên string |
| **G3** `error` optional omit-key | `HistorySection.tsx:208` `item.error ?`; `:220` truyền `error?: string`; `:278` `error &&` guard | OK — không giả định key luôn có |

### Hook ↔ route GET (params + queryKey + wrapper)
| Seam | Hook | Route | Kết luận |
|---|---|---|---|
| Tên param | `q,shop,page,limit` (`useTrackingHistory.ts:29-32`) | đọc `q,shop,page,limit` (`route.ts:18-24`) | OK — trùng tên 4/4 |
| `q/shop` chỉ set khi non-empty | `:29-30` `if(trim())` | route `?? "").trim()` default "" | OK — thiếu param = không lọc |
| queryKey đủ biến | `["tracking-history", query]`, query = `{q,shop,page,limit}` (`:41`) | — | OK — mọi filter vào key |
| `useTrackingJob` wrapper `{job}` | `:52` cast `{job}`, trả `data.job` | `[id]/route.ts:18` `json({job})` | OK — khớp wrapper |

### Component ↔ contract ↔ service (field đọc phải tồn tại + đúng nguồn)
- Dòng list đọc `counts.{total,verified,mismatch,failed,skipped}` (`:229-249`), `phase`, `error`, `sender_email`, `shop_name`, `created_at`, `id` — **tất cả có trong `TrackingHistoryItem`/`TrackingJobCounts`** (`types/tracking.ts:73-105`) và **service trả đủ** (`services/tracking.ts:161-172`). `PHASE_LABEL` phủ đủ 5 giá trị `TrackingPhase`.
- **Nguồn bảng chi tiết đúng**: bảng đơn đọc từ `useTrackingJob(id)` → GET `[id]` → `getJob` trả `SerializedJob` **full orders** (`services/tracking.ts:66-68`), KHÔNG dùng projection list (list chỉ kéo `orders.selected/verify/add_status` cho counts). Field đọc trong bảng (`order_id, tracking_number, carrier, other_carrier, selected, verify, add_status, precheck, message, verified?.code`) đều có trong `TrackingJobOrder` (`types/tracking.ts:25-41`). → **Không nhầm nguồn**.
- **Search debounce reset page**: `HistorySection.tsx:57-63` `setQ + setPage(1)` sau 350ms. Shop select cũng `setPage(1)` (`:100-103`). OK.
- **Filter shop = shop_name**: option `value={s.shopName}` (`:108`) từ `useShops` (`ShopItem.shopName`); backend `filter.shop_name = shop` (`services:132`); `createJob` lưu `shop_name = shopName` (`:221`, cùng nguồn shop select tab add). → **Giá trị khớp**, lọc chính xác.

### Luồng add cũ (page.tsx) — không bị phá
- `tab==="add"` bọc TOÀN BỘ luồng cũ trong `<>...</>` (`page.tsx:248-347`); JobCard/confirmAll/poll/reset không đổi logic. State `jobs`/`blocks` nằm ở component cha (không unmount khi đổi tab) → giữ nguyên khi quay lại.

### GHI NHẬN mới
**F1 (GHI NHẬN).** Chuyển sang tab "Lịch sử" **unmount toàn bộ subtree add** (`page.tsx:248` conditional render), gồm mọi `JobCard`. `JobCard` giữ state `job/selected` cục bộ và `setInterval` poll bị `clearInterval` khi unmount (`page.tsx:445-449`). Hệ quả:
  - Job **vẫn chạy server-side** qua extension — không mất dữ liệu.
  - Khi quay lại tab add, JobCard **remount từ `initial`** (job lúc tạo, phase PRECHECK) và **poll tự khôi phục** trong ≤2s (điều kiện poll cho phép khi phase != AWAIT_CONFIRM/COMPLETED) → UI đồng bộ lại từ server.
  - Mất mát tạm: nếu đang ở AWAIT_CONFIRM và đã tick chọn đơn, `selected` cục bộ + ref `initializedSelection` bị reset → lựa chọn khởi tạo lại theo precheck (CLEAR = chọn sẵn). UX degrade nhẹ, không mất job.
  - **Mức: GHI NHẬN** (không phải lệch shape; hồi phục được qua poll). Nếu muốn giữ nguyên theo dõi khi đổi tab, cân nhắc render 2 tab bằng `hidden` thay vì unmount, hoặc nâng state `job` của JobCard lên cha.

### Đã sửa (lượt 2)
Không có — không phát hiện lệch tầng thật ở frontend.

### tsc / build (lượt 2)
- `npx tsc --noEmit` → exit 0.
- `npm run build` → exit 0, `/tracking` OK.
