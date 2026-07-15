import { NextResponse, type NextRequest } from "next/server";
import { requireEmail, errorResponse } from "@/lib/http/api-helpers";
import { updateMeraItem, updateMeraOrderNote } from "@/lib/services/mera-order";
import type { MeraUpdateRequest } from "@/lib/types/mera";

// POST /api/mera/update — body MeraUpdateRequest (union theo `target`).
// item → updateMeraItem → { item, splitApplied? }; order → updateMeraOrderNote → { order }.
// 409 version_conflict được errorResponse map thành { error, code, latest }.
export async function POST(req: NextRequest) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;

    const body = (await req.json()) as Partial<MeraUpdateRequest>;

    if (body.target === "item") {
      if (
        typeof body.itemKey !== "string" ||
        !body.itemKey ||
        typeof body.version !== "number" ||
        typeof body.updates !== "object" ||
        body.updates === null
      ) {
        return NextResponse.json({ error: "thiếu tham số item" }, { status: 400 });
      }
      const data = await updateMeraItem({
        itemKey: body.itemKey,
        version: body.version,
        updates: body.updates,
        actorEmail: gate.email,
      });
      return NextResponse.json(data);
    }

    if (body.target === "order") {
      if (
        typeof body.orderId !== "string" ||
        !body.orderId ||
        typeof body.version !== "number" ||
        typeof body.note !== "string"
      ) {
        return NextResponse.json({ error: "thiếu tham số order" }, { status: 400 });
      }
      const data = await updateMeraOrderNote({
        orderId: body.orderId,
        version: body.version,
        note: body.note,
        actorEmail: gate.email,
      });
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "target không hợp lệ" }, { status: 400 });
  } catch (err) {
    return errorResponse(err, "POST /api/mera/update");
  }
}
