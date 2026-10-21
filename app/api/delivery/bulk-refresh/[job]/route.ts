import { NextResponse, type NextRequest } from "next/server";
import { requireEmail } from "@/lib/http/api-helpers";
import { deliveryErrorResponse } from "@/lib/http/delivery-error";
import { getBulkRefreshJob } from "@/lib/services/delivery-proxy";
import type { BulkRefreshJob } from "@/lib/types/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/delivery/bulk-refresh/:job — tiến độ job (FE poll 3s tới `done`). Hết hạn → Mera 404 job_not_found. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ job: string }> }) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;
    const { job } = await ctx.params;
    const body: BulkRefreshJob = await getBulkRefreshJob(job, gate.email);
    return NextResponse.json(body);
  } catch (err) {
    return deliveryErrorResponse(err, "GET /api/delivery/bulk-refresh/:job");
  }
}
