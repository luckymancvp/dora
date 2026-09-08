import type { NextRequest } from "next/server";
import { corsJson, OPTIONS } from "@/lib/http/cors";
import { saveOrderConversations } from "@/lib/services/order-conversation-sync";
import type { OrderConversationSyncBody } from "@/lib/types/etsy";

export { OPTIONS };

// POST /v1/extension/order-conversations/sync
// body: { shop_name, shop_id, orders: [{ order_id, convo }] } — `convo` là payload RAW
// của Etsy mission-control (orders/convos/{orderId}). Nguồn duy nhất thấy được hội thoại
// của khách guest / khách chưa trả lời (không nằm trong inbox).
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as OrderConversationSyncBody;
    const result = await saveOrderConversations(body);
    return corsJson(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[order-conversations/sync] error:", message);
    return corsJson({ error: message }, { status: 500 });
  }
}
