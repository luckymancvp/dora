import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { createJob, listJobHistory, ShopOfflineError } from "@/lib/services/tracking";
import type { TrackingOrderInput } from "@/lib/types/tracking";

// GET /api/tracking/jobs?q=&shop=&page=&limit=
// Lịch sử add tracking, phân trang. Trả TrackingHistoryResponse PHẲNG
// ({ items, page, pageSize, total, totalPages }) — KHÁC POST (bọc { job }).
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const sp = req.nextUrl.searchParams;
    // parseInt phòng thủ: NaN → để service clamp về default (page 1, limit 20).
    const page = parseInt(sp.get("page") ?? "", 10);
    const limit = parseInt(sp.get("limit") ?? "", 10);
    const result = await listJobHistory({
      q: (sp.get("q") ?? "").trim(),
      shop: (sp.get("shop") ?? "").trim(),
      page: Number.isFinite(page) ? page : 1,
      limit: Number.isFinite(limit) ? limit : 20,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[GET /api/tracking/jobs]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/tracking/jobs
// body: { shopName, shopId?, orders: [{ order_id, tracking_number, carrier }] }
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const body = (await req.json()) as {
      shopName?: string;
      shopId?: number | null;
      orders?: TrackingOrderInput[];
    };

    const shopName = (body.shopName ?? "").trim();
    if (!shopName) {
      return NextResponse.json({ error: "shopName bắt buộc" }, { status: 400 });
    }

    const orders = (Array.isArray(body.orders) ? body.orders : [])
      .map((o) => ({
        order_id: String(o.order_id ?? "").trim(),
        tracking_number: String(o.tracking_number ?? "").trim(),
        carrier: String(o.carrier ?? "").trim(),
      }))
      .filter((o) => o.order_id && o.tracking_number);

    if (orders.length === 0) {
      return NextResponse.json(
        { error: "cần ít nhất 1 đơn có order_id và tracking" },
        { status: 400 },
      );
    }

    const job = await createJob({
      shopName,
      shopId: body.shopId ?? null,
      orders,
      senderEmail: session.user.email,
    });
    return NextResponse.json({ job });
  } catch (err) {
    if (err instanceof ShopOfflineError) {
      return NextResponse.json({ error: err.message, code: "shop_offline" }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /api/tracking/jobs]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
