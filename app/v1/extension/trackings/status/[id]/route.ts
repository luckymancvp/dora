import type { NextRequest } from "next/server";
import { corsJson, OPTIONS } from "@/lib/http/cors";
import { applyStatus } from "@/lib/services/tracking";

export { OPTIONS };

// POST /v1/extension/trackings/status/:id  body: { status, tracking? }
// Extension báo trạng thái add (cả batch): SENDING / DONE / FAILED.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as { status?: string };
    if (!body.status) {
      return corsJson({ error: "missing status" }, { status: 400 });
    }
    const ok = await applyStatus(id, body.status);
    return corsJson({ ok });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /v1/extension/trackings/status/:id]", message);
    return corsJson({ error: message }, { status: 500 });
  }
}
