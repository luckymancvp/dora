import { NextResponse, type NextRequest } from "next/server";
import { requireEmail } from "@/lib/http/api-helpers";
import { deliveryBadRequest, deliveryErrorResponse } from "@/lib/http/delivery-error";
import { readJsonObject } from "@/lib/http/machine-auth";
import { runReviewRequests } from "@/lib/services/review-request-proxy";
import type { ReviewRequestRunResult } from "@/lib/types/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/delivery/review-requests/run — body `{project_id}`. Mera ghi hàng đợi rồi trả ngay;
 * worker Mera gửi dần theo shop. Luôn trả 200 (Mera có thể trả 202) — hook coi mọi 2xx là xong.
 */
export async function POST(req: NextRequest) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;

    const raw = await readJsonObject(req);
    if (!raw) return deliveryBadRequest("Body phải là JSON object", "invalid_body");
    const projectId = typeof raw.project_id === "string" ? raw.project_id.trim() : "";
    if (!projectId) return deliveryBadRequest("Thiếu project_id", "invalid_project_id");

    const body: ReviewRequestRunResult = await runReviewRequests(projectId, gate.email);
    return NextResponse.json(body);
  } catch (err) {
    return deliveryErrorResponse(err, "POST /api/delivery/review-requests/run");
  }
}
