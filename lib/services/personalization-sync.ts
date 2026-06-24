import type { Filter } from "mongodb";
import { getPersonalizationFilesCollection } from "@/lib/db/collections";
import { asNumber, asString, isObject } from "@/lib/services/etsy-utils";
import type { PersonalizationFileDoc } from "@/lib/types/etsy";

/** Body POST /v1/extension/personalization-files (extension fetchAndPostPersonalization). */
export interface PersonalizationSyncBody {
  shop_name?: string;
  receipts?: {
    receipt_id?: number | string;
    transactions?: {
      transaction_id?: number | string;
      files?: { url?: string; thumbnail_url?: string; filename?: string }[];
    }[];
  }[];
}

function mapFiles(raw: unknown): { url: string; thumbnail_url: string; filename: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObject)
    .map((f) => ({
      url: asString(f["url"]),
      thumbnail_url: asString(f["thumbnail_url"]) || asString(f["thumbnailUrl"]),
      filename: asString(f["filename"]),
    }))
    .filter((f) => f.url || f.thumbnail_url);
}

/**
 * Upsert ảnh khách upload ("Your Photo") theo receipt_id vào dora.personalization_files.
 * Ghi MỌI receipt đã thử (kể cả rỗng) để đánh dấu "đã GET" → trang Orders/Messenger đọc.
 * Trả số receipt đã ghi.
 */
export async function savePersonalizationFiles(body: PersonalizationSyncBody): Promise<number> {
  const receipts = Array.isArray(body.receipts) ? body.receipts : [];
  if (receipts.length === 0) return 0;
  const shopName = asString(body.shop_name);
  const coll = await getPersonalizationFilesCollection();
  const now = new Date();
  let saved = 0;

  for (const r of receipts) {
    if (!isObject(r)) continue;
    const receiptId = asNumber(r.receipt_id);
    if (receiptId === undefined) continue;

    const transactions = (Array.isArray(r.transactions) ? r.transactions : [])
      .filter(isObject)
      .map((t) => ({
        transaction_id: asNumber(t["transaction_id"]) ?? 0,
        files: mapFiles(t["files"]),
      }))
      .filter((t) => t.transaction_id > 0);

    await coll.updateOne(
      { receipt_id: receiptId } as Filter<PersonalizationFileDoc>,
      {
        $set: { shop_name: shopName, transactions, updated_at: now },
        $setOnInsert: { receipt_id: receiptId, fetched_at: now },
      },
      { upsert: true },
    );
    saved++;
  }
  return saved;
}
