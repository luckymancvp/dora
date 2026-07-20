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

---

# Vòng 2 — Panel "Cập nhật Mera" render ĐỘNG (Order Table Columns)

> So khớp chéo 4 tầng theo bảng seam mục 4 của `06_architect_contract_v2.md`. Kiểm chứng: `npx tsc --noEmit` (EXIT 0) + `npm run build` (EXIT 0, toàn bộ route compile).

## Bảng seam → kết quả

| Seam | Kết quả | Bằng chứng |
|------|---------|-----------|
| columns: `fetchMeraColumns`/`normalizeColumns` → `ResolveMeraOrderResponse.columns` → component chia scope | **PASS** | DTO `{id,label,fieldKey,scope,position,visible,editable}` map từ snake_case (`mera-order.ts:247-281`); sort position tăng (`:279`); lọc visible!==false (`:255`); dedupe fieldKey (`:259`); component đọc `col.fieldKey/label/editable/scope` (`MeraItemEditor.tsx:55-64,256-257`) |
| item values: `mapItem` buildValues theo itemFieldKeys | **PASS** | key = fieldKey (`mera-order.ts:193-198,214`); nested `tracking.code` resolve qua getPath (`:185`); luôn kèm `item_note` (`:214`); component đọc `item.values[fieldKey]` (`MeraItemEditor.tsx:176,182`) |
| order values: `mapOrder` buildValues + luôn kèm `note` | **PASS** | `:236`; component đọc `order.values[fieldKey]` (`MeraItemEditor.tsx:114,119`) |
| item note (item_note→order_items.note) | **PASS** | resolve `item_note`→path `note` (`mera-order.ts:172`); PATCH map `item_note`→body.note (`:447-449`); typed `note` cũng đọc `note` (`:211`) — nhất quán |
| update body `MeraUpdateRequest` | **PASS** | hook gửi `{updates, itemKey?, itemVersion?, orderId, orderVersion}` (`useMera.ts:53-58`); route validate updates/orderId/orderVersion (`update/route.ts:19-31`); service tách scope (`mera-order.ts:552-555`) |
| update item vs order scope | **PASS** | item card gửi updates chỉ item + itemKey/itemVersion (`MeraItemEditor.tsx:189-195`); order section gửi chỉ order fields, itemKey undefined (`:126-130`); server split scope + guard thiếu itemKey (`mera-order.ts:568-570`) |
| split | **PASS** | 400 ITEM_EDIT_REQUIRES_SPLIT→split→retry (`mera-order.ts:487-498`); `splitApplied` → toast (`MeraItemEditor.tsx:198`) |
| conflict 409 | **PASS** | `MeraApiError(409,"version_conflict",{latest})` (`mera-order.ts:503-508,530-535`) → errorResponse body `{error,code,latest}` (`api-helpers.ts:30-34`) → jsonFetch ApiError code/latest (`useSheets.ts:34-41`) → `meraSaveError` check code (`MeraItemEditor.tsx:22-25`) |
| statuses | **PASS** | fallback `MERA_STATUS_OPTIONS` khi rỗng (`MeraItemEditor.tsx:261-263`); StatusSelect nhận options từ 1 nguồn duy nhất (prop `statusOptions`) |

## Kiểm tra cạm bẫy (theo yêu cầu)

- **Version khi PATCH mix scope:** UI KHÔNG bao giờ trộn 2 scope trong 1 request (order-scope section và item card có nút Lưu riêng; `updates` mỗi request thuần 1 scope). Server nếu có trộn thì PATCH item trước rồi order (`mera-order.ts:567-609`), client gửi đúng `itemVersion` cho item PATCH và `orderVersion` cho order PATCH. **Không lỗi.**
- **Nested merge fetch "mới nhất" nhưng PATCH bằng version client:** `buildScopeBody` fetch object mới nhất CHỈ để lấy sibling subfield (merge tránh xoá subfield khác — `mera-order.ts:442-443,460-462`), nhưng version param vẫn là version client (`:576,598`). Nếu người khác đã đổi → version lệch → Mera 409 → client refetch. **KHÔNG mất data** (optimistic lock vẫn hiệu lực); đánh giá: ĐÚNG theo contract D7.
- **Fallback MERA_DEFAULT_COLUMNS:** cả 4 đường đều fallback — projectId rỗng (`:292`), status!==200 (`:299`), columns [] (`:302`), lỗi/timeout (`:305`). Editor render an toàn khi thiếu key: draft init `?? ""` (`:114,176`), renderer `draft[fieldKey] ?? ""` (`:60`). **PASS.**
- **OrderUpdateSidebar khớp shape mới:** chỉ đọc `mera.data.order`/`mera.data.reason`/`mera.error.status` — đều còn trong shape v2 (`OrderUpdateSidebar.tsx:36,98,114`). **PASS.**
- **Regression Sheet:** `FieldInput`/`StatusSelect`/`TEXTAREA_FIELDS` giữ nguyên; `MeraFieldRenderer`/`meraFieldKind`/`MeraReadOnlyCell` là bổ sung. SheetItemEditor vẫn import `FieldInput` bình thường (`SheetItemEditor.tsx:22`). Build pass toàn repo. **KHÔNG đụng.**

## Findings vòng 2

### F2-1 (nhẹ) — Xoá trắng field số bị âm thầm bỏ qua
- `buildScopeBody`: `quantity`/`export_count` khi giá trị rỗng → `asNumber("")===undefined` → field không vào PATCH body (`mera-order.ts:451-454`). Không thể "xoá về rỗng" một field số. Hợp lý về nghiệp vụ (số lượng không nên rỗng), KHÔNG chặn merge. Ghi nhận.

### F2-2 (nhẹ / lý thuyết) — Mix scope trong 1 request áp dụng bán phần
- Nếu (giả định tương lai) 1 request trộn item+order scope và order PATCH 409 sau khi item đã PATCH thành công → thay đổi item đã ghi, cả request vẫn throw. Hiện KHÔNG xảy ra vì UI tách nút Lưu theo scope. Chỉ ghi nhận nếu sau này mở form gộp.

### F2-3 (rất nhẹ / cosmetic) — Response mutation có `values` rút gọn
- `patchItem`/`patchOrder` map object trả về với `itemFieldKeys`/`orderFieldKeys` = chỉ field vừa sửa (`mera-order.ts:501,529,575,597`) → `values` trong `MeraUpdateResponse` thiếu các cột khác. Hiện vô hại vì UI `invalidate + refetch` (không dùng trực tiếp response để fill). Nếu về sau đọc thẳng response item/order sẽ thấy values khuyết → nên lưu ý.

### F2-4 (rất nhẹ / doc) — Comment nhắc tên hook cũ
- `useMera.ts:46` comment "Gộp useUpdateMeraItem + useUpdateMeraNote" — chỉ là chú thích lịch sử, không còn code tham chiếu. Bỏ qua.

## Kết luận vòng 2
**KHÔNG có finding chặn merge.** 9/9 seam + tsc + build PASS. Version/nested-merge/fallback/regression đều đúng contract v2. 4 finding mức nhẹ/cosmetic (F2-1..F2-4), không phải lệch shape API↔UI, không sai fieldKey/scope, không mất data. **Không tự sửa code** (không tìm thấy bug chặn merge cần fix).
