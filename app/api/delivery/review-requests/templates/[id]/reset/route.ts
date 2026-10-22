import { NextResponse, type NextRequest } from "next/server";
import { requireEmail } from "@/lib/http/api-helpers";
import { deliveryErrorResponse } from "@/lib/http/delivery-error";
import { resetDefaultReviewRequestTemplate } from "@/lib/services/review-request-proxy";
import {
  REVIEW_REQUEST_DEFAULT_TEMPLATE_ID,
  type DeliveryApiErrorBody,
  type ReviewRequestTemplate,
} from "@/lib/types/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/delivery/review-requests/templates/default/reset (§15) — khôi phục nội dung gốc của mẫu mặc
 * định, trả mẫu (customized=false). Proxy Mera `POST /api/v2/review-requests/templates/default/reset`.
 *
 * Đặt dưới `[id]/reset` thay vì thư mục tĩnh `templates/default/reset`: thư mục tĩnh `default` cạnh `[id]`
 * dễ gây nhầm route cho `PUT /templates/default`. Chỉ id "default" có reset — id khác trả 404
 * template_not_found ngay (Mera không có endpoint này, gọi sang chỉ ra 502 mera_bad_response khó hiểu).
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;
    const { id } = await ctx.params;
    if (id !== REVIEW_REQUEST_DEFAULT_TEMPLATE_ID) {
      const err: DeliveryApiErrorBody = {
        error: "Chỉ mẫu mặc định mới khôi phục được",
        code: "template_not_found",
      };
      return NextResponse.json(err, { status: 404 });
    }

    const body: ReviewRequestTemplate = await resetDefaultReviewRequestTemplate(gate.email);
    return NextResponse.json(body);
  } catch (err) {
    return deliveryErrorResponse(err, "POST /api/delivery/review-requests/templates/default/reset");
  }
}
