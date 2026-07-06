---
name: dora-integration-qa
description: Phương pháp QA so khớp chéo ranh giới cho dora-1 — phát hiện bug tích hợp giữa service, API route, TanStack Query hook và component. Dùng skill này khi kiểm tra một tính năng full-stack đã hoàn thiện hoặc từng module, khi nghi ngờ lệch shape API↔UI, hoặc khi review trước khi merge. Cốt lõi: đọc đồng thời 4 tầng và so field, KHÔNG chỉ kiểm tra tồn tại.
---

# dora-1 Integration QA

Bắt bug ranh giới — loại bug mà backend đúng, frontend đúng, nhưng ghép lại sai. Nguyên tắc trung tâm: **so khớp chéo (cross-boundary), không kiểm tra tồn tại**.

## Quy trình so khớp 4 tầng

Với mỗi luồng dữ liệu (một "seam"), mở đồng thời và so:

| # | Tầng | File | Cần đọc |
|---|------|------|---------|
| 1 | Service `return` | `lib/services/*.ts` | shape thật trả ra + projection Mongo (field nào được lấy) |
| 2 | API route | `app/api/*/route.ts` | query param nào được đọc/ép kiểu |
| 3 | Hook | `lib/hooks/*.ts` | type cast `as T`, queryKey, param nào gửi đi |
| 4 | Component | `app,components/*` | field nào của response được truy cập |

**So các cặp:**
- Field component (4) đọc **⊄** field service (1) trả / projection lấy → **BUG** (undefined lúc runtime).
- Param hook (3) gửi **⊄** param route (2) đọc → **BUG** (filter im lặng bị bỏ).
- Type cast hook (3) **≠** type service (1) trả → **BUG** hợp đồng (grep tên type ở cả `lib/types`, service, hook — phải trùng).
- queryKey (3) **thiếu** biến filter → cache trả dữ liệu cũ khi filter đổi.

## Mẫu bug đặc thù dora-1 (ưu tiên soi)

1. **Sai DB.** Service đọc collection ở `meta_local` trong khi dữ liệu nằm ở `dora-master` (stores/etsy_orders/order_tracking) — hoặc ngược lại. Kiểm getter dùng có đúng `client.db(STORES_DB_NAME)` không.
2. **Projection thiếu field.** `LIST_PROJECTION` không include field mà component sẽ render → luôn undefined dù dữ liệu có trong DB.
3. **Field lồng sâu không parse phòng thủ.** Truy cập `data.a.b.c` trực tiếp thay vì `getPath/firstString` → crash khi payload thiếu nhánh.
4. **Text chưa `decodeHtmlEntities`.** Tên/địa chỉ hiển thị ra `&amp;`, `&#39;`.
5. **queryKey tĩnh.** Filter đổi nhưng key không đổi → UI kẹt dữ liệu cũ.
6. **Type contract nhân bản.** Hook tự khai type riêng thay vì import từ `lib/types` → hai shape trôi dạt theo thời gian.

## Kiểm chứng bằng thực thi (không chỉ đọc)

- `npm run build` hoặc `npx tsc --noEmit` → bắt lệch type ở ranh giới.
- `grep` tên type contract khắp `lib/types`, `lib/services`, `lib/hooks` → xác nhận dùng chung một type.
- Nếu app chạy được: gọi thử endpoint (`curl "http://localhost:3000/api/..."`) xem shape JSON thật khớp type không.

## QA tăng dần (incremental)

Chạy ngay sau khi mỗi module backend/frontend báo xong, **không** dồn tới cuối. Bug ranh giới phát hiện sớm rẻ hơn nhiều lần. Sau mỗi vòng, cập nhật `_workspace/04_qa_report.md`.

## Định dạng finding

Mỗi finding: **seam** (luồng nào) · **tầng lệch** (1–4) · **bằng chứng** (`file:line` cả hai phía) · **mức độ** (chặn merge / nên sửa / lưu ý) · **cách sửa gợi ý**. Không xoá dữ liệu mâu thuẫn — ghi kèm nguồn để backend/frontend tự quyết.
