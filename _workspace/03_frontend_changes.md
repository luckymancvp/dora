# 03 — Frontend: Request reviews (F1–F3)

Ngày 2026-10-21 · contract `_workspace/01_architect_contract.md` §4 + addendum orchestrator (§7.5) · type `lib/types/delivery.ts` phần D (đọc lại bản cuối của backend — không type cục bộ cho shape API). Không commit. Không đụng `lib/services/delivery-push.ts`.

## F1 — `lib/delivery/reviewRequest.ts` (mới, thuần)
| Export | Ghi chú |
|---|---|
| `reviewRequestProjectId(project)` | '' → null · `dora` / `dora:<store>` → `"dora"` · hex → hex (R-A1). |
| `reviewRequestBadge(rr)` → `{label, tone: ok\|pending\|error\|muted, title} \| null` | sent → "Đã xin review · dd/MM" (giờ VN, sent_at null → "Đã xin review"), ok · queued/sending/checking → "Đang chờ gửi", pending (title phân biệt checking = "đang nhờ extension kiểm lại hội thoại") · failed → "Gửi lỗi", title = `error` · **skipped → "Bỏ qua", muted, title = lý do `skip_reason`** (addendum; contract §4.2 cũ ghi null) · null/vắng → null. |
| `SKIP_REASON_LABEL`, `skipReasonLabel(reason)` | 5 lý do theo contract; `send.skipped[].reason` lạ (not_found/no_orders/sending…) → nhãn VN nếu biết, không thì nguyên văn. |
| `SEND_WARNING_LABEL` | already_requested "Đã xin review trước đó", reviewed "Đã có review". |
| `reviewRequestVariables(s)` | `variables` rỗng → `REVIEW_REQUEST_VARIABLES`; token thiếu `{}` → bọc; bỏ trùng. |
| `renderReviewTemplate(tpl, v)`, `REVIEW_PREVIEW_SAMPLE_VARS` | thay mọi `{buyer_name}/{order_id}/{shop_name}`. |
| `manualWarnings(rows)` | R-A3. "Đã xin review" = `review_request.status ∈ sent\|queued\|sending\|checking` (**skipped/failed không cảnh báo** — tin chưa tới tay khách); "đã có review" = item có `review` (`hasReview`). Bỏ trùng theo order_id+store+kind. |
| `formatDateTimeVN`, `reviewRequestErrorText(body, fallback)` | lỗi = `body.error` (+ ` (shop X)` nếu có `shop` và câu chưa nhắc). |

## F2 — hook trong `lib/hooks/useDelivery.ts` (dùng `deliveryFetch`/`DeliveryApiError`)
| Hook | Gọi | queryKey / cache | Type |
|---|---|---|---|
| `useReviewRequestSettings(pid)` | GET `/api/delivery/review-requests/settings?project_id=` (URLSearchParams) | `["delivery","review-requests","settings",pid]`, enabled `!!pid`, staleTime 60s | `ReviewRequestSettings` |
| `useSaveReviewRequestSettings()` | PUT `…/settings` body `ReviewRequestSettingsUpdate` | onSuccess `setQueryData(settings key của body.project_id)` + invalidate `[…,"preview"]` | `ReviewRequestSettings` |
| `useReviewRequestPreview(pid, enabled)` | POST `…/preview` body `{project_id}` | `["delivery","review-requests","preview",pid]`, enabled `enabled && !!pid`, staleTime 0, gcTime 0, retry false | `ReviewRequestPreview` |
| `useRunReviewRequests()` | mutation(pid) POST `…/run` `{project_id}` | onSuccess: invalidate `["delivery","list"]` + `[…,"summary"]`, remove `[…,"preview"]` | `ReviewRequestRunResult` |
| `useSendReviewRequests()` | mutation(`ReviewRequestSendRequest`) POST `…/send` | như run | `ReviewRequestSendResult` |
| `useReviewRequestSummary(pid)` | GET `…/summary?project_id=` | `["delivery","review-requests","summary",pid]`, enabled `!!pid`, refetchInterval 10s khi `queued+sending>0` | `ReviewRequestSummary` |

Body send FE gửi: `{ids: [...selection.keys()], message?: trim≠"" , project_id?: reviewRequestProjectId(filters.project) khi ≠ null}` — bộ lọc "Tất cả" ⇒ vắng project_id (Mera xếp mọi đơn của mã).

## F3 — component
- `components/delivery/DeliveryUtilsDropdown.tsx` (mới): nút "Utils" (Wrench), menu Tailwind (click ngoài / Esc / chọn mục thì đóng): "Request reviews" (Send, badge số mã đang chọn) · "Cài đặt Request reviews" (Settings).
- `components/delivery/ReviewRequestModal.tsx` (mới, dùng chung 2 dialog): khung modal (overlay fixed z-40 + panel z-50, Esc/click overlay đóng), `ReviewProjectSelect` (projects + "Dora" khi `doraShops !== null`, bắt buộc khi bộ lọc ''), `DoraScopeNote` (đang lọc `dora:<store>` → "áp dụng cho toàn bộ Dora"), `reviewProjectName`, `reviewRequestError`, `ReviewErrorBox`.
- `components/delivery/RequestReviewsDialog.tsx` (mới; props đúng contract). Mount lại mỗi lần mở (state không dính).
  - Gửi tay (`selection.size>0`): textarea maxLength 2000 + đếm ký tự, placeholder = `settings.template` (→ `default_template`) của project đã map; null → "Trống = dùng mẫu của từng project". Danh sách mã → đơn `order_id · store` + cảnh báo `manualWarnings` inline; "+N mã ở trang khác". "Gửi" → toast "Đã xếp hàng N tin" (queued 0 → warning) + toast warning liệt kê `warnings[]` (order_id: kind) và `skipped[]` (order_id \|\| tracking_code: lý do), ≤5 dòng + "+N khác" → `onSent()` (bỏ chọn) + đóng. Lỗi → hộp lỗi trong dialog, giữ nội dung.
  - Tự động (không chọn mã): project = map của bộ lọc hoặc select trong dialog; preview → "Sẽ gửi" (candidates), "cần kiểm lại hội thoại" (will_check_conversation), Bỏ qua 3 khoá (SKIP_REASON_LABEL), bảng mẫu ≤20 (`order_id, shop_name||store, tracking_code, delivered_at, has_conversation` true "Đã có" / false "Chưa có — kiểm lại trước khi gửi" / null "Chưa xác định"). candidates 0 ⇒ disable. "Xác nhận gửi" → toast "Đã xếp hàng N đơn" → đóng. Lỗi preview có nút "Thử lại".
  - Chân: summary "Đang chờ q · Đang gửi s · Đã gửi hôm nay t" + `failed_recent` ≤5 (`order_id · shop_name — error (at)`); không có project → câu nhắc chọn project.
- `components/delivery/ReviewRequestSettingsDialog.tsx` (mới): project như mode tự động; form khởi tạo từ settings (`key=projectId`, không setState trong effect): textarea (/2000), nút chèn biến tại `selectionStart/End` (quá 2000 → toast, không chèn), "Xem trước" (`renderReviewTemplate` + REVIEW_PREVIEW_SAMPLE_VARS; mẫu trống → xem trước mẫu mặc định), `max_days` number 1–30 (sai → báo + khoá Lưu), "Dùng mẫu mặc định", nhãn "Đang dùng mặc định" khi `is_default`, `updated_by`/`updated_at`. "Lưu" → toast + đóng; lỗi (`invalid_template`/`invalid_max_days`… → `body.error`) trong dialog.
- `DeliveryToolbar.tsx`: + props `onRequestReviews`, `onReviewSettings`, `selectedCount` → `<DeliveryUtilsDropdown/>` ngay sau Export.
- `DeliveryRow.tsx`: cột Status, dưới badge status: mỗi đơn có `reviewRequestBadge(o.review_request)` ≠ null → badge nhỏ (prefix `order_id` khi mã > 1 đơn); tone ok=emerald, pending=amber, error=red, muted=muted; tooltip = `title`.
- `DeliveryPage.tsx`: state `reviewDialog: "request"|"settings"|null`; `selectedRows` **chụp lúc mở dialog** (event handler, không trong render) từ `data.items` (ưu tiên) + `qc.getQueriesData(["delivery","list"])`, lọc id ∈ selection, bỏ trùng id; `onSent = clearSelection` (useCallback).

## Field component đọc (QA)
- Settings: `template, max_days, is_default, default_template, variables, updated_by, updated_at`.
- Preview: `candidates, will_check_conversation, skipped.{has_conversation,reviewed,already_requested}, sample[].{order_id, shop_name, store, tracking_code, delivered_at, has_conversation}`.
- Run: `queued`. Send: `queued, warnings[].{order_id,kind}, skipped[].{order_id,tracking_code,reason}`.
- Summary: `queued, sending, sent_today, failed_recent[].{order_id, shop_name, error, at}`.
- Row: `orders[].review_request.{status, mode, sent_at, error, skip_reason}` (vắng → không badge), `orders[].items[].review` (cảnh báo).
- Lỗi: `DeliveryApiError.body.error`, `.body.shop`.

## Kiểm tra
- `npx tsc --noEmit`: sạch.
- `npm run lint` không chạy được (repo không có eslint config/deps). Lint bằng eslint 9 + typescript-eslint recommended + react-hooks recommended ở scratchpad cho `lib/delivery/reviewRequest.ts`, `lib/hooks/useDelivery.ts`, `components/delivery/*.tsx`: 0 lỗi (đã sửa 2 lỗi `preserve-manual-memoization` do arrow inline `onSent` → `clearSelection` useCallback).
- Chưa chạy trình duyệt: Mera BE chưa có `/api/v2/review-requests/*` ⇒ route proxy hiện trả 502 `mera_bad_response`, dialog hiện câu lỗi (R10), trang không vỡ.

## Ghi chú / lệch contract
1. Badge `skipped` = "Bỏ qua" muted (addendum), không phải null.
2. `manualWarnings`: quy tắc đã đổi ở vòng QA (xem mục 3 bên dưới).
3. Chạy tự động khi đang lọc `dora:<store>` = chạy cho cả Dora (Mera chỉ có project "dora") — dialog ghi chú rõ.
4. Sau "Xác nhận gửi"/"Gửi", hook `removeQueries(preview)` chạy trước khi dialog đóng — có thể có 1 lần POST preview thừa nếu React render giữa hai bước (vô hại, gcTime 0).

## Vòng sửa theo QA (`_workspace/04_qa_report.md` B4, B5, N1, N2/B3) — type đã nới bởi backend

| # | Sửa | File |
|---|---|---|
| 1 | `SKIP_REASON_LABEL` = 1 bảng cho cả 3 nguồn (khớp Go `ReviewSkipCounts` + `ReviewSendSkipped.Reason` + nhãn Mera FE): has_conversation, reviewed, already_requested, send_blocked_env, shop_offline, conversation_unknown, manual_failed, not_found, no_orders, no_receipt, sending; key lạ → nguyên key (`skipReasonLabel`). Helper mới `skippedCountEntries(skipped, withBase)` (mọi key số > 0, gồm key lạ) + `skippedCountsSummary` ("3 Đã có hội thoại…; 2 Shop offline…"). Preview "Bỏ qua" render `skippedCountEntries(data.skipped, false)` (chỉ key > 0; không có → "Không có."). `send.skipped[]` hiện `order_id \|\| tracking_code \|\| code của tracking_id (map từ selectedRows) \|\| tracking_id`. | `lib/delivery/reviewRequest.ts`, `RequestReviewsDialog.tsx` |
| 2 | `queued === 0` → toast **warning** kèm lý do (run: `skippedCountsSummary`, send: danh sách skipped), không còn toast xanh. Run `queued > 0`: success + "(N đơn kiểm lại hội thoại trước khi gửi)" từ `run.checking` + mô tả bỏ qua nếu có. | `RequestReviewsDialog.tsx` |
| 3 | `manualWarnings` — "đã xin review" khi `sent_at` có giá trị, HOẶC status ∈ queued\|checking\|sending\|sent, HOẶC `error` bắt đầu bằng `unconfirmed` (Go: `"unconfirmed: dora-1 chưa báo DONE/FAILED…"`). **Thêm `interrupted`** (Go `"interrupted: không rõ dora-1 đã nhận tin chưa…"`) — cùng rủi ro khách đã nhận; bỏ nếu không muốn. | `lib/delivery/reviewRequest.ts` |
| 4 | Kiểm mẫu phía client `invalidTemplateTokens(tpl)`: mọi `{…}` khác đúng `{buyer_name}` `{order_id}` `{shop_name}` (khoảng trắng, gạch nối, số, …), `{{…}}`, ngoặc lẻ `{`/`}` → lỗi. Dialog cài đặt: dòng lỗi đỏ + khoá "Lưu". Ô gửi tay: cùng kiểm, khoá "Gửi". BE `unknown_vars` (400 invalid_template) nối vào câu lỗi (`reviewRequestErrorText`, khi `error` chưa liệt kê). | `lib/delivery/reviewRequest.ts`, `ReviewRequestSettingsDialog.tsx`, `RequestReviewsDialog.tsx` |
| 5 | Summary: vẫn poll khi `queued + sending > 0` (queued ĐÃ gồm checking — không cộng thêm) và chỉ khi dialog mở (hook chỉ mount trong dialog). Chân dialog hiện thêm "(trong đó kiểm hội thoại N)" khi `checking > 0`. | `useDelivery.ts` (không đổi), `RequestReviewsDialog.tsx` |

Field đọc thêm: `skipped.*` (mọi key số), `run.checking`, `summary.checking`, `send.skipped[].tracking_id`, `DeliveryApiErrorBody.unknown_vars`. `sample[].project_id/tracking_id` không đọc.

Kiểm lại: `npx tsc --noEmit` sạch; eslint scratchpad (typescript-eslint + react-hooks recommended) cho `lib/delivery/reviewRequest.ts`, `lib/hooks/useDelivery.ts`, `components/delivery/*.tsx`: 0 lỗi. Tự test `invalidTemplateTokens` bằng node: `{ buyer_name }`, `{shop-name}`, `{buyer_name1}`, `{{buyer_name}}`, `{order_id }`, `{buyer_name` (ngoặc lẻ), `a } b` đều bị bắt; mẫu đúng 3 biến → [].

## Vòng bổ sung: `unconfirmed` (Mera BE chốt cuối)

- `lib/types/delivery.ts` (theo yêu cầu orchestrator): `DeliveryOrderReviewRequest.unconfirmed?: boolean` (chỉ có khi status failed + không rõ kết quả), `ReviewRequestFailedItem.unconfirmed?: boolean`.
- `lib/services/review-request-proxy.ts` `normalizeFailed`: giữ `unconfirmed: true` khi Mera trả `=== true` (vắng = false). `orders[].review_request` vẫn pass-through.
- Badge: `failed` + `unconfirmed === true` → "Chưa xác nhận" (tone pending = vàng), tooltip "Không rõ buyer đã nhận tin chưa — hệ thống đang kiểm lại"; failed khác vẫn "Gửi lỗi".
- `manualWarnings`/`isRequested`: thêm `unconfirmed === true` (ngoài sent_at / status / error unconfirmed|interrupted).
- Chân dialog "Lỗi gần đây": mục `unconfirmed` hiện vàng "Chưa xác nhận (error)" + tooltip như trên.
- Nhãn `manual_failed` đã có từ vòng trước.
- `npx tsc --noEmit` sạch; eslint scratchpad 0 lỗi (gồm cả types + proxy service).

- QA R2-3: `manualWarnings` — đơn `review_request.status === "sending"` → cảnh báo kind FE-only `"sending"` "Đang gửi — sẽ bị bỏ qua" (`MANUAL_WARNING_LABEL`), KHÔNG còn tính là "đã xin review" (bỏ `sending` khỏi `isRequested`). `ManualWarning.kind` = `already_requested | reviewed | sending`. tsc sạch, eslint scratchpad 0 lỗi.

## §11 Nhiều mẫu tin (2026-10-22) — thư viện mẫu dùng chung

Type tiêu thụ (backend đã thêm trong `lib/types/delivery.ts`): `ReviewRequestTemplate`, `ReviewRequestTemplatesResponse`, `ReviewRequestTemplateInput`, `ReviewRequestTemplateDeleteResult`, `ReviewRequestPreviewRequest`, `ReviewRequestRunRequest`, `ReviewRequestSendRequest.template_id`, `REVIEW_REQUEST_DEFAULT_TEMPLATE_ID`, `REVIEW_REQUEST_TEMPLATE_TITLE_MAX`.

### Hook (`lib/hooks/useDelivery.ts`)
| Hook | Gọi | queryKey / invalidation | Cast |
|---|---|---|---|
| `useReviewRequestTemplates()` | GET `/api/delivery/review-requests/templates` | `["delivery","review-requests","templates"]`, staleTime 60s | `ReviewRequestTemplatesResponse` |
| `useCreateReviewRequestTemplate()` | POST `/templates` body `ReviewRequestTemplateInput` | thành công: vá cache (thêm item) + invalidate templates; lỗi: invalidate | `ReviewRequestTemplate` |
| `useUpdateReviewRequestTemplate()` | PUT `/templates/:id` (vars `{id,title,content}`, body chỉ `{title,content}`) | vá cache (thay item) + invalidate; lỗi: invalidate | `ReviewRequestTemplate` |
| `useDeleteReviewRequestTemplate()` | DELETE `/templates/:id` | vá cache (bỏ item) + invalidate; lỗi: invalidate | `ReviewRequestTemplateDeleteResult` |
| `useReviewRequestPreview(projectId, templateId, enabled)` | POST `/preview` body `ReviewRequestPreviewRequest {project_id, template_id}` | key thêm `templateId`: `[...,"preview",projectId,templateId]` | `ReviewRequestPreview` |
| `useRunReviewRequests()` | POST `/run` — mutate nhận `ReviewRequestRunRequest {project_id, template_id}` | như cũ | `ReviewRequestRunResult` |
| `useSaveReviewRequestSettings()` | PUT `/settings` — FE chỉ gửi `{project_id, max_days}` (không gửi `template`) | như cũ | `ReviewRequestSettings` |

### Helper (`lib/delivery/reviewRequest.ts`)
- `REVIEW_TEMPLATE_ERROR_LABEL` (code → câu VN): `duplicate_title`, `invalid_title`, `invalid_template`, `system_template`, `template_not_found`, `template_required`. `reviewRequestErrorText` ưu tiên nhãn theo `body.code`; invalid_template vẫn nối `unknown_vars`, không có biến (vd quá dài) → nối câu gốc Mera.
- `pickReviewTemplate(items, id)`: id còn trong thư viện → mẫu đó; không → `is_system`/`default` → item đầu → null.
- `reviewTemplateTitleError(title, items, selfId)`: bắt buộc, ≤ 100, không trùng (trim + lowercase) mẫu khác.
- `reviewRequestVariables` nhận `Pick<ReviewRequestTemplatesResponse,"variables">` (settings không còn là nguồn biến).

### Component
- `DeliveryUtilsDropdown` + `DeliveryToolbar` + `DeliveryPage`: mục mới "Mẫu tin Request reviews" (`onReviewTemplates`) → `reviewDialog = "templates"`.
- `ReviewRequestTemplatesDialog.tsx` (mới): danh sách trái (title, badge "Hệ thống", updated_by · updated_at) + form phải (title ≤100 có đếm, content ≤2000, chèn biến tại con trỏ, kiểm biến B5 `invalidTemplateTokens`, xem trước dữ liệu mẫu). `default` (`is_system`) chỉ xem. Thêm / Lưu / Xoá (`confirm`) / Huỷ thay đổi; bản nháp chưa lưu → `confirm` khi đổi mẫu / đóng (Esc, overlay, X). PUT trả `template_not_found` → giữ nội dung thành form "Mẫu mới".
- `ReviewRequestModal.tsx`: prop `wide` (max-w-4xl); thêm `ReviewTemplateSelect` (luôn có 1 mẫu chọn, mặc định `default`) và `ReviewTemplatePreview` (render `REVIEW_PREVIEW_SAMPLE_VARS`).
- `ReviewRequestSettingsDialog`: chỉ còn `max_days` (bỏ mẫu / chèn biến / xem trước), ghi chú mẫu sửa ở "Mẫu tin Request reviews".
- `RequestReviewsDialog` — tự động: select mẫu bắt buộc (mặc định `default`) + "Nội dung sẽ gửi" (xem trước) luôn hiện trên phần preview; preview + run gửi `template_id`. Gửi tay: select mẫu → đổ `content` vào textarea (sửa được; đang soạn khác mẫu cũ → `confirm` trước khi thay), placeholder = nội dung mẫu đang chọn; luôn gửi `template_id`, thêm `message` khi textarea khác rỗng. Bỏ `useReviewRequestSettings` khỏi gửi tay.

### Field component đọc (QA)
- `ReviewRequestTemplate`: `id`, `title`, `content`, `is_system`, `created_by`, `updated_by`, `updated_at`.
- `ReviewRequestTemplatesResponse`: `items`, `variables`.
- `DeliveryApiErrorBody`: `code`, `error`, `unknown_vars`, `shop`.
- Settings: `max_days`, `is_default`, `updated_by`, `updated_at` (không còn đọc `template` / `default_template` / `variables`).
- `ReviewRequestPreview.template_id` không đọc.

### Kiểm tra
- `npx tsc --noEmit` sạch; eslint scratchpad (typescript-eslint recommended + react-hooks) 0 lỗi trên 9 file đã sửa.

## §13 Bỏ đơn khỏi danh sách gửi tay (2026-10-22)

- Type: `ReviewRequestSendRequest.exclude_order_ids?: string[]` (backend đã thêm).
- `lib/delivery/reviewRequest.ts`: helper thuần `buildManualSendPlan({selectionIds, rows, excluded, templateId, message, projectId})` → `{request, total, included}`. Mã có đơn mà mọi đơn bị bỏ ⇒ bỏ khỏi `ids`; mã còn ≥1 đơn ⇒ giữ + đơn bị bỏ của mã vào `exclude_order_ids` (vắng khi rỗng); mã không có dòng (trang khác) / không đơn ⇒ giữ. `total`/`included` đếm order_id khác nhau trên dòng đang có. Smoke test (tsx): ids a(1,2) b(3) c() z(off-page), bỏ {2,3} → `ids [a,c,z]`, `exclude_order_ids [2]`, 1/3.
- `SKIP_REASON_LABEL.excluded` = "Đã bỏ khỏi danh sách".
- `RequestReviewsDialog` gửi tay: checkbox mỗi đơn (mặc định tích; khoá theo `order_id` như API), bỏ tích → dòng mờ + gạch; đầu danh sách "Gửi N / M đơn" + "Chọn tất cả / Bỏ chọn tất cả"; nút "Gửi N đơn" (+ "k mã trang khác" khi có), disable khi `ids` rỗng hoặc N = 0 mà không có mã ở trang khác; body = `plan.request`. Cảnh báo theo đơn giữ nguyên. Exclusion reset khi mở lại (body mount lại mỗi lần mở).
- Field đọc thêm: `orders[].order_id` (đã có). tsc sạch; eslint scratchpad 0 lỗi.
- Follow-up: toast kết quả gửi tay không liệt kê `skipped` reason "excluded"; chỉ ghi chú trung tính "Đã bỏ N đơn khỏi danh sách" (description của toast thành công, hoặc của toast "Không xếp hàng được tin nào" khi không còn lý do khác). tsc + eslint sạch.

## Sửa theo QA "Nhiều mẫu tin — 2026-10-22" (MT-1, MT-3, MT-4, MT-6, MT-9d)

- **MT-1** `ReviewRequestSettingsDialog`: PUT gửi `{project_id, max_days}` + `template` NGUYÊN VĂN khi GET settings trả `template` là chuỗi (Mera cũ không xoá mẫu riêng của project; Mera mới bỏ qua). Route đã chuyển tiếp sẵn.
- **MT-3** `pickReviewTemplate` chỉ tìm đúng id (không rơi về default). `ReviewTemplateSelect`: id không còn trong thư viện → option "(đã xoá) <id>" + câu "Mẫu đang chọn đã bị xoá — chọn mẫu khác". Tự động: giữ id, không gọi preview, ẩn số liệu/nút "Xác nhận gửi" (handleRun cũng chặn). Gửi tay: giữ id, chỉ cho gửi khi ô soạn có nội dung (placeholder báo mẫu đã xoá). Hook: `useRefetchTemplatesOnNotFound` — preview (trong queryFn), run, send (`onError`) gặp 404 `template_not_found` → invalidate `["delivery","review-requests","templates"]`.
- **MT-9d** quản lý mẫu: mẫu đang mở bị xoá ở nơi khác → thay form bằng cảnh báo + "Giữ thành mẫu mới" (khi có bản nháp, chuyển sang form mới giữ nội dung) / "Bỏ bản nháp" | "Đóng mẫu".
- **MT-4 + MT-6** `normalizeReviewTemplateTitle` = `normalize("NFC")` → `/\s+/g → " "` → trim; `reviewTextLength` = `[...t].length` (code point). `reviewTemplateTitleError` kiểm trên bản chuẩn hoá: rỗng, > 100 code point, trùng (lowercase) mẫu khác hoặc tiêu đề giữ chỗ `REVIEW_DEFAULT_TEMPLATE_TITLE = "Mẫu mặc định"`. Ô tiêu đề bỏ `maxLength`; bộ đếm theo code point của bản chuẩn hoá; POST/PUT gửi tiêu đề đã chuẩn hoá. Smoke test (tsx): 😀×100 OK, 😀×101 lỗi, "a"+150 dấu cách+"b" OK, "  mẫu   mặc\tđịnh " trùng, "Mẫu mặc định" NFD trùng.
- MT-8 (độ dài nội dung theo UTF-16 `maxLength`) chưa đổi — QA ghi chú, chỉ chặt hơn Go.
- tsc sạch; eslint scratchpad 0 lỗi (6 file).

## §14 Lọc "Xin review" + xem đủ danh sách chạy tự động (2026-10-22)

Type (backend): `DeliveryDateField` thêm `"requested"`, `DeliveryReviewRequestFilter = sent|none|pending|failed`, `DeliveryTrackingListParams.reviewRequest`, `ReviewRequestPreview.sample_truncated`.

- **(a)** `RequestReviewsDialog` chạy tự động: bỏ bảng 20 dòng; `CandidateList` hiện TOÀN BỘ `preview.sample`, ảo hoá bằng `@tanstack/react-virtual` (dòng 28px, vùng cuộn max-h-72, header ngoài vùng cuộn). Tiêu đề "Đơn sẽ gửi (N đơn)"; `sample_truncated` → "(hiện 5000 / N đơn)" + ghi chú "Xác nhận gửi" vẫn xếp hàng đủ N. Field đọc: `sample[].order_id/shop_name/store/tracking_code/delivered_at/has_conversation`, `candidates`, `sample_truncated`.
- **(b)** `lib/delivery/deliveryTracking.ts`: `REVIEW_REQUEST_FILTER_OPTIONS`, `isReviewRequestFilter`, `parseDateField` (paid|ship|requested, lạ → paid), `DATE_FIELD_OPTIONS`. `TrackingUrlState.reviewRequest`; `parseTrackingUrl` đọc `?review_request=` (lạ → ''), `date_field` qua `parseDateField`; `trackingUrlSearch` ghi `review_request` + `date_field` khác paid (khi có from/to như cũ); `trackingListParams` truyền `reviewRequest` (export XLSX dùng chung → cùng bộ lọc); `buildDeliveryTrackingQuery` set `review_request` khi hợp lệ, `date_field` = paid|ship|requested. Smoke test tsx: `review_request=pending&date_field=requested&from=…` giữ nguyên URL ↔ API; giá trị lạ bị bỏ.
- `DeliveryFilters`: select "Xin review" (Xin review: Tất cả / Đã xin review / Chưa xin review / Đang chờ gửi / Gửi lỗi · Chưa xác nhận), viền `border-primary text-primary` khi đang lọc như ô Review; select loại ngày thêm "Ngày xin review". Đổi lọc → về trang 1 (logic `update` sẵn có).
- tsc sạch; eslint scratchpad 0 lỗi, 1 warning `react-hooks/incompatible-library` ở `useVirtualizer` (giống ConversationList/MessageList hiện có).

## §15 Sửa được "Mẫu mặc định" (2026-10-22)

Type (backend): `ReviewRequestTemplate.customized` / `.editable` (route chuẩn hoá; Mera cũ → `editable = !is_system`), `ReviewRequestTemplateUpdate {content, title?}`.

- Hook: `useUpdateReviewRequestTemplate` nhận `ReviewRequestTemplateUpdate & {id}`; `title` vắng → body chỉ `{content}`. Mới `useResetDefaultReviewRequestTemplate()` → POST `/api/delivery/review-requests/templates/default/reset`, cast `ReviewRequestTemplate`. Cả hai: thành công vá item trong cache + invalidate `["delivery","review-requests","templates"]`; lỗi → invalidate.
- `ReviewRequestTemplatesDialog`: chỉ đọc khi `!editable` (thay cho `is_system`). Mẫu hệ thống: tiêu đề khoá (không kiểm / không gửi), nội dung sửa được (chèn biến, kiểm B5, xem trước), lưu = PUT `/templates/default` `{content}`, không có nút Xoá. `customized` → badge danh sách "Hệ thống · đã sửa", dòng "Đã sửa (khác nội dung gốc)" + người/lúc sửa, nút "Khôi phục mẫu gốc" (confirm) → reset, bỏ bản nháp.
- Field đọc thêm: `customized`, `editable`.
- tsc sạch; eslint scratchpad 0 lỗi.
