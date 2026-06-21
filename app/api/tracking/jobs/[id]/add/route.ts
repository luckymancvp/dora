import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { confirmAdd, ShopOfflineError } from "@/lib/services/tracking";

// POST /api/tracking/jobs/:id/add  body: { orderIds: string[] }
// Xác nhận add tracking cho các đơn đã chọn (gồm cả đơn EXISTS muốn override).
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const { id } = await ctx.params;
    const body = (await req.json()) as { orderIds?: string[] };
    const orderIds = (Array.isArray(body.orderIds) ? body.orderIds : [])
      .map((s) => String(s).trim())
      .filter(Boolean);
    if (orderIds.length === 0) {
      return NextResponse.json({ error: "orderIds rỗng" }, { status: 400 });
    }

    const job = await confirmAdd(id, orderIds);
    if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ job });
  } catch (err) {
    if (err instanceof ShopOfflineError) {
      return NextResponse.json({ error: err.message, code: "shop_offline" }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /api/tracking/jobs/:id/add]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
