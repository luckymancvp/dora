import type { ObjectId } from "mongodb";

/**
 * Cấu hình 1 Google Spreadsheet được kết nối (collection `sheet_configs`).
 * Mỗi sheet là 1 "Order sheet": mỗi dòng = 1 item, key là cột "Item ID" = prefix-receipt-transaction.
 */
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
  /** Store thuộc sheet này (auto từ tab Prefix) — gợi ý ưu tiên dò trước. */
  shopNames: string[];
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
