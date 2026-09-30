import { NextResponse, type NextRequest } from "next/server";
import { createOutgoingMessage } from "@/lib/services/message-send";
import { findDoraUserEmail } from "@/lib/services/dora-user";
import {
  actorNotDoraUser,
  hasMachineApiKey,
  machineBadRequest,
  machineUnauthorized,
  parseConversationIdParam,
  readJsonObject,
} from "@/lib/http/machine-auth";

const MAX_ATTACHMENTS = 10;

// POST /api/machine/conversations/:conversation_id/messages
// body: { message, attachments?: string[], actorEmail }
// Bản máy gọi (Mera fulfill) của POST /api/conversations/:id/messages — CHỈ bọc
// createOutgoingMessage, không đổi logic gửi/Ably/auto-reply. Khác bản session:
//  - auth bằng x-api-key (MERA_INTERNAL_API_KEY), không có session;
//  - sender_email = actorEmail, bắt buộc và phải là user dora-1 (collection `users`),
//    user Mera chưa từng đăng nhập dora-1 thì KHÔNG được gửi → 403 actor_not_dora_user;
//  - attachments chặt hơn: phải là URL http(s) (extension tự fetch để upload2Etsy), tối đa 10.
// Response 200: { id, conversationId, status: "NEW"|"FAILED", reason? } — y hệt bản session
// (FAILED + reason "no-browser"/"shop-unknown" khi shop không có extension online).
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ conversation_id: string }> },
) {
  if (!hasMachineApiKey(req)) return machineUnauthorized();

  try {
    const { conversation_id } = await ctx.params;
    const conversationId = parseConversationIdParam(conversation_id);
    if (conversationId === null) return machineBadRequest("invalid conversation_id");

    const body = await readJsonObject(req);
    if (!body) return machineBadRequest("body phải là JSON object");

    const text = typeof body.message === "string" ? body.message.trim() : "";

    const rawAtt = body.attachments ?? [];
    if (!Array.isArray(rawAtt)) return machineBadRequest("attachments phải là mảng URL");
    const attachments: string[] = [];
    for (const u of rawAtt) {
      const url = typeof u === "string" ? u.trim() : "";
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return machineBadRequest("attachments chỉ nhận URL http(s)");
      }
      attachments.push(url);
    }
    if (attachments.length > MAX_ATTACHMENTS) {
      return machineBadRequest(`Tối đa ${MAX_ATTACHMENTS} ảnh mỗi tin`);
    }
    // Cho phép gửi khi chỉ có ảnh (text rỗng) — giống bản session / DORA.
    if (!text && attachments.length === 0) return machineBadRequest("empty message");

    const actorEmail = typeof body.actorEmail === "string" ? body.actorEmail.trim() : "";
    if (!actorEmail) return machineBadRequest("actorEmail bắt buộc");
    const senderEmail = await findDoraUserEmail(actorEmail);
    if (!senderEmail) return actorNotDoraUser(actorEmail);

    const created = await createOutgoingMessage(conversationId, text, senderEmail, attachments);
    return NextResponse.json(created);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message === "conversation not found") {
      return NextResponse.json({ error: message, code: "not_found" }, { status: 404 });
    }
    console.error("[POST /api/machine/conversations/:id/messages]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
