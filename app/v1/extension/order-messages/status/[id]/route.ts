import type { NextRequest } from "next/server";
import { corsJson, OPTIONS } from "@/lib/http/cors";
import { applyOrderMessageStatus } from "@/lib/services/order-message";

export { OPTIONS };

// POST /v1/extension/order-messages/status/:id  body: { status, convo_id?, error? }
// Extension báo kết quả nhắn khách theo đơn (DONE/FAILED). Đối xứng với
// trackings/status/:id. Trước đây extension bắn vào endpoint không tồn tại ở repo
// nào nên gửi hỏng mà UI vẫn báo thành công.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as { status?: string; convo_id?: unknown; error?: unknown };
    if (!body.status) {
      return corsJson({ error: "missing status" }, { status: 400 });
    }
    const ok = await applyOrderMessageStatus(id, {
      status: body.status,
      convo_id: body.convo_id,
      error: body.error,
    });
    return corsJson({ ok });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /v1/extension/order-messages/status/:id]", message);
    return corsJson({ error: message }, { status: 500 });
  }
}
