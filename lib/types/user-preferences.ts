import type { ObjectId } from "mongodb";

/**
 * Collection `user_preferences` (DB meta_local) — tuỳ chọn riêng từng người dùng, 1 doc / email.
 * Hiện chỉ dùng cho tag ghim ở panel "Tổng quan theo Tag" (Dashboard).
 */
export interface UserPreferencesDoc {
  _id?: ObjectId;
  /** session.user.email — unique. */
  email: string;
  /** Tên tag đã ghim (giá trị lưu DB của tag, KHÔNG phải nhãn hiển thị). Có thể chứa UNTAGGED_PIN_KEY. */
  pinnedTags: string[];
  updated_at: Date;
}

/** Khoá ghim đại diện cho dòng "No Tag" (TagOverviewRow.untagged === true). */
export const UNTAGGED_PIN_KEY = "__untagged__";

/** Độ dài tối đa 1 khoá ghim (tag) chấp nhận ở API. */
export const PINNED_TAG_MAX_LENGTH = 100;

/** Số tag ghim tối đa mỗi người dùng. */
export const PINNED_TAGS_MAX = 100;

/** Phản hồi GET + PATCH /api/me/pinned-tags. */
export interface PinnedTagsResponse {
  pinnedTags: string[];
}

/** Body PATCH /api/me/pinned-tags — ghim/bỏ ghim 1 tag (thao tác nguyên tử, không ghi đè cả mảng). */
export interface PinTagBody {
  /** Tên tag (TagOverviewRow.tag) hoặc UNTAGGED_PIN_KEY cho dòng "No Tag". */
  tag: string;
  pinned: boolean;
}
