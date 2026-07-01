import {
  getAiSuggestionEventsCollection,
  getConversationsCollection,
} from "@/lib/db/collections";
import { getConversationMessages } from "@/lib/services/message-read";
import { addReplyExample, enforceExampleCap } from "@/lib/services/ai/reply-examples";
import type { AIResponse, ConversationDoc, SuggestionOutcome } from "@/lib/types/etsy";

/**
 * Giai đoạn 3 — Vòng lặp học + đo lường.
 * Mỗi tin nhân viên gửi:
 *   1) Ghép (tin khách mới nhất → tin vừa gửi) làm ví dụ few-shot mới (source "sent").
 *   2) Ghi event so tin gửi vs gợi ý AI → đo acceptance rate.
 * Fire-and-forget: mọi lỗi được nuốt, KHÔNG chặn/không làm hỏng việc gửi tin.
 */

/** ≥ ngưỡng này coi như gửi gần y hệt gợi ý (sau chuẩn hoá). */
const SENT_ASIS_MIN = 0.985;
/** ≥ ngưỡng này coi như dùng gợi ý nhưng có sửa. */
const EDITED_MIN = 0.6;
const MIN_CUSTOMER_LEN = 3;
const MIN_REPLY_LEN = 15;

export interface CaptureInput {
  conversationId: number;
  shopId: number;
  shopName?: string;
  sentText: string;
  senderEmail: string;
}

export async function captureSentReply(input: CaptureInput): Promise<void> {
  const sent = input.sentText.trim();
  if (!sent) return;

  // Gợi ý AI gần nhất đã lưu trên hội thoại (để đo acceptance + lấy intent).
  const convColl = await getConversationsCollection();
  const conv = (await convColl.findOne(
    { "etsy.conversation_id": input.conversationId },
    { projection: { suggested_messages: 1 } },
  )) as ConversationDoc | null;
  const suggestions: AIResponse | null = conv?.suggested_messages ?? null;
  const options = suggestions?.options ?? [];
  const intentTag = suggestions?.suggested_tag ?? "";

  // Phân loại outcome theo độ giống tin gửi vs từng gợi ý.
  let best = 0;
  for (const o of options) {
    const r = similarityRatio(sent, o.text ?? "");
    if (r > best) best = r;
  }
  const hadSuggestion = options.length > 0;
  let outcome: SuggestionOutcome;
  if (!hadSuggestion) outcome = "no_suggestion";
  else if (best >= SENT_ASIS_MIN) outcome = "sent_asis";
  else if (best >= EDITED_MIN) outcome = "edited";
  else outcome = "custom";

  // (1) Vòng lặp học: nạp ví dụ mới từ tin khách gần nhất → tin vừa gửi.
  try {
    if (input.shopId) {
      const { items } = await getConversationMessages({
        conversationId: input.conversationId,
        limit: 15,
      });
      const lastCustomer = [...items]
        .reverse()
        .find((m) => !m.fromMe && !m.isSystem && m.message.trim().length > 0);
      if (
        lastCustomer &&
        lastCustomer.message.trim().length >= MIN_CUSTOMER_LEN &&
        sent.length >= MIN_REPLY_LEN
      ) {
        const added = await addReplyExample({
          shopId: input.shopId,
          shopName: input.shopName,
          intentTag,
          customerSnippet: lastCustomer.message,
          staffReply: sent,
          source: "sent",
        });
        // Vượt trần 3000 → xoá ví dụ cũ nhất (FIFO).
        if (added) await enforceExampleCap();
      }
    }
  } catch (err) {
    console.error("[ai] learning example failed:", err);
  }

  // (2) Ghi event đo lường.
  try {
    const events = await getAiSuggestionEventsCollection();
    await events.insertOne({
      conversationId: input.conversationId,
      shopId: input.shopId,
      shopName: input.shopName,
      intentTag,
      outcome,
      hadSuggestion,
      similarity: hadSuggestion ? Number(best.toFixed(3)) : 0,
      createdBy: input.senderEmail,
      created_at: new Date(),
    });
  } catch (err) {
    console.error("[ai] suggestion event failed:", err);
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Tỉ lệ giống nhau 0..1 dựa trên Levenshtein (đã chuẩn hoá). */
export function similarityRatio(a: string, b: string): number {
  const x = normalize(a).slice(0, 1000);
  const y = normalize(b).slice(0, 1000);
  if (!x && !y) return 0;
  if (x === y) return 1;
  const maxLen = Math.max(x.length, y.length);
  return maxLen === 0 ? 0 : 1 - levenshtein(x, y) / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = new Array<number>(n + 1);
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}
