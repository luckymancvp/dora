import type { ObjectId } from "mongodb";

/**
 * Quy tắc suy ra CARRIER từ số tracking — thay cho công thức
 * `IFS(REGEXMATCH(...),"Carrier", …)` người dùng đang dùng trên Google Sheet.
 *
 * Dùng khi file import KHÔNG có cột carrier (hoặc ô carrier trống):
 *   ô carrier trong file → quy tắc này → không suy được thì BỎ QUA dòng đó.
 *
 * Danh sách CÓ THỨ TỰ, khớp ĐẦU TIÊN thắng (đúng ngữ nghĩa IFS) nên thứ tự là dữ liệu,
 * không phải trang trí: "^34L" (Australia Post) phải đứng trước "^3A5" kiểu quy tắc rộng hơn.
 *
 * Module THUẦN (không server-only): cả API route lẫn UI preview đều gọi `evaluateCarrierRules`,
 * nên carrier hiện trên bảng preview luôn khớp carrier server chốt.
 */

/** Cách so khớp 1 mẫu với chuỗi xét. */
export type CarrierMatchKind = "prefix" | "suffix" | "contains" | "regex";

/** Phạm vi chuỗi đem ra so: cả mã, N ký tự đầu, hay N ký tự cuối ("4 ký tự cuối chứa …"). */
export type CarrierMatchScope = "all" | "first" | "last";

export interface CarrierRule {
  /** Khoá ổn định để React key + báo "quy tắc nào khớp" (không phải _id Mongo). */
  id: string;
  /** Tên carrier gửi lên Etsy khi khớp (vd "Royal Mail"). */
  carrier: string;
  kind: CarrierMatchKind;
  /** Khớp BẤT KỲ mẫu nào là khớp — tương ứng `^(IT|IW|QL)` trong công thức Sheet. */
  patterns: string[];
  scope: CarrierMatchScope;
  /** Số ký tự lấy ở đầu/cuối khi scope != "all". Bỏ qua khi scope = "all". */
  scopeLength: number;
  /** Mặc định false: mã tracking hay lẫn hoa/thường giữa các bên. */
  caseSensitive: boolean;
  enabled: boolean;
}

/** Collection `carrier_rules` — 1 document = toàn bộ danh sách (đọc/ghi nguyên khối, có thứ tự). */
export interface CarrierRuleSetDoc {
  _id?: ObjectId;
  /** Khoá cố định — chỉ có duy nhất 1 bộ quy tắc dùng chung mọi nguồn. */
  key: "default";
  rules: CarrierRule[];
  updatedByEmail: string;
  updatedAt: Date;
}

export interface CarrierRuleSetDTO {
  rules: CarrierRule[];
  /** ISO 8601; null nếu chưa từng lưu. */
  updatedAt: string | null;
  updatedByEmail: string | null;
}

/** Trần an toàn: mẫu do người dùng nhập, regex quá dài dễ thành bom backtracking. */
export const CARRIER_RULE_MAX_RULES = 200;
export const CARRIER_RULE_MAX_PATTERNS = 50;
export const CARRIER_RULE_MAX_PATTERN_LENGTH = 200;

export const CARRIER_MATCH_KIND_LABEL: Record<CarrierMatchKind, string> = {
  prefix: "Bắt đầu bằng",
  suffix: "Kết thúc bằng",
  contains: "Chứa",
  regex: "Regex",
};

export const CARRIER_MATCH_SCOPE_LABEL: Record<CarrierMatchScope, string> = {
  all: "cả mã",
  first: "N ký tự đầu",
  last: "N ký tự cuối",
};

// ---- Đánh giá quy tắc ----

/** Chuỗi thực sự đem ra so, theo scope. */
function subjectOf(tracking: string, rule: CarrierRule): string {
  const s = tracking.trim();
  if (rule.scope === "all") return s;
  const n = Math.max(0, Math.floor(rule.scopeLength));
  if (n === 0) return "";
  return rule.scope === "first" ? s.slice(0, n) : s.slice(-n);
}

function matchesPattern(subject: string, pattern: string, rule: CarrierRule): boolean {
  if (!pattern) return false;

  if (rule.kind === "regex") {
    try {
      return new RegExp(pattern, rule.caseSensitive ? "" : "i").test(subject);
    } catch {
      // Regex hỏng → coi như không khớp (UI đã cảnh báo lúc nhập); không làm sập cả lượt import.
      return false;
    }
  }

  const s = rule.caseSensitive ? subject : subject.toUpperCase();
  const p = rule.caseSensitive ? pattern : pattern.toUpperCase();
  if (rule.kind === "prefix") return s.startsWith(p);
  if (rule.kind === "suffix") return s.endsWith(p);
  return s.includes(p);
}

export function ruleMatches(tracking: string, rule: CarrierRule): boolean {
  if (!rule.enabled || !rule.carrier.trim()) return false;
  const subject = subjectOf(tracking, rule);
  if (!subject) return false;
  return rule.patterns.some((p) => matchesPattern(subject, p.trim(), rule));
}

/**
 * Quy tắc ĐẦU TIÊN khớp thắng (ngữ nghĩa IFS). null nếu không quy tắc nào khớp.
 * Trả kèm `rule` để UI chỉ rõ dòng nào quyết định carrier.
 */
export function evaluateCarrierRules(
  tracking: string,
  rules: CarrierRule[],
): { carrier: string; rule: CarrierRule } | null {
  const t = tracking.trim();
  if (!t) return null;
  for (const rule of rules) {
    if (ruleMatches(t, rule)) return { carrier: rule.carrier.trim(), rule };
  }
  return null;
}

// ---- Nhập từ công thức Google Sheet ----

/** Token "trần" (không ký tự regex) → rút gọn được về prefix/suffix/contains cho dễ đọc & sửa. */
const PLAIN_TOKEN = /^[A-Za-z0-9_\- ]+$/;

/**
 * Rút gọn 1 mẫu regex về dạng dễ đọc nếu được, còn không thì giữ nguyên regex.
 * `^4PX` → prefix [4PX]; `^(IT|IW|QL)` → prefix [IT,IW,QL]; `ABC$` → suffix [ABC];
 * `^NVSGS|AS0` (alternation trùm cả `^`) KHÔNG rút gọn — giữ regex để không đổi ngữ nghĩa.
 */
function reducePattern(raw: string): { kind: CarrierMatchKind; patterns: string[] } {
  const p = raw.trim();

  const anchoredGroup = p.match(/^\^\(([^()]+)\)$/);
  if (anchoredGroup) {
    const parts = anchoredGroup[1].split("|").map((s) => s.trim());
    if (parts.length > 0 && parts.every((s) => PLAIN_TOKEN.test(s))) {
      return { kind: "prefix", patterns: parts };
    }
  }

  const anchoredPlain = p.match(/^\^(.+)$/);
  if (anchoredPlain && PLAIN_TOKEN.test(anchoredPlain[1])) {
    return { kind: "prefix", patterns: [anchoredPlain[1]] };
  }

  const suffixGroup = p.match(/^\(([^()]+)\)\$$/);
  if (suffixGroup) {
    const parts = suffixGroup[1].split("|").map((s) => s.trim());
    if (parts.length > 0 && parts.every((s) => PLAIN_TOKEN.test(s))) {
      return { kind: "suffix", patterns: parts };
    }
  }

  const suffixPlain = p.match(/^(.+)\$$/);
  if (suffixPlain && PLAIN_TOKEN.test(suffixPlain[1])) {
    return { kind: "suffix", patterns: [suffixPlain[1]] };
  }

  if (PLAIN_TOKEN.test(p)) return { kind: "contains", patterns: [p] };

  return { kind: "regex", patterns: [p] };
}

/** Id ổn định trong 1 lượt parse (không dùng random để kết quả tái lập được). */
function ruleId(index: number): string {
  return `r${index + 1}`;
}

export interface ParsedFormulaResult {
  rules: CarrierRule[];
  /** Số cặp REGEXMATCH đọc được — để UI báo "đã nhận N quy tắc". */
  matched: number;
}

/**
 * Đọc công thức `IFS(REGEXMATCH(range,"pattern"),"Carrier", …)` dán từ Google Sheet
 * → danh sách quy tắc, GIỮ NGUYÊN thứ tự (thứ tự chính là ngữ nghĩa IFS).
 *
 * Bỏ qua nhánh `TRUE,""` cuối và mọi cặp có carrier rỗng — đó là nhánh "không xác định",
 * không phải quy tắc.
 */
export function parseSheetCarrierFormula(text: string): ParsedFormulaResult {
  const re = /REGEXMATCH\s*\([^,()]*,\s*"((?:[^"\\]|\\.)*)"\s*\)\s*,\s*"((?:[^"\\]|\\.)*)"/g;
  const rules: CarrierRule[] = [];
  let matched = 0;

  for (const m of text.matchAll(re)) {
    matched++;
    const pattern = m[1].replace(/\\"/g, '"');
    const carrier = m[2].replace(/\\"/g, '"').trim();
    if (!pattern.trim() || !carrier) continue;

    const { kind, patterns } = reducePattern(pattern);
    rules.push({
      id: ruleId(rules.length),
      carrier,
      kind,
      patterns,
      scope: "all",
      scopeLength: 0,
      caseSensitive: false,
      enabled: true,
    });
  }

  return { rules, matched };
}

/** Quy tắc rỗng cho nút "Thêm quy tắc". */
export function emptyCarrierRule(id: string): CarrierRule {
  return {
    id,
    carrier: "",
    kind: "prefix",
    patterns: [""],
    scope: "all",
    scopeLength: 4,
    caseSensitive: false,
    enabled: true,
  };
}
