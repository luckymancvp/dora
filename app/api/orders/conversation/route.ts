import { NextResponse, type NextRequest } from "next/server";
import { requireEmail, errorResponse } from "@/lib/http/api-helpers";
import { getOrderConversation } from "@/lib/services/order-conversation";

// GET /api/orders/conversation?orderId=... — hội thoại hiện có của khách trong đơn.
//
// Auth: session Google (UI) HOẶC x-api-key khớp MERA_INTERNAL_API_KEY. Mera cần đường
// này vì nó là nguồn DUY NHẤT thấy được thread của khách guest / khách chưa trả lời:
// những thread đó không nằm trong inbox nên mọi phép tìm hội thoại qua inbox đều trượt,
// và Mera đọc cái trượt đó thành "khách chưa nhắn gì".
export async function GET(req: NextRequest) {
  const expectedKey = process.env.MERA_INTERNAL_API_KEY?.trim();
  const apiKey = req.headers.get("x-api-key")?.trim();
  const viaApiKey = !!expectedKey && !!apiKey && apiKey === expectedKey;

  if (!viaApiKey) {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;
  }

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
