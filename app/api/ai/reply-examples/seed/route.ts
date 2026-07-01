import { NextResponse, type NextRequest } from "next/server";
import type { WithId } from "mongodb";
import { auth } from "@/auth";
import { getConversationsCollection, getReplyExamplesCollection } from "@/lib/db/collections";
import { getConversationMessages } from "@/lib/services/message-read";
import { embedBatch } from "@/lib/services/ai/embeddings";
import { addReplyExample, enforceExampleCap, makeDedupKey } from "@/lib/services/ai/reply-examples";
import { firstNumber } from "@/lib/services/etsy-utils";
import type { ConversationDoc } from "@/lib/types/etsy";

/** Bỏ ghép "ok"/"thanks"… quá ngắn để kho ví dụ sạch. */
const MIN_CUSTOMER_LEN = 3;
const MIN_REPLY_LEN = 15;
/** Batch embed để nhanh/rẻ. */
const EMBED_CHUNK = 100;

interface Pair {
  shopId: number;
  customer: string;
  reply: string;
  dedupKey: string;
}

/**
 * POST /api/ai/reply-examples/seed  body: { limit?: number }
 * Backfill kho ví dụ few-shot (GĐ2) từ lịch sử: ghép (tin khách → tin shop trả lời)
 * trong các hội thoại gần nhất. Idempotent (dedupKey) → chạy lại an toàn.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { limit?: number };
    const convLimit = Math.min(Math.max(body.limit ?? 200, 1), 1000);

    const convColl = await getConversationsCollection();
    const convs = (await convColl
      .find({}, { projection: { "etsy.conversation_id": 1 } })
      .sort({ lastMessageDate: -1 })
      .limit(convLimit)
      .toArray()) as WithId<ConversationDoc>[];

    // Gom cặp (khách → shop) từ từng hội thoại; dedupe theo dedupKey ngay tại chỗ.
    const pairs: Pair[] = [];
    const seen = new Set<string>();
    for (const c of convs) {
      const conversationId = firstNumber(c, ["etsy.conversation_id"]);
      if (conversationId === undefined) continue;

      const { items, shopUserId } = await getConversationMessages({ conversationId, limit: 100 });
      if (!shopUserId) continue;

      let pendingCustomer = "";
      for (const m of items) {
        if (m.isSystem) continue;
        const text = m.message.trim();
        if (!text) continue;
        if (!m.fromMe) {
          pendingCustomer = text; // giữ tin khách gần nhất
        } else if (pendingCustomer) {
          // 1 tin shop trả lời cho lượt khách → 1 cặp.
          if (pendingCustomer.length >= MIN_CUSTOMER_LEN && text.length >= MIN_REPLY_LEN) {
            const dedupKey = makeDedupKey(shopUserId, pendingCustomer, text);
            if (!seen.has(dedupKey)) {
              seen.add(dedupKey);
              pairs.push({ shopId: shopUserId, customer: pendingCustomer, reply: text, dedupKey });
            }
          }
          pendingCustomer = "";
        }
      }
    }

    // Bỏ các cặp đã có trong DB (khỏi tốn embed khi chạy lại).
    const exColl = await getReplyExamplesCollection();
    const existing = await exColl
      .find({ dedupKey: { $in: [...seen] } }, { projection: { dedupKey: 1 } })
      .toArray();
    const existingKeys = new Set(existing.map((d) => d.dedupKey));
    const todo = pairs.filter((p) => !existingKeys.has(p.dedupKey));

    // Embed theo lô + chèn.
    let inserted = 0;
    for (let i = 0; i < todo.length; i += EMBED_CHUNK) {
      const chunk = todo.slice(i, i + EMBED_CHUNK);
      const vectors = await embedBatch(chunk.map((p) => p.customer));
      for (let j = 0; j < chunk.length; j++) {
        const emb = vectors[j];
        if (!emb || emb.length === 0) continue; // embed lỗi → bỏ qua cặp này
        const ok = await addReplyExample({
          shopId: chunk[j].shopId,
          customerSnippet: chunk[j].customer,
          staffReply: chunk[j].reply,
          source: "seed",
          embedding: emb,
        });
        if (ok) inserted++;
      }
    }

    // Giữ kho ≤ trần (FIFO xoá cũ nhất).
    const trimmedOldest = await enforceExampleCap();

    return NextResponse.json({
      scannedConversations: convs.length,
      pairsFound: pairs.length,
      alreadyStored: pairs.length - todo.length,
      inserted,
      trimmedOldest,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /api/ai/reply-examples/seed]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
