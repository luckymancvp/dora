# 02 — Backend: gửi ảnh kèm tin nhắn theo đơn (B1 + B2)

Ngày: 2026-09-17 · Theo hợp đồng `_workspace/01_architect_contract.md` §1.1, §1.2, §2.

## File đã thay đổi (2 file, không đụng file khác)

| File | Thay đổi |
|------|----------|
| `lib/services/ably-publish.ts` | `publishSendOrderMessage` nhận thêm `attachments: string[]` (bắt buộc) trong `data`; JSDoc nêu rõ URL public → extension `upload2Etsy` → `image_ids`, và luồng 2 bước khi đơn chưa có hội thoại. |
| `app/api/orders/message/route.ts` | Parse + sanitize `attachments` từ body, chặn > 10 ảnh (400), truyền xuống publish. Comment đầu file cập nhật body mới. |

## Shape cuối cùng

### Body `POST /api/orders/message`
```ts
{
  shopName: string;          // bắt buộc, non-empty sau trim
  orderId: string | number;  // bắt buộc
  message: string;           // BẮT BUỘC non-empty sau trim (giữ nguyên — D4)
  attachments?: string[];    // optional, public URL ảnh; bỏ qua/sai kiểu = []
}
```

Sanitize (đúng §1.1, không 400 khi sai kiểu để giữ tương thích caller Apps Script):
1. `Array.isArray(body.attachments) ? body.attachments : []`
2. giữ phần tử `typeof x === "string"`, `.trim()`
3. giữ phần tử bắt đầu bằng `http://` hoặc `https://`
4. sau lọc `length > 10` → `400 { error: "Tối đa 10 ảnh mỗi tin" }`

Response KHÔNG đổi: `200 { ok: true, id, clientId }` · `400 { error }` · `409 { error, code: "shop_offline" }` · `500` qua `errorResponse`.

Thứ tự validate: `shopName/orderId/message` trước → `attachments` sau. Nên khi `message` rỗng **và** gửi 11 ảnh thì lỗi trả về là `"shopName, orderId và message bắt buộc"` (invariant S5 giữ nguyên).

### Data event Ably `send-order-message`
```ts
publishSendOrderMessage(shopName, {
  id: string;            // randomUUID
  order_id: string;
  message: string;
  attachments: string[]; // LUÔN có mặt, [] nếu không gửi ảnh
})
```
Payload publish thực tế: `{ id, order_id, message, attachments, clientId }` trên channel = `shop_name`.

## Collection / DB
Không đọc/ghi Mongo. Luồng fire-and-forget qua Ably; ảnh nằm ở Vercel Blob. Không có state nào lưu ở `meta_local` / `dora-master`.

## Kiểm tra
`npx tsc --noEmit` → sạch (0 lỗi). Không còn caller nào khác của `publishSendOrderMessage` ngoài route này.

## Test bằng curl

Thay `<KEY>` = `MERA_INTERNAL_API_KEY`, `<SHOP>` = shop_name có extension online.

```bash
# 1. Happy path — 2 ảnh
curl -i -X POST http://localhost:3000/api/orders/message \
  -H "Content-Type: application/json" -H "x-api-key: <KEY>" \
  -d '{"shopName":"<SHOP>","orderId":"1234567890","message":"Ảnh mockup của bạn đây",
       "attachments":["https://xxx.public.blob.vercel-storage.com/a.jpg",
                      "https://xxx.public.blob.vercel-storage.com/b.png"]}'
# → 200 {"ok":true,"id":"...","clientId":"..."}   (409 shop_offline nếu extension chưa online)

# 2. Không có attachments (caller cũ) → vẫn 200, event mang attachments: []
curl -i -X POST http://localhost:3000/api/orders/message \
  -H "Content-Type: application/json" -H "x-api-key: <KEY>" \
  -d '{"shopName":"<SHOP>","orderId":"1234567890","message":"hello"}'

# 3. attachments sai kiểu (string / object / null) → coi như [], KHÔNG 400
curl -i -X POST http://localhost:3000/api/orders/message \
  -H "Content-Type: application/json" -H "x-api-key: <KEY>" \
  -d '{"shopName":"<SHOP>","orderId":"1","message":"hi","attachments":"https://a.jpg"}'

# 4. Phần tử rác bị lọc bỏ (blob:, data:, số, null) → chỉ còn URL http(s)
curl -i -X POST http://localhost:3000/api/orders/message \
  -H "Content-Type: application/json" -H "x-api-key: <KEY>" \
  -d '{"shopName":"<SHOP>","orderId":"1","message":"hi",
       "attachments":["blob:http://localhost/xyz","data:image/png;base64,AAA",123,null,
                      "https://xxx.public.blob.vercel-storage.com/ok.jpg"]}'

# 5. 11 ảnh → 400 "Tối đa 10 ảnh mỗi tin"
curl -i -X POST http://localhost:3000/api/orders/message \
  -H "Content-Type: application/json" -H "x-api-key: <KEY>" \
  -d '{"shopName":"<SHOP>","orderId":"1","message":"hi","attachments":
       ["https://a/1.jpg","https://a/2.jpg","https://a/3.jpg","https://a/4.jpg","https://a/5.jpg",
        "https://a/6.jpg","https://a/7.jpg","https://a/8.jpg","https://a/9.jpg","https://a/10.jpg",
        "https://a/11.jpg"]}'

# 6. message rỗng dù có ảnh → 400 "shopName, orderId và message bắt buộc" (S5)
curl -i -X POST http://localhost:3000/api/orders/message \
  -H "Content-Type: application/json" -H "x-api-key: <KEY>" \
  -d '{"shopName":"<SHOP>","orderId":"1","message":"   ","attachments":["https://a/1.jpg"]}'
```
