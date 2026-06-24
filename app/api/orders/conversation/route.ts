import { NextResponse, type NextRequest } from "next/server";
import { requireEmail, errorResponse } from "@/lib/http/api-helpers";
import { getOrderConversation } from "@/lib/services/order-conversation";

// GET /api/orders/conversation?orderId=... — hội thoại hiện có của khách trong đơn.
export async function GET(req: NextRequest) {
  const gate = await requireEmail();
  if (gate instanceof NextResponse) return gate;

  try {
    const orderId = Number(req.nextUrl.searchParams.get("orderId"));
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return NextResponse.json({ error: "orderId không hợp lệ" }, { status: 400 });
    }
    const data = await getOrderConversation(orderId);
    return NextResponse.json(data);
  } catch (err) {
    return errorResponse(err, "GET /api/orders/conversation");
  }
}
