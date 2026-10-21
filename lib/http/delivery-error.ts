import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http/api-helpers";
import { DeliveryProxyError } from "@/lib/services/delivery-proxy";

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
