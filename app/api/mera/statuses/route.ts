import { NextResponse } from "next/server";
import { requireEmail, errorResponse } from "@/lib/http/api-helpers";
import { getMeraStatuses } from "@/lib/services/mera-order";

// GET /api/mera/statuses — danh sách status cấu hình trên Mera (collection `statuses`,
// sửa được từ UI Mera) → { statuses: string[] }. Thiếu env → [] (client fallback hardcode).
export async function GET() {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;

    const statuses = await getMeraStatuses({ actorEmail: gate.email });
    return NextResponse.json({ statuses });
  } catch (err) {
    return errorResponse(err, "GET /api/mera/statuses");
  }
}
