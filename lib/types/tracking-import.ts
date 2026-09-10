import type { ObjectId } from "mongodb";

/**
 * Import tracking từ file CSV/XLSX cho trang /tracking.
 *
 * Luồng 3 bước (1 lần upload duy nhất):
 *   1) POST /api/tracking/import/preview  (multipart file)
 *        → ImportPreviewResponse: ma trận ô + cột + profile tự nhận diện
 *   2) FE map cột theo profile NGAY TẠI CLIENT (đổi profile không cần upload lại);
 *      dòng 1 luôn là tiêu đề và luôn bị bỏ
 *   3) POST /api/tracking/import/check    (JSON các dòng đã map)
 *        → ImportCheckResponse: tra Sheet (ưu tiên) → Mera, đánh dấu đơn PROCESSING
 *
 * Contract CHUNG cho cả 4 tầng: service → route json() → hook cast → component đọc.
 */

// ---- Cấu hình map cột theo nguồn file (vd Printbell) ----

/**
 * 1 profile = 1 bên cung cấp file. Collection `tracking_import_profiles`.
 * Cột lưu bằng chữ cái A1 ("A", "B", "AC") — bền hơn tên header vì file xuất
 * từ cùng một bên luôn giữ nguyên vị trí cột dù header đổi chữ.
 */
export interface TrackingImportProfileDoc {
  _id?: ObjectId;
  /** Tên nguồn, vd "Printbell". Unique (case-insensitive qua nameKey). */
  name: string;
  /** name.trim().toLowerCase() — khoá unique để chặn trùng tên. */
  nameKey: string;
  /** Chữ cái cột A1 chứa order id (bắt buộc). */
  orderIdColumn: string;
  /** Chữ cái cột A1 chứa tracking number (bắt buộc). */
  trackingColumn: string;
  /** Chữ cái cột A1 chứa carrier. Rỗng = suy carrier từ số tracking theo `carrier_rules`. */
  carrierColumn: string;
  /**
   * Header đã chuẩn hoá của file mẫu lúc lưu profile — dùng auto-detect lần sau
   * ("import đúng bên là tự nhận luôn"). Rỗng nếu file mẫu không có header.
   */
  signature: string[];
  ownerEmail: string;
  createdAt: Date;
  updatedAt: Date;
}

/** DTO gửi client (ngày → ISO string). */
export interface TrackingImportProfileDTO {
  id: string;
  name: string;
  orderIdColumn: string;
  trackingColumn: string;
  carrierColumn: string;
  signature: string[];
  createdAt: string;
  updatedAt: string;
}

/** Body POST /api/tracking/import/profiles và PATCH .../[id] (PATCH: mọi field optional). */
export interface TrackingImportProfileInput {
  name: string;
  orderIdColumn: string;
  trackingColumn: string;
  carrierColumn: string;
  signature: string[];
}

// ---- Bước 1: parse file ----

/** 1 cột của file đã parse — đủ để người dùng chọn cột nào là order id/tracking/carrier. */
export interface ImportColumn {
  /** Chữ cái A1: "A", "B", … (khoá lưu trong profile). */
  key: string;
  /** Text ở dòng header (rỗng nếu không có header). */
  header: string;
  /** Vài giá trị đầu (tối đa 3) để người dùng nhận diện cột. */
  samples: string[];
}

/** Trần an toàn khi parse — file lớn hơn bị cắt và báo `truncated`. */
export const IMPORT_MAX_ROWS = 5000;
/** Trần dung lượng file upload (bytes). */
export const IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface ImportPreviewResponse {
  fileName: string;
  columns: ImportColumn[];
  /**
   * Toàn bộ ô đã parse, LUÔN kèm dòng 1 (tiêu đề) — cần nó để mô tả cột + học signature.
   * FE bỏ dòng 1 khi map dữ liệu. Mỗi phần tử là 1 dòng, ô là string.
   */
  rows: string[][];
  /** Tổng dòng đọc được (= rows.length). */
  rowCount: number;
  /** true nếu file vượt IMPORT_MAX_ROWS và đã bị cắt. */
  truncated: boolean;
  /** Profile khớp signature tốt nhất → FE chọn sẵn. null nếu không đủ tin cậy. */
  matchedProfileId: string | null;
}

// ---- Bước 2: dòng đã map cột (client → server) ----

export interface ImportMappedRow {
  /** Số dòng 1-based trong file (tính cả dòng tiêu đề) — để người dùng đối chiếu. */
  rowNumber: number;
  order_id: string;
  tracking_number: string;
  /**
   * Carrier ĐỌC THẲNG TỪ Ô trong file — rỗng nếu nguồn không có cột carrier / ô trống.
   * Server mới chốt: ô trong file → quy tắc theo số tracking. Không suy được thì BỎ QUA dòng đó.
   */
  carrier: string;
}

/** Body POST /api/tracking/import/check. */
export interface ImportCheckRequest {
  /**
   * Gợi ý shop để ưu tiên dò sheet nào trước — KHÔNG bắt buộc.
   * Store thật của từng dòng suy từ tiền tố order id (tab "Prefix"), nên import không cần
   * biết trước shop: kết quả tự phân loại theo shop.
   */
  shopName?: string;
  rows: ImportMappedRow[];
}

/** Các đơn đã lọc PROCESSING, gom theo shop (suy từ tiền tố) để dựng khối shop tự động. */
export interface ImportStoreGroup {
  /** Tên store từ tab Prefix. Rỗng = không suy được shop (order id không có tiền tố đã đăng ký). */
  store: string;
  rows: ImportCheckedRow[];
}

/**
 * Đếm số dòng theo từng lý do bỏ qua, nhiều nhất trước — để trả lời "vì sao chỉ N đơn add được"
 * mà không phải cuộn hết bảng vài nghìn dòng.
 */
export function countSkipReasons(
  rows: ImportCheckedRow[],
): { reason: ImportSkipReason; count: number; statuses: string[] }[] {
  const byReason = new Map<ImportSkipReason, { count: number; statuses: Set<string> }>();
  for (const r of rows) {
    if (!r.reason) continue;
    const e = byReason.get(r.reason) ?? { count: 0, statuses: new Set<string>() };
    e.count++;
    // Với nhóm "trạng thái khác", chính các status mới là thông tin cần thấy.
    if (r.reason === "status") for (const st of r.statuses) e.statuses.add(st);
    byReason.set(r.reason, e);
  }
  return [...byReason.entries()]
    .map(([reason, e]) => ({ reason, count: e.count, statuses: [...e.statuses].sort() }))
    .sort((a, b) => b.count - a.count);
}

/** Gom các dòng ELIGIBLE theo store, shop suy được xếp trước, nhóm "chưa rõ" xuống cuối. */
export function groupEligibleByStore(rows: ImportCheckedRow[]): ImportStoreGroup[] {
  const byStore = new Map<string, ImportCheckedRow[]>();
  for (const r of rows) {
    if (r.state !== "ELIGIBLE") continue;
    const key = r.store.trim();
    const list = byStore.get(key);
    if (list) list.push(r);
    else byStore.set(key, [r]);
  }
  return [...byStore.entries()]
    .map(([store, rs]) => ({ store, rows: rs }))
    .sort((a, b) => {
      // Nhóm không rõ shop xuống cuối (người dùng phải tự chọn shop cho nó).
      if (!a.store !== !b.store) return a.store ? -1 : 1;
      return a.store.localeCompare(b.store);
    });
}

// ---- Bước 3: tra status ----

/**
 * Kết luận cho 1 dòng:
 * - ELIGIBLE       : tra được status PROCESSING → cho phép add tracking
 * - SKIPPED_STATUS : tra được status nhưng KHÁC PROCESSING → bỏ qua
 * - NOT_FOUND      : không thấy đơn ở cả Sheet lẫn Mera → bỏ qua
 * - INVALID        : thiếu order id / tracking, hoặc order id trùng trong file
 */
export type ImportRowState = "ELIGIBLE" | "SKIPPED_STATUS" | "NOT_FOUND" | "INVALID";

/** Nguồn tra được status. null khi NOT_FOUND/INVALID. */
export type ImportStatusSource = "sheet" | "mera" | null;

/**
 * Carrier cuối cùng đến từ đâu — hiện trên bảng kết quả để người dùng biết dòng nào
 * do quy tắc suy ra (và sửa quy tắc nếu suy sai) thay vì đọc trong file.
 */
export type ImportCarrierSource = "file" | "rule" | "none";

/**
 * Mã lý do BỎ QUA, ổn định để gom nhóm thống kê (message là câu chữ có kèm số dòng nên
 * không gom được). "" = dòng sẽ add.
 */
export type ImportSkipReason =
  | ""
  | "missing_field"
  | "duplicate"
  | "no_carrier"
  | "status"
  | "no_status"
  | "not_found";

export const IMPORT_SKIP_REASON_LABEL: Record<ImportSkipReason, string> = {
  "": "Sẽ add",
  missing_field: "Thiếu Order ID hoặc Tracking trong file",
  duplicate: "Trùng đơn — đã có ở dòng trên",
  no_carrier: "Không suy được carrier (thiếu quy tắc)",
  status: "Trạng thái khác PROCESSING",
  no_status: "Có đơn nhưng cột Status trống",
  not_found: "Không thấy đơn ở Sheet lẫn Mera",
};

export interface ImportCheckedRow extends ImportMappedRow {
  /** Mã lý do bỏ qua để gom nhóm thống kê. */
  reason: ImportSkipReason;
  /** order id nguyên văn trong file (giữ để hiển thị khi đã chuẩn hoá về receipt id). */
  raw_order_id: string;
  /** Nguồn của `carrier` (đã là giá trị CUỐI, không phải ô gốc). */
  carrierSource: ImportCarrierSource;
  /** id quy tắc đã khớp khi carrierSource = "rule" (rỗng nếu khác). */
  carrierRule: string;
  /**
   * Shop suy từ TIỀN TỐ order id (tab "Prefix" của sheet, vd `IRS-` → HeartstringsMementos).
   * Rỗng nếu order id không mang tiền tố nào đã đăng ký. Hiện lên UI để đối chiếu với shop
   * của khối — tracking chỉ add được lên đúng shop sở hữu đơn.
   */
  store: string;
  state: ImportRowState;
  source: ImportStatusSource;
  /** Các status phân biệt tìm được (1 đơn có thể nhiều dòng sheet / nhiều item Mera). */
  statuses: string[];
  /** Lý do bỏ qua (hiển thị nguyên văn ở cột "Kết quả"). */
  message: string;
}

export interface ImportCheckCounts {
  total: number;
  eligible: number;
  skippedStatus: number;
  notFound: number;
  invalid: number;
}

export interface ImportCheckResponse {
  rows: ImportCheckedRow[];
  counts: ImportCheckCounts;
  /** true nếu chưa cấu hình Mera (env) — UI báo "chỉ tra được Sheet". */
  meraUnavailable: boolean;
}

// ---- Helper dùng chung 2 phía (không import server-only) ----

/** Status duy nhất được phép add tracking. */
export const PROCESSING_STATUS = "PROCESSING";

/** Chuẩn hoá status để so khớp: trim, gộp khoảng trắng, viết hoa. */
export function normalizeStatus(s: string): string {
  return s.trim().replace(/\s+/g, " ").toUpperCase();
}

export function isProcessing(s: string): boolean {
  return normalizeStatus(s) === PROCESSING_STATUS;
}

/** Chỉ số cột 0-based → chữ cái A1 (0→A, 25→Z, 26→AA). Bản client-safe của colToA1. */
export function columnKey(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** Chữ cái A1 → chỉ số 0-based. -1 nếu không hợp lệ. */
export function columnIndex(key: string): number {
  const s = key.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(s)) return -1;
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Nhận dạng order id (số đơn / tiền tố / khoá đối chiếu cột "Order") sống ở `types/sheets`
 * vì Sheet là nơi dùng chúng để khớp dòng. Re-export để tầng import dùng chung MỘT bản.
 */
export { canonicalOrderKey, normalizeOrderId, orderIdPrefix } from "@/lib/types/sheets";

/** Chuẩn hoá 1 header để so signature (trim/lowercase/gộp khoảng trắng). */
export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Điểm khớp signature: |giao| / |hợp| (Jaccard) trên tập header đã chuẩn hoá.
 * Ngưỡng nhận diện tự động — dưới ngưỡng thì không đoán, để người dùng tự chọn.
 */
export const SIGNATURE_MATCH_THRESHOLD = 0.6;

export function signatureScore(a: string[], b: string[]): number {
  const sa = new Set(a.filter(Boolean));
  const sb = new Set(b.filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const v of sa) if (sb.has(v)) inter++;
  return inter / (sa.size + sb.size - inter);
}
