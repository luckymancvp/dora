import type { NextRequest } from "next/server";
import { corsJson, OPTIONS } from "@/lib/http/cors";
import { getMessageStatus, updateMessageStatus } from "@/lib/services/message-send";
import type { EtsyRaw, MessageStatus } from "@/lib/types/etsy";

export { OPTIONS };

// GET /v1/messages/status/:id — frontend/extension poll trạng thái gửi.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const msg = await getMessageStatus(id);
    if (!msg) return corsJson({ error: "not found" }, { status: 404 });
    return corsJson(msg);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return corsJson({ error: message }, { status: 500 });
  }
}

// POST /v1/messages/status/:id  body: { status, message? } — extension báo SENDING/DONE/FAILED.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as { status?: MessageStatus; message?: EtsyRaw };
    if (!body.status) {
      return corsJson({ error: "missing status" }, { status: 400 });
    }
    // CANCELLED chỉ do Mera đặt qua route huỷ của Dora — route công khai không nhận.
    if (!["NEW", "SENDING", "DONE", "FAILED"].includes(body.status)) {
      return corsJson({ error: "invalid status" }, { status: 400 });
    }
    const ok = await updateMessageStatus(id, body.status, body.message ?? null);
    return corsJson({ ok });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /v1/messages/status/:id]", message);
    return corsJson({ error: message }, { status: 500 });
  }
}
