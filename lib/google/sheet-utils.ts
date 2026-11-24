import "server-only";

/** Lấy spreadsheetId từ URL Google Sheet, hoặc trả về nguyên chuỗi nếu đã là ID. */
export function extractSpreadsheetId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  // URL dạng .../spreadsheets/d/{ID}/edit...
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  // Chấp nhận ID thuần (không có ký tự lạ).
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
  return null;
}

/** Chỉ số cột (0-based) → chữ cái A1 (0→A, 25→Z, 26→AA, ...). */
export function colToA1(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** Chuẩn hoá header để so khớp không phân biệt hoa/thường, thừa khoảng trắng. */
function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Tìm chỉ số cột theo tên header (trim, case-insensitive). Bỏ qua header rỗng;
 * lấy cột non-empty đầu tiên khớp. Trả -1 nếu không có.
 */
export function findHeaderIndex(headers: string[], name: string): number {
  const target = normHeader(name);
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (!h || !h.trim()) continue;
    if (normHeader(h) === target) return i;
  }
  return -1;
}

/** Chuẩn hoá tên store để so khớp (trim/lowercase/gộp khoảng trắng). */
export function normalizeStore(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Suy ra khoá "{receiptId}-{transactionId}" từ Item ID = prefix-receipt-transaction.
 * Lấy 2 đoạn số ở cuối (prefix-independent, kể cả prefix có dấu gạch). Null nếu không hợp lệ.
 *
 * Item ID có hậu tố thứ tự (đơn gửi lại/tách dòng: "DAC-4178988384-5222400436-1") thì bỏ hậu tố
 * trước — nếu không sẽ lấy nhầm transaction làm receipt và dòng đó không gắn được vào đơn nào.
 * Chỉ bỏ khi hai đoạn đứng trước đều là id dài (≥9 chữ số), để "PRO-3881349513-1" giữ nguyên.
 */
export function deriveReceiptTxKey(itemId: string): string | null {
  const parts = itemId.trim().split("-").filter((p) => p !== "");
  const isLongId = (p: string | undefined) => !!p && /^\d{9,}$/.test(p);
  if (
    parts.length >= 3 &&
    /^\d{1,4}$/.test(parts[parts.length - 1]) &&
    isLongId(parts[parts.length - 2]) &&
    isLongId(parts[parts.length - 3])
  ) {
    parts.pop();
  }
  if (parts.length < 2) return null;
  const tx = parts[parts.length - 1];
  const receipt = parts[parts.length - 2];
  if (!/^\d+$/.test(tx) || !/^\d+$/.test(receipt)) return null;
  return `${receipt}-${tx}`;
}

/** Khoá tra cứu từ dữ liệu Etsy. */
export function receiptTxKey(receiptId: number, transactionId: number): string {
  return `${receiptId}-${transactionId}`;
}
