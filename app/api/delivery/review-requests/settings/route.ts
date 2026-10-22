import { NextResponse, type NextRequest } from "next/server";
import { requireEmail } from "@/lib/http/api-helpers";
import { deliveryBadRequest, deliveryErrorResponse } from "@/lib/http/delivery-error";
import { readJsonObject } from "@/lib/http/machine-auth";
import {
  getReviewRequestSettings,
  updateReviewRequestSettings,
} from "@/lib/services/review-request-proxy";
import type { ReviewRequestSettings, ReviewRequestSettingsUpdate } from "@/lib/types/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/delivery/review-requests/settings?project_id=<hex|dora> — max_days của project (proxy Mera
 * `GET /api/v2/review-requests/settings`). Chưa có doc cài đặt → Mera trả is_default. Từ §11 mẫu tin
 * nằm ở `/templates`; `template` chỉ còn khi Mera bản cũ trả (deprecated).
 */
export async function GET(req: NextRequest) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;

    const projectId = req.nextUrl.searchParams.get("project_id")?.trim() ?? "";
    if (!projectId) return deliveryBadRequest("Thiếu project_id", "invalid_project_id");

    const body: ReviewRequestSettings = await getReviewRequestSettings(projectId, gate.email);
    return NextResponse.json(body);
  } catch (err) {
    return deliveryErrorResponse(err, "GET /api/delivery/review-requests/settings");
  }
}

/**
 * PUT /api/delivery/review-requests/settings — body `{project_id, max_days, template?}`.
 * dora-1 chỉ chặn sai KIỂU; max_days 1–30 do Mera kiểm (invalid_max_days). `template` (deprecated §11)
 * chỉ chuyển tiếp khi client gửi chuỗi — KHÔNG tự điền "" vì Mera bản cũ hiểu "" = xoá mẫu về mặc định.
 */
export async function PUT(req: NextRequest) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;

    const raw = await readJsonObject(req);
    if (!raw) return deliveryBadRequest("Body phải là JSON object", "invalid_body");
    const projectId = typeof raw.project_id === "string" ? raw.project_id.trim() : "";
    if (!projectId) return deliveryBadRequest("Thiếu project_id", "invalid_project_id");
    if (raw.template !== undefined && typeof raw.template !== "string") {
      return deliveryBadRequest("template phải là chuỗi", "invalid_body");
    }
    if (typeof raw.max_days !== "number" || !Number.isFinite(raw.max_days)) {
      return deliveryBadRequest("max_days phải là số", "invalid_body");
    }

    const payload: ReviewRequestSettingsUpdate = { project_id: projectId, max_days: raw.max_days };
    if (typeof raw.template === "string") payload.template = raw.template;

    const body: ReviewRequestSettings = await updateReviewRequestSettings(payload, gate.email);
    return NextResponse.json(body);
  } catch (err) {
    return deliveryErrorResponse(err, "PUT /api/delivery/review-requests/settings");
  }
}
