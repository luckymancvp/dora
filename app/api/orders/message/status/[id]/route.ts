import { NextResponse } from "next/server";
import { requireEmail, errorResponse } from "@/lib/http/api-helpers";
import { getOrderMessageStatus } from "@/lib/services/order-message";

// GET /api/orders/message/status/:id — panel "Nhắn khách" poll sau khi bấm Gửi
// để biết Etsy đã nhận thật chưa (extension báo về qua /v1/extension/order-messages/status).
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireEmail();
  if (gate instanceof NextResponse) return gate;

  try {
    const { id } = await ctx.params;
    const status = await getOrderMessageStatus(id);
    if (!status) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(status);
  } catch (err) {
    return errorResponse(err, "GET /api/orders/message/status/:id");
  }
}
