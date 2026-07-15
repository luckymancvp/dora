# 04 — QA Integration Report: Orders (transactionId + copy fullxfull + search nâng cao)

> Phương pháp: so khớp chéo 4 tầng (service `return` ↔ route param ↔ hook queryKey/param ↔ component field), kiểm chứng bằng thực thi (`tsc`, node chạy regex/hàm thật). Không chỉ kiểm tồn tại.
> Lưu ý môi trường: skill `dora-integration-qa` KHÔNG được cài trong máy này (không có trong `~/.claude/skills`). Đã áp dụng đúng phương pháp so khớp chéo theo mô tả.

## Bảng seam → kết quả

| Seam | Kết quả | Bằng chứng |
|------|---------|-----------|
| 1. Search raw → route → service strip prefix | **PASS** | FE gửi raw `.trim()` (`useOrders.ts:8`), param name `search` khớp route (`route.ts:13`), service strip `/(\d+)\s*$/` + guard `Number.isFinite` (`orders-read.ts:281-288`) |
| 2. transactionId hiển thị | **PASS** | type `number` (`etsy.ts:283`); `mapTransactions` gán từ `transaction_id` (`orders-read.ts:101`); projection có `data.transactions` (`:236`); component đọc `t.transactionId` (`OrderCard.tsx:98,191`) |
| 3. Search theo transactionId | **PASS** | service push `{ "data.transactions.transaction_id": asNum }` (`orders-read.ts:287`), cùng param `search`, cùng đường ống |
| 4. Copy ảnh fullxfull | **PASS** | `etsyFullResUrl` (`format.ts:35-38`), nút copy dùng `etsyFullResUrl(t.image)` (`OrderCard.tsx:154`), nguồn `t.image` = `product.image_url_75x75` |
| 5. `npx tsc --noEmit` toàn repo | **PASS** | Exit 0, không lỗi |

## Kiểm chứng thực thi (node chạy hàm/regex thật)

`etsyFullResUrl` — mọi case đúng kỳ vọng:
- `...il_75x75.5035789275_8hga.jpg` → `...il_fullxfull.5035789275_8hga.jpg` ✓ (khớp ví dụ đề bài)
- `il_170x135.` → `il_fullxfull.` ✓ ; `il_300x300.` → `il_fullxfull.` ✓
- URL không match → trả nguyên ✓ ; chuỗi rỗng → trả nguyên ✓

Regex strip prefix `/(\d+)\s*$/`:
- `TEST-2914171501` → 2914171501 ✓ ; `2914171501` → 2914171501 ✓ ; `#2914171501` → 2914171501 ✓
- `TEST-2914171501  ` (trailing space) → 2914171501 ✓
- `John` → no-push ✓ ; `abc123def` (số ở giữa) → no-push (đúng: chỉ dãy số CUỐI)

## Findings

### F-1 (nhẹ / doc mismatch) — Architect contract ghi sai DB, code ĐÚNG
- Contract `01_architect_contract.md` mục 5 và bảng mục 0 ghi nguồn `etsy_orders` nằm ở **`meta_local`**.
- Code thật: `getEtsyOrdersCollection` đọc từ **`dora-master`** (`lib/db/collections.ts:119-121`, `STORES_DB_NAME = "dora-master"`; comment `:116-117` nêu rõ "Bỏ qua getDb() (meta_local) vì collection nằm ở DB khác").
- **Tác động runtime: KHÔNG** — code query đúng DB nên search/transactionId hoạt động thật. Chỉ tài liệu architect sai. Đây đúng mẫu bug "sai DB (meta_local vs dora-master)" cần cảnh giác, may là code không dính. Đề nghị architect sửa note để tránh hiểu nhầm về sau.

### F-2 (nhẹ) — Ô search không debounce
- `page.tsx:72` `onChange` → `patch({ search })` cập nhật `filters` ngay mỗi phím; `useOrders` queryKey `["orders", filters]` đổi theo → fetch mỗi ký tự.
- Giảm nhẹ nhờ `keepPreviousData` + `staleTime 10s`, nhưng mỗi giá trị search mới là key mới nên vẫn gọi API liên tục khi gõ. Contract xem debounce là tùy chọn nên KHÔNG chặn merge. Gợi ý: debounce ~300ms ở `page.tsx` nếu muốn giảm tải.

### F-3 (nhẹ / edge) — `key={t.transactionId}` khi id thiếu
- `OrderCard.tsx:98` dùng `t.transactionId` làm React key. `mapTransactions` fallback `?? 0` khi thiếu (`orders-read.ts:101`). Đơn có ≥2 item cùng thiếu transaction_id → 2 key `0` trùng (cảnh báo React, render lẫn state copied). Cực hiếm trên đơn thật (Etsy luôn có transaction_id). Không chặn merge.

## Kết luận
**KHÔNG có finding chặn merge.** 4/4 seam + tsc PASS. 3 finding mức nhẹ (F-1 doc, F-2 debounce, F-3 edge key), không phải bug shape lệch API↔UI. Không tự sửa code (không có typo/sai field name); F-1 thuộc tài liệu architect, F-2/F-3 là lựa chọn thiết kế — để chủ dự án quyết.
