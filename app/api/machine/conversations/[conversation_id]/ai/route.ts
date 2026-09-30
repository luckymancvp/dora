import { NextResponse, type NextRequest } from "next/server";
import { createAIResponse } from "@/lib/services/ai/conversation-ai";
import {
  hasMachineApiKey,
  machineBadRequest,
  machineUnauthorized,
  parseConversationIdParam,
  readActorEmail,
  readOptionalJsonObject,
} from "@/lib/http/machine-auth";

// Gemini ~2-5s, cộng retrieval (đơn hàng + few-shot embedding). Mặc định serverless
// có thể cắt sớm hơn → nâng trần; fulfill BE timeout 45s nên 60s là đủ.
export const maxDuration = 60;

const MAX_INPUT = 500;

// POST /api/machine/conversations/:conversation_id/ai  body: { input?, actorEmail? }
// Bản máy gọi (Mera fulfill) của GET /api/conversations/:id/ai — CHỈ bọc createAIResponse
// (giữ nguyên hành vi có sẵn: ghi đè suggested_messages + tự gắn/gỡ tag AI).
// Không yêu cầu dora user; actorEmail chỉ để log. MOCK_AI_RESPONSE=true vẫn áp dụng
// (nằm trong createAIResponse) → QA local không gọi Gemini thật.
// Response 200: { options: {label,text}[], suggested_tag: string, tag_reason: string }
//   — options = [] khi không có input và shop đã trả lời (service không gọi AI).
// 404 not_found khi không có hội thoại; lỗi khác (Gemini/mạng/parse) ⇒ 502 ai_failed.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ conversation_id: string }> },
) {
  if (!hasMachineApiKey(req)) return machineUnauthorized();

  const { conversation_id } = await ctx.params;
  const conversationId = parseConversationIdParam(conversation_id);
  if (conversationId === null) return machineBadRequest("invalid conversation_id");

  // Body tuỳ chọn: rỗng hoặc {} đều hợp lệ (tạo gợi ý không định hướng).
  const body = await readOptionalJsonObject(req);
  if (!body) return machineBadRequest("body phải là JSON object");

  if (body.input !== undefined && typeof body.input !== "string") {
    return machineBadRequest("input phải là string");
  }
  const input = typeof body.input === "string" ? body.input.trim() : "";
  if (input.length > MAX_INPUT) return machineBadRequest(`input tối đa ${MAX_INPUT} ký tự`);
  const actorEmail = readActorEmail(body.actorEmail);

  try {
    const result = await createAIResponse(conversationId, input);
    console.info(
      `[machine ai] conv=${conversationId} input=${input ? "yes" : "no"} options=${result.options.length} actor=${actorEmail || "(none)"}`,
    );
    return NextResponse.json({
      options: result.options,
      suggested_tag: result.suggested_tag ?? "",
      tag_reason: result.tag_reason ?? "",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message === "conversation not found") {
      return NextResponse.json({ error: message, code: "not_found" }, { status: 404 });
    }
    console.error("[POST /api/machine/conversations/:id/ai]", message);
    return NextResponse.json({ error: message, code: "ai_failed" }, { status: 502 });
  }
}
