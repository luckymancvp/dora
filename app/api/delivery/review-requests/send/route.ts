import { NextResponse, type NextRequest } from "next/server";
import { requireEmail } from "@/lib/http/api-helpers";
import { deliveryBadRequest, deliveryErrorResponse } from "@/lib/http/delivery-error";
import { readJsonObject } from "@/lib/http/machine-auth";
import { sendReviewRequests } from "@/lib/services/review-request-proxy";
import type { ReviewRequestSendRequest, ReviewRequestSendResult } from "@/lib/types/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/delivery/review-requests/send — gửi tay: body `{ids: tracking_id[], message?, project_id?}`.
 * dora-1 chỉ chặn sai KIỂU; số mã / shop (too_many_per_shop…) và độ dài message do Mera kiểm.
 * message / project_id rỗng (sau trim) → BỎ field: Mera hiểu vắng = dùng mẫu project / mọi đơn của mã.
 */
export async function POST(req: NextRequest) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;

    const raw = await readJsonObject(req);
    if (!raw) return deliveryBadRequest("Body phải là JSON object", "invalid_body");
    const ids = raw.ids;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((v) => typeof v === "string")) {
      return deliveryBadRequest("ids phải là mảng chuỗi không rỗng", "invalid_body");
    }
    if (raw.message !== undefined && typeof raw.message !== "string") {
      return deliveryBadRequest("message phải là chuỗi", "invalid_body");
    }
    if (raw.project_id !== undefined && typeof raw.project_id !== "string") {
      return deliveryBadRequest("project_id phải là chuỗi", "invalid_project_id");
    }

    const payload: ReviewRequestSendRequest = { ids: ids as string[] };
    // Giữ nguyên định dạng tin người dùng soạn (xuống dòng, thụt đầu dòng) — trim chỉ để phát hiện tin rỗng.
    if (typeof raw.message === "string" && raw.message.trim() !== "") payload.message = raw.message;
    const projectId = typeof raw.project_id === "string" ? raw.project_id.trim() : "";
    if (projectId) payload.project_id = projectId;

    const body: ReviewRequestSendResult = await sendReviewRequests(payload, gate.email);
    return NextResponse.json(body);
  } catch (err) {
    return deliveryErrorResponse(err, "POST /api/delivery/review-requests/send");
  }
}
