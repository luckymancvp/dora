import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { requireEmail, errorResponse } from "@/lib/http/api-helpers";
import { publishSendOrderMessage } from "@/lib/services/ably-publish";
import { applyOrderMessageStatus, createOrderMessage } from "@/lib/services/order-message";
import { findDoraUserEmail } from "@/lib/services/dora-user";
import { actorNotDoraUser, hasMachineApiKey } from "@/lib/http/machine-auth";

// POST /api/orders/message — nhắn khách theo đơn (tạo hội thoại mới nếu chưa có).
// body: { shopName, orderId, message, attachments? }. Trạng thái thật do extension báo về
// /v1/extension/order-messages/status/:id; UI poll GET /api/orders/message/status/:id.
// attachments: mảng public URL ảnh (Vercel Blob) — extension tự upload2Etsy để đổi thành image_id.
// Auth: session Google (UI) HOẶC header x-api-key khớp MERA_INTERNAL_API_KEY (máy: Apps Script).
// actorEmail (tuỳ chọn, CHỈ xét khi gọi bằng x-api-key — Mera fulfill gửi kèm email user Mera):
// phải có trong `users` (đã từng đăng nhập dora-1) → 403 actor_not_dora_user; hợp lệ thì
// sender_email = email đó. Không gửi actorEmail (Mera admin Send Mockup, Apps Script) → y hệt cũ.
export async function POST(req: NextRequest) {
  const viaApiKey = hasMachineApiKey(req);

  let senderEmail = "";
  if (!viaApiKey) {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;
    senderEmail = gate.email;
  }

  try {
    const body = (await req.json()) as {
      shopName?: string;
      orderId?: string | number;
      message?: string;
      attachments?: unknown;
      actorEmail?: unknown;
    };
    const shopName = (body.shopName ?? "").trim();
    const orderId = String(body.orderId ?? "").trim();
    const message = (body.message ?? "").trim();
    if (!shopName || !orderId || !message) {
      return NextResponse.json(
        { error: "shopName, orderId và message bắt buộc" },
        { status: 400 },
      );
    }

    // Caller cũ (Apps Script) không gửi field này → coi như không có ảnh thay vì 400,
    // giữ tương thích ngược. Chỉ nhận string http(s) vì extension phải fetch được URL
    // từ trình duyệt (không cookie) để upload2Etsy — blob:/data: hay path nội bộ đều vô dụng.
    const attachments = (Array.isArray(body.attachments) ? body.attachments : [])
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter((x) => x.startsWith("http://") || x.startsWith("https://"));
    if (attachments.length > 10) {
      return NextResponse.json({ error: "Tối đa 10 ảnh mỗi tin" }, { status: 400 });
    }

    if (viaApiKey) {
      const actorEmail = typeof body.actorEmail === "string" ? body.actorEmail.trim() : "";
      if (actorEmail) {
        const dbEmail = await findDoraUserEmail(actorEmail);
        if (!dbEmail) return actorNotDoraUser(actorEmail);
        senderEmail = dbEmail;
      }
    }

    const id = randomUUID();
    // Ghi doc TRƯỚC khi publish: extension có thể báo DONE/FAILED gần như tức thì,
    // ghi sau sẽ có cửa sổ mà status update không tìm thấy doc để cập nhật.
    await createOrderMessage({ id, shopName, orderId, message, attachments, senderEmail });

    const clientId = await publishSendOrderMessage(shopName, {
      id,
      order_id: orderId,
      message,
      attachments,
    });
    if (!clientId) {
      await applyOrderMessageStatus(id, { status: "FAILED", error: "shop_offline" });
      return NextResponse.json(
        { error: "Shop chưa có extension online", code: "shop_offline" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, id, clientId });
  } catch (err) {
    return errorResponse(err, "POST /api/orders/message");
  }
}
