import { NextResponse, type NextRequest } from "next/server";
import { getConversations } from "@/lib/services/conversation-read";

// GET /api/conversations?cursor=&limit=&search=&from=&to=&maxMessages=&waitingHours=
/**
 * Param số dạng optional: thiếu / rỗng / không parse được ⇒ null ⇒ KHÔNG lọc.
 * Giữ hành vi cũ cho mọi caller chưa cập nhật (extension, messenger sidebar).
 */
const numOrNull = (raw: string | null): number | null => {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const shopIdsRaw = sp.get("shopIds");
    const tagsRaw = sp.get("tags");
    const data = await getConversations({
      cursor: sp.get("cursor"),
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
      search: sp.get("search") ?? undefined,
      notReplied: sp.get("notReplied") === "true",
      hasOrder: sp.get("hasOrder") === "true",
      orderHelp: sp.get("orderHelp") === "true",
      hasNote: sp.get("hasNote") === "true",
      shopIds: shopIdsRaw
        ? shopIdsRaw.split(",").map(Number).filter(Number.isFinite)
        : undefined,
      tags: tagsRaw
        ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
        : undefined,
      sheetStatuses: sp.get("sheetStatuses")
        ? sp.get("sheetStatuses")!.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined,
      sort: sp.get("sort") === "asc" ? "asc" : "desc",
      // Khoảng lastMessageDate (unix giây) — client gửi mốc đã snapshot, cùng semantics
      // với analytics buildBaseMatch() để Board và Dashboard ra cùng con số.
      from: numOrNull(sp.get("from")),
      to: numOrNull(sp.get("to")),
      maxMessages: numOrNull(sp.get("maxMessages")),
      // Gửi nguyên số GIỜ; service tự tính cutoff theo giờ server.
      waitingHours: numOrNull(sp.get("waitingHours")),
    });
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[GET /api/conversations]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
