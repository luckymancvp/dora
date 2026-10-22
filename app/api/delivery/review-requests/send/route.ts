import { NextResponse, type NextRequest } from "next/server";
import { requireEmail } from "@/lib/http/api-helpers";
import { deliveryBadRequest, deliveryErrorResponse } from "@/lib/http/delivery-error";
import { readJsonObject } from "@/lib/http/machine-auth";
import { sendReviewRequests } from "@/lib/services/review-request-proxy";
import type { ReviewRequestSendRequest, ReviewRequestSendResult } from "@/lib/types/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/delivery/review-requests/send — gửi tay: body `{ids: tracking_id[], message?, template_id?, project_id?}`.
 * dora-1 chỉ chặn sai KIỂU; số mã / shop (too_many_per_shop…), độ dài message và mẫu tồn tại do Mera kiểm.
 * message / template_id / project_id rỗng (sau trim) → BỎ field: Mera hiểu message vắng = dùng template_id,
 * vắng cả hai = mẫu "default"; project_id vắng = mọi đơn của mã. Gửi cả message lẫn template_id khi có:
 * Mera ưu tiên message nhưng vẫn lưu mẫu gốc (edited).
 * exclude_order_ids? (§13): order_id bỏ tích — Mera trả lại trong skipped[] reason "excluded".
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
    if (raw.template_id !== undefined && typeof raw.template_id !== "string") {
      return deliveryBadRequest("template_id phải là chuỗi", "invalid_body");
    }
    if (raw.project_id !== undefined && typeof raw.project_id !== "string") {
      return deliveryBadRequest("project_id phải là chuỗi", "invalid_project_id");
    }
    const excluded = raw.exclude_order_ids;
    if (
      excluded !== undefined &&
      (!Array.isArray(excluded) || !excluded.every((v) => typeof v === "string"))
    ) {
      return deliveryBadRequest("exclude_order_ids phải là mảng chuỗi", "invalid_body");
    }

    const payload: ReviewRequestSendRequest = { ids: ids as string[] };
    // Giữ nguyên định dạng tin người dùng soạn (xuống dòng, thụt đầu dòng) — trim chỉ để phát hiện tin rỗng.
    if (typeof raw.message === "string" && raw.message.trim() !== "") payload.message = raw.message;
    const templateId = typeof raw.template_id === "string" ? raw.template_id.trim() : "";
    if (templateId) payload.template_id = templateId;
    const projectId = typeof raw.project_id === "string" ? raw.project_id.trim() : "";
    if (projectId) payload.project_id = projectId;
    // §13: bỏ chuỗi rỗng + trùng; mảng rỗng → BỎ field (Mera hiểu vắng = gửi mọi đơn của mã).
    if (Array.isArray(excluded)) {
      const ex = [...new Set((excluded as string[]).map((v) => v.trim()).filter((v) => v !== ""))];
      if (ex.length > 0) payload.exclude_order_ids = ex;
    }

    const body: ReviewRequestSendResult = await sendReviewRequests(payload, gate.email);
    return NextResponse.json(body);
  } catch (err) {
    return deliveryErrorResponse(err, "POST /api/delivery/review-requests/send");
  }
}
