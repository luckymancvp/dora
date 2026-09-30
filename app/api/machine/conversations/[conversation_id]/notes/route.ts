import { NextResponse, type NextRequest } from "next/server";
import { addNote, getNotes, NoteError } from "@/lib/services/note";
import { findDoraUserEmail } from "@/lib/services/dora-user";
import {
  actorNotDoraUser,
  hasMachineApiKey,
  machineBadRequest,
  machineUnauthorized,
  parseConversationIdParam,
  readActorEmail,
  readJsonObject,
} from "@/lib/http/machine-auth";

const NOTE_BODY_MAX = 2000;

// Bản máy gọi (Mera fulfill) của /api/conversations/:id/notes — CHỈ bọc lib/services/note.ts,
// dùng chung conversations.notes[] với UI dora-1. Ownership trong note.ts so email CHÍNH XÁC,
// nên actorEmail luôn được chuẩn hoá về email như lưu trong `users` (findDoraUserEmail).

// GET /api/machine/conversations/:conversation_id/notes?actorEmail=
// Response 200: { conversationId, items: NoteItem[] /* mới→cũ, giây unix */ }.
// actorEmail tuỳ chọn; không phải dora user (hoặc không gửi) vẫn đọc được, mọi note mine=false.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ conversation_id: string }> },
) {
  if (!hasMachineApiKey(req)) return machineUnauthorized();

  try {
    const { conversation_id } = await ctx.params;
    const conversationId = parseConversationIdParam(conversation_id);
    if (conversationId === null) return machineBadRequest("invalid conversation_id");

    const actor = readActorEmail(req.nextUrl.searchParams.get("actorEmail"));
    const email = actor ? await findDoraUserEmail(actor) : null;
    const data = await getNotes(conversationId, email ?? "");
    if (!email) data.items = data.items.map((n) => ({ ...n, mine: false }));
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[GET /api/machine/conversations/:id/notes]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/machine/conversations/:conversation_id/notes  body: { body, actorEmail }
// Response 201: NoteItem. 400 body rỗng/quá 2000 ký tự; 403 actor_not_dora_user; 404 not_found.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ conversation_id: string }> },
) {
  if (!hasMachineApiKey(req)) return machineUnauthorized();

  try {
    const { conversation_id } = await ctx.params;
    const conversationId = parseConversationIdParam(conversation_id);
    if (conversationId === null) return machineBadRequest("invalid conversation_id");

    const payload = await readJsonObject(req);
    if (!payload) return machineBadRequest("body phải là JSON object");

    const text = typeof payload.body === "string" ? payload.body.trim() : "";
    if (!text) return machineBadRequest("empty note");
    if (text.length > NOTE_BODY_MAX) return machineBadRequest(`note tối đa ${NOTE_BODY_MAX} ký tự`);

    const actor = readActorEmail(payload.actorEmail);
    if (!actor) return machineBadRequest("actorEmail bắt buộc");
    const email = await findDoraUserEmail(actor);
    if (!email) return actorNotDoraUser(actor);

    const created = await addNote(conversationId, email, text);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof NoteError) {
      const code = err.status === 404 ? "not_found" : "bad_request";
      return NextResponse.json({ error: err.message, code }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /api/machine/conversations/:id/notes]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
