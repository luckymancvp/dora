# 01 — Hợp đồng kiểu: Dán ảnh + gửi ảnh kèm tin trong panel "Nhắn khách" (Orders)

Ngày: 2026-09-17 · Phạm vi: dora-1 (repo này). Phần extension do orchestrator tự sửa, agent KHÔNG đụng.

## 0. Quyết định chốt (đọc trước khi code)

| # | Vấn đề | Quyết định |
|---|--------|-----------|
| D1 | Tên field ở ranh giới Ably | `attachments: string[]` (snake_case-neutral, TRÙNG tên đã dùng ở event `chat-message` — xem `lib/services/message-send.ts:83`). KHÔNG đặt `attachment_urls`, `images`, `image_ids`. |
| D2 | Giá trị của `attachments` | Mảng **public URL** của Vercel Blob (https://...), KHÔNG phải Etsy image_id. Extension mới là bên gọi `upload2Etsy(convo_id, url)` để đổi URL → image_id. |
| D3 | Có chặn gửi ảnh khi đơn chưa có hội thoại (`conversationId === null`) không? | **KHÔNG chặn.** Cứ gửi, extension xử lý 2 bước (createOrderConvoMessage bằng text để có convo_id → upload2Etsy → sendMessage kèm image_ids). dora-1 không biết chắc trạng thái hội thoại thật trên Etsy (DB có thể chưa sync) nên chặn sẽ sai nhiều hơn đúng. |
| D4 | Hệ quả của D3 | `message` **vẫn bắt buộc non-empty** (giữ nguyên validate hiện có). Lý do: đơn chưa có hội thoại thì extension cần text để tạo hội thoại; ảnh trần sẽ không gửi được. → Không hỗ trợ "gửi ảnh không kèm chữ" ở panel này. |
| D5 | UI thông báo về D4 | Nút Gửi disabled khi `!message.trim()`; khi đã chọn ảnh mà chưa có chữ, hiện hint nhỏ: "Ảnh phải gửi kèm nội dung tin nhắn." Không hiện cảnh báo gì về convo_id. |
| D6 | Type file mới | **Không cần** type mới trong `lib/types/*`. Body và event data khai báo inline như code hiện tại (giống `publishChatMessage`). |
| D7 | Giới hạn | Tối đa **10** ảnh / lần gửi; chỉ MIME `image/jpeg|png|gif|webp` (khớp `app/api/uploads/route.ts`). Vượt → 400. |

## 1. Type contract

### 1.1 Body `POST /api/orders/message` (UI → route)

```ts
{
  shopName: string;        // bắt buộc, non-empty sau trim
  orderId: string | number; // bắt buộc
  message: string;         // BẮT BUỘC non-empty sau trim (xem D4)
  attachments?: string[];  // MỚI — optional, mảng public URL ảnh; bỏ qua = []
}
```

Ràng buộc validate ở route:
- `attachments` không phải mảng → coi như `[]` (không 400, giữ tương thích caller cũ Apps Script).
- Lọc phần tử: chỉ giữ `typeof x === "string"` và `x.trim()` bắt đầu bằng `http://` hoặc `https://`.
- Sau lọc, `length > 10` → `400 { error: "Tối đa 10 ảnh mỗi tin" }`.

Response KHÔNG đổi: `{ ok: true, id, clientId }` | `{ error, code?: "shop_offline" }`.

### 1.2 Data event Ably `send-order-message` (route → extension)

`publishSendOrderMessage(shopName, data)` với:

```ts
data: {
  id: string;            // randomUUID, đã có
  order_id: string;      // đã có
  message: string;       // đã có
  attachments: string[]; // MỚI — LUÔN có mặt, mảng rỗng nếu không gửi ảnh
}
```

Payload publish thực tế = `{ ...data, clientId: targetClientId }` (giữ nguyên cơ chế cũ).
Channel = `shop_name`, event const `SEND_ORDER_MESSAGE_EVENT = "send-order-message"`.

Lưu ý ranh giới: các field payload dùng snake_case (`order_id`, `attachments`), riêng `clientId` giữ camelCase vì đã là quy ước chung của mọi event hiện tại — KHÔNG đổi.

### 1.3 Không đổi
- `/api/uploads` (đã có, đã miễn auth ở middleware) — frontend dùng `upload()` của `@vercel/blob/client` với `handleUploadUrl: "/api/uploads"`.
- `/api/orders/conversation`, `/api/orders/conversation/fetch`, type `OrderConversation` trong MessageBuyerDialog.

## 2. Task backend (`backend-engineer`)

**B1 — `lib/services/ably-publish.ts`** (1 file)
- Thêm `attachments: string[]` vào tham số `data` của `publishSendOrderMessage` (bắt buộc, không optional — route luôn truyền mảng).
- Cập nhật JSDoc: nêu rõ attachments là public URL, extension tự `upload2Etsy` → image_ids; đơn chưa có hội thoại thì extension tạo hội thoại bằng text trước rồi gửi ảnh (2 bước).

**B2 — `app/api/orders/message/route.ts`** (1 file)
- Parse `attachments` từ body, sanitize theo §1.1, truyền xuống `publishSendOrderMessage`.
- Giữ nguyên validate `message` bắt buộc, auth 2 đường (session / `x-api-key`), response shape.
- Cập nhật comment đầu file cho khớp body mới.

## 3. Task frontend (`frontend-engineer`)

**F1 — `lib/upload-image.ts`** (file MỚI, nhỏ ~30 dòng)
- Export `ALLOWED_IMAGE_TYPES: Set<string>` (jpeg/png/gif/webp, khớp `app/api/uploads/route.ts`).
- Export `uploadImageFiles(files: File[]): Promise<string[]>` — lặp file, bỏ file sai MIME (throw Error rõ ràng để caller toast), gọi `upload(name, f, { access: "public", handleUploadUrl: "/api/uploads", contentType })`, trả mảng URL.
- KHÔNG refactor `components/messenger/ConversationView.tsx` trong lần này (ngoài phạm vi yêu cầu).

**F2 — `components/orders/MessageBuyerDialog.tsx`** (1 file)
- State mới: `attachments: string[]`, `uploading: boolean`.
- `onPaste` trên textarea: đọc `e.clipboardData.items`, lọc `kind === "file" && type.startsWith("image/")`, `preventDefault()`, upload qua `uploadImageFiles`, append URL vào `attachments`. (Mẫu: `ConversationView.tsx:186-199`.)
- Hàng chip preview ảnh (thumbnail + nút X xoá theo URL) ngay trên textarea; hiện spinner/"Đang tải ảnh…" khi `uploading`.
- `send()`: thêm `attachments` vào JSON body; chặn gửi khi `uploading`.
- Nút Gửi: `disabled={sending || uploading || !message.trim() || noShop}`; hint D5 khi có ảnh mà chưa có chữ.
- Sau khi gửi thành công: toast hiện tại + reset `attachments` (panel đóng nên chỉ cần không rò state).
- Giữ nguyên toàn bộ phần thread/poll hội thoại hiện có.

Hai task frontend phụ thuộc tuần tự (F1 trước F2), backend độc lập hoàn toàn với frontend — chỉ khớp qua §1.1.

## 4. Bảng seam (đầu vào cho `qa-integration`)

| # | Field | Nguồn | Qua | Đích | Kiểm tra |
|---|-------|-------|-----|------|----------|
| S1 | `attachments` (URL[]) | state trong `MessageBuyerDialog` (F2) | JSON body `POST /api/orders/message` | `route.ts` sanitize | Tên field TRÙNG `attachments` cả 2 phía; là `string[]`, không phải `File[]`/`FileList` |
| S2 | `attachments` | `route.ts` | tham số `data` của `publishSendOrderMessage` | `ably-publish.ts` | Route luôn truyền mảng (kể cả rỗng) → type bắt buộc, không optional |
| S3 | `attachments` | `ably-publish.ts` | `channel.publish("send-order-message", {...data, clientId})` | extension `processSendOrderMessage` | Snake_case nhất quán: `id`, `order_id`, `message`, `attachments`, `clientId` |
| S4 | URL ảnh | `upload()` @vercel/blob/client | `/api/uploads` (token) | Vercel Blob public URL | URL phải public, http(s), extension fetch được không cần cookie |
| S5 | `message` | textarea | body → Ably | extension (tạo convo nếu convo_id null) | message non-empty là INVARIANT (D4) — QA phải xác nhận route vẫn 400 khi message rỗng dù có ảnh |
| S6 | `conversationId` | `/api/orders/conversation` | state `convo` trong panel | chỉ dùng cho toast + link Messenger | KHÔNG dùng để chặn gửi ảnh (D3) |
| S7 | MIME whitelist | `lib/upload-image.ts` (F1) | — | `ALLOWED` trong `app/api/uploads/route.ts` | 2 danh sách phải khớp: jpeg, png, gif, webp |
| S8 | Giới hạn 10 ảnh | route (400) | — | UI | UI nên ngăn thêm quá 10 trước khi POST (nice-to-have), route là chốt chặn thật |

## 5. Giả định đã chốt (không hỏi lại)
- Ảnh lưu ở Vercel Blob (đã dùng cho Messenger), không lưu gì vào `meta_local`/`dora-master` — luồng nhắn theo đơn là fire-and-forget, trạng thái báo về Go backend.
- Không cần optimistic render ảnh vào thread trong panel (thread chỉ refresh khi extension sync về).
