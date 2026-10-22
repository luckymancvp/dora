# 04 — QA tích hợp: tracking giao hàng Mera ↔ dora-1 (vòng 1: backend + frontend)

Ngày 2026-10-21 · Đầu vào: `_workspace/01_architect_contract.md` (S1–S13), `02_backend_changes.md`, `03_frontend_changes.md`, plan Mera `04_dora_shared_plan.md` §4–§5 + addenda, mã Mera BE (nhánh dev, working tree, chưa commit): `delivery_external_refs.go`, `delivery_tracking_controller.go`, `delivery_tracking_query.go`, `delivery_tracking_bulk.go`.

## Kiểm chứng đã chạy
- `npx tsc --noEmit` (dora-1): **exit 0**. Lưu ý `next.config.mjs` có `typescript.ignoreBuildErrors: true` nên `npm run build` KHÔNG bắt lỗi type, phải dựa vào tsc.
- Không gọi được endpoint thật: chưa có Mera dev nào chạy bản external-refs. Shape được so bằng cách đọc struct Go + JSON tag.
- Đọc mã nguồn Next 16.2.6 `node_modules/next/dist/server/after/*` + `build/templates/app-route.js` để kiểm `after()`.

## Kết luận
**Chặn merge: không có.** Shape JSON khớp field theo field ở cả 13 seam. Có 4 finding **nên sửa**: 2 ở luồng push (cả hai chỉ xảy ra khi bật `DELIVERY_PUSH`), 1 ở FE, 1 ở route refresh.

---

## Nên sửa

### F1 — Push: chunk cuối timeout 30s, dora-1 không gửi lại chunk cuối cùng snapshot → có thể lặp push toàn bộ mãi mãi
- **Seam:** S12 · **tầng:** service dora-1 ↔ service Mera
- **Bằng chứng:** `lib/services/delivery-push.ts:41` (`CHUNK_TIMEOUT_MS = 30_000`), `:337-347` (bắt throw → `failed`, break), `:371-378` (chunk cuối khác 200 done → `failed`). Phía Mera: `delivery_external_refs.go:53-55` (apply ≤10 phút, chờ khoá ≤20s), `:282-286` (apply chạy tiếp `WithoutCancel` khi caller đã đi; *"a retry of the last chunk then gets the stored result"*), `:210-212` (snapshot đã `applied` → trả lại kết quả đã lưu), `:305-307` + controller `:497-501` (đang apply bởi request khác → **202 `done:false, applying:true`** ở chunk cuối), controller `:484-485` (409 `scope_busy` + `retry_after:60`).
- **Kịch bản lỗi:** lần push đầu của một scope ~19k dòng. Chunk cuối kích apply: tạo ~17k doc (35 bulk ×500) + tra mã + lấy danh sách shop từ admin, có thể quá 30s (cộng thêm tới 20s chờ khoá). dora-1 abort ở 30s → `502 mera_unavailable` → `failed`, KHÔNG ghi hash. Mera vẫn apply xong. Lần sync kế (~2 phút) dựng snapshot MỚI → Mera apply lại toàn bộ → lại >30s → lặp. Hậu quả: cứ mỗi lần sync là ~19 chunk + 1 lần apply đầy đủ trên Mera, `deliveryPushError` không bao giờ hết. Trường hợp 202 `applying:true` cũng rơi vào `failed unexpected_response`.
- **Gợi ý sửa:** chỉ cho chunk cuối: khi bị `MeraApiError` 502 (timeout), 202 `applying:true` hoặc 409 `scope_busy` thì gửi lại **đúng body đó** (cùng `snapshot_id`) 2–3 lần, nghỉ 10–20s giữa các lần. Mera sẽ trả 200 kèm `applied` đã lưu. Có thể nâng thêm timeout chunk cuối (vd 90s) khi chạy từ cron (`maxDuration` 300). Thêm `applying?: true` vào `DeliveryPushChunkAccepted` (`lib/types/delivery.ts:339`).

### F2 — Push: gọi `after()` SAU khi response đã đóng (đường sync chạy nền) → push bị bỏ im lặng + promise `waitUntil` treo
- **Seam:** S13 trigger (a) · **tầng:** service
- **Bằng chứng:** `lib/services/delivery-push.ts:478-482` (`try { after(run) } catch { void run() }`). Bên gọi chạy nền: `lib/services/sheet-order.ts:68`, `lib/services/tracking-import.ts:154` (`void syncSheetIfStale(cfg)`). Các route này trả response trước khi sync xong: `app/api/sheets/resolve`, `resolve-batch`, `update`, `app/api/tracking/import/check`, `preview`. Mã Next: `after.js` chỉ throw khi KHÔNG có `workStore`, nhưng ALS vẫn truyền `workStore` sang phần chạy tiếp của promise nên **không throw** → fallback không bao giờ chạy. `after-context.js` `addCallback` → `runCallbacksOnClose` → `onClose(resolve)`. `build/templates/app-route.js:230` `onClose: cb => res.on('close', cb)`: response đã đóng thì sự kiện `close` không phát lại, nên callback không bao giờ chạy và `waitUntil(runCallbacksOnClosePromise)` treo mãi.
- **Kịch bản lỗi:** config warm, user mở panel tra đơn. `/api/sheets/resolve` trả về ngay, sync nền xong sau vài giây và gọi `after()` → push của lần sync đó không chạy (cron 30 phút sẽ bù). Trên Vercel, promise `waitUntil` không bao giờ resolve có thể giữ invocation tới `maxDuration`. Đường đã `await` (`/api/sheets/sync-stale`, `/configs/[id]/sync`) vẫn chạy đúng.
- **Gợi ý sửa:** dùng dạng promise `const p = run(); try { after(p) } catch { /* p đã chạy */ }`. Nhánh promise của `after` gọi thẳng `waitUntil` mà không phụ thuộc `onClose`. Push bắt đầu ngay, không `await` nên không tăng latency của response. Cách khác: chỉ gọi `scheduleDeliveryPush` ở route đã `await` sync.
- **Mức tin cậy:** suy ra từ mã nguồn Next 16.2.6, chưa chạy runtime để tái hiện. Ghi là "nên sửa (cần xác nhận runtime)".

### F3 — FE: `rowFromDetail` thay `orders` đã lọc theo project bằng `orders` của detail (không lọc)
- **Seam:** S6 · **tầng:** hook ↔ service Mera
- **Bằng chứng:** `lib/hooks/useDelivery.ts:116` (`orders: rest.orders?.length ? rest.orders : prev.orders`). Mera list lọc orders theo project đang xem: `delivery_tracking_query.go:451-465` (`scope` = `p.ProjectIDs`, `dora:<store>` chỉ giữ đơn dora của shop đó) + `:174-177`. Detail/refresh dùng `allowed` = MỌI project + `dora` (internal key): controller `:299`, `:336`. Mera FE có cùng lỗi (`TrackingPage.tsx:93-97`), dora-1 chép nguyên.
- **Kịch bản lỗi:** đang xem "Dora - ShopA", làm mới một mã có cả đơn Mera lẫn đơn Dora ShopB → dòng hiện thêm đơn Mera/ShopB, cột Fulfill/Order ID đổi. `rowShops` khi tick đổi (đếm ≤50/shop sai). Bấm "Tải lại" thì về đúng.
- **Gợi ý sửa:** giữ tập đơn của dòng cũ, chỉ lấy dữ liệu mới cho các đơn trùng khoá: `orders: prev.orders.map(po => rest.orders?.find(o => o.order_id === po.order_id && (o.source ?? "mera") === (po.source ?? "mera") && o.store === po.store) ?? po)`.

### F4 — Route refresh: `maxDuration = 60` bằng đúng timeout `meraFetch` 60s, không còn biên
- **Seam:** S6/S10 · **tầng:** route
- **Bằng chứng:** `app/api/delivery/[id]/refresh/route.ts:10` + `lib/services/delivery-proxy.ts:39`. Mera refresh: ≤45s/shop đọc vận đơn, rồi đọc review (controller `:302-305`).
- **Kịch bản lỗi:** Mera trả ở giây ~58–60 (cộng thời gian `auth()`). Vercel cắt hàm ở 60s, trả 504 HTML thay vì 502 `mera_unavailable` → FE `deliveryFetch` nhận `{error:"504"}` → toast hiện "504".
- **Gợi ý sửa:** `REFRESH_TIMEOUT_MS = 55_000`, hoặc `maxDuration = 75`.

---

## Ghi chú (không chặn)
- **G1 Chi phí đọc:** mỗi lần sync (~2 phút/config) push đọc lại toàn bộ `sheet_rows` của config (projection 10 field) + `listCarrierRules` + sha256, kể cả khi không đổi (`delivery-push.ts:286-291`). ~19k doc/lượt. Hiện chấp nhận được; theo dõi khi bật `*`.
- **G2 Config bị tắt/xoá:** ref của scope đó trên Mera không bao giờ được gỡ (không có snapshot rỗng cuối). Ghi nhận cho rollout.
- **G3 Quy tắc skip của Mera** (`delivery_external_refs.go:512`): `store` rỗng (sheet thiếu cột Store), receipt không 9–12 số, `paid_at` null/không parse được → `skipped_invalid`. dora-1 vẫn gửi những dòng này (đúng A7). Chỉ quan sát được qua `deliveryPushApplied.skipped_invalid`, không có UI.
- **G4 Cron 300s:** `pushDeliveryAll` chạy tuần tự. Nếu Mera treo, mỗi config mất 30s ở chunk 1; trên 10 config đang bật thì hàm bị cắt giữa chừng, khoá của config dở dang treo 15 phút (sync push → `skipped_locked`).
- **G5 `after()` ở route đã await** (`/api/sheets/sync-stale`) bị giới hạn bởi `maxDuration` mặc định của Vercel (route không đặt). Cần xác nhận dự án dùng fluid compute (300s) hay mặc định cũ (15s). Contract §7.4 đã chấp nhận rủi ro này.
- **G6 Kích thước body:** 1000 dòng ≈ 300–500KB/chunk. Cần xác nhận proxy trước Mera (nginx/ingress) không giới hạn dưới 1MB.
- **G7 Hết phiên:** middleware `proxy.ts` redirect `/api/delivery*` về `/login` (HTML 200) → `deliveryFetch` `res.json()` ném SyntaxError, toast hiện chuỗi thô. Mẫu này có sẵn ở mọi hook khác.
- **G8 Retry global `retry: 1`** (`components/providers.tsx`): lỗi 4xx Mera (`invalid_*`, `not_found`) bị gọi lại 1 lần. Vô hại.
- **G9 Mera list `paid_desc`** là sort mặc định. FE chỉ gửi `delivered_desc`. Khớp.

---

## Seam đã đối chiếu: KHỚP
| Seam | Đối chiếu | Kết quả |
|---|---|---|
| S11 push row | `DeliveryPushRow` (types:300) ↔ `ExternalRefRow` JSON tag (`delivery_external_refs.go:85-96`): item_id, order_id, etsy_receipt_id, store, code, carrier, sheet_status, product_name, provider, paid_at (`*string`, null OK) | khớp 10/10 |
| S12 request | `DeliveryPushRequest` ↔ `externalRefsRequest` (controller:446-454): source/scope/snapshot_id/chunk/chunk_total/window_from(`*time.Time`, RFC3339 `+07:00` parse OK)/rows. `scope` = hex (không chứa ':'), uuid (không '#', ≤100), chunk 1-based, `chunk_total` ≥1, `rows:[]` hợp lệ (validate:152-174), window_from giống nhau mọi chunk (kiểm :207) | khớp |
| S12 response | 202 `{snapshot_id,received,chunk_total,done:false[,applying]}` / 200 `{snapshot_id,done:true,applied{rows,upserted_refs,removed_refs,new_codes,skipped_mera_shop,skipped_invalid}}` ↔ `DeliveryPushChunkAccepted`/`DeliveryPushDone`/`parseApplied` | khớp (thiếu `applying?`, xem F1) |
| S12 lỗi | 409 `snapshot_superseded` → `superseded`; 400 `invalid_payload`, 409 `scope_busy`, 502 `mera_shops_unavailable`, 403 `internal_only` → `failed "<status> <code>: <error>"` | khớp |
| Push logic | `window_from` = 00:00 VN của (hôm nay VN − 60) (đã tính tay 2 mốc biên ngày), `paid_at` `YYYY-MM-DDTHH:mm:ss+07:00`, lọc Tracking rỗng, mọi Status, giữ null / bỏ < window, chunk 1000, sort code-unit, hash gồm window_from, bỏ qua khi trùng hash & <24h, khoá atomic + stale 15', nhả khoá theo `lockAt`, cổng `DELIVERY_PUSH` ở cả `scheduleDeliveryPush` và `pushDeliveryForConfig`, carrier qua `evaluateCarrierRules` | đúng contract §2 |
| S13 trigger | `syncSheetNow` gọi `scheduleDeliveryPush` sau `updateOne` thành công, không await, không throw, chữ ký/return giữ nguyên. Cron GET: guard `CRON_SECRET` giống fetch-orders, `configId` sai hex → 400 `invalid_id`, `force=1`, `maxDuration` 300. `vercel.json` `*/30`. `proxy.ts` miễn `/api/cron` | khớp (riêng `after()` xem F2) |
| S1 list | whitelist route (`delivery-proxy.ts:44-58`) = đúng tập key Mera `List` đọc (controller:145-249). Output `buildDeliveryTrackingQuery` ⊂ whitelist. `DeliveryListResult` {items,total,page,limit,counts,stores,providers} ↔ type. `DeliveryTrackingView`/`DeliveryOrderView`/`DeliveryItemView`/`ItemReviewView` ↔ type A, field theo field | khớp |
| S2 tab | Key `counts` của Mera: `all`, 9 status, `delivered_no_review`, `delivered_rating_1..5` (query.go:578-587). Reviewed = delivered − no_review. `review=none` không bao giờ đi kèm `rating` (Mera trả 400 nếu có) | khớp |
| S3 project | `/api/v1/projects` → `{projects:[{id(hex),name,team_member_ids}]}`, route bỏ `team_member_ids`. `/dora-shops` → `{shops:[{store,count}]}`. `dora:<store>`: URLSearchParams encode/decode tròn (`+`/`%3A`), Go `c.Query` decode `+` thành khoảng trắng, store đã trim khi push nên khớp `TrimSpace` của Mera | khớp |
| S4 row | `orders[].source` ("mera"/"dora_sheet"), `etsy_receipt_id`. Link `/orders?search=` được `app/orders/page.tsx:58` đọc | khớp |
| S5 detail | `DeliveryTrackingDetailView` embed row (JSON phẳng, không bọc `{tracking}`) + events/flags/mera_carrier/status_changed_at/first_event_at/error_count/hidden/created_at/updated_at ↔ type | khớp |
| S6 refresh | `refreshResponse` = detail phẳng + `review_check` + `review_error`. Mọi mã lỗi trong contract §3.2 được chuyển tiếp nguyên body. `refreshErrorMessage` xét nhánh `mera_*` trước 503 | khớp (F3, F4) |
| S7/S8 bulk | Mera 202 `BulkRefreshJob` {id,created_by,done,codes,no_receipt,shops[],started_at,finished_at}, `BulkRefreshShop` 11 field, phase `queued/shipments/reviews/done/failed` ↔ type. Hook coi mọi 2xx là thành công. Poll 3s, dừng khi `done` hoặc lỗi, `retry:false`. `onDone` gọi đúng 1 lần/job (kể cả job `done` ngay) → invalidate list + detail. Route tĩnh `bulk-refresh` không bị `[id]` nuốt (`[id]` ở cùng cấp, Next ưu tiên segment tĩnh) | khớp |
| S9 export | `limit=200` (trần Mera `invalid_limit` >200), dừng khi `items<200` hoặc `page*200>=total`, bỏ mã trùng. 24 cột header = độ dài mỗi dòng (12 + 11 + 1) | khớp |
| S10 hạ tầng | 401 Mera → 502 `mera_auth_failed`. Lỗi không JSON → 502 `mera_bad_response`. Timeout → 502 `mera_unavailable`. Thiếu env → 503 `mera_not_configured`. FE không redirect trên 401 | khớp |
| Type contract | Hook/component/helper chỉ import từ `@/lib/types/delivery`, không tự khai shape API | khớp |

---

# Vòng 2 — kiểm lại F1–F4/G1 + seam chéo với Mera BE/FE đã xong (2026-10-21)

Đầu vào: mã dora-1 working tree (file delivery chưa track, đọc toàn văn), `git diff` các file đã track (`mera-order.ts`, `sheet-sync.ts`, `types/sheets.ts`, `vercel.json`, `sidebar.tsx`, `.env.example`); Mera BE `mera-fulfill-backend` (dev, chưa commit: `delivery_external_refs.go`, controller, query/refresh/bulk/model diff); Mera FE `mera-fulfill-frontend` (chưa commit); plan Mera §4, §5, §9.

## Kiểm chứng đã chạy
| Lệnh | Kết quả |
|---|---|
| dora-1 `npx tsc --noEmit` | exit 0 |
| Mera BE `go build ./...` | exit 0 |
| Mera BE `go vet ./internal/...` | exit 1, chỉ cảnh báo có sẵn `dora_api_service.go:76 rawConvID` (đã ghi ở §9) |
| Mera BE `go test ./internal/services/ -run "External\|DoraShop\|ParseDelivery"` + `./internal/controllers/ -run "Dora\|ParseDeliveryProject\|External"` | ok / ok |
| Mera FE `npx tsc -b` | exit 0 |
| Next 16.2.6 `dist/server/after/after-context.js` | `after(promise)` → `this.waitUntil(task.catch(...))` trực tiếp, không qua `onClose` (xác nhận F2) |

Vẫn chưa gọi được endpoint thật. Shape so bằng struct Go + JSON tag.

## Kết luận vòng 2
**Không có finding chặn merge.** F1–F4 và G1 đã đóng, không thấy hồi quy. Seam dora-1 ↔ Mera BE khớp ở mọi điểm được yêu cầu. Còn **1 finding nên sửa, nằm ở Mera FE** (cùng lỗi F3 chưa được chép bản sửa sang) và vài ghi chú.

## Xác minh bản sửa
| # | Bản sửa | Bằng chứng | Kết quả |
|---|---|---|---|
| F1 | Gửi lại chunk cuối | `delivery-push.ts:55-57` (45s, 10/15/20s, ngân sách 225s), `:296` (chỉ `mera_unavailable`, không retry `mera_not_configured`), `:307-316` (409 `scope_busy` + `retry_after`×1000), `:317-320` (502 `mera_shops_unavailable`), `:336-339` (202 `applying:true`), `:456-470` (vòng gửi lại NGUYÊN `body`, cùng `snapshot_id`; kiểm `now+wait+45s ≤ deadline`). Mera: gửi lại khi đã `applied` → 200 kết quả đã lưu (`delivery_external_refs.go:210-212`); đang `applying` → chờ khoá ≤20s rồi 202 `applying` (`:299-307`); `mera_shops_unavailable`/lỗi áp → `backToPending` (`:336-338, :367-371`) nên gửi lại = áp lại; `chunk_total=1` gửi lại chunk 1 không đổi `latest_snapshot_id` vì header đã có (`:185-197`). `retry` chỉ sinh khi `isLast` nên chunk giữa không đổi hành vi. Tính tay: timeout ×4 = 45+10+45+15+45+20+45 = 225s, vừa đủ; `scope_busy` ×60s được gửi lại 2 lần. Ngoài ra lần áp thứ 2 của snapshot không đổi chỉ ghi mã có ref đổi (`decideExternalRefs` + `refsEqual`, `:651, :668`), nên vòng lặp "áp lại toàn bộ" mô tả ở F1 không còn | **đóng** |
| F2 | `after(promise)` | `delivery-push.ts:585-595`: promise chạy ngay, `after(p)` gọi `waitUntil` trực tiếp. Ngoài request scope thì `after` throw và bị nuốt, promise vẫn chạy. Ở route đã `await` sync (`/configs/[id]/sync`), push giờ chạy SONG SONG với phần còn lại của request thay vì chạy sau response. Không await nên không tăng latency | **đóng** (còn phần runtime, xem N3) |
| F3 | `mergeScopedOrders` | `useDelivery.ts:116, :120-138`: giữ tập đơn của dòng, thay theo khoá `order_id+source+store`. Khớp phạm vi Mera: list lọc theo `scope`, riêng `dora:<store>` chỉ giữ `source=dora_sheet && store` (`delivery_tracking_query.go:457-468`); detail/refresh trả mọi project + `dora` (controller `allowedProjects` thêm `dora`). Field cấp dòng (`paid_at`, `status`…) là của doc, không phụ thuộc phạm vi, nên spread `...rest` vẫn đúng | **đóng** |
| F4 | Refresh 55s | `delivery-proxy.ts:42` `REFRESH_TIMEOUT_MS = 55_000`, `[id]/refresh/route.ts:10` `maxDuration = 60`, `mera-order.ts` `timeoutMs` mặc định 15s nên caller cũ giữ nguyên | **đóng** |
| G1 | Lọc sơ bộ Mongo | `delivery-push.ts:92-103`. Đã đối chiếu từng nhánh với `sheetPaidAt`/`buildDeliveryPushRows`: Date/Time thiếu field, không phải string, có khoảng trắng hoặc sai định dạng đều được GIỮ (`$not` khớp cả field thiếu). Regex Time của Mongo ⇔ điều kiện JS (`hh≤23`, `mm` 2 số, `ss` 2 số tuỳ chọn). Chỉ lệch ở ngày không tồn tại cũ hơn cửa sổ (đã ghi chú trong code; Mera cũng bỏ dòng đó). Hash không đổi so với trước, trừ trường hợp lệch này (gửi lại 1 lần) | **đóng** |

## Seam chéo dora-1 ↔ Mera BE (bản cuối)
| Seam | Đối chiếu | Kết quả |
|---|---|---|
| Request external-refs | `externalRefsRequest` (controller `:446-454`) + `validateExternalChunk` (`:154-174`): source `dora_sheet`, scope hex (không ':'), uuid (≤100, không '#'), `1≤chunk≤chunk_total≤500`, `rows≤1000`, `rows:[]` hợp lệ, `window_from` `*time.Time` RFC3339 (`+07:00` parse OK, cắt ms rồi so `Equal` với chunk 1). Mọi chunk + mọi lần gửi lại dùng cùng `window.iso` (tính 1 lần/lượt, `delivery-push.ts:411`) | khớp |
| Luật nhiều mã | `externalCode` (`:444-460`): `,` `;` `\n` `\r`, hoặc ≥2 cụm ≥8 ký tự → invalid; cụm ngắn ghép lại. dora-1 gửi nguyên ô đã trim (`delivery-push.ts:209`), xuống dòng bên trong được giữ, JSON escape đúng | khớp |
| Thứ tự chunk / supersede | Mera: chunk 1 mới → `latest_snapshot_id`; chunk >1 của snapshot lạ/hết hạn → 409 `snapshot_superseded`; snapshot cũ bị chặn cả khi lấy khoá (`:318-322`). dora-1 gửi tuần tự từ 1, gặp `superseded` thì dừng (không ghi hash), khoá Mongo `deliveryPushStartedAt` bảo đảm 1 lượt/config | khớp |
| Body 202/200/409/502 | 202 `{snapshot_id,received,chunk_total,done:false[,applying:true]}`, 200 `{snapshot_id,done:true,applied{6 field, json "-" bị loại}}`, lỗi `{error,code[,retry_after]}` (controller `:476-501`) ↔ phân loại trong `sendChunk` | khớp |
| `retry_after` | Mera `gin.H{"retry_after": 60}` (int, giây) ↔ `asNumber(getPath(data,"retry_after"))*1000`; type `DeliveryApiErrorBody.retry_after?: number` (`types/delivery.ts:280`) | khớp |
| 500 `internal_error` chunk cuối | dora-1 → `failed`, không gửi lại. Mera đã `backToPending`, lượt sau dựng snapshot mới và áp (chỉ ghi phần đổi) | chấp nhận |
| dora-shops | `GET /dora-shops` → `{shops:[{store,count(int64)}]}`, sắp theo tên. Lỗi → 500 `internal_error` → `fetchDoraShops` trả null → ẩn option | khớp |
| `project_id=dora:<store>` | FE `doraShopProjectId(store)` → URLSearchParams (`:`→`%3A`, space→`+`) → whitelist proxy → Gin `c.Query` decode → `parseDeliveryProjectID` TrimSpace + so khớp `store` CHÍNH XÁC (phân biệt hoa thường) với ref. `store` lấy nguyên từ `/dora-shops` và dora-1 trim khi push, nên khớp | khớp |
| `orders[].source` | `ToDeliveryView` luôn gán (`""`→`"mera"`), không `omitempty`. dora-1 vẫn `?? "mera"` phòng thủ | khớp |
| List "Tất cả" | Không gửi `project_id` → Mera dùng mọi project được phép + `dora` (`allowedProjects`) → dòng có đơn Dora; export có cột Source | khớp |
| Refresh mã dora | Đọc vận đơn theo `receiptsByShop(&doc)`, gồm cả ref dora (store = kênh Ably). Đọc review chỉ cho ref Mera (`meraOnlyRefs`). Mã chỉ có Dora đã giao → `review_check {receipts:0,item_reviews:0,error:""}` → `refreshReviewSummary` trả "" (toast chỉ hiện trạng thái). Mọi mã lỗi refresh (`shop_blocked_env`, `shop_busy`, `shop_offline`, `etsy_read_failed`, `no_receipt`, `too_soon`, `refresh_unavailable`) có nhánh trong `refreshErrorMessage` | khớp |
| Bulk mã dora | `bulkShopCounts` (`delivery_tracking_bulk.go:115-120`) gom theo store của mọi ref active, gồm cả dora. Ref dora luôn có store (Mera bỏ dòng thiếu store) nên không rơi vào `no_receipt` | khớp (xem N2) |
| `review=none` | Mã dora không bao giờ có `reviewed_item_keys` nên luôn nằm ở "Chưa đánh giá" (`delivered_no_review`). Tab sao 1–5 = 0 với `dora:*`. Đúng §9 mục 12 | khớp |

## Mera FE ↔ Mera BE
| Điểm | Kết quả |
|---|---|
| `types/deliveryTracking.ts`: `DeliveryOrderSource`, `source?`, `DeliveryDoraShopsResponse{shops: DeliveryStoreCount[]}` ↔ `DeliveryOrderView.Source`, `gin.H{"shops": ...}` | khớp |
| `deliveryTrackingApi.doraShops` → `/v2/delivery-trackings/dora-shops`, lọc `s.store` rỗng | khớp |
| Giá trị select `dora`/`dora:<shop>` → `qs.set('project_id', …)` → `parseDeliveryProjectID`; không ghim vào ô nhớ project chung; `realProjectId` cho link Orders / dora tag | khớp |
| `rowFromDetail` sau refresh | **lệch**, xem M1 |

## Nên sửa

### M1 — Mera FE: `rowFromDetail` vẫn thay `orders` của dòng bằng `orders` của detail (F3 chưa được chép sang Mera FE)
- **Tầng:** Mera FE ↔ Mera BE · **bằng chứng:** `mera-fulfill-frontend/src/pages/tracking/TrackingPage.tsx:96` (`orders: rest.orders?.length ? rest.orders : prev.orders`). BE: list lọc theo phạm vi (`delivery_tracking_query.go:457-468`), detail/refresh trả mọi project + `dora`.
- **Kịch bản:** trước vòng này lỗi chỉ xảy ra với mã dùng chung giữa nhiều project. Giờ có thêm Dora: đang xem `Dora - ShopA`, bấm làm mới một mã có thêm đơn Mera hoặc đơn Dora ShopB → dòng hiện cả đơn ngoài phạm vi (cột Order ID/Shop sai, nhãn Dora lẫn với link Mera) cho tới khi tải lại.
- **Gợi ý sửa:** chép `mergeScopedOrders` của dora-1 (`lib/hooks/useDelivery.ts:120-138`, khoá `order_id + (source ?? 'mera') + store`).

## Ghi chú (không chặn)
- **N1, nâng G4: ngân sách gửi lại tính riêng cho từng config, không theo thời gian còn lại của cron.** `delivery-push.ts:456-470` (225s/config), `pushDeliveryAll` tuần tự (`:566-568`), cron `maxDuration` 300. Kịch bản: Mera vừa khởi động lại (cache shop rỗng) mà admin đang lỗi → mọi chunk cuối trả 502 `mera_shops_unavailable` ngay (`delivery_external_refs.go:398-411`). Mỗi config tốn ~45s ngủ + 4 request. Từ khoảng 6 config trở lên, hàm bị cắt ở 300s: config đang chạy giữ khoá 15 phút, cron không trả JSON tổng kết. Chỉ xảy ra khi Mera/admin lỗi, và lúc đó đằng nào cũng không push được. Gợi ý sửa sau: truyền deadline từ cron (không bắt đầu config mới hoặc không gửi lại khi còn dưới ~60s), hoặc không gửi lại `mera_shops_unavailable` khi chạy từ cron.
- **N2: đếm ≤50/shop.** FE đếm theo đơn trong phạm vi (`trackingSelection.ts:15`), Mera đếm theo mọi ref active của mã (`delivery_tracking_bulk.go:115-120`). Ở phạm vi `dora:<store>` hoặc một project, FE có thể đếm thiếu shop ngoài phạm vi. Mera trả 400 `too_many_per_shop`, FE hiện lỗi, không hỏng dữ liệu.
- **N3, phần runtime còn lại của F2:** các route sync nền (`sheet-order.ts:68`, `tracking-import.ts:154`) không đưa promise sync vào `waitUntil` (có từ trước). Trên Vercel, việc sync rồi push có chạy hết sau khi response đóng hay không tuỳ fluid compute. Cron 30 phút bù. Cần xác nhận runtime, không phải lỗi mã.
- **N4: option "Dora" khi chưa có shop.** dora-1 hiện "Dora" khi `doraShops = []` (`DeliveryToolbar.tsx:33`, `!== null`), Mera FE ẩn khi rỗng (`TrackingPage.tsx:153`, `length > 0`). Vô hại (chọn thì ra danh sách rỗng), chỉ là hai bên không nhất quán.
- **N5: khoá `orderKey`** (`useDelivery.ts:120-122`): nếu 2 sheet_config cùng đẩy một `(code, order_id, store)`, mã sẽ có 2 ref dora trùng khoá và `Map` gộp làm một. Hiếm (cùng đơn ở 2 sheet); hiển thị vẫn đúng dữ liệu.
- **N6: `DELIVERY_PUSH` chỉ nên đặt ở production.** Preview dùng chung Mongo sẽ chia khoá nên không chạy song song; preview dùng Mongo riêng mà chép `sheet_configs` sẽ đẩy cùng scope và làm hai bên supersede nhau.
- **N7: comment cũ ở Mera:** `externalLockWait` ghi "below dora-1's 30s request timeout" (`delivery_external_refs.go:55`). Chunk cuối giờ là 45s. Vẫn đúng (20s < 45s), chỉ cần sửa chữ.
- G2, G3, G5–G9 của vòng 1 giữ nguyên.
