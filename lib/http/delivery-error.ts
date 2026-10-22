import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http/api-helpers";
import { DeliveryProxyError } from "@/lib/services/delivery-proxy";
import type { DeliveryApiErrorBody } from "@/lib/types/delivery";

/**
 * Map lỗi của route /api/delivery/* → response (contract _workspace/01 §3.2).
 * - DeliveryProxyError: body đã chốt (lỗi Mera NGUYÊN VĂN, hoặc mera_auth_failed / mera_bad_response).
 * - Còn lại → errorResponse: MeraApiError đã mang code `mera_unavailable` (502) / `mera_not_configured` (503).
 */
export function deliveryErrorResponse(err: unknown, tag: string): NextResponse {
  if (err instanceof DeliveryProxyError) {
    if (err.status >= 500) console.error(`[${tag}]`, err.status, err.body.code ?? "", err.body.error);
    return NextResponse.json(err.body, { status: err.status });
  }
  return errorResponse(err, tag);
}

/**
 * 400 do dora-1 tự chặn (body/query sai KIỂU) — cùng shape DeliveryApiErrorBody như lỗi Mera.
 * `template_required` (run thiếu template_id) trùng code Mera để FE phân nhánh một kiểu.
 */
export function deliveryBadRequest(
  error: string,
  code: "invalid_body" | "invalid_project_id" | "template_required",
): NextResponse {
  const body: DeliveryApiErrorBody = { error, code };
  return NextResponse.json(body, { status: 400 });
}
