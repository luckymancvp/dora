import type { AIResponse } from "@/lib/types/etsy";

/**
 * Port của dora-backend/utils/chatgpt.go.
 * Gemini là provider chính (giống DORA); giữ nguyên system instruction, 6 tag, 3 đáp án.
 * ChatGPT/Dify giữ làm fallback.
 */

/** Tag phân loại hội thoại — mirror ConversationTags của DORA. */
export const CONVERSATION_TAGS = [
  "send_photo_AI",
  "lost_AI",
  "wrong_design_AI",
  "wrong_item_AI",
  "broken_item_AI",
  "refund_request_AI",
] as const;

/** Ngữ cảnh hội thoại để build prompt (đã rút gọn từ conversation/messages). */
export interface PromptContext {
  shopName: string;
  shopId: number;
  customerId: number;
  customerName: string;
  messages: { senderId: number; createDate: number; message: string }[];
}

/** Context + 12 tin gần nhất + (tuỳ chọn) định hướng của shop owner. */
export function prepareDifyPrompt(ctx: PromptContext, input: string): string {
  const recent = ctx.messages.slice(-12);

  let prompt = "<conversation>\n";
  prompt += `Shop Name: ${ctx.shopName}\n`;
  prompt += `Shop ID: ${ctx.shopId}\n`;
  prompt += `Customer ID: ${ctx.customerId}\n`;
  prompt += `Customer Name: ${ctx.customerName}\n\n`;

  prompt += "Messages:\n";
  for (const m of recent) {
    let senderLabel: string;
    if (m.senderId === ctx.shopId) senderLabel = "Shop";
    else if (m.senderId === ctx.customerId) senderLabel = "Customer";
    else senderLabel = `Unknown(${m.senderId})`;
    prompt += `From: ${senderLabel}\nUnix Time: ${m.createDate}\nMessage: ${m.message}\n\n`;
  }
  prompt += "</conversation>\n\n";

  // Chỉ chở hội thoại + định hướng của shop owner. Mọi chỉ dẫn (task, rules,
  // output format, tag) đã nằm trong systemInstruction nên không lặp lại
  // ở đây để tránh trùng token trong cùng một request Gemini.
  if (input) {
    prompt += `Shop owner's guidance for this reply: "${input}"\n\n`;
  }
  prompt += "Generate the three reply options as JSON per the system instruction.\n";

  return prompt;
}

/** System instruction tối ưu: 3 phương án theo hướng tiếp cận (không ép tông) + chống bịa + tag. */
export function buildGeminiSystemInstruction(input: string): string {
  let sb = `You are an expert customer-support agent working INSIDE an Etsy shop, replying to a customer on the shop's behalf. Your job is to:
1. Draft 3 genuinely useful, ready-to-send reply options for the staff to pick from
2. Classify the conversation into the most appropriate tag

## YOUR TASK — THE 3 REPLY OPTIONS:
Produce exactly 3 DISTINCT reply options. Each option is a COMPLETE message that fully resolves or advances the customer's MOST RECENT request — not three rewordings of the same sentence.
- Make the options differ by APPROACH / SOLUTION / STRATEGY, NOT merely by tone. Examples of different approaches: propose a concrete solution; ask for the specific info you still need to help; offer a choice between options; reassure + commit to follow up; partial answer now + next step.
- Pick the approaches that actually fit THIS situation. A simple thank-you may only warrant short variations; a complex problem (lost package, wrong design, refund, address change, production timeline) needs substantively different paths.
- Each "text" must be a plain, complete message ready to paste and send: no markdown, no headings, no labels or quotes around it, no placeholders like [name] unless the real value is known.
- Each "label" is a SHORT Vietnamese phrase (≤5 words) telling the staff what that option does, e.g. "Hỏi thêm thông tin", "Đề xuất giải pháp", "Trấn an & hẹn cập nhật", "Đưa 2 lựa chọn". The label is metadata for staff — it must NOT appear inside "text".

## ⚠️ NEVER INVENT FACTS (most important rule):
You ONLY know what is written in the conversation below. You do NOT have access to the order database, tracking, shipping dates, prices, product/design details, or shop policy specifics.
- NEVER fabricate order numbers, tracking numbers, ship/delivery dates, refund amounts, prices, or policy terms.
- If a good answer needs information you don't have, the reply must instead: (a) acknowledge the issue, then (b) either politely ask the customer for the specific detail needed (e.g. order number, photo), OR tell them the shop will check and follow up shortly. This is far more useful than a confident but wrong reply.
- It is OK for the 3 options to take different stances on missing info (one asks the customer, one promises to check internally, etc.).

## LANGUAGE & STYLE:
1. Write every "text" in the SAME LANGUAGE as the customer's most recent message.
2. Mirror the SHOP's own voice from this thread — formality, length, warmth, emoji use, greetings/sign-offs. Match how the shop already talks to this customer; do not impose a different style. If the shop hasn't replied yet, keep it warm, concise, and professional.
3. Keep replies focused and human; avoid corporate filler and over-apologizing.

## TAG CLASSIFICATION RULES:
These tags are ONLY for specific issues. Most conversations should have NO tag (empty string).

IMPORTANT CONTEXT: You are helping classify conversations to identify CURRENT ISSUES that need special attention.

CRITICAL: Focus on the CURRENT STATE of the conversation, not the history. If customer sent photos earlier but now is just providing order details or asking questions, do NOT tag as send_photo_AI.

Only assign a tag if the CURRENT/RECENT messages clearly indicate one of these specific scenarios:

- "send_photo_AI" - Customer is CURRENTLY sending photos for design purpose. The most recent customer messages contain or reference photos/images for product design. NOT applicable if photos were sent earlier but current discussion is about something else (like finding order number).

- "lost_AI" - Customer is CURRENTLY reporting package is LOST. Recent messages say: never received, package missing, tracking shows delivered but didn't get it, where is my order (after expected delivery date).

- "wrong_design_AI" - Customer is CURRENTLY complaining about RECEIVED product with wrong design. Recent messages complain about: wrong text, wrong image, misspelled name, design doesn't match order.

- "wrong_item_AI" - Customer is CURRENTLY reporting they RECEIVED completely different product than ordered.

- "broken_item_AI" - Customer is CURRENTLY reporting RECEIVED damaged/broken product. Recent messages mention: broken, cracked, shattered, damaged, defective.

- "refund_request_AI" - Customer is CURRENTLY asking for REFUND or has opened Etsy help request/case.

DO NOT TAG these normal conversations:
- Customer asking about order status or tracking
- Customer providing shipping address or order details (even if they sent photos earlier)
- Customer asking general questions
- Customer saying thank you or confirming receipt (without issues)
- Customer asking to cancel before shipping
- Conversations where the issue from earlier messages has moved on to normal support flow

If the CURRENT state of conversation doesn't clearly fit any tag above, use "suggested_tag": "" (empty string).

For tag classification, analyze ALL messages in the conversation, not just the last one.

## RESPONSE FORMAT (JSON only — ALL FIELDS REQUIRED):
{
  "options": [
    { "label": "Vietnamese label", "text": "complete reply in the customer's language" },
    { "label": "Vietnamese label", "text": "complete reply in the customer's language" },
    { "label": "Vietnamese label", "text": "complete reply in the customer's language" }
  ],
  "suggested_tag": "one_of_the_tags_above_or_empty_string",
  "tag_reason": "brief reason for tag selection, or empty if no tag"
}

⚠️ HARD REQUIREMENTS:
1. "options" MUST contain exactly 3 items; every "label" and "text" must be non-empty real content.
2. The 3 "text" values must be meaningfully DIFFERENT in approach, not just reworded.
3. Never invent facts you don't have (see the NEVER INVENT FACTS rule).
4. If no tag applies, only "suggested_tag" and "tag_reason" may be empty strings.

`;

  if (input) {
    sb += `\n## SHOP OWNER'S GUIDANCE FOR THIS REPLY:\n"${input}"\n\n`;
    sb += "The shop owner has given the intent/content they want to convey to the customer.\n";
    sb += "All 3 options MUST deliver this intent faithfully — do not ignore or contradict it.\n";
    sb += "Vary the options by HOW they deliver it (e.g. direct, with a question, with a reassurance + next step), not by changing what the shop owner wants to say.\n";
    sb += "Still obey the NEVER INVENT FACTS rule: if the guidance assumes a detail not in the conversation, phrase it without fabricating specifics.\n\n";
  }

  return sb;
}

/** CallGeminiAPI: gemini-3.5-flash (thinking tắt), JSON output có responseSchema khoá cứng. */
export async function callGeminiAPI(prompt: string, input: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY chưa cấu hình");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;

  const body = {
    systemInstruction: { parts: [{ text: buildGeminiSystemInstruction(input) }] },
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
      topP: 0.95,
      topK: 40,
      responseMimeType: "application/json",
      // Ép đúng cấu trúc options[{label,text}] + tag để hết lỗi thiếu field / JSON hỏng.
      responseSchema: {
        type: "object",
        properties: {
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                text: { type: "string" },
              },
              required: ["label", "text"],
            },
          },
          suggested_tag: { type: "string" },
          tag_reason: { type: "string" },
        },
        required: ["options", "suggested_tag", "tag_reason"],
      },
      // Tắt thinking để phản hồi nhanh & rẻ hơn (chỉ sinh gợi ý ngắn).
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await resp.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error("failed to parse Gemini response");
  }
  return text;
}

/** Mirror CallChatGPTAPI (fallback): gpt-5. */
export async function callChatGPTAPI(prompt: string): Promise<string> {
  const apiKey = process.env.CHAT_GPT_API_KEY;
  if (!apiKey) throw new Error("CHAT_GPT_API_KEY chưa cấu hình");
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content:
            "You're the diligent helping hand in an Etsy shop, adept at crafting the perfect responses to customer inquiries. Keep replies clear, polite, and focused on directly answering the customer's question without extra detail.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 150,
      n: 1,
    }),
  });
  const data = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("failed to parse ChatGPT response");
  return content;
}

/** Mirror CallDifyAPI (fallback). */
export async function callDifyAPI(prompt: string, input: string): Promise<string> {
  const apiKey = process.env.DIFY_API_KEY;
  if (!apiKey) throw new Error("DIFY_API_KEY chưa cấu hình");
  const resp = await fetch("https://ai.doubletees.net/v1/chat-messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: { ideal: input },
      query: prompt,
      response_mode: "blocking",
      user: "meta",
    }),
  });
  const data = (await resp.json()) as { answer?: string };
  if (typeof data.answer !== "string") throw new Error("failed to parse Dify response");
  return data.answer;
}

/** Parse options[] + tag. Fallback: schema cũ (agree/neutral/apologize), rồi text thô. */
export function processAIResponse(raw: string): AIResponse {
  try {
    const r = JSON.parse(raw) as {
      options?: { label?: unknown; text?: unknown }[];
      // Tương thích ngược với phản hồi schema cũ (nếu còn).
      agree?: string;
      neutral?: string;
      apologize?: string;
      suggested_tag?: string;
      tag_reason?: string;
    };

    if (Array.isArray(r.options)) {
      const options = r.options
        .map((o) => ({
          label: typeof o?.label === "string" ? o.label.trim() : "",
          text: typeof o?.text === "string" ? o.text.trim() : "",
        }))
        .filter((o) => o.text);
      if (options.length > 0) {
        return {
          options,
          suggested_tag: r.suggested_tag ?? "",
          tag_reason: r.tag_reason ?? "",
        };
      }
    }

    // Fallback schema cũ.
    if (r.agree || r.neutral || r.apologize) {
      const legacy = [
        { label: "Đồng ý", text: r.agree ?? "" },
        { label: "Trung lập", text: r.neutral ?? "" },
        { label: "Xin lỗi", text: r.apologize ?? "" },
      ].filter((o) => o.text);
      if (legacy.length > 0) {
        return {
          options: legacy,
          suggested_tag: r.suggested_tag ?? "",
          tag_reason: r.tag_reason ?? "",
        };
      }
    }
  } catch {
    /* fall through tới fallback text thô */
  }

  // Không parse được JSON → dùng nguyên văn làm 1 gợi ý.
  const text = raw.trim();
  return { options: text ? [{ label: "Gợi ý", text }] : [] };
}
