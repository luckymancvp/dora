# 01 — Hợp đồng: Tracking giao hàng chung Mera ↔ dora-1 (push + màn /delivery)

Ngày: 2026-10-21 · Phạm vi dora-1 = plan Mera §6 "Bước 2 — dora-1 push" + "Bước 4 — dora-1 frontend".
Hợp đồng liên hệ thống CỐ ĐỊNH: `D:\Pamo\Mera\_workspace\delivery-tracking\04_dora_shared_plan.md` (D1–D9, §4 push, §5 project Dora). Không lệch.
API Mera được proxy: `D:\Pamo\Mera\_workspace\delivery-tracking\02_api_contract.md` + controller `mera-fulfill-backend/internal/controllers/delivery_tracking_controller.go` (nhánh dev — có thêm `provider`, `rating`, bulk-refresh).

## 0. Quyết định chốt (dora-1)

| # | Quyết định |
|---|---|
| A1 | dora-1 KHÔNG có role: mọi user đăng nhập thấy hết. Mọi gọi Mera dùng internal key (scope = mọi project + Dora). `X-Actor-Email` = email session (route user) / `dora-1-system` (push). |
| A2 | Route trang mới `/delivery` (vì `/tracking` = Add Tracking). Sidebar: `{ href: "/delivery", label: "Giao hàng", icon: PackageCheck }` ngay sau mục Tracking. |
| A3 | Route `/api/delivery/*` là proxy MỎNG: chuyển tiếp query/body, chuẩn hoá mảng rỗng, chuyển tiếp nguyên body lỗi Mera. Không validate lại tham số list (Mera validate). |
| A4 | Push chỉ đọc `sheet_rows` đã có (không sync sheet trong cron). |
| A5 | **Cờ bật push** env `DELIVERY_PUSH`: unset/`""`/`off` = tắt (outcome `disabled`); `*` = mọi config enabled; còn lại = danh sách `configId` hex phân tách dấu phẩy. Cần cho bước rollout plan §6 "push một scope trước". Mặc định TẮT. |
| A6 | `window_from` = 00:00 giờ VN của (hôm nay VN − 60 ngày) → ổn định trong ngày. Hash gồm `window_from` ⇒ đổi ngày thì hash đổi ⇒ tự gửi lại ≥1 lần/ngày; thêm luật an toàn: `deliveryPushedAt` > 24h ⇒ gửi dù hash trùng. |
| A7 | Dòng `paid_at` không parse được VẪN gửi với `paid_at: null` (Mera đếm `skipped_invalid` → quan sát được). Dòng parse được mà `< window_from` thì KHÔNG gửi. |
| A8 | Snapshot rỗng (0 dòng hợp lệ) vẫn gửi: `chunk_total: 1, rows: []` để Mera gỡ ref trong cửa sổ. **Giả định cần Mera BE chấp nhận** (xem §7). |
| A9 | XLSX dùng `exceljs` có sẵn (dynamic import phía client), KHÔNG thêm `xlsx`. |
| A10 | Không icon hội thoại Dora của Mera. Mỗi đơn có link `/orders?search=<etsy_receipt_id>` (fallback `normalizeOrderId(order_id)`) — trang Orders đã đọc `?search=`. Đơn `source="dora_sheet"` có nhãn nhỏ "Dora". |
| A11 | Helper thuần của Mera FE chép vào `lib/delivery/*`. dora-1 không có test runner → KHÔNG port file test, không thêm vitest (không tự mở rộng phạm vi). |
| A12 | Project select: `''` = Tất cả (không nhớ project như Mera); `<hex>`; `dora`; `dora:<store>`. Không có `TRACKING_ALL_PROJECTS`/`loadSelectedProject`. |

## 1. Type contract

### 1.1 `lib/types/delivery.ts` — ĐÃ TẠO (nguồn sự thật, đọc file)
- **A. Mirror Mera (snake_case, pass-through):** `EtsyReview`, `DeliveryStatus`, `DeliveryEvent`, `DeliveryTrackingOrderItem`, `DeliveryOrderSource = "mera"|"dora_sheet"`, `DeliveryTrackingOrder` (+`source?`), `DeliveryTracking`, `DeliveryReviewCheck`, `DeliveryTrackingDetail`, `TrackingTab`, `ReviewStars`, `DeliveredRatingCountKey`, `DeliveryStatusCounts`, `DeliveryStoreCount`, `DeliveryProviderCount`, `DeliveryTrackingListResponse` (stores/providers BẮT BUỘC — route chuẩn hoá), `DeliveryDateField`, `DeliveryReviewFilter`, `DeliveryTrackingSort`, `DeliveryTrackingListParams`, `BulkRefreshShop`, `BulkRefreshJob`, `BulkRefreshRequest`.
- **B. DTO dora-1:** `DORA_PROJECT_ID="dora"`, `DORA_SHOP_PROJECT_PREFIX="dora:"`, `doraShopProjectId()`, `isDoraProjectId()`, `DeliveryProject {id,name}`, `DeliveryProjectsResponse { projects: DeliveryProject[]; doraShops: DeliveryStoreCount[] | null }`, `DeliveryApiErrorBody {error, code?, shop?, retry_after?, detail?, codes?, count?, limit?}`.
- **C. Push:** hằng `DELIVERY_PUSH_SOURCE/ACTOR/CHUNK_SIZE(1000)/WINDOW_DAYS(60)`, `DeliveryPushRow`, `DeliveryPushRequest`, `DeliveryPushChunkAccepted`, `DeliveryPushApplied`, `DeliveryPushDone`, `DeliveryPushOutcome`, `DeliveryPushResult`, `DeliveryPushCronResponse`.

Khác Mera FE (cố ý): `DeliveryTrackingListResponse.stores/providers` không optional; `DeliveryTrackingDetail` thêm `hidden/created_at/updated_at?`. Mọi chỗ khác giống hệt.

### 1.2 `lib/types/sheets.ts` — ĐÃ SỬA `SheetConfigDoc`
```ts
deliveryPushedAt?: Date | null;      // lần push 200 done gần nhất
deliveryPushHash?: string | null;    // sha256 hex(window_from + rows đã sort) của lần thành công
deliveryPushStartedAt?: Date | null; // khoá; treo sau DELIVERY_PUSH_STALE_LOCK_MS
deliveryPushError?: string | null;   // null khi thành công
deliveryPushApplied?: DeliveryPushApplied | null;
```
Không thêm vào `SheetConfigDTO` (không có UI cho các field này ở v1). Không cần index mới.

`npx tsc --noEmit` sạch sau 2 thay đổi trên.

## 2. Backend — push (`lib/services/delivery-push.ts`, `import "server-only"`)

### 2.1 Chữ ký
```ts
export const DELIVERY_PUSH_STALE_LOCK_MS = 15 * 60_000;
export function isDeliveryPushEnabledFor(configId: string): boolean;              // env DELIVERY_PUSH (A5)
export function deliveryWindowFrom(now?: Date): { iso: string; at: Date };        // A6, iso "YYYY-MM-DDT00:00:00+07:00"
export function sheetPaidAt(date: string, time: string): string | null;           // strict, xem 2.2
export function cleanSheetProvider(raw: string): string;                          // trim; /^\d+([.,]\d+)?$/ → ""
export function buildDeliveryPushRows(rows: SheetRowDoc[], rules: CarrierRule[], windowFrom: Date): DeliveryPushRow[]; // thuần, đã sort
export function deliveryPushHash(windowFromIso: string, rows: DeliveryPushRow[]): string;
export async function pushDeliveryForConfig(configId: ObjectId, opts?: { force?: boolean }): Promise<DeliveryPushResult>; // KHÔNG throw
export async function pushDeliveryAll(opts?: { force?: boolean; configId?: ObjectId }): Promise<DeliveryPushResult[]>;    // tuần tự
export function scheduleDeliveryPush(configId: ObjectId): void;                    // after() wrapper, KHÔNG throw
```

### 2.2 Map `SheetRowDoc` → `DeliveryPushRow`
- Đọc: `sheet_rows.find({ configId }, { projection: { itemId, order, receiptKey, store, "values.Tracking", "values.Status", "values.Date", "values.Time", "values.Product Name", "values.Bên in" } })` (index `idx_config_id` có sẵn). Lọc trong code `values.Tracking.trim() !== ""`. MỌI Status.
- `code` = Tracking.trim(); `carrier` = `evaluateCarrierRules(code, await listCarrierRules())?.carrier ?? ""` (đọc rules 1 lần / lượt); `sheet_status` = Status.trim().toUpperCase(); `product_name` = trim; `provider` = `cleanSheetProvider(values["Bên in"])`; `item_id` = itemId; `order_id` = `order.trim()` || itemId bỏ đoạn `-<số>` cuối; `etsy_receipt_id` = receiptKey; `store` = store.
- `sheetPaidAt`: Date khớp `^\d{4}-\d{2}-\d{2}$` (ngày hợp lệ), Time khớp `^\d{1,2}:\d{2}(:\d{2})?$` (thiếu/rỗng → `00:00:00`; giờ pad 2 số) → `"YYYY-MM-DDTHH:mm:ss+07:00"`; sai → `null` (D9).
- Lọc cửa sổ: giữ nếu `paid_at === null` (A7) hoặc `Date.parse(paid_at) >= windowFrom`.
- Sort: `item_id` asc rồi `code` asc. Hash = sha256 hex của `JSON.stringify([windowFromIso, rows])`.

### 2.3 Luồng `pushDeliveryForConfig`
1. Đọc config; không có / `enabled=false` / `!isDeliveryPushEnabledFor(id)` → outcome `disabled`.
2. Chiếm khoá atomic: `updateOne({_id, $or:[{deliveryPushStartedAt:null},{deliveryPushStartedAt:{$exists:false}},{deliveryPushStartedAt:{$lt: now−STALE}}]}, {$set:{deliveryPushStartedAt: now}})`; matched=0 → `skipped_locked`.
3. Dựng rows + hash. Nếu `!force && hash === deliveryPushHash && deliveryPushedAt > now−24h` → nhả khoá, `skipped_unchanged`.
4. `snapshot_id = crypto.randomUUID()`; chia chunk 1000 (rỗng → 1 chunk `rows: []`); gửi TUẦN TỰ `meraFetch("/api/v2/delivery-trackings/external-refs", { method:"POST", body, actorEmail: DELIVERY_PUSH_ACTOR, timeoutMs: 30_000 })`.
   - chunk < total: kỳ vọng 202 `done:false`. chunk cuối: kỳ vọng 200 `done:true` + `applied`.
   - 409 `snapshot_superseded` → dừng, `superseded`. Khác kỳ vọng / mọi status ≥400 / throw MeraApiError → dừng, `failed`, `error = "<status> <code>: <error>"`.
5. Thành công: `$set { deliveryPushedAt: now, deliveryPushHash: hash, deliveryPushError: null, deliveryPushApplied: applied, deliveryPushStartedAt: null }`. Lỗi: `$set { deliveryPushError, deliveryPushStartedAt: null }` (hash KHÔNG ghi ⇒ lượt sau thử lại). Log 1 dòng `[delivery-push]` mỗi lượt (configId, outcome, rows, applied/error).

### 2.4 Kích hoạt
- **(a) Sau sync:** trong `syncSheetNow` (`lib/services/sheet-sync.ts`), ngay sau `configs.updateOne` thành công (trước `return { rowCount }`) gọi `scheduleDeliveryPush(configId)`. `scheduleDeliveryPush`: `try { after(() => pushDeliveryForConfig(id)) } catch { void pushDeliveryForConfig(id).catch(log) }` (`after` từ `next/server`; fallback vì `syncSheetIfStale` có lúc chạy fire-and-forget ngoài vòng đời request). Không đổi chữ ký/hành vi khác của `syncSheetNow`; lỗi push không bao giờ làm sync lỗi.
- **(b) Cron:** `app/api/cron/delivery-push/route.ts` — `GET`, `runtime="nodejs"`, `dynamic="force-dynamic"`, `maxDuration=300`; guard `CRON_SECRET` y hệt `cron/fetch-orders`. Query tuỳ chọn `configId=<hex>` (sai hex → 400 `{error, code:"invalid_id"}`), `force=1`. → `pushDeliveryAll(...)` → 200 `DeliveryPushCronResponse`. Lỗi bất ngờ → `errorResponse`. `/api/cron` đã miễn session trong `proxy.ts` (không sửa proxy).
- `vercel.json` thêm `{ "path": "/api/cron/delivery-push", "schedule": "*/30 * * * *" }`.

### 2.5 `meraFetch` (`lib/services/mera-order.ts`)
- `MeraFetchInit` thêm `timeoutMs?: number` (mặc định 15_000 — giữ hành vi cũ); `export` hàm `meraFetch` (giữ nguyên semantics: không throw theo HTTP status; throw `MeraApiError(503,"mera_not_configured")` / `(502,"mera_unavailable")`).

## 3. Backend — proxy (`lib/services/delivery-proxy.ts` server-only + `app/api/delivery/*`)

### 3.1 Service
```ts
export class DeliveryProxyError extends Error { status: number; body: DeliveryApiErrorBody }
export async function listDeliveryTrackings(query: URLSearchParams, actorEmail: string): Promise<DeliveryTrackingListResponse>;
export async function getDeliveryTracking(id: string, actorEmail: string): Promise<DeliveryTrackingDetail>;
export async function refreshDeliveryTracking(id: string, actorEmail: string): Promise<DeliveryTrackingDetail>; // timeoutMs 60_000
export async function startBulkRefresh(ids: string[], actorEmail: string): Promise<BulkRefreshJob>;
export async function getBulkRefreshJob(jobId: string, actorEmail: string): Promise<BulkRefreshJob>;
export async function getDeliveryProjects(actorEmail: string): Promise<DeliveryProjectsResponse>;
```
Mọi id/jobId trong path qua `encodeURIComponent`. List chỉ chuyển tiếp key whitelist: `project_id, status, q, store, provider, date_field, from, to, review, rating, sort, page, limit`.
Chuẩn hoá thành công: list `items ?? []`, mỗi item `orders ?? []`, mỗi order `items ?? []`, `counts ?? {}`, `stores ?? []`, `providers ?? []`. Detail/refresh: bóc `{tracking}` nếu có, `events ?? []`, `orders ?? []`.
Route helper `lib/http/delivery-error.ts`: `deliveryErrorResponse(err, tag)` → `DeliveryProxyError` ⇒ `NextResponse.json(err.body, {status})`; còn lại ⇒ `errorResponse` (MeraApiError mang code `mera_*` sẵn).

### 3.2 Bảng ánh xạ lỗi (mọi route proxy)
| Mera trả | dora-1 trả |
|---|---|
| status ≥400, JSON có `error` (string) | **cùng status, NGUYÊN body** (`code`, `shop`, `retry_after`, `detail`, `codes`, `count`, `limit`…) |
| 401 (internal key bị từ chối) | 502 `{error:"Mera từ chối khoá nội bộ", code:"mera_auth_failed"}` — KHÔNG trả 401 (FE sẽ hiểu nhầm là hết phiên dora-1) |
| ≥400 không JSON / JSON thiếu `error` (vd route chưa deploy → gin 404 text) | 502 `{code:"mera_bad_response", error:"Mera trả phản hồi không hợp lệ (<status>)"}` |
| 2xx nhưng body không phải object | 502 `mera_bad_response` |
| Timeout/mạng (meraFetch throw) | 502 `mera_unavailable` |
| Thiếu env | 503 `mera_not_configured` |
| dora-1 chưa đăng nhập | 401 `{error:"unauthenticated"}` (requireEmail) |

Mã Mera FE cần phân nhánh (chuyển tiếp nguyên): list 400 `invalid_status|invalid_date_field|invalid_sort|invalid_page|invalid_limit|invalid_date|invalid_project_id|invalid_review|invalid_rating`, 502 `project_access_failed`; detail 400 `invalid_id`, 404 `not_found`; refresh 429 `too_soon`(+retry_after), 409 `shop_offline`(+shop,detail)/`shop_busy`(+shop)/`no_receipt`, 502 `etsy_read_failed`(+shop), 503 `refresh_unavailable`, 403 `shop_blocked_env`(+shop); bulk 400 `invalid_body|empty|too_many|invalid_id|too_many_per_shop`(+shop,count,limit), 409 `shop_bulk_running`(+shop), 403 `forbidden_project`(+codes)/`shop_blocked_env`, 404 `not_found`; bulk status 404 `job_not_found`.

### 3.3 Route (mọi route: `requireEmail()` trước; `runtime="nodejs"`, `dynamic="force-dynamic"`)
| Route | Method | Vào | 2xx | Gọi Mera |
|---|---|---|---|---|
| `/api/delivery` | GET | query Mera (whitelist 3.1) | 200 `DeliveryTrackingListResponse` | `GET /api/v2/delivery-trackings?…` |
| `/api/delivery/[id]` | GET | path id | 200 `DeliveryTrackingDetail` | `GET /api/v2/delivery-trackings/:id` |
| `/api/delivery/[id]/refresh` | POST | body rỗng | 200 `DeliveryTrackingDetail` | `POST …/:id/refresh` timeout 60s; `export const maxDuration = 60` |
| `/api/delivery/bulk-refresh` | POST | `BulkRefreshRequest` (`ids` không phải mảng string → 400 `{code:"invalid_body"}` tại dora-1) | **202** `BulkRefreshJob` | `POST …/bulk-refresh` |
| `/api/delivery/bulk-refresh/[job]` | GET | path job | 200 `BulkRefreshJob` | `GET …/bulk-refresh/:job` |
| `/api/delivery/projects` | GET | — | 200 `DeliveryProjectsResponse` | `GET /api/v1/projects` + `GET /api/v2/delivery-trackings/dora-shops` song song |
| `/api/cron/delivery-push` | GET | `configId?`, `force?`; header CRON_SECRET | 200 `DeliveryPushCronResponse` | external-refs (§2) |

`/projects`: lỗi `/api/v1/projects` → ánh xạ 3.2 (cả route lỗi). `/dora-shops` lỗi BẤT KỲ (chưa deploy, rollout lag) → `doraShops: null`, không lỗi route. `projects` bỏ `team_member_ids`, sort `name` (localeCompare); `doraShops` sort `store`.

## 4. Frontend

### 4.1 Hook `lib/hooks/useDelivery.ts` ("use client")
```ts
export class DeliveryApiError extends Error { status: number; code?: string; body: DeliveryApiErrorBody }
export async function fetchDeliveryList(p: DeliveryTrackingListParams, signal?: AbortSignal): Promise<DeliveryTrackingListResponse>; // GET /api/delivery?buildDeliveryTrackingQuery(p)
export function useDeliveryTrackings(p: DeliveryTrackingListParams);  // key ["delivery","list",p]; placeholderData: keepPreviousData; staleTime 15_000
export function useDeliveryTracking(id: string | null);               // key ["delivery","detail",id]; enabled: !!id
export function useDeliveryProjects();                                 // key ["delivery","projects"]; staleTime 5*60_000; retry false
export function useRefreshDelivery();      // mutation(id) POST /api/delivery/:id/refresh → detail; onSuccess: setQueryData(["delivery","detail",id]) + setQueriesData({queryKey:["delivery","list"]}) thay row cùng id (rowFromDetail: giữ field row, ghi đè bằng detail trừ events/flags…)
export function useStartBulkRefresh();     // mutation(ids) POST /api/delivery/bulk-refresh → BulkRefreshJob
export function useBulkRefreshJob(jobId: string | null); // key ["delivery","bulk",jobId]; enabled !!jobId; refetchInterval: q => q.state.data?.done ? false : 3000; retry false
```
Mọi fetch qua 1 helper nội bộ: `!res.ok` → đọc JSON thành `DeliveryApiErrorBody` (lỗi parse → `{error: String(status)}`) → throw `DeliveryApiError`. KHÔNG dùng `jsonFetch` của useSheets (mất `shop/retry_after`). Bulk job `done` → component `invalidateQueries({queryKey:["delivery","list"]})`.

### 4.2 Helper thuần `lib/delivery/*` (chép từ `mera-fulfill-frontend/src/lib/*`, đổi import sang `@/lib/types/delivery`)
- `deliveryTracking.ts` ← `lib/deliveryTracking.ts`. Bỏ `TRACKING_ALL_PROJECTS`, `trackingOrderIds`. `parseTrackingUrl/trackingUrlSearch`: `project` '' = tất cả (A12). Giữ nguyên `buildDeliveryTrackingQuery` (đây là seam param).
- `carrierTrackingUrl.ts` ← nguyên văn (`carrierTrackingUrl`, `etsyTrackingPage`).
- `trackingSelection.ts` ← nguyên văn (`BULK_MAX_PER_SHOP=50`).
- `trackingExport.ts` ← giữ `TRACKING_EXPORT_HEADER`, `trackingExportRows`; `exportTrackingXlsx(list, params, filename, onProgress?, signal?)` cùng chữ ký nhưng ghi bằng `const ExcelJS = (await import("exceljs")).default` → `workbook.xlsx.writeBuffer()` → Blob → `<a download>`; giữ cột rộng + autoFilter. `list` = `fetchDeliveryList`.
- `review.ts` ← phần cần từ `mera-shared/frontend/etsy-review/review.ts` (`hasReview`, `reviewStarCount`, `formatReviewRating`, `formatReviewDateTime`, `shortenReviewMessage`, `collectItemReviews`).
- `orderLink.ts` (mới): `doraOrdersLink(o: Pick<DeliveryTrackingOrder,"order_id"|"etsy_receipt_id">): string` → `/orders?search=<receipt || normalizeOrderId(order_id)>`.

### 4.3 Trang + component
```
app/delivery/page.tsx                    "use client"; render <DeliveryPage/> (header có MobileMenuButton như app/tracking)
components/delivery/
  DeliveryPage.tsx        state: URL ⇄ TrackingUrlState (đọc window.location lúc mount, ghi bằng router.replace; KHÔNG useSearchParams),
                          selection: TrackingSelection, drawerId, exportProgress. Gọi useDeliveryTrackings / useDeliveryProjects.
  DeliveryToolbar.tsx     select Project (Tất cả · projects · "Dora" · "Dora - {store} (count)" nếu doraShops != null) + nút Export XLSX
  DeliveryStatusTabs.tsx  All + DELIVERY_STATUSES + delivered_no_review + delivered_reviewed; số = trackingTabCount(counts, tab)
  DeliveryFilters.tsx     search (debounce ~300ms, q) · shop (stores) · fulfill (providers) · review select (+ sao REVIEW_STAR_OPTIONS ở tab reviewed) · date_field paid|ship + from/to
  BulkRefreshBar.tsx      chép Mera; dùng useStartBulkRefresh + useBulkRefreshJob; toast sonner; shop_bulk_running → warning
  DeliveryTable.tsx       checkbox cả trang (pageSelectState/togglePage) + cột: Tracking Number · Order ID · Fulfill · Status · Transit Time · Date (Paid/Ship[/Giao]) · Action
  DeliveryRow.tsx         code + copy + link carrierTrackingUrl; mỗi order: order_id + link doraOrdersLink + nhãn "Dora" nếu source==="dora_sheet" + ReviewLine; refresh 1 dòng (refreshErrorMessage(status, code, error, shop)); mở drawer
  DeliveryPagination.tsx  TRACKING_PAGE_SIZES 50/100/200 + trang
  DeliveryEventsDrawer.tsx chép TrackingEventsDrawer: useDeliveryTracking(id), events, flags, nút refresh (dùng chung useRefreshDelivery)
  ReviewStars.tsx         ReviewLine / ReviewDetail tối giản (chép Mera components/review/ReviewStars.tsx)
components/sidebar.tsx    thêm navItem A2 (import PackageCheck từ lucide-react)
```
UI dora-1 chỉ có `components/ui/{button,input,DateRangeFilter}` — select/drawer/tooltip làm bằng phần tử thuần + Tailwind (khuôn `components/tracking/HistorySection.tsx`). Toast: `sonner`.

## 5. Seam table (đầu vào qa-integration)

| # | Luồng | Shape service trả | Param route nhận | Query key | Field component đọc |
|---|---|---|---|---|---|
| S1 | List | `DeliveryTrackingListResponse` (mảng luôn có) | `project_id,status,q,store,provider,date_field,from,to,review,rating,sort,page,limit` = output `buildDeliveryTrackingQuery` | `["delivery","list",params]` | `items[]`, `total`, `page`, `limit`, `counts[tab]` (thiếu=0), `stores[].store/count`, `providers[].provider/count` |
| S2 | Tab → param | — | tab reviewed/no_review ⇒ `status=delivered&review=any|none&sort=delivered_desc`; `rating` chỉ khi review≠none | — | `trackingTabListParams`, `trackingTabCount` (reviewed = delivered − delivered_no_review) |
| S3 | Project | `DeliveryProjectsResponse` | list `project_id` = '' \| hex \| `dora` \| `dora:<store>` (store NGUYÊN VĂN, URLSearchParams tự encode) | `["delivery","projects"]` | `projects[].id/name`, `doraShops[].store/count`, `doraShops===null` ⇒ ẩn Dora |
| S4 | Row đơn | `orders[].source?`, `etsy_receipt_id?`, `project_id` ("dora") | — | — | `source==="dora_sheet"` ⇒ nhãn Dora; link `/orders?search=<etsy_receipt_id>` |
| S5 | Detail | `DeliveryTrackingDetail` (events mảng) | path `id` | `["delivery","detail",id]` | `events[]`, `flags?.detailed`, `mera_carrier`, `last_error/_at` |
| S6 | Refresh 1 mã | 200 detail · lỗi `DeliveryApiErrorBody` nguyên văn Mera | POST path `id` | ghi đè `detail` + row trong mọi `["delivery","list",*]` | `refreshErrorMessage(status, body.code, body.error, body.shop)`; `review_check` → `refreshReviewSummary` |
| S7 | Bulk start | **202** `BulkRefreshJob` | body `{ids: string[]}` (id = `DeliveryTracking.id`) | — | `id`, `done` (có thể true ngay) |
| S8 | Bulk poll | `BulkRefreshJob` | path `job` | `["delivery","bulk",jobId]` 3s tới `done` | `shops[].phase/updated/codes/failed/review_*/error`, `no_receipt[]`; done ⇒ invalidate `["delivery","list"]` |
| S9 | Export | dùng `fetchDeliveryList` limit 200 lặp trang | như S1 (page/limit ghi đè) | không cache | `TRACKING_EXPORT_HEADER`, `trackingExportRows` |
| S10 | Lỗi hạ tầng | 502 `mera_unavailable|mera_bad_response|mera_auth_failed`, 503 `mera_not_configured` | — | — | thông báo lỗi tải; KHÔNG redirect login trên 401 từ `/api/delivery` trừ `error:"unauthenticated"` |
| S11 | Push row | `DeliveryPushRow` (§2.2) | Mera `external-refs` body `DeliveryPushRequest` | — | Mera: `item_id→item_key`, `provider→latest_provider`, `sheet_status→status`, `store` so shop Mera |
| S12 | Push chunk | 202 `DeliveryPushChunkAccepted` / 200 `DeliveryPushDone` / 409 `snapshot_superseded` / 400 `invalid_payload` | `chunk` 1-based, `chunk_total ≥1`, `window_from` giống nhau mọi chunk, `rows ≤1000` | — | `SheetConfigDoc.deliveryPush*` |
| S13 | Trigger | `DeliveryPushResult[]` | cron `configId?`,`force=1`; header `Authorization: Bearer CRON_SECRET` | — | `outcome`, `applied`, `error` |

QA chú ý: (i) `/api/delivery/bulk-refresh` trả 202 — hook không được coi `res.status !== 200` là lỗi; (ii) `rowFromDetail` không làm mất `orders` của row; (iii) `buildDeliveryTrackingQuery` chỉ gửi `date_field` khi có from/to; (iv) route `/api/delivery/bulk-refresh` (tĩnh) không bị `[id]` nuốt; (v) Date/Time sheet → `+07:00` (vd `2025-11-13` + `2:56:27` → `2025-11-13T02:56:27+07:00`).

## 6. Task

| ID | Owner | Task | Phụ thuộc |
|---|---|---|---|
| B1 | backend-engineer | `meraFetch`: `timeoutMs` + export (§2.5) | — |
| B2 | backend-engineer | `lib/services/delivery-push.ts` (§2.1–2.3) | B1 |
| B3 | backend-engineer | Trigger: `scheduleDeliveryPush` trong `syncSheetNow`; `app/api/cron/delivery-push/route.ts`; `vercel.json` (§2.4) | B2 |
| B4 | backend-engineer | `lib/services/delivery-proxy.ts` + `lib/http/delivery-error.ts` (§3.1–3.2) | B1 |
| B5 | backend-engineer | 6 route `app/api/delivery/*` (§3.3) | B4 |
| F1 | frontend-engineer | Helper `lib/delivery/*` (§4.2) | — (types đã có) |
| F2 | frontend-engineer | `lib/hooks/useDelivery.ts` (§4.1) | F1 (buildDeliveryTrackingQuery); code song song với B5 theo §3.3 |
| F3 | frontend-engineer | Trang `/delivery` + `components/delivery/*` + sidebar (§4.3) | F1, F2 |
| Q1 | qa-integration | So khớp seam S1–S13; tsc; `npm run lint`; gọi thử route với Mera dev | B3, B5, F3 |

Ghi kết quả: backend → `_workspace/02_backend_changes.md`, frontend → `_workspace/03_frontend_changes.md`, QA → `_workspace/04_qa_report.md`.

## 7. Giả định / điểm mở cần xác nhận với Mera BE
1. Mera chấp nhận snapshot rỗng `chunk_total:1, rows:[]` (A8). Nếu Mera trả 400 → dora-1 bỏ qua gửi khi 0 dòng (outcome `skipped_unchanged`) và ghi chú rủi ro: ref không được gỡ khi sheet bị xoá sạch.
2. `/dora-shops` và `project_id=dora*` chưa deploy → dora-1 tự ẩn Dora (`doraShops:null`); list "Tất cả" vẫn chạy.
3. Ô Tracking chứa nhiều mã (vd "A, B") không tách ở v1 — gửi nguyên chuỗi đã trim; Mera bỏ khoảng trắng. Ghi nhận, không xử lý.
4. `after()` trong request sync bị giới hạn bởi `maxDuration` của route gọi; bị cắt giữa chừng → khoá hết hạn sau 15 phút, snapshot Mera TTL 1h, cron 30 phút gửi lại. Chấp nhận, không đổi maxDuration các route sheet.
