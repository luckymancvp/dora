import { randomUUID } from "crypto";
import type { WithId } from "mongodb";
import { getConversationsCollection } from "@/lib/db/collections";
import { getUsersByEmail } from "@/lib/services/message-read";
import type { ConversationDoc, NoteEntry, NoteItem, NotesResponse } from "@/lib/types/etsy";

/** Lỗi nghiệp vụ note (mang theo HTTP status để route trả đúng mã). */
export class NoteError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const toUnixSeconds = (d: Date | undefined): number =>
  d instanceof Date ? Math.floor(d.getTime() / 1000) : 0;

function mapNote(
  e: NoteEntry,
  currentEmail: string,
  users: Map<string, { name: string; image: string }>,
): NoteItem {
  const u = users.get(e.authorEmail);
  return {
    id: e.id,
    body: e.body,
    authorEmail: e.authorEmail,
    authorName: u?.name || (e.authorEmail ? e.authorEmail.split("@")[0] : ""),
    authorAvatar: u?.image ?? "",
    createdAt: toUnixSeconds(e.createdAt),
    updatedAt: toUnixSeconds(e.updatedAt),
    mine: e.authorEmail === currentEmail,
  };
}

/** Lấy danh sách ghi chú của 1 hội thoại, mới nhất trước, đã join tên/avatar tác giả. */
export async function getNotes(
  conversationId: number,
  currentEmail: string,
): Promise<NotesResponse> {
  const coll = await getConversationsCollection();
  const doc = (await coll.findOne(
    { "etsy.conversation_id": conversationId },
    { projection: { notes: 1 } },
  )) as WithId<ConversationDoc> | null;

  const entries = Array.isArray(doc?.notes) ? doc!.notes : [];
  const emails = [...new Set(entries.map((e) => e.authorEmail).filter(Boolean))];
  const users = await getUsersByEmail(emails);

  const items = entries
    .map((e) => mapNote(e, currentEmail, users))
    .sort((a, b) => b.createdAt - a.createdAt);

  return { conversationId, items };
}

/** Thêm 1 ghi chú mới. Trả về NoteItem vừa tạo. */
export async function addNote(
  conversationId: number,
  email: string,
  body: string,
): Promise<NoteItem> {
  const text = body.trim();
  if (!text) throw new NoteError(400, "empty note");

  const now = new Date();
  const entry: NoteEntry = {
    id: randomUUID(),
    authorEmail: email,
    body: text,
    createdAt: now,
    updatedAt: now,
  };

  const coll = await getConversationsCollection();
  const res = await coll.updateOne(
    { "etsy.conversation_id": conversationId },
    { $push: { notes: entry } },
  );
  if (res.matchedCount === 0) throw new NoteError(404, "conversation not found");

  const users = await getUsersByEmail([email]);
  return mapNote(entry, email, users);
}

/** Sửa note của chính mình. */
export async function editNote(
  conversationId: number,
  noteId: string,
  email: string,
  body: string,
): Promise<NoteItem> {
  const text = body.trim();
  if (!text) throw new NoteError(400, "empty note");

  const now = new Date();
  const coll = await getConversationsCollection();
  const res = await coll.updateOne(
    {
      "etsy.conversation_id": conversationId,
      notes: { $elemMatch: { id: noteId, authorEmail: email } },
    },
    { $set: { "notes.$.body": text, "notes.$.updatedAt": now } },
  );
  if (res.matchedCount === 0) throw new NoteError(404, "note not found or not owner");

  // Đọc lại đúng note vừa sửa để trả createdAt THẬT (trước đây trả createdAt = now,
  // làm UI thấy note "mới tạo" sau mỗi lần sửa cho tới khi refetch).
  const doc = (await coll.findOne(
    { "etsy.conversation_id": conversationId, "notes.id": noteId },
    { projection: { "notes.$": 1 } },
  )) as WithId<ConversationDoc> | null;
  const saved = Array.isArray(doc?.notes) ? doc!.notes[0] : undefined;

  const users = await getUsersByEmail([email]);
  return mapNote(
    {
      id: noteId,
      authorEmail: email,
      body: text,
      createdAt: saved?.createdAt ?? now,
      updatedAt: now,
    },
    email,
    users,
  );
}

/** Xoá note của chính mình. */
export async function deleteNote(
  conversationId: number,
  noteId: string,
  email: string,
): Promise<void> {
  const coll = await getConversationsCollection();
  const res = await coll.updateOne(
    { "etsy.conversation_id": conversationId },
    { $pull: { notes: { id: noteId, authorEmail: email } } },
  );
  if (res.modifiedCount === 0) throw new NoteError(404, "note not found or not owner");
}
