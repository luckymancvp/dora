# 02 — Backend: Request reviews (B1–B3)

Ngày: 2026-10-21 · Contract: `_workspace/01_architect_contract.md` (§2, §3, §7.5) · `npx tsc --noEmit` sạch · Không commit.
Không đụng `lib/services/delivery-push.ts` (fix ngày của orchestrator). `npm run lint` không chạy được: repo không có `eslint.config.*` (ESLint 10).

## File

| File | Loại | Ghi chú |
|---|---|---|
| `app/api/machine/order-conversations/fetch/route.ts` | mới (B1) | endpoint máy, x-api-key |
| `lib/services/delivery-proxy.ts` | sửa (B2) | chỉ `async function callMera` → `export async function callMera` (+1 dòng comment) |
| `lib/services/review-request-proxy.ts` | mới (B2) | server-only, 6 hàm, chuẩn hoá 2xx |
| `lib/http/delivery-error.ts` | sửa | thêm `deliveryBadRequest(error, "invalid_body"\|"invalid_project_id")` → 400 `DeliveryApiErrorBody` |
| `app/api/delivery/review-requests/{settings,preview,run,send,summary}/route.ts` | mới (B3) | settings có GET+PUT |
| `lib/types/delivery.ts` phần D | sửa | theo addendum orchestrator (contract §7.5) |
| `_workspace/01_architect_contract.md` | sửa | R-A2, §1, bảng §3.3 dòng send, §7.5 |

## Đổi type (addendum, contract §7.5)

- `ReviewRequestPreviewSample` = `{order_id, etsy_receipt_id, shop_name, store, tracking_code: string; delivered_at: string|null; has_conversation: boolean|null}` — bỏ `will_check_conversation` per-sample, mọi key bắt buộc.
- `ReviewRequestSendRequest` thêm `project_id?: string`.
- `ReviewRequestSendSkipped` = `{order_id, tracking_code, reason}` (bỏ `tracking_id`, mọi key bắt buộc).
- `ReviewRequestFailedItem.at: string | null` (bắt buộc).
- `DeliveryOrderReviewRequest` thêm `skip_reason?: ReviewRequestSkipReason | ""`.

## Sửa theo QA B4 (2026-10-21, đối chiếu struct Go thật `review_request_service.go`)

- `ReviewRequestSkippedCounts`: 3 key gốc bắt buộc + `send_blocked_env? / shop_offline? / conversation_unknown? / manual_failed?` + index `[reason: string]: number | undefined`. Sanitizer giữ MỌI key có giá trị số (bỏ giá trị không phải số), 3 key gốc thiếu → 0.
- `ReviewRequestRunResult.checking: number` và `ReviewRequestSummary.checking: number` (vắng → 0). Summary: `queued` ĐÃ GỒM `checking`.
- `ReviewRequestSendSkipped.tracking_id: string` (reason `not_found` Mera chỉ có field này).
- `ReviewRequestPreviewSample.project_id: string`, `.tracking_id: string`.
- `DeliveryApiErrorBody.unknown_vars?: string[]` (400 `invalid_template`). Runtime vốn đã chuyển tiếp nguyên body lỗi Mera qua `callMera`; chỉ thêm field vào type.
- `ReviewRequestSkipReason` (union skip_reason của sổ) KHÔNG đổi: Go `models/review_request.go` chỉ ghi has_conversation / conversation_unknown / shop_offline.
- **tsc đỏ ở phía FE** sau khi thêm index signature: `components/delivery/RequestReviewsDialog.tsx:330` (`SKIP_REASON_LABEL[k]` với `k: keyof ReviewRequestSkippedCounts` giờ là `string`; `data.skipped[k]` có thể undefined). Việc của frontend-engineer: render `Object.entries(data.skipped)` với n > 0 và nhãn dự phòng = tên key.

## Route

Mọi route `/api/delivery/review-requests/*`: `requireEmail()` (401 `{error:"unauthenticated"}`), actor = email session → `X-Actor-Email`; 2xx Mera → **200**; lỗi: `deliveryErrorResponse` (lỗi Mera nguyên văn status+body; 401 Mera → 502 `mera_auth_failed`; không JSON/thiếu `error`, gồm gin 404 chưa deploy → 502 `mera_bad_response`; mạng → 502 `mera_unavailable`; thiếu env → 503 `mera_not_configured`).

| Route | Vào (dora-1 chỉ kiểm kiểu) | 200 | Mera | Timeout |
|---|---|---|---|---|
| `POST /api/machine/order-conversations/fetch` | header `x-api-key`; body `{shopName: string, orderIds: number[]}` (số nguyên dương, bỏ trùng, 1..50) | `{ok:true, requestedAt}`; 409 `{ok:false, error:"Shop chưa có extension online", code:"shop_offline"}`; 400 `{error, code:"bad_request"}`; 401 `{error:"unauthenticated", code:"unauthenticated"}`; 500 `{error}` | — (Ably `fetch-order-convo` `{order_ids, clientId}`) | — |
| `GET /api/delivery/review-requests/settings?project_id=` | `project_id` trim ≠ "" else 400 `invalid_project_id` | `ReviewRequestSettings` | `GET /api/v2/review-requests/settings?project_id=` | 15s |
| `PUT /api/delivery/review-requests/settings` | body object (else `invalid_body`); `project_id` string ≠ "" (`invalid_project_id`); `template` string, `max_days` số hữu hạn (`invalid_body`) | `ReviewRequestSettings` | `PUT …/settings` body `{project_id, template, max_days}` | 15s |
| `POST /api/delivery/review-requests/preview` | `{project_id}` | `ReviewRequestPreview` | `POST …/preview` | 30s |
| `POST /api/delivery/review-requests/run` | `{project_id}` | `ReviewRequestRunResult` `{queued, checking, skipped}` | `POST …/run` | 30s |
| `POST /api/delivery/review-requests/send` | `ids` mảng string không rỗng (`invalid_body`); `message` vắng/string (`invalid_body`); `project_id` vắng/string (`invalid_project_id`); trim rỗng → bỏ field; message giữ nguyên định dạng | `ReviewRequestSendResult` | `POST …/send` body `{ids, message?, project_id?}` | 30s |
| `GET /api/delivery/review-requests/summary?project_id=` | như GET settings | `ReviewRequestSummary` `{queued (⊇checking), checking, sending, sent_today, failed_recent[]}` | `GET …/summary?project_id=` | 15s |

## Chuẩn hoá 2xx (service)

- settings: chuỗi vắng → `""`; `max_days` → `asNumber ?? 7`; `is_default` → `=== true`; `variables` → mảng string (rỗng giữ rỗng); `updated_at` → string không rỗng hoặc null.
- preview/run: `skipped` giữ mọi key số, 3 key gốc luôn có (vắng → 0); `checking` (run) → số; số vắng → 0; `sample` → mảng object, mỗi phần tử đủ key `{order_id, etsy_receipt_id, project_id, tracking_id, shop_name, store, tracking_code, delivered_at, has_conversation}` (id số → chuỗi; `delivered_at` rỗng → null; `has_conversation` chỉ nhận boolean, còn lại null).
- send: `queued` → số; `warnings` lọc `kind ∈ {already_requested, reviewed}` (kind lạ bị bỏ); `skipped` đủ `{order_id, tracking_id, tracking_code, reason}` (vắng → "").
- summary: `queued/checking/sending/sent_today` → số; `failed_recent` đủ `{order_id, shop_name, error, at}` (`at` rỗng → null).
- `orders[].review_request` trên list/detail: KHÔNG chuẩn hoá (pass-through, vắng = undefined).

## Ghi chú cho FE / QA

- FE đọc `sample[].has_conversation` (không còn `will_check_conversation` per-sample); `skipped[].tracking_code` (không còn `tracking_id`).
- Gửi tay nên kèm `project_id = reviewRequestProjectId(project)` khi khác null.
- Không gọi thử được route proxy thật: Mera BE chưa có `/api/v2/review-requests/*` (grep repo Mera không thấy) ⇒ hiện tại mọi route proxy trả 502 `mera_bad_response`, đúng R10.
