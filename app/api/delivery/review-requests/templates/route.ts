import { NextResponse, type NextRequest } from "next/server";
import { requireEmail } from "@/lib/http/api-helpers";
import { deliveryBadRequest, deliveryErrorResponse } from "@/lib/http/delivery-error";
import { readJsonObject } from "@/lib/http/machine-auth";
import {
  createReviewRequestTemplate,
  listReviewRequestTemplates,
} from "@/lib/services/review-request-proxy";
import type {
  ReviewRequestTemplate,
  ReviewRequestTemplatesResponse,
} from "@/lib/types/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/delivery/review-requests/templates — thư viện mẫu tin dùng chung toàn hệ thống (§11 T1, không
 * theo project). `default` (is_system) luôn đứng đầu — proxy Mera `GET /api/v2/review-requests/templates`.
 */
export async function GET() {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;

    const body: ReviewRequestTemplatesResponse = await listReviewRequestTemplates(gate.email);
    return NextResponse.json(body);
  } catch (err) {
    return deliveryErrorResponse(err, "GET /api/delivery/review-requests/templates");
  }
}

/**
 * POST /api/delivery/review-requests/templates — body `{title, content}`. dora-1 chỉ chặn sai KIỂU, gửi
 * NGUYÊN VĂN (không trim content: giữ xuống dòng; title để Mera chuẩn hoá vì Mera mới biết luật unique).
 * Lỗi Mera chuyển tiếp nguyên: 400 invalid_title | invalid_template (+unknown_vars) | duplicate_title.
 * Trả 200 (kể cả Mera 201) như mọi route /api/delivery/*.
 */
export async function POST(req: NextRequest) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;

    const raw = await readJsonObject(req);
    if (!raw) return deliveryBadRequest("Body phải là JSON object", "invalid_body");
    if (typeof raw.title !== "string") return deliveryBadRequest("title phải là chuỗi", "invalid_body");
    if (typeof raw.content !== "string") {
      return deliveryBadRequest("content phải là chuỗi", "invalid_body");
    }

    const body: ReviewRequestTemplate = await createReviewRequestTemplate(
      { title: raw.title, content: raw.content },
      gate.email,
    );
    return NextResponse.json(body);
  } catch (err) {
    return deliveryErrorResponse(err, "POST /api/delivery/review-requests/templates");
  }
}
