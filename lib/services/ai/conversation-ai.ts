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
import {
  getOrderContextForConversation,
  formatOrdersForPrompt,
} from "@/lib/services/ai/order-context";
import { formatKnowledgeBaseForPrompt } from "@/lib/services/ai/knowledge-base";
import { getExamplesBlockForConversation } from "@/lib/services/ai/reply-examples";

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
        { label: "Trả lời thẳng", text: "Yes, we'll take care of this for you right away!" },
        {
          label: "Hỏi 1 câu nhanh",
          text: "Could you share a bit more detail so we can sort this out for you?",
        },
      ],
      suggested_tag: "",
      tag_reason: "",
    };
    await saveSuggested(conversationId, mock);
    return mock;
  }

  // Lấy tối đa 40 tin gần nhất (asc), prompt chỉ dùng 6 tin cuối.
  const t0 = Date.now();
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
      imageCount: Array.isArray(m.images) ? m.images.length : 0,
    })),
  };

  // GĐ1 grounding + GĐ2 few-shot: đơn hàng thật + chính sách + ví dụ trả lời thật.
  // Hai nguồn độc lập → chạy song song (examples còn gọi API embedding, tuần tự
  // từng cộng thẳng vào thời gian chờ của user).
  const [orders, examplesBlock] = await Promise.all([
    getOrderContextForConversation(customerId),
    getExamplesBlockForConversation(shopUserId, items),
  ]);
  const factsBlock = [
    formatOrdersForPrompt(orders),
    formatKnowledgeBaseForPrompt(),
    examplesBlock,
  ]
    .filter(Boolean)
    .join("\n\n");

  const tRetrieved = Date.now();
  const prompt = prepareDifyPrompt(ctx, input, factsBlock);
  const raw = await callGeminiAPI(prompt, input);
  const tGenerated = Date.now();
  const result = processAIResponse(raw);
  // Log breakdown để xác nhận tối ưu latency có tác dụng thật trên prod.
  console.log(
    `[ai] suggestion conv=${conversationId} retrieval=${tRetrieved - t0}ms gemini=${tGenerated - tRetrieved}ms total=${tGenerated - t0}ms`,
  );

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
