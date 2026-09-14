import { NextResponse, type NextRequest } from "next/server";
import { requireEmail, errorResponse } from "@/lib/http/api-helpers";
import { getOrders } from "@/lib/services/orders-read";
import type {
  OrderCompletedStatus,
  OrderDateRange,
  OrderDelivery,
  OrderDispatchBy,
  OrderSort,
} from "@/lib/types/etsy";

// Whitelist giá trị hợp lệ cho từng filter — KHÔNG để chuỗi tuỳ ý của client
// chảy thẳng vào clause Mongo.
const SORTS = ["newest", "oldest", "completed", "destination"] as const satisfies readonly OrderSort[];
const DATE_RANGES = ["all", "30d", "90d", "365d"] as const satisfies readonly OrderDateRange[];
const DISPATCH_BYS = [
  "all",
  "overdue",
  "today",
  "tomorrow",
  "week",
  "none",
] as const satisfies readonly OrderDispatchBy[];
const DELIVERIES = ["all", "refund", "purchased"] as const satisfies readonly OrderDelivery[];
const STATUSES = [
  "all",
  "pre-transit",
  "in-transit",
  "delivered",
  "no-tracking",
  "cancelled",
  "digital",
] as const satisfies readonly OrderCompletedStatus[];

/**
 * Timezone offset trình duyệt (phút). Múi giờ thực tế nằm trong [-840, 840]
 * (UTC+14 … UTC-14); ngoài khoảng/không phải số → 0 (UTC).
 */
function parseTzOffset(raw: string | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && Math.abs(n) <= 840 ? n : 0;
}

/** Nhận param chỉ khi nằm trong whitelist, ngược lại lấy mặc định. */
function pickEnum<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

// GET /api/orders?search&shopName&tab&page&sort&dateRange&dispatchBy&tzOffset&delivery&status&destination
//   &hasNote&isGift&isPersonalized — danh sách đơn (phân trang offset/page).
export async function GET(req: NextRequest) {
  const gate = await requireEmail();
  if (gate instanceof NextResponse) return gate;

  try {
    const sp = req.nextUrl.searchParams;
    const data = await getOrders({
      search: sp.get("search") ?? undefined,
      shopName: sp.get("shopName") ?? undefined,
      tab: sp.get("tab") === "Completed" ? "Completed" : "New",
      page: sp.get("page") ? Number(sp.get("page")) : undefined,
      sort: pickEnum(sp.get("sort"), SORTS, "newest"),
      dateRange: pickEnum(sp.get("dateRange"), DATE_RANGES, "all"),
      dispatchBy: pickEnum(sp.get("dispatchBy"), DISPATCH_BYS, "all"),
      tzOffset: parseTzOffset(sp.get("tzOffset")),
      delivery: pickEnum(sp.get("delivery"), DELIVERIES, "all"),
      status: pickEnum(sp.get("status"), STATUSES, "all"),
      // Tên nước là chuỗi tự do (đến từ facet) — chỉ dùng để so khớp equality
      // hoặc $nin, không nhét vào $regex nên không cần escape.
      destination: sp.get("destination") ?? undefined,
      hasNote: sp.get("hasNote") === "1",
      isGift: sp.get("isGift") === "1",
      isPersonalized: sp.get("isPersonalized") === "1",
    });
    return NextResponse.json(data);
  } catch (err) {
    return errorResponse(err, "GET /api/orders");
  }
}
