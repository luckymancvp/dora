import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { deleteTemplate, TemplateError, updateTemplate } from "@/lib/services/message-template";

async function requireEmail(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email ?? null;
}

// PUT /api/message-templates/:id  body: { title?, content? }
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const email = await requireEmail();
  if (!email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as { title?: unknown; content?: unknown };
    await updateTemplate(id, email, body);
    // UI (useMessageTemplates) chỉ cần ok rồi refetch — giữ nguyên response cũ.
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof TemplateError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[PUT /api/message-templates/:id]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/message-templates/:id
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const email = await requireEmail();
  if (!email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  try {
    const { id } = await ctx.params;
    await deleteTemplate(id, email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof TemplateError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[DELETE /api/message-templates/:id]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
