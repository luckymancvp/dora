import { NextResponse, type NextRequest } from "next/server";
import { requireEmail } from "@/lib/http/api-helpers";
import { deliveryBadRequest, deliveryErrorResponse } from "@/lib/http/delivery-error";
import { readJsonObject } from "@/lib/http/machine-auth";
import {
  getReviewRequestSettings,
  updateReviewRequestSettings,
} from "@/lib/services/review-request-proxy";
import type { ReviewRequestSettings } from "@/lib/types/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/delivery/review-requests/settings?project_id=<hex|dora> — mẫu tin + max_days của project
 * (proxy Mera `GET /api/v2/review-requests/settings`). Chưa có doc cài đặt → Mera trả is_default.
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
 * PUT /api/delivery/review-requests/settings — body `{project_id, template, max_days}`.
 * dora-1 chỉ chặn sai KIỂU; giới hạn giá trị (≤2000 ký tự, max_days 1–30) do Mera kiểm và trả code
 * invalid_template / invalid_max_days để FE hiện đúng câu.
 */
export async function PUT(req: NextRequest) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;

    const raw = await readJsonObject(req);
    if (!raw) return deliveryBadRequest("Body phải là JSON object", "invalid_body");
    const projectId = typeof raw.project_id === "string" ? raw.project_id.trim() : "";
    if (!projectId) return deliveryBadRequest("Thiếu project_id", "invalid_project_id");
    if (typeof raw.template !== "string") {
      return deliveryBadRequest("template phải là chuỗi", "invalid_body");
    }
    if (typeof raw.max_days !== "number" || !Number.isFinite(raw.max_days)) {
      return deliveryBadRequest("max_days phải là số", "invalid_body");
    }

    const body: ReviewRequestSettings = await updateReviewRequestSettings(
      { project_id: projectId, template: raw.template, max_days: raw.max_days },
      gate.email,
    );
    return NextResponse.json(body);
  } catch (err) {
    return deliveryErrorResponse(err, "PUT /api/delivery/review-requests/settings");
  }
}
