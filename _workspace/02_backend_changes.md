# 02 — Backend changes: Tính năng "Cập nhật Mera"

Nguồn: `_workspace/01_architect_contract.md` §2 + `lib/types/mera.ts` + `docs/order-api-v2.md`.
Skill dùng: `dora-backend-patterns` (3 tầng route→service→type, parse phòng thủ etsy-utils).

## File tạo mới
- `lib/services/mera-order.ts` (server-only) — `MeraApiError`, `resolveMeraOrder`, `updateMeraItem`, `updateMeraOrderNote`. NƠI DUY NHẤT map snake_case→camelCase.
- `app/api/mera/resolve/route.ts` — GET.
- `app/api/mera/update/route.ts` — POST.

## File sửa
- `lib/http/api-helpers.ts` — `errorResponse` giờ đính `code` (nếu err.code là string) + `latest` (nếu có) vào body. Generic, không phá behavior cũ (Sheet route không set 2 field này → body vẫn `{error}`).
- `.env.example` — thêm `MERA_API_BASE_URL` (mặc định `https://mera-fulfill-api.pamoteam.top/api/v2`) + `MERA_INTERNAL_API_KEY` (rỗng).

## Endpoint 1 — GET /api/mera/resolve
- Query: `?store=<string>&receiptId=<number>`.
- Auth: `requireEmail()` → 401 `{error:"unauthenticated"}` nếu chưa đăng nhập.
- Validate: `receiptId` không finite → 400 `{error:"thiếu receiptId"}`.
- Success 200 — `ResolveMeraOrderResponse`:
  ```json
  { "order": MeraOrderSummary | null, "items": MeraOrderItem[], "reason": "not_found" | "not_configured" | null }
  ```
- **Soft cases (200)**:
  - Thiếu env MERA_* → `{order:null, items:[], reason:"not_configured"}` (KHÔNG throw, flow Sheet vẫn chạy).
  - Không match đơn nào → `{order:null, items:[], reason:"not_found"}`.
- Logic resolve: GET `/orders?q=<receiptId>&include_items=true&page_size=50` → lọc `order_id` endsWith `-<receiptId>` hoặc `=== receiptId`, loại `is_deleted` → nhiều KQ lọc `normalizeStore(store)` (chỉ áp khi còn ≥1) → mới nhất theo `created_at` → items rỗng thì fallback GET `/orders/:orderId/items`.

## Endpoint 2 — POST /api/mera/update
- Body: `MeraUpdateRequest` (discriminated union theo `target`).
- Auth: `requireEmail()` → 401.
- **target="item"**: `{target, itemKey, version, updates: MeraItemUpdates}`.
  - Validate thiếu → 400 `{error:"thiếu tham số item"}`.
  - Success 200 — `MeraUpdateItemResponse`: `{ item: MeraOrderItem, splitApplied?: true }`.
  - `splitApplied:true` khi service tự bật split (Mera trả 400 `ITEM_EDIT_REQUIRES_SPLIT` → POST `/orders/:orderId/split {split:true}` → retry PATCH 1 lần). `orderId` suy từ `itemKey` bỏ đoạn line_item_id cuối.
- **target="order"**: `{target, orderId, version, note}`.
  - Validate thiếu → 400 `{error:"thiếu tham số order"}`.
  - Success 200 — `MeraUpdateOrderResponse`: `{ order: MeraOrderSummary }` (version tăng).
- `target` khác → 400 `{error:"target không hợp lệ"}`.

## Status code lỗi (khớp bảng §4 contract)
| HTTP | body | Nguồn |
|---|---|---|
| 401 | `{error:"unauthenticated"}` | chưa đăng nhập (cả 2 route) |
| 400 | `{error:"..."}` | validate param sai |
| 409 | `{error, code:"version_conflict", latest}` — `MeraConflictBody`; `latest` là **DTO camelCase** (item hoặc order tuỳ target) đã map | version lệch khi PATCH |
| 503 | `{error, code:"mera_not_configured"}` | UPDATE khi thiếu env (hard; khác resolve soft 200) |
| 502 | `{error, code:"mera_unavailable"}` | Mera down/timeout 15s (AbortSignal.timeout) |
| 500 | `{error}` | lỗi khác (Mera trả status lạ) |

> Lưu ý QA: resolve thiếu env = **200 + reason** (soft); update thiếu env = **503 + code** (hard). Hai đường env khác nhau.

## meraFetch (private)
- env `MERA_API_BASE_URL` + `MERA_INTERNAL_API_KEY`; header `Authorization: Bearer <key>` + `X-Actor-Email: <email session>`; `AbortSignal.timeout(15000)`; `cache:"no-store"`.
- KHÔNG throw theo HTTP status (trả `{status, data}`) để caller phân nhánh 400/409; chỉ throw 503 (thiếu env) / 502 (mạng-timeout).

## tsc
- `npx tsc --noEmit`: sạch với file backend của tôi (mera-order.ts, 2 route, api-helpers.ts).
- Còn lỗi ở `components/messenger/SheetItemEditor.tsx` — thuộc frontend-engineer (task F4 đang làm song song), KHÔNG phải file của tôi → bỏ qua.
