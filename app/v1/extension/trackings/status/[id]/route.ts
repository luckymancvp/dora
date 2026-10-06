import type { NextRequest } from "next/server";
import { corsJson, OPTIONS } from "@/lib/http/cors";
import { applyStatus } from "@/lib/services/tracking";

export { OPTIONS };

// POST /v1/extension/trackings/status/:id  body: { status, tracking?, error? }
// Extension báo trạng thái add (cả batch): SENDING / DONE / FAILED. Luôn 200:
//   { ok:true } đã áp dụng · { ok:true, already:true, phase } callback lặp/muộn (job đã qua bước
//   add — outbox extension gửi lại), không đổi gì · { ok:false } id lạ (vd tracking của Mera) hoặc
//   trạng thái dora-1 không dùng (QUEUED/PROGRESS/CANCELLED — extension chỉ gửi Mera).
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as { status?: string; tracking?: unknown; error?: unknown };
    if (!body.status) {
      return corsJson({ error: "missing status" }, { status: 400 });
    }
    // tracking/error: FAILED giữa chừng (watchdog "stalled") được xét từng đơn theo results.
    return corsJson(await applyStatus(id, body.status, { tracking: body.tracking, error: body.error }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /v1/extension/trackings/status/:id]", message);
    return corsJson({ error: message }, { status: 500 });
  }
}
