---
name: dora-backend-patterns
description: Convention backend THẬT của dora-1 (messengerMeta) — service layer, API route Next.js App Router, native MongoDB driver, đa DB (meta_local + dora-master), parse phòng thủ payload Etsy/Meta, projection. Dùng skill này bất cứ khi nào viết/sửa file trong lib/services, lib/db, hoặc app/api/*/route.ts. Cũng dùng khi thêm collection, đổi shape response, hoặc thêm endpoint mới. KHÔNG dùng cho code frontend/hook (xem dora-frontend-patterns).
---

# dora-1 Backend Patterns

Convention hiện thực tầng dữ liệu + API của dora-1. Bám mẫu Orders làm chuẩn vàng: `lib/services/orders-read.ts` → `app/api/orders/route.ts` → type trong `lib/types/etsy.ts`.

## Kiến trúc 3 tầng

```
app/api/<x>/route.ts   ── parse query param → gọi service → NextResponse.json(result)
lib/services/<x>.ts    ── logic thuần, trả type từ lib/types, KHÔNG biết tới Request/Response
lib/db/collections.ts  ── collection getter, chọn DB, ensure index
```

Type contract dùng CHUNG: service `Promise<T>` → route trả `T` dạng JSON → hook cast `as T`. Một type, khai trong `lib/types/*.ts`. Không định nghĩa shape trùng lặp ở nhiều nơi.

## MongoDB — native driver, đa DB

- Dùng collection getter trong [collections.ts](../../lib/db/collections.ts), **không** viết `client.db(...)` rải rác. Mongoose có trong deps nhưng read path dùng native driver (`Filter`, `WithId` từ `"mongodb"`).
- **Hai DB — nhớ đúng nguồn:**
  - `meta_local` (env `MONGODB_DB`): conversations, messages, auto_reply_messages, sheet_*, order_statuses, message_templates, personalization_files, reply_examples, ai_suggestion_events, tracking_jobs.
  - `dora-master` (env `DORA_STORES_DB`): **stores, etsy_orders, order_tracking** — ghi bởi extension/dora-backend. Getter của các collection này bỏ qua `getDb()` và gọi thẳng `client.db(STORES_DB_NAME)`.
- Thêm collection mới → thêm 1 getter vào `collections.ts` + type Doc trong `lib/types`, ensure index trong `lib/db/indexes.ts` nếu cần query nặng.

## Parse phòng thủ payload Etsy/Meta

Payload lưu nguyên trong `doc.data` và KHÔNG đảm bảo shape. Không truy cập field lồng sâu trực tiếp. Dùng helper trong [etsy-utils.ts](../../lib/services/etsy-utils.ts):

- `getPath(obj, "a.b.c")` — lấy field lồng, undefined-safe.
- `asNumber / asString` — ép kiểu an toàn, trả undefined nếu sai kiểu.
- `firstNumber(data, [path1, path2])` / `firstString(...)` — thử nhiều nguồn theo thứ tự ưu tiên (payload Etsy có nhiều field trùng nghĩa).
- `decodeHtmlEntities` — luôn dùng cho text hiển thị (tên, địa chỉ, title).
- `isObject` — guard trước khi đọc field.

Khi có nhiều nguồn cho một field, ưu tiên nguồn chuẩn và **comment tại sao** (xem `resolveOrderShop`: dùng shop_id→map thay vì `from_address.name` để tránh ra tên cá nhân người bán).

## Query list — projection + song song

- Khai `LIST_PROJECTION as const` chỉ gồm field cần cho card/list, tránh kéo block nặng (actions, tax…).
- Gộp count + find + enrich bằng `Promise.all` (xem `getOrders`: đếm 2 tab cho badge + lấy trang + map shop song song).
- Phân trang: `skip/limit`, `PAGE_SIZE` hằng số export, trả `{ items, page, pageSize, total, totalPages, ... }`. Lưu ý deep skip là O(n) — chấp nhận ở quy mô hiện tại, comment rõ.
- Enrich sau (tracking, ảnh personalization) đọc theo id của trang hiện tại, không N+1.

## API route

- File `app/api/<x>/route.ts`, export `GET/POST/...`. Đọc query qua `new URL(req.url).searchParams` hoặc `req.nextUrl.searchParams`.
- Ép/validate param (trim, `Number()`, default) TRƯỚC khi truyền vào service; service nhận opts đã sạch.
- Trả `NextResponse.json(result)`; lỗi trả status phù hợp. Không nhét logic DB vào route.

## Checklist trước khi báo xong

- [ ] Service trả đúng type contract trong `lib/types` (không cast `any`).
- [ ] Đúng DB (`meta_local` vs `dora-master`).
- [ ] Field lồng sâu đều qua `getPath/firstString`, text qua `decodeHtmlEntities`.
- [ ] Projection đủ MỌI field mà frontend sẽ đọc (thiếu → bug ranh giới QA sẽ bắt).
- [ ] `npm run build` (hoặc `tsc --noEmit`) sạch.
- [ ] Comment tiếng Việt giải thích *tại sao* ở chỗ fallback/nhạy cảm.
