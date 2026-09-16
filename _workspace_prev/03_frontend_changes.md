# 03 — Frontend changes: bộ lọc khoảng ngày cho Board + `total` thật từ server

Ngày: 2026-09-14 · Nhánh: `fix/mera-connection` · Agent: frontend-engineer
Contract nguồn: `_workspace/01_architect_contract.md` §1, §2, §4 (F1–F6), §5 QĐ1/QĐ2/QĐ3/QĐ6.
Không sửa `lib/types/etsy.ts`, `lib/services/*`, `app/api/*`, `lib/db/*`, `lib/dashboard/date-presets.ts`.

**Trạng thái kiểm tra:** `npx tsc --noEmit` → EXIT 0 (sạch). `npm run build` → thành công.

---

## Vị trí UI khoảng ngày + mặc định (câu trả lời trực tiếp)

- **Đặt ở đâu:** `components/board/BoardToolbar.tsx`, **Hàng 3** của toolbar — hàng chứa
  "Dưới … tin nhắn" / "Chờ > … giờ" / nút **Lọc**, và `DateRangeFilter` là phần tử **đầu tiên
  bên trái** hàng đó. (Không đặt ở Hàng 2 cùng `ShopFilter`/`TagFilter` vì Hàng 2 đã có 7 chip
  `w-28` + ô search `flex-1`; nhồi thêm 4 nút preset + nút lịch sẽ wrap xấu. Hàng 3 vốn là hàng
  "ngưỡng lọc" nên khoảng ngày thuộc về đây về mặt ngữ nghĩa, và đứng ngay cạnh nút "Lọc" mà nó
  cần người dùng bấm.) Comment hàng 3 đổi từ `{/* Hàng 3: lọc client */}` →
  `{/* Hàng 3: khoảng ngày + ngưỡng số (tất cả lọc ở server) */}`.
- **Mặc định khi mở Board:** preset **`"7days"`** (nút "7 ngày" sáng), `from = now - 7*24*3600`,
  `to = now` — **khớp Dashboard** (`app/page.tsx` cũng `useState<PresetKey>("7days")`). Kèm theo
  mặc định cũ vẫn giữ: `notReplied: true`, `sort: "asc"`.
- Nút "Lọc" **không sáng** lúc mount (xem F3 bên dưới), nên mở trang là đã thấy đúng dữ liệu
  7 ngày mà không phải bấm gì.

---

## F1 — `lib/hooks/useConversations.ts`

Diff chính:

1. `fetchConversations()` serialize 4 param mới, sau `sort`, trước `limit`:
   `from`, `to`, `maxMessages`, `waitingHours` — mỗi cái chỉ set khi `!= null` (khớp
   `numOrNull()` của route: param thiếu ⇒ `null` ⇒ không lọc).
   **`filters.datePreset` KHÔNG được serialize** (QĐ2) — đã ghi comment tại chỗ.
2. `return res.json()` → `return (await res.json()) as ConversationListResponse;`
   (cast đúng type contract chung, không type cục bộ).
3. Expose `total`:
   ```ts
   const total: number | null = query.data?.pages[0]?.total ?? null;
   return { ...query, items, total };
   ```
   `queryKey: ["conversations", filters]` **giữ nguyên** (TanStack hash cấu trúc).
   Không thêm `staleTime`/`refetchInterval` — giữ y hành vi cũ, và QĐ3/AC4 cấm auto-refresh.

### Field hook ĐỌC từ json API (tên field + đường dẫn chính xác)

| Đường dẫn trong response | Kiểu | Hook dùng để làm gì |
|---|---|---|
| `pages[n].items[]` | `ConversationListItem[]` | `query.data.pages.flatMap(p => p.items)` → `items` |
| `pages[0].total` | `number \| null` | → `total` (CHỈ trang đầu; `pages[1..].total` là `null`, cố ý không đọc) |
| `pages[n].nextCursor` | `string \| null` | `getNextPageParam: (last) => last.nextCursor` |

### Query param hook GHI (khớp 1-1 tên param route đã parse)

`cursor`, `search`, `notReplied`, `hasOrder`, `orderHelp`, `hasNote`, `shopIds`, `tags`,
`sheetStatuses`, `sort`, **`from`**, **`to`**, **`maxMessages`**, **`waitingHours`**, `limit=30`.
Đã grep xác nhận `app/api/conversations/route.ts` đọc đúng 4 tên mới này (dòng 40–44).

---

## F2 — Date filter dùng chung (KHÔNG viết date picker mới, KHÔNG fork)

- `git mv components/dashboard/DashboardDateFilter.tsx` → **`components/ui/DateRangeFilter.tsx`**
  (di chuyển, git thấy là rename → lịch sử file được giữ).
- Export `DashboardDateFilter` → **`DateRangeFilter`**.
- Thêm **duy nhất** prop `className?: string`, gắn vào div ngoài cùng:
  `<div className={cn("flex flex-wrap items-center gap-2", className)}>`.
  `cn` = `twMerge(clsx(...))` nên caller override được `gap`.
- **Markup/hành vi bên trong KHÔNG đổi một dòng nào**: `RangeCalendar`, 4 preset, nút lịch,
  "Xóa"/"Hôm nay", click-outside — nguyên trạng.
- `components/dashboard/DashboardDateFilter.tsx` còn lại **shim 1 dòng**:
  `export { DateRangeFilter as DashboardDateFilter } from "@/components/ui/DateRangeFilter";`
  (tên cũ vẫn dùng được; code mới nên import trực tiếp từ `components/ui`).
- `app/page.tsx`: đổi import sang `@/components/ui/DateRangeFilter` + đổi tên thẻ JSX.
  Props truyền vào **y như trước** (`presetKey` / `range` / `onChange`) ⇒ **Dashboard không đổi
  hành vi**. Không truyền `className` ở dashboard để giữ đúng `gap-2` cũ.

---

## F3 — `app/board/page.tsx`: state khoảng ngày (chống refetch vô hạn)

- `const DEFAULT_FILTERS = {...}` (module scope) → **hàm `makeDefaultFilters()`**:
  `{...DEFAULT_CONVERSATION_FILTERS, notReplied: true, sort: "asc", datePreset: "7days",
  ...rangeForPreset("7days")}`.
- 3 state thay cho 6:
  ```ts
  const [initialFilters] = useState<ConversationFilters>(makeDefaultFilters); // LAZY: truyền hàm
  const [filters, setFilters] = useState<ConversationFilters>(initialFilters);
  const [draftFilters, setDraftFilters] = useState<ConversationFilters>(initialFilters);
  ```
  **Xoá hẳn** `maxMessages`/`waitingHours`/`draftMaxMessages`/`draftWaitingHours`
  (đã grep: không còn tham chiếu nào trong repo).
- `onDateChange = useCallback((key: PresetKey, r: DateRange) => setDraftFilters(f =>
  ({...f, datePreset: key, from: r.from, to: r.to})), [])` — vào **draft**, không vào applied.
- `filtersDirty` = **chỉ** `JSON.stringify(draftFilters) !== JSON.stringify(filters)`
  (xoá 2 dòng so sánh `draftMaxMessages`/`draftWaitingHours`).
- `applyFilters = useCallback(() => setFilters(draftFilters), [draftFilters])` — chỉ copy draft,
  **không** đọc lại `Date.now()`.
- `filtersKey = JSON.stringify(filters)` giữ nguyên; vì `from/to` là snapshot nên effect reset
  `retainMapRef`/`retainOrder`/`dismissed` chỉ chạy khi user thật sự bấm "Lọc".
- 4 luật QĐ3 đã ghi comment **tại chỗ** trong file (trên `makeDefaultFilters`, trên
  `initialFilters`, trên `onDateChange`, trên `applyFilters`).
- `rangeForPreset()` trong board xuất hiện **đúng 1 lần**, bên trong `makeDefaultFilters()`.
  Mọi lần đọc giờ khác do chính `DateRangeFilter` gọi trong `onClick` preset (event handler).

---

## F4 — `app/board/page.tsx`: bỏ lọc client, dùng `total` của server

- `useConversations(filters)` nay destructure thêm `total`.
- `filtered` gọn còn 1 điều kiện **client-only**:
  ```ts
  const filtered = useMemo(
    () => retainedItems.filter((c) => !dismissed.has(c.conversationId)),
    [retainedItems, dismissed],
  );
  ```
  Đã gỡ: `const now = Date.now()`, nhánh `maxMessages`, nhánh `waitingHours` (tính `ageH`).
  → **không còn `Date.now()` nào trong đường dữ liệu lọc của board**.
  **GIỮ** `dismissed` (nút X) vì server không biết về nó.
- Toolbar: `total={filtered.length}` → **`total={total}`**; `shown={cells.length}` giữ nguyên.
- Nối 2 ô số vào draft (giữ nguyên signature toolbar): `maxMessages={draftFilters.maxMessages}`,
  `onMaxMessages={onMaxMessages}` với `onMaxMessages = useCallback(v => setDraftFilters(f =>
  ({...f, maxMessages: v})), [])`; tương tự `waitingHours`.
- Effect auto-nạp trang **giữ nguyên logic** (`filtered.length < limit && hasNextPage`), chỉ cập
  nhật comment (nay chỉ `dismissed` mới loại bớt, nên hội tụ nhanh hơn).

### Field component ĐỌC từ response (cho qa-integration)

`app/board/page.tsx` đọc: `total` (qua hook, từ `pages[0].total`); từ mỗi item:
`conversationId` (key/map/dismiss/drafts/statuses/aiTriggers). Không còn đọc `messageCount`
hay `lastMessageDate` để lọc (đã sang server) — nhưng **`BoardCell`** (ngoài phạm vi lượt này)
vẫn đọc `conv.*` đầy đủ.

---

## F5 — `components/board/BoardToolbar.tsx`

- Prop mới **`onDateChange: (presetKey: PresetKey, range: DateRange) => void`** (1 prop, không
  thêm `presetKey`/`range` — đọc từ prop `filters` đã có, theo đúng gợi ý §4 F5).
- Prop `total: number` → **`total: number | null`** + JSDoc.
- Nhãn đếm: `{total != null && total !== shown && <> / {total}</>} hội thoại khớp bộ lọc`
  (thêm chữ "khớp bộ lọc" theo contract; khi `total == null` hoặc `total === shown` thì không
  render phần `/ N`).
- Hàng 3 thêm:
  ```tsx
  <DateRangeFilter
    presetKey={filters.datePreset}
    range={{ from: filters.from, to: filters.to }}
    onChange={onDateChange}
    className="gap-1.5"
  />
  ```
- `maxMessages/onMaxMessages/waitingHours/onWaitingHours`: **signature không đổi**, phần
  `<input type="number">` không sửa một dòng.

---

## F6 — `components/messenger/ConversationList.tsx`

`filters` useMemo nay spread `DEFAULT_CONVERSATION_FILTERS` trước rồi override 9 field cũ.
Deps **không đổi**. ⇒ `datePreset: "all"`, `from/to/maxMessages/waitingHours = null` ⇒ hook
không set 4 param mới ⇒ **request sidebar giống hệt trước** (AC7). Import đổi từ
`import type {...}` sang `import { DEFAULT_CONVERSATION_FILTERS, type ... }` (cần giá trị runtime).

---

## Quyết định nhỏ tự chốt (ngoài contract, cần QA biết)

1. **Date filter đặt ở Hàng 3, không Hàng 2.** Lý do đã nêu ở mục đầu (Hàng 2 đã kín; Hàng 3
   đứng cạnh nút "Lọc" mà nó phụ thuộc). Vẫn là "hàng bộ lọc" như contract yêu cầu.
2. **`className="gap-1.5"`** (chỉ nén khoảng cách, KHÔNG nén padding nút). Đã cân nhắc
   `[&>button]:px-3` rồi **bỏ**: arbitrary variant từ cha không được `twMerge` dedupe với
   `px-4` trên con, thắng/thua phụ thuộc thứ tự CSS output → không đáng tin. Nút preset
   `px-4 py-2 text-sm` cao ~36px, trùng `h-9` của các control khác trong toolbar nên vừa vặn.
3. **Giữ shim `components/dashboard/DashboardDateFilter.tsx`** thay vì xoá, dù grep chỉ thấy
   `app/page.tsx` dùng. Rẻ (1 dòng) và chặn vỡ nếu có nhánh khác/extension đang import tên cũ.
4. **Thêm chữ "khớp bộ lọc"** vào nhãn đếm (contract §4 F5 ghi nhãn này) — đổi copy UI, không
   đổi logic.
5. **Không thêm `staleTime`** cho `useConversations`. Skill khuyến nghị nhưng ở đây board dựa
   vào refetch để cập nhật trạng thái đã-trả-lời; thêm `staleTime` là đổi hành vi ngoài phạm vi.
6. **`onMaxMessages`/`onWaitingHours` là `useCallback` riêng** thay vì inline arrow
   `(v) => onFiltersChange({ maxMessages: v })` — cùng hiệu quả, nhưng identity ổn định để
   `BoardToolbar` còn `memo` được về sau.
7. **`initialFilters` không có setter** (`const [initialFilters] = useState(...)`) — cố ý: nó là
   snapshot bất biến của phiên, chỉ dùng để seed 2 state kia.

## Lưu ý bàn giao cho qa-integration

- `queryKey` = `["conversations", filters]` với `filters` là **cả object `ConversationFilters`**
  (13 field, gồm `datePreset` không lên URL). Board: 1 queryKey; sidebar messenger: queryKey khác
  (từ filters riêng của nó) — hai cache tách biệt, cùng hook cùng type.
- Kiểm AC4 (không refetch vô hạn): sau khi mount, `filters` chỉ đổi khi bấm "Lọc". Nếu thấy
  request lặp, nghi ngay việc có ai gọi `rangeForPreset()` ngoài `makeDefaultFilters()`.
- Kiểm AC5: bấm preset khác → **không** request mới; nút "Lọc" sáng (`filtersDirty`).
- Mốc `from/to` dùng **giờ máy client**; cutoff `waitingHours` dùng **giờ server** (QĐ5) — lệch
  clock chỉ ảnh hưởng biên vài giây.
