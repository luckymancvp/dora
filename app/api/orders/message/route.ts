import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { requireEmail, errorResponse } from "@/lib/http/api-helpers";
import { publishSendOrderMessage, type TargetPick } from "@/lib/services/ably-publish";
import {
  applyOrderMessageStatus,
  createOrderMessage,
  setOrderMessageTarget,
} from "@/lib/services/order-message";
import { findDoraUserEmail } from "@/lib/services/dora-user";
import { actorNotDoraUser, hasMachineApiKey } from "@/lib/http/machine-auth";

// POST /api/orders/message — nhắn khách theo đơn (tạo hội thoại mới nếu chưa có).
// body: { shopName, orderId, message, attachments? } — message được rỗng nếu có attachments. Trạng thái thật do extension báo về
// /v1/extension/order-messages/status/:id; UI poll GET /api/orders/message/status/:id.
// attachments: mảng public URL ảnh (Vercel Blob) — extension tự upload2Etsy để đổi thành image_id.
// Auth: session Google (UI) HOẶC header x-api-key khớp MERA_INTERNAL_API_KEY (máy: Apps Script).
// actorEmail (tuỳ chọn, CHỈ xét khi gọi bằng x-api-key — Mera fulfill gửi kèm email user Mera):
// phải có trong `users` (đã từng đăng nhập dora-1) → 403 actor_not_dora_user; hợp lệ thì
// sender_email = email đó. Không gửi actorEmail (Mera admin Send Mockup, Apps Script) → y hệt cũ.
// afterId / preferClientId (tuỳ chọn — Mera Send Mockup đẩy nhiều lô của 1 đơn cùng lúc):
// afterId = id lô trước cùng đơn (extension mới không gửi lô này nếu lô trước hỏng/huỷ);
// preferClientId = clientId lô 1 để mọi lô về đúng tab đang giữ hàng đợi theo đơn.
// Response 200: { ok, id, clientId, clientCaps } — clientCaps = cap extension được đẩy tới
// ([] = extension cũ); Mera dựa vào đó để biết có được đẩy song song / huỷ an toàn không.
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
      afterId?: unknown;
      preferClientId?: unknown;
    };
    const shopName = (body.shopName ?? "").trim();
    const orderId = String(body.orderId ?? "").trim();
    const message = (body.message ?? "").trim();
    if (!shopName || !orderId) {
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
    // message rỗng CHỈ hợp lệ khi có ảnh: tin chỉ-ảnh nối tiếp vào hội thoại đã có. Etsy giữ
    // tối đa 3 ảnh mỗi tin (thừa thì bỏ im lặng, extension vẫn báo DONE), nên Mera Send Mockup
    // tách đơn nhiều ảnh thành nhiều job: job đầu text + ≤3 ảnh, các job sau message "" + ảnh,
    // gửi tuần tự sau khi job trước DONE. Caller tự bảo đảm đơn ĐÃ có hội thoại — đơn chưa có
    // thì extension sẽ tạo hội thoại bằng text rỗng.
    if (!message && attachments.length === 0) {
      return NextResponse.json(
        { error: "shopName, orderId và message bắt buộc" },
        { status: 400 },
      );
    }

    if (viaApiKey) {
      const actorEmail = typeof body.actorEmail === "string" ? body.actorEmail.trim() : "";
      if (actorEmail) {
        const dbEmail = await findDoraUserEmail(actorEmail);
        if (!dbEmail) return actorNotDoraUser(actorEmail);
        senderEmail = dbEmail;
      }
    }

    const afterId = typeof body.afterId === "string" ? body.afterId.trim().slice(0, 100) : "";
    const preferClientId =
      typeof body.preferClientId === "string" ? body.preferClientId.trim().slice(0, 100) : "";

    const id = randomUUID();
    // Ghi doc TRƯỚC khi publish: extension có thể báo DONE/FAILED gần như tức thì,
    // ghi sau sẽ có cửa sổ mà status update không tìm thấy doc để cập nhật.
    await createOrderMessage({ id, shopName, orderId, message, attachments, senderEmail, afterId });

    let target: TargetPick | null;
    try {
      target = await publishSendOrderMessage(
        shopName,
        {
          id,
          order_id: orderId,
          message,
          attachments,
          ...(afterId ? { after_id: afterId } : {}),
        },
        { preferClientId },
      );
    } catch (pubErr) {
      // Như Dora CreateMessage (push lỗi → FAILED): Mera đọc 500 có JSON `error` là NOT_ACCEPTED
      // ("chưa gửi gì, gửi lại an toàn"). Để doc ở NEW thì nếu lệnh thật ra đã tới extension
      // (Ably timeout sau khi đã nhận), extension claim_v2 vẫn claim được và gửi → khách nhận 2 lần.
      // FAILED trước ⇒ claim 409 ⇒ extension mới không gửi. (QA C4, 2026-10-06)
      const reason = pubErr instanceof Error ? pubErr.message : String(pubErr);
      await applyOrderMessageStatus(id, { status: "FAILED", error: `publish_failed: ${reason}`.slice(0, 300) }).catch(
        (e) => console.warn("[POST /api/orders/message] mark FAILED after publish error:", (e as Error)?.message),
      );
      throw pubErr;
    }
    if (!target) {
      await applyOrderMessageStatus(id, { status: "FAILED", error: "shop_offline" });
      return NextResponse.json(
        { error: "Shop chưa có extension online", code: "shop_offline" },
        { status: 409 },
      );
    }
    // Tin ĐÃ được đẩy: lỗi ghi target không được biến thành 500 (Mera sẽ coi là "chưa nhận"
    // trong khi extension vẫn gửi) — chỉ log; thiếu target_caps thì Mera không huỷ, an toàn.
    try {
      await setOrderMessageTarget(id, target.clientId, target.caps);
    } catch (e) {
      console.warn("[POST /api/orders/message] set target failed:", (e as Error)?.message);
    }
    return NextResponse.json({ ok: true, id, clientId: target.clientId, clientCaps: target.caps });
  } catch (err) {
    return errorResponse(err, "POST /api/orders/message");
  }
}
