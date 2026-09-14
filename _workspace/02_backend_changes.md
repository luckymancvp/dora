# 02 — Backend changes: date range + maxMessages/waitingHours + `total` thật

Ngày: 2026-09-14 · Nhánh: `fix/mera-connection` · Backend: backend-engineer
Contract nguồn: `_workspace/01_architect_contract.md` (§1, §3 B1–B6, §5 QĐ4/QĐ5)

## Trạng thái task

| Task | File | Trạng thái |
|---|---|---|
| B1 mở rộng `ConversationFilterOpts` | `lib/services/conversation-read.ts` | XONG |
| B2 clause `lastMessageDate` từ `from`/`to` | `lib/services/conversation-read.ts` | XONG |
| B3 `maxMessages` + `waitingHours` xuống Mongo | `lib/services/conversation-read.ts` | XONG |
| B4 `total` = `countDocuments(filterNoCursor)` | `lib/services/conversation-read.ts` | XONG |
| B5 parse query param mới | `app/api/conversations/route.ts` | XONG |
| B6 index | `lib/db/indexes.ts` | **KHÔNG LÀM** (đã đo: 230–550ms, xem mục Đo hiệu năng) |

Không đụng: `mapConversation`, `LIST_PROJECTION`, logic cursor/sort, `lib/types/etsy.ts`.

## Diff chính

### `lib/services/conversation-read.ts`

1. **`ConversationFilterOpts`** thêm `from?`, `to?`, `maxMessages?`, `waitingHours?` (đều `number | null`, optional → caller cũ không vỡ).

2. **Cursor tách khỏi `clauses`** (điều kiện tiên quyết của B4):

```ts
const cursorClause: Record<string, unknown> | null = cursor
  ? { $or: asc ? [/* ... */] : [/* ... */] }   // nội dung $or y nguyên như trước
  : null;
```

3. **Ba clause mới, đặt ngay sau khối `search`, mỗi cái là một phần tử RIÊNG của `clauses`:**

```ts
const dateRange: Record<string, number> = {};
if (typeof opts.from === "number" && Number.isFinite(opts.from)) dateRange.$gte = opts.from;
if (typeof opts.to === "number" && Number.isFinite(opts.to)) dateRange.$lte = opts.to;
if (Object.keys(dateRange).length > 0) clauses.push({ lastMessageDate: dateRange });

if (typeof opts.maxMessages === "number" && opts.maxMessages > 0) {
  clauses.push({ $or: [
    { "etsy.message_count": { $lt: opts.maxMessages } },
    { "etsy.message_count": null },   // khớp CẢ doc THIẾU field — mirror asNumber(...) ?? 0
  ]});
}

if (typeof opts.waitingHours === "number" && opts.waitingHours > 0) {
  const cutoff = Math.floor(Date.now() / 1000) - opts.waitingHours * 3600;
  clauses.push({ lastMessageDate: { $lte: cutoff } });  // clause RIÊNG, KHÔNG merge với dateRange
}
```

4. **Hai filter + `Promise.all`:**

```ts
const filterNoCursor = clauses.length > 0 ? { $and: clauses } : {};
const filter = cursorClause ? { $and: [...clauses, cursorClause] } : filterNoCursor;

const [docs, total] = await Promise.all([
  coll.find(filter, { projection: LIST_PROJECTION })
      .sort({ lastMessageDate: sortDir, _id: sortDir }).limit(limit + 1).toArray(),
  cursorClause ? Promise.resolve<number | null>(null) : coll.countDocuments(filterNoCursor),
]);
return { items: page.map(mapConversation), nextCursor, total };
```

### `app/api/conversations/route.ts`

- Comment đầu file: `// GET /api/conversations?cursor=&limit=&search=&from=&to=&maxMessages=&waitingHours=`
- Thêm helper module-scope `numOrNull(raw: string | null): number | null` (thiếu / rỗng / NaN ⇒ `null` ⇒ không lọc).
- Truyền thêm `from`, `to`, `maxMessages`, `waitingHours` vào `getConversations`.

## Hợp đồng endpoint (cho frontend + QA)

`GET /api/conversations`

| Param | Kiểu | Thiếu ⇒ | Ghi chú |
|---|---|---|---|
| `cursor` | base64url `{d,id}` | trang đầu | **có cursor ⇒ `total: null`** |
| `limit` | number 1..100 | 30 | clamp ở service |
| `search` | string | không lọc | |
| `notReplied` `hasOrder` `orderHelp` `hasNote` | `"true"` | false | |
| `shopIds` `tags` `sheetStatuses` | CSV | không lọc | |
| `sort` | `asc` \| `desc` | `desc` | |
| `from` `to` | unix **giây** | không giới hạn | `lastMessageDate $gte from` / `$lte to` |
| `maxMessages` | number > 0 | không lọc | `etsy.message_count < n` **hoặc** thiếu field |
| `waitingHours` | number > 0 | không lọc | cutoff = **giờ SERVER** `now - n*3600`; `lastMessageDate $lte cutoff` |

`datePreset` KHÔNG tồn tại ở backend — nếu gửi lên sẽ bị bỏ qua.

Response = `ConversationListResponse` (`lib/types/etsy.ts`), không có lớp bọc nào khác.

Trang đầu (`?shopIds=959147842&notReplied=true&from=...&to=...&sort=asc&limit=30`):

```json
{
  "items": [
    {
      "conversationId": 2891234567,
      "name": "Jane Doe",
      "avatar": "https://i.etsystatic.com/...",
      "excerpt": "Hi, can I change the name on...",
      "lastMessageDate": 1789245001,
      "messageCount": 2,
      "hasReplied": false,
      "shopUserId": 959147842,
      "tags": ["order-help"]
    }
  ],
  "nextCursor": "eyJkIjoxNzg5MjQ1MDAxLCJpZCI6IjY4YzEyMzQ1Njc4OWFiY2RlZjAxMjM0NSJ9",
  "total": 26
}
```

Trang sau (`?cursor=...`): `{ "items": [...], "nextCursor": null, "total": null }` — `total` **luôn** `null` khi có `cursor`.
Lỗi: `{ "error": "<message>" }` status 500 (không đổi).

## Xác minh trên dữ liệu THẬT (production, CHỈ ĐỌC)

Cluster từ `.env.production.local`, DB **`dora-master`** (cluster này KHÔNG có `meta_local`; `MONGODB_DB=dora-master`), collection `conversations`, `estimatedDocumentCount = 65339`.
Đã xác nhận `user_data.user_id = 959147842` ⇒ `user_data.shop_name = "CusGiftsCo"` (khớp doc trong `stores`); shop này có 14 902 hội thoại.

Đếm bằng **đúng** filter mà service dựng:

| Điều kiện (shop CusGiftsCo + notReplied) | Đo được | Latency |
|---|---|---|
| all-time | **27** → **26** (2 lần chạy cách nhau ~1 phút) | 552ms / 241ms |
| 7 ngày (`from = now-7d`, `to = now`) | **27** → **26** | 241ms |
| 7 ngày + `maxMessages=3` | **10** | 235ms |
| 7 ngày + `waitingHours=24` | **7** | 230ms |
| 7 ngày + `maxMessages=3` + `waitingHours=24` | **3** | 245ms |

Mọi shop + notReplied (để thấy clause ngày có tác dụng thật):
all-time **34** · 30 ngày **34** · 7 ngày **34** · **1 ngày 28** · 7d + wait24h **6** · 7d + max3 **11**.

**CẢNH BÁO CHO QA — baseline 94/51 trong contract đã LỖI THỜI.** Dữ liệu live đã trôi mạnh:
CusGiftsCo not-replied hiện chỉ còn **~26**, và **all-time == 7 ngày** (mọi hội thoại chưa trả lời của
shop đều nằm trong 7 ngày qua). Hệ quả: **AC1 và AC2 tạm thời KHÔNG phân biệt được** — hai preset sẽ
ra cùng con số, đó là ĐÚNG chứ không phải bug. Muốn kiểm clause ngày có bite thật, dùng preset
**"Hôm nay" / 1 ngày** (34 → 28 ở mức toàn bộ shop) hoặc so 1 ngày vs all-time.
Tiêu chí còn nguyên giá trị: `total` của API **phải bằng** cột Dashboard cùng preset (cùng snapshot `to`).

Kiểm tra riêng semantics `maxMessages` (QĐ5): **118 doc thiếu hẳn field `etsy.message_count`**, và
`{ "etsy.message_count": null }` khớp đúng **118/118** doc đó ⇒ nhánh `$or … null` là cần thiết và đủ
để giữ hành vi "thiếu = 0" của client. (Trong tập 7 ngày hiện tại chưa có doc nào thiếu field nên
`$lt`-only và `$or` tình cờ cùng ra 11 — đừng dùng riêng tập đó để kết luận.)

## Đo hiệu năng → chốt KHÔNG làm B6

`countDocuments` với full predicate (`$nin` + `$in` + `etsy.has_replied`) trên 65 339 doc:
**230–550ms** (lần đầu cold 552ms, các lần sau ~240ms). Chạy `Promise.all` cùng `find` nên không cộng
vào latency tổng, và chỉ đánh 1 lần / bộ lọc (trang đầu). Chưa đủ lý do thêm index → **không sửa
`lib/db/indexes.ts`** (đúng chỉ dẫn "không tự thêm nếu chưa đo"). Nếu collection lên ~500k doc thì
`{ "user_data.user_id": 1, lastMessageDate: -1 }` là ứng viên đầu tiên.

## Quyết định nhỏ tự chốt

1. **`numOrNull` đặt ở module scope** của route (không trong `GET`) — hàm thuần, không tạo lại mỗi request.
2. **Chặn `<= 0`**: `maxMessages` / `waitingHours` chỉ áp khi `> 0`. `maxMessages=0` nghĩa là "dưới 0 tin" (luôn rỗng) — gần như chắc chắn là lỗi nhập, nên coi như không lọc. `from`/`to` chỉ cần `Number.isFinite`.
3. **`cursorClause` gắn ở CUỐI mảng `$and`** (`[...clauses, cursorClause]`) — Mongo không quan tâm thứ tự; đặt cuối để `filterNoCursor` là prefix, dễ soi trong log/explain.
4. **Khi không có filter nào**, `filterNoCursor = {}` và `countDocuments({})` vẫn chạy (đo 328ms trên 65k doc) — chấp nhận, không thêm nhánh đặc biệt.
5. **`total` là `number` kể cả khi bằng 0**; chỉ `null` khi có `cursor`. Consumer đọc `pages[0].total`.
6. **Cutoff `waitingHours` dùng giờ server, `from`/`to` dùng giờ client** (đúng QĐ5) — lệch clock chỉ ảnh hưởng biên vài giây.

## Typecheck

`npx tsc --noEmit` trên riêng 3 file backend (qua tsconfig tạm, đã xoá): **0 lỗi**.
Chạy toàn project hiện dừng ở `TS6053: components/dashboard/DashboardDateFilter.tsx not found` —
frontend-engineer đang thực hiện F2 (di chuyển file sang `components/ui/DateRangeFilter.tsx`), không
thuộc phạm vi backend.
