# 01 — Hợp đồng kiểu: Ghim tag + cột/mở "Đã xong" trên Dashboard

Ngày: 2026-09-30 · Phạm vi: dora-1. Hai panel nằm ở **`app/page.tsx`** (Dashboard gốc), KHÔNG phải `app/board/page.tsx` — không cần sửa file page nào.

Các panel: `components/dashboard/TagsOverview.tsx`, `components/dashboard/MessageOverview.tsx`.

## 0. Quyết định chốt

| # | Vấn đề | Quyết định |
|---|--------|-----------|
| D1 | Định nghĩa "đã xong" | **Phần bù CHÍNH XÁC của `UNREAD_EXPR`** trong `lib/services/analytics.ts:75`. Unread = `etsy.has_replied == false` (so `$eq`, nên field thiếu/null ≠ false) **VÀ** không có tag `handled`/`approved`. → Đã xong = `{ $or: [ { "etsy.has_replied": { $ne: false } }, { tags: { $in: HANDLED_TAGS } } ] }`. (`$ne:false` khớp cả field thiếu/null/true — đúng như `$eq` trong aggregate coi thiếu là "không unread".) Không định nghĩa lại theo cách khác. |
| D2 | Danh sách tin đã xong | **Lazy**: endpoint mới `GET /api/analytics/completed-conversations`, chỉ gọi khi bấm. KHÔNG thêm mảng completed vào response overview/tags-overview (refetch 10s). |
| D3 | Phạm vi (scope) | Đúng 1 trong 3 query param: `tag=<tên>` \| `untagged=1` \| `shopId=<số nguyên ≥0>`, cộng `from/to/shopIds` y như overview (dùng `parseAnalyticsParams`). Điều kiện phạm vi dùng **đúng cùng match** với phép đếm của dòng tương ứng (xem §1.3). |
| D4 | Giới hạn | `COMPLETED_LIST_LIMIT = 500` (export từ `lib/types/etsy.ts`). Sort **mới nhất trước** (`lastMessageDate:-1, _id:-1` — có index `idx_lastMessageDate_id`) để khi cắt thì giữ tin gần nhất. Response có `total` (không cắt) + `truncated`. UI báo bằng toast khi `truncated`. (Trang /open-multiple tự sort lại theo ts nên thứ tự server chỉ quyết định tập bị cắt.) |
| D5 | Vị trí nút mở tin đã xong | **Biến ô số "Đã xong" thành nút bấm** (pill xanh có icon), ở CẢ 2 bảng. Cột "Hành động" giữ nguyên cho "Mở N" tin chưa trả lời. Lý do: số trên nút = thứ được mở, không nhầm với nút "Mở N" unread; không phình cột Hành động. `completed === 0` → hiện số thường, không phải nút. |
| D6 | Không thêm nút "mở tất cả tin đã xong" ở StatCard "Đã xong" | Không yêu cầu → không làm (StatCard giữ nguyên). |
| D7 | Popup / window.open sau await | Hook mới fetch xong rồi gọi `useOpenMultiple()` hiện có (không sửa hook đó, không sửa /open-multiple). Dựa vào transient user activation của Chrome (~5s) — truy vấn có limit 500 + index, dự kiến < 1s. Chấp nhận rủi ro; KHÔNG làm cơ chế mở-cửa-sổ-trước. |
| D8 | Lưu tag ghim | **Server-side theo email** — collection mới `user_preferences` (DB `meta_local`), 1 doc/email, field `pinnedTags: string[]`. Endpoint `GET` + `PATCH /api/me/pinned-tags`. `/api/me/*` đã được `proxy.ts` bảo vệ bằng session (không cần sửa proxy). |
| D9 | PATCH nguyên tử thay vì PUT cả mảng | Body `{ tag, pinned }` → server `$addToSet` / `$pull`. Lý do: bấm ghim nhanh 2 tag liên tiếp với PUT-cả-mảng có thể về server sai thứ tự và ghi đè mất 1 tag; `$addToSet/$pull` giao hoán giữa các tag khác nhau. |
| D10 | Ghim "No Tag" | **Cho phép**, bằng khoá sentinel `UNTAGGED_PIN_KEY = "__untagged__"` (export từ `lib/types/user-preferences.ts`). Mọi dòng đều có icon ghim — UX nhất quán. Không dùng chuỗi "No Tag" (có thể trùng tag thật do người dùng tự gõ). |
| D11 | Sắp xếp bảng tag | Nhóm ghim lên đầu, nhóm không ghim sau; trong MỖI nhóm giữ sort hiện có `b.unread - a.unread` (sort ổn định, hoà thì giữ thứ tự server). Tag ghim nhưng không có dòng trong kỳ lọc → không hiện (không dựng dòng rỗng). |
| D12 | `TagOverviewRow.completed` | **Thêm field** `completed` tính ở server = `max(total-unread,0)` (giống `ShopOverviewRow.completed`) — frontend KHÔNG tự trừ. |
| D13 | Tên tag lưu ghim | Giá trị DB của tag (`TagOverviewRow.tag`), KHÔNG phải `tagLabel()`. Server **không trim** giá trị (phải khớp y hệt), chỉ từ chối rỗng/toàn khoảng trắng và dài > 100. |

## 1. Type contract (đã ghi vào code)

### 1.1 `lib/types/etsy.ts` (đã sửa)

```ts
export interface TagOverviewRow {
  tag: string;
  untagged: boolean;
  total: number;
  unread: number;
  completed: number;                 // MỚI — max(total-unread,0), server tính
  unreadConversations: UnreadConvItem[];
}

export type CompletedScope =          // MỚI
  | { kind: "tag"; tag: string }
  | { kind: "untagged" }
  | { kind: "shop"; shopId: number }; // 0 = dòng "Chưa xác định shop"

export interface CompletedConversationsResponse {  // MỚI
  items: UnreadConvItem[];  // mới nhất trước, ≤ COMPLETED_LIST_LIMIT
  total: number;            // tổng khớp phạm vi, KHÔNG cắt
  truncated: boolean;       // total > items.length
}

export const COMPLETED_LIST_LIMIT = 500;           // MỚI
```

`UnreadConvItem` **giữ nguyên tên và shape** (`conversationId, name, avatar, lastMessageDate, shop?`) — dùng lại cho item đã xong vì `useOpenMultiple` nhận đúng type này. Không đổi tên.

### 1.2 `lib/types/user-preferences.ts` (file mới, đã tạo)

```ts
export interface UserPreferencesDoc { _id?: ObjectId; email: string; pinnedTags: string[]; updated_at: Date; }
export const UNTAGGED_PIN_KEY = "__untagged__";
export const PINNED_TAG_MAX_LENGTH = 100;
export const PINNED_TAGS_MAX = 100;
export interface PinnedTagsResponse { pinnedTags: string[]; }
export interface PinTagBody { tag: string; pinned: boolean; }
```

### 1.3 Match theo phạm vi (backend PHẢI dùng chung với phép đếm)

| Scope | Điều kiện phạm vi (AND với `buildBaseMatch(opts)` và COMPLETED_MATCH) | Khớp với phép đếm |
|---|---|---|
| `tag` | `{ tags: tag }` | `$unwind: "$tags"` + group theo tag trong `getTagsOverview` |
| `untagged` | `{ $or: [ { tags: { $exists: false } }, { tags: { $size: 0 } } ] }` | `untaggedRow` trong `getTagsOverview` — **tách thành const `UNTAGGED_MATCH` dùng chung cho cả 2** |
| `shop`, shopId > 0 | `{ "user_data.user_id": shopId }` | `getShopCounts` group `_id = user_data.user_id` |
| `shop`, shopId = 0 | `{ "user_data.user_id": { $not: { $gt: 0 } } }` (thiếu/null/0/âm/không phải số) | các nhóm `!isValidShopId(_id)` gộp thành dòng "Chưa xác định shop" |

Edge đã biết (chấp nhận, không xử lý): doc có `tags: null` không thuộc dòng tag nào lẫn No Tag — nhất quán ở cả đếm lẫn danh sách. Doc có tag lặp (`["a","a"]`) bị đếm 2 lần ở aggregate nhưng 1 lần ở danh sách.

## 2. Endpoint

### 2.1 `GET /api/analytics/completed-conversations`

- Query: `from`, `to`, `shopIds` (y hệt overview) + **đúng 1** trong `tag=<string>` | `untagged=1` | `shopId=<int ≥ 0>`.
- 200: `CompletedConversationsResponse`.
  - `items[].shop`: tên shop từ `getShops()` (map `userId → shopName`), fallback `Shop ${id}` khi id > 0; id = 0 → **bỏ field** `shop` (giống `toUnreadItem` hiện tại).
- 400: `{ error: string }` khi 0 hoặc >1 tham số phạm vi, `tag` rỗng/toàn khoảng trắng/dài > 100, `untagged` khác `"1"`, `shopId` không phải số nguyên ≥ 0.
- 401: `{ error: "unauthenticated" }` (auth() như các route analytics khác).
- 500: `{ error: message }`.

### 2.2 `GET /api/me/pinned-tags`

- 200: `PinnedTagsResponse` — chưa có doc → `{ pinnedTags: [] }`.
- 401 `{ error: "unauthenticated" }`, 500 `{ error }`.

### 2.3 `PATCH /api/me/pinned-tags`

- Body: `PinTagBody` `{ tag: string; pinned: boolean }`.
- `pinned: true` → `$addToSet` (upsert theo email); `pinned: false` → `$pull` (KHÔNG upsert). Luôn `$set updated_at`.
- 200: `PinnedTagsResponse` — mảng SAU cập nhật (đọc lại doc; thiếu → `[]`).
- 400 `{ error }`: body không phải JSON object, `tag` không phải string / rỗng sau trim / dài > `PINNED_TAG_MAX_LENGTH`, `pinned` không phải boolean, ghim mới khi đã đủ `PINNED_TAGS_MAX` (bỏ ghim luôn được phép; ghim lại tag đã có không tính là vượt).
- 401, 500 như trên.

## 3. Task backend (`backend-engineer`)

**B1 — `lib/services/analytics.ts`**
- Thêm const `COMPLETED_MATCH` (D1) ngay dưới `UNREAD_EXPR`, comment rõ "phần bù của UNREAD_EXPR — sửa cái này thì sửa cái kia".
- Tách const `UNTAGGED_MATCH` và dùng nó trong `untaggedRow` của `getTagsOverview` (không đổi hành vi).
- `getTagsOverview`: thêm `completed: Math.max(total - unread, 0)` cho cả dòng tag lẫn dòng No Tag.
- Hàm mới `export async function getCompletedConversations(opts: AnalyticsOpts, scope: CompletedScope): Promise<CompletedConversationsResponse>`:
  - filter = `{ $and: [buildBaseMatch(opts), scopeMatch(scope) (§1.3), COMPLETED_MATCH] }`.
  - Song song: `find(filter, { projection: UNREAD_PROJECTION }).sort({ lastMessageDate: -1, _id: -1 }).limit(COMPLETED_LIST_LIMIT)` + `countDocuments(filter)` + `getShops().catch(() => [])`.
  - Map qua `mapConversation` → `toUnreadItem(c, shopName)` (shopName theo §2.1).
  - `truncated = total > items.length`.
- Không đổi `getMessageOverview`, `ShopOverviewRow`, `fetchUnreadConversations`.

**B2 — `lib/services/analytics-params.ts`**: hàm mới `parseCompletedScope(req: NextRequest): CompletedScope | { error: string }` (hoặc throw lỗi 400 riêng — tuỳ, miễn route trả 400 đúng §2.1).

**B3 — `app/api/analytics/completed-conversations/route.ts`** (mới): khuôn giống `app/api/analytics/tags-overview/route.ts` (auth → parse → service → json; log `[GET /api/analytics/completed-conversations]`).

**B4 — `lib/db/collections.ts`**: `getUserPreferencesCollection(): Promise<Collection<UserPreferencesDoc>>` → collection `"user_preferences"` trên `getDb()` (meta_local).
**`lib/db/indexes.ts`**: `USER_PREFERENCE_INDEXES = [{ keys: { email: 1 }, options: { name: "uq_email", unique: true } }]` + gọi trong `ensureIndexes`.

**B5 — `lib/services/user-preferences.ts`** (mới), khuôn giống `lib/services/message-template.ts` (lớp lỗi có `status` để route map 400):
- `getPinnedTags(email: string): Promise<string[]>`
- `setTagPinned(email: string, body: unknown): Promise<string[]>` — validate theo §2.3, rồi `$addToSet`/`$pull`, trả mảng sau cập nhật.

**B6 — `app/api/me/pinned-tags/route.ts`** (mới): `GET`, `PATCH`; email từ `auth()` → `session.user.email`; trả `PinnedTagsResponse`.

## 4. Task frontend (`frontend-engineer`)

**F1 — `lib/hooks/useAnalytics.ts`**
- `export function completedConversationsKey(filters: AnalyticsFilters, scope: CompletedScope)` → `["analytics", "completed", filters, scope] as const`.
- `export function fetchCompletedConversations(filters, scope): Promise<CompletedConversationsResponse>` — dùng `buildParams(filters)` rồi thêm đúng 1 param: `tag` / `untagged=1` / `shopId`. `!res.ok` → throw. KHÔNG phải `useQuery` (lazy).

**F2 — `lib/hooks/usePinnedTags.ts`** (mới)
- `usePinnedTags()` — `useQuery<PinnedTagsResponse>` key `["me", "pinned-tags"]`, `GET /api/me/pinned-tags`, `staleTime: 5 * 60_000`, không `refetchInterval`.
- `useTogglePinnedTag()` — `useMutation` với `mutationKey: ["me", "pinned-tags"]`, `PATCH` body `PinTagBody`:
  - `onMutate`: `cancelQueries` key trên, snapshot, `setQueryData` thêm/bớt tag (optimistic).
  - `onError`: rollback snapshot + `toast.error("Không lưu được tag ghim")` (sonner).
  - `onSettled`: chỉ `invalidateQueries(["me","pinned-tags"])` khi `queryClient.isMutating({ mutationKey: ["me","pinned-tags"] }) === 1` (tránh response của lần bấm trước đè optimistic của lần bấm sau).

**F3 — `components/dashboard/useOpenCompleted.ts`** (mới)
- `useOpenCompleted(filters: AnalyticsFilters)` trả `{ openCompleted(scope: CompletedScope, shopName?: string): Promise<void>; pendingKey: string | null }`.
- `queryClient.fetchQuery({ queryKey: completedConversationsKey(filters, scope), queryFn: () => fetchCompletedConversations(filters, scope), staleTime: 8_000 })`.
- Nếu truyền `shopName` → ghi đè `shop` của mọi item (bảng shop làm y như nút unread hiện tại: `{ ...c, shop: s.shopName }`).
- `items.length === 0` → `toast.info("Không có tin đã xong trong phạm vi này")`, không mở.
- Ngược lại gọi `openMultiple(items)` (hook `useOpenMultiple` hiện có, KHÔNG sửa); nếu `truncated` → `toast.info(\`Chỉ mở ${items.length}/${total} tin đã xong mới nhất\`)`.
- Lỗi fetch → `toast.error("Không tải được danh sách tin đã xong")`.
- `pendingKey` = chuỗi định danh scope đang tải (vd `tag:<tên>`, `untagged`, `shop:<id>`); đang pending thì bỏ qua click trùng.

**F4 — `components/dashboard/TagsOverview.tsx`**
- Cột: `Tag | Tổng | Chưa trả lời | Đã xong | Hành động` (thứ tự giống MessageOverview).
- Ô "Đã xong": `t.completed > 0` → `<button>` pill (`bg-success-soft text-success`, icon `ExternalLink` h-3 w-3, số `t.completed`, `title="Mở tin đã xong"`), pending → icon `Loader2 animate-spin` + `disabled`. Scope: `t.untagged ? { kind: "untagged" } : { kind: "tag", tag: t.tag }`. `t.completed === 0` → số `0` thường (text-muted-foreground).
- Ghim: nút icon trong ô Tag, trước tên tag — `Pin` (đã ghim: `text-primary`, fill) / `Pin` muted (chưa ghim), luôn hiển thị, `aria-label`/`title` "Ghim tag" | "Bỏ ghim tag". Khoá ghim: `t.untagged ? UNTAGGED_PIN_KEY : t.tag`. Bấm → `toggle.mutate({ tag: key, pinned: !isPinned })`.
- Sort (D11): `pinned` desc rồi `unread` desc. Khi `usePinnedTags` đang tải/lỗi → coi như `[]`.
- Không đổi: StatCard, nút "Mở tin" tổng, cột Hành động "Mở N".

**F5 — `components/dashboard/MessageOverview.tsx`**
- Ô "Đã xong" hiện là text `s.completed` → đổi thành pill button như F4 khi `s.completed > 0`, scope `{ kind: "shop", shopId: s.shopId }`, truyền `shopName = s.shopName`. Không thêm cột/nút khác. Không ghim ở panel này.

## 5. Bảng seam cho QA (`qa-integration`)

| # | Luồng | Service trả | API | Hook / key | Component đọc |
|---|------|------------|-----|-----------|---------------|
| S1 | Cột Đã xong (tag) | `getTagsOverview` → `TagOverviewRow.completed` = max(total-unread,0) | `GET /api/analytics/tags-overview` (không đổi query) | `useTagsOverview` · `["analytics","tags",filters]` | `t.completed` trong TagsOverview (không tự tính total-unread) |
| S2 | Cột Đã xong (shop) | `ShopOverviewRow.completed` (đã có) | `GET /api/analytics/overview` | `useMessageOverview` · `["analytics","overview",filters]` | `s.completed` |
| S3 | Mở tin đã xong | `getCompletedConversations(opts, scope)` → `CompletedConversationsResponse` | `GET /api/analytics/completed-conversations?from&to&shopIds` + `tag=` \| `untagged=1` \| `shopId=` | `fetchCompletedConversations` · `["analytics","completed",filters,scope]` qua `fetchQuery` | `useOpenCompleted` → `openMultiple(items)`; `total`, `truncated` cho toast |
| S4 | Số trên nút == số mở ra | COMPLETED_MATCH là phần bù của UNREAD_EXPR; scope match §1.3 trùng match đếm | — | — | Với dữ liệu tĩnh: `row.completed === response.total`; `items.length === min(total, 500)` |
| S5 | Tên shop trong danh sách mở | `items[].shop` từ getShops / `Shop ${id}` / bỏ khi id=0 | — | — | Bảng shop ghi đè `shop = s.shopName` (kể cả "Chưa xác định shop"); bảng tag dùng nguyên `shop` từ API |
| S6 | Scope ↔ query param | `CompletedScope.kind` "tag"/"untagged"/"shop" | `tag` / `untagged=1` / `shopId` (đúng 1) | F1 build param | F4: untagged row → `{kind:"untagged"}` (KHÔNG gửi `tag=No Tag`); F5: shopId=0 hợp lệ |
| S7 | Đọc ghim | `getPinnedTags(email)` → `string[]` | `GET /api/me/pinned-tags` → `{ pinnedTags }` | `usePinnedTags` · `["me","pinned-tags"]` | `data.pinnedTags` (không phải `data.tags`/`data.items`) |
| S8 | Ghim/bỏ ghim | `setTagPinned` `$addToSet`/`$pull` | `PATCH /api/me/pinned-tags` body `{ tag, pinned }` → `{ pinnedTags }` | `useTogglePinnedTag` · mutationKey `["me","pinned-tags"]`, optimistic | Khoá = `t.tag` hoặc `UNTAGGED_PIN_KEY` ("__untagged__"); KHÔNG dùng `tagLabel(t.tag)` |
| S9 | Sort | — | — | — | Ghim trước; trong nhóm `unread` desc; tag ghim vắng mặt trong kỳ → không có dòng |
| S10 | Auth | — | 401 `{ error: "unauthenticated" }` cả 3 route mới/đổi | — | — |

Điểm QA nên kiểm thêm: `has_replied` thiếu/null → tính là đã xong ở CẢ đếm lẫn danh sách; hội thoại unread nhưng có tag `handled` → đã xong; filter `shopIds` kết hợp `shopId` ngoài tập → `total: 0, items: []`; rapid double-toggle 2 tag khác nhau → cả 2 được lưu.
