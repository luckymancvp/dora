import { NextResponse, type NextRequest } from "next/server";
import { requireEmail } from "@/lib/http/api-helpers";
import { deliveryErrorResponse } from "@/lib/http/delivery-error";
import { listDeliveryTrackings } from "@/lib/services/delivery-proxy";
import type { DeliveryTrackingListResponse } from "@/lib/types/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/delivery — danh sách mã tracking (proxy Mera `GET /api/v2/delivery-trackings`).
 * Query = đúng query Mera (`buildDeliveryTrackingQuery`): project_id, status, q, store, provider,
 * date_field (paid|ship|requested), from, to, review, rating, review_request, sort, page, limit. Không validate lại — Mera trả 400 kèm code.
 */
export async function GET(req: NextRequest) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;
    const body: DeliveryTrackingListResponse = await listDeliveryTrackings(
      req.nextUrl.searchParams,
      gate.email,
    );
    return NextResponse.json(body);
  } catch (err) {
    return deliveryErrorResponse(err, "GET /api/delivery");
  }
}
