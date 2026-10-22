import { NextResponse, type NextRequest } from "next/server";
import { requireEmail } from "@/lib/http/api-helpers";
import { deliveryBadRequest, deliveryErrorResponse } from "@/lib/http/delivery-error";
import { readJsonObject } from "@/lib/http/machine-auth";
import {
  deleteReviewRequestTemplate,
  updateReviewRequestTemplate,
} from "@/lib/services/review-request-proxy";
import type {
  ReviewRequestTemplate,
  ReviewRequestTemplateDeleteResult,
} from "@/lib/types/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/delivery/review-requests/templates/:id — body `{title, content}` (chỉ kiểm KIỂU, gửi nguyên
 * văn). Service encode id trước khi ghép path Mera. Lỗi Mera chuyển tiếp nguyên: 400 invalid_title |
 * invalid_template (+unknown_vars) | duplicate_title, 403 system_template (id "default"), 404 template_not_found.
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;
    const { id } = await ctx.params;

    const raw = await readJsonObject(req);
    if (!raw) return deliveryBadRequest("Body phải là JSON object", "invalid_body");
    if (typeof raw.title !== "string") return deliveryBadRequest("title phải là chuỗi", "invalid_body");
    if (typeof raw.content !== "string") {
      return deliveryBadRequest("content phải là chuỗi", "invalid_body");
    }

    const body: ReviewRequestTemplate = await updateReviewRequestTemplate(
      id,
      { title: raw.title, content: raw.content },
      gate.email,
    );
    return NextResponse.json(body);
  } catch (err) {
    return deliveryErrorResponse(err, "PUT /api/delivery/review-requests/templates/:id");
  }
}

/**
 * DELETE /api/delivery/review-requests/templates/:id → 200 `{ok:true}`. 403 system_template /
 * 404 template_not_found chuyển tiếp nguyên. Trigger đang trỏ mẫu này sẽ lỗi template_not_found ở lượt
 * chạy sau (§11) — Mera không chặn xoá, dora-1 cũng không.
 */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;
    const { id } = await ctx.params;

    const body: ReviewRequestTemplateDeleteResult = await deleteReviewRequestTemplate(id, gate.email);
    return NextResponse.json(body);
  } catch (err) {
    return deliveryErrorResponse(err, "DELETE /api/delivery/review-requests/templates/:id");
  }
}
