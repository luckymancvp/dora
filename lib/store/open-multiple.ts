/**
 * Luồng "mở nhiều hội thoại".
 *
 * Trang /open-multiple mở ở MỘT TAB TRÌNH DUYỆT RIÊNG (bảng điều khiển). Dữ liệu đi qua
 * localStorage vì sessionStorage không chia sẻ giữa các tab trình duyệt.
 *
 *  1. Panel dashboard → stage() → window.open("/open-multiple") (bảng điều khiển).
 *  2. Mỗi lần bấm "Mở N"/"Mở lẻ" trên bảng → writeBatch(token) + window.open("/messages?batch=token")
 *     thành MỘT TAB TRÌNH DUYỆT MỚI. Tab đó mở N hội thoại thành tab trong app (openMany).
 *     Bảng ở lại để đánh dấu hội thoại đã mở (reset được).
 */

/** 1 hội thoại cần mở (kèm meta để hiện tên/avatar/shop trên tab). */
export interface OpenEntry {
  id: number;
  name?: string;
  avatar?: string;
  shop?: string;
}

const STAGE_KEY = "messenger.openMultiple.v1";
const OPENED_KEY = "messenger.openedMarks.v1";
const BATCH_PREFIX = "messenger.batch.";
const SPLIT_KEY = "messenger.openMultiple.split.v1";

function read(key: string): OpenEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((e) => e && Number.isFinite(e.id));
    }
  } catch {
    /* ignore */
  }
  return [];
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function remove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Chặng 1: lưu danh sách để bảng /open-multiple hiển thị; reset đánh dấu cũ. */
export function stageOpenMultiple(entries: OpenEntry[]): void {
  write(STAGE_KEY, entries);
  remove(OPENED_KEY);
}
export function readStaged(): OpenEntry[] {
  return read(STAGE_KEY);
}
export function clearStaged(): void {
  remove(STAGE_KEY);
}

/** Chặng 2: handoff 1 đợt mở (token riêng) cho tab /messages mới nhặt rồi xoá. */
export function writeBatch(token: string, entries: OpenEntry[]): void {
  write(BATCH_PREFIX + token, entries);
}
export function readBatch(token: string): OpenEntry[] {
  return read(BATCH_PREFIX + token);
}
export function clearBatch(token: string): void {
  remove(BATCH_PREFIX + token);
}

/** Đánh dấu các hội thoại đã mở (để batch không mở lại). Reset = xoá. */
export function readOpenedIds(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(OPENED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((n) => Number.isFinite(n));
  } catch {
    /* ignore */
  }
  return [];
}
export function setOpenedIds(ids: number[]): void {
  write(OPENED_KEY, ids);
}
export function clearOpenedIds(): void {
  remove(OPENED_KEY);
}

/**
 * Tuỳ chọn "chia việc cho nhiều người" (lưu cục bộ mỗi máy).
 * `people` = tổng số người chia nhau; `part` = mình là người số mấy (1-based).
 * Vì danh sách hội thoại lấy từ cùng nguồn (dashboard) cho mọi user, chỉ cần
 * cắt theo thứ tự id cố định là mọi máy ra cùng các phần — không trùng, không sót.
 */
export interface SplitPref {
  people: number;
  part: number;
}

export function readSplit(): SplitPref {
  if (typeof window === "undefined") return { people: 1, part: 1 };
  try {
    const raw = localStorage.getItem(SPLIT_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      const people = Number.isFinite(p?.people) ? Math.max(1, Math.floor(p.people)) : 1;
      const part = Number.isFinite(p?.part) ? Math.floor(p.part) : 1;
      return { people, part: Math.min(Math.max(1, part), people) };
    }
  } catch {
    /* ignore */
  }
  return { people: 1, part: 1 };
}

export function writeSplit(pref: SplitPref): void {
  write(SPLIT_KEY, pref);
}

/** Cắt mảng thành `parts` phần liên tiếp gần đều nhau (phần đầu nhận phần dư). */
export function splitEven<T>(arr: T[], parts: number): T[][] {
  const n = Math.max(1, Math.floor(parts));
  const out: T[][] = [];
  const base = Math.floor(arr.length / n);
  const extra = arr.length % n;
  let start = 0;
  for (let i = 0; i < n; i++) {
    const size = base + (i < extra ? 1 : 0);
    out.push(arr.slice(start, start + size));
    start += size;
  }
  return out;
}

export { STAGE_KEY, OPENED_KEY };
