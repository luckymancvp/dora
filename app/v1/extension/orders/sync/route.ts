import type { NextRequest } from "next/server";
import { corsJson, OPTIONS } from "@/lib/http/cors";
import { syncOrderList } from "@/lib/services/orders-sync";

export { OPTIONS };

// POST /v1/extension/orders/sync — extension đẩy đơn fetch từ Etsy về.
// Upsert vào dora-master.etsy_orders để trang Orders đọc.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await syncOrderList(body);
    return corsJson(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[orders/sync] error:", message);
    return corsJson({ error: message }, { status: 500 });
  }
}
