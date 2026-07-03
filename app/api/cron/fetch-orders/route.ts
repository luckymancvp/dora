import { NextResponse, type NextRequest } from "next/server";
import { getShops } from "@/lib/services/shop-read";
import { publishFetchOrders } from "@/lib/services/ably-publish";
import { errorResponse } from "@/lib/http/api-helpers";

// Chạy trên Node runtime (cần Ably REST + Mongo), không cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel cho phép hàm chạy tối đa 300s (Pro) — nhiều shop vẫn kịp.
export const maxDuration = 300;

/** ISO yyyy-mm-dd của hôm nay lùi `days` ngày (mirror FetchOrdersButton). */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * GET /api/cron/fetch-orders — tự động fetch đơn cho TẤT CẢ shop đang online.
 * Gọi bởi Vercel Cron (mỗi 2 tiếng, xem vercel.json). Bảo vệ bằng CRON_SECRET:
 * Vercel gửi header `Authorization: Bearer <CRON_SECRET>`.
 *
 * Với mỗi shop online → publish "fetch-orders" (fire-and-forget) cửa sổ 30 ngày,
 * y hệt nút "Fetch orders" thủ công. Shop offline được bỏ qua (extension không nghe).
 */
export async function GET(req: NextRequest) {
  // Chỉ chặn khi CRON_SECRET có cấu hình (production). Local không set → cho chạy.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const dateFrom = isoDaysAgo(30);
    const dateTo = isoDaysAgo(0);

    const shops = await getShops();
    const onlineShops = shops.filter((s) => s.online && s.shopName);

    const results = await Promise.all(
      onlineShops.map(async (s) => {
        try {
          const clientId = await publishFetchOrders(s.shopName, {
            date_from: dateFrom,
            date_to: dateTo,
          });
          return { shopName: s.shopName, ok: !!clientId, offline: !clientId };
        } catch (e) {
          return {
            shopName: s.shopName,
            ok: false,
            error: e instanceof Error ? e.message : "unknown",
          };
        }
      }),
    );

    const requested = results.filter((r) => r.ok).length;
    console.log(
      `[cron/fetch-orders] ${requested}/${onlineShops.length} online shop được yêu cầu fetch (${dateFrom}..${dateTo})`,
    );

    return NextResponse.json({
      ok: true,
      totalShops: shops.length,
      onlineShops: onlineShops.length,
      requested,
      dateFrom,
      dateTo,
      results,
    });
  } catch (err) {
    return errorResponse(err, "GET /api/cron/fetch-orders");
  }
}
