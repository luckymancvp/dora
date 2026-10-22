import { NextResponse, type NextRequest } from "next/server";
import { requireEmail } from "@/lib/http/api-helpers";
import { deliveryBadRequest, deliveryErrorResponse } from "@/lib/http/delivery-error";
import { getReviewRequestSummary } from "@/lib/services/review-request-proxy";
import type { ReviewRequestSummary } from "@/lib/types/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/delivery/review-requests/summary?project_id=<hex|dora> — đếm hàng đợi / đã gửi hôm nay +
 * lỗi gần đây (chân dialog Request reviews; FE poll khi còn queued/sending).
 */
export async function GET(req: NextRequest) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;

    const projectId = req.nextUrl.searchParams.get("project_id")?.trim() ?? "";
    if (!projectId) return deliveryBadRequest("Thiếu project_id", "invalid_project_id");

    const body: ReviewRequestSummary = await getReviewRequestSummary(projectId, gate.email);
    return NextResponse.json(body);
  } catch (err) {
    return deliveryErrorResponse(err, "GET /api/delivery/review-requests/summary");
  }
}
