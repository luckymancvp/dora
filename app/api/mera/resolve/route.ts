import { NextResponse, type NextRequest } from "next/server";
import { requireEmail, errorResponse } from "@/lib/http/api-helpers";
import { resolveMeraOrder } from "@/lib/services/mera-order";

// GET /api/mera/resolve?store=&receiptId= — tra cứu 1 đơn trên Mera (nhánh song song resolve Sheet).
export async function GET(req: NextRequest) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;
    const sp = req.nextUrl.searchParams;
    const receiptId = Number(sp.get("receiptId"));
    if (!Number.isFinite(receiptId)) {
      return NextResponse.json({ error: "thiếu receiptId" }, { status: 400 });
    }
    const data = await resolveMeraOrder({
      storeName: sp.get("store") ?? "",
      receiptId,
      actorEmail: gate.email,
    });
    return NextResponse.json(data);
  } catch (err) {
    return errorResponse(err, "GET /api/mera/resolve");
  }
}
