import { NextResponse, type NextRequest } from "next/server";
import { addTag, removeTag, TagError } from "@/lib/services/tag";
import {
  hasMachineApiKey,
  machineBadRequest,
  machineUnauthorized,
  parseConversationIdParam,
  readJsonObject,
} from "@/lib/http/machine-auth";

const MAX_TAG_LEN = 50;

type TagOp = "add" | "remove";

// POST|DELETE /api/machine/conversations/:conversation_id/tags  body: { tag, actorEmail? }
// Bản máy gọi (Mera fulfill) của /api/conversations/:id/tags — CHỈ bọc addTag/removeTag
// ($addToSet / $pull). actorEmail tuỳ chọn, chỉ để log: gắn/gỡ tag KHÔNG bị chặn theo
// điều kiện "đã đăng nhập dora-1" (khác route gửi tin).
// Response 200: { conversationId, tags }.
async function handle(
  op: TagOp,
  req: NextRequest,
  ctx: { params: Promise<{ conversation_id: string }> },
): Promise<NextResponse> {
  if (!hasMachineApiKey(req)) return machineUnauthorized();

  try {
    const { conversation_id } = await ctx.params;
    const conversationId = parseConversationIdParam(conversation_id);
    if (conversationId === null) return machineBadRequest("invalid conversation_id");

    const body = await readJsonObject(req);
    if (!body) return machineBadRequest("body phải là JSON object");

    const tag = typeof body.tag === "string" ? body.tag.trim() : "";
    if (!tag) return machineBadRequest("empty tag");
    if (tag.length > MAX_TAG_LEN) return machineBadRequest(`tag tối đa ${MAX_TAG_LEN} ký tự`);
    // Mera lọc theo msg_tags=a,b (split dấu phẩy) → tag chứa dấu phẩy sẽ không lọc được.
    if (tag.includes(",")) return machineBadRequest("tag không được chứa dấu phẩy");

    const actorEmail = typeof body.actorEmail === "string" ? body.actorEmail.trim() : "";

    const tags =
      op === "add" ? await addTag(conversationId, tag) : await removeTag(conversationId, tag);
    console.info(
      `[machine tags] ${op} "${tag}" conv=${conversationId} actor=${actorEmail || "(none)"}`,
    );
    return NextResponse.json({ conversationId, tags });
  } catch (err) {
    if (err instanceof TagError) {
      const code = err.status === 404 ? "not_found" : "bad_request";
      return NextResponse.json({ error: err.message, code }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[${req.method} /api/machine/conversations/:id/tags]`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ conversation_id: string }> },
) {
  return handle("add", req, ctx);
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ conversation_id: string }> },
) {
  return handle("remove", req, ctx);
}
