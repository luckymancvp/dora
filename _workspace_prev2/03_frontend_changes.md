# 03 — Frontend changes: Tính năng "Cập nhật Mera"

Bám contract `_workspace/01_architect_contract.md` §3 + type `lib/types/mera.ts` (import, không định nghĩa lại).

## Files TẠO MỚI
| File | Vai trò |
|---|---|
| `components/messenger/field-editors.tsx` | Component dùng chung (MOVE THUẦN từ SheetItemEditor): `CopyCode`, `ImageLightbox`, `ImagePreviews`, `DriveLinkPreview`, `StatusSelect`, `FieldInput`, `toastSaveError`, `TEXTAREA_FIELDS`. Không đổi logic. |
| `lib/hooks/useMera.ts` | `useResolveMeraOrder`, `useUpdateMeraItem`, `useUpdateMeraNote`. Tái dùng `jsonFetch`/`ApiError` từ useSheets. |
| `components/messenger/MeraItemEditor.tsx` | `MeraReceiptEditor` (export) + `MeraItemMatchEditor` + `MeraNoteEditor` (private). |
| `components/orders/OrderUpdateSidebar.tsx` | Sidebar cập nhật đơn: Sheet trước → Mera fallback. |

## Files SỬA
| File | Thay đổi |
|---|---|
| `lib/hooks/useSheets.ts` | `ApiError` thêm `latest?: unknown` (ctor param 4); `jsonFetch` đọc `data.latest`; **export `jsonFetch`** (bỏ private). Behavior cũ giữ nguyên. |
| `components/messenger/SheetItemEditor.tsx` | Xoá các component đã move; import `CopyCode, FieldInput, toastSaveError` từ `field-editors.tsx`. Bỏ import `useEffect, useRef`. Flow Sheet giữ nguyên. |
| `components/orders/OrderCard.tsx` | Nút "Cập nhật Sheet" → "Cập nhật" (icon `SquarePen`); prop `onUpdateSheet` → `onUpdate`. |
| `components/orders/OrdersList.tsx` | Rename passthrough `onUpdateSheet` → `onUpdate`. |
| `app/orders/page.tsx` | State `sheetOrder` → `updateOrder`; render `OrderUpdateSidebar` thay `OrderSheetSidebar`. |

## Files XOÁ
- `components/orders/OrderSheetSidebar.tsx` (đã grep: chỉ còn 1 comment mention ở MessageBuyerDialog, không import).

## Hook — queryKey & type tiêu thụ
| Hook | queryKey | Type cast | Ghi chú |
|---|---|---|---|
| `useResolveMeraOrder({store,receiptId,enabled})` | `["mera-order", receiptId]` | `ResolveMeraOrderResponse` | staleTime 30_000, retry false, enabled && Number.isFinite(receiptId). URL `/api/mera/resolve?store=&receiptId=`. |
| `useUpdateMeraItem()` | invalidate `["mera-order"]` | req `MeraUpdateItemRequest` → res `MeraUpdateItemResponse` | POST `/api/mera/update`. |
| `useUpdateMeraNote()` | invalidate `["mera-order"]` | req `MeraUpdateOrderRequest` → res `MeraUpdateOrderResponse` | POST `/api/mera/update`. |

## Field component ĐỌC từ API (cho qa-integration)
- `MeraReceiptEditor` (order-level): `order.orderId`, `order.note`, `order.version`; `resolve.data.reason` (`not_configured`/`not_found`/null); `items[]`.
- `MeraItemMatchEditor` (item): `item.itemKey`, `item.version`, `item.imageLink`, `item.productName`, `item.quantity`, `item.tracking.{code,carrier,url}` (chỉ đọc), + 5 field editable qua `MERA_EDITABLE_ITEM_FIELDS` (`status`, `personalization`, `customerImage`, `designLink`, `mockupLink`).
- Remount key item: `${itemKey}-${version}`; note key: `note-${order.version}`.
- Update item body: `{target:"item", itemKey, version, updates}` — updates chỉ field DIRTY (camelCase).
- Update note body: `{target:"order", orderId, version, note}`.
- Response item đọc `res.splitApplied` → toast "đã bật split items trên Mera".

## Xử lý lỗi (khớp bảng seam lỗi)
- 409 `version_conflict` → `ApiError.code` → toast "Item đã bị sửa bởi người khác — đã tải lại dữ liệu mới" + `resolve.refetch()` (remount theo version).
- 503 `mera_not_configured` (khi save) → toast "Chưa cấu hình Mera API.".
- 502 `mera_unavailable` → toast/notice "Không kết nối được Mera.".
- resolve `reason:"not_configured"` (200 soft) → notice "Chưa cấu hình Mera API (MERA_API_BASE_URL / MERA_INTERNAL_API_KEY)".

## Flow OrderUpdateSidebar
1. `useResolveSheetRow({store,receiptId})`. `sheet.isLoading` → "Đang tìm trong Sheet…".
2. `matches.length>0` → `SheetReceiptEditor` (badge **Sheet**).
3. `tryMera = (sheet.isSuccess && matches.length===0) || sheet.isError` → `useResolveMeraOrder({enabled:tryMera})`.
   - `sheet.isError` → notice phụ ("Chưa kết nối Google…"/"Lỗi tra cứu Sheet…" — đang thử Mera).
   - `mera.isLoading` → "Đang tìm trên Mera…"; `meraOrder` → `MeraReceiptEditor` (badge **Mera**).
4. Cả hai rỗng → "Không tìm thấy đơn ở Sheet lẫn Mera." + lý do phụ (`no_configs` / `not_configured`).
- Bỏ chặn cứng thiếu `shopName` (bản cũ chặn); store rỗng vẫn cho resolve chạy.

## tsc
`npx tsc --noEmit` → sạch (không lỗi). Endpoint `/api/mera/*` do backend làm song song; hook code theo contract, tsc không phụ thuộc file backend.
