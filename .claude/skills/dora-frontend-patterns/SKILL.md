---
name: dora-frontend-patterns
description: Convention frontend THẬT của dora-1 (messengerMeta) — TanStack Query hook (lib/hooks), React 19 + Next.js 16 App Router, ranh giới server/client, shadcn/Tailwind (components/ui). Dùng skill này bất cứ khi nào viết/sửa hook trong lib/hooks hoặc component trong app/ và components/. Cũng dùng khi thêm data-fetching, tiêu thụ endpoint mới, hoặc dựng UI. Với pattern React generic, kết hợp skill toàn cục react-patterns. KHÔNG dùng cho service/route (xem dora-backend-patterns).
---

# dora-1 Frontend Patterns

Convention tầng UI + data-fetching. Bám mẫu Orders: `lib/hooks/useOrders.ts` + `components/orders/*`.

## Data-fetching — TanStack Query, không tự fetch

Mọi lời gọi API đi qua một hook trong `lib/hooks/`. Khuôn chuẩn (xem [useOrders.ts](../../lib/hooks/useOrders.ts)):

```ts
"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { OrdersResponse, OrderFilters } from "@/lib/types/etsy";

async function fetchOrders(filters: OrderFilters): Promise<OrdersResponse> {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  params.set("tab", filters.tab);
  params.set("page", String(filters.page));
  const res = await fetch(`/api/orders?${params.toString()}`);
  if (!res.ok) throw new Error(`orders ${res.status}`);
  return (await res.json()) as OrdersResponse;   // ← type CHUNG với service, không định nghĩa lại
}

export function useOrders(filters: OrderFilters) {
  return useQuery({
    queryKey: ["orders", filters],   // ← filter nằm trong key: đổi filter = refetch
    queryFn: () => fetchOrders(filters),
    placeholderData: keepPreviousData, // ← giữ rows cũ khi đổi trang, chống nhấp nháy
    staleTime: 10_000,
  });
}
```

Quy tắc:
- **Type cast `as T` phải là type contract chung** (khai trong `lib/types`), KHÔNG type cục bộ. Đây là điểm QA so khớp với service.
- **queryKey chứa mọi biến ảnh hưởng kết quả** (filter object). Thiếu → cache trả sai dữ liệu khi filter đổi.
- Build query string bằng `URLSearchParams`; chỉ set param khi có giá trị (trim rỗng thì bỏ) — khớp cách route đọc param.
- Ném `Error` khi `!res.ok`; để React Query xử lý retry/error state.
- Mutation dùng `useMutation` + invalidate queryKey liên quan (xem `useSendMessage.ts`).

## Ranh giới server/client (Next.js 16 App Router)

- Component dùng hook / state / event handler → `"use client"` ở đầu file.
- Trang/layout mặc định là server component — giữ vậy khi chỉ render tĩnh hoặc fetch phía server.
- Không cast `any` khi đọc field từ response; đọc theo đúng type contract để QA so khớp được.

## UI — shadcn + Tailwind

- Dùng lại component trong [components/ui](../../components/ui); không tự dựng lại button/dialog/input.
- Tailwind v4; theme qua `next-themes`. Icon `lucide-react`. Toast `sonner`.
- Component nghiệp vụ đặt theo domain: `components/orders`, `components/messenger`, `components/board`, `components/dashboard`.
- List dài dùng `@tanstack/react-virtual` (đã có trong deps) thay vì render toàn bộ.
- Comment tiếng Việt khớp giọng repo.

## Checklist trước khi báo xong

- [ ] Hook cast đúng type contract chung (grep thấy cùng type name với service).
- [ ] queryKey chứa đủ biến filter; có `staleTime` / `keepPreviousData` khi phân trang.
- [ ] Mọi field component đọc đều tồn tại trong type contract (thiếu → QA bắt).
- [ ] `"use client"` đúng chỗ; không fetch trong `useEffect`.
- [ ] Dùng lại `components/ui`, không tự dựng.
- [ ] `npm run build` sạch.
