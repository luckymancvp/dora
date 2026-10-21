import { NextResponse, type NextRequest } from "next/server";
import { requireEmail } from "@/lib/http/api-helpers";
import { deliveryErrorResponse } from "@/lib/http/delivery-error";
import { refreshDeliveryTracking } from "@/lib/services/delivery-proxy";
import type { DeliveryTrackingDetail } from "@/lib/types/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Mera đọc Etsy qua extension (≤45s/shop) + review — service timeout 55s, chừa 5s biên trước khi hàm bị cắt.
export const maxDuration = 60;

/**
 * POST /api/delivery/:id/refresh — làm mới 1 mã ngay. 200 = detail (+ review_check / review_error).
 * Lỗi Mera chuyển tiếp nguyên (too_soon+retry_after, shop_offline+shop+detail, shop_busy, no_receipt…).
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;
    const { id } = await ctx.params;
    const body: DeliveryTrackingDetail = await refreshDeliveryTracking(id, gate.email);
    return NextResponse.json(body);
  } catch (err) {
    return deliveryErrorResponse(err, "POST /api/delivery/:id/refresh");
  }
}
