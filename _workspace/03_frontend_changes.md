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
