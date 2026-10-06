import { NextResponse, type NextRequest } from "next/server";
import { cancelOrderMessage } from "@/lib/services/order-message";
import {
  hasMachineApiKey,
  machineBadRequest,
  machineUnauthorized,
  readActorEmail,
  readOptionalJsonObject,
} from "@/lib/http/machine-auth";

// POST /api/machine/order-messages/:id/cancel — Mera huỷ tin nhắn theo đơn còn NEW (CAS
// {id, status:NEW} → CANCELLED). Mera CHỈ gọi khi tin được đẩy tới extension có cap claim_v2:
// extension đó claim NEW→SENDING trước khi đụng Etsy, nên huỷ thành công = chắc chắn chưa gửi.
// Auth: x-api-key = MERA_INTERNAL_API_KEY (đã qua proxy vì /api/machine/*).
// Body (tuỳ chọn): { reason?: string, actorEmail?: string } — chỉ để ghi cancelled_by / log.
//   200 { ok:true, id, status:"CANCELLED", already? }
//   409 { ok:false, error, code:"invalid_transition", status:"SENDING"|"DONE"|"FAILED" }
//   404 { ok:false, error, code:"not_found" } · 401 unauthenticated
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!hasMachineApiKey(req)) return machineUnauthorized();

  try {
    const { id } = await ctx.params;
    const body = await readOptionalJsonObject(req);
    if (!body) return machineBadRequest("body phải là JSON object");
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const by = readActorEmail(body.actorEmail) || "mera";

    const r = await cancelOrderMessage(id, by);
    if (r.ok) {
      console.log(`[order-message] cancel ${id} by=${by} reason=${reason}${r.already ? " (already)" : ""}`);
      return NextResponse.json({ ok: true, id, status: r.status, ...(r.already ? { already: true } : {}) });
    }
    if (r.code === "not_found") {
      return NextResponse.json({ ok: false, error: "not found", code: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ...r, error: "Invalid status transition" }, { status: 409 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /api/machine/order-messages/:id/cancel]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
