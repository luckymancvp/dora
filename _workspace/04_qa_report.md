# 04 — QA tích hợp: Request reviews (dora-1 ↔ Mera fulfill ↔ admin ↔ extension)

Ngày 2026-10-21 · Skill `dora-integration-qa` · Nguồn sự thật shape: Go code `mera-fulfill-backend` (plan §10).
Phạm vi: diff chưa commit ở `dora-1`, `mera-fulfill-backend`, `mera-fulfill-frontend` (bỏ qua `OrderTable.tsx`, `OrdersPage.tsx`), `mera-admin-backend`; đọc thêm `dora-extension` (luồng `fetch-order-convo`). Không sửa code.

## 0. Kết luận

**Không có finding chặn merge.** Mọi hợp đồng dây (header, path, body key, kiểu `requestedAt`, shape 409, JSON tag ↔ type TS) đều khớp; build/type check sạch.
Có **6 finding nên sửa**, phần lớn là hành vi khi tải lớn hoặc khi có lỗi (timeout Run đồng bộ, 429 Etsy do fetch theo lô, rơi số đếm skip ở dora-1, kẽ hở validate mẫu tin, "unconfirmed → failed"), cộng 1 điểm cần xác nhận dữ liệu thật.

## 1. Kiểm chứng bằng thực thi

| Lệnh | Kết quả |
|---|---|
| dora-1 `npx tsc --noEmit` | sạch (exit 0) |
| fulfill `go build ./...` | sạch |
| fulfill `go vet ./internal/...` | **exit 1** — chỉ 1 lỗi CÓ TỪ TRƯỚC, không thuộc diff: `internal/services/dora_api_service.go:76` `struct field rawConvID has json tag but is not exported` (commit f4ff0f2, file không bị sửa). `go vet` cho controllers/routes/models: sạch. |
| fulfill `go test ./internal/controllers ./internal/services -run Review…` | ok |
| admin `go build ./... && go vet ./...` | sạch; `go test ./internal/models ./internal/services -run Request` ok |
| Mera FE `npx tsc -b` | sạch; `vitest` reviewRequest + RequestReviewsDialog + TriggerModal: 43/43 pass |
| Gọi thử endpoint | Không làm được: dev server dora-1 không chạy (localhost:3000 từ chối kết nối), Mera BE chưa deploy. DB trong `.env.local` có 0 doc `order_conversations` → không kiểm được payload "đơn chưa có hội thoại" (xem C1). |

## 2. So khớp chéo theo seam (✓ = khớp)

| Seam | Mera Go (nguồn sự thật) | dora-1 | Mera FE | Ghi chú |
|---|---|---|---|---|
| settings GET/PUT | `ReviewRequestSettingsView` review_request_service.go:148-157 | `normalizeSettings` review-request-proxy.ts:64 ✓ | `normalizeSettings` reviewRequestApi.ts ✓ | `updated_at` null khi chưa có doc ✓; PUT `max_days *int` — cả 2 FE chặn số không nguyên ✓ |
| preview | `ReviewPreview` :469 + `ReviewSkipCounts` :240 (6 key) + sample :456 (thêm `project_id`, `tracking_id`) | **chỉ giữ 3 key skipped** (:81-88); bỏ `project_id`/`tracking_id` của sample (FE không đọc → vô hại) | giữ mọi key ✓ | xem B4 |
| run | `ReviewRunResult {queued, checking, skipped}` :498 | bỏ `checking` + 3 key skip (:177) | giữ skip, bỏ `checking` | xem B4 |
| send | `ReviewSendResult` :661; skipped có `tracking_id` :655; warnings có `etsy_receipt_id` | bỏ `tracking_id` (:112-116), bỏ `etsy_receipt_id` | type thiếu `tracking_id` | xem N1 |
| summary | `ReviewSummary {queued(⊇checking), checking, sending, sent_today, failed_recent[]}` :856; `At time.Time` luôn có | bỏ `checking` (vô hại: queued đã gồm checking) ✓ | ✓ | |
| orders[].review_request | `DeliveryReviewRequestView` :926 (`sent_at` null, `skip_reason` omitempty chỉ khi skipped) | type D + pass-through list/detail ✓; `rowFromDetail` ghi đè theo đơn ✓ | ✓ | detail cũng gắn (`AttachReviewsToDetail` → attachReviews → attachReviewRequests) ✓ |
| máy fetch convo | `FetchOrderConversations` dora1_client.go: header `x-api-key`, body `{shopName, orderIds:int64[]}`, đọc `requestedAt` RawMessage (RFC3339Nano / số), 409 + `code=="shop_offline"` → ErrDora1ShopOffline | route fetch/route.ts: `hasMachineApiKey` (x-api-key), `orderIds` số nguyên dương ≤50, `requestedAt = new Date().toISOString()` TRƯỚC publish, 409 `{ok:false, code:"shop_offline"}` ✓; proxy.ts:37-43 cho `/api/machine/*` có `x-api-key` đi qua ✓ | — | ✓ toàn bộ |
| fetched_at vs requestedAt | `reviewCheckDecision` worker.go:368: `fetched_at(giây) >= requested.Unix()` | `fetched_at = new Date()` do **server dora-1** ghi lúc extension POST sync (order-conversation-sync.ts:242,261) — cùng đồng hồ với `requestedAt` ✓; `order_id` lưu số, Mera query cả số + chuỗi (`receiptKeys`) ✓; `flexTime` đổi BSON Date → giây ✓ | — | Lệch cùng giây: doc cũ ghi trong cùng giây trước requestedAt được coi là mới — chênh ≤1s, chấp nhận được |
| trigger | `RunFromTrigger` controller:254: `Authorization: Bearer INTERNAL_API_KEY`, `:project_id` hex \| `dora` (không nhận `dora:<store>`), 200 đồng bộ | admin executor: POST, Bearer, path `/internal/projects/%s/request-reviews`, target `dora` khi `include_dora` (trigger_executor.go:160-171), 200 → success ✓, body nil (fulfill không bind body) ✓, `X-Act-As-User` → email ✓ | TriggerModal gửi `request_reviews:{include_dora}` + `project_ids: []` khi "chỉ Dora"; validate khớp `ValidateTriggerProjects`/`onlyRequestReviews` admin ✓ | |
| project map | `parseDeliveryProjectID`: hex \| dora \| dora:<store> | `reviewRequestProjectId`: '' → null (select bắt buộc), dora/dora:<store> → "dora" ✓ | `all`/'' → null (picker), dora:* → "dora" ✓ | xem N3 |
| giới hạn 50 mã/shop | `perShop[o.Store]` ≤ `BulkRefreshMaxPerShop`=50 (đếm mã/store, chỉ ref trong scope) | `BULK_MAX_PER_SHOP`=50 theo `orders[].store` (đếm ≥ Mera) ✓ | như dora-1 ✓ | |
| gửi tay | không kiểm hội thoại, xếp `queued` thẳng (service.go:818-825), giữ `project_id` scope ✓ | gửi `project_id` khi filter ≠ '' ✓ | gửi `fixedScope` ✓ | đúng plan R4 |
| env guard | `DORA_SEND_SHOP_PREFIX` áp ở plan (candidates), Send (`send_blocked_env`), worker `sendOne`; không đặt + không prod ⇒ `ZZTEST-`; local/dev.env đặt `ZZTEST-`, master để trống ✓; worker mặc định on chỉ khi `ENVIRONMENT=production`, local/dev `off` ✓ | | | |

## 3. Findings

### Chặn merge
Không có.

### Nên sửa

**B1 — Run đồng bộ, gọi dora-1 tuần tự từng shop, chạy dưới context của request → dễ vượt timeout proxy dora-1 (30s) / admin (60s) và bị huỷ giữa chừng**
- Repo/owner: **mera-fulfill-backend** (BE fulfill).
- Bằng chứng: `review_request_service.go:555-566` (vòng shop × chunk tuần tự, mỗi chunk 1 lần `FetchOrderConversations` = Ably presence + publish qua Vercel, có thể cold start); `review_request_controller.go:171,278` dùng `c.Request.Context()`; dora-1 `review-request-proxy.ts:33` `HEAVY_TIMEOUT_MS = 30_000`; admin `trigger_executor.go:81-82` `Timeout: 60s`.
- Kịch bản: trigger "Gồm Dora" chạy trên N shop Dora (≈0,5–1s mỗi lần gọi dora-1, cộng 1 upsert Mongo cho mỗi đơn). Quá 60s thì admin ngắt kết nối và gin huỷ ctx → upsert / `FetchOrderConversations` / `UpdateMany` sau đó lỗi `context canceled` → `Run` trả lỗi. Kết quả: các shop phía sau không được xử lý ở lượt này. Các đơn của chunk đang dở đã ghi `checking` nhưng có thể chưa được nhờ đọc lại → nằm 15 phút rồi thành `conversation_unknown`. Audit trigger ghi thất bại; trên dora-1, người dùng thấy 502 `mera_unavailable` dù một phần đơn đã vào hàng đợi. Không gửi trùng (lần chạy sau tự lành), nhưng trigger Dora có thể thất bại kéo dài.
- Sửa gợi ý: chạy Run với `context.WithoutCancel` + timeout riêng, hoặc làm async (202 + `/internal/jobs/:id`, admin đã có poll). Có thể gọi `FetchOrderConversations` song song giữa các shop (giới hạn concurrency). Cần đo số shop Dora / số đơn 7 ngày thật trước khi chốt.

**B2 — Fetch theo lô bắn đồng thời nhiều chunk vào cùng 1 shop; extension xử lý từng message Ably song song và GET liên tục không giãn cách → nguy cơ Etsy 429; đơn lỗi bị bỏ im lặng**
- Repo/owner: **mera-fulfill-backend** (cách chia chunk) + **dora-extension** (nếu cần throttle).
- Bằng chứng: `review_request_service.go:557-565` publish mọi chunk 50 đơn của một shop liền nhau. `dora-extension/libs/ably.js:578-591` handler `async`, không xếp hàng → các chunk chạy song song. `content.js:862-866` GET `mission-control/orders/convos/{id}` tuần tự, không delay; đơn lỗi (429) → `getOrderConvoSafe` trả null → không POST. Memory dự án `orders-convo-fetch-on-demand` từng ghi nhận rủi ro 429 khi kéo theo lô.
- Kịch bản: shop có 150 đơn giao trong 7 ngày → 3 publish → khoảng 150 GET dồn trong vài chục giây → 429. Các đơn bị 429 không bao giờ có `fetched_at` mới → `conversation_unknown` → lượt chạy sau lại nhờ đọc lại toàn bộ. Có thể kẹt vòng lặp: shop lớn không bao giờ được gửi, Etsy session của shop bị rate-limit.
- Sửa gợi ý (Mera): mỗi shop chỉ có 1 lệnh fetch đang chờ. Chunk sau chỉ publish khi chunk trước đã có kết quả (hoặc đã timeout), hoặc mỗi lượt Run chỉ lấy ≤50 đơn/shop, phần còn lại để lượt sau. Extension: xếp hàng các `fetch-order-convo` và giãn ~300–500ms giữa các GET. Lưu ý: plan §4 đã chốt endpoint fetch theo lô, nên đây là giảm rủi ro chứ không phải đổi phạm vi.

**B3 — Sau 24h chưa xác nhận DONE thì Mera đánh `failed: unconfirmed` (cả `interrupted`) — trái nguyên tắc "lạc quan khi không có phản hồi"; người dùng thấy "Gửi lỗi" nên có thể gửi tay lần 2 cho cùng buyer**
- Repo/owner: **mera-fulfill-backend**.
- Bằng chứng: `review_request_worker.go:484-488` (unconfirmed → failed), `:455-459` (interrupted → failed); dora-1 order_messages có luồng "DONE muộn" (commit c7384fb); memory `extension-rollout-lag` (extension cũ có thể không báo status về dora-1).
- Kịch bản: extension gửi thành công nhưng status kẹt NEW/SENDING (bản cũ, hoặc DONE tới muộn sau khi doc đã failed — lúc đó `Finish` lọc `status: sending` nên DONE bị bỏ). Badge hiện "Gửi lỗi", `sent_at` null. Người dùng gửi tay lại → buyer nhận 2 tin. (Tự động thì được chặn nhờ bước kiểm hội thoại: thread đã tồn tại → `has_conversation`.) Phụ: với extension không báo status, mỗi shop chỉ gửi được 1 tin mỗi ~3 phút (`SendTimeout`).
- Sửa gợi ý: trước khi đánh `unconfirmed`/`interrupted`, kiểm `order_conversations` / resolver của receipt. Có thread mới sau `sending_at` ⇒ coi là `sent` (ghi chú "xác nhận qua hội thoại"). Nếu không, dùng trạng thái riêng ("chưa xác nhận", badge vàng) thay vì "Gửi lỗi".

**B4 — dora-1 làm rơi các số đếm skip mà Mera trả (`send_blocked_env`, `shop_offline`, `conversation_unknown`) và `run.checking` → dialog báo "thành công 0 đơn" mà không nói lý do**
- Repo/owner: **dora-1** (backend-engineer: type D + sanitizer; frontend-engineer: dialog).
- Bằng chứng: Mera `ReviewSkipCounts` 6 key (`review_request_service.go:240-247`). dora-1 `lib/types/delivery.ts:469` `ReviewRequestSkippedCounts` 3 key; `review-request-proxy.ts:81-88,161,177` chỉ giữ 3 key; `RequestReviewsDialog.tsx:277,328` chỉ render 3 key; `:288` toast success bất kể `queued`. Mera FE giữ mọi key (`reviewRequestApi.ts skipCounts`) nên không bị lỗi này.
- Kịch bản 1 (prod): preview báo 10 đơn → bấm "Xác nhận gửi" → extension shop offline → Mera trả `{queued:0, skipped:{shop_offline:10}}` → dora-1 hiện toast xanh "Đã xếp hàng 0 đơn", không nói lý do.
- Kịch bản 2 (dev/local, prefix `ZZTEST-`): preview "Sẽ gửi 0", ba ô Bỏ qua đều 0, không giải thích được (thực ra `send_blocked_env: N`).
- Sửa gợi ý: thêm 3 key (optional, vắng = 0) vào type + sanitizer; render các key > 0 kèm nhãn (`SKIP_REASON_LABEL` thêm `send_blocked_env` "Shop không được phép gửi ở môi trường này"). Toast run: `queued === 0` ⇒ warning kèm danh sách skip; giống send (`:243-244`).

**B5 — Validate biến mẫu tin của Mera quá hẹp: lỗi gõ sai dạng "gần đúng" lọt qua và tới tay buyer nguyên văn**
- Repo/owner: **mera-fulfill-backend** (cả 2 FE có thể thêm cảnh báo).
- Bằng chứng: `review_request_template.go:38` `\{[A-Za-z_]+\}` + `:61-75`. Bắt được `{Name}`/`{BUYER_NAME}`, nhưng **không** bắt `{ buyer_name }`, `{buyer name}`, `{shop-name}`, `{order_id }`, `{buyer_name1}`. `{{buyer_name}}` hợp lệ và render ra `{Emma}`. dora-1 `ReviewRequestSettingsDialog.tsx` / Mera FE `ReviewRequestSettingsDialog.tsx` không kiểm phía client; ô gửi tay cũng không.
- Kịch bản: người dùng gõ "Hi { buyer_name }," → PUT 200 → toàn bộ tin tự động gửi "Hi { buyer_name }," cho khách thật. Khung xem trước có hiện nguyên văn, nhưng dễ bị bỏ sót.
- Sửa gợi ý: coi mọi nhóm `\{[^{}\n]{0,40}\}` khác 3 biến chuẩn là lỗi; báo lỗi với `{{`/`}}`. FE: tô đỏ token lạ trong khung xem trước.

**B6 — Bước kiểm hội thoại chỉ dựa vào `conversation_id`; nếu parse id thất bại thì đơn đã có thread bị coi là "chưa có hội thoại" và bị gửi tự động**
- Repo/owner: **mera-fulfill-backend** (rẻ, phòng thủ); tham chiếu dora-1 parser.
- Bằng chứng: `review_request_dora.go:136-153` chỉ projection `conversation_id`. dora-1 `order-conversation-sync.ts:40-43` trả `conversation_id: null` khi không đọc được id, nhưng vẫn ghi `message_count` (:254,259).
- Kịch bản: Etsy đổi tên key id trong payload mission-control → `conversation_id` null nhưng `message_count > 0` → Mera xếp hàng gửi tự động cho đơn đã có hội thoại, vi phạm R3.
- Sửa gợi ý: projection thêm `message_count`; `conversation_id > 0 || message_count > 0` ⇒ `has_conversation`.

### Ghi chú

- **N1 — `send.skipped[]` với `reason: not_found` không có nhãn.** Mera chỉ trả `tracking_id` cho lý do này (`review_request_service.go:735`). dora-1 sanitizer bỏ `tracking_id` (`review-request-proxy.ts:112-116`) nên toast hiện "—: Không tìm thấy mã" (`RequestReviewsDialog.tsx:256`); Mera FE cũng hiện "—". Gợi ý (dora-1 + Mera FE): giữ `tracking_id` và map sang `code` từ các dòng đang chọn. Mera FE thiếu nhãn cho `send_blocked_env`/`not_found`/`no_orders`/`no_receipt`/`sending` (`lib/reviewRequest.ts SKIP_REASON_LABELS`) nên hiện nguyên key.
- **N2 — Cảnh báo trước khi gửi tay lệch với Mera.** Mera cảnh báo `already_requested` khi `sent_at != null` kể cả khi status đang `failed` (`service.go:685`). Cả 2 FE (`dora-1 lib/delivery/reviewRequest.ts isRequested`, Mera FE `orderReviewWarnings`) chỉ xét status, nên bỏ sót đơn "đã gửi trước, lần sau lỗi". dora-1 còn cảnh báo `sending`, trong khi Mera sẽ bỏ qua đơn đó với lý do `sending`. Gợi ý: thêm `sent_at != null`; với `sending` thì báo "đang gửi — sẽ bị bỏ qua". Badge `failed` + `sent_at` cũng nên ghi "đã gửi dd/MM trước đó".
- **N3 — Đang lọc `dora:<store>` mà chạy tự động/cài đặt thì áp cho CẢ Dora.** Cả 2 FE map về `"dora"` và đều có dòng ghi chú (dora-1 `DoraScopeNote`, Mera FE `doraShopNote`). Mera BE đã hỗ trợ scope `dora:<store>` cho preview/run/summary, nên có thể truyền thẳng để chỉ chạy shop đang xem; settings vẫn dùng `dora`. Đây là lựa chọn UX, cần chủ sản phẩm quyết.
- **N4 — Run ghi đè doc cũ.** Khi Run gặp đơn có hội thoại, nó ghi đè doc `failed` chưa từng gửi (kể cả doc gửi tay) thành `skipped/has_conversation, mode auto` (`service.go:535-543`) → badge "Gửi lỗi" của lần gửi tay bị thay bằng "Bỏ qua". Lịch sử vẫn còn ở `attempts[]`. Chấp nhận được; chỉ nên biết.
- **N5 — Audit trigger không có số liệu.** Executor coi 200 là success nhưng không đọc body (`trigger_executor.go:287-299`) → audit không thấy `queued/skipped`. Gợi ý (admin): với `request_reviews`, parse `{queued, skipped}` vào `ExecutionResult.Message`.
- **N6 — Ably chưa cấu hình cũng trả 409 `shop_offline`.** `publishFetchOrderConvo` trả null khi `getRest()` null (`ably-publish.ts:231-232`) → route máy trả 409 `shop_offline` → Mera ghi `skipped/shop_offline` (lý do sai). Chỉ ảnh hưởng môi trường thiếu `ABLY_API_KEY`. Có thể trả 503 riêng.
- **N7 — Thứ tự deploy: dora-1 phải lên trước Mera fulfill.** Nếu route máy chưa có, dora-1 trả 307/404 → Mera ghi mọi ứng viên `conversation_unknown` (tự lành ở lượt sau). Extension không cần bản mới (handler `fetch-order-convo` đã có), nhưng shop còn chạy extension quá cũ (không có handler) sẽ luôn rơi vào `conversation_unknown` → không bao giờ được gửi tự động. Thất bại theo hướng an toàn.
- **N8 — Đơn `sending` kẹt tới 24h thì không gửi tay được.** Khi `SendTimeout` hết, doc giữ `sending` tới khi sweep chốt (≤24h); trong thời gian đó gửi tay bị bỏ qua với lý do `sending`. Hành vi đúng thiết kế (không gửi lại), chỉ ghi nhận.
- **N9 — Local/dev: tin xếp hàng không bao giờ được gửi.** Với `REVIEW_REQUESTS_WORKER=off`, doc `checking`/`queued` nằm im (plan §10 đã ghi). dora-1 summary poll 10s/lần suốt lúc dialog mở vì `queued > 0` (vô hại).
- **N10 — `go vet ./internal/...` của fulfill fail sẵn** do `dora_api_service.go:76` (không thuộc thay đổi này). Nên sửa riêng để CI vet xanh.

### Cần xác nhận (chưa tái hiện được)

- **C1 — Etsy trả gì cho đơn chưa có hội thoại?** Đây đúng là tập đơn mà auto-run nhắm tới. `getOrderConvo` (`dora-extension/libs/etsy-message.js:198-215`) throw khi `!response.ok`.
  - Nếu Etsy trả **200 + object** (có `convo_id` null): dora-1 ghi `conversation_id: null` → Mera chuyển `queued` → đúng.
  - Nếu Etsy trả **404/4xx**: không có doc nào được ghi → mọi đơn chưa có hội thoại thành `conversation_unknown` → auto-run không bao giờ gửi được.

  Không kiểm được: DB trong `.env.local` có 0 doc `order_conversations`. Cách xác nhận (read-only) trên dora-master prod: `db.order_conversations.countDocuments({conversation_id: null})` > 0 thì luồng ổn. Hoặc mở panel "Nhắn khách" của một đơn chưa từng nhắn rồi xem doc được ghi.

## 4. Gợi ý thứ tự xử lý
1. C1 (xác nhận dữ liệu): nếu sai thì toàn bộ auto-run vô hiệu.
2. B4 (dora-1, nhỏ), B5, B6 (Mera, nhỏ).
3. B1, B2 (Mera, cần đo tải); B3 (Mera, thiết kế trạng thái).
4. Ghi chú N1–N10 tuỳ ưu tiên.

---

## Vòng 2 — 2026-10-21 (kiểm lại sau bản sửa B1–B6, N1, N4)

Phạm vi: diff chưa commit ở `mera-fulfill-backend` (plan §10 là hành vi chốt), `dora-1` (types D, `review-request-proxy.ts`, `lib/delivery/reviewRequest.ts`, 2 dialog), `mera-fulfill-frontend` (bỏ qua `OrderTable.tsx`/`OrdersPage.tsx`). `mera-admin-backend` không đổi. Không sửa code.

### V2.0 Kết luận
**Không có finding chặn merge.** B1–B6, N1, N4 và C1 đã đóng, không thấy hồi quy hợp đồng dây. Còn **1 finding nên sửa** (R2-1: kết luận "đã gửi" nhờ hội thoại sai với gửi tay) và 5 ghi chú nhỏ.

### V2.1 Kiểm chứng bằng thực thi
| Lệnh | Kết quả |
|---|---|
| dora-1 `npx tsc --noEmit` | sạch (exit 0) |
| fulfill `go build ./...` | sạch |
| fulfill `go vet ./internal/...` | exit 1, vẫn chỉ lỗi có từ trước `dora_api_service.go:76` (N10) |
| fulfill `go test ./internal/services -run "Review|Dora1Fetch"`, `./internal/controllers -run Review` | ok |
| fulfill `MERA_LOCAL_MONGO=1 go test ./internal/services -run ReviewRequests -v` (mongo localhost:27017, DB tạm tự drop) | 3/3 PASS: `_Local`, `FetchChunks_Local`, `DoraAdapter_Local` |
| admin `go build ./... && go vet ./...` | sạch |
| Mera FE `npx tsc -b` | sạch |
| Mera FE `vitest` reviewRequest + RequestReviewsDialog + ReviewRequestSettingsDialog + TriggerModal | 4 file, 59/59 pass |
| Đối chiếu validate mẫu tin: chạy cùng 19 chuỗi qua regex Go BE (`go run`) và hàm FE chép nguyên văn (`node`) | dora-1 khớp BE 19/19. Mera FE lệch 4/19, đều là ngoặc lẻ (R2-2) |

### V2.2 Trạng thái finding vòng 1
| # | Trạng thái | Bằng chứng |
|---|---|---|
| B1 | **Đóng** | `Run`: `context.WithoutCancel` + 5 phút (`review_request_service.go:558`), không gọi dora-1 (chỉ ghi `checking`). `Send` cũng tách context (:676). Trigger 200 nhanh. |
| B2 | **Đóng** (phía Mera) | `issueFetches` (`review_request_worker.go:497-570`): mỗi shop 1 lô đang chờ (đếm `checking` có `checking_requested_at`), ≤50 đơn, cũ nhất trước, cách lệnh trước ≥ gap + jitter. Test `FetchChunks_Local` pass. Extension không đổi: 50 GET tuần tự không giãn, 1 POST cuối (`content.js:860-874`). Rủi ro 429 còn lại ở mức 50 GET/lô, chấp nhận theo plan. |
| B3 | **Đóng**, nhưng có tác dụng phụ (R2-1) | Lỗi mạng/timeout → `failed+unconfirmed` (worker.go:222-225). Treo >24h hoặc crash không có message id → `settleUnknown` (:596). Doc unconfirmed được hỏi lại 30 phút/lần trong 7 ngày; DONE tới muộn được nhận (`reviewFinishable` :321). Tự động bị chặn (`reviewAutoBlocked` service.go:271, `reviewAutoFilter` :539). Badge vàng ở cả 2 FE. |
| B4 | **Đóng** | dora-1 `normalizeSkippedCounts` giữ mọi key số (`review-request-proxy.ts:85-93`). Type có đủ 7 key Go (`delivery.ts:479-489`). Dialog render mọi key > 0 (`RequestReviewsDialog.tsx:347`). `queued===0` → toast cảnh báo kèm lý do (:281-295). Nhãn đủ 7 key + 5 reason gửi tay. |
| B5 | **Đóng** | BE `reviewBraceRe` = `\{+[^{}\n]*\}+` hoặc ngoặc lẻ (`review_request_template.go:40`), áp cho cả settings lẫn `message` gửi tay (service.go:209, :679). Lỗi 400 trả `unknown_vars` luôn là mảng (controller.go:84-89). dora-1 chuyển tiếp nguyên body (`callMera`) → `reviewRequestErrorText` hiện token. Cả 2 FE chặn phía client (Mera FE còn hở ngoặc lẻ: R2-2). |
| B6 | **Đóng** | `HasThread = conversation_id>0 OR message_count>0` (service.go:88). Áp lúc chọn ứng viên (`review_request_dora.go:77-86`) và lúc quyết `checking` (worker.go:408-411). Projection có `message_count` (dora.go:149). |
| C1 | **Đóng** | Leader đã xác nhận trên prod. |
| N1 | **Đóng** | Mã bị ẩn → `not_found` kèm `tracking_code` (service.go:692-723). Cả 2 FE giữ `tracking_id` và map sang code từ các dòng đang chọn. Đủ nhãn. |
| N2 | **Đóng một phần** | Đã xét `sent_at`/`unconfirmed`. Còn lệch ở `sending` (R2-3). |
| N4 | **Đóng** | `manual_failed`: lượt chạy tự động bỏ qua doc gửi tay bị lỗi (`reviewManualFailed` service.go:287; filter :542). Test `_Local` :430-438. |
| N3, N5–N9 | Không đổi | N3 là quyết định UX. N5 thuộc admin, không đổi. N6/N7 thuộc hạ tầng dora-1. N8: doc giữ `sending` ≤24h rồi thành unconfirmed. N9 đúng thiết kế. |
| N10 | Còn | lỗi vet có từ trước, không thuộc diff |

### V2.3 So khớp chéo lại các seam có thay đổi
| Seam | Go (nguồn sự thật) | dora-1 type + sanitizer | Mera FE type + normalize |
|---|---|---|---|
| preview/run `skipped` | 7 key `ReviewSkipCounts` (service.go:250-259) | giữ mọi key số; 3 key gốc mặc định 0 ✓ | giữ mọi key số ✓ |
| run | `{queued, checking, skipped}` (:519-525), `checking==queued` | ✓ (:188-192) | ✓ |
| preview sample | 9 field, `has_conversation` *bool luôn có | ✓ đủ 9 | type thiếu `project_id`/`tracking_id`, FE không đọc → vô hại |
| send | warnings `{order_id, etsy_receipt_id, kind}`, skipped `{order_id, tracking_id, tracking_code, reason}` | bỏ `etsy_receipt_id` (không đọc) ✓; skipped đủ ✓ | ✓ |
| summary | `failed_recent[].unconfirmed` bool | chỉ giữ khi true ✓ | ✓ |
| badge `orders[].review_request` | `skip_reason`/`unconfirmed` omitempty (:915-924) | optional ✓; list proxy spread `...o` ✓ | optional ✓ |
| lỗi 400 `invalid_template`/`invalid_message` | `{error, code, unknown_vars: []}` | `DeliveryApiErrorBody.unknown_vars` ✓; chuyển tiếp nguyên ✓ | `apiUnknownVars(e.body)` ✓ (`attachResponse` gắn `body`) |
| gửi tay có biến | `RenderReviewTemplate(msg, …)` **theo từng đơn** (service.go:807); `message` được trim rồi mới validate và render | hook gửi `message.trim()`; route giữ nguyên chuỗi không rỗng ✓ | gửi chuỗi chưa trim; BE trim ✓ |
| độ dài | ≤2000 **rune** sau trim | `maxLength` 2000 đơn vị UTF-16, đếm cả khoảng trắng → chặt hơn BE (R2-6) | đếm `.length` UTF-16 → chặt hơn BE |
| máy fetch convo | `FetchOrderConversations` ≤50, `requestedAt` RawMessage | route không đổi từ vòng 1: `requestedAt` ISO lấy trước khi publish, 409 `shop_offline` ✓ | — |

**State machine của worker (đọc code + test local):** `checking` (chưa có `checking_requested_at`) → `issueFetches` gán `checking_requested_at` (đồng hồ dora-1) → `settleChecking`: có `fetched_at ≥ requested` thì đi tiếp (`queued`, hoặc `skipped/has_conversation`); quá 15 phút thì `skipped/conversation_unknown`; 409 thì mọi doc đang chờ của shop → `skipped/shop_offline` → `ClaimNext` (FindOneAndUpdate nguyên tử) → `sending` → DONE ⇒ `sent`, FAILED/CANCELLED ⇒ `failed`; lỗi mạng ⇒ `failed+unconfirmed`; offline ⇒ `queued` +30 phút, quá 24h ⇒ `failed`. Hết SendTimeout thì giữ `sending`, sweep 2 phút/lần; quá 24h ⇒ `settleUnknown`. Lease: upsert, trùng key thì nhường. Các thao tác ghi khi chốt dùng `WithoutCancel`. Không thấy đường nào gửi trùng 1 doc.

### V2.4 Finding còn lại (xếp theo mức độ)

**R2-1 — Nên sửa · Mera fulfill BE · "Có hội thoại ⇒ đã gửi" sai với gửi tay: mọi lần gửi tay chưa rõ kết quả đều thành `sent`**
- Bằng chứng: `review_request_worker.go:574-592` (`reviewThreadExists` chỉ hỏi "có thread không", không hỏi "thread/tin có mới hơn `sending_at` không"). Hàm này được gọi từ `settleUnknown` :596-604 (crash, không có message id; hoặc >24h chưa DONE) và từ nhánh `d.Unconfirmed` :668-674. Gửi tay không lọc hội thoại, và R4 nhắm đúng đơn **đã có** hội thoại (`service.go:784-824`). Test local chỉ phủ `mode: auto` (`zz_review_requests_local_test.go:368,385-400`).
- Kịch bản: gửi tay cho đơn đã có thread → dora-1 timeout (lỗi mạng) → `failed+unconfirmed`. Lần sweep kế tiếp: `order_conversations.conversation_id > 0` (thread cũ) → `sent`, `confirmed_by: conversation`, gán `sent_at`. Badge "Đã xin review · dd/MM" dù tin có thể chưa đi. Người dùng không biết để gửi lại. Badge vàng "Chưa xác nhận" (B3) gần như không bao giờ xuất hiện với gửi tay. Sai theo hướng an toàn (không nhắn trùng) nên không chặn merge, nhưng số liệu `sent_today` và badge sai.
- Sửa gợi ý: chỉ dùng bằng chứng hội thoại khi `d.Mode == auto` (lúc `checking` đã xác nhận không có thread). Với gửi tay: chỉ coi là đã gửi khi `fetched_at > sending_at` **và** có tin mới sau `sending_at` (vd `message_count` tăng, hoặc thời điểm tin cuối > `sending_at`, nếu doc có lưu). Nếu không, giữ `unconfirmed`. Thêm 1 case test `mode: manual`.

**R2-2 — Ghi chú · Mera FE · validate client bỏ sót ngoặc lẻ**
- Bằng chứng: `mera-fulfill-frontend/src/lib/reviewRequest.ts` `invalidTemplateTokens` chỉ dùng `/\{+[^{}\n]*\}+/g`, trong khi BE bắt thêm `{` và `}` đứng lẻ (`review_request_template.go:40`). Đã chạy thử: "Hi {buyer_name", "thanks}", "{buyer\nname}", "a { b" → FE cho qua, BE trả 400.
- Ảnh hưởng: không có tin sai nào tới tay buyer. BE từ chối, FE hiện token từ `unknown_vars` (`serverVars`). Người dùng chỉ thấy lỗi sau khi bấm Lưu/Gửi thay vì thấy ngay. dora-1 khớp BE 19/19.
- Sửa: thêm nhánh ngoặc lẻ vào regex (hoặc chép cách làm của dora-1).

**R2-3 — Ghi chú · cả 2 FE · đơn `sending` bị cảnh báo "Đã xin review" nhưng BE bỏ qua với lý do `sending`** (phần còn lại của N2)
- Bằng chứng: dora-1 `lib/delivery/reviewRequest.ts` `isRequested` (status `sending` → already_requested); Mera FE `isAlreadyRequested`. BE: `reviewManualWarnings` (service.go:659-668) không có `sending`; filter upsert `status != sending` (:810) → skipped `sending`.
- Sửa: với `sending`, hiện "Đang gửi — sẽ bị bỏ qua" thay vì cảnh báo "đã xin". Sau khi gửi, toast "bỏ qua" đã ghi đúng lý do, nên đây chỉ là chênh lệch nhãn trước khi gửi.

**R2-4 — Ghi chú · Mera BE · `Maintain` có thể chạy lâu hơn lease**
- Bằng chứng: `issueFetches` gọi dora-1 tuần tự từng shop, mỗi lần tối đa 45s (`worker.go:473,512-568`), trong lúc đó không gia hạn lease. `leaseTTL = 4×tick + 1m` = 2m (:111).
- Kịch bản: dora-1 treo, ≥3 shop → một tick quá 2 phút. Nếu chạy >1 replica, replica khác chiếm lease và có thể gửi lại cùng lô fetch (`fetchNext` nằm trong bộ nhớ; kiểm in-flight rồi gán `checking_requested_at` không nguyên tử). Không gửi tin trùng (`ClaimNext` nguyên tử), chỉ nhân đôi lệnh đọc Etsy. Với 1 replica: chỉ làm chậm việc khởi động goroutine cho shop mới.
- Sửa: gia hạn lease giữa các shop, hoặc giới hạn tổng thời gian `issueFetches` mỗi tick, hoặc "claim" lô trước khi gọi (gán placeholder rồi mới gọi dora-1).

**R2-5 — Ghi chú · Mera BE · `settleChecking` lấy 500 doc không sắp xếp**
- Bằng chứng: `worker.go:426-427` (`SetLimit(500)`, không sort).
- Ảnh hưởng: khi >10 shop cùng có lô đang chờ (≤50 doc mỗi lô), các doc ngoài 500 doc đầu chỉ được xét sau khi doc trước được chốt hoặc hết 15 phút → kết quả trễ tới 15 phút, lô kế của shop đó cũng bị giữ lại. Đúng đắn vẫn giữ: kết quả fetch được ưu tiên hơn timeout (`reviewCheckDecision` :408).
- Sửa: sort `checking_requested_at` tăng dần, hoặc đọc theo trang.

**R2-6 — Ghi chú · 2 FE vs BE · đếm độ dài khác đơn vị**
- FE đếm UTF-16 (emoji = 2) và đếm cả khoảng trắng đầu/cuối; BE đếm rune sau trim. FE chỉ chặt hơn, không bao giờ cho qua thứ BE từ chối. Ghi nhận, không cần sửa.

### V2.5 Gợi ý thứ tự
1. R2-1 (Mera BE, nhỏ: thêm điều kiện `mode`/thời điểm + 1 test).
2. R2-2, R2-3 (FE, vài dòng).
3. R2-4, R2-5 khi chạy nhiều replica / nhiều shop Dora.

---

## Nhiều mẫu tin — 2026-10-22 (plan §11/§12, 4 repo, chưa commit)

Phạm vi: `mera-fulfill-backend` (nguồn chuẩn), `mera-admin-backend`, `mera-fulfill-frontend` (bỏ qua OrderTable/OrdersPage), dora-1. Đọc theo `git diff`. Không sửa code.

### N.1 Kiểm chứng bằng thực thi
| Lệnh | Kết quả |
|---|---|
| dora-1 `npx tsc --noEmit` (chạy 2 lần, lần cuối trên cây mới nhất có cả §13) | 0 lỗi |
| fulfill `go build ./...` | OK |
| fulfill `go vet` services/controllers/models | 1 cảnh báo có từ trước: `dora_api_service.go:76` (rawConvID). Không thuộc diff |
| fulfill `go test ./internal/services/ ./internal/controllers/ -run 'ReviewRequest/Template'` | ok |
| fulfill `MERA_LOCAL_MONGO=1` `ReviewRequestTemplates*_Local`, `ReviewRequests_Local` | PASS |
| fulfill overlay QA (`go test -overlay`, không ghi file vào repo): 8 replica cùng import 20 settings trùng tên × 5 vòng × 3 lần | docs = distinct `legacy_settings_id` = 20. Không nhân bản, không mất mẫu |
| admin `go build ./...`, `go vet ./...`, `go test` models + services | OK |
| Mera FE `npx tsc -b` | 0 lỗi |
| Mera FE `vitest` (reviewRequest, reviewRequestApi, RequestReviewsDialog, ReviewRequestSettingsDialog, ReviewTemplatesDialog, TriggerModal) | 6 file, 88 test pass |
| Parity: 21 tiêu đề + 27 nội dung, chạy qua hàm thật của Go (`validateReviewTemplateInput`) / dora-1 / Mera FE (esbuild bundle) | xem N.3 |

Script: `C:\Users\admin\AppData\Local\Temp\claude\d--Pamo-dora-1\85bb8946-7825-49da-a75c-e22e0561cf36\scratchpad\parity\multi\` (`cases.mjs`, `zz_qa_overlay_test.go` + `overlay.json`, `dora_entry.ts`, `mera_entry.ts`, `compare.mjs`).

### N.2 So khớp chéo theo seam (✓ = khớp)
| Seam | Go (nguồn chuẩn) | dora-1 proxy / type | dora-1 FE | Mera FE |
|---|---|---|---|---|
| T1 list | `{items:[{id,title,content,is_system,created_by,updated_by,updated_at}],variables}`; `items[0]=default` (`updated_at:null`, `created_by:"system"`) | `normalizeTemplate` đủ 7 key, bỏ item không có id ✓ | đọc id/title/content/is_system/updated_by/updated_at ✓ | `normalizeTemplateList` + tự thêm `default` nếu thiếu, đưa system lên đầu ✓ |
| T2 POST/PUT | 200 trả view ở gốc. 400 `invalid_body`/`invalid_title`/`duplicate_title` (gồm "Mẫu mặc định" mọi kiểu hoa thường)/`invalid_template`+`unknown_vars`; PUT 403 `system_template`, 404 `template_not_found` (id không phải hex cũng vậy) | `callMera` giữ nguyên status + body ✓; thiếu id → 502 ✓ | nhãn VN cho 6 code ✓; `template_not_found` khi sửa → giữ bản nháp thành mẫu mới ✓ | nhãn cho 5 code, `invalid_template` dùng message BE (tiếng Việt) ✓; lỗi tiêu đề hiện ngay dưới ô ✓ |
| T3 DELETE | `{ok:true}` · 403 · 404 | luôn `{ok:true}` ✓ | ✓ | ✓ |
| T4 preview | `template_id` tuỳ chọn ("" → default); trả thêm `template_id` | "" → bỏ field ✓; `template_id` vắng → "" ✓ | queryKey có `templateId` ✓ | key có `templateId` ✓ |
| T5 run | `template_id` bắt buộc (400 `template_required`), 404 `template_not_found`; thứ tự body → project → required → 503 → not_found | route tự chặn với cùng code ✓ | luôn gửi id (mặc định `default`) ✓ | luôn gửi; chặn khi mẫu đã xoá ✓ |
| T6 send | message (trim) > template_id > default; `edited` khi message ≠ nội dung mẫu (so sau TrimSpace); mẫu đã xoá không chặn khi có message | bỏ field rỗng, gửi cả hai ✓ | `buildManualSendPlan`: luôn `template_id` + `message` đã trim nếu có ✓ | `buildManualSendRequest` ✓ |
| T7 settings | chỉ `max_days`; `template` client cũ gửi bị bỏ qua; response giữ `template`=`default_template`=nội dung default | `template?` chỉ chuyển tiếp nếu client gửi (FE mới không gửi) ✓ | PUT `{project_id,max_days}` (`ReviewRequestSettingsDialog.tsx:96`) ✓ | PUT `{project_id,max_days}` (`ReviewRequestSettingsDialog.tsx:79`) ✓ |
| T8 trigger | internal: body rỗng / `{}` / id trắng → 400 `template_required`; JSON hỏng → `invalid_body`; mẫu đã xoá → 404 (controller test :159-178) | — | — | TriggerModal bắt buộc chọn; trigger cũ chọn sẵn `default` (:131); mẫu đã xoá → "(đã xoá)" + chặn lưu ✓. Admin: lưu bắt buộc `template_id` (trim, ≤64); executor gửi `{template_id}` JSON cho cả project lẫn `dora`; trigger cũ → `"default"` ✓ |

### N.3 Parity validate (cùng input chạy qua cả 3 bên)
- **Biến B5:** 27/27 nội dung khớp nhau ở kết luận nhận/từ chối giữa Go, dora-1 và Mera FE (lỗi ngoặc lẻ R2-2 đã được sửa). Chỉ khác cách liệt kê token: với `{{buyer_name}` dora-1 hiện `{`, Go trả `{{buyer_name}`. Không ảnh hưởng.
- **Tiêu đề:** Mera FE khớp Go 21/21. dora-1 lệch 3 case (MT-4).
- **Độ dài nội dung:** Go đếm rune sau khi trim. Mera FE đếm rune chưa trim. dora-1 dùng `maxLength` của textarea, tính theo đơn vị UTF-16. Hai FE chỉ chặt hơn Go, không cho qua thứ Go từ chối (MT-8).

### N.4 Findings

**MT-1 — Chặn merge (điều kiện triển khai) · dora-1 + Mera FE vs Mera BE cũ · mẫu cũ của project bị xoá vĩnh viễn**
- Bằng chứng: Mera BE ở HEAD là `review_request_controller.go:117-121` (`Template string json:"template"`) và `review_request_service.go:208-221` (`$set template: ""` khi vắng). Hai FE mới chỉ gửi `{project_id,max_days}` (dora-1 `components/delivery/ReviewRequestSettingsDialog.tsx:96`; Mera FE `src/pages/tracking/ReviewRequestSettingsDialog.tsx:79`).
- Kịch bản: FE mới lên trước Mera BE §11, người dùng lưu số ngày → BE cũ ghi `template:""`. Khi BE §11 lên, bước nhập (`importLegacyTemplates`, chỉ lấy template khác rỗng) không còn gì để nhập. Mẫu riêng của project mất hẳn. Chỉ xảy ra nếu HEAD hiện tại của Mera đã chạy production và có project đã cài mẫu riêng.
- Sửa (chọn 1): (a) chốt thứ tự deploy ở N.5. (b) Rẻ hơn: hai FE gửi kèm `template: settings.template` khi GET có trả field này. Mera mới bỏ qua; Mera cũ ghi lại đúng mẫu đang có. dora-1 route đã sẵn chuyển tiếp (`settings/route.ts:56`), `normalizeSettings` giữ `template` khi là chuỗi. (c) Backup `review_request_settings` trước khi deploy.

**MT-2 — Nên sửa (cần xác nhận dữ liệu prod) · admin · trigger cũ đổi nội dung tin mà không báo**
- Bằng chứng: `mera-admin-backend/internal/services/trigger_executor.go:165-174` và `internal/models/trigger.go:101-103`. Comment ghi "đúng hành vi trước đây", nhưng trước §11, trigger chạy theo `review_request_settings.template` của từng project (HEAD `loadSettings`). Từ giờ trigger cũ luôn gửi mẫu hệ thống.
- Ảnh hưởng: project có mẫu riêng + trigger `request_reviews` cũ: tin tự động gửi buyer đổi sang mẫu mặc định mà không ai biết.
- Sửa: kiểm prod trước (đếm settings có `template` ≠ "" và trigger `request_reviews` chưa có `template_id`). Nếu có cả hai: sau khi chạy bước nhập, cập nhật `template_id` của trigger thành mẫu "Mẫu cũ — <project>" (trigger 1 project), hoặc tắt trigger và báo admin chọn mẫu.

**MT-3 — Nên sửa · dora-1 FE · mẫu đang chọn bị xoá thì lặng lẽ rơi về "Mẫu mặc định"**
- Bằng chứng: `lib/delivery/reviewRequest.ts:326` (`pickReviewTemplate` → default). Dùng ở `components/delivery/RequestReviewsDialog.tsx:142-143` (gửi tay) và `:395-403` (chạy tự động: `run` gửi `effectiveTemplateId`). Mera FE thì hiện "(đã xoá) …" và chặn chạy (`ReviewTemplateSelect.tsx:29,48,53`; `RequestReviewsDialog.tsx` `templateMissing`). Lỗi 404 của run/preview cũng không làm dora-1 tải lại thư viện (`useRunReviewRequests` chỉ có `onSuccess`, `lib/hooks/useDelivery.ts:295`), trong khi Mera FE có tải lại (`onTemplateError`).
- Kịch bản: người dùng chọn mẫu X, tab khác xoá X, refetch khi focus → select đổi sang default không cảnh báo, "Xác nhận gửi" gửi mẫu mặc định cho cả project. Spec §11 yêu cầu UI 2 bên giống nhau.
- Sửa: giữ `templateId` đã chọn. Khi không còn trong `items`: hiện option "(đã xoá)", báo lỗi, khoá nút chạy (với gửi tay: khoá khi ô soạn trống). Thêm `onError` → `invalidateQueries(RR_TEMPLATES_KEY)` khi `template_not_found`.

**MT-4 — Nên sửa · dora-1 FE · kiểm tiêu đề không theo luật Go**
- Bằng chứng: `lib/delivery/reviewRequest.ts:348-354` (chỉ `trim()`, `.length` UTF-16, so trùng không gộp khoảng trắng); `components/delivery/ReviewRequestTemplatesDialog.tsx:256` (`maxLength` 100 UTF-16).
- Kết quả parity: `"😀"×100` thì Go OK, dora-1 chặn. `"a"+150 dấu cách+"b"` thì Go OK ("a b"), dora-1 chặn và ô nhập cũng không cho gõ. `"  mẫu   mặc\tđịnh "` thì Go trả `duplicate_title`, dora-1 cho qua (server vẫn chặn, nhãn hiện đúng).
- Sửa: chép `normalizeReviewTemplateTitle` (`/\s+/g→' '` + trim) và đếm `[...t].length` như Mera FE `src/lib/reviewRequest.ts`. So trùng trên bản đã chuẩn hoá. Bỏ `maxLength` (hoặc nới) và để bộ đếm báo lỗi.

**MT-5 — Nên sửa · Mera FE · danh sách trigger hiện "chưa chọn" (đỏ) cho trigger cũ, trong khi admin chạy bằng `default`**
- Bằng chứng: `src/pages/triggers/TriggersPage.tsx:224-225` + `src/lib/reviewRequest.ts:433`, đối chiếu admin `trigger_executor.go:170-172` và TriggerModal `:131` (chọn sẵn default).
- Sửa: id vắng thì hiện "Mẫu mặc định (trigger cũ — mở để lưu)". Đi cùng MT-2.

**MT-6 — Ghi chú · Go + 2 FE · tiêu đề không chuẩn hoá Unicode (NFC)**
- Parity: `"Mẫu mặc định".normalize("NFD")` thì cả 3 bên đều cho qua. Unikey chế độ "Unicode tổ hợp" sinh dạng này, nên có thể tạo tiêu đề nhìn y hệt mẫu hệ thống hoặc mẫu khác. Chỗ sửa: `review_request_library.go:79-81` (`NormalizeReviewTemplateTitle`), thêm `norm.NFC` trước `title_lower`/`EqualFold`. FE thêm `.normalize('NFC')`.

**MT-7 — Ghi chú · fulfill BE · chi tiết bước nhập**
- Đuôi tiêu đề khi id ≤6 ký tự (`dora`) là `(dora)`, không có `#` như spec (`review_request_library.go:363-366`).
- Khi nhiều replica chạy cùng lúc, log "not imported: title taken" (:386) in ra cả khi replica khác đã nhập xong doc đó. Chỉ là log nhiễu: test race không mất mẫu nào.
- Tên project tra bằng `Authorization` của request đầu tiên. Internal key của dora-1 vẫn được admin chấp nhận (cùng đường `AllowedProjectsForRequest`). Nếu tra lỗi, tiêu đề dùng id hex và giữ luôn như vậy (đổi tên tay được).
- Mẫu cũ có biến sai (B5) bị bỏ qua, chỉ ghi log. Doc settings không bị sửa. Đều đúng §12.

**MT-8 — Ghi chú · 2 FE · đếm độ dài nội dung khác Go** (giống R2-6)
- Mera FE `src/lib/reviewRequest.ts:319` đếm cả khoảng trắng đầu/cuối: nội dung 2000 ký tự kèm dấu cách bao quanh thì Go OK, FE chặn. dora-1 `maxLength` theo UTF-16: nội dung có emoji (2000 rune = 4000 đơn vị) không nhập đủ được. FE chỉ chặt hơn.

**MT-9 — Ghi chú · nhỏ**
- (a) Cả 2 FE bỏ `template_id` trong response `run` (dora-1 `ReviewRequestRunResult`, Mera FE `reviewRequestApi.ts:173`). Hiện không ai dùng.
- (b) Cờ `edited` có thể bật sai khi nội dung mẫu chứa `\r\n` (tạo qua API): textarea đổi thành `\n` nên `message ≠ content`.
- (c) Mera FE: preview trả 404 `template_not_found` không tải lại thư viện, chỉ send/run tải lại.
- (d) dora-1 `ReviewRequestTemplatesDialog.tsx:70`: mẫu đang sửa bị xoá ở nơi khác thì `current` rơi về default (chỉ đọc), nhưng bản nháp vẫn hiện trong khung chỉ đọc.

### N.5 Thứ tự deploy an toàn
1. **mera-admin-backend.** Fulfill cũ bỏ qua body `{template_id}`, trigger vẫn chạy như cũ. Rủi ro trong lúc chờ: Mera FE cũ không lưu được trigger `request_reviews` (admin trả 400 "template_id là bắt buộc"). Đừng sửa trigger cho tới bước 2.
2. **mera-fulfill-backend + mera-fulfill-frontend cùng một đợt** (BE trước FE vài phút nếu không lên đồng thời được). Trước đó backup `review_request_settings` và làm bước kiểm prod của MT-2. Nếu FE lên trước BE: MT-1 (mất mẫu) và route `/templates` trả 404.
   - Nếu fulfill BE lên trước admin: mọi trigger `request_reviews` lỗi 400 `template_required` cho tới khi admin lên.
3. **dora-1** ngay sau bước 2. Trong khoảng chờ, dora-1 cũ:
   - chạy tự động bị 400 `template_required`;
   - sửa mẫu ở "Cài đặt" bị Mera bỏ qua, nhưng vẫn báo "Đã lưu";
   - gửi tay để trống dùng `default` thay vì mẫu project.

   Nếu dora-1 lên trước Mera BE: MT-1 (mất mẫu khi lưu số ngày), thư viện trả 502 `mera_bad_response`, và run gửi `template_id: default` nhưng Mera cũ bỏ qua field này nên thực tế gửi theo mẫu project, trong khi UI hiện "Mẫu mặc định".
4. Sau bước 2: mở "Mẫu tin Request reviews" một lần để chạy bước nhập, rồi kiểm các mẫu "Mẫu cũ — …" và `delivery_tracking_meta._id = review_request_templates_migrated` (`imported`).

Nếu làm fix MT-1(b) ở cả 2 FE thì thứ tự FE/BE không còn gây mất dữ liệu, chỉ còn các lỗi tạm thời ở trên.

## §13/§14 + MT fixes — 2026-10-22 (vòng cuối trước commit, 4 repo, chưa commit)

Phạm vi: plan §13/§13.1 (bỏ đơn khi gửi tay), §14/§14.1 (preview đủ danh sách + lọc "Xin review" / `date_field=requested`), và các bản sửa MT-1/3/4/5/6/7/9 của mục "Nhiều mẫu tin". Go = nguồn chuẩn. Đọc theo `git diff`, bỏ qua `OrderTable.tsx`/`OrdersPage.tsx`. Không sửa code.

**Kết luận: không có lỗi code chặn merge.** Có 1 điều kiện deploy bắt buộc (X-1). Ngoài ra có 2 mục nên sửa (X-2, X-3) và vài ghi chú.

### X.1 Kiểm chứng bằng thực thi
| Lệnh | Kết quả |
|---|---|
| dora-1 `npx tsc --noEmit` | 0 lỗi |
| fulfill `go build ./...` | OK |
| fulfill `go vet` services/controllers/models | chỉ còn cảnh báo cũ `dora_api_service.go:76` (rawConvID), không thuộc diff |
| fulfill `go test ./internal/services/ ./internal/controllers/ -run 'ReviewRequest\|Template\|Delivery'` | ok / ok |
| fulfill `MERA_LOCAL_MONGO=1 go test ./internal/services/ -run _Local` (gồm `DeliveryReviewRequestFilter_Local`, `ReviewRequestPreviewAllCandidates_Local`, `ReviewRequestTemplates*_Local`, `ReviewRequests_Local`) | ok (62s) |
| admin `go build ./...`, `go vet ./...`, `go test` models + services | OK, vet sạch |
| Mera FE `npx tsc -b` | 0 lỗi |
| Mera FE `vitest` (reviewRequest, deliveryTracking, reviewRequestApi, RequestReviewsDialog, ReviewRequestSettingsDialog, ReviewTemplatesDialog, TriggerModal) | 7 file, 137 test pass |
| Parity mới (`scratchpad\parity\s1314\`): 44 tiêu đề (21 cũ + 23 ca khoảng trắng Unicode / NFD / hoa thường), 27 nội dung, 8 cặp so `edited`, 8 kịch bản §13, 10 URL §14. Go chạy qua `go test -overlay` (không ghi file vào repo), 2 FE bundle bằng esbuild | xem X.3 |

Script: `C:\Users\admin\AppData\Local\Temp\claude\d--Pamo-dora-1\85bb8946-7825-49da-a75c-e22e0561cf36\scratchpad\parity\s1314\` (`cases.mjs`, `scen.json`, `zz_qa1314_overlay_test.go` + `overlay.json`, `dora_entry.ts`, `mera_entry.ts`, `compare.mjs`).

### X.2 So khớp chéo theo seam (✓ = khớp)
| Seam | Go (nguồn chuẩn) | dora-1 proxy / type | dora-1 FE | Mera FE |
|---|---|---|---|---|
| §13 body send | `exclude_order_ids` []string, phần tử trắng / sai kiểu / >5000 → 400 `invalid_body` (`review_request_controller.go:224-233`) | route kiểm mảng chuỗi, trim, bỏ rỗng + trùng, `[]` → bỏ field (`send/route.ts:39-58`). Không giới hạn 5000, Mera chặn ✓ | `buildManualSendPlan` (`lib/delivery/reviewRequest.ts:419-443`) | `buildManualSendRequest` (`src/lib/reviewRequest.ts`) + `reviewRequestApi.send` chuyển tiếp field ✓ |
| §13 khớp đơn | so `refs[].order_id` của ref đang hoạt động trong scope, sau trim, phân biệt hoa thường; id lạ bỏ qua im lặng; 50 mã/shop đếm trên `ids` cả mã có đơn bị loại (`review_request_service.go:764-800`) | — | khoá theo `orders[].order_id`. List view trả nguyên `r.OrderID` (`delivery_tracking_query.go:189`), cùng chuỗi Go so ✓ | như dora-1 ✓ |
| §13 dựng request | mã mà mọi đơn bị loại: FE phải bỏ khỏi `ids` | — | 8/8 kịch bản giống Mera FE: bỏ mã loại hết đơn, loại 1 phần → `exclude_order_ids`, mã trang khác / mã không đơn giữ nguyên, phân biệt hoa thường, đơn chung 2 mã ✓ | ✓. Khác dora-1 duy nhất ở cách khoá nút (X-4) |
| §13 kết quả | `skipped[]` reason `excluded`, mỗi cặp (mã, đơn) 1 lần, không ghi ledger | reason pass-through ✓ | toast lọc `excluded` ra, chỉ ghi "Đã bỏ N đơn khỏi danh sách" (`RequestReviewsDialog.tsx:341-357`) ✓ | `splitExcludedSkipped` ở toast + `SendResultView` ✓ |
| §14a preview | `sample` = mọi ứng viên theo `delivered_at` giảm dần, tối đa 5000, `sample_truncated` (`review_request_service.go:513-533`) | sanitizer `=== true` (`review-request-proxy.ts:215`) ✓ | `CandidateList` ảo hoá, "(hiện 5000 / N đơn)" + ghi chú ✓ | bảng cuộn, "Hiện 5000 / N đơn" ✓ (không ảo hoá, X-6) |
| §14b param | `review_request` ∈ sent/none/pending/failed, ""/`all` = không lọc, lạ (kể cả `SENT`) → 400 `invalid_review_request`; `date_field` thêm `requested` (`delivery_tracking_controller.go:189-200`) | `LIST_QUERY_KEYS` có `review_request`, `date_field` chuyển tiếp nguyên ✓ | parse URL: lạ → '' / `paid`; chỉ gửi `date_field` khi có from/to ✓ | giống hệt dora-1: 10/10 URL cùng URL + cùng query API (1 URL chỉ khác thứ tự param) ✓ |
| §14b ngữ nghĩa | `requested` không kèm `review_request` ⇒ ngầm `sent`; `none` + khoảng ngày ⇒ luôn rỗng; `requested` không kèm from/to ⇒ FE không gửi ⇒ không lọc | — | tooltip select ngày báo "chưa chọn Xin review = chỉ mã đã xin review" ✓ | — (X-7) |
| §14b counts / export | lọc nằm trong `base` ⇒ `counts` + `total` áp dụng, `stores`/`providers` không | — | queryKey `["delivery","list",p]` có `reviewRequest` ✓; export dùng `trackingListParams` ✓ | deps effect list có `filters.reviewRequest`; export (`TrackingPage.tsx:263`) truyền `reviewRequest` ✓ |

### X.3 Parity
- **Tiêu đề (MT-4/MT-6):** 3 bên giống nhau ở các ca thường gặp: NFD "Mẫu mặc định", gộp tab/xuống dòng/NBSP/U+3000, đếm code point, 😀×100. Còn lệch ở vài ký tự hiếm (ghi chú X-8): Go `unicode.IsSpace` coi U+0085 là khoảng trắng còn U+FEFF thì không, JS `\s` thì ngược lại. Lowercase của `İ` cũng khác (Go `i`, JS `i̇`). FE gửi tiêu đề đã chuẩn hoá và server quyết cuối, nên lệch chỉ làm câu báo lỗi đến từ server thay vì từ client. Không có ca nào FE cho qua mà Go lưu thành tiêu đề trùng.
- **`edited` (MT-9b):** `\r\n` / `\r` / dấu cách đầu cuối không còn bật `edited`. NFD và NFC vẫn bị coi là khác (nội dung không chuẩn hoá NFC). Chấp nhận được.
- **§13:** 8 kịch bản cho cùng `ids` / `exclude_order_ids` / N / M ở cả 2 FE, và khớp `zz_review_request_templates_local_test.go:316-345` của Go.
- **§14 URL:** khớp (bảng trên).

### X.4 Trạng thái các MT của vòng trước
| MT | Trạng thái | Bằng chứng |
|---|---|---|
| MT-1 | **Đã đóng**, có tác dụng phụ (X-3) | dora-1 `ReviewRequestSettingsDialog.tsx:98-101`, Mera FE `ReviewRequestSettingsDialog.tsx:81-84` gửi lại `template` khi GET có field này. BE mới bỏ qua (controller không còn field `Template`). BE cũ ghi lại đúng chuỗi đã đọc |
| MT-2 | Còn mở (không thuộc danh sách sửa), cần kiểm dữ liệu prod | admin `trigger_executor.go` không đổi |
| MT-3 | **Đã đóng** | `pickReviewTemplate` không còn rơi về default (`lib/delivery/reviewRequest.ts:325-330`). Có option "(đã xoá)" (`ReviewRequestModal.tsx:165`). Tự động: ẩn preview, khoá chạy (`RequestReviewsDialog.tsx:406-438`). Gửi tay: chỉ gửi được khi ô soạn có nội dung (`:196`). Hook `useRefetchTemplatesOnNotFound` gắn cho preview, run và send |
| MT-4 | **Đã đóng** | `normalizeReviewTemplateTitle` NFC → `\s+` → trim, đếm code point, bỏ `maxLength`, POST/PUT gửi bản đã chuẩn hoá (`ReviewRequestTemplatesDialog.tsx:132`). Parity khớp Go (trừ X-8) |
| MT-5 | **Đã đóng** | `reviewTemplateLabel` trả "Mẫu mặc định (trigger cũ)" khi id vắng (`TriggersPage.tsx:225`) |
| MT-6 | **Đã đóng** | Go `NormalizeReviewTemplateTitle` = `norm.NFC` + `FieldsFunc(unicode.IsSpace)` (`review_request_library.go:83-85`), `go.mod` bỏ `// indirect`. Cả 2 FE `.normalize('NFC')`. Tiêu đề bước nhập cũng qua chuẩn hoá (`:288`) |
| MT-7 | **Đã đóng** | đuôi `#dora` (`review_request_library.go:373-377`). Log "title taken" chỉ in khi không có doc nào mang `legacy_settings_id` đó (`:399-401`) |
| MT-8 | Còn mở (ghi chú, cố ý) | dora-1 textarea `maxLength` UTF-16. FE chỉ chặt hơn Go |
| MT-9a | Còn mở (ghi chú) | cả 2 FE vẫn bỏ `template_id` trong response `run` (dora-1 `ReviewRequestRunResult`, Mera FE `reviewRequestApi.ts:176`). Chưa ai dùng |
| MT-9b | **Đã đóng** | `reviewComparableContent` (`review_request_library.go:89-91`). Local test có mẫu `\r\n` (`zz_review_request_templates_local_test.go:290`) |
| MT-9c | **Đã đóng** | Mera FE: preview gặp 404 thì tải lại thư viện (`RequestReviewsDialog.tsx:130-134`) |
| MT-9d | **Đã đóng** | dora-1 `ReviewRequestTemplatesDialog.tsx:74,234-258` |

### X.5 Findings

**X-1 — Chặn merge (điều kiện deploy, không phải lỗi code) · 2 FE trước fulfill BE · đơn đã bỏ tích vẫn bị gửi tin cho buyer**
- Bằng chứng: Mera BE ở HEAD đọc body send bằng struct `{IDs, Message, ProjectID}` (`git show HEAD:internal/controllers/review_request_controller.go`, Send) và `ShouldBindJSON` bỏ qua field lạ. Vì vậy FE mới (dora-1 `buildManualSendPlan`, Mera FE `buildManualSendRequest`) gửi `exclude_order_ids` tới BE cũ thì BE xếp hàng **mọi** đơn của các mã còn trong `ids`. Mã đã loại hết đơn thì không sao, vì FE đã bỏ nó khỏi `ids`. Tin đã gửi cho buyer thì không thu hồi được.
- Các trường hợp lệch khác chỉ gây lỗi tạm thời, không gây hại:
  - `review_request` gửi tới BE cũ bị bỏ qua: danh sách không lọc dù select đang hiện "Đã xin review".
  - `date_field=requested` gửi tới BE cũ bị 400 `invalid_date_field`.
- Sửa: giữ đúng N.5. fulfill BE lên **trước** cả Mera FE lẫn dora-1, hoặc cùng lúc với BE lên trước vài phút. Nếu muốn chặn bằng code: FE kiểm response, gửi `exclude_order_ids` mà `skipped[]` không có dòng `excluded` nào thì cảnh báo "Mera chưa hỗ trợ bỏ đơn". Lúc đó tin đã xếp hàng rồi, nên chỉ để phát hiện. Owner: leader/release.

**X-2 — Nên sửa (cần xác nhận) · fulfill BE · lọc "Xin review" có thể lệch với badge của chính dòng đó**
- Bằng chứng: bộ lọc lấy ledger theo `project_id ∈ scope` (+ `store` với `dora:<shop>`) (`delivery_review_request_filter.go:47-53`). Badge `orders[].review_request` lại gắn **chỉ theo receipt** (`review_request_service.go:1002-1021`). Ledger có đúng 1 doc mỗi receipt (`models/review_request.go:146`) và `project_id`/`store` bị ghi đè theo lần gửi gần nhất (`reviewDocBase`, `review_request_service.go:550-554`).
- Kịch bản: receipt R nằm ở ref của 2 phạm vi (vd ref Mera project P và ref `dora`, hoặc 2 project), và lần gửi gần nhất từ phạm vi Q. Khi xem phạm vi P, dòng hiện badge "Đã xin review" nhưng lọc `sent` không ra dòng đó, còn lọc `none` lại ra. Dữ liệu local (485 mã) không có receipt nào dùng chung giữa các project, nên chưa tái hiện được. Cần kiểm prod: `$unwind refs` → nhóm theo `etsy_receipt_id` → đếm receipt có ≥2 `project_id` / `source`.
- Sửa nếu prod có: lọc ledger theo receipt thay vì theo `project_id`. Lấy tập receipt của các ref trong scope rồi tra ledger `etsy_receipt_id $in` (index unique có sẵn). Hoặc ghi rõ trong plan rằng lọc tính theo "phạm vi đã gửi". Owner: fulfill BE.

**X-3 — Nên sửa (cần xác nhận dữ liệu prod) · fulfill BE · bước nhập tạo bản sao "Mẫu cũ — X" có nội dung y hệt mẫu mặc định**
- Bằng chứng: BE cũ trả GET `template` = mẫu **đang áp dụng**, tức mẫu mặc định khi project chưa có mẫu riêng (HEAD `loadSettings`). FE cũ (HEAD dora-1 `useState(settings.template)` → PUT `template`; HEAD Mera FE `settings?.template`) điền sẵn chuỗi đó, nên mỗi lần ai đó chỉ đổi `max_days` là doc settings bị ghi nguyên văn mẫu mặc định. Fix MT-1(b) cũng làm y như vậy trong khoảng deploy lệch (FE mới + BE cũ). `importLegacyTemplates` không loại nội dung trùng mẫu mặc định (`review_request_library.go:331-350`), nên mỗi doc như vậy thành 1 mẫu "Mẫu cũ — <project>" giống hệt "Mẫu mặc định". Việc này kéo theo MT-2: nếu map trigger cũ sang mẫu "Mẫu cũ — …" thì cũng chẳng khác gì.
- Kiểm prod: đếm `review_request_settings` có `TrimSpace(template)` = `DefaultReviewRequestTemplate`.
- Sửa (rẻ): trong `importLegacyTemplates`, bỏ qua doc khi `reviewComparableContent(r.Template) == reviewComparableContent(DefaultReviewRequestTemplate)`. Không cần đổi FE. Owner: fulfill BE.

**X-4 — Ghi chú · Mera FE · nút "Gửi 0 đơn" vẫn bấm được khi chỉ còn mã không có đơn**
- Bằng chứng: Mera FE `RequestReviewsDialog.tsx:168` (`nothingToSend = ids.length === 0`), so với dora-1 `RequestReviewsDialog.tsx:195` (`ids` rỗng **hoặc** N = 0 và không có mã ở trang khác). Kịch bản parity S8: chọn mã a (1 đơn) và mã c (không có đơn), bỏ tích đơn của a. dora-1 khoá nút. Mera FE gửi `ids:[c]`, BE trả `no_orders`, toast "Không xếp hàng tin nào". Spec §13 ghi "disable khi N = 0".
- Sửa: `nothingToSend = ids.length === 0 || (counts.selected === 0 && unknownRows === 0)`. Owner: Mera FE.

**X-5 — Ghi chú · fulfill BE · hiệu năng lọc "Xin review" khi xem "Tất cả project"**
- Mỗi request list đọc ledger 1 lần (2 lần khi kèm `date_field=requested`). Index đúng: `{project_id, sent_at}` (mới) cho `sent` và khoảng ngày, `{project_id, status}` cho `pending`/`failed`, `none` dùng `$or` qua cả hai. Nhưng truy vấn không phải covered (projection `etsy_receipt_id` không nằm trong index), nên phải FETCH từng doc.
- Tập receipt (với `none` và `sent` là toàn bộ đơn từng xin của mọi project của caller) được nhúng vào `$match` của aggregate counts, vào `Find`, và vào `CountDocuments` khi có lọc review/rating. Khoảng 22 byte/receipt: 100k receipt ≈ 2.2MB mỗi lệnh, tối đa 3 lệnh mỗi request.
- Phía `shipment_trackings` dùng index `project_ids` có sẵn, còn `$elemMatch`+`$in` được tính trong bộ nhớ (lookup theo tập, không quét tuyến tính).
- Request lặp lại khi: tự tải ngầm mỗi 10s lúc còn đơn đang chờ, và mỗi trang khi export.
- Kết luận: ổn ở quy mô hiện tại. Khi ledger lớn: thêm `etsy_receipt_id` vào index `{project_id, sent_at}` (covered), hoặc ghi cờ lên `shipment_trackings` như `reviewed_project_ids`. Owner: fulfill BE.

**X-6 — Ghi chú · Mera FE · bảng preview 5000 dòng không ảo hoá**
- `RequestReviewsDialog.tsx:440` render đủ `sample` (tối đa 5000 × 5 ô). Chạy được nhưng mở dialog của project lớn sẽ chậm, còn dora-1 thì có ảo hoá. Key `${order_id}|${tracking_code}` có thể trùng nếu 2 receipt cùng order_id và cùng mã (hiếm, chỉ ra cảnh báo của React).

**X-7 — Ghi chú · 2 FE · "Chưa xin review" + "Ngày xin review" + khoảng ngày luôn ra rỗng mà không báo**
- Đúng ngữ nghĩa Go (`delivery_review_request_filter.go:86-95`). Có thể thêm 1 dòng gợi ý khi `reviewRequest === 'none' && dateField === 'requested' && (from || to)`.
- Tương tự `date_field=ship` cũ: chọn "Ngày xin review" mà chưa có ngày thì không lên URL, nên tải lại trang sẽ về "Ngày Paid".

**X-8 — Ghi chú · Go vs 2 FE · ký tự khoảng trắng hiếm trong tiêu đề** (xem X.3)
- U+0085 (NEL): Go gộp thành dấu cách, FE giữ nguyên. Tiêu đề chỉ có `"\u0085"` thì FE cho qua còn Go trả `invalid_title`.
- U+FEFF và U+200B: Go giữ nguyên, nên tiêu đề chỉ có `"\uFEFF"` được Go chấp nhận dù nhìn như trống. FE chặn U+FEFF.
- Không ảnh hưởng tính duy nhất. Nếu muốn chặt: Go thêm `strings.Trim(…, "\uFEFF\u200B")` hoặc từ chối tiêu đề không có ký tự nhìn thấy được.

### X.6 Thứ tự deploy (bổ sung N.5)
- Giữ N.5. Thêm 1 điều kiện cứng: **fulfill BE phải lên trước mọi FE có §13** (X-1). Ở N.5 dora-1 vốn đã lên sau bước 2. Với Mera FE, "BE trước FE vài phút" giờ là bắt buộc, không còn là tuỳ chọn.
- Trước bước 2: chạy 2 truy vấn kiểm prod của X-2 và X-3, cùng với kiểm MT-2.
