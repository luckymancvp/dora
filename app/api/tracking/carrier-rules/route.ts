import { NextResponse, type NextRequest } from "next/server";
import { requireEmail, errorResponse } from "@/lib/http/api-helpers";
import { getCarrierRuleSet, replaceCarrierRules } from "@/lib/services/carrier-rule";

// GET /api/tracking/carrier-rules — bộ quy tắc suy carrier từ số tracking.
export async function GET() {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;
    const ruleSet = await getCarrierRuleSet();
    return NextResponse.json(ruleSet);
  } catch (err) {
    return errorResponse(err, "GET /api/tracking/carrier-rules");
  }
}

// PUT /api/tracking/carrier-rules  body: { rules: CarrierRule[] }
// Thay toàn bộ danh sách — thứ tự trong mảng CHÍNH LÀ thứ tự ưu tiên (khớp đầu tiên thắng).
export async function PUT(req: NextRequest) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;
    const body = (await req.json()) as { rules?: unknown };
    const ruleSet = await replaceCarrierRules(body?.rules, gate.email);
    return NextResponse.json(ruleSet);
  } catch (err) {
    return errorResponse(err, "PUT /api/tracking/carrier-rules");
  }
}
