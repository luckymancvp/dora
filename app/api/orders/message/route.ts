import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { requireEmail, errorResponse } from "@/lib/http/api-helpers";
import { publishSendOrderMessage } from "@/lib/services/ably-publish";

// POST /api/orders/message — nhắn khách theo đơn (tạo hội thoại mới nếu chưa có).
// body: { shopName, orderId, message }. Fire-and-forget (trạng thái báo về Go backend).
// Auth: session Google (UI) HOẶC header x-api-key khớp MERA_INTERNAL_API_KEY (máy: Apps Script).
export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const expectedKey = process.env.MERA_INTERNAL_API_KEY?.trim();
  const viaApiKey = !!expectedKey && !!apiKey && apiKey.trim() === expectedKey;

  if (!viaApiKey) {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;
  }

  try {
    const body = (await req.json()) as {
      shopName?: string;
      orderId?: string | number;
      message?: string;
    };
    const shopName = (body.shopName ?? "").trim();
    const orderId = String(body.orderId ?? "").trim();
    const message = (body.message ?? "").trim();
    if (!shopName || !orderId || !message) {
      return NextResponse.json(
        { error: "shopName, orderId và message bắt buộc" },
        { status: 400 },
      );
    }

    const id = randomUUID();
    const clientId = await publishSendOrderMessage(shopName, { id, order_id: orderId, message });
    if (!clientId) {
      return NextResponse.json(
        { error: "Shop chưa có extension online", code: "shop_offline" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, id, clientId });
  } catch (err) {
    return errorResponse(err, "POST /api/orders/message");
  }
}
