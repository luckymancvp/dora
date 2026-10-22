# 02 — Backend: tracking giao hàng Mera ↔ dora-1 (B1–B5)

Ngày: 2026-10-21 · Contract: `_workspace/01_architect_contract.md` §2–§3 · Plan Mera: `D:\Pamo\Mera\_workspace\delivery-tracking\04_dora_shared_plan.md` §4–§5.
Trạng thái: B1–B5 xong + sửa QA vòng 1 (F1, F1-addendum, F2, F4, G1 — xem mục cuối). `npx tsc --noEmit` sạch. Chưa commit.

## File

| Task | File | Ghi chú |
|---|---|---|
| B1 | `lib/services/mera-order.ts` (sửa) | `export interface MeraFetchInit` + `timeoutMs?: number` (mặc định 15_000); `export async function meraFetch`. Semantics giữ nguyên. |
| B2 | `lib/services/delivery-push.ts` (mới, server-only) | Đúng chữ ký §2.1: `DELIVERY_PUSH_STALE_LOCK_MS`, `isDeliveryPushEnabledFor`, `deliveryWindowFrom`, `sheetPaidAt`, `cleanSheetProvider`, `buildDeliveryPushRows`, `deliveryPushHash`, `pushDeliveryForConfig`, `pushDeliveryAll`, `scheduleDeliveryPush`. |
| B3 | `lib/services/sheet-sync.ts` (sửa) | `scheduleDeliveryPush(configId)` ngay sau `configs.updateOne` thành công, trước `return { rowCount }`. Không đổi gì khác. |
| B3 | `app/api/cron/delivery-push/route.ts` (mới) | GET, nodejs, force-dynamic, maxDuration 300, guard CRON_SECRET như fetch-orders. |
| B3 | `vercel.json` (sửa) | `{ "path": "/api/cron/delivery-push", "schedule": "*/30 * * * *" }`. |
| B3 | `.env.example` (sửa) | `DELIVERY_PUSH=""` + comment (off / `*` / danh sách configId). KHÔNG đụng `.env.local` / `.env.production.local`. |
| B4 | `lib/services/delivery-proxy.ts` (mới, server-only) | `DeliveryProxyError`, `listDeliveryTrackings`, `getDeliveryTracking`, `refreshDeliveryTracking` (55s), `startBulkRefresh`, `getBulkRefreshJob`, `getDeliveryProjects`. |
| B4 | `lib/http/delivery-error.ts` (mới) | `deliveryErrorResponse(err, tag)`. |
| QA | `lib/types/delivery.ts` (sửa) | `DeliveryPushChunkAccepted.applying?: true` (F1). |
| B5 | `app/api/delivery/route.ts` | GET list |
| B5 | `app/api/delivery/[id]/route.ts` | GET detail |
| B5 | `app/api/delivery/[id]/refresh/route.ts` | POST refresh, `maxDuration = 60` |
| B5 | `app/api/delivery/bulk-refresh/route.ts` | POST, 202 |
| B5 | `app/api/delivery/bulk-refresh/[job]/route.ts` | GET job |
| B5 | `app/api/delivery/projects/route.ts` | GET projects |

## Route (cho QA so khớp)

Mọi route `/api/delivery/*`: `requireEmail()` trước, `runtime="nodejs"`, `dynamic="force-dynamic"`; lỗi qua `deliveryErrorResponse` → body `DeliveryApiErrorBody`.

| Route | Method | Vào | 2xx | Mera |
|---|---|---|---|---|
| `/api/delivery` | GET | query whitelist `project_id,status,q,store,provider,date_field,from,to,review,rating,sort,page,limit` (key khác bị bỏ) | 200 `DeliveryTrackingListResponse` | `GET /api/v2/delivery-trackings?…` |
| `/api/delivery/[id]` | GET | path `id` | 200 `DeliveryTrackingDetail` | `GET /api/v2/delivery-trackings/:id` |
| `/api/delivery/[id]/refresh` | POST | path `id`, body bỏ qua | 200 `DeliveryTrackingDetail` (+`review_check`/`review_error`) | `POST …/:id/refresh` timeout 55s (`maxDuration` 60) |
| `/api/delivery/bulk-refresh` | POST | `BulkRefreshRequest` — `ids` không phải mảng string / body không phải JSON → 400 `{error, code:"invalid_body"}` | **202** `BulkRefreshJob` | `POST …/bulk-refresh` body `{ids}` |
| `/api/delivery/bulk-refresh/[job]` | GET | path `job` | 200 `BulkRefreshJob` | `GET …/bulk-refresh/:job` |
| `/api/delivery/projects` | GET | — | 200 `DeliveryProjectsResponse` | `GET /api/v1/projects` ‖ `GET /api/v2/delivery-trackings/dora-shops` |
| `/api/cron/delivery-push` | GET | `configId?` (hex 24, sai → 400 `{error, code:"invalid_id"}`), `force=1`; header `Authorization: Bearer $CRON_SECRET` (nếu set; sai → 401 `{error:"unauthorized"}`) | 200 `DeliveryPushCronResponse` | `POST /api/v2/delivery-trackings/external-refs` |

Chuẩn hoá thành công:
- List: `items ?? []`, mỗi item `orders ?? []`, mỗi order `items ?? []`, `counts ?? {}`, `stores ?? []`, `providers ?? []`; `total ?? 0`, `page ?? 1`, `limit ?? 0`. Phần tử không phải object trong các mảng bị bỏ.
- Detail/refresh: bóc `{tracking}` nếu Mera bọc (giữ `review_check`/`review_error` ở ngoài), `events ?? []`, `orders`/`items` như list.
- Bulk job (thêm, vô hại): `shops ?? []`, `no_receipt ?? []`.
- Projects: `projects` chỉ `{id,name}`, bỏ phần tử thiếu id, sort `name` (localeCompare). `doraShops`: `{store,count}` sort `store`; Mera lỗi BẤT KỲ / không phải 200 / `shops` không phải mảng → `null`.

Ánh xạ lỗi (đúng §3.2): Mera ≥400 + JSON có `error` string → cùng status, NGUYÊN body · Mera 401 → 502 `mera_auth_failed` · ≥400 không JSON / thiếu `error`, hoặc 2xx không phải object → 502 `mera_bad_response` (`error` chứa status) · meraFetch timeout/mạng → 502 `mera_unavailable` · thiếu env → 503 `mera_not_configured` · chưa đăng nhập → 401 `{error:"unauthenticated"}`.

Lưu ý QA/FE: `proxy.ts` (middleware) vẫn redirect mọi request chưa đăng nhập về `/login` trước khi tới route (hành vi sẵn có cho mọi `/api/*` không miễn) — `requireEmail` 401 là lớp phòng thủ thứ hai. `/api/cron` đã miễn session (không sửa proxy.ts).

## Push — hành vi

- Cổng: env `DELIVERY_PUSH` (A5). `scheduleDeliveryPush` return sớm khi config không bật → không đọc DB sau mỗi lần sync khi tắt.
- `scheduleDeliveryPush` (F2): tự khởi chạy `pushDeliveryForConfig` thành promise KHÔNG BAO GIỜ reject rồi `after(promise)`; `after` throw (ngoài request scope) → bỏ qua (promise đã chạy). Bỏ dạng `after(callback)` — callback không chạy khi gọi sau khi response đã đóng (sheet-order.ts, tracking-import.ts).
- Đọc `sheet_rows.find(pushRowsFilter(configId, window_from), projection §2.2)` + `listCarrierRules()` song song (1 lần/lượt). `buildDeliveryPushRows` vẫn là nguồn sự thật: lọc Tracking rỗng / itemId rỗng; MỌI Status; giữ `paid_at:null` (A7); bỏ `paid_at < window_from`. Sort `item_id` rồi `code` bằng so sánh code-unit (không localeCompare — để hash tất định giữa máy).
- `pushRowsFilter` (G1): `configId` + `values.Tracking ∉ {"", null}` + `$or[ Date ≥ "<ngày window_from>", Date không khớp YYYY-MM-DD, Time không khớp giờ-hợp-lệ-hoặc-rỗng ]`. Chỉ loại dòng mà JS chắc chắn cũng loại (Date đúng định dạng + cũ hơn cửa sổ + Time hợp lệ). Date/Time sai định dạng (paid_at null) vẫn được giữ. Lệch lý thuyết duy nhất: ngày đúng định dạng nhưng không tồn tại (vd `2025-02-30`) cũ hơn cửa sổ — JS gửi `paid_at:null`, filter bỏ; Mera đằng nào cũng `skipped_invalid` dòng đó → chỉ lệch số đếm.
- Chunk 1000, gửi TUẦN TỰ theo thứ tự, `actorEmail: "dora-1-system"`. Timeout: chunk giữa 30s, **chunk cuối 45s**. Rỗng → 1 chunk `rows: []` (Mera chấp nhận). Ô nhiều mã gửi nguyên chuỗi đã trim.
- Kỳ vọng: chunk giữa → 202 `done:false`; chunk cuối → 200 `done:true` + `applied` object. 409 `snapshot_superseded` (mọi chunk, kể cả lúc gửi lại) → `superseded`. Khác / ≥400 / meraFetch throw → `failed`, `error = "<status> <code>: <message>"` (≤500 ký tự; thiếu code → `-`; lệch kỳ vọng 2xx → code `unexpected_response`; lỗi throw có hậu tố `(chunk i/n)`).
- **Gửi lại chunk cuối (F1 + addendum)** — NGUYÊN body (cùng `snapshot_id`): Mera áp tiếp khi dora-1 ngắt và trả kết quả đã lưu (đã áp → cùng 200). Chỉ ở chunk cuối, chỉ với: throw `mera_unavailable` (timeout/mạng), 202 `done:false, applying:true`, 409 `scope_busy`, 502 `mera_shops_unavailable`. Tối đa 3 lần gửi lại; chờ 10s/15s/20s, riêng `scope_busy` chờ đúng `retry_after` Mera trả. Ngân sách 225s tính từ lần gửi chunk cuối đầu tiên: trước mỗi lần chờ kiểm `now + chờ + 45s ≤ hạn`; không lọt → bỏ (outcome `failed`, error `"<lỗi cuối> — bỏ sau N lần gửi lại chunk cuối"`, không ghi hash) để cron 30 phút thử lại. Với Mera thật (`scope_busy` trả sau ~20s chờ khoá, `retry_after:60`): 3 lần gửi ≈ 180s rồi bỏ. Xấu nhất 1 config ≈ 19×30s + 225s ≈ 13 phút < khoá treo 15 phút. `mera_not_configured`, 400, 500… ở chunk cuối KHÔNG gửi lại.
- Ghi DB: thành công `$set {deliveryPushedAt, deliveryPushHash, deliveryPushError:null, deliveryPushApplied, deliveryPushStartedAt:null}`; lỗi `$set {deliveryPushError, deliveryPushStartedAt:null}` (không ghi hash).
- Log 1 dòng/lượt: `[delivery-push] config=<hex> outcome=<…> rows=<n> chunks=<n> applied=<json>|error=<…>` (`failed` → console.error). `disabled` không log.

### Lệch nhỏ so với contract (có chủ đích, không đổi type)
1. Mọi update nhả khoá/ghi kết quả lọc thêm `deliveryPushStartedAt: <lockAt của lượt này>` — nếu khoá đã bị lượt khác chiếm lại (treo > 15 phút) thì lượt cũ không ghi đè/nhả khoá của lượt mới.
2. Lỗi bất ngờ (Mongo…) trong `pushDeliveryForConfig` → outcome `failed`, `error = "500 internal_error: …"`, nhả khoá nếu đã chiếm. Hàm không throw.
3. `DeliveryPushResult.chunks`: `pushed` = `chunk_total`; `failed`/`superseded` = số chunk đã nhận phản hồi HTTP (chunk throw mạng không tính; gửi lại chunk cuối không cộng thêm); skipped/disabled = 0. `rows` = số dòng snapshot cho pushed/failed/superseded, 0 cho skipped/disabled.
4. `isDeliveryPushEnabledFor`: so khớp id không phân biệt hoa thường; `off` không phân biệt hoa thường.

## Kiểm tra
- `npx tsc --noEmit`: sạch (exit 0).
- `npm run lint` (`eslint .`): KHÔNG chạy được — repo không cài `eslint` trong devDependencies và không có `eslint.config.*` (npx kéo eslint 10 rồi báo thiếu config). Không tự thêm config (ngoài phạm vi).
- Đọc thử (read-only) `sheet_rows` local 400 dòng có Tracking: Date đều `YYYY-MM-DD`, Time `HH:mm:ss` / `H:mm:ss` → khớp `sheetPaidAt`.
- Harness tạm (scratchpad, transpile TS + stub, KHÔNG DB thật, KHÔNG gọi Mera): helper thuần (paid_at, window_from ở biên ngày VN, provider, cổng env, map/lọc/sort rows, hash); luồng push (3 chunk 2500 dòng, unchanged, force, >24h, locked, stale lock, superseded, 400, MeraApiError, 2xx lệch, snapshot rỗng, disabled, fallback `after()` ngoài request); proxy (whitelist query + encode, chuẩn hoá mảng, bóc `{tracking}`, 429 nguyên body, 401→`mera_auth_failed`, 404 text→`mera_bad_response`, 2xx mảng→`mera_bad_response`, bulk 202, projects + dora-shops null/sort). Tất cả pass.
- Chưa gọi Mera dev thật (endpoint Mera đang làm song song) — để Q1.

## Sửa theo QA vòng 1 (`_workspace/04_qa_report.md`)
| # | Sửa | File |
|---|---|---|
| F1 | Chunk cuối timeout 45s + gửi lại nguyên body tối đa 3 lần (timeout/`mera_unavailable`, 202 `applying`, 409 `scope_busy`); type `DeliveryPushChunkAccepted.applying?: true`. Logic gửi tách vào `sendChunk()` (phân loại `accepted/done/retry/superseded/failed`). | `lib/services/delivery-push.ts`, `lib/types/delivery.ts` |
| F1-addendum | Thêm 502 `mera_shops_unavailable` vào tập gửi lại; `scope_busy` chờ `retry_after` nếu lọt ngân sách 225s, không thì `failed` cho cron thử lại. | `lib/services/delivery-push.ts` |
| F2 | `after(promise)` thay `after(callback)`; promise tự chạy, không reject. | `lib/services/delivery-push.ts` |
| F4 | Refresh timeout 60s → 55s (`maxDuration` giữ 60). | `lib/services/delivery-proxy.ts`, comment `app/api/delivery/[id]/refresh/route.ts` |
| G1 | Filter Mongo sơ bộ `pushRowsFilter`. Kiểm read-only trên Mongo local (3 config): rows gửi Mera GIỐNG HỆT `buildDeliveryPushRows` trên toàn bộ dòng không filter; số doc đọc 21.384 → 5.513. | `lib/services/delivery-push.ts` |

Harness bổ sung (scratchpad, đồng hồ ảo cho sleep), tất cả pass: timeout chunk cuối ×2 rồi 200 (cùng body, 45s, chờ 10/15s); 202 applying → 409 scope_busy → 200; luôn applying → failed sau 1+3 lần (10/15/20s), không ghi hash, nhả khoá; 202 ở chunk giữa = accepted; scope_busy ở chunk giữa → failed ngay; `mera_not_configured` chunk cuối không gửi lại; scope_busy → superseded khi gửi lại; 502 `mera_shops_unavailable` → 200; scope_busy `retry_after:60` với độ trễ Mera 20s → 3 lần gửi (chờ 60/60s) rồi bỏ do ngân sách; trễ 45s/lần → bỏ sau 1 lần gửi lại; scope_busy không `retry_after` → 10/15/20s; `mera_shops_unavailable` chunk giữa → failed ngay; `after()` nhận Promise (kể cả khi `after` throw); filter gửi Mongo đúng shape. Proxy: timeout refresh 55s.
