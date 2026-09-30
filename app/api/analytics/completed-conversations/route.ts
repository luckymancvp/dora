import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { getCompletedConversations } from "@/lib/services/analytics";
import { parseAnalyticsParams, parseCompletedScope } from "@/lib/services/analytics-params";

// GET /api/analytics/completed-conversations?from=&to=&shopIds=&(tag=|untagged=1|shopId=)
// Danh sách tin đã xong của 1 dòng (tag / No Tag / shop) — lazy, chỉ gọi khi bấm mở.
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const scope = parseCompletedScope(req);
    if ("error" in scope) {
      return NextResponse.json({ error: scope.error }, { status: 400 });
    }
    const data = await getCompletedConversations(parseAnalyticsParams(req), scope);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[GET /api/analytics/completed-conversations]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
