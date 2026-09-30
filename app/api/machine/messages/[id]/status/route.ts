import { NextResponse, type NextRequest } from "next/server";
import { getMessageStatus } from "@/lib/services/message-send";
import { hasMachineApiKey, machineUnauthorized } from "@/lib/http/machine-auth";

// GET /api/machine/messages/:id/status — Mera fulfill poll trạng thái tin đã gửi qua
// POST /api/machine/conversations/:id/messages. Cùng nguồn với GET /v1/messages/status/:id
// (getMessageStatus) nhưng chỉ trả field cần thiết thay vì cả MessageDoc.
// Response 200: { id, conversationId, status: "NEW"|"SENDING"|"DONE"|"FAILED"|"" }.
// Không có `reason`: messages không lưu lý do FAILED (reason chỉ có ở response lúc tạo).
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!hasMachineApiKey(req)) return machineUnauthorized();

  try {
    const { id } = await ctx.params;
    const msg = await getMessageStatus(id);
    if (!msg) return NextResponse.json({ error: "not found", code: "not_found" }, { status: 404 });
    return NextResponse.json({
      id: msg._id?.toHexString() ?? id,
      conversationId: msg.conversation_id,
      status: msg.status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[GET /api/machine/messages/:id/status]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
