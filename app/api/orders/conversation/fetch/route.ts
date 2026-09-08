import { NextResponse, type NextRequest } from "next/server";
import { requireEmail, errorResponse } from "@/lib/http/api-helpers";
import { publishFetchOrderConvo } from "@/lib/services/ably-publish";

// POST /api/orders/conversation/fetch — yêu cầu extension GET thread từ TRANG ĐƠN.
// body: { shopName, orderId }. Fire-and-forget: extension POST kết quả về
// /v1/extension/order-conversations/sync, frontend poll lại GET /api/orders/conversation.
export async function POST(req: NextRequest) {
  const gate = await requireEmail();
  if (gate instanceof NextResponse) return gate;

  try {
    const body = (await req.json()) as { shopName?: string; orderId?: string | number };
    const shopName = (body.shopName ?? "").trim();
    const orderId = Number(body.orderId);
    if (!shopName || !Number.isFinite(orderId) || orderId <= 0) {
      return NextResponse.json({ error: "shopName và orderId bắt buộc" }, { status: 400 });
    }

    const clientId = await publishFetchOrderConvo(shopName, { order_ids: [orderId] });
    if (!clientId) {
      return NextResponse.json(
        { error: "Shop chưa có extension online", code: "shop_offline" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, clientId });
  } catch (err) {
    return errorResponse(err, "POST /api/orders/conversation/fetch");
  }
}
