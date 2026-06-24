import type { NextRequest } from "next/server";
import { corsJson, OPTIONS } from "@/lib/http/cors";
import { savePersonalizationFiles, type PersonalizationSyncBody } from "@/lib/services/personalization-sync";

export { OPTIONS };

// POST /v1/extension/personalization-files — extension đẩy ảnh khách upload ("Your Photo")
// theo receipt_id (= order_id). Trang Orders/Messenger đọc từ personalization_files.
// body: { shop_name, receipts: [{ receipt_id, transactions: [{ transaction_id, files }] }] }
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PersonalizationSyncBody;
    const saved = await savePersonalizationFiles(body);
    return corsJson({ saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[personalization-files] error:", message);
    return corsJson({ error: message }, { status: 500 });
  }
}
