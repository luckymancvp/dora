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
/**
 * Trần ứng viên nạp cho cosine fallback. Hạ 1000→300 (2026-07): mỗi doc ~10KB
 * (embedding 768 chiều), 1000 doc ≈ 9MB — đo thực tế trên prod có lần mất tới
 * 2 phút khi mạng chậm. 300 ví dụ gần nhất là đủ (vòng lặp học ưu tiên tin mới).
 */
const FALLBACK_CANDIDATES = 300;
/** Trần tổng số ví dụ trong kho (FIFO: vượt thì xoá cũ nhất). */
const MAX_EXAMPLES = 3000;
/**
 * Ngưỡng cosine tối thiểu để một ví dụ được đưa vào prompt. Top-k "bất chấp
 * điểm" từng nhét ví dụ lạc đề vào few-shot → gợi ý lạc trọng tâm và sai văn
 * phong. Thà 0 ví dụ còn hơn 3 ví dụ sai.
 */
const MIN_SIMILARITY = 0.55;
/**
 * Loại các ví dụ là TIN TRẢ LỜI TỰ ĐỘNG (ngoài giờ) lọt vào kho từ đợt seed —
 * chúng dạy AI đúng kiểu văn corporate mà system prompt đang cấm.
 */
const AUTO_REPLY_RE =
  /outside of (my|our) (normal|business|working) hours|auto-?matic(ally)? (reply|message|response)|away message|this is an automated/i;

/**
 * Ví dụ không dạy được văn phong thì bỏ: (1) auto-reply ngoài giờ (văn corporate
 * mà prompt cấm), (2) reply chỉ là link/HTML trần (seed bắt cả tin chỉ gửi
 * tracking link — top match thực tế trên prod từng là chuỗi `<a rel=...`).
 */
function isPoorStyleExample(staffReply: string): boolean {
  if (AUTO_REPLY_RE.test(staffReply)) return true;
  const stripped = staffReply
    .replace(/https?:\/\/\S+/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
  // Đếm từ thật thay vì ký tự — mã tracking/đuôi URL dài vẫn không phải văn.
  const words = stripped.match(/[A-Za-z]{2,}/g) ?? [];
  return words.length < 5;
}

/**
 * Prod chạy Mongo tự host 5.0 → $vectorSearch không tồn tại. Nhớ kết quả lần
 * thử đầu để các request sau khỏi tốn 1 round-trip fail vô ích.
 */
let vectorSearchUnavailable = false;

/**
 * Cache ứng viên cosine fallback theo shop (TTL ngắn). Không có cache, MỖI lần
 * gợi ý AI kéo tới ~1000 doc × ~10KB (embedding 768 chiều) từ Mongo về — đây
 * từng là nguồn chậm chính của tính năng. Ví dụ mới trong TTL chỉ vắng mặt tối
 * đa vài phút, chấp nhận được với few-shot.
 */
const CANDIDATE_TTL_MS = 5 * 60_000;
const candidateCache = new Map<number, { at: number; docs: ReplyExampleDoc[] }>();

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
  // Chặn rác ngay tại cổng nạp (cả seed lẫn learning): auto-reply/link trần
  // không được vào kho — khỏi tốn API embed và khỏi phải lọc lúc truy xuất.
  if (isPoorStyleExample(reply)) return false;

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
  // Ví dụ mới phải xuất hiện trong truy xuất lần sau → bỏ cache của shop.
  candidateCache.delete(input.shopId);
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
  const cached = candidateCache.get(shopId);
  let candidates: ReplyExampleDoc[];
  if (cached && Date.now() - cached.at < CANDIDATE_TTL_MS) {
    candidates = cached.docs;
  } else {
    candidates = (await coll
      .find({ shopId })
      // Chỉ kéo field cần cho cosine + prompt; doc còn lại (dedupKey…) bỏ qua.
      .project({ embedding: 1, customerSnippet: 1, staffReply: 1, intentTag: 1, created_at: 1 })
      .sort({ created_at: -1 })
      .limit(FALLBACK_CANDIDATES)
      .toArray()) as ReplyExampleDoc[];
    candidateCache.set(shopId, { at: Date.now(), docs: candidates });
  }
  return candidates
    .filter((d) => !isPoorStyleExample(d.staffReply))
    .map((d) => ({ d, score: cosine(query, d.embedding) }))
    .filter((s) => s.score >= MIN_SIMILARITY)
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
  // index) → nhớ lại và rơi thẳng xuống cosine in-app ở các lần sau.
  if (!vectorSearchUnavailable) {
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
      if (docs.length > 0) return docs.filter((d) => !isPoorStyleExample(d.staffReply));
    } catch {
      vectorSearchUnavailable = true;
    }
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
