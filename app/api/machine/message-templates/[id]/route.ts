import { NextResponse, type NextRequest } from "next/server";
import { deleteTemplate, TemplateError, updateTemplate } from "@/lib/services/message-template";
import { findDoraUserEmail } from "@/lib/services/dora-user";
import {
  actorNotDoraUser,
  hasMachineApiKey,
  machineBadRequest,
  machineUnauthorized,
  readActorEmail,
  readJsonObject,
  readOptionalJsonObject,
} from "@/lib/http/machine-auth";

type Ctx = { params: Promise<{ id: string }> };

function templateErrorResponse(err: unknown, tag: string): NextResponse {
  if (err instanceof TemplateError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`[${tag}]`, message);
  return NextResponse.json({ error: message }, { status: 500 });
}

// PUT /api/machine/message-templates/:id  body: { title?, content?, actorEmail }
// Chỉ sửa mẫu của chính actor. Field gửi lên không được rỗng / quá dài.
// Response 200: { item } (bản sau cập nhật). 404 không có / không phải của mình.
export async function PUT(req: NextRequest, ctx: Ctx) {
  if (!hasMachineApiKey(req)) return machineUnauthorized();

  try {
    const { id } = await ctx.params;
    const body = await readJsonObject(req);
    if (!body) return machineBadRequest("body phải là JSON object");

    const actor = readActorEmail(body.actorEmail);
    if (!actor) return machineBadRequest("actorEmail bắt buộc");
    const email = await findDoraUserEmail(actor);
    if (!email) return actorNotDoraUser(actor);

    const item = await updateTemplate(id, email, { title: body.title, content: body.content });
    return NextResponse.json({ item: { ...item, mine: true } });
  } catch (err) {
    return templateErrorResponse(err, "PUT /api/machine/message-templates/:id");
  }
}

// DELETE /api/machine/message-templates/:id  body: { actorEmail } (hoặc ?actorEmail=)
// Response 200: { ok: true }. 404 không có / không phải của mình.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  if (!hasMachineApiKey(req)) return machineUnauthorized();

  try {
    const { id } = await ctx.params;
    const body = await readOptionalJsonObject(req);
    if (!body) return machineBadRequest("body phải là JSON object");

    const actor =
      readActorEmail(body.actorEmail) || readActorEmail(req.nextUrl.searchParams.get("actorEmail"));
    if (!actor) return machineBadRequest("actorEmail bắt buộc");
    const email = await findDoraUserEmail(actor);
    if (!email) return actorNotDoraUser(actor);

    await deleteTemplate(id, email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return templateErrorResponse(err, "DELETE /api/machine/message-templates/:id");
  }
}
