# 02 — Backend: Ghim tag + mở "Đã xong" (B1–B6)

Ngày: 2026-09-30 · Contract: `_workspace/01_architect_contract.md`. Không đổi type trong `lib/types/etsy.ts` / `lib/types/user-preferences.ts`.

## File đã đổi / tạo

| Task | File | Thay đổi |
|---|---|---|
| B1 | `lib/services/analytics.ts` | + `COMPLETED_MATCH` (dưới `UNREAD_EXPR`, phần bù chính xác), + `UNTAGGED_MATCH` (dùng trong `untaggedRow` — hành vi không đổi), `getTagsOverview` thêm `completed = max(total-unread,0)` cho dòng tag + No Tag, + `scopeMatch()` (private), + `export getCompletedConversations(opts, scope)` |
| B2 | `lib/services/analytics-params.ts` | + `parseCompletedScope(req): CompletedScope \| { error }` |
| B3 | `app/api/analytics/completed-conversations/route.ts` | mới — GET |
| B4 | `lib/db/collections.ts` | + `getUserPreferencesCollection()` → `meta_local.user_preferences` |
| B4 | `lib/db/indexes.ts` | + `USER_PREFERENCE_INDEXES` (`uq_email` unique), gọi trong `ensureIndexes` |
| B5 | `lib/services/user-preferences.ts` | mới — `PreferenceError`, `getPinnedTags(email)`, `setTagPinned(email, body)` |
| B6 | `app/api/me/pinned-tags/route.ts` | mới — GET, PATCH |

Không đổi: `getMessageOverview`, `ShopOverviewRow`, `fetchUnreadConversations`, `proxy.ts`.

## Endpoint

### GET `/api/analytics/completed-conversations`

Query: `from`, `to`, `shopIds` (y như overview, qua `parseAnalyticsParams`) + đúng 1 trong `tag` | `untagged=1` | `shopId`.

Filter: `{ $and: [buildBaseMatch(opts), scopeMatch(scope), COMPLETED_MATCH] }`, trong đó
- `COMPLETED_MATCH = { $or: [ { "etsy.has_replied": { $ne: false } }, { tags: { $in: ["handled","approved"] } } ] }`
- scope `tag` → `{ tags: tag }`; `untagged` → `UNTAGGED_MATCH`; `shop>0` → `{ "user_data.user_id": id }`; `shop=0` → `{ "user_data.user_id": { $not: { $gt: 0 } } }`.

Song song: `find(projection UNREAD_PROJECTION).sort({lastMessageDate:-1,_id:-1}).limit(500)` + `countDocuments` + `getShops()`.

```
GET /api/analytics/completed-conversations?from=1756684800&to=1759276799&tag=handled
200 {
  "items": [
    { "conversationId": 123456789, "name": "Jane", "avatar": "https://…", "lastMessageDate": 1759270000, "shop": "DoubleTees" },
    { "conversationId": 123450000, "name": "Bob",  "avatar": "",          "lastMessageDate": 1759100000 }   // shopUserId ≤ 0 → không có field shop
  ],
  "total": 2,
  "truncated": false
}

GET /api/analytics/completed-conversations?untagged=1
GET /api/analytics/completed-conversations?shopId=0&shopIds=11,22     // shopId=0 hợp lệ
GET /api/analytics/completed-conversations?shopId=33&shopIds=11,22    // ngoài tập → {items:[],total:0,truncated:false}

400 { "error": "cần đúng 1 trong các tham số: tag, untagged, shopId" }   // 0 hoặc ≥2 tham số
400 { "error": "tag không được rỗng" } | { "error": "tag tối đa 100 ký tự" }
400 { "error": "untagged chỉ nhận giá trị 1" }
400 { "error": "shopId phải là số nguyên ≥ 0" }   // chỉ nhận /^\d+$/ (từ chối "", " 5", "1e3", "-1", "1.5")
401 { "error": "unauthenticated" }
500 { "error": "<message>" }
```

`items[].shop`: `getShops()` map `userId → shopName`, fallback `Shop <id>` khi id > 0, id ≤ 0 → bỏ field (giống bucket unread của tags-overview). Bảng shop ghi đè bằng `s.shopName` ở frontend (F3).

Lưu ý tham số: "có mặt" = `searchParams.get(k) !== null`, nên `?tag=` (rỗng) tính là có mặt → 400 "tag không được rỗng". Frontend chỉ được gửi đúng 1 key.

### GET `/api/me/pinned-tags`

```
200 { "pinnedTags": ["urgent", "__untagged__"] }     // chưa có doc → { "pinnedTags": [] }
401 { "error": "unauthenticated" }
```

### PATCH `/api/me/pinned-tags`

```
PATCH /api/me/pinned-tags   { "tag": "urgent", "pinned": true }
200 { "pinnedTags": ["urgent"] }                   // $addToSet, upsert theo email

PATCH /api/me/pinned-tags   { "tag": "urgent", "pinned": false }
200 { "pinnedTags": [] }                           // $pull, không upsert; chưa có doc → []

400 { "error": "body phải là JSON object" }        // JSON hỏng / null / mảng / primitive
400 { "error": "tag bắt buộc" }                    // không phải string hoặc rỗng sau trim
400 { "error": "tag tối đa 100 ký tự" }
400 { "error": "pinned phải là boolean" }
400 { "error": "tối đa 100 tag ghim" }             // ghim MỚI khi đã đủ 100; ghim lại tag đã có vẫn 200
401 { "error": "unauthenticated" }
```

Tag lưu nguyên văn (không trim) — khớp `TagOverviewRow.tag` / `UNTAGGED_PIN_KEY`. Luôn `$set updated_at`. Response đọc từ `findOneAndUpdate(returnDocument: "after")`, đọc `pinnedTags` phòng thủ (không phải mảng → `[]`, lọc phần tử không phải string).

## Lệch khỏi contract / ghi chú

- Không lệch type hay hành vi.
- Kiểm tra trần `PINNED_TAGS_MAX` là đọc-rồi-ghi (không nguyên tử): 2 lần ghim tag mới đồng thời khi còn đúng 1 chỗ có thể vượt trần 1. Chấp nhận — trần chỉ để chặn lạm dụng; `$addToSet`/`$pull` vẫn nguyên tử nên không mất tag.
- `countDocuments` + `find` chạy song song, không cùng snapshot: nếu dữ liệu đổi giữa 2 lệnh, `total` có thể lệch `items.length` 1–2 (chỉ ảnh hưởng toast `truncated`).
- `npx tsc --noEmit`: sạch (0 lỗi) tại thời điểm chạy.
