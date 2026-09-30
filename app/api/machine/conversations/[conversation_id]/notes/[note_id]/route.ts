import { NextResponse, type NextRequest } from "next/server";
import { deleteNote, editNote, NoteError } from "@/lib/services/note";
import { findDoraUserEmail } from "@/lib/services/dora-user";
import {
  actorNotDoraUser,
  hasMachineApiKey,
  machineBadRequest,
  machineUnauthorized,
  parseConversationIdParam,
  readActorEmail,
  readJsonObject,
  readOptionalJsonObject,
} from "@/lib/http/machine-auth";

const NOTE_BODY_MAX = 2000;

type Ctx = { params: Promise<{ conversation_id: string; note_id: string }> };

function noteErrorResponse(err: unknown, tag: string): NextResponse {
  if (err instanceof NoteError) {
    const code = err.status === 404 ? "not_found" : "bad_request";
    return NextResponse.json({ error: err.message, code }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`[${tag}]`, message);
  return NextResponse.json({ error: message }, { status: 500 });
}

// PATCH /api/machine/conversations/:conversation_id/notes/:note_id  body: { body, actorEmail }
// Chỉ sửa được note của chính actor (email chuẩn hoá theo `users`).
// Response 200: NoteItem (createdAt thật, updatedAt mới). 404 không có / không phải của mình.
export async function PATCH(req: NextRequest, ctx: Ctx) {
  if (!hasMachineApiKey(req)) return machineUnauthorized();

  try {
    const { conversation_id, note_id } = await ctx.params;
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

    const updated = await editNote(conversationId, note_id, email, text);
    return NextResponse.json(updated);
  } catch (err) {
    return noteErrorResponse(err, "PATCH /api/machine/conversations/:id/notes/:noteId");
  }
}

// DELETE /api/machine/conversations/:conversation_id/notes/:note_id  body: { actorEmail }
// (hoặc ?actorEmail= nếu client không gửi được body với DELETE).
// Response 200: { ok: true }. 404 không có / không phải của mình.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  if (!hasMachineApiKey(req)) return machineUnauthorized();

  try {
    const { conversation_id, note_id } = await ctx.params;
    const conversationId = parseConversationIdParam(conversation_id);
    if (conversationId === null) return machineBadRequest("invalid conversation_id");

    const payload = await readOptionalJsonObject(req);
    if (!payload) return machineBadRequest("body phải là JSON object");

    const actor =
      readActorEmail(payload.actorEmail) ||
      readActorEmail(req.nextUrl.searchParams.get("actorEmail"));
    if (!actor) return machineBadRequest("actorEmail bắt buộc");
    const email = await findDoraUserEmail(actor);
    if (!email) return actorNotDoraUser(actor);

    await deleteNote(conversationId, note_id, email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return noteErrorResponse(err, "DELETE /api/machine/conversations/:id/notes/:noteId");
  }
}
