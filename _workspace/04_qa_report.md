# 04 — QA tích hợp: Ghim tag + cột/nút "Đã xong" (Dashboard)

Ngày: 2026-09-30 · Đầu vào: `01_architect_contract.md` (S1–S10), `02_backend_changes.md`, `03_frontend_changes.md`.
Phương pháp: skill `dora-integration-qa` — so khớp 4 tầng service → route → hook → component, kiểm bằng thực thi.

## Kết luận

**Không có finding chặn merge. Không sửa code.** 0 "nên sửa", 9 "lưu ý" (edge case / rủi ro đã chấp nhận).

| Kiểm | Kết quả |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run build` (Next 16.2.6) | exit 0 — có route `ƒ /api/analytics/completed-conversations`, `ƒ /api/me/pinned-tags`. Lưu ý: `next.config` có `typescript.ignoreBuildErrors: true` nên build KHÔNG typecheck, tsc ở trên mới là cổng kiểm type. Dev server :3000 đang chạy, build dùng `.next/` còn dev dùng `.next/dev/` nên không đè nhau. |
| eslint | không chạy được: repo không có `eslint.config.*` (ESLint 10) — có từ trước, không liên quan tính năng này |
| Round-trip param (thực thi) | transpile `lib/hooks/useAnalytics.ts` + `lib/services/analytics-params.ts`, mock `fetch`: 12/12 tổ hợp (2 filters × 6 scope, gồm tag có `& = ? # %`, tag có khoảng trắng đầu/cuối, `shopId=0`, shopId 11 chữ số) → URL hook tạo ra được `parseCompletedScope` + `parseAnalyticsParams` parse lại đúng y hệt. 9 ca 400 trả đúng thông báo. |
| Optimistic ghim (thực thi) | mô phỏng 2 `MutationObserver` TanStack v5 thật, cùng callbacks: optimistic `["x","__untagged__"]`; `onSettled` thấy `isMutating` = 2 rồi 1 → chỉ invalidate 1 lần ở lần cuối; server giữ cả 2 tag. |
| Gọi endpoint (dev server, không cookie) | cả 3 route → `307 /login` (proxy chặn trước route) — giống hệt `tags-overview` có sẵn. Không có session nên không kiểm được shape JSON thật; không chạy query trên DB. |

## So khớp 4 tầng theo seam

| Seam | Service (1) | Route (2) | Hook (3) | Component (4) | KQ |
|---|---|---|---|---|---|
| S1 | `analytics.ts:483,495` `completed: Math.max(total-unread,0)` cả dòng tag lẫn No Tag | tags-overview không đổi | `useTagsOverview` key `["analytics","tags",filters]` → `TagsOverviewResponse` (type chung `lib/types/etsy.ts:716`) | `TagsOverview.tsx:139,152` đọc `t.completed`, không tự tính | OK |
| S2 | `ShopOverviewRow.completed` có sẵn (`analytics.ts:230,252`) | overview không đổi | key `["analytics","overview",filters]` | `MessageOverview.tsx:124,137` `s.completed` | OK |
| S3 | `getCompletedConversations` trả `{items,total,truncated}` đúng `CompletedConversationsResponse` | route đọc scope qua `parseCompletedScope`, from/to/shopIds qua `parseAnalyticsParams`; 400/401/500 đúng §2.1 | `fetchCompletedConversations` cast `CompletedConversationsResponse` (import từ `lib/types`, không nhân bản); key `["analytics","completed",filters,scope]` — có đủ filters + scope | `useOpenCompleted.ts:45-52` đọc `data.items/total/truncated` | OK |
| S4 | xem §S4 bên dưới | — | — | — | OK |
| S5 | `shop` = getShops → `Shop <id>` (id>0) → bỏ field | — | — | shop: ghi đè `shopName` (`MessageOverview.tsx:127`, `useOpenCompleted.ts:44-45`); tag: giữ `shop` từ API (`TagsOverview.tsx:142` không truyền shopName) | OK |
| S6 | `CompletedScope` 3 kind | `tag` / `untagged` / `shopId`, đúng 1 | set đúng 1 key (`useAnalytics.ts` F1) | `TagsOverview.tsx:24-26` untagged → `{kind:"untagged"}` (không gửi `tag=No Tag`); `MessageOverview.tsx:99` shopId=0 hợp lệ | OK (đã chạy round-trip) |
| S7 | `getPinnedTags` → `string[]`, đọc phòng thủ | GET → `{ pinnedTags }` | `usePinnedTags` key `["me","pinned-tags"]`, `PinnedTagsResponse` | `TagsOverview.tsx:37` `data?.pinnedTags` | OK |
| S8 | `$addToSet` (upsert) / `$pull` (không upsert), không trim, `meta_local.user_preferences` (`collections.ts` dùng `getDb()`), index `uq_email` | PATCH body `{tag,pinned}` → `{ pinnedTags }`, `PreferenceError` → 400 | mutationKey `["me","pinned-tags"]`, body `PinTagBody` | khoá `t.untagged ? UNTAGGED_PIN_KEY : t.tag` (`TagsOverview.tsx:20-22,108`) — không dùng `tagLabel` | OK |
| S9 | — | — | — | `TagsOverview.tsx:43-52` ghim trước, trong nhóm `unread` desc; chỉ sort `data.tags` nên tag ghim vắng mặt không sinh dòng | OK |
| S10 | — | cả 3 route có nhánh 401 `{error:"unauthenticated"}` | — | — | OK (xem L5) |

queryKey mới không đụng key cũ: `["analytics","completed",…]` khác mọi key analytics hiện có; không có chỗ nào `invalidateQueries` theo tiền tố `["analytics"]`; `["me",…]` là key duy nhất bắt đầu bằng `"me"`.

### S4 — số trên nút == số mở ra

**Phần bù.** `UNREAD_EXPR` (`analytics.ts:78-88`) = `$eq(has_replied,false)` AND `|ifNull(tags,[]) ∩ HANDLED| = 0`. Phủ định theo De Morgan = `has_replied ≠ false` OR `tags ∩ HANDLED ≠ ∅` = `COMPLETED_MATCH` (`analytics.ts:96-98`). Kiểm từng trường hợp:

| has_replied | tags | UNREAD_EXPR | COMPLETED_MATCH |
|---|---|---|---|
| false | thiếu / null / [] / ["x"] | 1 | không khớp (`$ne:false` sai, `$in` sai) |
| false | ["handled"] / ["approved","x"] | 0 | khớp (`$in`) |
| true / null / thiếu / thiếu cả `etsy` | bất kỳ | 0 (`$eq` với missing/null ≠ false) | khớp (`$ne:false` khớp missing/null) |
| 0 (số) | bất kỳ không handled | 0 (khác kiểu BSON) | khớp (so sánh query cũng phân biệt kiểu) |

→ Phần bù chính xác.

**Match theo scope trùng match đếm** (cùng `buildBaseMatch(opts)`, cùng `parseAnalyticsParams`, frontend dùng cùng `filters` object ở `app/page.tsx:24-27` cho cả count và list → from/to/shopIds giống nhau):
- tag: `{ tags: tag }` ⇔ `$unwind:"$tags"` + group theo phần tử (`analytics.ts:427-441`). Khớp (trừ tag lặp, contract đã chấp nhận).
- untagged: dùng chung const `UNTAGGED_MATCH` cho đếm (`analytics.ts:445`) và list. Khớp.
- shop>0: `{ "user_data.user_id": id }` ⇔ group `_id` + `isValidShopId`. Khớp.
- shop=0: `{ $not: { $gt: 0 } }` ⇔ gộp mọi nhóm `!isValidShopId` (thiếu/null/0/âm/chuỗi/NaN). `$gt:0` chỉ khớp kiểu số nên chuỗi `"123"` rơi vào dòng 0 ở cả hai phía. Kết hợp `shopIds` (luôn dương) → tập rỗng ở cả hai phía. Khớp.

## Finding

| # | Mức | Seam / tầng | Bằng chứng | Mô tả | Gợi ý | Đã sửa |
|---|---|---|---|---|---|---|
| L1 | lưu ý | S3 / 4 | `components/dashboard/useOpenCompleted.ts:38-50` → `useOpenMultiple.ts:29` | `window.open` chạy sau `await fetchQuery`. Chrome/Firefox cho ~5s transient activation (truy vấn limit 500 + index, dự kiến < 1s; cache 8s thì trả ngay). Safari chặt hơn, có thể chặn. Nếu bị chặn thì **im lặng**: danh sách đã stage vào localStorage nhưng không mở tab, không có toast. Contract D7 đã chấp nhận. | Nếu cần sau này: `useOpenMultiple` trả kết quả `window.open` (null → toast "Trình duyệt chặn popup"). Ngoài contract, không làm. | Không |
| L2 | lưu ý | S6/S8 / 2 | `lib/services/analytics-params.ts:44-47`, `lib/services/user-preferences.ts:42-47` | Tag thật trong DB dài > 100 ký tự hoặc toàn khoảng trắng → nút "Đã xong" trả 400 (toast "Không tải được…") và ghim trả 400 (toast "Không lưu được tag ghim"). Route machine giới hạn tag 50 ký tự (`app/api/machine/conversations/[conversation_id]/tags/route.ts:11`); đường ghi tag khác chưa thấy giới hạn. Xác suất thấp. | Để nguyên theo contract; nếu gặp thì nâng trần. | Không |
| L3 | lưu ý | S4 / 1 | `analytics.ts:427-441` so với `scopeMatch` | Edge contract đã chấp nhận: tag lặp `["a","a"]` được đếm 2 lần nhưng list chỉ có 1; `tags: null` không thuộc dòng nào. Thêm: phần tử tag không phải string (vd số 5) → `t.tag` là number, frontend gửi `"5"`, `{tags:"5"}` không khớp → list 0 trong khi nút hiện > 0. Cần dữ liệu bẩn mới xảy ra. | Không cần xử lý. | Không |
| L4 | lưu ý | S5 / 1 | `analytics.ts:465` (`c.shopUserId ?`) và `getCompletedConversations` (`c.shopUserId > 0 ?`) | Với `user_id` âm: item unread ở bảng tag có `shop: "Shop -5"`, item đã xong thì không có `shop`. Chỉ lệch hiển thị, contract (§2.1) yêu cầu đúng cách hiện tại. | Không cần. | Không |
| L5 | lưu ý | S10 / 2 | `proxy.ts` (redirect khi `!isLoggedIn`); curl → `307 /login` | Nhánh 401 trong 3 route không tới được từ trình duyệt vì proxy redirect trước. `fetch` đi theo redirect → HTML 200 → `res.json()` ném lỗi → toast lỗi. Giống mọi route `/api/*` có từ trước. | Không cần. | Không |
| L6 | lưu ý | S8 / 3 | `lib/hooks/usePinnedTags.ts:55-57` | A lỗi khi B đang chạy → rollback về snapshot của A (trước B) nên optimistic của B mất tạm thời, tự khôi phục khi B settle và invalidate. Đây là pattern chuẩn của TanStack. | Không cần. | Không |
| L7 | lưu ý | S8 / 1 | `user-preferences.ts:57,73` | Bấm ghim rồi bỏ ghim **cùng 1 tag** rất nhanh: `$addToSet`/`$pull` không giao hoán khi cùng tag; nếu 2 request tới server sai thứ tự thì sau lần invalidate cuối UI sẽ đổi lại đúng trạng thái trên server (có thể khác ý người dùng). Với 2 tag khác nhau thì không lỗi (đã chạy mô phỏng). | Không cần. | Không |
| L8 | lưu ý | S3 / 4 | `useOpenCompleted.ts:34-36,57-60` | Bấm 2 scope khác nhau liên tiếp: cả 2 đều mở, cùng cửa sổ `dora-open-multiple`, request nào về sau thì danh sách đó thắng; spinner chỉ hiện ở scope bấm sau. Frontend đã ghi nhận. | Không cần. | Không |
| L9 | lưu ý | phạm vi | `git status` | Ngoài contract chỉ có artifact sinh tự động: `tsconfig.tsbuildinfo` (M). `next-env.d.ts` lúc bắt đầu là M, sau khi tôi chạy `npm run build` thì Next ghi lại bản giống bản đã commit nên không còn trong diff. Thư mục chưa track `_workspace_prev_20260917_orders-image/` là bản lưu harness trước, không phải code. Không có file code nào ngoài contract bị đổi. | Không commit `tsconfig.tsbuildinfo` hay `_workspace_prev_*` cùng tính năng. | Không |

Ghi chú từ backend, không tính là finding: `find` và `countDocuments` chạy song song nên không cùng snapshot; `total` có thể lệch 1–2 so với `items.length` (chỉ ảnh hưởng toast truncated). Trần `PINNED_TAGS_MAX` là đọc-rồi-ghi.
