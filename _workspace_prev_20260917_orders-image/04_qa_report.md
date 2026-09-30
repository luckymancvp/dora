# 04 — QA tích hợp: "Dán ảnh vào panel Nhắn khách" (Orders)

Ngày: 2026-09-17 · Đầu vào: `01_architect_contract.md` (S1–S8), `02_backend_changes.md`, `03_frontend_changes.md`
Phạm vi kiểm: dora-1 + ranh giới ngoài repo (`D:\Pamo\DORA\dora-extension`) + hồi quy `order-conversation*` / `shop-read`.

## 0. Kiểm chứng bằng thực thi

| Lệnh | Kết quả |
|------|---------|
| `npx tsc --noEmit` | **exit 0**, 0 lỗi |
| `npx next build` | **✓ Compiled successfully in 8.0s**, 0 error/warning |
| `next dev -p 3098` + curl 7 case vào chính handler `POST /api/orders/message` | xem bảng dưới |

⚠️ `next.config.mjs:3-5` đặt `typescript: { ignoreBuildErrors: true }` → **`next build` KHÔNG typecheck**. Chỉ `tsc --noEmit` mới là bằng chứng về type. Đã chạy cả hai.

### Kết quả curl (chạy thật, không phải suy luận)

`/api/orders/message` bị middleware chặn (xem F1), nên đã dựng alias tạm `app/v1/qatmpqa/route.ts` re-export đúng handler đó (đường `/v1/*` được miễn auth), chạy xong **đã xoá** (`git status` sạch).

| # | Input | HTTP | Body |
|---|-------|------|------|
| T1 | `message:"   "` + 1 ảnh | **400** | `{"error":"shopName, orderId và message bắt buộc"}` → **S5 invariant ĐÚNG** |
| T2 | 11 URL hợp lệ | **400** | `{"error":"Tối đa 10 ảnh mỗi tin"}` → **S8 chốt chặn ĐÚNG** |
| T3 | `attachments:"https://a.jpg"` (string) | 409 | không 400 → tương thích caller cũ ĐÚNG |
| T4 | `["blob:…","data:…",123,null,"https://a/1.jpg"]` | 409 | rác bị lọc, không 400 |
| T5 | đúng 10 URL | 409 | qua được ngưỡng |
| T6 | không có `attachments` | 409 | caller cũ Apps Script ĐÚNG |
| T7 | `x-api-key: WRONG` | 401 | chặn ĐÚNG |

(409 = `shop_offline`, dùng shop giả `__qa_no_such_shop__` nên không có tin nào thật sự được gửi đi.)

## 1. Finding — CHẶN MERGE

Không có finding nào **trong phần code của 2 agent** ở mức chặn merge. Hai mục dưới nằm ở phía extension / middleware và cần quyết định trước khi bật tính năng cho user.

### F1 — `x-api-key` của `/api/orders/message` là code chết (middleware chặn trước)

- **Seam:** S1 (UI/máy → route) · **Tầng lệch:** 2 (route) vs middleware
- **Bằng chứng:**
  - `proxy.ts:16-23` — danh sách miễn auth chỉ có `/api/auth`, `/api/health`, `/api/uploads`, `/api/cron`, `/v1/`. **Không có `/api/orders/message`.**
  - `app/api/orders/message/route.ts:11-18` — nhánh `viaApiKey` chỉ chạy sau khi middleware cho qua.
  - Thực nghiệm: `POST /api/orders/message` kèm `x-api-key` ĐÚNG → **`HTTP/1.1 307` + `location: /login`**, chưa từng chạm route.
- **Mức độ:** **nên sửa (không do feature này gây ra — tiền sử, `proxy.ts` không nằm trong diff)**. Nhưng nó **vô hiệu hoá toàn bộ mục "tương thích caller Apps Script"** ở `02_backend_changes.md` và khiến 6/6 lệnh curl trong báo cáo đó không chạy được như mô tả.
- **Cách sửa:** thêm vào `proxy.ts:16-22` nhánh cho request mang header `x-api-key` (route đã tự verify key), hoặc tối thiểu `pathname === "/api/orders/message"`. Không nên mở cả `/api/*`.

### F2 — Extension gửi tin ảnh với `message` RỖNG ở nhánh đơn chưa có hội thoại

- **Seam:** S5 · **Tầng lệch:** extension
- **Bằng chứng:** `D:\Pamo\DORA\dora-extension\libs\ably.js:454-463` — sau `createOrderConvoMessage` (tin text), ảnh đi ở tin thứ hai:
  `await sendMessage(finalConvoId, '', imageIds);`
- Luồng Messenger đang chạy tốt (`ably.js:568`) **luôn có text** (`data.message.message`), nên chưa có bằng chứng Etsy chấp nhận `message: ""` ở `POST /api/v3/ajax/member/conversations/{id}`.
- **Mức độ:** **chặn merge nếu chưa test tay 1 đơn chưa-có-hội-thoại**. Đây là nhánh DUY NHẤT chưa từng chạy trong production.
- **Cách sửa (nếu Etsy từ chối):** truyền lại `messageBody` hoặc một chuỗi tối thiểu thay cho `''`.

## 2. Finding — NÊN SỬA

### F3 — Trạng thái gửi rơi vào hư không: `extension/order-messages/status/{id}` không tồn tại ở đâu cả

- **Seam:** S2/S3 (vòng phản hồi sau publish) · **Tầng lệch:** extension ↔ backend
- **Bằng chứng:**
  - Gọi: `ably.js:466-471` (`status: 'DONE'`) và `ably.js:483-488` (`status: 'FAILED'`) qua `callBackend` → base `env.BACKEND_ENDPOINT` (Go backend).
  - Go backend `dora-backend\modules\extension\routes.go:11-14` chỉ có `messages/status/:id` và `trackings/status/:id`. `grep -rn "order-messages" --include=*.go` → **0 hit**.
  - dora-1 cũng không có: `app/v1/**` chỉ có `messages/status/[id]`, `trackings/status/[id]`.
  - `libs/backend-api.js:8-37` — `callBackend` nuốt lỗi (`catch → return null`) nên 404 không gây FAILED giả, nhưng **không ai nhận được trạng thái**.
- **Hệ quả kết hợp với fire-and-forget:** `MessageBuyerDialog.tsx:197-203` toast "Đã gửi…" ngay khi Ably nhận publish. Ảnh upload lên Etsy hỏng → user **không bao giờ biết**. Rủi ro này MỚI, vì trước đây panel chỉ gửi text (một bước), giờ có 2-3 bước có thể hỏng giữa chừng.
- **Mức độ:** nên sửa.
- **Cách sửa:** thêm route `POST /v1/extension/order-messages/status/[id]` ở dora-1 (đối xứng `trackings/status/[id]` đã có) + đổi `callBackend` → `callDoraChat` ở `ably.js:467,484`; hoặc bỏ hẳn hai lời gọi đó và ghi rõ trong JSDoc rằng không có kênh báo trạng thái.

### F4 — `upload2Etsy` không kiểm `response.ok` → ảnh hỏng biến thành "gửi tin rỗng" im lặng

- **Seam:** S3 → Etsy · **Tầng lệch:** extension
- **Bằng chứng:** `libs/etsy-message.js:83-85` — `const result = await uploadResponse.json(); return result.image_id;`, không kiểm `uploadResponse.ok`. Etsy trả lỗi JSON → `image_id` = `undefined` → `uploadOrderAttachments` (`etsy-message.js:211-216`) trả `{0: undefined}` → `sendMessage` (`etsy-message.js:20-23`): `Object.keys(...).length > 0` là TRUE nhưng `JSON.stringify({0: undefined})` === `"{}"` → tin gửi đi **không có ảnh**, không lỗi.
- Ở nhánh F2 hệ quả nặng hơn: gửi tin **rỗng + không ảnh**.
- **Mức độ:** nên sửa (tiền sử, dùng chung với Messenger, nhưng feature mới làm nó lộ ra).
- **Cách sửa:** trong `upload2Etsy` thêm `if (!uploadResponse.ok) throw ...` và `if (!result.image_id) throw ...`.

### F5 — UI không chặn > 10 ảnh → upload lãng phí rồi mới 400

- **Seam:** S8 · **Tầng lệch:** 4 (component)
- **Bằng chứng:** `components/orders/MessageBuyerDialog.tsx:147-169` (`onPaste` append vô điều kiện), `:174-186` (`send` không đếm). Route chặn ở `app/api/orders/message/route.ts:44-46`.
- Ảnh thứ 11 vẫn đã nằm vĩnh viễn trên Vercel Blob (tốn tiền, không ai xoá) trước khi user thấy lỗi.
- **Cách sửa:** trong `onPaste` cắt `imageFiles` theo `10 - attachments.length` + `toast.error("Tối đa 10 ảnh mỗi tin")`.

### F6 — File sai MIME bị bỏ IM LẶNG khi dán nhiều ảnh

- **Seam:** S7 · **Tầng lệch:** 4 ↔ `lib/upload-image.ts`
- **Bằng chứng:** `lib/upload-image.ts:26` — `if (f.type && !ALLOWED_IMAGE_TYPES.has(f.type)) continue;` (bỏ qua, không báo). `MessageBuyerDialog.tsx:158-161` chỉ toast khi `urls.length === 0`.
- Dán 3 ảnh trong đó 1 ảnh `image/bmp`/`image/svg+xml` (lọt qua bộ lọc `type.startsWith("image/")` ở `MessageBuyerDialog.tsx:149`) → mất 1 ảnh, **không thông báo**.
- **Cách sửa:** `uploadImageFiles` trả `{ urls, skipped }`, hoặc so `urls.length !== imageFiles.length` ở caller để toast cảnh báo.

### F7 — `resolveShopUserIdByName` gọi lại mỗi request, không cache (hồi quy)

- **Seam:** thread panel · **Tầng lệch:** 1 (service)
- **Bằng chứng:** `lib/services/order-conversation.ts:120` gọi mỗi lần `getOrderConversation`. Panel poll tới **9 lần/24s** (`MessageBuyerDialog.tsx:24-25,116-127`) → 9 query `dora-master.stores` cho cùng 1 shop.
- `lib/services/shop-read.ts:75-77` đã có sẵn mẫu cache TTL 5 phút cho `resolveShopNameByUserId`, nhưng `resolveShopUserIdByName` (`shop-read.ts:32-47`) không dùng.
- **Cách sửa:** thêm `Map<string, {id, at}>` TTL 5 phút y hệt mẫu ngay bên dưới nó.

## 3. Ghi nhận (không chặn, nên biết)

- **G1 — `saveOrderConversations` gọi `parseOrderConvoMessages` thiếu opts mới.** `lib/services/order-conversation-sync.ts:254` truyền `{ orderId, shopName }`, không có `shopUserId`/`buyerId`. **Hiện KHÔNG phải bug**: kết quả chỉ dùng `.length` để ghi `message_count`, mà `fromMe` không ảnh hưởng số lượng. Đã grep toàn repo: đúng **2 caller** (`order-conversation-sync.ts:254`, `order-conversation.ts:121`), không sót chỗ nào. Rủi ro drift nếu sau này lưu luôn mảng parsed — nên thêm comment tại chỗ.
- **G2 — Không resolve được cả `shopUserId` lẫn `buyerId` → mọi tin `fromMe=false`.** `order-conversation.ts:61-63` lấy `buyerId` từ `etsy_orders` (projection `:53` có đủ `data.buyer` + `data.buyer_id` ✓). Đơn không có trong `etsy_orders` **và** shop chưa có trong `dora-master.stores` → `isFromShop` (`order-conversation-sync.ts:126-151`) rơi xuống lưới đỡ cờ/tên, mà payload thật không có cờ nào → thread dồn hết về phía khách. Suy giảm có kiểm soát, đúng như comment đã ghi.
- **G3 — Whitelist MIME nhân bản 3 nơi.** `lib/upload-image.ts:9-14` ≡ `app/api/uploads/route.ts:7` ≡ `components/messenger/ConversationView.tsx:29`. **S7 hiện KHỚP CHÍNH XÁC** (jpeg/png/gif/webp, đã so từng phần tử). Contract cố ý không refactor ConversationView; ghi lại để lần sau gom về `lib/upload-image.ts`.
- **G4 — Ảnh trên Blob không bao giờ được dọn.** `MessageBuyerDialog.tsx:171-172` `removeAttachment` chỉ bỏ khỏi state; đóng panel không gửi cũng vậy. Giống hành vi Messenger hiện tại.
- **G5 — `uploading` là boolean, không phải bộ đếm.** `MessageBuyerDialog.tsx:154-168`: dán lần 2 khi lần 1 chưa xong → lần 1 `finally` set `false` trong khi lần 2 còn chạy → nút Gửi mở sớm, có thể gửi thiếu ảnh. Xác suất thấp; sửa bằng `useRef` đếm upload đang chạy.
- **G6 — Ảnh vừa gửi có thể chưa hiện lại trong thread.** `ably.js:476` gọi `fetchAndPostOrderConvos([orderId])` NGAY sau `sendMessage` (Etsy có thể chưa index tin mới), và `pickImages` (`order-conversation-sync.ts:67-90`) dò `attachments[].url / image_data.url / full_url / src / thumbnail_url` — shape attachment thật của `mission-control/orders/convos` **chưa xác nhận bằng dữ liệu thật**. Cần nhìn 1 thread thật sau khi gửi ảnh. (Mẫu đã chứng minh ở Messenger: `lib/services/message-read.ts:84-100` cũng dùng `image_data.url`/`url` → khả năng cao khớp.)
- **G7 — `next build` không typecheck** (`next.config.mjs:3-5`). Quy trình QA phải luôn chạy `npx tsc --noEmit` riêng.

## 4. Seam đã kiểm và ĐẠT

| Seam | Kết luận | Bằng chứng đối chiếu |
|------|----------|----------------------|
| **S1** `attachments` UI→route | ĐẠT — cùng tên, cùng `string[]` | `MessageBuyerDialog.tsx:181-186` (state `:38` là `string[]`) ↔ `route.ts:21-26,40-43` |
| **S2** route→`publishSendOrderMessage` | ĐẠT — route LUÔN truyền mảng (kể cả rỗng), type bắt buộc không optional | `route.ts:49-54` ↔ `ably-publish.ts:187-190` |
| **S3** payload Ably ↔ extension đọc | ĐẠT — khớp **từng field**: `id` / `order_id` / `message` / `attachments` / `clientId` | publish `ably-publish.ts:199` ↔ đọc `ably.js:419-428` |
| **S3b** shape `image_ids` | ĐẠT — `uploadOrderAttachments` (`etsy-message.js:211-216`) tạo `{0:id,1:id}` **y hệt** luồng Messenger đang chạy tốt (`ably.js:549-564`), cùng đi vào `sendMessage` (`etsy-message.js:20-23`) → `attachments: JSON.stringify({...})`. Không ảnh → `{}` → `'{}'` ⇒ không hồi quy tin text. | |
| **S4** URL public Blob | ĐẠT — `access:"public"` (`lib/upload-image.ts:27-31`); extension `fetch(link)` (`etsy-message.js:54`) đúng cơ chế đã chạy production ở Messenger (cùng `/api/uploads`, cùng `upload()`: `ConversationView.tsx:166-169`) | |
| **S5** `message` non-empty | ĐẠT CẢ 2 TẦNG — UI `MessageBuyerDialog.tsx:175` + `:348`; route `route.ts:30-35`. **Đã chạy thật: T1 → 400.** Validate message đứng TRƯỚC validate attachments nên message rỗng + 11 ảnh vẫn ra lỗi message. | |
| **S6** `conversationId` không chặn gửi | ĐẠT — chỉ dùng ở `MessageBuyerDialog.tsx:198` (toast) và `:213-214` (link Messenger); `send()` (`:174-175`) không đụng tới | |
| **S7** whitelist MIME | ĐẠT — 4/4 khớp chính xác: `lib/upload-image.ts:9-14` ↔ `app/api/uploads/route.ts:7` | |
| **S8** giới hạn 10 | ĐẠT ở chốt chặn thật (route, **T2 → 400 đúng text**); UI chưa chặn → F5 | |
| **DB routing** | ĐẠT — không dính mẫu "sai DB": `stores`, `etsy_orders`, `order_conversations` đều `STORES_DB_NAME` = `dora-master` (`lib/db/collections.ts:155-158,164-167,185-188`). Feature này không đọc/ghi Mongo. | |
| **Thứ tự nạp script extension** | ĐẠT — `manifest.json:30-39`: `etsy-message.js` → `content.js` → `ably.js`, nên `uploadOrderAttachments` / `getOrderConvoSafe` / `createOrderConvoMessage` / `fetchAndPostOrderConvos` đều có mặt khi `ably.js` gọi | |
| **`order_id` string↔number** | ĐẠT — dora-1 gửi string (`route.ts:28`), extension `Number(orderId)` trước khi POST về (`content.js:860,866`), dora-1 `asNumber` chấp nhận cả chuỗi số (`lib/services/etsy-utils.ts:4-10`) → không rơi vào nhánh `skipped` của `saveOrderConversations` | |

## 5. Hồi quy `order-conversation*` / `shop-read`

- Grep toàn repo: `parseOrderConvoMessages` có đúng **2 caller**; `OrderConvoParseOpts` export và dùng nhất quán; `resolveShopUserIdByName` có đúng 1 caller. **Không có caller nào thiếu opts mới gây lỗi** (chi tiết G1).
- `saveOrderConversations` vẫn parse đúng: `unwrapConvo` → `pickRawMessages` → `message_count`; `pickConversationId` không đổi; `$set`/`$setOnInsert` giữ nguyên (`order-conversation-sync.ts:246-270`). Đã gọi thật `POST /v1/extension/order-conversations/sync` với `{"orders":[]}` → **200**.
- `isFromShop` đổi chữ ký (`m, senderId, opts`) — mọi call site đã cập nhật (`order-conversation-sync.ts:170`), `tsc` sạch.
- Thứ tự ưu tiên id mới (`convo_message_id` trước) và `createDate` (đẩy `timestamp` xuống cuối) hợp lý với shape thật đã ghi trong JSDoc.

## 6. Việc cần làm trước khi bật cho user

1. **Test tay nhánh F2** (đơn CHƯA có hội thoại + dán ảnh) — nhánh duy nhất chưa từng chạy.
2. Quyết định F1 (Apps Script còn dùng `/api/orders/message` không) và F3 (có cần kênh báo trạng thái không).
3. F4 / F5 / F6 là sửa nhỏ, độc lập nhau.

---

## Xử lý sau QA (orchestrator)

| Finding | Mức | Xử lý |
|---|---|---|
| F2 `sendMessage(convoId, '', imageIds)` chưa xác nhận Etsy nhận message rỗng | chặn merge | ĐÃ SỬA — `libs/ably.js`: thử gửi tin chỉ-ảnh trước, thất bại thì gửi lại kèm `messageBody` (thà trùng chữ còn hơn mất ảnh). Vẫn cần test tay 1 đơn chưa có hội thoại. |
| F4 `upload2Etsy` không kiểm `response.ok` → mất ảnh im lặng | nên sửa | ĐÃ SỬA — `libs/etsy-message.js`: throw khi `!ok` hoặc thiếu `image_id`. |
| F5 UI không chặn >10 ảnh | nên sửa | ĐÃ SỬA — `MessageBuyerDialog.tsx`: `MAX_ATTACHMENTS = 10`, cắt trước khi upload. |
| F6 file sai MIME bị bỏ im lặng | nên sửa | ĐÃ SỬA — toast báo số ảnh bị bỏ. |
| F7 `resolveShopUserIdByName` không cache (9 query/lần mở panel) | nên sửa | ĐÃ SỬA — `shop-read.ts`: cache TTL 5 phút theo mẫu `shopNameCache` sẵn có, cache cả kết quả null. |
| F1 `proxy.ts` chặn nhánh `x-api-key` của `/api/orders/message` | nên sửa | KHÔNG SỬA — lỗi có sẵn từ trước, ngoài phạm vi yêu cầu. Báo user quyết định. |
| F3 endpoint `extension/order-messages/status/{id}` không tồn tại ở repo nào | nên sửa | KHÔNG SỬA — có sẵn từ trước (luồng gửi tin theo đơn vốn fire-and-forget). Báo user quyết định. |
