import type { ObjectId } from "mongodb";

/**
 * Cấu hình 1 Google Spreadsheet được kết nối (collection `sheet_configs`).
 * Mỗi sheet là 1 "Order sheet": mỗi dòng = 1 item, key là cột "Item ID" = prefix-receipt-transaction.
 */
/** 1 dòng tab Prefix: cột A = tên store, cột B = tiền tố order id (vd "IRS-"). */
export interface SheetPrefixEntry {
  store: string;
  /** Giữ NGUYÊN VĂN kể cả dấu gạch cuối ("IRS-") — dấu gạch là thứ tách "IRC-" khỏi "IRCI-". */
  prefix: string;
}

export interface SheetConfigDoc {
  _id?: ObjectId;
  spreadsheetId: string;
  /** Tên spreadsheet (lấy từ Google khi thêm). */
  title: string;
  spreadsheetUrl: string;
  /** Tab chứa dữ liệu đơn (vd "Order"). */
  dataTabName: string;
  /** Tab map store→prefix (cột A store, cột B prefix). Mặc định "Prefix". */
  prefixTabName: string;
  /** Store thuộc sheet này (auto từ tab Prefix cột A) — gợi ý ưu tiên dò trước. */
  shopNames: string[];
  /**
   * Map tiền tố → store, auto từ tab Prefix (cột A Store, cột B Prefix).
   * Dùng để định tuyến 1 order id CÓ TIỀN TỐ (vd `IRS-4167469772`) về ĐÚNG sheet/store
   * khi tra status — file của bên gia công gộp đơn của nhiều shop trong cùng 1 file.
   */
  prefixes?: SheetPrefixEntry[];
  /** Tuỳ chọn Status fallback nếu không đọc được data-validation của cột Status. */
  statusOptions?: string[];
  ownerEmail: string;
  enabled: boolean;
  /** Thứ tự ưu tiên fallback (nhỏ = dò trước). */
  order: number;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  rowCount: number;
  syncing: boolean;
  /** Thời điểm chiếm cờ syncing lần gần nhất — để phát hiện & chiếm lại khoá "treo". */
  syncStartedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Bản chỉ mục 1 dòng item của 1 sheet (collection `sheet_rows`).
 * Đồng bộ định kỳ từ Google Sheet để tra cứu tức thì, an toàn quota.
 */
export interface SheetRowDoc {
  _id?: ObjectId;
  configId: ObjectId;
  spreadsheetId: string;
  dataTabName: string;
  /** Giá trị cột "Item ID" (đã trim). */
  itemId: string;
  /** "{receiptId}-{transactionId}" suy ra từ đuôi itemId — khoá tra cứu theo item (prefix-independent). */
  receiptTxKey: string;
  /** "{receiptId}" — khoá tra cứu theo đơn (1 đơn có thể nhiều dòng/transaction). */
  receiptKey: string;
  /** Cột "Order" = prefix-receipt (nếu có). */
  order: string;
  /** Số dòng 1-based trong sheet (gồm header). */
  rowNumber: number;
  store: string;
  /** Map header → value (toàn bộ cột để hiển thị/sửa). */
  values: Record<string, string>;
  syncedAt: Date;
}

// ---- DTO cho client ----

export interface SheetConfigDTO {
  id: string;
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  dataTabName: string;
  prefixTabName: string;
  shopNames: string[];
  statusOptions: string[];
  enabled: boolean;
  order: number;
  /** unix seconds; null nếu chưa sync. */
  lastSyncedAt: number | null;
  lastSyncError: string | null;
  rowCount: number;
  syncing: boolean;
}

/** 1 dòng khớp đơn hàng để hiển thị/sửa trong panel. */
export interface OrderRowMatch {
  configId: string;
  spreadsheetId: string;
  spreadsheetTitle: string;
  spreadsheetUrl: string;
  dataTabName: string;
  rowNumber: number;
  itemId: string;
  store: string;
  headers: string[];
  values: Record<string, string>;
}

/** Lý do không tìm thấy (để UI hiển thị thông điệp phù hợp). */
export type ResolveReason = "no_configs" | "row_not_found" | null;

export interface ResolveOrderResponse {
  matches: OrderRowMatch[];
  reason: ResolveReason;
}

export interface GoogleStatus {
  /** Có refresh_token để gọi Sheets nền. */
  connected: boolean;
  /** Đã cấp scope spreadsheets. */
  scopeOk: boolean;
  email: string | null;
}

/** Header các cột mặc định cho phép sửa từ panel (khớp theo tên header). */
export const EDITABLE_SHEET_FIELDS = [
  "Status",
  "Order Note",
  "Personalization",
  "Customer Image",
  "Design",
  "Mockup",
] as const;

// ---- Định tuyến order id có tiền tố → store/sheet ----

/** 1 tiền tố đã đăng ký, kèm sheet chứa nó (dựng từ `prefixes` của mọi config đang bật). */
export interface PrefixRoute<TConfigId = string> {
  configId: TConfigId;
  store: string;
  /** Tiền tố NGUYÊN VĂN từ tab Prefix (vd "IRS-"); so khớp qua `orderIdPrefix`. */
  prefix: string;
}

/**
 * Chuẩn hoá order id về SỐ ĐƠN: lấy cụm số DÀI NHẤT (hoà thì lấy cụm trái nhất).
 *
 * KHÔNG lấy cụm cuối: order id thật có hậu tố (`IR#200757R1`, `IRC-4118353972R1`) nên cụm
 * cuối là "1" — mọi dòng đổ về cùng một id.
 *   4078744073 → 4078744073 | IRS-4167469772 → 4167469772
 *   IR#200757R1 → 200757     | IRC-4118353972R1 → 4118353972
 * Rỗng nếu không có chữ số nào.
 */
export function normalizeOrderId(raw: string): string {
  const matches = raw.trim().match(/\d+/g);
  if (!matches) return "";
  let best = matches[0];
  for (const m of matches) if (m.length > best.length) best = m;
  return best;
}

/**
 * Cắt phần TIỀN TỐ của 1 order id (hoặc chuẩn hoá 1 tiền tố đã đăng ký về cùng dạng).
 * Cắt tại dấu tách đầu tiên (`- # _ / \` khoảng trắng); không có dấu tách thì cắt tại chữ số đầu.
 *   IRS-4167469772 → IRS | IRCI-4167530170 → IRCI | IR#200757R1 → IR
 *   IRS4167469772  → IRS | 4078744073      → ""   | "IRS-" (đã đăng ký) → IRS
 */
export function orderIdPrefix(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (!s) return "";
  const sep = s.search(/[-#_/\\\s.:|]/);
  if (sep >= 0) return s.slice(0, sep);
  const digit = s.search(/\d/);
  return digit >= 0 ? s.slice(0, digit) : s;
}

/**
 * Tìm route cho 1 order id NGUYÊN VĂN (vd `IRS-4167469772`).
 *
 * So tiền tố KHỚP TUYỆT ĐỐI, không phải `startsWith`: cắt phần tiền tố của order id rồi so
 * bằng đúng với tiền tố đã đăng ký (cũng đã cắt về cùng dạng). Nhờ vậy `IR` KHÔNG khớp `IRCI`,
 * và `IRC` không khớp `IRCI` — dùng startsWith thì một tiền tố ngắn sẽ nuốt các tiền tố dài hơn
 * và định tuyến sai shop.
 * Nhiều sheet đăng ký trùng tiền tố → sheet có `order` nhỏ hơn thắng (caller truyền theo thứ tự đó).
 * null khi order id không mang tiền tố nào đã đăng ký (caller tự fallback dò mọi sheet).
 */
export function resolvePrefixRoute<T>(
  rawOrderId: string,
  routes: PrefixRoute<T>[],
): PrefixRoute<T> | null {
  const want = orderIdPrefix(rawOrderId);
  if (!want) return null;
  for (const r of routes) {
    if (r.prefix && orderIdPrefix(r.prefix) === want) return r;
  }
  return null;
}

/**
 * Khoá đối chiếu với cột "Order" của sheet (= `prefix-receipt`, vd `IRC-4118353972`).
 *
 * Dựng từ TIỀN TỐ + SỐ ĐƠN nên bỏ được hậu tố và khác biệt dấu tách giữa hai nguồn:
 *   file `IRC-4118353972R1` → "IRC-4118353972"
 *   sheet `IRC-4118353972`  → "IRC-4118353972"   ⇒ khớp
 * Order id không có tiền tố → chỉ còn số đơn (khớp theo receipt như cũ).
 */
export function canonicalOrderKey(raw: string): string {
  const num = normalizeOrderId(raw);
  if (!num) return "";
  const prefix = orderIdPrefix(raw);
  return prefix ? `${prefix}-${num}` : num;
}
