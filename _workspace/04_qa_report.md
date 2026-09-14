# 04 — QA Integration report: bộ lọc khoảng ngày cho Board + `total` thật từ server

Ngày: 2026-09-14 · Nhánh: `fix/mera-connection` · Agent: qa-integration
Nguồn: `_workspace/01_architect_contract.md` (§2 bảng seam, §6 AC), `_workspace/02_backend_changes.md`, `_workspace/03_frontend_changes.md`
Phương pháp: skill `dora-integration-qa` — so khớp chéo 4 tầng + kiểm chứng bằng thực thi (tsc, build, truy vấn production CHỈ ĐỌC).

**Kết luận tổng: KHÔNG có finding mức CHẶN MERGE.** 2 finding NÊN SỬA (một trong đó làm tái xuất
đúng triệu chứng "mẫu số < tử số" mà lượt này đi sửa), 4 GHI NHẬN. Nghiệm thu số liệu: **Board == Dashboard
trên cả 6 preset đã thử** (khớp tuyệt đối). Xung đột 94 vs 26 đã phân xử: **dữ liệu trôi thật, cả hai phép
đo đều đúng tại thời điểm của nó** — có bằng chứng định lượng (mục 4).

---

## 1. Bảng so khớp 4 tầng

Tầng: (1) service `return`/clause Mongo · (2) query param route đọc · (3) hook serialize + type cast + queryKey · (4) component đọc.

| Field | (1) Service | (2) API route | (3) Hook | (4) Component | Kết luận |
|---|---|---|---|---|---|
| **`total`** | `conversation-read.ts:212-221` `Promise.all([find, cursorClause ? null : countDocuments(filterNoCursor)])`; `:232` `return {items, nextCursor, total}` | `route.ts:46` `NextResponse.json(data)` — không bọc thêm lớp nào | `useConversations.ts:36` cast `as ConversationListResponse`; `:50` `query.data?.pages[0]?.total ?? null` | `app/board/page.tsx:92` destructure `total`; `:247` `total={total}`; `BoardToolbar.tsx:83` `total: number \| null`; `:111` render `/ {total}` | **PASS** (xem F-02 về cách render) |
| **`from`** | `:140-143` `dateRange.$gte = opts.from` (chỉ khi `typeof number && isFinite`), push clause RIÊNG | `:40` `from: numOrNull(sp.get("from"))` | `:28` `if (filters.from != null) params.set("from", ...)` | `BoardToolbar.tsx:228` `range={{from: filters.from, to: filters.to}}` → `DateRangeFilter` | **PASS** |
| **`to`** | `:142` `dateRange.$lte = opts.to` | `:41` `to: numOrNull(sp.get("to"))` | `:29` `params.set("to", ...)` | như trên | **PASS** |
| **`datePreset`** | không tồn tại (đúng contract) | không đọc (đúng contract) | **KHÔNG** serialize (grep: 0 hit `params.set("datePreset")`), chỉ nằm trong `queryKey` `:41` | `BoardToolbar.tsx:227` `presetKey={filters.datePreset}` | **PASS** |
| **`maxMessages`** | `:148-155` `$or: [{"etsy.message_count": {$lt: n}}, {"etsy.message_count": null}]`, chỉ khi `n > 0` | `:42` `maxMessages: numOrNull(...)` | `:31` `params.set("maxMessages", ...)` | `page.tsx:233` `maxMessages={draftFilters.maxMessages}`; `BoardToolbar.tsx:234-241` input, `:98-101` `numOrNull` chỉ trả `>0` hoặc `null` | **PASS** + tương đương ngữ nghĩa đã đo (mục 3) |
| **`waitingHours`** | `:161-164` `cutoff = floor(Date.now()/1000) - n*3600`; `clauses.push({lastMessageDate: {$lte: cutoff}})` — **phần tử riêng của mảng `clauses`** | `:44` `waitingHours: numOrNull(...)` | `:32` `params.set("waitingHours", ...)` | `page.tsx:235`, `BoardToolbar.tsx:246-253` | **PASS** + tương đương ngữ nghĩa đã đo (mục 3) |
| `nextCursor` | `:227-230` `encodeCursor` không đổi | không đổi | `:44` `getNextPageParam: (last) => last.nextCursor` | không đọc trực tiếp | **PASS** |
| `items[]` | `mapConversation` + `LIST_PROJECTION` không đổi | không đổi | `:47` `pages.flatMap(p => p.items)` | `BoardCell conv={c}`; board chỉ đọc `conversationId` | **PASS** |

### Bất biến của contract (§2)

| Bất biến | Kết quả | Bằng chứng |
|---|---|---|
| Cùng một `ConversationListResponse` ở cả 4 tầng, không cast trung gian | **PASS** | Type khai duy nhất ở `lib/types/etsy.ts:258-268`; service `conversation-read.ts:101` trả `Promise<ConversationListResponse>`; hook `useConversations.ts:13,36` cùng type. Grep: **0** type nhân bản (không có interface nào tự khai `items/nextCursor/total` ở hook/component) |
| `total` không chịu ảnh hưởng `cursor`/`limit` | **PASS** | `countDocuments(filterNoCursor)` (`:220`), `filterNoCursor` dựng ở `:201-202` từ `clauses` mà **cursor không nằm trong** (`:112` `cursorClause` là biến riêng). Đã đo bằng script (mục 3.G): nếu vô ý dùng `filter` có cursor thì mẫu số sẽ là 22 → 12 → 2 theo trang; code hiện tại giữ 22 cả 3 trang |
| `datePreset` không bao giờ lên URL | **PASS** | grep `datePreset` trong `useConversations.ts`: chỉ xuất hiện trong comment `:26` |
| Board & messenger dùng CÙNG hook/type; messenger phải All Time | **PASS** | `ConversationList.tsx:126-133` spread `DEFAULT_CONVERSATION_FILTERS` → `from/to/maxMessages/waitingHours = null` → hook bỏ qua 4 param (mỗi lần set đều có guard `!= null`) ⇒ query string sidebar **giống hệt trước** (AC7) |
| Param hook gửi ⊆ param route đọc | **PASS** | Hook gửi: `cursor, search, notReplied, hasOrder, orderHelp, hasNote, shopIds, tags, sheetStatuses, sort, from, to, maxMessages, waitingHours, limit`. Route đọc đúng 15 tên đó (`route.ts:21-44`). Không có param nào bị bỏ im lặng |
| Caller khác của endpoint không hồi quy | **PASS** | Grep toàn repo: chỉ **1** nơi gọi `GET /api/conversations` (list) = `useConversations.ts:34`; chỉ **2** consumer của hook (`app/board/page.tsx:93`, `components/messenger/ConversationList.tsx:136`). `app/v1/extension/*` là route **sync** riêng, không dùng `getConversations`. Grep repo extension (`D:\Pamo\DORA\dora-extension`) cho `api/conversations?` / `ConversationFilters` / `maxMessages` / `waitingHours`: **0 hit** |

---

## 2. Kiểm chứng bằng thực thi

| Kiểm tra | Kết quả |
|---|---|
| `npx tsc --noEmit` | **EXIT 0, 0 lỗi** (AC8 đạt — 3 lỗi cố ý của architect đã được backend/frontend giải quyết hết) |
| `npm run build` | **EXIT 0**, build thành công, mọi route compile (gồm `/board`, `/`, `/api/conversations`) |
| Grep type contract dùng chung | Chỉ 1 định nghĩa `ConversationListResponse` / `ConversationFilters` (`lib/types/etsy.ts`), mọi tầng import từ đó — không có shape nhân bản |
| Truy vấn production (CHỈ ĐỌC) | 5 script node tạm ở gốc dự án, chạy xong **đã xoá** (`git status` sạch). Không có thao tác ghi/sửa/xoá nào — chỉ `find`/`countDocuments`/`aggregate`/`listDatabases` |

---

## 3. Kiểm tương đương ngữ nghĩa + không giẫm chân (đo trên production, DB `dora-master`)

Mọi phép đo dưới đây dùng đúng hàm dựng filter đã **copy nguyên văn** từ `conversation-read.ts`
(`boardFilter`) và từ `analytics.ts` (`buildBaseMatch` + `UNREAD_EXPR`).

### 3.E — `maxMessages`: server `$or` vs logic client CŨ

So từng `_id` (không so số lượng) giữa tập server và tập theo logic client cũ
`(asNumber(etsy.message_count) ?? 0) < n`, trên tập CusGiftsCo + notReplied:

```
n= 1 server=  0 client=  0 chỉ-server=0 chỉ-client=0 TƯƠNG ĐƯƠNG
n= 2 server=  0 client=  0 chỉ-server=0 chỉ-client=0 TƯƠNG ĐƯƠNG
n= 3 server=  8 client=  8 chỉ-server=0 chỉ-client=0 TƯƠNG ĐƯƠNG
n= 5 server= 13 client= 13 chỉ-server=0 chỉ-client=0 TƯƠNG ĐƯƠNG
n=10 server= 16 client= 16 chỉ-server=0 chỉ-client=0 TƯƠNG ĐƯƠNG
toàn collection: thiếu field `etsy.message_count` = 118 · khớp {field:null} = 118 · kiểu STRING = 0
```

- Doc **thiếu** `etsy.message_count`: 118 doc, và `{ "etsy.message_count": null }` khớp **đúng 118/118**
  ⇒ nhánh `$or … null` là **cần và đủ** để mirror `?? 0` của client. **PASS**
- Rủi ro lý thuyết `message_count` là STRING (`asNumber` parse được nhưng Mongo `$lt` số thì không khớp,
  và `{field:null}` cũng không khớp): **0 doc** kiểu string trên toàn collection ⇒ không hiện thực hoá. Ghi nhận ở GN-04.
- Ranh giới `n <= 0`: client cũ với `maxMessages=0` cho tập **rỗng**, server bỏ qua clause → tập **đầy**.
  Không tới được từ UI vì `BoardToolbar.tsx:98-101` `numOrNull` chỉ trả `> 0` hoặc `null`, và
  `conversation-read.ts:148` cũng chặn `> 0`. Hai lớp guard nhất quán. **PASS**

### 3.F — `waitingHours`: chiều bất đẳng thức

Client cũ giữ khi `(now - lastMessageDate*1000)/3_600_000 >= N` ⇔ `lastMessageDate <= now/1000 - N*3600`
⇒ đúng là `$lte cutoff`. Server dùng `$lte` (`:163`). So từng `_id`:

```
N=  1h server= 16 client= 16 chỉ-server=0 chỉ-client=0 TƯƠNG ĐƯƠNG
N= 24h server=  1 client=  1 chỉ-server=0 chỉ-client=0 TƯƠNG ĐƯƠNG
N= 72h server=  0 client=  0 chỉ-server=0 chỉ-client=0 TƯƠNG ĐƯƠNG
```

**PASS** — không bị lật chiều (`$gte` sẽ cho tập bù, dễ thấy ngay ở N=1h: 16 vs 6).

### 3.D — `waitingHours` và `from/to` KHÔNG giẫm chân nhau

In ra `Object.keys()` của từng phần tử `$and` để chứng minh có **hai** clause `lastMessageDate` riêng biệt:

```
   22 | 7days, no wait            | [["lastMessageDate"],["etsy.has_replied"],["tags"],["user_data.user_id"]]
    1 | 7days + wait 24h          | [["lastMessageDate"],["lastMessageDate"],["etsy.has_replied"],["tags"],["user_data.user_id"]]
    0 | 7days + wait 168h (=7d)   | [["lastMessageDate"],["lastMessageDate"],...]
    1 | all-time + wait 24h       | [["lastMessageDate"],["etsy.has_replied"],...]
    0 | today + wait 24h          | [["lastMessageDate"],["lastMessageDate"],...]   ← hai clause loại nhau, đúng kỳ vọng
```

**PASS.** Hai bằng chứng hành vi (không chỉ bằng chứng cấu trúc):
`7days + wait 168h = 0` (nếu bị merge/ghi đè thì clause sau thắng và phải ra 1, không phải 0);
`today + wait 24h = 0` (giao của "trong hôm nay" và "cũ hơn 24h" = rỗng — chỉ đúng khi cả hai cùng có tác dụng).

### 3.G — `total` không gồm clause cursor

Mô phỏng phân trang thật (sort asc, limit 10) trên preset 7 ngày:

```
trang 1: items=10 · countDocuments(filterNoCursor)=22 · countDocuments(filter CÓ cursor)=22
trang 2: items=10 · countDocuments(filterNoCursor)=22 · countDocuments(filter CÓ cursor)=12
trang 3: items= 2 · countDocuments(filterNoCursor)=22 · countDocuments(filter CÓ cursor)= 2
```

**PASS** — trang 1 không phân biệt được hai cách (đều 22, đúng như contract cảnh báo), nhưng
**đọc code** xác nhận `:220` đếm trên `filterNoCursor`, và trang sau trả `null` (`:218-219`) nên
`pages[0].total` giữ 22 xuyên suốt ⇒ **AC3 đạt về mặt logic** (mẫu số không nhảy lùi 22→12→2).

### 3.6 — Cạm bẫy `rangeForPreset()` / `Date.now()` (QĐ3, AC4)

| Kiểm | Kết quả |
|---|---|
| Mọi nơi gọi `rangeForPreset` | **3 nơi, tất cả hợp lệ**: `app/board/page.tsx:36` (trong `makeDefaultFilters`, chỉ dùng làm **lazy initializer** `useState(makeDefaultFilters)` tại `:44` — truyền HÀM, không gọi hàm); `components/ui/DateRangeFilter.tsx:222` (trong `onClick` — event handler người dùng); `app/page.tsx:16` (dashboard, `useState(() => rangeForPreset("7days"))` — lazy, không đổi so với trước) |
| `rangeForPreset` trong thân render / `useMemo` / `useEffect` / module scope | **0 hit** |
| `Date.now()` / `new Date()` trong đường filter của board | **0 hit** thực thi (`app/board/**`, `components/board/**`, `useConversations.ts`, `ConversationList.tsx`) — chỉ còn 2 lần xuất hiện trong **comment** (`page.tsx:25`, `:89`) |
| `filters` chỉ đổi khi bấm "Lọc" | `applyFilters = useCallback(() => setFilters(draftFilters), [draftFilters])` (`:90`) — không đọc lại giờ; date filter chỉ chạm `draftFilters` (`:81-83`) |
| `filtersDirty` lúc mount | `filters` và `draftFilters` seed từ **cùng một object** `initialFilters` (`:44-50`) ⇒ `JSON.stringify` bằng nhau ⇒ nút "Lọc" không sáng vô cớ |
| `refetchInterval` / `staleTime` mới | **0** — hook không thêm gì (`useConversations.ts:40-45`) |

⇒ **AC4/AC5 đạt ở mức tĩnh** (không thể tái hiện refetch vô hạn bằng đọc code). Xem GN-01 về phần
còn lại cần xác nhận trên trình duyệt.

---

## 4. PHÂN XỬ xung đột số liệu: 94/51 (orchestrator) vs ~26 (backend) vs 21–23 (QA)

### Kết luận: **DỮ LIỆU TRÔI THẬT — cả hai phép đo đều đúng tại thời điểm của nó.** Không có phép đo nào dùng sai điều kiện.

Bằng chứng, theo thứ tự loại trừ:

**(a) Điều kiện đo là như nhau, và không biến thể nào cho ra 94.** Quét ma trận định nghĩa "chưa trả lời"
trên `dora-master` (shop `user_data.user_id = 959147842` = CusGiftsCo, đã xác nhận qua `user_data.shop_name`):

```
    21 all |     21 7d | CusGiftsCo · has_replied:false + tags $nin [handled,approved]   ← ĐÚNG contract
    24 all |     21 7d | CusGiftsCo · has_replied:false + tags $nin [handled]
   195 all |     21 7d | CusGiftsCo · has_replied:false (KHÔNG lọc tag)
    21 all |     21 7d | CusGiftsCo · has_replied $ne true + tags $nin
    28 all |     28 7d | MỌI shop   · has_replied:false + tags $nin [handled,approved]
    42 all |     29 7d | MỌI shop   · has_replied:false + tags $nin [handled]
  1657 all |     32 7d | MỌI shop   · has_replied:false (KHÔNG lọc tag)
    56 all |     29 7d | MỌI shop   · has_replied $ne true + tags $nin
```

Không ô nào ≈ **94 all / 51 7d**, kể cả khi nới định nghĩa. ⇒ giả thuyết "một bên dùng sai điều kiện"
**không** giải thích được con số 94.

**(b) Không phải sai DB** (mẫu bug đặc thù #1 của skill). Đã liệt kê toàn bộ DB trên cả hai cluster:

| Cluster | DB | `conversations` | CusGiftsCo notReplied all / 7d / today |
|---|---|---|---|
| prod (`207.244.244.118`) | **`dora-master`** ← `.env.production.local` | 65 339 | 22 / 22 / 13 |
| prod | `dora` | 0 doc | – |
| prod | `dora-dev` | 41 314 | 17 / 0 / 0 |
| local (`127.0.0.1`) | `dora` ← `.env.local` dev | 1 993 | 16 / 0 / 0 |
| cả hai | `meta_local` | **KHÔNG TỒN TẠI** | – |

Không DB nào cho 94/51. (Ghi nhận riêng: `CLAUDE.md` và `lib/db/collections.ts:20` nói DB mặc định là
`meta_local`, nhưng DB đó **không tồn tại** trên cả hai cluster — xem GN-03.)

**(c) Bằng chứng dương cho giả thuyết "shop vừa trả lời hàng loạt":** trong đúng phiên làm việc này,
CusGiftsCo đã chuyển **285** hội thoại sang `etsy.has_replied: true` (theo `updated_at` trong hôm nay, UTC):

```
CusGiftsCo: has_replied=true & updated_at hôm nay (UTC) = 285
→ theo giờ UTC: 01h=95  02h=159  03h=31
CusGiftsCo: CÓ tag handled/approved & updated_at hôm nay = 0      ← KHÔNG phải gắn tag hàng loạt
messages: tin nhân viên gửi hôm nay (mọi shop)          = 633
```

Tốc độ ~95–160 hội thoại/giờ. Khoảng cách 94 → 26 (68 hội thoại) hoàn toàn nằm trong 1 giờ làm việc
⇒ số liệu của architect (đo lúc ~01h UTC) và của backend (đo lúc ~02h UTC) **đều đúng**, chỉ khác mốc thời gian.
Chính tôi cũng thấy con số tiếp tục tụt **23 → 22 → 21** qua 3 lần chạy script cách nhau vài phút.

**(d) Loại trừ "gắn tag hàng loạt":** nhóm 174 doc `has_replied:false` + CÓ tag `handled/approved` + cũ hơn 7 ngày
(chính là nhóm biến 195 thành 21) có `updated_at` rải rác **2026-02 → 2026-08**, mỗi ngày 1–2 doc, **không có doc nào
sửa hôm nay** ⇒ tag không phải nguyên nhân của cú tụt hôm nay; nguyên nhân là **trả lời thật**.

**(e) Hệ quả cho nghiệm thu:** cảnh báo của backend-engineer là **đúng** — hiện tại
`all-time == 7days == 30days == 90days == 21~23` nên **AC1 và AC2 không còn phân biệt được**.
Đó là trạng thái dữ liệu, KHÔNG phải bug. Preset phân biệt được là **"Hôm nay"** (13 vs 22) và **1 ngày** (21 vs 23).
Lý do: hội thoại chưa trả lời cũ nhất của shop hiện chỉ là `2026-09-13T01:18Z` (phân bố:
`2026-09-14 = 12`, `2026-09-13 = 10`) — backlog cũ đã được trả lời/gắn tag hết.

---

## 5. NGHIỆM THU THẬT: số Board vs số Dashboard, cùng shop + cùng khoảng ngày

Chạy **song song trong một script**: (a) `countDocuments` với filter y nguyên của
`getConversations({notReplied:true, shopIds:[959147842], from, to})`; (b) pipeline y nguyên của Dashboard
(`buildBaseMatch({from,to})` + `$group` theo `user_data.user_id` + `$sum {$cond: [UNREAD_EXPR,1,0]}`),
rồi lấy đúng dòng shop 959147842.

| Preset | Board `total` | Dashboard "CHƯA TRẢ LỜI" (shop) | Dashboard total (shop) | Dashboard unread (mọi shop) | Khớp? |
|---|---|---|---|---|---|
| Tất cả | 23 | 23 | 14 902 | 30 | **MATCH** |
| **Hôm nay** | **13** | **13** | 296 | 20 | **MATCH** ← preset chứng minh clause ngày CÓ tác dụng |
| 1 ngày | 21 | 21 | 304 | 28 | **MATCH** |
| 7 ngày | 23 | 23 | 392 | 30 | **MATCH** |
| 30 ngày | 23 | 23 | 597 | 30 | **MATCH** |
| 90 ngày | 23 | 23 | 1 055 | 30 | **MATCH** |

**6/6 preset khớp tuyệt đối.** Đây là phép nghiệm thu có giá trị chứng minh (thay cho AC1/AC2 đang bị
dữ liệu làm mù): cột "Hôm nay" **13 ≠ 23** chứng minh clause `lastMessageDate` thật sự bite, và Board
ra **đúng cùng con số** với Dashboard trên cùng khoảng.

Vì sao hai định nghĩa tương đương (đã đối chiếu code, không chỉ đối chiếu số):
- Dashboard `UNREAD_EXPR` (`analytics.ts:76-86`): `$eq: ["$etsy.has_replied", false]` + `$size($setIntersection($ifNull($tags,[]), HANDLED)) == 0`.
- Board (`conversation-read.ts:170-173`): `{"etsy.has_replied": false}` + `{tags: {$nin: ["handled","approved"]}}`.
- Doc **thiếu** `etsy.has_replied`: MQL `{field: false}` KHÔNG khớp missing; `$eq[missing, false]` cũng false ⇒ trùng.
- Doc **thiếu** `tags`: `$nin` khớp missing; `$ifNull($tags,[])` → giao rỗng ⇒ trùng.
- Khoảng ngày: cả hai đều `lastMessageDate {$gte: from, $lte: to}` (`conversation-read.ts:140-143` vs `analytics.ts:53-58` `dateClause`) — cùng field, cùng biên đóng.

**AC còn phải kiểm trên trình duyệt (QA tĩnh không thay được):** AC4 (60s không request mới),
AC5 (bấm preset chưa bấm Lọc → 0 request), AC6 (query string thật có `maxMessages=3&waitingHours=24`),
AC3 (mẫu số đứng yên khi 20→50→100). Xem GN-01.

---

## 6. Danh sách finding

### CHẶN MERGE — **không có**

### NÊN SỬA

**F-01 · `shown` có thể LỚN HƠN `total` → triệu chứng "mẫu số < tử số" quay lại (nguyên nhân mới)**
· Seam: `total` · Tầng lệch: **4** (component), không phải lỗi backend
· Bằng chứng: `app/board/page.tsx:129-147` `retainedItems` **tích luỹ đơn điệu** mọi item đã thấy trong
phiên lọc (cơ chế "retain" cố ý, `:95-98`), rồi `shown = cells.length`; còn `total` (`BoardToolbar.tsx:111`)
là `countDocuments` **tươi** lấy từ lần refetch gần nhất.
· Kịch bản tái hiện (rất thường gặp vì board là nơi người dùng **gửi trả lời**): mở board với
`notReplied=true`, `total=22`, gửi 5 trả lời từ board → refetch → server còn 17 → `total=17`, nhưng 5 hội thoại
vừa trả lời vẫn hiển thị (retain) → nhãn ra **"Hiện 22 / 17"**. Đúng loại nhãn gây hoang mang mà lượt này đi sửa.
· Ghi nhận: điều kiện render hiện tại là `total != null && total !== shown` nên nó **không** che được
trường hợp này (chỉ che trường hợp bằng nhau).
· Sửa gợi ý (nhỏ, chỉ 1 tầng UI, không chạm contract): đổi `total !== shown` → `total > shown` tại
`components/board/BoardToolbar.tsx:111`. Khi `total < shown` (đã retain nhiều hơn tập server) thì chỉ hiện
"Hiện 22 hội thoại khớp bộ lọc" — trung thực, không nói dối theo cả hai chiều. Nếu muốn giữ thông tin,
phương án B: `/ {Math.max(total, shown)}`.
· **Chưa tự sửa** — thuộc tầng frontend và là quyết định về copy UI; đã gửi `frontend-engineer`.

**F-02 · `maxMessages` / `waitingHours` mất giá trị khi user gõ rồi xoá ô, nhưng chỉ ở trạng thái trung gian**
· Seam: `maxMessages` · Tầng: **4**
· Bằng chứng: `BoardToolbar.tsx:98-101` `numOrNull(raw)` dùng `parseInt` → gõ `"0"` hoặc `"-1"` → trả `null`
(= "không lọc") thay vì cảnh báo; ô số `min={1}` nhưng người dùng vẫn gõ tay được `0`.
· Hệ quả: gõ `0` vào "Dưới … tin nhắn" → im lặng thành **bỏ lọc** (kết quả nhiều hơn), trong khi ý người
dùng gần như chắc chắn là "lọc gì đó". Server cũng chặn `> 0` (`conversation-read.ts:148`) nên hai tầng
**nhất quán** — đây là vấn đề phản hồi UX, không phải lệch shape.
· Sửa gợi ý: giữ nguyên logic, thêm `title`/placeholder nói rõ "để trống = không lọc", hoặc dùng
`Math.max(1, n)` để `0` → `1`. Mức thấp, có thể để lượt sau.

### GHI NHẬN

**GN-01 · 4 AC hành vi chưa kiểm được (cần trình duyệt).** AC3 (mẫu số đứng yên khi đổi Page Size),
AC4 (60s idle → 0 request), AC5 (đổi preset chưa bấm Lọc → 0 request), AC6 (query string thật).
QA tĩnh đã loại hết **nguyên nhân đã biết** của AC4/AC5 (mục 3.6: 0 chỗ gọi `rangeForPreset` trong render,
0 `Date.now()` trong đường filter, không `refetchInterval`, `filters` chỉ đổi ở `applyFilters`) và đã chứng minh
AC3/AC6 ở tầng logic (mục 3.G, mục 1). Cần 1 lượt kiểm DevTools trước khi merge để đóng hẳn.

**GN-02 · Shim `components/dashboard/DashboardDateFilter.tsx` đang UNTRACKED.**
`git status`: `RM components/dashboard/DashboardDateFilter.tsx -> components/ui/DateRangeFilter.tsx`
(rename đã staged) + `?? components/dashboard/DashboardDateFilter.tsx` (shim 1 dòng chưa `git add`).
Nếu commit như hiện tại, shim **không** vào commit. Hiện **không sao** vì grep toàn repo cho thấy
**không ai** import tên `DashboardDateFilter` nữa (`app/page.tsx:4` đã đổi sang `@/components/ui/DateRangeFilter`),
và không có file mồ côi nào khác. Đề nghị: hoặc `git add` shim (đúng ý F2 "chặn vỡ nếu có nhánh khác"),
hoặc xoá hẳn cho gọn — chọn một, đừng để lửng.
Dashboard **không hồi quy**: `app/page.tsx:41` truyền đúng 3 prop cũ (`presetKey`/`range`/`onChange`),
`DateRangeFilter` chỉ thêm prop **optional** `className` (`components/ui/DateRangeFilter.tsx:18,217`),
markup/hành vi bên trong không đổi; dashboard không truyền `className` nên giữ `gap-2` như trước.

**GN-03 · `meta_local` không tồn tại trên cả hai cluster.** `lib/db/collections.ts:20` mặc định
`process.env.MONGODB_DB || "meta_local"` và `CLAUDE.md` mô tả "đa DB `meta_local` + `dora-master`",
nhưng `listDatabases` trên cluster prod (`dora-master`, `dora-dev`, `dora`, …) và trên local
(`dora`, …) **không có** `meta_local`. Thực tế: prod đọc `dora-master`, dev đọc `dora` (local).
⇒ nếu ai đó chạy thiếu `MONGODB_DB`, app sẽ lặng lẽ đọc một DB rỗng. Ngoài phạm vi lượt này
(không phải regression), nhưng nên cập nhật mặc định/tài liệu. Dù vậy, **tất cả** truy vấn trong lượt này
đều đi qua `getConversationsCollection()` (cùng `DB_NAME`) ở cả Board và Dashboard ⇒ hai trang chắc chắn
đọc cùng một DB, không có bug "sai DB" trong seam đang QA.

**GN-04 · Biên `waitingHours` dịch theo từng request phân trang.** `cutoff` tính lại ở **mỗi** request
(`conversation-read.ts:162`), kể cả request có `cursor`. Cutoff tăng theo thời gian ⇒ trang sau **nới lỏng**
hơn trang đầu vài giây. Với `sort=asc` + cursor tiến, hệ quả tối đa là vài item sát biên xuất hiện ở trang sau
mà `total` (đếm lúc trang đầu) chưa tính. Cùng hạng với lệch clock client/server đã ghi trong QĐ5 —
**chấp nhận**, chỉ ghi để QA sau không truy sai hướng. Muốn triệt: client gửi `waitingBefore` (mốc tuyệt đối
đã snapshot) thay vì `waitingHours` — nhưng như thế lại nhét `Date.now()` vào queryKey, đúng thứ QĐ3 cấm.
**Không đề nghị đổi.**

**GN-05 · `etsy.message_count` kiểu STRING sẽ phá tương đương (hiện chưa có doc nào).**
Nếu tương lai có doc lưu `message_count: "2"`, client cũ coi là `2` (`asNumber` parse string,
`etsy-utils.ts:6-8`) nhưng Mongo `$lt: 3` không khớp string và `{field: null}` cũng không ⇒ doc bị loại.
Hiện đo được **0 doc** kiểu string trên 65 339 doc ⇒ không hiện thực hoá. Ghi để sau này thêm `$type` nếu nguồn sync đổi.

---

## 7. Tóm tắt trạng thái AC

| AC | Nội dung | Trạng thái |
|---|---|---|
| AC1 | Board 7 ngày == Dashboard 7 ngày (CusGiftsCo, notReplied) | **ĐẠT** (23 == 23) — nhưng **mất khả năng phân biệt** vì all-time cũng = 23 (xem mục 4e) |
| AC2 | Board "Tất cả" ≈ Dashboard "Tất cả" | **ĐẠT** (23 == 23). Baseline 94 trong contract đã LỖI THỜI |
| — | *(bù cho AC1/AC2)* Board "Hôm nay" == Dashboard "Hôm nay" **và ≠ all-time** | **ĐẠT — 13 == 13, khác 23** ⇒ clause ngày thật sự có tác dụng |
| AC3 | `total` không đổi khi nạp thêm trang | **ĐẠT ở tầng logic** (mục 3.G) · cần xác nhận DevTools (GN-01) |
| AC4 | 60s idle → 0 request | **CHƯA KIỂM ĐƯỢC** · mọi nguyên nhân đã biết đã bị loại (mục 3.6) |
| AC5 | Đổi preset chưa bấm Lọc → 0 request, nút Lọc sáng | **ĐẠT ở tầng logic** (`onDateChange` chỉ chạm draft) · cần DevTools |
| AC6 | `maxMessages=3&waitingHours=24` lên query, `total` giảm đúng | **ĐẠT ở tầng dữ liệu**: 7d=22 → +max3 = 8 → +wait24h = 1 (mục 3.D/3.E) · cần DevTools cho query string |
| AC7 | Messenger sidebar không hồi quy | **ĐẠT** (mục 1, bất biến #4) |
| AC8 | `npx tsc --noEmit` sạch | **ĐẠT** (EXIT 0) + `npm run build` EXIT 0 |

---

## 8. Ghi chú về tính tái lập của số liệu

Dữ liệu shop đang trôi ~95–160 hội thoại/giờ (mục 4c). Mọi con số trong báo cáo này là snapshot
**2026-09-14 ~03:20–03:25 UTC**; đo lại sau vài giờ sẽ ra số khác. Phần **không** phụ thuộc thời điểm và
là phần cần bảo vệ khi merge: **Board `total` == Dashboard unread trên cùng khoảng ngày** (6/6 preset),
và **hai tập lọc `maxMessages`/`waitingHours` tương đương từng `_id` với logic client cũ**.
