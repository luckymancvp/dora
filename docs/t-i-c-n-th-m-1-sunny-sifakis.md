# Plan: Thêm menu "Tracking" (add tracking lên Etsy) cho dora-1

## Context

Cần thêm chức năng add tracking lên Etsy ngay trong app **dora-1** (Next.js). Người dùng chọn (hoặc tự điền) shop, nhập **bảng nhiều dòng** `order_id | tracking | carrier`, bấm nút add. Quy trình yêu cầu:

1. **GET** shipments của các đơn để xem đã có tracking trên shop chưa.
2. Đơn **chưa có** → add.
3. Đơn **đã có** → cảnh báo; người dùng vẫn có thể chọn add tiếp.
4. Sau khi add → **GET lại** để so sánh, xác nhận đã add thành công.

### Kiến trúc thực tế (đã khảo sát)

- **dora-1 chính là backend của extension**: `BACKEND_ENDPOINT = https://messengermeta.vercel.app/v1/`. Luồng gửi message đã chạy qua dora-1 (`app/v1/messages/status/[id]/route.ts`), extension báo trạng thái về bằng `callBackend`.
- **Etsy chỉ truy cập được qua Meta-extension** (dùng cookie/session trình duyệt đã login Etsy). dora-1 **không** lưu OAuth credential từng shop, nên không gọi Etsy API trực tiếp. Cơ chế chuẩn = backend **publish lệnh qua Ably** (channel = tên shop) → extension thực thi → callback về backend.
- Extension (`E:\Pamo\META\Meta-extension\libs\`):
  - `etsy-tracking.js` → `fetchShipmentsByOrder()` (GET) và `batchCompleteOrders()` (POST add).
  - `ably.js` đã subscribe sẵn event `send-tracking` (→ `processSendTracking`) và `fetch-shipments` (→ GET rồi callback). Extension tự lấy `shopId` nếu truyền null.
  - **Vướng mắc duy nhất**: callback tracking hiện gọi `callMeraAdmin` (→ `MERA_ADMIN_ENDPOINT` localhost:8881), **không** phải `callBackend` (→ dora-1). Việc orchestrate GET→cảnh báo→add→verify phải nằm ở backend vì extension chỉ làm từng bước rời rạc.
- dora-1 đã có sẵn để tái dùng:
  - `lib/services/ably-publish.ts` — `publishChatMessage` (chọn 1 browser online qua presence), `getOnlineShopNames`.
  - `lib/services/shop-read.ts` + `lib/hooks/useShops.ts` — danh sách shop + trạng thái online.
  - `lib/http/cors.ts` (`corsJson`, `OPTIONS`) cho route extension; `lib/db/collections.ts` pattern collection lazy + index.
  - `components/sidebar.tsx` (`navItems`), pattern trang `app/auto-replies/page.tsx`, route `app/v1/messages/status/[id]/route.ts`.

### Quyết định đã chốt với người dùng
- Nhập liệu: **bảng bulk** (1 shop + nhiều dòng order/tracking/carrier).
- Verify: **đầy đủ** (pre-check cảnh báo + add + verify lại).
- Extension: **tập trung dora-1 trước**, phần extension chỉ ghi chú để triển khai sau.

---

## Thiết kế luồng (async, job-based)

Mỗi lần submit tạo 1 **tracking job** (1 shop, N đơn). State machine theo từng đơn, frontend **poll** job để cập nhật UI.

```
[Tạo job] → publish `fetch-shipments` (PRECHECK)
   ↓ extension GET → callback shipments-result
[PRECHECK xong] mỗi đơn: CLEAR (chưa có) | EXISTS (đã có → cảnh báo)
   ↓ user tick chọn đơn add (gồm CLEAR + EXISTS muốn override) → bấm Add
[publish `send-tracking`] (ADDING)
   ↓ extension batchCompleteOrders → callback status DONE/FAILED (cả batch)
[DONE] → publish `fetch-shipments` lần 2 (VERIFY)
   ↓ extension GET → callback shipments-result
[VERIFY] mỗi đơn so tracking trả về với tracking đã gửi → VERIFIED | MISMATCH
[COMPLETED]
```

Granularity từng đơn (thành công/sai) đến từ bước **VERIFY** (so sánh tracking GET lại), không phụ thuộc callback status (vốn chỉ DONE/FAILED cả batch).

---

## Thay đổi trong dora-1

### 1. Model & DB
- **`lib/db/collections.ts`**: thêm `getTrackingJobsCollection()` (collection `tracking_jobs`), index `_id` + `{ created_at: -1 }`, theo đúng pattern `ensureIndexes` hiện có.
- **`lib/types/tracking.ts`** (mới): 
  - `CARRIERS`: map tên→Etsy carrier id (theo `docs/tracking-api.md`): USPS=1, FedEx=2, UPS=3, DHL=4, Canada Post=5, Australia Post=6, **Royal Mail=7**, Deutsche Post=8, La Poste=9, Japan Post=10; không khớp → `carrier=-1` + `other_carrier=<tên>`.
  - `TrackingJobOrder`: `order_id, tracking_number, carrier, other_carrier?, precheck: "PENDING"|"CLEAR"|"EXISTS", existing?: {code,carrier_name}, selected: bool, add_status: "NEW"|"SENDING"|"DONE"|"FAILED", verify: "PENDING"|"VERIFIED"|"MISMATCH"|"SKIPPED", verified?: {code,carrier_name}, message?`.
  - `TrackingJob`: `_id, shop_name, shop_id?, client_id, sender_email, phase: "PRECHECK"|"AWAIT_CONFIRM"|"ADDING"|"VERIFY"|"COMPLETED", orders[], created_at, updated_at`.

### 2. Service
- **`lib/services/ably-publish.ts`**: tách helper `pickTargetClient(channel)` từ `publishChatMessage` (lấy clientId browser online cuối cùng); thêm:
  - `publishFetchShipments(shopName, { id, shopId, orderIds })` → event `fetch-shipments`, payload `{ id, shopId, orderIds, clientId }`.
  - `publishSendTracking(shopName, { id, shopId, orders })` → event `send-tracking`, payload `{ id, shopId, orders, clientId }` (orders đúng format `batchCompleteOrders`: `order_id, carrier, other_carrier, tracking_number, ...`). Trả về `clientId` hoặc null nếu shop offline.
- **`lib/services/tracking.ts`** (mới):
  - `createJob({ shopName, shopId?, orders, senderEmail })`: resolve shop online (presence) → nếu offline trả lỗi `shop_offline`; map carrier; insert job (phase PRECHECK); `publishFetchShipments`. Trả `jobId`.
  - `getJob(id)`: đọc job cho frontend poll.
  - `applyShipmentsResult(id, shipments)`: dùng cho cả 2 phase. PRECHECK → set mỗi đơn CLEAR/EXISTS (+existing) → phase AWAIT_CONFIRM. VERIFY → so sánh `tracking_code` trả về với `tracking_number` đã gửi → VERIFIED/MISMATCH → phase COMPLETED.
  - `confirmAdd(id, orderIds)`: đánh dấu `selected`, set add_status NEW cho các đơn chọn, phase ADDING, `publishSendTracking`.
  - `applyStatus(id, status)`: DONE → set add_status DONE cho đơn đang gửi, phase VERIFY, `publishFetchShipments` lần 2 (chỉ orderIds đã add). FAILED → add_status FAILED.

### 3. API web (có `auth()` như các route hiện tại)
- **`app/api/tracking/jobs/route.ts`** — `POST` tạo job. Body `{ shopName, shopId?, orders: [{order_id, tracking_number, carrier}] }`. Lấy `senderEmail` từ session.
- **`app/api/tracking/jobs/[id]/route.ts`** — `GET` poll job.
- **`app/api/tracking/jobs/[id]/add/route.ts`** — `POST { orderIds }` xác nhận add các đơn đã chọn.

### 4. API callback cho extension (public + CORS, theo mẫu `app/v1/messages/status/[id]`)
- **`app/v1/extension/trackings/shipments-result/route.ts`** — `POST { id, shipments, ordersToShipments }` → `applyShipmentsResult`. Re-export `OPTIONS`, dùng `corsJson`.
- **`app/v1/extension/trackings/status/[id]/route.ts`** — `POST { status, tracking? }` → `applyStatus`.

### 5. UI
- **`components/sidebar.tsx`**: import `Truck` (lucide-react); thêm `{ href: "/tracking", label: "Tracking", icon: Truck }` vào `navItems`.
- **`app/tracking/page.tsx`** (mới, `"use client"`, theo mẫu `app/auto-replies/page.tsx`):
  - Chọn shop từ `useShops()` (kèm badge online/offline) **hoặc** ô tự điền tên shop.
  - `<textarea>` paste bulk: mỗi dòng `order_id <tab> tracking <tab> carrier` (parser tách theo tab/khoảng trắng); preview bảng đã parse. (Khớp ví dụ: `4078744073  LT401168241GB  Royal Mail`.)
  - Nút **"Kiểm tra & Add"** → POST tạo job → poll `GET /api/tracking/jobs/[id]`.
  - Sau PRECHECK: bảng hiển thị mỗi đơn CLEAR (✓) hoặc EXISTS (⚠ + tracking cũ); checkbox "add tiếp" cho đơn EXISTS (đơn CLEAR mặc định chọn). Nút **"Xác nhận add"** → POST `/add`.
  - Sau VERIFY: cột kết quả VERIFIED ✅ / MISMATCH ❌ (kèm tracking thực tế) / FAILED.
- **`lib/hooks/useTrackingJob.ts`** (tùy chọn): React Query — mutation tạo job + `useQuery` poll (refetchInterval ~2s tới khi COMPLETED), giống pattern `lib/hooks/useShops.ts`.

---

## Phần Extension (GHI CHÚ — triển khai sau)

Chỉ sửa `E:\Pamo\META\Meta-extension\libs\ably.js`, **không đụng luồng message**. Event subscription (`send-tracking`, `fetch-shipments`) và hàm Etsy đã có sẵn — chỉ đổi nơi gửi callback từ `callMeraAdmin` (localhost:8881) sang `callBackend` (về dora-1, giống message):

- `processSendTracking`: thay `callMeraAdmin('POST', '/v1/extension/' + statusPath, ...)` → `callBackend('POST', statusPath, ...)` với `statusPath = 'extension/trackings/status/' + statusId` (lưu ý `BACKEND_ENDPOINT` đã kết thúc bằng `/v1/`).
- Handler `fetch-shipments`: thay `callMeraAdmin('POST', '/v1/extension/trackings/shipments-result', ...)` → `callBackend('POST', 'extension/trackings/shipments-result', ...)`.

Trước khi extension được cập nhật, các callback PRECHECK/VERIFY sẽ không về tới dora-1 → job đứng ở trạng thái chờ. dora-1 build xong vẫn test được bằng cách giả lập callback (xem dưới).

---

## Verification (kiểm thử)

**A. Test dora-1 độc lập (chưa cần extension):** giả lập extension bằng cách gọi trực tiếp route callback.
1. Tạo job qua UI (hoặc `curl POST /api/tracking/jobs`) với 1 shop + 2 đơn (1 đơn sẽ "đã có", 1 đơn "chưa có").
2. `curl POST /v1/extension/trackings/shipments-result` với payload mẫu (1 đơn có `tracking_code`, 1 đơn không) → `GET /api/tracking/jobs/[id]` thấy precheck CLEAR/EXISTS đúng.
3. `POST /api/tracking/jobs/[id]/add` chọn đơn → `curl POST /v1/extension/trackings/status/[id] {status:"DONE"}` → job sang VERIFY.
4. `curl POST .../shipments-result` lần 2 (lần này cả 2 đơn có tracking khớp) → job COMPLETED, VERIFIED.
- Chạy `npm run build` / `npm run lint` đảm bảo không lỗi type.

**B. Test end-to-end (sau khi cập nhật extension):** mở Etsy đã login extension đúng shop → chạy flow trên UI → kiểm tra tracking xuất hiện thật trên đơn Etsy, đơn đã có tracking hiện cảnh báo, verify báo VERIFIED.

## Out of scope
- Không gọi Etsy API trực tiếp / không lưu OAuth per-shop (giữ kiến trúc qua extension).
- Không sửa luồng message hiện có.
