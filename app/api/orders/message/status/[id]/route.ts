import { NextResponse, type NextRequest } from "next/server";
import { requireEmail, errorResponse } from "@/lib/http/api-helpers";
import { getOrderMessageStatus } from "@/lib/services/order-message";

// GET /api/orders/message/status/:id — panel "Nhắn khách" poll sau khi bấm Gửi
// để biết Etsy đã nhận thật chưa (extension báo về qua /v1/extension/order-messages/status).
// Auth: session Google (UI) HOẶC x-api-key khớp MERA_INTERNAL_API_KEY — cùng cặp với
// POST /api/orders/message: bên nào gửi được tin thì phải đọc được kết quả của chính nó,
// nếu không thì máy gọi máy chỉ biết "đã publish" chứ không biết Etsy có nhận hay không.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const expectedKey = process.env.MERA_INTERNAL_API_KEY?.trim();
  const apiKey = req.headers.get("x-api-key")?.trim();
  const viaApiKey = !!expectedKey && !!apiKey && apiKey === expectedKey;

  if (!viaApiKey) {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;
  }

  try {
    const { id } = await ctx.params;
    const status = await getOrderMessageStatus(id);
    if (!status) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(status);
  } catch (err) {
    return errorResponse(err, "GET /api/orders/message/status/:id");
  }
}
