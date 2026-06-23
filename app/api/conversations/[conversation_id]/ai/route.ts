import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { createAIResponse } from "@/lib/services/ai/conversation-ai";

// GET /api/conversations/:conversation_id/ai?input=optional_guidance
// Sinh 3 gợi ý (options[] theo hướng tiếp cận) + tag phân loại.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ conversation_id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const { conversation_id } = await ctx.params;
    const conversationId = Number(conversation_id);
    if (!Number.isFinite(conversationId)) {
      return NextResponse.json({ error: "invalid conversation_id" }, { status: 400 });
    }
    const input = req.nextUrl.searchParams.get("input") ?? "";
    const result = await createAIResponse(conversationId, input);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[GET /api/conversations/:id/ai]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
