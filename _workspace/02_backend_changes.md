# 02 — Backend changes: search nâng cao trong getOrders

## File sửa
- `lib/services/orders-read.ts` — hàm `getOrders`, block `if (search)` (~line 273-286).

Không đụng: route, type, projection (`LIST_PROJECTION` đã có `"data.transactions": 1`), hook.

## Logic mới
1. Giữ 2 clause regex `buyer.name` / `buyer.username` (không đổi).
2. Trích dãy số liền cuối query bằng `search.match(/(\d+)\s*$/)` để bỏ prefix chữ
   (vd `TEST-2914171501` → `2914171501`). Fallback `Number(search)` nếu không khớp regex.
3. Guard `Number.isFinite(asNum)` — chỉ push clause số khi hợp lệ, tránh `NaN`.
4. Khi hợp lệ, push cùng lúc 2 clause số:
   - `{ "data.order_id": asNum }` (đơn theo order ID)
   - `{ "data.transactions.transaction_id": asNum }` (Mongo tự dò array-of-subdoc bằng
     equality, KHÔNG dùng `$elemMatch` vì chỉ 1 điều kiện).

## Shape `$or` cuối cùng (khi query có số hợp lệ)
```js
{ $or: [
  { "data.buyer.name":     { $regex: search, $options: "i" } },
  { "data.buyer.username": { $regex: search, $options: "i" } },
  { "data.order_id": <num> },
  { "data.transactions.transaction_id": <num> },
] }
```
Khi query thuần chữ (không có số cuối): chỉ 2 clause regex.

## Ví dụ query match
| Query người dùng gõ | `asNum` | Kết quả |
|---------------------|---------|---------|
| `TEST-2914171501`   | 2914171501 | match `data.order_id` = 2914171501 hoặc transaction_id = 2914171501 |
| `2914171501`        | 2914171501 | như trên |
| `3891234567` (transactionId) | 3891234567 | match đơn chứa transaction có `transaction_id` = 3891234567 |
| `John`              | NaN → không push | chỉ regex buyer.name/username |
| `#2914171501`       | 2914171501 | regex số cuối vẫn bắt được |

## Kiểm tra type
`npx tsc --noEmit`: file `orders-read.ts` sạch. Lỗi duy nhất còn lại thuộc
`components/orders/OrderCard.tsx` (`OrderItemRow` — việc đang làm của frontend-engineer),
không liên quan backend.
