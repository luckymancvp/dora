import { NextResponse } from "next/server";
import { requireEmail } from "@/lib/http/api-helpers";
import { deliveryErrorResponse } from "@/lib/http/delivery-error";
import { getDeliveryProjects } from "@/lib/services/delivery-proxy";
import type { DeliveryProjectsResponse } from "@/lib/types/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/delivery/projects — dữ liệu select Project: project Mera + shop Dora.
 * `doraShops: null` khi Mera chưa hỗ trợ Dora (FE ẩn option Dora), không làm lỗi route.
 */
export async function GET() {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;
    const body: DeliveryProjectsResponse = await getDeliveryProjects(gate.email);
    return NextResponse.json(body);
  } catch (err) {
    return deliveryErrorResponse(err, "GET /api/delivery/projects");
  }
}
