import { NextResponse, type NextRequest } from "next/server";
import { requireEmail } from "@/lib/http/api-helpers";
import { deliveryErrorResponse } from "@/lib/http/delivery-error";
import { getDeliveryTracking } from "@/lib/services/delivery-proxy";
import type { DeliveryTrackingDetail } from "@/lib/types/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/delivery/:id — chi tiết 1 mã (events, flags…). id sai → Mera 400 invalid_id / 404 not_found. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;
    const { id } = await ctx.params;
    const body: DeliveryTrackingDetail = await getDeliveryTracking(id, gate.email);
    return NextResponse.json(body);
  } catch (err) {
    return deliveryErrorResponse(err, "GET /api/delivery/:id");
  }
}
