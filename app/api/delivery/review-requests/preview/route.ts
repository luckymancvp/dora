import { NextResponse, type NextRequest } from "next/server";
import { requireEmail } from "@/lib/http/api-helpers";
import { deliveryBadRequest, deliveryErrorResponse } from "@/lib/http/delivery-error";
import { readJsonObject } from "@/lib/http/machine-auth";
import { previewReviewRequests } from "@/lib/services/review-request-proxy";
import type { ReviewRequestPreview, ReviewRequestPreviewRequest } from "@/lib/types/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/delivery/review-requests/preview — body `{project_id, template_id?}`. Đếm ứng viên gửi tự
 * động (không ghi gì). POST chứ không GET vì bám đúng API Mera (`POST /api/v2/review-requests/preview`).
 * template_id: dora-1 chỉ kiểm kiểu; "" (sau trim) → bỏ field, Mera dùng mẫu mặc định.
 */
export async function POST(req: NextRequest) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;

    const raw = await readJsonObject(req);
    if (!raw) return deliveryBadRequest("Body phải là JSON object", "invalid_body");
    const projectId = typeof raw.project_id === "string" ? raw.project_id.trim() : "";
    if (!projectId) return deliveryBadRequest("Thiếu project_id", "invalid_project_id");
    if (raw.template_id !== undefined && typeof raw.template_id !== "string") {
      return deliveryBadRequest("template_id phải là chuỗi", "invalid_body");
    }

    const payload: ReviewRequestPreviewRequest = { project_id: projectId };
    const templateId = typeof raw.template_id === "string" ? raw.template_id.trim() : "";
    if (templateId) payload.template_id = templateId;

    const body: ReviewRequestPreview = await previewReviewRequests(payload, gate.email);
    return NextResponse.json(body);
  } catch (err) {
    return deliveryErrorResponse(err, "POST /api/delivery/review-requests/preview");
  }
}
