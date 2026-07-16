import { NextResponse, type NextRequest } from "next/server";
import { requireEmail, errorResponse } from "@/lib/http/api-helpers";
import { updateMeraOrder } from "@/lib/services/mera-order";
import type { MeraUpdateRequest } from "@/lib/types/mera";

// POST /api/mera/update — body MeraUpdateRequest (UNIFIED, không còn union theo `target`).
// `updates` trộn cả item-scope + order-scope; service tự tách + map fieldKey → PATCH body.
// - Có field item-scope ⇒ cần itemKey + itemVersion; có field order-scope ⇒ cần orderId + orderVersion.
// Response MeraUpdateResponse { item|null, order|null, splitApplied? }.
// 409 version_conflict được errorResponse map thành { error, code, latest }.
export async function POST(req: NextRequest) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;

    const body = (await req.json()) as Partial<MeraUpdateRequest>;

    // updates phải là object không rỗng — không có gì để sửa thì 400 sớm.
    if (
      typeof body.updates !== "object" ||
      body.updates === null ||
      Array.isArray(body.updates) ||
      Object.keys(body.updates).length === 0
    ) {
      return NextResponse.json({ error: "thiếu updates" }, { status: 400 });
    }

    // orderId/orderVersion luôn phải có (biết từ đơn đã resolve; cần cho split + order-scope PATCH).
    if (typeof body.orderId !== "string" || !body.orderId || typeof body.orderVersion !== "number") {
      return NextResponse.json({ error: "thiếu orderId/orderVersion" }, { status: 400 });
    }

    const data = await updateMeraOrder({
      updates: body.updates,
      itemKey: body.itemKey,
      itemVersion: body.itemVersion,
      orderId: body.orderId,
      orderVersion: body.orderVersion,
      actorEmail: gate.email,
    });
    return NextResponse.json(data);
  } catch (err) {
    return errorResponse(err, "POST /api/mera/update");
  }
}
