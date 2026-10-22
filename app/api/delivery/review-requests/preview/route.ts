import { NextResponse, type NextRequest } from "next/server";
import { requireEmail } from "@/lib/http/api-helpers";
import { deliveryBadRequest, deliveryErrorResponse } from "@/lib/http/delivery-error";
import { readJsonObject } from "@/lib/http/machine-auth";
import { previewReviewRequests } from "@/lib/services/review-request-proxy";
import type { ReviewRequestPreview } from "@/lib/types/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/delivery/review-requests/preview — body `{project_id}`. Đếm ứng viên gửi tự động
 * (không ghi gì). POST chứ không GET vì bám đúng API Mera (`POST /api/v2/review-requests/preview`).
 */
export async function POST(req: NextRequest) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;

    const raw = await readJsonObject(req);
    if (!raw) return deliveryBadRequest("Body phải là JSON object", "invalid_body");
    const projectId = typeof raw.project_id === "string" ? raw.project_id.trim() : "";
    if (!projectId) return deliveryBadRequest("Thiếu project_id", "invalid_project_id");

    const body: ReviewRequestPreview = await previewReviewRequests(projectId, gate.email);
    return NextResponse.json(body);
  } catch (err) {
    return deliveryErrorResponse(err, "POST /api/delivery/review-requests/preview");
  }
}
