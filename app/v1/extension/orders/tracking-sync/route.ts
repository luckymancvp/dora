import type { NextRequest } from "next/server";
import { corsJson, OPTIONS } from "@/lib/http/cors";
import { saveOrderShipments, type ShipmentInput } from "@/lib/services/orders-tracking";

export { OPTIONS };

// POST /v1/extension/orders/tracking-sync — extension đẩy tracking thật (GET qua
// /shipments/by-order khi fetch đơn) về để trang Orders hiện số tracking.
// body: { shipments: [{ order_id, tracking_code, carrier_name, tracking_url, is_shipped, is_delivered }] }
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { shipments?: ShipmentInput[] };
    const shipments = Array.isArray(body.shipments) ? body.shipments : [];
    const saved = await saveOrderShipments(shipments);
    return corsJson({ saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[orders/tracking-sync] error:", message);
    return corsJson({ error: message }, { status: 500 });
  }
}
