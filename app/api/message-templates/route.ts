import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { createTemplate, listTemplates, TemplateError } from "@/lib/services/message-template";

// GET /api/message-templates?scope=mine|all&q=searchTerm
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const items = await listTemplates({
      scope: searchParams.get("scope") ?? "mine",
      q: searchParams.get("q") ?? "",
      email,
    });
    return NextResponse.json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[GET /api/message-templates]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/message-templates  body: { title, content }
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const body = (await req.json()) as { title?: unknown; content?: unknown };
    const item = await createTemplate(email, body);
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    if (err instanceof TemplateError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /api/message-templates]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
