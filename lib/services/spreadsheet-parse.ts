import ExcelJS from "exceljs";
import { IMPORT_MAX_ROWS } from "@/lib/types/tracking-import";

/**
 * Parse file bảng tính (.csv/.tsv/.txt và .xlsx/.xlsm) → ma trận ô string.
 *
 * Module THUẦN: không chạm Mongo/Google/Mera nên chạy & test được độc lập.
 * Tầng nghiệp vụ (tracking-import.ts) mới ghép thêm tra Sheet/Mera.
 */

/** Lỗi file không đọc được (mang HTTP status cho errorResponse). */
export class SpreadsheetParseError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Đoán ký tự phân cách của CSV: cái nào xuất hiện nhiều nhất ở dòng đầu (ngoài dấu nháy). */
function detectDelimiter(firstLine: string): string {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = -1;
  for (const d of candidates) {
    let count = 0;
    let quoted = false;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === d) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/**
 * Parse CSV theo RFC 4180: hỗ trợ ô có dấu nháy kép, dấu phân cách/xuống dòng bên trong nháy,
 * escape `""`, và CRLF. Tự đoán delimiter (`,` `;` tab `|`) từ dòng đầu.
 */
export function parseCsv(text: string): string[][] {
  // Bỏ BOM (Excel xuất CSV UTF-8 luôn kèm) để header đầu tiên không dính ký tự lạ.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstBreak = src.search(/\r?\n/);
  const delim = detectDelimiter(firstBreak < 0 ? src : src.slice(0, firstBreak));

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (quoted) {
      if (ch === '"') {
        // `""` bên trong ô = một dấu nháy literal; nháy đơn lẻ = đóng ô.
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      // Nuốt \n của cặp \r\n để không sinh dòng rỗng.
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  // Ô/dòng cuối chưa kết thúc bằng newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Giá trị 1 ô exceljs → string hiển thị (ô có thể là rich text / formula / hyperlink / date). */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();

  const v = value as Record<string, unknown>;
  // Formula: ưu tiên kết quả đã tính (`result`), không phải công thức.
  if ("result" in v) return cellText(v.result);
  // Hyperlink: lấy chữ hiển thị, không lấy URL.
  if ("text" in v) return cellText(v.text);
  // Rich text: nối các đoạn RỒI mới trim — trim từng đoạn sẽ nuốt khoảng trắng giữa các đoạn
  // ("Royal " + "Mail" → "RoyalMail").
  if (Array.isArray(v.richText)) {
    return (v.richText as { text?: unknown }[])
      .map((r) => (typeof r.text === "string" ? r.text : cellText(r.text)))
      .join("")
      .trim();
  }
  if ("error" in v) return "";
  return "";
}

export async function parseXlsx(buffer: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new SpreadsheetParseError(
      400,
      "Không đọc được file XLSX (file hỏng hoặc sai định dạng)",
    );
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new SpreadsheetParseError(400, "File XLSX không có sheet nào");

  const rows: string[][] = [];
  // eachRow bỏ qua dòng trống → dùng vòng lặp theo số dòng để giữ ĐÚNG chỉ số dòng của file
  // (người dùng đối chiếu "dòng 12" trong Excel).
  const rowCount = Math.min(ws.rowCount, IMPORT_MAX_ROWS + 1);
  const colCount = ws.columnCount;
  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= colCount; c++) cells.push(cellText(row.getCell(c).value));
    rows.push(cells);
  }
  return rows;
}

/** Bỏ các dòng rỗng ở CUỐI (file xuất thường thừa vài trăm dòng trắng). */
export function trimTrailingBlankRows(rows: string[][]): string[][] {
  let end = rows.length;
  while (end > 0 && rows[end - 1].every((c) => !c.trim())) end--;
  return rows.slice(0, end);
}

/**
 * Đọc file theo đuôi tên → ma trận ô (chưa bỏ dòng header, chưa cắt IMPORT_MAX_ROWS).
 * `.xls` cũ (BIFF nhị phân) exceljs không đọc được → báo rõ thay vì lỗi parse khó hiểu.
 */
export async function parseSpreadsheet(fileName: string, buffer: Buffer): Promise<string[][]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) return parseXlsx(buffer);
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) {
    return parseCsv(buffer.toString("utf8"));
  }
  throw new SpreadsheetParseError(
    400,
    "Chỉ hỗ trợ file .csv hoặc .xlsx (file .xls cũ hãy lưu lại thành .xlsx)",
  );
}
