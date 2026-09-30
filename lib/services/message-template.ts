import { ObjectId, type WithId } from "mongodb";
import { getMessageTemplatesCollection } from "@/lib/db/collections";
import type { MessageTemplate, MessageTemplateDoc } from "@/lib/types/etsy";

export const TEMPLATE_TITLE_MAX = 100;
export const TEMPLATE_CONTENT_MAX = 2000;

/** Lỗi nghiệp vụ mẫu câu (mang HTTP status + code để route trả đúng mã). */
export class TemplateError extends Error {
  status: number;
  code: "bad_request" | "not_found";
  constructor(status: 400 | 404, message: string) {
    super(message);
    this.status = status;
    this.code = status === 404 ? "not_found" : "bad_request";
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toDto(d: WithId<MessageTemplateDoc>): MessageTemplate {
  return {
    _id: d._id.toString(),
    email: d.email,
    title: d.title,
    content: d.content,
    created_at: d.created_at instanceof Date ? d.created_at.toISOString() : String(d.created_at ?? ""),
    updated_at: d.updated_at instanceof Date ? d.updated_at.toISOString() : String(d.updated_at ?? ""),
  };
}

function parseId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) throw new TemplateError(400, "invalid id");
  return new ObjectId(id);
}

function checkTitle(raw: unknown): string {
  const title = typeof raw === "string" ? raw.trim() : "";
  if (!title) throw new TemplateError(400, "title bắt buộc");
  if (title.length > TEMPLATE_TITLE_MAX) {
    throw new TemplateError(400, `title tối đa ${TEMPLATE_TITLE_MAX} ký tự`);
  }
  return title;
}

function checkContent(raw: unknown): string {
  const content = typeof raw === "string" ? raw.trim() : "";
  if (!content) throw new TemplateError(400, "content bắt buộc");
  if (content.length > TEMPLATE_CONTENT_MAX) {
    throw new TemplateError(400, `content tối đa ${TEMPLATE_CONTENT_MAX} ký tự`);
  }
  return content;
}

/**
 * Danh sách mẫu câu, mới nhất trước. scope "mine" chỉ lấy mẫu của `email` (so khớp chính xác),
 * scope khác = tất cả. `q` tìm trong title/content, không phân biệt hoa thường; được escape
 * nên ký tự đặc biệt ("(", "+", "?"…) tìm theo nghĩa đen, không làm vỡ regex.
 */
export async function listTemplates(opts: {
  scope: string;
  q: string;
  email: string;
}): Promise<MessageTemplate[]> {
  const filter: Record<string, unknown> = {};
  if (opts.scope === "mine") filter.email = opts.email;
  const q = opts.q.trim();
  if (q) {
    const rx = { $regex: escapeRegex(q), $options: "i" };
    filter.$or = [{ title: rx }, { content: rx }];
  }
  const col = await getMessageTemplatesCollection();
  const docs = await col.find(filter).sort({ created_at: -1 }).toArray();
  return docs.map((d) => toDto(d as WithId<MessageTemplateDoc>));
}

/** Tạo mẫu câu của `email`. title 1..100, content 1..2000 (sau trim). */
export async function createTemplate(
  email: string,
  input: { title?: unknown; content?: unknown },
): Promise<MessageTemplate> {
  const title = checkTitle(input.title);
  const content = checkContent(input.content);
  const now = new Date();
  const col = await getMessageTemplatesCollection();
  const doc: MessageTemplateDoc = { email, title, content, created_at: now, updated_at: now };
  const result = await col.insertOne(doc);
  return toDto({ ...doc, _id: result.insertedId });
}

/**
 * Sửa mẫu câu của chính `email`. Chỉ đổi field được gửi; field gửi lên không được rỗng
 * (trước đây PUT cho phép lưu title/content rỗng). Trả bản sau cập nhật; không có hoặc
 * không phải của mình → 404.
 */
export async function updateTemplate(
  id: string,
  email: string,
  input: { title?: unknown; content?: unknown },
): Promise<MessageTemplate> {
  const oid = parseId(id);
  const set: Partial<MessageTemplateDoc> = { updated_at: new Date() };
  if (input.title !== undefined) set.title = checkTitle(input.title);
  if (input.content !== undefined) set.content = checkContent(input.content);

  const col = await getMessageTemplatesCollection();
  const updated = await col.findOneAndUpdate(
    { _id: oid, email },
    { $set: set },
    { returnDocument: "after" },
  );
  if (!updated) throw new TemplateError(404, "not found");
  return toDto(updated as WithId<MessageTemplateDoc>);
}

/** Xoá mẫu câu của chính `email`; không có hoặc không phải của mình → 404. */
export async function deleteTemplate(id: string, email: string): Promise<void> {
  const oid = parseId(id);
  const col = await getMessageTemplatesCollection();
  const result = await col.deleteOne({ _id: oid, email });
  if (result.deletedCount === 0) throw new TemplateError(404, "not found");
}
