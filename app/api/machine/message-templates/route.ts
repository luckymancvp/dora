import { NextResponse, type NextRequest } from "next/server";
import { createTemplate, listTemplates, TemplateError } from "@/lib/services/message-template";
import { findDoraUserEmail } from "@/lib/services/dora-user";
import {
  actorNotDoraUser,
  hasMachineApiKey,
  machineBadRequest,
  machineUnauthorized,
  readActorEmail,
  readJsonObject,
} from "@/lib/http/machine-auth";

// Bản máy gọi (Mera fulfill) của /api/message-templates — dùng chung service
// lib/services/message-template.ts với UI dora-1. Owner = actorEmail chuẩn hoá theo `users`
// (so khớp chính xác như email session).

// GET /api/machine/message-templates?scope=mine|all&q=&actorEmail=
// Response 200: { items: (MessageTemplate & { mine: boolean })[] } — created_at desc, ngày ISO.
// actor không phải dora user: scope=mine ⇒ items rỗng; scope=all vẫn đọc được (mine=false).
export async function GET(req: NextRequest) {
  if (!hasMachineApiKey(req)) return machineUnauthorized();

  try {
    const sp = req.nextUrl.searchParams;
    const scope = sp.get("scope") ?? "mine";
    const actor = readActorEmail(sp.get("actorEmail"));
    const email = actor ? await findDoraUserEmail(actor) : null;

    if (scope === "mine" && !email) return NextResponse.json({ items: [] });

    const items = await listTemplates({ scope, q: sp.get("q") ?? "", email: email ?? "" });
    return NextResponse.json({
      items: items.map((t) => ({ ...t, mine: !!email && t.email === email })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[GET /api/machine/message-templates]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/machine/message-templates  body: { title, content, actorEmail }
// Response 201: { item }. 400 title 1..100 / content 1..2000; 403 actor_not_dora_user.
export async function POST(req: NextRequest) {
  if (!hasMachineApiKey(req)) return machineUnauthorized();

  try {
    const body = await readJsonObject(req);
    if (!body) return machineBadRequest("body phải là JSON object");

    const actor = readActorEmail(body.actorEmail);
    if (!actor) return machineBadRequest("actorEmail bắt buộc");
    const email = await findDoraUserEmail(actor);
    if (!email) return actorNotDoraUser(actor);

    const item = await createTemplate(email, { title: body.title, content: body.content });
    return NextResponse.json({ item: { ...item, mine: true } }, { status: 201 });
  } catch (err) {
    if (err instanceof TemplateError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /api/machine/message-templates]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
