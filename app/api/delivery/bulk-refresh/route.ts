import { NextResponse, type NextRequest } from "next/server";
import { requireEmail } from "@/lib/http/api-helpers";
import { deliveryErrorResponse } from "@/lib/http/delivery-error";
import { startBulkRefresh } from "@/lib/services/delivery-proxy";
import type { BulkRefreshJob, DeliveryApiErrorBody } from "@/lib/types/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/delivery/bulk-refresh — body `{ ids: string[] }` (id = DeliveryTracking.id).
 * Trả **202** + BulkRefreshJob (job chạy nền trên Mera, có thể `done` ngay). Giới hạn số mã / shop
 * do Mera kiểm (too_many, too_many_per_shop…); dora-1 chỉ chặn body sai kiểu để khỏi gửi rác.
 */
export async function POST(req: NextRequest) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;

    let raw: unknown = null;
    try {
      raw = await req.json();
    } catch {
      raw = null;
    }
    const ids = (raw as { ids?: unknown } | null)?.ids;
    if (!Array.isArray(ids) || !ids.every((v) => typeof v === "string")) {
      const bad: DeliveryApiErrorBody = { error: "ids phải là mảng chuỗi", code: "invalid_body" };
      return NextResponse.json(bad, { status: 400 });
    }

    const body: BulkRefreshJob = await startBulkRefresh(ids as string[], gate.email);
    return NextResponse.json(body, { status: 202 });
  } catch (err) {
    return deliveryErrorResponse(err, "POST /api/delivery/bulk-refresh");
  }
}
