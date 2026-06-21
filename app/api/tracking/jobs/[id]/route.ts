import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { getJob } from "@/lib/services/tracking";

// GET /api/tracking/jobs/:id — frontend poll trạng thái job.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const { id } = await ctx.params;
    const job = await getJob(id);
    if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ job });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[GET /api/tracking/jobs/:id]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
