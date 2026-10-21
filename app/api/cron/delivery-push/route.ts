import { NextResponse, type NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import { errorResponse } from "@/lib/http/api-helpers";
import { pushDeliveryAll } from "@/lib/services/delivery-push";
import type { DeliveryPushCronResponse } from "@/lib/types/delivery";

// Node runtime (Mongo + crypto), không cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Nhiều sheet × nhiều chunk (30s/chunk) gửi tuần tự — cần trần 300s (Pro).
export const maxDuration = 300;

/**
 * GET /api/cron/delivery-push — đẩy snapshot mã tracking của mọi sheet_config đang bật sang Mera.
 * Gọi bởi Vercel Cron mỗi 30 phút (vercel.json). Chỉ đọc `sheet_rows` đã có, KHÔNG sync Google (A4).
 * Query tuỳ chọn: `configId=<hex>` (chỉ 1 sheet), `force=1` (bỏ qua luật hash trùng).
 * Cổng bật/tắt từng config vẫn là env DELIVERY_PUSH (config không bật → outcome "disabled").
 */
export async function GET(req: NextRequest) {
  // Guard y hệt cron/fetch-orders: chỉ chặn khi CRON_SECRET có cấu hình (local bỏ trống → cho chạy).
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const sp = req.nextUrl.searchParams;
    const rawId = (sp.get("configId") ?? "").trim();
    // ObjectId.isValid nhận cả chuỗi 12 ký tự bất kỳ → kiểm hex 24 ký tự cho chắc.
    if (rawId && !/^[0-9a-f]{24}$/i.test(rawId)) {
      return NextResponse.json({ error: "configId không hợp lệ", code: "invalid_id" }, { status: 400 });
    }
    const force = sp.get("force") === "1";

    const results = await pushDeliveryAll({
      force,
      configId: rawId ? new ObjectId(rawId) : undefined,
    });
    const body: DeliveryPushCronResponse = { ok: true, results };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err, "GET /api/cron/delivery-push");
  }
}
