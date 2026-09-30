import { getUserPreferencesCollection } from "@/lib/db/collections";
import {
  PINNED_TAG_MAX_LENGTH,
  PINNED_TAGS_MAX,
  type UserPreferencesDoc,
} from "@/lib/types/user-preferences";

/** Lỗi nghiệp vụ tuỳ chọn người dùng (mang HTTP status để route trả đúng mã). */
export class PreferenceError extends Error {
  status: number;
  constructor(status: 400, message: string) {
    super(message);
    this.status = status;
  }
}

/** Đọc pinnedTags phòng thủ — doc cũ/ghi tay có thể thiếu field hoặc sai kiểu. */
function toPinnedTags(doc: Pick<UserPreferencesDoc, "pinnedTags"> | null | undefined): string[] {
  const raw: unknown = doc?.pinnedTags;
  return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : [];
}

/** Tag ghim của `email`; chưa có doc → []. */
export async function getPinnedTags(email: string): Promise<string[]> {
  const col = await getUserPreferencesCollection();
  const doc = await col.findOne({ email }, { projection: { pinnedTags: 1 } });
  return toPinnedTags(doc);
}

/**
 * Ghim / bỏ ghim 1 tag cho `email`, trả mảng SAU cập nhật.
 * Dùng $addToSet / $pull thay vì ghi đè cả mảng: bấm ghim 2 tag liên tiếp có thể tới server
 * sai thứ tự, ghi đè cả mảng sẽ làm mất 1 tag; 2 toán tử này giao hoán giữa các tag khác nhau.
 * Tag KHÔNG trim khi lưu — phải khớp y hệt TagOverviewRow.tag (giá trị DB); trim chỉ để
 * từ chối chuỗi rỗng/toàn khoảng trắng.
 */
export async function setTagPinned(email: string, body: unknown): Promise<string[]> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new PreferenceError(400, "body phải là JSON object");
  }
  const { tag, pinned } = body as { tag?: unknown; pinned?: unknown };
  if (typeof tag !== "string" || !tag.trim()) {
    throw new PreferenceError(400, "tag bắt buộc");
  }
  if (tag.length > PINNED_TAG_MAX_LENGTH) {
    throw new PreferenceError(400, `tag tối đa ${PINNED_TAG_MAX_LENGTH} ký tự`);
  }
  if (typeof pinned !== "boolean") {
    throw new PreferenceError(400, "pinned phải là boolean");
  }

  const col = await getUserPreferencesCollection();
  const now = new Date();

  if (!pinned) {
    // Bỏ ghim luôn được phép; không upsert — chưa có doc thì cũng chẳng có gì để bỏ.
    const doc = await col.findOneAndUpdate(
      { email },
      { $pull: { pinnedTags: tag }, $set: { updated_at: now } },
      { returnDocument: "after", projection: { pinnedTags: 1 } },
    );
    return toPinnedTags(doc);
  }

  // Chặn ghim MỚI khi đã đủ trần; ghim lại tag đã có không tính là vượt. Kiểm tra đọc-rồi-ghi
  // nên 2 lần ghim đồng thời sát trần có thể vượt 1 — chấp nhận (trần chỉ để chặn lạm dụng).
  const current = await getPinnedTags(email);
  if (!current.includes(tag) && current.length >= PINNED_TAGS_MAX) {
    throw new PreferenceError(400, `tối đa ${PINNED_TAGS_MAX} tag ghim`);
  }

  // Upsert theo email (index uq_email) — lần ghim đầu tiên tạo doc.
  const doc = await col.findOneAndUpdate(
    { email },
    { $addToSet: { pinnedTags: tag }, $set: { updated_at: now } },
    { upsert: true, returnDocument: "after", projection: { pinnedTags: 1 } },
  );
  return toPinnedTags(doc);
}
