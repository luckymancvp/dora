import { NextResponse, type NextRequest } from "next/server";
import { publishFetchOrderConvo } from "@/lib/services/ably-publish";
import {
  hasMachineApiKey,
  machineBadRequest,
  machineUnauthorized,
  readJsonObject,
} from "@/lib/http/machine-auth";
import {
  MACHINE_ORDER_CONVO_FETCH_MAX,
  type MachineOrderConvoFetchOffline,
  type MachineOrderConvoFetchResponse,
} from "@/lib/types/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/machine/order-conversations/fetch — Mera (Request reviews, plan §4.4) nhờ extension đọc
// lại hội thoại của các đơn từ TRANG ĐƠN Etsy trước khi gửi xin review. Publish "fetch-order-convo"
// (như route session /api/orders/conversation/fetch); extension ghi kết quả vào
// dora-master.order_conversations, Mera tự đọc lại — dora-1 không chờ kết quả.
// Auth: x-api-key = MERA_INTERNAL_API_KEY (đã qua proxy vì /api/machine/*).
// Body: { shopName: string, orderIds: number[] } — receipt id nguyên dương, 1..50 sau khi bỏ trùng.
//   200 { ok:true, requestedAt } · 409 { ok:false, error, code:"shop_offline" }
//   400 { error, code:"bad_request" } · 401 unauthenticated · 500 { error }
export async function POST(req: NextRequest) {
  if (!hasMachineApiKey(req)) return machineUnauthorized();

  try {
    const body = await readJsonObject(req);
    if (!body) return machineBadRequest("body phải là JSON object");

    const shopName = typeof body.shopName === "string" ? body.shopName.trim() : "";
    if (!shopName) return machineBadRequest("shopName bắt buộc");

    if (!Array.isArray(body.orderIds)) return machineBadRequest("orderIds phải là mảng số");
    // KHÔNG nhận chuỗi số: Mera gửi int64 — chuỗi ở đây là dấu hiệu sai hợp đồng, báo sớm thay vì ép.
    if (!body.orderIds.every((v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0)) {
      return machineBadRequest("orderIds chỉ gồm số nguyên dương");
    }
    const orderIds = [...new Set(body.orderIds as number[])];
    if (orderIds.length === 0) return machineBadRequest("orderIds rỗng");
    if (orderIds.length > MACHINE_ORDER_CONVO_FETCH_MAX) {
      return machineBadRequest(`Tối đa ${MACHINE_ORDER_CONVO_FETCH_MAX} đơn mỗi lần`);
    }

    // Lấy giờ TRƯỚC khi publish: extension chỉ có thể ghi fetched_at sau thời điểm này, nên Mera
    // so `fetched_at > requestedAt` để biết kết quả là của lần nhờ đọc này (không phải bản cũ).
    const requestedAt = new Date().toISOString();
    const clientId = await publishFetchOrderConvo(shopName, { order_ids: orderIds });
    if (!clientId) {
      const offline: MachineOrderConvoFetchOffline = {
        ok: false,
        error: "Shop chưa có extension online",
        code: "shop_offline",
      };
      return NextResponse.json(offline, { status: 409 });
    }

    console.log(`[order-convo-fetch] shop=${shopName} n=${orderIds.length} client=${clientId}`);
    const res: MachineOrderConvoFetchResponse = { ok: true, requestedAt };
    return NextResponse.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /api/machine/order-conversations/fetch]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
