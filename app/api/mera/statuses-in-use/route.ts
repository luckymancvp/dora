import { NextResponse } from "next/server";
import { requireEmail, errorResponse } from "@/lib/http/api-helpers";
import { getMeraStatusesInUse } from "@/lib/services/mera-status-index";

// GET /api/mera/statuses-in-use — các status đang có trên đơn Mera → { statuses: string[] }.
// Dùng cho dropdown bộ lọc Status (khác /api/mera/statuses: danh sách status CẤU HÌNH để gán cho đơn).
export async function GET() {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;

    const statuses = await getMeraStatusesInUse();
    return NextResponse.json({ statuses });
  } catch (err) {
    return errorResponse(err, "GET /api/mera/statuses-in-use");
  }
}
