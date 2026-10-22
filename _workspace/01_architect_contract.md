# 01 — Hợp đồng: Request reviews (dora-1)

Ngày: 2026-10-21 · Spec liên hệ thống CỐ ĐỊNH: `D:\Pamo\Mera\_workspace\request-reviews\01_plan.md` (dora-1 = §8, UI mirror §6, API §5).
Kế thừa quy ước contract delivery cũ: `_workspace_prev_20261021_delivery/01_architect_contract.md` (A1 internal key + `X-Actor-Email`, A3 proxy mỏng, bảng lỗi §3.2, hook `deliveryFetch`/`DeliveryApiError`, select project A12).
Không commit (plan R6 — user tự review).

## 0. Quyết định chốt

| # | Quyết định |
|---|---|
| R-A1 | Map project UI → `project_id` review-requests: `<hex>` → hex; `dora` và `dora:<store>` → `"dora"`; `''` (Tất cả) → KHÔNG gọi; dialog hiện select project bắt buộc (projects + "Dora" nếu `doraShops !== null`). Helper `reviewRequestProjectId(project: string): string \| null` ở `lib/delivery/reviewRequest.ts`. |
| R-A2 | ~~Gửi tay dùng body `{ids, message?}` (KHÔNG gửi project_id)~~ → **đổi theo addendum orchestrator (§7.5):** body `{ids, message?, project_id?}`; dora-1 chuyển tiếp `project_id` ("" → bỏ field). |
| R-A3 | Cảnh báo trước khi gửi tay tính phía FE từ row: `orders[].review_request` khác null ⇒ "đã xin review"; `hasReview` item ⇒ "đã có review". Cảnh báo SAU gửi = `warnings[]` Mera. Không chặn. |
| R-A4 | Mọi field mảng/đếm có thể vắng (Mera BE đang làm song song) ⇒ route chuẩn hoá (§3.2). `review_request` vắng = null (rollout lag — không coi là lỗi). |
| R-A5 | Endpoint máy: `requestedAt` lấy `new Date()` TRƯỚC `publishFetchOrderConvo` để `fetched_at` của extension luôn > requestedAt. |
| R-A6 | Không thêm role/quyền: mọi user dora-1 đăng nhập được gửi tay + sửa mẫu (plan §9.5). |

## 1. Type contract — `lib/types/delivery.ts` phần D (ĐÃ VIẾT, `npx tsc --noEmit` sạch)

- `DeliveryTrackingOrder.review_request?: DeliveryOrderReviewRequest | null` (mới, optional).
- `ReviewRequestStatus = "checking"|"queued"|"sending"|"sent"|"failed"|"skipped"`, `ReviewRequestMode = "auto"|"manual"`, `ReviewRequestSkipReason`.
- `DeliveryOrderReviewRequest {status, mode, sent_at: string|null, error: string}`.
- Hằng: `REVIEW_REQUEST_VARIABLES` (`{buyer_name}`,`{order_id}`,`{shop_name}`), `REVIEW_REQUEST_TEMPLATE_MAX=2000`, `REVIEW_REQUEST_MAX_DAYS_MIN/MAX/DEFAULT = 1/30/7`.
- `ReviewRequestSettings {project_id, template, max_days, is_default, default_template, variables: string[], updated_by, updated_at}`; `ReviewRequestSettingsUpdate {project_id, template, max_days}`.
- `ReviewRequestProjectBody {project_id}` (preview/run).
- `ReviewRequestSkippedCounts {has_conversation, reviewed, already_requested}`.
- `ReviewRequestPreviewSample {order_id, etsy_receipt_id, shop_name, store, tracking_code: string; delivered_at: string|null; has_conversation: boolean|null}` (§7.5); `ReviewRequestPreview {candidates, will_check_conversation, skipped, sample[]}`.
- `ReviewRequestRunResult {queued, skipped}`.
- `ReviewRequestSendRequest {ids: string[], message?, project_id?}`; `ReviewRequestSendWarning {order_id, kind}`; `ReviewRequestSendSkipped {order_id, tracking_code, reason}` (§7.5); `ReviewRequestSendResult {queued, warnings[], skipped[]}`.
- `ReviewRequestFailedItem {order_id, shop_name, error, at: string|null}`; `ReviewRequestSummary {queued, sending, sent_today, failed_recent[]}`.
- `DeliveryOrderReviewRequest` thêm `skip_reason?: ReviewRequestSkipReason | ""` (§7.5).
- Máy: `MACHINE_ORDER_CONVO_FETCH_MAX=50`, `MachineOrderConvoFetchRequest {shopName, orderIds: number[]}`, `MachineOrderConvoFetchResponse {ok:true, requestedAt}`, `MachineOrderConvoFetchOffline {ok:false, error, code:"shop_offline"}`.
- Lỗi mọi route `/api/delivery/review-requests/*`: `DeliveryApiErrorBody` (có sẵn).

## 2. Endpoint máy — `app/api/machine/order-conversations/fetch/route.ts`

`POST`, `runtime="nodejs"`, `dynamic="force-dynamic"`. Không sửa `proxy.ts` (đã cho `/api/machine/*` mang `x-api-key`).
1. `if (!hasMachineApiKey(req)) return machineUnauthorized();` (401 `{error:"unauthenticated", code:"unauthenticated"}`).
2. `readJsonObject(req)`; null → `machineBadRequest("body phải là JSON object")`.
3. `shopName` = string trim, rỗng → 400. `orderIds`: phải là mảng; mỗi phần tử `Number.isSafeInteger(v) && v > 0` (KHÔNG nhận chuỗi); bỏ trùng; rỗng hoặc > 50 → 400. Mọi 400 dùng `machineBadRequest(<câu VN>)` (code `bad_request`, như các route máy khác).
4. `const requestedAt = new Date().toISOString();` → `publishFetchOrderConvo(shopName, { order_ids })`.
5. null → **409** `MachineOrderConvoFetchOffline` `{ok:false, error:"Shop chưa có extension online", code:"shop_offline"}`; còn lại **200** `MachineOrderConvoFetchResponse`.
6. throw → 500 `{error}` + `console.error("[POST /api/machine/order-conversations/fetch]")` (khuôn `order-messages/[id]/cancel`). Log 1 dòng `[order-convo-fetch] shop=… n=… client=…` khi thành công.

## 3. Proxy — service `lib/services/review-request-proxy.ts` (server-only) + route `app/api/delivery/review-requests/*`

### 3.1 Service
Tái dùng `DeliveryProxyError` + `callMera` của `delivery-proxy.ts`: **export `callMera`** (đổi `async function callMera` → `export async function callMera`, không đổi hành vi) rồi import ở file mới. Base `"/api/v2/review-requests"`.
```ts
export async function getReviewRequestSettings(projectId: string, actorEmail: string): Promise<ReviewRequestSettings>;
export async function updateReviewRequestSettings(body: ReviewRequestSettingsUpdate, actorEmail: string): Promise<ReviewRequestSettings>;
export async function previewReviewRequests(projectId: string, actorEmail: string): Promise<ReviewRequestPreview>;   // timeoutMs 30_000
export async function runReviewRequests(projectId: string, actorEmail: string): Promise<ReviewRequestRunResult>;     // timeoutMs 30_000
export async function sendReviewRequests(body: ReviewRequestSendRequest, actorEmail: string): Promise<ReviewRequestSendResult>; // timeoutMs 30_000
export async function getReviewRequestSummary(projectId: string, actorEmail: string): Promise<ReviewRequestSummary>;
```
Query `project_id` qua `URLSearchParams` (không tự nối chuỗi).

### 3.2 Chuẩn hoá 2xx (thiếu/sai kiểu → mặc định)
- settings: `variables` → mảng string (rỗng giữ rỗng), `template/default_template/updated_by` → `""`, `updated_at` → null, `is_default` → boolean, `max_days` → `asNumber ?? 7`.
- `skipped` (preview/run) → đủ 3 key, số (thiếu = 0). preview `sample` → `objects()`, `candidates/will_check_conversation` → số (0).
- send `warnings/skipped` → `objects()`; `queued` → số. summary `failed_recent` → `objects()`; `queued/sending/sent_today` → số.
- Lỗi: bảng §3.2 contract delivery cũ, NGUYÊN VĂN (401 Mera → 502 `mera_auth_failed`; ≥400 không có `error` → 502 `mera_bad_response`; gin 404 khi Mera chưa deploy → 502 `mera_bad_response`).

### 3.3 Route (mọi route: `requireEmail()` trước, actor = `gate.email`; `runtime="nodejs"`, `dynamic="force-dynamic"`; catch → `deliveryErrorResponse(err, "<METHOD path>")`)
Validate tại dora-1 = chỉ kiểu (400 `{error, code:"invalid_body"}` hoặc `invalid_project_id`); giá trị (giới hạn ký tự, max_days, số mã/shop) để Mera kiểm và chuyển tiếp code.

| Route dora-1 | Vào | 2xx | Mera |
|---|---|---|---|
| `GET /api/delivery/review-requests/settings?project_id=` | `project_id` chuỗi không rỗng (thiếu → 400 `invalid_project_id`) | 200 `ReviewRequestSettings` | `GET /api/v2/review-requests/settings?project_id=` |
| `PUT /api/delivery/review-requests/settings` | `ReviewRequestSettingsUpdate` (project_id string ≠ "", template string, max_days number hữu hạn; sai → 400 `invalid_body`) | 200 `ReviewRequestSettings` | `PUT …/settings` |
| `POST /api/delivery/review-requests/preview` | `ReviewRequestProjectBody` | 200 `ReviewRequestPreview` | `POST …/preview` |
| `POST /api/delivery/review-requests/run` | `ReviewRequestProjectBody` | 200 `ReviewRequestRunResult` | `POST …/run` |
| `POST /api/delivery/review-requests/send` | `ReviewRequestSendRequest` (`ids` mảng string, không rỗng; `message` / `project_id` vắng hoặc string; trim rỗng → bỏ field) | 200 `ReviewRequestSendResult` | `POST …/send` |
| `GET /api/delivery/review-requests/summary?project_id=` | như settings | 200 `ReviewRequestSummary` | `GET …/summary?project_id=` |

Status 2xx: dora-1 luôn trả **200** (kể cả Mera trả 201/202) — hook coi mọi 2xx là thành công.
Code Mera dự kiến chuyển tiếp (FE phân nhánh, câu fallback = `body.error`): 400 `invalid_project_id|invalid_body|invalid_template|invalid_max_days|empty|too_many|too_many_per_shop`(+shop,count,limit), 403 `forbidden_project`, 404 `not_found`.

## 4. Frontend

### 4.1 Hook — thêm vào `lib/hooks/useDelivery.ts` (dùng `deliveryFetch` + `DeliveryApiError` có sẵn)
```ts
export function useReviewRequestSettings(projectId: string | null); // key ["delivery","review-requests","settings",projectId]; enabled !!projectId; staleTime 60_000
export function useSaveReviewRequestSettings();  // PUT; onSuccess: setQueryData(settings key của body.project_id, res)
export function useReviewRequestPreview(projectId: string | null, enabled: boolean);
                                                  // key ["delivery","review-requests","preview",projectId]; POST; staleTime 0; gcTime 0; retry false
export function useRunReviewRequests();          // mutation(projectId) POST run
export function useSendReviewRequests();         // mutation(ReviewRequestSendRequest) POST send
export function useReviewRequestSummary(projectId: string | null); // key ["delivery","review-requests","summary",projectId]; enabled !!projectId;
                                                  // refetchInterval: d => (d.queued + d.sending > 0 ? 10_000 : false)
```
**Invalidation** sau run/send thành công (onSuccess trong hook): `invalidateQueries({queryKey:["delivery","list"]})` + `invalidateQueries({queryKey:["delivery","review-requests","summary"]})` + `removeQueries({queryKey:["delivery","review-requests","preview"]})`. Sau lưu settings: invalidate `["delivery","review-requests","preview"]`.
Lưu ý prefix: `["delivery","list"]` KHÔNG trùng prefix `["delivery","review-requests",…]` (khác phần tử thứ 2) — invalidate list không kéo theo review-requests và ngược lại.

### 4.2 Helper thuần `lib/delivery/reviewRequest.ts` (mới)
```ts
export function reviewRequestProjectId(project: string): string | null;            // R-A1
export function reviewRequestBadge(rr: DeliveryOrderReviewRequest | null | undefined):
  { label: string; tone: "ok" | "pending" | "error" } | null;
  // sent → "Đã xin review · dd/MM" (sent_at giờ VN; sent_at null → "Đã xin review"), ok
  // queued|sending|checking → "Đang chờ gửi", pending · failed → "Gửi lỗi" (title = error), error · skipped/null → null
export function reviewRequestVariables(s?: ReviewRequestSettings): string[];       // s.variables rỗng → REVIEW_REQUEST_VARIABLES; token không có {} → bọc {}
export function renderReviewTemplate(tpl: string, v: { buyer_name: string; order_id: string; shop_name: string }): string; // thay {buyer_name}/{order_id}/{shop_name}
export const REVIEW_PREVIEW_SAMPLE_VARS = { buyer_name: "Emma", order_id: "3456789012", shop_name: "YourShop" };
export function manualWarnings(rows: DeliveryTracking[]): { order_id: string; store: string; kind: "already_requested" | "reviewed" }[]; // R-A3 (hasReview từ lib/delivery/review.ts)
export const SKIP_REASON_LABEL: Record<ReviewRequestSkipReason, string>;          // has_conversation "Đã có hội thoại", reviewed "Đã có review", already_requested "Đã xin trước đó", conversation_unknown "Chưa xác định hội thoại", shop_offline "Shop offline"
```

### 4.3 Component
```
components/delivery/
  DeliveryToolbar.tsx          + prop onRequestReviews, onReviewSettings → render <DeliveryUtilsDropdown/> cạnh Export
  DeliveryUtilsDropdown.tsx    (mới) nút "Utils" (icon Wrench) + menu thuần Tailwind (đóng khi click ngoài/Esc, khuôn Mera UtilsDropdown):
                               "Request reviews" (Send) · "Cài đặt Request reviews" (Settings)
  RequestReviewsDialog.tsx     (mới) props { open, onClose, project: string (filter UI), selection: TrackingSelection,
                               selectedRows: DeliveryTracking[], projects: DeliveryProjectsResponse|undefined, onSent: () => void }
     - selection.size > 0 ⇒ MODE GỬI TAY: textarea (placeholder = settings.template của reviewRequestProjectId(project), nếu null
       → "Trống = dùng mẫu của từng project"; maxLength 2000), danh sách đơn (selectedRows → orders: order_id · store) +
       cảnh báo manualWarnings; mã không có trong selectedRows hiện "<n> mã ở trang khác"; nút "Gửi" → useSendReviewRequests({ids:[...selection.keys()], message})
       → toast "Đã xếp hàng N tin" + liệt kê warnings/skipped → onSent() (bỏ chọn) + đóng.
     - selection.size === 0 ⇒ MODE TỰ ĐỘNG: projectId = reviewRequestProjectId(project) ?? select trong dialog (bắt buộc);
       useReviewRequestPreview(projectId, open) → candidates, will_check_conversation, skipped (SKIP_REASON_LABEL), sample (≤20);
       candidates = 0 ⇒ disable; "Xác nhận gửi" → useRunReviewRequests(projectId) → toast "Đã xếp hàng N đơn" → đóng.
     - Chân dialog: dòng summary (useReviewRequestSummary) "Đang chờ q · Đang gửi s · Đã gửi hôm nay t" + failed_recent (≤5) nếu có.
  ReviewRequestSettingsDialog.tsx (mới) props { open, onClose, project, projects }: projectId như mode tự động (select nếu ''),
       useReviewRequestSettings → textarea template (đếm ký tự /2000) + hàng nút chèn biến (reviewRequestVariables; chèn tại
       con trỏ selectionStart/End) + khung "Xem trước" (renderReviewTemplate với REVIEW_PREVIEW_SAMPLE_VARS) + input number max_days
       ("Đơn giao trong N ngày gần nhất", 1–30) + "Dùng mẫu mặc định" (điền default_template) + "Lưu" → useSaveReviewRequestSettings.
       is_default ⇒ nhãn "Đang dùng mặc định"; updated_by/updated_at hiển thị nhỏ.
  DeliveryRow.tsx              cột Status: dưới badge status, mỗi order có reviewRequestBadge(o.review_request) ≠ null ⇒ badge nhỏ
                               (mã nhiều đơn: prefix order_id khi > 1 đơn). tone ok=emerald, pending=amber, error=red.
  DeliveryPage.tsx             state dialog ("request"|"settings"|null); selectedRows = gom từ cache mọi ["delivery","list"]
                               (qc.getQueriesData) lọc id ∈ selection, bỏ trùng theo id; onSent → setSelection(new Map()).
```
Modal: phần tử thuần + Tailwind (overlay fixed, khuôn drawer hiện có) — không thêm thư viện. Toast: `sonner`. Lỗi: `DeliveryApiError.body.error` (+ `shop` nếu có).

## 5. Seam table (qa-integration)

| # | Luồng | Shape service trả | Param route nhận | Query key | Field component đọc |
|---|---|---|---|---|---|
| R1 | Máy fetch convo | 200 `{ok:true, requestedAt}` / 409 `{ok:false,code:"shop_offline"}` / 400 `bad_request` / 401 | header `x-api-key`; body `{shopName, orderIds:number[] ≤50}` | — | Mera worker: `requestedAt` < `order_conversations.fetched_at`; Ably payload `{order_ids, clientId}` (giống route session) |
| R2 | Project map | — | `project_id` = hex \| `"dora"` (KHÔNG BAO GIỜ `dora:<store>` / `''`) | — | `reviewRequestProjectId(filters.project)` |
| R3 | Settings get | `ReviewRequestSettings` (variables mảng) | query `project_id` | `["delivery","review-requests","settings",pid]` | `template, max_days, is_default, default_template, variables, updated_by, updated_at` |
| R4 | Settings put | `ReviewRequestSettings` | body `{project_id, template, max_days}` | setQueryData R3 | lỗi `invalid_template|invalid_max_days` → `body.error` |
| R5 | Preview | `ReviewRequestPreview` (skipped đủ 3 key, sample mảng) | body `{project_id}` | `["delivery","review-requests","preview",pid]` (gcTime 0) | `candidates, will_check_conversation, skipped.*, sample[].order_id/shop_name/tracking_code/delivered_at` |
| R6 | Run | `ReviewRequestRunResult` | body `{project_id}` | invalidate list + summary, remove preview | `queued, skipped.*` |
| R7 | Send tay | `ReviewRequestSendResult` (warnings/skipped mảng) | body `{ids: DeliveryTracking.id[], message?}` (message rỗng ⇒ vắng) | invalidate list + summary | `queued, warnings[].order_id/kind, skipped[].reason`; lỗi `too_many_per_shop` (+shop,limit) |
| R8 | Summary | `ReviewRequestSummary` (failed_recent mảng) | query `project_id` | `["delivery","review-requests","summary",pid]` poll 10s khi queued+sending>0 | `queued, sending, sent_today, failed_recent[].order_id/shop_name/error/at` |
| R9 | Badge dòng | list/detail `orders[].review_request` (vắng ⇒ undefined, KHÔNG chuẩn hoá thành lỗi) | — | `["delivery","list",p]` / detail | `status, sent_at, error` qua `reviewRequestBadge` |
| R10 | Lỗi hạ tầng | 502 `mera_bad_response` (Mera chưa deploy) / `mera_unavailable` / `mera_auth_failed`, 503 `mera_not_configured` | — | — | dialog hiện `body.error`, không vỡ trang /delivery |

QA chú ý: (i) `rowFromDetail`/`mergeScopedOrders` giữ `review_request` (đơn từ detail ghi đè cả object — OK, đúng dữ liệu mới); (ii) route tĩnh `/api/delivery/review-requests/*` không bị `app/api/delivery/[id]` nuốt (`[id]` chỉ có `route.ts` + `refresh` — `review-requests/settings` là segment tĩnh, Next ưu tiên tĩnh); (iii) không gọi preview/settings khi project `''` chưa chọn; (iv) `requestedAt` lấy trước publish; (v) gửi tay > 50 mã/shop bị selection chặn sẵn (`BULK_MAX_PER_SHOP`), Mera kiểm lại.

## 6. Task

| ID | Owner | Task | Phụ thuộc |
|---|---|---|---|
| B1 | backend-engineer | `app/api/machine/order-conversations/fetch/route.ts` (§2) | — |
| B2 | backend-engineer | export `callMera` trong `delivery-proxy.ts`; `lib/services/review-request-proxy.ts` (§3.1–3.2) | — |
| B3 | backend-engineer | 5 file route: `app/api/delivery/review-requests/{settings,preview,run,send,summary}/route.ts` (settings có GET+PUT) (§3.3) | B2 |
| F1 | frontend-engineer | `lib/delivery/reviewRequest.ts` (§4.2) | — (types đã có) |
| F2 | frontend-engineer | Hook trong `lib/hooks/useDelivery.ts` (§4.1) | code song song theo §3.3 |
| F3 | frontend-engineer | `DeliveryUtilsDropdown`, `RequestReviewsDialog`, `ReviewRequestSettingsDialog`, sửa `DeliveryToolbar`/`DeliveryPage`/`DeliveryRow` (§4.3) | F1, F2 |
| Q1 | qa-integration | So khớp seam R1–R10; `npx tsc --noEmit`; `npm run lint`; gọi thử route máy với key | B1–B3, F3 |

Ghi kết quả: backend → `_workspace/02_backend_changes.md`, frontend → `_workspace/03_frontend_changes.md`, QA → `_workspace/04_qa_report.md`. Không ai sửa `lib/types/delivery.ts` phần D mà không báo architect.

## 7. Giả định / điểm mở với Mera BE (shape §5 plan chỉ ghi `[…]`)
1. Gửi tay không mang project_id: mã có đơn ở nhiều project ⇒ Mera xếp hàng mọi đơn của mã (internal key = mọi scope). Nếu cần giới hạn theo project đang xem, Mera thêm `project_id?` vào body send — dora-1 sẽ thêm field optional.
2. Shape phần tử `sample[]`, `skipped[]` (send), `failed_recent[]` là giả định của dora-1 (§1); FE chỉ đọc field đã liệt kê, field vắng → hiện "—". Mera BE nên trả ít nhất `order_id`, `shop_name` (sample/failed), `reason` (skipped).
3. `variables[]` giả định dạng `"{buyer_name}"`; nếu Mera trả `"buyer_name"` helper tự bọc `{}`.
4. Badge `checking` hiện "Đang chờ gửi" (Mera mới có trạng thái này ở §4.4, không có trong §3).
5. **Addendum orchestrator 2026-10-21 (Mera BE sẽ làm đúng shape này) — đã áp vào `lib/types/delivery.ts` phần D bởi backend-engineer:**
   - send body `{ids, message?, project_id?}` — dora-1 chuyển tiếp `project_id` (thay §7.1/R-A2: FE nên gửi `reviewRequestProjectId(project)` khi khác null).
   - `preview.sample[]` = `{order_id, etsy_receipt_id, shop_name, store, tracking_code, delivered_at, has_conversation: boolean|null}` — BỎ `will_check_conversation` per-sample; route bảo đảm đủ key (chuỗi vắng → "", `delivered_at`/`has_conversation` vắng → null; id số → chuỗi).
   - `send.skipped[]` = `{order_id, tracking_code, reason}` (bỏ `tracking_id`); `send.warnings[]` = `{order_id, kind}` — kind ngoài union bị route bỏ.
   - `summary.failed_recent[]` = `{order_id, shop_name, error, at: string|null}`.
   - `settings.variables` dạng có ngoặc nhọn (khớp giả định §7.3).
   - `review_request.status` ∈ queued|checking|sending|sent|failed|skipped + `skip_reason` (optional, pass-through list/detail).
6. **QA B4 (backend-engineer, khớp struct Go thật):** `skipped` = 3 key gốc + mọi key số khác (`send_blocked_env`, `shop_offline`, `conversation_unknown`, `manual_failed`…, index signature); `run.checking`, `summary.checking` (summary.queued đã gồm checking); `send.skipped[].tracking_id`; `sample[].project_id/tracking_id`; `DeliveryApiErrorBody.unknown_vars?: string[]` (invalid_template).
