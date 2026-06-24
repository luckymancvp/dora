import { NextResponse, type NextRequest } from "next/server";
import { requireEmail, errorResponse } from "@/lib/http/api-helpers";
import { getOrders } from "@/lib/services/orders-read";

// GET /api/orders?search&shopName&tab&page — danh sách đơn (phân trang offset/page).
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
    });
    return NextResponse.json(data);
  } catch (err) {
    return errorResponse(err, "GET /api/orders");
  }
}
