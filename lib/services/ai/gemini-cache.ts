import { createHash } from "crypto";

/**
 * Explicit context caching cho Gemini (giảm token cho phần system instruction tĩnh).
 *
 * VÌ SAO EXPLICIT (không dựa implicit):
 * - System instruction ~3074 token gửi lại NGUYÊN SI ở mỗi call → chiếm gần hết
 *   token input. Cache nó lại thì phần này chỉ tính giá cached (~75-90% rẻ hơn).
 * - Implicit caching của gemini-3.1-flash-lite đã NGỪNG áp discount từ ~30/06/2026
 *   (báo cáo trên Google AI Dev Forum) → không thể trông cậy. Explicit là đường
 *   được hỗ trợ chính thức và đo được (`cachedContentTokenCount` trong usageMetadata).
 * - Ngưỡng tạo cache thực tế = 1024 token (docs ghi 4096 nhưng thực nghiệm + lỗi
 *   API xác nhận 1024); SI 3074 token vượt xa → tạo cache được.
 *
 * Đã đo trực tiếp trên API project: cache CHỈ chứa system_instruction (không cần
 * contents) được chấp nhận; generateContent tham chiếu qua `cachedContent` +
 * responseSchema chạy đúng, trả cachedContentTokenCount = 3074.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";
/** Cache sống 1 giờ; tạo lại khi hết hạn hoặc khi text SI đổi (deploy mới). */
const CACHE_TTL_SECONDS = 3600;
/** Làm mới sớm trước khi thật sự hết hạn để tránh dùng cache vừa hết hạn (race gần TTL). */
const REFRESH_MARGIN_MS = 60_000;

interface CacheEntry {
  name: string;
  expiresAt: number;
  /** Hash của (model + SI) để tự vô hiệu khi một trong hai đổi. */
  key: string;
}

// State ở mức module: sống theo tiến trình server. Mỗi instance/cold-start tự tạo
// cache riêng ở lần call no-guidance đầu tiên — chấp nhận được (create rẻ, TTL 1h).
let entry: CacheEntry | null = null;
// Gộp các lần tạo đồng thời thành 1 request (tránh N cache trùng khi nhiều call ập tới).
let inflight: Promise<CacheEntry | null> | null = null;

function keyOf(model: string, systemText: string): string {
  return createHash("sha1").update(`${model}\n${systemText}`).digest("hex");
}

async function createCache(
  apiKey: string,
  model: string,
  systemText: string,
): Promise<CacheEntry | null> {
  const resp = await fetch(`${BASE}/cachedContents?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${model}`,
      system_instruction: { parts: [{ text: systemText }] },
      ttl: `${CACHE_TTL_SECONDS}s`,
    }),
  });
  if (!resp.ok) {
    // Dưới ngưỡng token / lỗi tạm thời → trả null, caller gửi SI inline như cũ.
    console.error(`[ai] cache create failed ${resp.status}: ${await resp.text()}`);
    return null;
  }
  const data = (await resp.json()) as { name?: string };
  if (!data.name) return null;
  // Tính hạn từ TTL của mình (không tin clock server để tránh lệch giờ).
  return {
    name: data.name,
    expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000,
    key: keyOf(model, systemText),
  };
}

/**
 * Trả cache name còn hạn cho system instruction TĨNH. Tự tạo lại khi hết hạn hoặc
 * khi (model, SI) đổi. Trả null nếu không tạo được → caller gửi SI inline (fallback
 * an toàn: tính năng vẫn chạy, chỉ không được discount).
 */
export async function getSystemCacheName(
  apiKey: string,
  model: string,
  systemText: string,
): Promise<string | null> {
  const now = Date.now();
  const key = keyOf(model, systemText);

  if (entry && entry.key === key && entry.expiresAt - REFRESH_MARGIN_MS > now) {
    return entry.name;
  }

  if (inflight) {
    const e = await inflight;
    return e && e.key === key ? e.name : null;
  }

  inflight = createCache(apiKey, model, systemText)
    .then((e) => {
      entry = e;
      return e;
    })
    .catch((err) => {
      console.error("[ai] cache create error:", err);
      return null;
    })
    .finally(() => {
      inflight = null;
    });

  const e = await inflight;
  return e ? e.name : null;
}

/** Bỏ cache đang giữ (gọi khi generateContent báo cache không hợp lệ/hết hạn). */
export function invalidateSystemCache(): void {
  entry = null;
}
