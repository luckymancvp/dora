import type { NextRequest } from "next/server";
import { corsJson, OPTIONS } from "@/lib/http/cors";
import { applyShipmentsResult } from "@/lib/services/tracking";
import type { ShipmentResultItem } from "@/lib/types/tracking";

export { OPTIONS };

// POST /v1/extension/trackings/shipments-result
// body: { id, shipments: [{ order_id, tracking_code, carrier_name, ... }], ordersToShipments }
// Extension trả kết quả GET shipments cho cả pre-check lẫn verify.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      id?: string;
      shipments?: ShipmentResultItem[];
    };
    if (!body.id) {
      return corsJson({ error: "missing id" }, { status: 400 });
    }
    const shipments = Array.isArray(body.shipments) ? body.shipments : [];
    const ok = await applyShipmentsResult(body.id, shipments);
    return corsJson({ ok });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /v1/extension/trackings/shipments-result]", message);
    return corsJson({ error: message }, { status: 500 });
  }
}
