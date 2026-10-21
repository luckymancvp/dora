import type { NextRequest } from "next/server";
import { corsJson, OPTIONS } from "@/lib/http/cors";
import { applyOrderMessageStatus } from "@/lib/services/order-message";

export { OPTIONS };

// POST /v1/extension/order-messages/status/:id  body: { status, client_id?, convo_id?, error? }
// Extension báo trạng thái nhắn khách theo đơn: claim SENDING (extension mới, kèm client_id),
// DONE/FAILED. Bảng chuyển trạng thái CAS ở applyOrderMessageStatus (hợp đồng C2C4 §1.3):
//   200 { ok:true, status, already?, late_done? }
//   409 { ok:false, error, code:"invalid_transition", status:<hiện tại>, claimed_by? }
//       — claim bị 409 thì extension mới KHÔNG gửi (tab khác đang gửi / Mera đã huỷ)
//   404 { ok:false, error, code:"not_found" } · 400 { ok:false, code:"invalid_status"|"invalid_body" }
// Extension cũ nuốt mọi lỗi nên đổi mã HTTP không làm vỡ nó.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    let body: { status?: unknown; convo_id?: unknown; error?: unknown; client_id?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return corsJson({ ok: false, error: "invalid body", code: "invalid_body" }, { status: 400 });
    }
    if (!body || typeof body !== "object") {
      return corsJson({ ok: false, error: "invalid body", code: "invalid_body" }, { status: 400 });
    }
    if (!body.status || typeof body.status !== "string") {
      return corsJson({ ok: false, error: "missing status", code: "invalid_status" }, { status: 400 });
    }
    const r = await applyOrderMessageStatus(id, {
      status: body.status,
      convo_id: body.convo_id,
      error: body.error,
      client_id: body.client_id,
    });
    if (r.ok) return corsJson(r);
    switch (r.code) {
      case "invalid_transition":
        return corsJson({ ...r, error: "Invalid status transition" }, { status: 409 });
      case "not_found":
        return corsJson({ ok: false, error: "not found", code: "not_found" }, { status: 404 });
      default:
        return corsJson({ ok: false, error: "invalid status", code: "invalid_status" }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /v1/extension/order-messages/status/:id]", message);
    return corsJson({ error: message }, { status: 500 });
  }
}
