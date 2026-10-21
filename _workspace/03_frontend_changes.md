# 03 — Frontend: màn /delivery (F1–F3)

Ngày 2026-10-21 · contract `_workspace/01_architect_contract.md` §4 · type `lib/types/delivery.ts` (không định nghĩa type cục bộ cho shape API).

## F1 — Helper thuần `lib/delivery/*`
| File | Nguồn Mera | Ghi chú |
|---|---|---|
| `deliveryTracking.ts` | `src/lib/deliveryTracking.ts` | Bỏ `TRACKING_ALL_PROJECTS`, `trackingOrderIds`, hằng Dora trùng (dùng `DORA_PROJECT_ID`/`isDoraProjectId`/`DORA_SHOP_PROJECT_PREFIX` của types). `project` '' = Tất cả (A12). `buildDeliveryTrackingQuery` giữ nguyên. **Thêm** `trackingListParams(state, withPage)` (URL state → `DeliveryTrackingListParams`, dùng chung list + export). `refreshErrorMessage`: thêm nhánh `code` bắt đầu `mera_` → dùng câu của route (lỗi hạ tầng S10), đặt TRƯỚC nhánh `status===503` (để `mera_not_configured` không bị báo nhầm "thiếu INTERNAL_API_KEY"). |
| `carrierTrackingUrl.ts` | `src/lib/carrierTrackingUrl.ts` | Nguyên văn. |
| `trackingSelection.ts` | `src/lib/trackingSelection.ts` | Nguyên văn (`BULK_MAX_PER_SHOP=50`). |
| `trackingExport.ts` | `src/lib/trackingExport.ts` | Header/rows giữ nguyên. Ghi bằng `(await import("exceljs")).default` → `writeBuffer()` → Blob → `<a download>`; cột rộng như Mera, `autoFilter` A1:<cột cuối><n+1>, hàng header đậm. Không thêm `xlsx`. |
| `review.ts` | `mera-shared/frontend/etsy-review/review.ts` | `MAX_REVIEW_STARS, reviewStarCount, formatReviewRating, formatReviewDateTime, normalizeReviewMessage, shortenReviewMessage, hasReview, collectItemReviews`. |
| `orderLink.ts` | mới | `doraOrdersLink(o)` → `/orders?search=<etsy_receipt_id || normalizeOrderId(order_id)>` (rỗng cả hai → `/orders`); `isDoraSheetOrder(o)`. |

## F2 — `lib/hooks/useDelivery.ts`
| Hook / hàm | Gọi | queryKey | Type cast |
|---|---|---|---|
| `fetchDeliveryList(p, signal?)` | GET `/api/delivery?<buildDeliveryTrackingQuery(p)>` | — (export dùng thẳng) | `DeliveryTrackingListResponse` |
| `useDeliveryTrackings(p)` | như trên | `["delivery","list",p]`, `keepPreviousData`, staleTime 15s | `DeliveryTrackingListResponse` |
| `useDeliveryTracking(id)` | GET `/api/delivery/:id` | `["delivery","detail",id]`, enabled `!!id` | `DeliveryTrackingDetail` |
| `useDeliveryProjects()` | GET `/api/delivery/projects` | `["delivery","projects"]`, staleTime 5m, retry false | `DeliveryProjectsResponse` |
| `useRefreshDelivery()` | POST `/api/delivery/:id/refresh` | mutationKey `["delivery","refresh"]`; onSuccess `setQueryData(["delivery","detail",id])` + `setQueriesData(["delivery","list"])` thay row cùng id bằng `rowFromDetail` | `DeliveryTrackingDetail` |
| `useRefreshingDeliveryIds()` (thêm) | `useMutationState` pending của mutationKey trên | — | `Set<string>` id đang làm mới (spinner theo dòng) |
| `useStartBulkRefresh()` | POST `/api/delivery/bulk-refresh` body `{ids}` | onSuccess `setQueryData(["delivery","bulk",job.id], job)` | `BulkRefreshJob` |
| `useBulkRefreshJob(jobId)` | GET `/api/delivery/bulk-refresh/:job` | `["delivery","bulk",jobId]`, enabled `!!jobId`, `refetchInterval` 3000 tới `done` (**dừng cả khi lỗi**), retry false | `BulkRefreshJob` |

- Lỗi: helper nội bộ `deliveryFetch` — `!res.ok` → JSON có `error` string thì giữ NGUYÊN body, không thì `{error: String(status)}` → `throw new DeliveryApiError(status, body)` (`.code`, `.body.shop`…). Mọi 2xx là thành công (202 bulk OK — QA (i)).
- `rowFromDetail`: bỏ `events, flags, review_check, review_error, mera_carrier, status_changed_at, first_event_at, error_count, hidden, created_at, updated_at`. `orders` qua `mergeScopedOrders(prev.orders, detail.orders)` (sửa QA round 1 / F3): **giữ tập đơn của row** (list trả đơn theo phạm vi project đang xem, detail trả đơn mọi project + Dora); chỉ thay đơn khớp khoá `order_id + (source ?? "mera") + store` bằng bản của detail; detail thiếu đơn → giữ bản cũ; KHÔNG thêm đơn ngoài phạm vi (QA (ii) + đếm mã/shop khi chọn hàng loạt đúng).
- Drawer: `view = { ...detail, ...row }` → đơn hiển thị là đơn của row (đúng phạm vi), detail chỉ bổ sung events/flags/mera_carrier.
- Bulk `done` → `BulkRefreshBar` gọi `onDone` đúng 1 lần/job → `DeliveryPage` `invalidateQueries(["delivery","list"])` + `["delivery","detail"]`.
- Refresh lỗi `shop_offline`/`etsy_read_failed` → invalidate list + detail của mã (Mera ghi `last_error` lên dòng).

## F3 — Trang + component
- `app/delivery/page.tsx` ("use client") → `<DeliveryPage/>`.
- `components/delivery/`: `DeliveryPage` (URL ⇄ state), `DeliveryToolbar`, `DeliveryStatusTabs`, `DeliveryFilters`, `BulkRefreshBar`, `DeliveryTable`, `DeliveryRow` (+ `DoraSourceBadge`), `DeliveryPagination`, `DeliveryEventsDrawer`, `ReviewStars` (`ReviewStars/ReviewDetail/ReviewLine`).
- `components/sidebar.tsx`: `{ href: "/delivery", label: "Giao hàng", icon: PackageCheck }` ngay sau Tracking.
- URL: `useSyncExternalStore` đọc `window.location.search` (server snapshot null → render "Đang tải…", chưa gọi API); parse 1 lần làm state khởi tạo; state → URL bằng `router.replace(…, {scroll:false})` khi khác URL hiện tại. Không `useSearchParams`. Key URL: `project,status,q,store,provider,rating,date_field,from,to,page,limit` (như Mera).
- Search debounce **400ms** (theo task/Mera; contract ghi ~300ms), Enter = đẩy ngay. Đổi filter bất kỳ → page 1; đổi tab → `rating=null`; đổi project → bỏ `store`/`provider`.
- Project select: `''` Tất cả · `projects[]` · "Dora" (hiện khi `doraShops !== null` hoặc đang chọn dora*) · "Dora - {store} ({count})". Project/shop đang chọn qua URL mà không có trong danh sách vẫn hiện để bỏ chọn được.
- Link đơn: `doraOrdersLink(o)` (mở tab mới), mọi đơn (Mera lẫn Dora); `source==="dora_sheet"` → nhãn "Dora". Không icon hội thoại (A10).
- UI: chỉ `components/ui/button`; select/drawer/popover review bằng phần tử thuần + Tailwind token theme (dark mode). Toast `sonner`.

## Field component đọc (cho QA)
- List (S1): `items[]`, `total`, `counts[all|<status>|delivered_no_review|delivered_rating_N]` (thiếu = 0), `stores[].store/count`, `providers[].provider/count`.
- Row: `id, code, carrier, tracking_url, status, major_state, latest_event{desc,location,time}, transit_days, paid_at, mailing_date, delivered_at, last_checked_at, last_error`; `orders[].{order_id, store, etsy_receipt_id, source, on_etsy, items[].{item_key, product_name, latest_provider, review}}`.
- Detail (S5): `events[]{time,desc,location}`, `flags?.detailed` (false → ghi chú "Extension Dora bản cũ"), `mera_carrier`, `next_check_at`, `last_error_at`; refresh: `review_check{receipts,item_reviews,error}`, `review_error`.
- Lỗi (S6/S10): `DeliveryApiError.status`, `.code`, `.body.shop`, `.message` (= `body.error`) → `refreshErrorMessage`. Bulk start lỗi: `code==="shop_bulk_running"` → toast warning, còn lại error.
- Bulk (S8): `id, done, shops[].{shop, phase, codes, updated, failed, review_receipts, reviews_read, item_reviews, error, review_error}`, `no_receipt[]`.
- Projects (S3): `projects[].id/name`, `doraShops[].store/count | null`.

## Kiểm tra
- `npx tsc --noEmit`: sạch (exit 0, gồm cả code backend hiện có).
- `npm run lint`: **không chạy được** — repo không có `eslint` trong deps và không có `eslint.config.*` (`'eslint' is not recognized`). Không thêm deps (ngoài phạm vi). Đã lint file mới bằng eslint 9 + typescript-eslint recommended + react-hooks recommended cài TẠM ở scratchpad: 0 lỗi sau khi sửa 2 lỗi `set-state-in-effect`. (Cùng cấu hình đó báo 1 lỗi có sẵn ở `components/sidebar.tsx:75` — code cũ, không sửa.)
- Chưa chạy trình duyệt với Mera dev (phần Q1).
