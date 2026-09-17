# 03 — Frontend: dán ảnh Ctrl+V trong panel "Nhắn khách" (F1 + F2)

Ngày: 2026-09-17 · Theo hợp đồng `_workspace/01_architect_contract.md` §3.

## F1 — `lib/upload-image.ts` (MỚI)

| Export | Kiểu | Ghi chú |
|--------|------|---------|
| `ALLOWED_IMAGE_TYPES` | `Set<string>` | `image/jpeg`, `image/png`, `image/gif`, `image/webp` — khớp CHÍNH XÁC `ALLOWED` trong `app/api/uploads/route.ts` (seam S7). |
| `uploadImageFiles(files: File[])` | `Promise<string[]>` | Lặp file, **bỏ qua** file sai MIME (không có trong kết quả), gọi `upload(name, f, { access: "public", handleUploadUrl: "/api/uploads", contentType: f.type \|\| undefined })` của `@vercel/blob/client`, trả mảng `blob.url` (public URL http(s) — seam S4). Lỗi upload để `upload()` ném Error → caller toast. |

File có `"use client"`; KHÔNG refactor `components/messenger/ConversationView.tsx` (vẫn giữ bản copy nội bộ của nó).

## F2 — `components/orders/MessageBuyerDialog.tsx`

State mới: `attachments: string[]` (public URL), `uploading: boolean`. Toàn bộ logic thread/poll hội thoại (`loadConvo`, `/api/orders/conversation/fetch`, `POLL_TIMES`/`POLL_INTERVAL_MS`) **giữ nguyên, không đụng**.

Hành vi:
- `onPaste` trên `<textarea>`: lọc `clipboardData.items` theo `kind === "file" && type.startsWith("image/")`; rỗng → return sớm (paste text chạy bình thường); có ảnh → `preventDefault()`, `setUploading(true)`, `uploadImageFiles(...)`, append URL vào `attachments`.
- Lỗi upload / không file nào hợp lệ → `toast.error` (sonner). KHÔNG dùng `alert()`.
- Chip preview 16×16 (`h-16 w-16`) ngay trên textarea + nút `X` xoá theo URL; ô spinner `Loader2` khi `uploading`.
- Hint `"Ảnh phải gửi kèm nội dung tin nhắn."` (text-warning) khi `attachments.length > 0 && !message.trim()` (D5).
- `send()`: chặn khi `uploading`; body JSON thêm `attachments`; sau khi gửi thành công `setAttachments([])` rồi `onClose()`.
- Nút Gửi: `disabled={sending || uploading || !message.trim() || noShop}` — `message` vẫn là invariant non-empty (D4/S5).
- Placeholder đổi thành `"Nội dung tin nhắn gửi khách… (Ctrl+V để dán ảnh)"`.

## Ranh giới cho QA

| Seam | Nội dung |
|------|----------|
| S1 | Body `POST /api/orders/message` = `{ shopName, orderId, message, attachments }`. `attachments` là `string[]` (URL), luôn có mặt (mảng rỗng nếu không dán ảnh). |
| S4 | URL sinh từ `upload()` → Vercel Blob public URL. |
| S5 | UI không cho gửi khi `message.trim()` rỗng, kể cả khi có ảnh. |
| S6 | `convo.conversationId` chỉ dùng cho toast + link Messenger, KHÔNG chặn gửi ảnh. |
| S7 | `ALLOWED_IMAGE_TYPES` (lib/upload-image.ts) ≡ `ALLOWED` (app/api/uploads/route.ts). |
| S8 | UI **không** chặn > 10 ảnh (nice-to-have bị bỏ qua để giữ đúng phạm vi) → route là chốt chặn thật, lỗi 400 sẽ hiện qua `toast.error(data.error)`. |

Không dùng TanStack Query ở panel này (giữ nguyên cách fetch thủ công sẵn có, ngoài phạm vi yêu cầu).

## Kiểm tra

- `npx tsc --noEmit` → sạch, không lỗi.
- Chưa test trên trình duyệt.
