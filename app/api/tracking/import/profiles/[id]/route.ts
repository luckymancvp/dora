import { NextResponse, type NextRequest } from "next/server";
import { requireEmail, errorResponse } from "@/lib/http/api-helpers";
import {
  deleteImportProfile,
  updateImportProfile,
} from "@/lib/services/tracking-import-profile";

// PATCH /api/tracking/import/profiles/:id — mọi field optional (giữ nguyên field không gửi).
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;
    const { id } = await ctx.params;
    const body = (await req.json()) as Record<string, unknown>;

    const profile = await updateImportProfile(id, {
      name: typeof body.name === "string" ? body.name : undefined,
      orderIdColumn: typeof body.orderIdColumn === "string" ? body.orderIdColumn : undefined,
      trackingColumn: typeof body.trackingColumn === "string" ? body.trackingColumn : undefined,
      carrierColumn: typeof body.carrierColumn === "string" ? body.carrierColumn : undefined,
      signature: Array.isArray(body.signature) ? body.signature.map(String) : undefined,
    });
    return NextResponse.json({ profile });
  } catch (err) {
    return errorResponse(err, "PATCH /api/tracking/import/profiles/:id");
  }
}

// DELETE /api/tracking/import/profiles/:id
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;
    const { id } = await ctx.params;
    await deleteImportProfile(id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err, "DELETE /api/tracking/import/profiles/:id");
  }
}
