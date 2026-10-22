import { NextResponse, type NextRequest } from "next/server";
import { requireEmail } from "@/lib/http/api-helpers";
import { deliveryBadRequest, deliveryErrorResponse } from "@/lib/http/delivery-error";
import { readJsonObject } from "@/lib/http/machine-auth";
import { runReviewRequests } from "@/lib/services/review-request-proxy";
import type { ReviewRequestRunRequest, ReviewRequestRunResult } from "@/lib/types/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/delivery/review-requests/run — body `{project_id, template_id}`. Mera ghi hàng đợi rồi trả
 * ngay; worker Mera gửi dần theo shop. Luôn trả 200 (Mera có thể trả 202) — hook coi mọi 2xx là xong.
 * template_id BẮT BUỘC (§11 T2) — thiếu/rỗng chặn ngay ở dora-1 (cùng code Mera `template_required`) để
 * Mera bản cũ (bỏ qua field lạ) không lặng lẽ gửi theo mẫu cũ của project. Tồn tại hay không do Mera
 * kiểm (404 template_not_found).
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
    const templateId = typeof raw.template_id === "string" ? raw.template_id.trim() : "";
    if (!templateId) return deliveryBadRequest("Chưa chọn mẫu tin", "template_required");

    const payload: ReviewRequestRunRequest = { project_id: projectId, template_id: templateId };
    const body: ReviewRequestRunResult = await runReviewRequests(payload, gate.email);
    return NextResponse.json(body);
  } catch (err) {
    return deliveryErrorResponse(err, "POST /api/delivery/review-requests/run");
  }
}
