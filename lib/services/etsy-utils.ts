import type { EtsyRaw } from "@/lib/types/etsy";

/** Ép kiểu an toàn từ payload Etsy (số có thể là number hoặc chuỗi số). */
export function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return undefined;
}

export function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Giải mã HTML entity trong text Etsy (vd "&#39;" -> "'", "&amp;" -> "&"). */
export function decodeHtmlEntities(s: string): string {
  if (!s) return s;
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * Chuyển thẻ <br> / <br/> / <br /> (Etsy/template chèn) thành 1 newline, nuốt luôn
 * newline thật theo sau để tránh nhân đôi dòng. Render text thuần (whitespace-pre-line)
 * sẽ xuống dòng đúng thay vì hiện "<br />".
 */
export function brToNewline(s: string): string {
  if (!s) return s;
  return s.replace(/<br\s*\/?>\r?\n?/gi, "\n");
}

export function isObject(v: unknown): v is EtsyRaw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Lấy message cuối cùng trong etsy.detail.messages (mảng Etsy). */
export function getLastMessage(etsy: EtsyRaw): EtsyRaw | undefined {
  const detail = etsy["detail"];
  if (!isObject(detail)) return undefined;
  const messages = detail["messages"];
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  const last = messages[messages.length - 1];
  return isObject(last) ? last : undefined;
}

/** Truy cập field lồng nhau theo path "a.b.c"; trả undefined nếu đứt. */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (!isObject(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Lấy giá trị string đầu tiên không rỗng theo danh sách path. */
export function firstString(obj: unknown, paths: string[]): string {
  for (const p of paths) {
    const v = getPath(obj, p);
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return "";
}

/** Lấy số đầu tiên hợp lệ theo danh sách path. */
export function firstNumber(obj: unknown, paths: string[]): number | undefined {
  for (const p of paths) {
    const n = asNumber(getPath(obj, p));
    if (n !== undefined) return n;
  }
  return undefined;
}

/** lastMessageDate = create_date của message cuối cùng. */
export function extractLastMessageDate(etsy: EtsyRaw): number {
  const last = getLastMessage(etsy);
  if (!last) return 0;
  return asNumber(last["create_date"]) ?? 0;
}
