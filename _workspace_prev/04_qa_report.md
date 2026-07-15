# 04 — QA Integration report: Tính năng "Cập nhật Mera"

Phương pháp: so khớp chéo 4 tầng (Mera API docs ↔ service ↔ route ↔ hook ↔ component) theo bảng seam §4 contract, không chỉ kiểm tồn tại. Kiểm chứng bằng `npx tsc --noEmit` + `npm run build`.

## Kết quả build
- `npx tsc --noEmit`: **PASS** (EXIT 0, không lỗi).
- `npm run build`: **PASS** (EXIT 0). Hai route mới đăng ký: `ƒ /api/mera/resolve`, `ƒ /api/mera/update`.

## Bảng seam đã kiểm

| Seam | Điểm CHO | Điểm NHẬN | Kết quả |
|---|---|---|---|
| S1 resolve query | `useMera` `?store=&receiptId=` | route đọc `sp.get("receiptId")`→Number, `sp.get("store")` | KHỚP |
| S2 resolve body | `resolveMeraOrder` `{order,items,reason}` | `jsonFetch<ResolveMeraOrderResponse>` | KHỚP |
| S3 query key | `["mera-order", receiptId]` | tách hẳn `["sheet-row", receiptId, txn]` | KHỚP, không double-fetch |
| S4 update item req | `{target:"item",itemKey,version,updates}` | route validate item | KHỚP (updates chỉ field dirty camelCase) |
| S5 update item res | `{item, splitApplied?}` | `jsonFetch<MeraUpdateItemResponse>` | KHỚP |
| S6 update note req | `{target:"order",orderId,version,note}` | route validate order | KHỚP |
| S7 update note res | `{order}` | `jsonFetch<MeraUpdateOrderResponse>` | KHỚP |
| S8 field map UI | `MERA_EDITABLE_ITEM_FIELDS` label Status/Personalization/Customer Image/Design/Mockup | `FieldInput` switch label; `TEXTAREA_FIELDS` chứa 4 label sau; Design/Mockup→DriveLinkPreview; Customer Image→ImagePreviews | KHỚP |
| S9 component đọc | `MeraOrderItem`/`MeraOrderSummary` | component đọc itemKey/version/imageLink/productName/quantity/tracking.*/orderId/note/version | Mọi field TỒN TẠI trong DTO |

## So khớp field Mera API thật (docs) ↔ service map

- **mapItem** (order_items §3/§5): `item_key→itemKey`, `order_id→orderId`, `status`, `personalization`, `customer_image→customerImage`, `design_link→designLink`, `mockup_link→mockupLink`, `tracking.{code,carrier,url}` (dot-path qua `getPath`, parse lồng đúng), `image_link→imageLink`, `product_name→productName`, `quantity`, `version`. KHỚP docs.
- **mapOrder** (orders §2): `order_id`, `store`, `note`, `is_split_items→isSplitItems` (chỉ true khi `=== true`), `items_count→itemsCount`, `version`, `customer.name→customerName` (dot-path). KHỚP docs.
- **Body PATCH item** (§5 allowed fields): gửi `status/personalization/customer_image/design_link/mockup_link` + `version`. Tất cả nằm trong allowed User-Managed Item Fields. KHỚP.
- **Body PATCH order** (§4 allowed fields): `{version, note}`. `note` là allowed User-Managed Order Field. KHỚP.
- **Auto-split** (§9): 400 `ITEM_EDIT_REQUIRES_SPLIT` → `POST /orders/:orderId/split {split:true}` → retry PATCH 1 lần. Endpoint + body đúng docs.
- **Suy orderId từ itemKey**: `itemKey.slice(0, lastIndexOf("-"))`. Với format `<order_id>-<line_item_id>` (order_id chứa "-", vd `DAV-3999799511-4986531800`) → cho `DAV-3999799511`. ĐÚNG.
- **Filter resolve**: `order_id.endsWith("-"+receipt) || === receipt`, loại `is_deleted`, thu hẹp theo `normalizeStore`, chọn `created_at` mới nhất, fallback `GET /orders/:id/items` khi include_items rỗng. Đúng docs §1/§3.
- **Status code lỗi**: 409 `version_conflict` (+`latest` map thành DTO), 503 `mera_not_configured`, 502 `mera_unavailable`. `errorResponse` đính `code`+`latest` từ `MeraApiError`. `jsonFetch` đọc `code`/`latest`→`ApiError`. KHỚP bảng seam lỗi. Resolve thiếu env = 200 soft `reason:"not_configured"`; update thiếu env = 503 hard. Hai đường phân biệt đúng.

## Regression Sheet
- `field-editors.tsx`: move THUẦN `CopyCode, ImageLightbox, ImagePreviews, DriveLinkPreview, StatusSelect, FieldInput, toastSaveError, TEXTAREA_FIELDS`. Logic không đổi.
- `SheetItemEditor.tsx`: import `CopyCode, FieldInput, toastSaveError` từ `field-editors`; vẫn export `SheetReceiptEditor`. Flow Sheet nguyên vẹn.
- `OrderSheetSidebar.tsx`: đã XOÁ (không tồn tại). Grep: chỉ còn 1 comment mention ở `MessageBuyerDialog.tsx` (không import) + docs. Không nơi nào `import OrderSheetSidebar`.
- Rename passthrough: `OrderCard`/`OrdersList` dùng `onUpdate`; `page.tsx` dùng state `updateOrder` + render `OrderUpdateSidebar`. Nhất quán.

## Sidebar logic
- `tryMera = (sheet.isSuccess && matches.length===0) || sheet.isError` → Mera enabled đúng điều kiện.
- Cả hai rỗng → "Không tìm thấy đơn ở Sheet lẫn Mera." + lý do phụ (`no_configs`/`not_configured`). Đúng.

## Findings

### Mức chặn merge: KHÔNG CÓ
Không phát hiện lệch shape, field thiếu, sai endpoint, hay sai status code. Không cần tự sửa.

### Mức nhẹ (ghi nhận, không sửa)

1. **[UX] OrderUpdateSidebar không surface lỗi resolve Mera (502).** Khi `mera.isError` (mera_unavailable/timeout), `meraOrder` null + `mera.isLoading` false → sidebar rơi vào nhánh empty "Không tìm thấy đơn ở Sheet lẫn Mera." thay vì báo "Không kết nối được Mera". `MeraReceiptEditor` CÓ xử lý lỗi này nhưng chỉ render khi `meraOrder` truthy nên không kích hoạt ở tầng sidebar. Đề xuất: thêm nhánh `mera.isError` trước empty-state để hiển thị notice "Không kết nối được Mera (đang thử lại)". Không chặn vì luồng chính (có đơn) vẫn đúng.

2. **[Validation] `receiptId` thiếu param → 0, không bị 400.** Route dùng `Number(sp.get("receiptId"))`; `Number(null)=0` là finite nên qua guard, resolve chạy với `q=0` (vô hại → not_found). Chỉ xảy ra nếu client gọi thiếu param; hook luôn truyền `receiptId` số (đã có `Number.isFinite` guard client). Cùng pattern với route Sheet. Đề xuất (nếu muốn chặt): kiểm `sp.get("receiptId") == null` → 400. Không chặn.

3. **[Robustness] Auto-split không kiểm status của POST /split trước khi retry PATCH.** Nếu split fail (409/mạng), code vẫn retry PATCH; PATCH sẽ lại 400 → rơi vào throw generic. Kết quả cuối vẫn là lỗi hợp lý, chỉ message kém cụ thể. Không chặn.

## Kết luận
Tính năng "Cập nhật Mera" nhất quán 4 tầng, không có finding chặn merge. tsc + build sạch. 3 finding nhẹ (UX/validation/robustness) ghi nhận để cải thiện, không bắt buộc trước merge.
