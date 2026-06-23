import {
  CONVERSATION_TAGS,
  callGeminiAPI,
  prepareDifyPrompt,
  processAIResponse,
  type PromptContext,
} from "@/lib/services/ai/chatgpt";
import { getConversationsCollection } from "@/lib/db/collections";
import { getConversationMessages } from "@/lib/services/message-read";
import { firstNumber, firstString } from "@/lib/services/etsy-utils";
import type { AIResponse, ConversationDoc } from "@/lib/types/etsy";

const AI_TAGS = new Set<string>(CONVERSATION_TAGS);

/**
 * Port của dora-backend conversation_service.CreateAIResponse.
 * Gemini primary → process → auto add/remove tag → lưu suggested_messages vào conversation.
 */
export async function createAIResponse(
  conversationId: number,
  input: string,
): Promise<AIResponse> {
  const convColl = await getConversationsCollection();
  const conv = (await convColl.findOne(
    { "etsy.conversation_id": conversationId },
    { projection: { "etsy.other_user": 1, "etsy.has_replied": 1, "user_data": 1 } },
  )) as ConversationDoc | null;
  if (!conv) throw new Error("conversation not found");

  const etsy = conv.etsy ?? {};
  const hasReplied = etsy["has_replied"] === true;
  // DORA: nếu không có guidance và shop đã trả lời → không sinh gợi ý (tránh tốn API vô ích).
  if (!input && hasReplied) {
    return { options: [] };
  }

  // Mock cho dev/UI (mirror MOCK_AI_RESPONSE của DORA).
  if (process.env.MOCK_AI_RESPONSE === "true") {
    const mock: AIResponse = {
      options: [
        { label: "Đề xuất giải pháp", text: "Yes, we'll take care of this for you right away!" },
        {
          label: "Hỏi thêm thông tin",
          text: "Thanks for reaching out — could you share a bit more detail so we can help?",
        },
        { label: "Trấn an & hẹn cập nhật", text: "We're so sorry about this. Let us make it right for you." },
      ],
      suggested_tag: "",
      tag_reason: "",
    };
    await saveSuggested(conversationId, mock);
    return mock;
  }

  // Lấy tối đa 40 tin gần nhất (asc), prompt chỉ dùng 8 tin cuối.
  const { items, shopUserId } = await getConversationMessages({ conversationId, limit: 40 });
  const customerId = firstNumber(conv, ["etsy.other_user.user_id"]) ?? 0;
  const customerName = firstString(conv, [
    "etsy.other_user.display_name",
    "etsy.other_user.name",
  ]);

  const ctx: PromptContext = {
    shopName: firstString(conv, ["user_data.shop_name"]),
    shopId: shopUserId,
    customerId,
    customerName,
    messages: items.map((m) => ({
      senderId: m.senderId,
      createDate: m.createDate,
      message: m.message,
    })),
  };

  const prompt = prepareDifyPrompt(ctx, input);
  const raw = await callGeminiAPI(prompt, input);
  const result = processAIResponse(raw);

  // Auto tag (mirror DORA): có tag → giữ đúng 1 AI tag; không → bỏ hết AI tag.
  if (result.suggested_tag && AI_TAGS.has(result.suggested_tag)) {
    await convColl.updateOne(
      { "etsy.conversation_id": conversationId },
      { $pull: { tags: { $in: [...AI_TAGS] } } },
    );
    await convColl.updateOne(
      { "etsy.conversation_id": conversationId },
      { $addToSet: { tags: result.suggested_tag }, $set: { updated_at: new Date() } },
    );
  } else {
    await convColl.updateOne(
      { "etsy.conversation_id": conversationId },
      { $pull: { tags: { $in: [...AI_TAGS] } } },
    );
  }

  await saveSuggested(conversationId, result);
  return result;
}

async function saveSuggested(conversationId: number, result: AIResponse): Promise<void> {
  const convColl = await getConversationsCollection();
  await convColl.updateOne(
    { "etsy.conversation_id": conversationId },
    { $set: { suggested_messages: result, updated_at: new Date() } },
  );
}
