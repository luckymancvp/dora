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

/** Mirror PrepareDifyPrompt: context + 8 tin gần nhất + hướng dẫn. */
export function prepareDifyPrompt(ctx: PromptContext, input: string): string {
  const recent = ctx.messages.slice(-8);

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
  // output format, tag, sample) đã nằm trong systemInstruction nên không lặp lại
  // ở đây để tránh trùng token trong cùng một request Gemini.
  if (input) {
    prompt += `Shop owner's guidance for this reply: "${input}"\n\n`;
  }
  prompt += "Generate the three reply options as JSON per the system instruction.\n";

  return prompt;
}

/** Mirror buildGeminiSystemInstruction: giữ nguyên văn prompt + sample responses. */
export function buildGeminiSystemInstruction(input: string): string {
  let sb = `You are an expert Etsy customer support specialist. Your job is to:
1. Generate 3 different response options for the shop owner to choose from
2. Classify the conversation into the most appropriate tag based on the customer's issue

## YOUR TASK:
Generate exactly 3 response messages AND classify the conversation tag in JSON format:
1. "agree" - Positive, agreeing with customer, accommodating their request
2. "neutral" - Professional, balanced, neither committing nor refusing
3. "apologize" - Empathetic, apologetic tone, acknowledging issues
4. "suggested_tag" - The most appropriate tag for this conversation
5. "tag_reason" - Brief explanation why this tag was chosen

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

## CRITICAL RULES:
1. ALWAYS respond in the SAME LANGUAGE as the customer's most recent message
2. MATCH the shop's own writing style and tone from how the shop has been replying in this conversation (formality, length, warmth, emoji use, greetings/sign-offs). Mirror the way the shop already talks to this customer — do NOT impose a different style.
3. Each response should be DIFFERENT in tone but address the same issue
4. If shop owner provides guidance, incorporate it into all 3 responses appropriately
5. For tag classification, analyze ALL messages in the conversation, not just the last one

## RESPONSE FORMAT (JSON only - ALL FIELDS REQUIRED):
{
  "agree": "positive response here",
  "neutral": "balanced response here",
  "apologize": "apologetic response here",
  "suggested_tag": "one_of_the_tags_above_or_empty_string",
  "tag_reason": "brief reason for tag selection or empty if no tag"
}

⚠️ CRITICAL REQUIREMENTS:
1. ALL 5 fields are MANDATORY - never omit any field
2. The fields "agree", "neutral", and "apologize" MUST contain actual message text - NEVER leave them empty ("")
3. Each of these 3 messages must be UNIQUE and have DIFFERENT tones
4. If no tag applies, ONLY suggested_tag and tag_reason can be empty strings
5. If you return empty strings for agree/neutral/apologize, the response will be rejected

`;

  if (input) {
    sb += `\n## ⚠️ CRITICAL: SHOP OWNER'S SPECIFIC INSTRUCTION FOR THIS RESPONSE:\n"${input}"\n\n`;
    sb += "MANDATORY REQUIREMENT: The shop owner has provided a SPECIFIC message/question to send to the customer.\n";
    sb += "You MUST use this exact message as the BASE for all 3 response options.\n";
    sb += "All 3 responses must incorporate this guidance directly while varying only in tone:\n";
    sb += "- agree: Use the shop owner's message with a friendly, accommodating tone\n";
    sb += "- neutral: Use the shop owner's message with a professional, balanced tone\n";
    sb += "- apologize: Use the shop owner's message with an apologetic, empathetic tone\n";
    sb += "DO NOT ignore or significantly change the shop owner's message - it is the PRIMARY instruction.\n\n";
  }

  return sb;
}

/** Mirror CallGeminiAPI: gemini-3.5-flash (thinking tắt), JSON output. */
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

/** Mirror ProcessAIResponse: parse 3 đáp án + tag; fallback nếu thiếu field. */
export function processAIResponse(raw: string): AIResponse {
  try {
    const r = JSON.parse(raw) as {
      agree?: string;
      neutral?: string;
      apologize?: string;
      suggested_tag?: string;
      tag_reason?: string;
    };
    if (r.agree && r.neutral && r.apologize) {
      return {
        solutions: [],
        message: r.neutral,
        agree: r.agree,
        neutral: r.neutral,
        apologize: r.apologize,
        suggested_tag: r.suggested_tag ?? "",
        tag_reason: r.tag_reason ?? "",
      };
    }
  } catch {
    /* fall through tới fallback */
  }
  return {
    solutions: [],
    message: raw,
    agree: raw,
    neutral: raw,
    apologize: raw,
  };
}
