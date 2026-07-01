/**
 * Giai đoạn 2 — Embeddings qua Gemini (dùng chung GEMINI_API_KEY, không thêm provider).
 * Model text-embedding-004: 768 chiều, đủ tốt cho truy xuất ví dụ trả lời tương tự.
 */

const EMBED_MODEL = "gemini-embedding-001";
/** Số chiều vector — dùng khi tạo Atlas Vector Search index. */
export const EMBED_DIM = 768;
/** Cắt bớt input quá dài để tránh lỗi/token thừa (embedding chỉ cần ngữ nghĩa). */
const MAX_CHARS = 8000;

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function apiKey(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error("GEMINI_API_KEY chưa cấu hình");
  return k;
}

/** Embed 1 đoạn text → vector 768 chiều. */
export async function embedText(text: string): Promise<number[]> {
  const url = `${BASE}/${EMBED_MODEL}:embedContent?key=${apiKey()}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text: text.slice(0, MAX_CHARS) }] },
      outputDimensionality: EMBED_DIM,
    }),
  });
  if (!resp.ok) {
    throw new Error(`embed failed ${resp.status}: ${await resp.text()}`);
  }
  const data = (await resp.json()) as { embedding?: { values?: number[] } };
  const v = data.embedding?.values;
  if (!v || v.length === 0) throw new Error("embed: empty vector");
  return v;
}

/**
 * Embed nhiều đoạn cùng lúc (batchEmbedContents) — dùng cho seed để nhanh & rẻ.
 * Trả mảng cùng thứ tự; phần tử lỗi/rỗng là [] (caller tự bỏ qua).
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const url = `${BASE}/${EMBED_MODEL}:batchEmbedContents?key=${apiKey()}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: texts.map((t) => ({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text: t.slice(0, MAX_CHARS) }] },
        outputDimensionality: EMBED_DIM,
      })),
    }),
  });
  if (!resp.ok) {
    throw new Error(`batch embed failed ${resp.status}: ${await resp.text()}`);
  }
  const data = (await resp.json()) as { embeddings?: { values?: number[] }[] };
  return (data.embeddings ?? []).map((e) => e.values ?? []);
}
