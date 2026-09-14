# 01 — Architect Contract: Bộ lọc khoảng ngày cho Board + `total` thật từ server

Ngày: 2026-09-14 · Nhánh: `fix/mera-connection` · Architect: feature-architect

## 0. Mục tiêu & phạm vi

Hai bug độc lập, sửa trong cùng một lượt vì dùng chung một mặt cắt API:

1. **Lệch số với Dashboard.** Board quét all-time, Dashboard mặc định preset `7days`
   (`app/page.tsx` → `lib/dashboard/date-presets.ts` → `lib/services/analytics.ts`
   `buildBaseMatch()` push `lastMessageDate: {$gte, $lte}`). Cùng shop CusGiftsCo +
   "chưa trả lời": 7 ngày = **51**, all-time = **94** (đã xác minh trên production).
2. **Mẫu số sai.** `app/api/conversations/route.ts` không trả tổng, nên
   `app/board/page.tsx` truyền `total={filtered.length}` = "số item đã tải về client".
   Board tự nạp trang tới khi đủ page size rồi dừng → mẫu số đóng băng ở đó.

Không đổi: cơ chế cursor pagination, `mapConversation()`, shape `ConversationListItem`.

---

## 1. TYPE CONTRACT (đã đặt vào `lib/types/etsy.ts` — nguồn sự thật duy nhất)

File đã sửa: **`D:\Pamo\dora-1\lib\types\etsy.ts`**. Backend/Frontend **đọc file này**, không tự định nghĩa lại.

### 1.1 `ConversationFilters` (dòng ~157)

```ts
/** Bộ lọc danh sách hội thoại. */
export interface ConversationFilters {
  search: string;
  notReplied: boolean;
  hasOrder: boolean;
  orderHelp: boolean;
  hasNote: boolean;
  shopIds: number[];
  /** Lọc theo tag (khớp bất kỳ tag nào trong danh sách). */
  tags: string[];
  /** Lọc theo trạng thái đơn trên sheet (khớp bất kỳ status nào). */
  sheetStatuses: string[];
  /** Thứ tự sắp xếp theo thời gian tin nhắn cuối. "asc" = cũ nhất trước. */
  sort: "asc" | "desc";
  /**
   * Preset thời gian đang chọn — CHỈ phục vụ UI (highlight nút, nhãn lịch).
   * KHÔNG serialize thành query param: from/to đã quyết định hoàn toàn kết quả.
   */
  datePreset: PresetKey;
  /**
   * Mốc đầu khoảng lọc `lastMessageDate` (unix giây). null = không giới hạn.
   * BẮT BUỘC là giá trị đã SNAPSHOT (tính 1 lần trong event handler / initializer
   * của useState), KHÔNG được tính lại trong thân render: rangeForPreset() đọc
   * Date.now() nên nếu tính mỗi lần render thì queryKey đổi liên tục → refetch vô hạn.
   */
  from: number | null;
  /** Mốc cuối khoảng lọc `lastMessageDate` (unix giây). null = không giới hạn. Cùng quy tắc snapshot như `from`. */
  to: number | null;
  /**
   * Chỉ lấy hội thoại có `etsy.message_count` < giá trị này. null = không lọc.
   * Lọc ở SERVER (không phải client) để `total` khớp đúng tập người dùng thấy.
   */
  maxMessages: number | null;
  /**
   * Chỉ lấy hội thoại đã chờ ≥ N giờ (lastMessageDate <= now - N*3600). null = không lọc.
   * Gửi nguyên N (số nguyên, ổn định) — server tự tính mốc cutoff theo giờ server,
   * nhờ vậy KHÔNG có giá trị phụ thuộc Date.now() nằm trong queryKey.
   */
  waitingHours: number | null;
}

/**
 * Baseline bộ lọc hội thoại: rỗng + All Time. Dùng để spread rồi override, nhờ đó
 * thêm field mới vào ConversationFilters không làm hỏng các nơi dựng filter.
 * KHÔNG chứa giá trị phụ thuộc thời gian → an toàn khi đặt ở module scope.
 */
export const DEFAULT_CONVERSATION_FILTERS: ConversationFilters = {
  search: "", notReplied: false, hasOrder: false, orderHelp: false, hasNote: false,
  shopIds: [], tags: [], sheetStatuses: [], sort: "desc",
  datePreset: "all", from: null, to: null, maxMessages: null, waitingHours: null,
};
```

Thêm import ở đầu file (type-only, không tạo phụ thuộc runtime):

```ts
import type { PresetKey } from "@/lib/dashboard/date-presets";
```

### 1.2 `ConversationListResponse`

```ts
/** Phản hồi list có cursor để load tiếp. */
export interface ConversationListResponse {
  items: ConversationListItem[];
  nextCursor: string | null;
  /**
   * Tổng số hội thoại khớp BỘ LỌC (không gồm clause cursor) — mẫu số thật cho UI.
   * CHỈ được tính ở trang ĐẦU (request không có `cursor`); các trang sau trả `null`
   * để không đánh countDocuments lặp lại với cùng một filter.
   * → Consumer PHẢI đọc total ở trang đầu: `data.pages[0]?.total`.
   */
  total: number | null;
}
```

### 1.3 `ConversationFilterOpts` (backend viết, trong `lib/services/conversation-read.ts`)

```ts
export interface ConversationFilterOpts {
  cursor?: string | null;
  limit?: number;
  search?: string;
  notReplied?: boolean;
  hasOrder?: boolean;
  orderHelp?: boolean;
  hasNote?: boolean;
  shopIds?: number[];
  tags?: string[];
  sheetStatuses?: string[];
  sort?: "asc" | "desc";
  /** Khoảng lastMessageDate (unix giây). null/undefined = không giới hạn. */
  from?: number | null;
  to?: number | null;
  /** etsy.message_count < maxMessages. */
  maxMessages?: number | null;
  /** Đã chờ ≥ N giờ; cutoff tính bằng GIỜ SERVER tại thời điểm request. */
  waitingHours?: number | null;
}
```

> Tất cả field mới đều **optional** ở tầng service/route (backwards-compatible cho
> caller khác + extension), nhưng **required** ở `ConversationFilters` (tầng UI) để
> TypeScript buộc mọi nơi dựng filter phải quyết định rõ — dùng
> `DEFAULT_CONVERSATION_FILTERS` để khỏi liệt kê tay.

---

## 2. BẢNG SEAM (đầu vào cho qa-integration)

| Field | Service (`lib/services/conversation-read.ts`) | API json (`app/api/conversations/route.ts`) | Hook (`lib/hooks/useConversations.ts`) | Component đọc |
|---|---|---|---|---|
| **`total`** | `countDocuments(filterNoCursor)` khi `opts.cursor == null`, ngược lại `null` → trả trong `ConversationListResponse.total` | `NextResponse.json(data)` → `{ items, nextCursor, total }`; `total` là `number \| null` | `res.json()` kiểu `ConversationListResponse`; hook expose `total = query.data?.pages[0]?.total ?? null` | `app/board/page.tsx` truyền `total={total}`; `BoardToolbar` prop `total: number \| null`, render `/ {total}` khi `total != null` |
| **`from`** | `opts.from?: number \| null` → clause `{ lastMessageDate: { $gte: from } }` (chỉ khi là số finite) | parse `sp.get("from")` → `numOrNull()` → `from` | `if (filters.from != null) params.set("from", String(filters.from))` | `ConversationFilters.from` (snapshot từ `rangeForPreset`) — date filter đọc để render nhãn/lịch |
| **`to`** | `opts.to?: number \| null` → clause `{ lastMessageDate: { $lte: to } }` | parse `sp.get("to")` → `numOrNull()` → `to` | `if (filters.to != null) params.set("to", String(filters.to))` | `ConversationFilters.to` |
| **`datePreset`** | *(không tồn tại ở backend)* | *(không tồn tại ở backend)* | **KHÔNG serialize** — chỉ nằm trong `queryKey` | date filter prop `presetKey` (highlight nút) |
| **`maxMessages`** | `opts.maxMessages` → clause `{ $or: [{ "etsy.message_count": { $lt: n } }, { "etsy.message_count": null }] }` | parse `sp.get("maxMessages")` → `numOrNull()` | `if (filters.maxMessages != null) params.set("maxMessages", ...)` | `BoardToolbar` input "Dưới N tin nhắn" (prop `maxMessages` giữ signature `number \| null`) |
| **`waitingHours`** | `opts.waitingHours` → `cutoff = nowSec() - n*3600` → clause `{ lastMessageDate: { $lte: cutoff } }` (clause RIÊNG, không merge với clause from/to) | parse `sp.get("waitingHours")` → `numOrNull()` | `if (filters.waitingHours != null) params.set("waitingHours", ...)` | `BoardToolbar` input "Chờ > N giờ" |
| `nextCursor` | không đổi: `encodeCursor({d,id})` từ item cuối | không đổi | `getNextPageParam: (last) => last.nextCursor` | không đọc trực tiếp |
| `items[]` | `mapConversation()` → `ConversationListItem[]` | không đổi | `pages.flatMap(p => p.items)` | `BoardCell conv={c}` |

**Bất biến phải giữ (QA kiểm):**

- Cùng một `ConversationListResponse` được dùng ở CẢ 4 tầng — không có cast trung gian nào khác.
- `total` KHÔNG bao giờ chịu ảnh hưởng của `cursor`/`limit`.
- `datePreset` không bao giờ xuất hiện trong URL query.
- Board page và messenger sidebar dùng CÙNG hook, cùng type; messenger phải là All Time (`from/to = null`) để không đổi hành vi hiện tại.

---

## 3. TASK BACKEND (`backend-engineer`)

**B1 — `lib/services/conversation-read.ts`: mở rộng `ConversationFilterOpts`**
Thêm 4 field optional đúng như §1.3.

**B2 — `lib/services/conversation-read.ts`: push clause `lastMessageDate` cho from/to**
Trong `getConversations()`, cùng style các clause hiện có (push vào mảng `clauses`, kết hợp `$and`):

```ts
// Khoảng thời gian tin nhắn cuối — CÙNG semantics buildBaseMatch() của analytics.ts
// (lastMessageDate $gte from / $lte to) để Board và Dashboard ra cùng một con số.
const dateRange: Record<string, number> = {};
if (typeof opts.from === "number" && Number.isFinite(opts.from)) dateRange.$gte = opts.from;
if (typeof opts.to === "number" && Number.isFinite(opts.to)) dateRange.$lte = opts.to;
if (Object.keys(dateRange).length > 0) clauses.push({ lastMessageDate: dateRange });
```

Đặt clause này ở nhóm filter (sau `search`) — **không** đặt trong nhánh cursor.

**B3 — `lib/services/conversation-read.ts`: push `maxMessages` + `waitingHours` xuống Mongo**

```ts
// Dưới N tin nhắn. Nhánh `null` khớp cả doc THIẾU field — mirror asNumber(...) ?? 0 ở client.
if (typeof opts.maxMessages === "number" && opts.maxMessages > 0) {
  clauses.push({
    $or: [
      { "etsy.message_count": { $lt: opts.maxMessages } },
      { "etsy.message_count": null },
    ],
  });
}
// Chờ ≥ N giờ. Cutoff tính theo giờ SERVER tại request → client chỉ gửi N (ổn định).
if (typeof opts.waitingHours === "number" && opts.waitingHours > 0) {
  const cutoff = Math.floor(Date.now() / 1000) - opts.waitingHours * 3600;
  clauses.push({ lastMessageDate: { $lte: cutoff } });
}
```

⚠️ **Bắt buộc**: đây là clause RIÊNG trong mảng `clauses`. Không được gộp vào cùng object
với clause from/to (sẽ ghi đè key `lastMessageDate`). Cả 3 clause trên `lastMessageDate`
(cursor + range + cutoff) cùng tồn tại dưới `$and` là hợp lệ.

**B4 — `lib/services/conversation-read.ts`: tính `total`**
Tách filter thành 2 phần để `total` KHÔNG chịu clause cursor:

```ts
// clauses hiện tại KHÔNG push cursor nữa — tách riêng:
const filterNoCursor: Filter<ConversationDoc> =
  clauses.length > 0 ? ({ $and: clauses } as Filter<ConversationDoc>) : {};
const filter: Filter<ConversationDoc> = cursorClause
  ? ({ $and: [...clauses, cursorClause] } as Filter<ConversationDoc>)
  : filterNoCursor;

// Count CHỈ ở trang đầu (cursor == null) — chạy song song với find để không cộng latency.
const [docs, total] = await Promise.all([
  coll.find(filter, { projection: LIST_PROJECTION })
      .sort({ lastMessageDate: sortDir, _id: sortDir })
      .limit(limit + 1)
      .toArray() as Promise<WithId<ConversationDoc>[]>,
  cursorClause ? Promise.resolve<number | null>(null) : coll.countDocuments(filterNoCursor),
]);
// ...
return { items: page.map(mapConversation), nextCursor, total };
```

Gợi ý refactor tối thiểu: đổi khối `if (cursor) clauses.push({...})` hiện tại thành
`const cursorClause = cursor ? { $or: [...] } : null;`.

**B5 — `app/api/conversations/route.ts`: parse query param mới**

```ts
const numOrNull = (raw: string | null): number | null => {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};
// ...trong getConversations({ ... })
from: numOrNull(sp.get("from")),
to: numOrNull(sp.get("to")),
maxMessages: numOrNull(sp.get("maxMessages")),
waitingHours: numOrNull(sp.get("waitingHours")),
```

Cập nhật comment đầu file: `// GET /api/conversations?cursor=&limit=&search=&from=&to=&maxMessages=&waitingHours=`.
Param thiếu ⇒ `null` ⇒ không lọc (giữ hành vi cũ cho mọi caller chưa cập nhật).

**B6 — (TUỲ CHỌN, chỉ làm nếu đo thấy chậm) `lib/db/indexes.ts`**
Board luôn lọc shop + khoảng ngày, nhưng `CONVERSATION_INDEXES` chỉ có
`idx_lastMessageDate_id`; `user_data.user_id` và `etsy.has_replied` chưa có index.
Cân nhắc thêm `{ "user_data.user_id": 1, lastMessageDate: -1 }`. **Không tự thêm** nếu
chưa đo — Dashboard đã chạy cùng bộ predicate này ở mức aggregation mà vẫn chấp nhận được.

**Không được làm:** đổi `mapConversation`, đổi `LIST_PROJECTION` (đã có `etsy.message_count`,
`lastMessageDate` — đủ cho mọi clause mới), đổi logic cursor/sort.

---

## 4. TASK FRONTEND (`frontend-engineer`)

**F1 — `lib/hooks/useConversations.ts`: serialize param mới + expose `total`**

```ts
if (filters.from != null) params.set("from", String(filters.from));
if (filters.to != null) params.set("to", String(filters.to));
if (filters.maxMessages != null) params.set("maxMessages", String(filters.maxMessages));
if (filters.waitingHours != null) params.set("waitingHours", String(filters.waitingHours));
// LƯU Ý: KHÔNG set filters.datePreset — nó là state UI.
```

```ts
const items: ConversationListItem[] = query.data?.pages.flatMap((p) => p.items) ?? [];
// total chỉ được tính ở trang đầu (xem ConversationListResponse.total).
const total: number | null = query.data?.pages[0]?.total ?? null;
return { ...query, items, total };
```

`queryKey: ["conversations", filters]` giữ nguyên (TanStack hash cấu trúc, không cần
`JSON.stringify`) — điều kiện đúng đắn là **giá trị** `from/to` phải ổn định (xem F3).

**F2 — Date filter dùng chung: KHÔNG viết date picker mới**
`components/dashboard/DashboardDateFilter.tsx` (250 dòng, đã có preset + lịch chọn
khoảng + "Xoá"/"Hôm nay") **không hề gắn chặt vào dashboard**: props là
`{ presetKey, range, onChange }`, chỉ import từ `lib/dashboard/date-presets` + `lib/utils`,
không đọc context/store nào. ⇒ **Tái sử dụng, không copy, không fork.**

- Bước tối thiểu (được phép): board import thẳng `DashboardDateFilter`.
- Bước làm sạch (khuyến nghị): **di chuyển** file sang `components/ui/DateRangeFilter.tsx`,
  đổi tên export thành `DateRangeFilter`, thêm prop `className?: string` gắn vào div ngoài
  cùng để board nén vừa toolbar; `components/dashboard/DashboardDateFilter.tsx` chỉ còn
  re-export, hoặc cập nhật import trong `app/page.tsx`. **Không đổi hành vi/markup bên trong.**
- Trên board đặt nó ở hàng bộ lọc của `BoardToolbar`, cạnh `ShopFilter`/`TagFilter`,
  điều khiển **draft** (xem F3).

**F3 — `app/board/page.tsx`: state khoảng ngày + xử lý dứt điểm cạm bẫy `to = nowSec()`**

```ts
import { rangeForPreset, type DateRange, type PresetKey } from "@/lib/dashboard/date-presets";
import { DEFAULT_CONVERSATION_FILTERS, type ConversationFilters } from "@/lib/types/etsy";

// Mặc định board: chưa trả lời + cũ nhất trước + 7 ngày (KHỚP Dashboard).
// Là FUNCTION, không phải const module-scope: mỗi lần mount mới snapshot lại khoảng.
function makeDefaultFilters(): ConversationFilters {
  return {
    ...DEFAULT_CONVERSATION_FILTERS,
    notReplied: true,
    sort: "asc",
    datePreset: "7days",
    ...rangeForPreset("7days"), // gọi ĐÚNG 1 LẦN / mount
  };
}

export default function BoardPage() {
  // Gọi 1 lần rồi dùng CÙNG object cho cả applied và draft → filtersDirty = false lúc mount.
  const [initialFilters] = useState<ConversationFilters>(makeDefaultFilters);
  const [filters, setFilters] = useState<ConversationFilters>(initialFilters);
  const [draftFilters, setDraftFilters] = useState<ConversationFilters>(initialFilters);
  // XOÁ: maxMessages / waitingHours / draftMaxMessages / draftWaitingHours (đã vào filters)
```

**Luật chống refetch vô hạn (bắt buộc tuân thủ, ghi comment tại chỗ):**

1. `rangeForPreset()` chỉ được gọi ở (a) `makeDefaultFilters()` dùng làm *lazy initializer*
   của `useState`, và (b) trong `onChange` của date filter (event handler của người dùng).
   **TUYỆT ĐỐI không** gọi trong thân render, trong `useMemo`, trong `useEffect` chạy lặp,
   và không đặt ở module scope kiểu `const DEFAULT_FILTERS = {...rangeForPreset("7days")}`
   (module scope chỉ chạy 1 lần/tab nên khoảng sẽ đứng yên qua nhiều giờ).
2. Không đưa bất kỳ giá trị dẫn xuất từ `Date.now()` nào vào `filters` ngoài `from`/`to`
   đã snapshot. `waitingHours` gửi nguyên số giờ; cutoff do server tính (B3).
3. `filters` chỉ đổi khi bấm **"Lọc"** (`applyFilters`) — lúc đó chỉ copy draft, không đọc lại giờ.
4. Không thêm `refetchInterval`/auto-refresh khoảng ngày. Muốn cửa sổ mới: user bấm lại
   preset rồi bấm "Lọc" (hành động tường minh, thấy được).

Handler cho date filter (chỉnh **draft**, đúng pattern các filter khác):

```ts
const onDateChange = useCallback((key: PresetKey, r: DateRange) => {
  setDraftFilters((f) => ({ ...f, datePreset: key, from: r.from, to: r.to }));
}, []);
```

`filtersDirty` giữ nguyên `JSON.stringify(draftFilters) !== JSON.stringify(filters)` — nay đã
bao trọn cả date + maxMessages + waitingHours, nên **xoá 2 dòng so sánh
`draftMaxMessages !== maxMessages` / `draftWaitingHours !== waitingHours`**.
`filtersKey = JSON.stringify(filters)` giữ nguyên; vì `from/to` là snapshot nên phiên
"retain" chỉ reset khi user thật sự bấm Lọc.

**F4 — `app/board/page.tsx`: bỏ lọc client, dùng `total` của server**

```ts
const { items, total, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } =
  useConversations(filters);
// ...
// Chỉ còn loại hội thoại người dùng bấm X (thuần client) — maxMessages/waitingHours đã ở server.
const filtered = useMemo(
  () => retainedItems.filter((c) => !dismissed.has(c.conversationId)),
  [retainedItems, dismissed],
);
```

Truyền xuống toolbar: `shown={cells.length}` (giữ) và `total={total}`.
Giữ nguyên effect auto-nạp trang (`filtered.length < limit && hasNextPage`) — nay nó hội tụ
nhanh hơn vì server không còn trả item mà client sẽ loại.

**F5 — `components/board/BoardToolbar.tsx`**

- Prop `total: number` → `total: number | null`; render `{total != null && total !== shown && <> / {total}</>}`.
  Nhãn: `Hiện <b>{shown}</b> / {total} hội thoại khớp bộ lọc`.
- Prop `maxMessages/onMaxMessages/waitingHours/onWaitingHours` **giữ nguyên signature**
  (`number | null` + setter) — board nối vào draft filters:
  `maxMessages={draftFilters.maxMessages}`, `onMaxMessages={(v) => onFiltersChange({ maxMessages: v })}`.
  ⇒ phần input của toolbar gần như không phải sửa.
- Thêm date filter (F2) vào hàng bộ lọc; đọc `filters.datePreset` / `filters.from` / `filters.to`
  từ prop `filters` đã có + gọi `onDateChange` (ưu tiên cách này để không phình props).

**F6 — `components/messenger/ConversationList.tsx` (dòng ~119): không đổi hành vi**

```ts
const filters: ConversationFilters = useMemo(
  () => ({
    ...DEFAULT_CONVERSATION_FILTERS, // from/to = null → All Time như hiện tại
    search, orderHelp, notReplied, hasOrder, hasNote,
    shopIds, tags: selectedTags, sheetStatuses: selectedSheetStatuses, sort,
  }),
  [/* deps giữ nguyên */],
);
```

Sidebar messenger **cố ý** không có bộ lọc ngày trong lượt này (ngoài phạm vi); spread
`DEFAULT_CONVERSATION_FILTERS` để lần sau thêm field không vỡ build.

**Không được làm:** sửa `lib/services/*`, `app/api/*`; viết date picker mới; nhét `Date.now()`
vào `filters`; đọc `total` ở trang khác trang đầu.

---

## 5. QUYẾT ĐỊNH ĐÃ CHỐT + LÝ DO

### QĐ1 — Shape khoảng ngày: **phẳng `from`/`to` trong `ConversationFilters`**, không lồng `DateRange`

- Khớp tiền lệ sẵn có `AnalyticsFilters { from, to, shopIds }` (cùng file types) và khớp
  `ConversationFilterOpts` (phẳng) → 4 tầng cùng tên field, không cần map qua lại.
- Khớp 1-1 với query param `?from=&to=` → hook serialize thẳng, ít chỗ sai.
- `onFiltersChange(patch: Partial<ConversationFilters>)` của toolbar patch được field phẳng;
  nếu lồng `dateRange` thì patch nông sẽ ghi đè cả object (dễ sinh bug).
- Vẫn **tái sử dụng** `DateRange` ở biên: `rangeForPreset()` trả `DateRange`, handler rải
  `r.from/r.to` vào filters. Không định nghĩa kiểu ngày mới.

### QĐ2 — `datePreset` nằm TRONG `ConversationFilters` nhưng KHÔNG lên URL

- Nằm trong filters ⇒ tự động đi theo cặp draft/applied và `filtersDirty` có sẵn, không phải
  thêm 2 state + 2 nhánh so sánh (ít code, ít chỗ quên).
- Không serialize ⇒ server chỉ thấy `from/to`; preset thuần là nhãn UI.
- Giá phải trả: đổi preset mà khoảng y nguyên vẫn đổi queryKey → 1 refetch vô hại. Thực tế
  mỗi lần bấm preset đều sinh `to` mới nên trường hợp này gần như không xảy ra.

### QĐ3 — Cạm bẫy `rangeForPreset()` trả `to = nowSec()`: **snapshot 1 lần/mount + 1 lần/hành động**

Vấn đề: nếu `from/to` được tính lại trong render, mỗi render ra giá trị khác → `queryKey`
đổi → refetch → re-render → **refetch vô hạn**; đồng thời `filtersKey` đổi liên tục →
`useEffect([filtersKey])` reset `retainMapRef` + `setRetainOrder([])` mỗi render → vòng lặp
setState. Cách xử lý dứt điểm: xem **4 luật ở F3**. Cốt lõi:

- `useState(makeDefaultFilters)` (lazy initializer, KHÔNG `useState(makeDefaultFilters())`)
  → đọc giờ đúng 1 lần/mount; dùng chung 1 object cho `filters` và `draftFilters` để
  `filtersDirty === false` lúc mount (nếu gọi 2 lần, 2 mốc `to` có thể lệch 1 giây và nút
  "Lọc" sẽ sáng vô cớ).
- Mọi lần đọc giờ khác chỉ xảy ra trong event handler người dùng.
- **Không quantize** `to` về cuối ngày và **không** đổi `to` thành `null` cho preset tương đối:
  cả hai đều làm `from` (= `to - 7*24*3600`) lệch so với Dashboard tới ~1 ngày ở biên và
  phá tiêu chí nghiệm thu. Board dùng **đúng `rangeForPreset` nguyên bản** như Dashboard.
- Hệ quả đã biết & chấp nhận: cửa sổ là snapshot lúc mở trang (giống Dashboard). Tin nhắn
  đến sau snapshot nằm ngoài `to` → không hiện. Đây là hành vi *giống Dashboard*, và chính
  là điều kiện để hai con số khớp nhau.

### QĐ4 — `total` = `countDocuments` của filter **không gồm cursor**, chỉ tính ở **trang đầu**

- Bỏ cursor khỏi count: cursor là con trỏ phân trang, không phải điều kiện lọc. Nếu để,
  `total` sẽ giảm dần theo mỗi trang → mẫu số nhảy lùi.
- Chỉ trang đầu (`cursor == null`), trang sau trả `null`: board nạp tới 4 trang (pageSize 100
  / limit 30) và messenger sidebar cuộn nhiều trang → count mỗi trang là lặp lại **cùng một
  filter cho cùng một kết quả**, thuần chi phí. `countDocuments` không thể covered-count vì
  filter có `$or`/`$nin`/`$in` trên field chưa index (`etsy.has_replied`, `user_data.user_id`)
  → phải quét; đừng nhân 4.
- Vẫn luôn tươi: TanStack refetch infinite query là refetch **từ trang đầu**, nên
  `pages[0].total` được cập nhật ở mọi lần invalidate/refetch.
- Kiểu `number | null` (không dùng `0`) để trang phân trang không âm thầm nói dối; type buộc
  consumer xử lý. Chạy `Promise.all` cùng `find` để không cộng latency.
- Vì sao không theo `OrdersResponse` (`total: number` mọi lúc): Orders phân trang
  **offset/page**, mỗi request là một trang độc lập nên buộc phải có total; conversations
  phân trang **cursor + cache dồn trang**, trang đầu luôn có mặt trong cache.

### QĐ5 — `maxMessages` + `waitingHours`: **đẩy xuống MongoDB** (phương án a)

- **Lý do chính:** nếu giữ client-side thì `total` (server) và tập hiển thị (client) là hai
  tập khác nhau ⇒ mẫu số > tử số một cách bí ẩn — đúng loại bug ta đang đi sửa. "Ghi chú
  mẫu số là tổng khớp bộ lọc server" chỉ là dán nhãn cho một con số vẫn sai về ý nghĩa.
- **Đẩy được sạch:** `maxMessages` so với `etsy.message_count` (đã nằm trong
  `LIST_PROJECTION`); `waitingHours` so `lastMessageDate` với mốc `now - N*3600`.
- **Lợi ích phụ quan trọng:** cutoff của `waitingHours` tính ở server ⇒ client không còn
  `Date.now()` trong đường dữ liệu filter ⇒ triệt luôn một nguồn queryKey bất ổn.
  Ngoài ra vòng auto-nạp trang (`filtered.length < limit`) hội tụ nhanh hơn nhiều vì
  server không còn trả về item mà client sẽ loại.
- **Trade-off đã cân:**
  - `waitingHours` + khoảng ngày cùng ràng buộc `lastMessageDate` → phải push **2 clause
    riêng** dưới `$and` (B3), không merge object. Đã ghi rõ để backend không đá nhau.
  - Semantics biên: Mongo `$lt` không khớp doc **thiếu** `etsy.message_count`, còn client coi
    thiếu = 0 (`asNumber(...) ?? 0`). Bù bằng `$or [{ $lt: n }, { <field>: null }]`
    (`{field: null}` khớp cả missing) để tập kết quả không đổi so với hiện tại.
  - Cutoff dùng **giờ server**, còn `from/to` dùng **giờ máy client** (giống Dashboard).
    Lệch clock giữa hai bên chỉ ảnh hưởng biên vài giây — chấp nhận, ghi lại để QA không
    truy sai hướng.
  - Không còn lọc lại ở client ⇒ item đã "retain" (shop vừa trả lời) vẫn hiển thị dù không
    còn khớp `waitingHours` — đúng như hành vi retain hiện có cho các filter khác.

### QĐ6 — Tái sử dụng `DashboardDateFilter`, không viết date picker mới

Đã đọc cả 250 dòng: component chỉ nhận `{presetKey, range, onChange}`, không context/store,
không hằng số riêng của dashboard. ⇒ dùng lại nguyên trạng; nếu làm sạch thì **di chuyển**
sang `components/ui/DateRangeFilter.tsx` + thêm `className?` và re-export, **không** fork.

---

## 6. TIÊU CHÍ NGHIỆM THU

**AC1 (chính).** Board: shop = **CusGiftsCo**, **Not replied** = ON, preset = **7 ngày**,
search rỗng, `maxMessages`/`waitingHours` rỗng, tags/sheetStatuses rỗng, hasOrder/orderHelp/
hasNote OFF → số sau dấu `/` (total) **bằng đúng** cột "CHƯA TRẢ LỜI" của CusGiftsCo trên
Dashboard cùng preset 7 ngày. (Baseline đã đo: ~**51**, so với all-time ~**94**.)
Nạp lại cả hai trang gần nhau để hai snapshot `to` sát nhau.

**AC2.** Board preset "Tất cả" + cùng điều kiện → total ≈ **94** (all-time), tức cột
Dashboard với preset "Tất cả".

**AC3.** `total` KHÔNG đổi khi board tự nạp thêm trang (cuộn / tăng Page Size 20→50→100).
Trước đây mẫu số tăng dần rồi đóng băng; nay cố định.

**AC4.** Không refetch vô hạn: mở DevTools → Network, để board yên **60 giây** không tương
tác → **0** request `/api/conversations` mới; React Profiler không thấy render lặp.
(Bài kiểm tra trực tiếp cho QĐ3.)

**AC5.** Nhấn preset khác mà **chưa** bấm "Lọc" → không có request mới, nút "Lọc" sáng
(`filtersDirty`); bấm "Lọc" → đúng **1** chuỗi request mới với `from`/`to` mới.

**AC6.** Đặt "Dưới 3 tin nhắn" + "Chờ > 24 giờ", bấm Lọc → query string có
`maxMessages=3&waitingHours=24`; mọi ô hiển thị đều thoả (`messageCount < 3`, tuổi ≥ 24h);
`total` giảm tương ứng (mẫu số = đúng tập đã lọc, không còn > tử số).

**AC7.** Messenger sidebar (`components/messenger/ConversationList.tsx`) không hồi quy:
request KHÔNG chứa `from`/`to`/`maxMessages`/`waitingHours`; số lượng & thứ tự như trước.

**AC8.** `npx tsc --noEmit` sạch. Sau khi architect đặt contract, hiện có **đúng 3 lỗi cố ý**
— là 3 việc đã giao: `app/board/page.tsx:16`,
`components/messenger/ConversationList.tsx:119`, `lib/services/conversation-read.ts:183`.

**Truy vấn xác minh cho QA (mongosh, DB `meta_local`):**

```js
// Thay <shopUserId> = user_data.user_id của CusGiftsCo; <from>/<to> = snapshot preset 7 ngày.
db.conversations.countDocuments({ $and: [
  { lastMessageDate: { $gte: <from>, $lte: <to> } },
  { "etsy.has_replied": false },
  { tags: { $nin: ["handled", "approved"] } },
  { "user_data.user_id": { $in: [<shopUserId>] } },
]});
```

Con số này phải khớp cả `total` của API và cột Dashboard.

---

## 7. FILE BỊ ẢNH HƯỞNG

| File | Ai sửa | Nội dung |
|---|---|---|
| `lib/types/etsy.ts` | **architect (ĐÃ XONG)** | `ConversationFilters` + `DEFAULT_CONVERSATION_FILTERS` + `ConversationListResponse.total` + import `PresetKey` |
| `lib/services/conversation-read.ts` | backend | B1–B4 |
| `app/api/conversations/route.ts` | backend | B5 |
| `lib/db/indexes.ts` | backend | B6 (tuỳ chọn, chỉ khi đo thấy chậm) |
| `lib/hooks/useConversations.ts` | frontend | F1 |
| `components/ui/DateRangeFilter.tsx` (di chuyển từ dashboard) | frontend | F2 |
| `components/dashboard/DashboardDateFilter.tsx` / `app/page.tsx` | frontend | F2 (chỉ re-export / đổi đường import — KHÔNG đổi hành vi) |
| `app/board/page.tsx` | frontend | F3, F4 |
| `components/board/BoardToolbar.tsx` | frontend | F5 |
| `components/messenger/ConversationList.tsx` | frontend | F6 |

Không ai sửa: `lib/dashboard/date-presets.ts` (dùng nguyên trạng), `lib/services/analytics.ts`
(là nguồn chuẩn để so, không đổi).
