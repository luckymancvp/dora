# 03 — Frontend: Ghim tag + mở "Đã xong" (F1–F5)

Ngày: 2026-09-30 · Theo `_workspace/01_architect_contract.md`. Không đổi type, không sửa `useOpenMultiple` / `/open-multiple`.

## File đã đổi

| File | Task | Thay đổi |
|---|---|---|
| `lib/hooks/useAnalytics.ts` | F1 | + `completedConversationsKey(filters, scope)` → `["analytics","completed",filters,scope] as const`; + `fetchCompletedConversations(filters, scope): Promise<CompletedConversationsResponse>` (không phải useQuery) |
| `lib/hooks/usePinnedTags.ts` (mới) | F2 | `usePinnedTags()`, `useTogglePinnedTag()` |
| `components/dashboard/useOpenCompleted.ts` (mới) | F3 | `useOpenCompleted(filters)` → `{ openCompleted(scope, shopName?), pendingKey }`; export thêm `completedScopeKey(scope)` |
| `components/dashboard/TagsOverview.tsx` | F4 | cột "Đã xong" (pill mở), nút ghim, sort ghim trước |
| `components/dashboard/MessageOverview.tsx` | F5 | ô "Đã xong" → pill mở theo shop |

## Hook / queryKey / type

| Hook | Key | Type | Endpoint |
|---|---|---|---|
| `fetchCompletedConversations` qua `queryClient.fetchQuery` (staleTime 8s) | `["analytics","completed",filters,scope]` | `CompletedConversationsResponse` | `GET /api/analytics/completed-conversations?from&to&shopIds` + đúng 1 trong `tag=` / `untagged=1` / `shopId=` |
| `usePinnedTags` (staleTime 5 phút, không refetchInterval) | `["me","pinned-tags"]` | `PinnedTagsResponse` | `GET /api/me/pinned-tags` |
| `useTogglePinnedTag` (mutationKey `["me","pinned-tags"]`) | — | body `PinTagBody`, trả `PinnedTagsResponse` | `PATCH /api/me/pinned-tags` |

`useTogglePinnedTag`: `onMutate` cancel + snapshot + setQueryData (bỏ tag rồi thêm lại nếu `pinned`); `onError` rollback + `toast.error("Không lưu được tag ghim")`; `onSettled` chỉ invalidate khi `isMutating({ mutationKey }) === 1`.

## Field component đọc

- TagsOverview: `t.tag`, `t.untagged`, `t.total`, `t.unread`, `t.completed` (không tự tính total-unread), `t.unreadConversations`; `pinnedQuery.data?.pinnedTags`.
- MessageOverview: `s.shopId`, `s.shopName`, `s.completed` (+ các field cũ).
- useOpenCompleted: `data.items`, `data.total`, `data.truncated`.

## Hành vi UI

- **Ô "Đã xong"** (cả 2 bảng): `completed > 0` → `<button>` pill `bg-success-soft text-success`, icon `ExternalLink` h-3 w-3 + số, `title="Mở tin đã xong"`; đang tải scope đó → `Loader2 animate-spin` + `disabled`. `completed === 0` → số `0` `text-muted-foreground`.
  - Tag: scope `t.untagged ? {kind:"untagged"} : {kind:"tag", tag: t.tag}` (dòng No Tag KHÔNG gửi `tag=No Tag`), không truyền shopName (giữ `shop` từ API).
  - Shop: scope `{kind:"shop", shopId: s.shopId}` (shopId=0 hợp lệ), truyền `s.shopName` → ghi đè `shop` mọi item.
- **openCompleted**: rỗng → `toast.info("Không có tin đã xong trong phạm vi này")`, không mở; có → `openMultiple(items)`, nếu `truncated` → `toast.info("Chỉ mở N/total tin đã xong mới nhất")`; lỗi → `toast.error("Không tải được danh sách tin đã xong")`. Click trùng cùng scope khi đang pending bị bỏ qua (chặn bằng ref, không chờ re-render).
- **Ghim**: icon `Pin` trước icon Tag ở mọi dòng (kể cả No Tag); đã ghim `fill-current text-primary`, chưa ghim `text-muted-foreground`; `aria-label`/`title` "Ghim tag" | "Bỏ ghim tag", `aria-pressed`. Khoá = `t.untagged ? UNTAGGED_PIN_KEY : t.tag` (không dùng `tagLabel`).
- **Sort**: ghim trước, trong nhóm `unread` desc (Array.sort ổn định). Pinned đang tải/lỗi → coi như `[]`. Tag ghim không có dòng trong kỳ → không hiện.
- Cột bảng tag: `Tag | Tổng | Chưa trả lời | Đã xong | Hành động`. StatCard, nút "Mở tin" tổng, cột Hành động "Mở N" giữ nguyên.

## Lệch contract / ghi chú

- Không lệch type. Thêm export phụ `completedScopeKey()` trong `useOpenCompleted.ts` (dùng chung để so `pendingKey` ở 2 bảng) — format đúng ví dụ contract: `tag:<tên>`, `untagged`, `shop:<id>`.
- `pendingKey` là 1 giá trị: bấm scope B khi A đang tải thì spinner chuyển sang B (A vẫn chạy xong và mở như bình thường).
- Rollback optimistic khi cache pinned chưa từng có dữ liệu (`previous === undefined`): `setQueryData(undefined)` là no-op ở TanStack v5 → giá trị lạc quan còn lại tới khi invalidate ở `onSettled` refetch lại từ server.
- `npx tsc --noEmit`: sạch (exit 0), bao gồm cả code backend hiện có.
