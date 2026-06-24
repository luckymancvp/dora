import { NextResponse, type NextRequest } from "next/server";
import { requireEmail, errorResponse } from "@/lib/http/api-helpers";
import { publishFetchOrders } from "@/lib/services/ably-publish";

// POST /api/orders/fetch — trigger extension sync đơn từ Etsy.
// body: { shopName, date_from?, date_to? } (date dạng yyyy-mm-dd)
export async function POST(req: NextRequest) {
  const gate = await requireEmail();
  if (gate instanceof NextResponse) return gate;

  try {
    const body = (await req.json()) as {
      shopName?: string;
      date_from?: string;
      date_to?: string;
    };
    const shopName = (body.shopName ?? "").trim();
    if (!shopName) {
      return NextResponse.json({ error: "shopName bắt buộc" }, { status: 400 });
    }

    const clientId = await publishFetchOrders(shopName, {
      date_from: body.date_from,
      date_to: body.date_to,
    });
    if (!clientId) {
      return NextResponse.json(
        { error: "Shop chưa có extension online", code: "shop_offline" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, clientId });
  } catch (err) {
    return errorResponse(err, "POST /api/orders/fetch");
  }
}
