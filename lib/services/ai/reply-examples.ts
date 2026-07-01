import { createHash } from "crypto";
import type { Collection } from "mongodb";
import { getReplyExamplesCollection } from "@/lib/db/collections";
import type { ReplyExampleDoc } from "@/lib/types/etsy";
import { embedText } from "@/lib/services/ai/embeddings";

/**
 * Giai đoạn 2 — Few-shot động: truy xuất các ví dụ trả lời THẬT gần nhất về ngữ
 * nghĩa để AI bắt chước văn phong + cách xử lý của shop.
 *
 * Truy xuất: ưu tiên Atlas Vector Search ($vectorSearch); nếu không có index/không
 * phải Atlas → fallback cosine in-app trên tập ứng viên (lọc theo shopId).
 */

/** Tên Atlas Vector Search index (tạo trong Atlas — xem docs). */
const VECTOR_INDEX = "reply_examples_vector";
/** Số ví dụ đưa vào prompt (ít + đúng > nhiều; tránh over-prompting). */
const TOP_K = 3;
/** Trần ứng viên nạp cho cosine fallback (đủ ở quy mô shop, tránh kéo cả kho). */
const FALLBACK_CANDIDATES = 1000;
/** Trần tổng số ví dụ trong kho (FIFO: vượt thì xoá cũ nhất). */
const MAX_EXAMPLES = 3000;

export function makeDedupKey(shopId: number, customerSnippet: string, staffReply: string): string {
  return createHash("sha1").update(`${shopId}|${customerSnippet}|${staffReply}`).digest("hex");
}

export interface AddExampleInput {
  shopId: number;
  shopName?: string;
  intentTag?: string;
  customerSnippet: string;
  staffReply: string;
  source: "seed" | "sent";
  /** Truyền sẵn (từ embedBatch) để khỏi gọi lại API. */
  embedding?: number[];
}

/**
 * Thêm 1 ví dụ (idempotent theo dedupKey). Tự embed nếu chưa truyền sẵn.
 * Trả true nếu thực sự chèn mới. Ném lỗi để caller xử lý (seed) — hoặc bọc try ở nơi gọi runtime.
 */
export async function addReplyExample(input: AddExampleInput): Promise<boolean> {
  const customer = input.customerSnippet.trim();
  const reply = input.staffReply.trim();
  if (!customer || !reply) return false;

  const coll = await getReplyExamplesCollection();
  const dedupKey = makeDedupKey(input.shopId, customer, reply);
  const exists = await coll.findOne({ dedupKey }, { projection: { _id: 1 } });
  if (exists) return false;

  const embedding = input.embedding?.length ? input.embedding : await embedText(customer);
  if (embedding.length === 0) return false;

  await coll.insertOne({
    shopId: input.shopId,
    shopName: input.shopName,
    intentTag: input.intentTag ?? "",
    customerSnippet: customer,
    staffReply: reply,
    embedding,
    source: input.source,
    dedupKey,
    created_at: new Date(),
  });
  return true;
}

/**
 * Giữ kho ≤ MAX_EXAMPLES: xoá các ví dụ CŨ NHẤT (theo created_at) vượt ngưỡng.
 * Gọi sau khi thêm ví dụ (learning) hoặc cuối mỗi lần seed. Trả số bản ghi đã xoá.
 */
export async function enforceExampleCap(): Promise<number> {
  const coll = await getReplyExamplesCollection();
  const total = await coll.countDocuments();
  const over = total - MAX_EXAMPLES;
  if (over <= 0) return 0;
  const oldest = await coll
    .find({}, { projection: { _id: 1 } })
    .sort({ created_at: 1, _id: 1 })
    .limit(over)
    .toArray();
  const ids = oldest.map((d) => d._id);
  if (ids.length === 0) return 0;
  const res = await coll.deleteMany({ _id: { $in: ids } });
  return res.deletedCount;
}

function cosine(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return -1;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function cosineFallback(
  coll: Collection<ReplyExampleDoc>,
  shopId: number,
  query: number[],
  k: number,
): Promise<ReplyExampleDoc[]> {
  const candidates = await coll
    .find({ shopId })
    .sort({ created_at: -1 })
    .limit(FALLBACK_CANDIDATES)
    .toArray();
  return candidates
    .map((d) => ({ d, score: cosine(query, d.embedding) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, k)
    .map((s) => s.d);
}

/** Truy xuất TOP_K ví dụ gần nhất của shop theo vector câu hỏi hiện tại. */
export async function findSimilarExamples(
  shopId: number,
  queryEmbedding: number[],
  k = TOP_K,
): Promise<ReplyExampleDoc[]> {
  if (!shopId || queryEmbedding.length === 0) return [];
  const coll = await getReplyExamplesCollection();

  // Ưu tiên Atlas Vector Search (nhanh, scale). Lỗi (không phải Atlas / chưa tạo
  // index) → rơi xuống cosine in-app.
  try {
    const docs = await coll
      .aggregate<ReplyExampleDoc>([
        {
          $vectorSearch: {
            index: VECTOR_INDEX,
            path: "embedding",
            queryVector: queryEmbedding,
            numCandidates: Math.max(100, k * 20),
            limit: k,
            filter: { shopId },
          },
        },
        { $project: { embedding: 0 } },
      ])
      .toArray();
    if (docs.length > 0) return docs;
  } catch {
    // $vectorSearch không khả dụng → fallback bên dưới.
  }
  return cosineFallback(coll, shopId, queryEmbedding, k);
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 400);
}

/** Dựng khối <examples> cho prompt. Trả "" nếu không có ví dụ. */
export function formatExamplesForPrompt(examples: ReplyExampleDoc[]): string {
  if (examples.length === 0) return "";
  const lines = ["<examples>"];
  lines.push(
    "Real replies THIS shop sent in similar past situations. Match their voice, " +
      "tone and length, but ADAPT to the current customer — never copy verbatim, " +
      "and never reuse their old order-specific facts (only <orders> has current facts).",
  );
  let i = 1;
  for (const e of examples) {
    lines.push("");
    lines.push(`Example ${i++}:`);
    lines.push(`  Customer: ${oneLine(e.customerSnippet)}`);
    lines.push(`  Shop replied: ${oneLine(e.staffReply)}`);
  }
  lines.push("</examples>");
  return lines.join("\n");
}

/**
 * Lấy khối <examples> cho 1 hội thoại: embed tin khách mới nhất → truy xuất ví dụ.
 * KHÔNG ném lỗi ra ngoài — hỏng thì trả "" để gợi ý AI vẫn chạy.
 */
export async function getExamplesBlockForConversation(
  shopId: number,
  messages: { fromMe: boolean; isSystem?: boolean; message: string }[],
): Promise<string> {
  try {
    if (!shopId) return "";
    // Tin khách mới nhất có nội dung (bỏ tin shop + tin hệ thống).
    const lastCustomer = [...messages]
      .reverse()
      .find((m) => !m.fromMe && !m.isSystem && m.message.trim().length > 0);
    if (!lastCustomer) return "";

    const emb = await embedText(lastCustomer.message);
    const examples = await findSimilarExamples(shopId, emb, TOP_K);
    return formatExamplesForPrompt(examples);
  } catch (err) {
    console.error("[ai] getExamplesBlockForConversation failed:", err);
    return "";
  }
}
