import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { getPinnedTags, PreferenceError, setTagPinned } from "@/lib/services/user-preferences";
import type { PinnedTagsResponse } from "@/lib/types/user-preferences";

// GET /api/me/pinned-tags — tag ghim của người dùng hiện tại (panel Tag trên Dashboard).
export async function GET() {
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const res: PinnedTagsResponse = { pinnedTags: await getPinnedTags(email) };
    return NextResponse.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[GET /api/me/pinned-tags]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/me/pinned-tags  body: { tag, pinned } — ghim/bỏ ghim 1 tag (nguyên tử).
export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "body phải là JSON object" }, { status: 400 });
    }

    const res: PinnedTagsResponse = { pinnedTags: await setTagPinned(email, body) };
    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof PreferenceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[PATCH /api/me/pinned-tags]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
