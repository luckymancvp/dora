import "server-only";

import { getCarrierRulesCollection } from "@/lib/db/collections";
import {
  CARRIER_RULE_MAX_PATTERN_LENGTH,
  CARRIER_RULE_MAX_PATTERNS,
  CARRIER_RULE_MAX_RULES,
  type CarrierMatchKind,
  type CarrierMatchScope,
  type CarrierRule,
  type CarrierRuleSetDTO,
} from "@/lib/types/carrier-rule";

/** Lỗi nghiệp vụ quy tắc carrier (mang HTTP status cho errorResponse). */
export class CarrierRuleError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const KINDS: CarrierMatchKind[] = ["prefix", "suffix", "contains", "regex"];
const SCOPES: CarrierMatchScope[] = ["all", "first", "last"];

/**
 * Chuẩn hoá + validate 1 quy tắc từ payload client (parse phòng thủ: shape không đảm bảo).
 * Ném 400 kèm số thứ tự để người dùng biết sửa dòng nào.
 */
function normalizeRule(raw: unknown, index: number): CarrierRule {
  const r = (raw ?? {}) as Record<string, unknown>;
  const at = `Quy tắc #${index + 1}`;

  const carrier = String(r.carrier ?? "").trim();
  if (!carrier) throw new CarrierRuleError(400, `${at}: thiếu tên carrier`);

  const kind = String(r.kind ?? "") as CarrierMatchKind;
  if (!KINDS.includes(kind)) throw new CarrierRuleError(400, `${at}: kiểu khớp không hợp lệ`);

  const scope = String(r.scope ?? "all") as CarrierMatchScope;
  if (!SCOPES.includes(scope)) throw new CarrierRuleError(400, `${at}: phạm vi không hợp lệ`);

  const patterns = (Array.isArray(r.patterns) ? r.patterns : [])
    .map((p) => String(p ?? "").trim())
    .filter(Boolean);
  if (patterns.length === 0) throw new CarrierRuleError(400, `${at}: cần ít nhất 1 mẫu`);
  if (patterns.length > CARRIER_RULE_MAX_PATTERNS) {
    throw new CarrierRuleError(400, `${at}: quá ${CARRIER_RULE_MAX_PATTERNS} mẫu`);
  }
  for (const p of patterns) {
    if (p.length > CARRIER_RULE_MAX_PATTERN_LENGTH) {
      throw new CarrierRuleError(
        400,
        `${at}: mẫu dài quá ${CARRIER_RULE_MAX_PATTERN_LENGTH} ký tự`,
      );
    }
    // Regex hỏng phải chặn NGAY lúc lưu — lúc chạy import nó chỉ âm thầm không khớp.
    if (kind === "regex") {
      try {
        new RegExp(p);
      } catch {
        throw new CarrierRuleError(400, `${at}: regex không hợp lệ — ${p}`);
      }
    }
  }

  const rawLen = Number(r.scopeLength ?? 0);
  const scopeLength = Number.isFinite(rawLen) ? Math.max(0, Math.floor(rawLen)) : 0;
  if (scope !== "all" && scopeLength === 0) {
    throw new CarrierRuleError(400, `${at}: cần số ký tự > 0 cho phạm vi đầu/cuối`);
  }

  return {
    id: String(r.id ?? "").trim() || `r${index + 1}`,
    carrier,
    kind,
    patterns,
    scope,
    scopeLength,
    caseSensitive: r.caseSensitive === true,
    enabled: r.enabled !== false,
  };
}

/** Bộ quy tắc hiện tại. Chưa cấu hình → danh sách rỗng (soft: import vẫn chạy, chỉ không suy được carrier). */
export async function getCarrierRuleSet(): Promise<CarrierRuleSetDTO> {
  const coll = await getCarrierRulesCollection();
  const doc = await coll.findOne({ key: "default" });
  if (!doc) return { rules: [], updatedAt: null, updatedByEmail: null };
  return {
    rules: doc.rules ?? [],
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
    updatedByEmail: doc.updatedByEmail ?? null,
  };
}

/** Chỉ danh sách quy tắc — dùng ở đường import (không cần metadata). */
export async function listCarrierRules(): Promise<CarrierRule[]> {
  const set = await getCarrierRuleSet();
  return set.rules;
}

/**
 * Thay TOÀN BỘ danh sách (không patch từng quy tắc): thứ tự là ngữ nghĩa nên sửa nguyên
 * khối vừa đơn giản vừa tránh trạng thái nửa vời khi kéo-thả sắp lại.
 */
export async function replaceCarrierRules(
  rawRules: unknown,
  actorEmail: string,
): Promise<CarrierRuleSetDTO> {
  if (!Array.isArray(rawRules)) throw new CarrierRuleError(400, "rules phải là mảng");
  if (rawRules.length > CARRIER_RULE_MAX_RULES) {
    throw new CarrierRuleError(400, `Tối đa ${CARRIER_RULE_MAX_RULES} quy tắc`);
  }

  const rules = rawRules.map(normalizeRule);

  // Id trùng làm React key nhảy và "quy tắc nào khớp" chỉ sai dòng → ép duy nhất.
  const seen = new Set<string>();
  for (let i = 0; i < rules.length; i++) {
    if (seen.has(rules[i].id)) rules[i] = { ...rules[i], id: `r${i + 1}-${Date.now()}` };
    seen.add(rules[i].id);
  }

  const now = new Date();
  const coll = await getCarrierRulesCollection();
  await coll.updateOne(
    { key: "default" },
    { $set: { rules, updatedByEmail: actorEmail, updatedAt: now }, $setOnInsert: { key: "default" } },
    { upsert: true },
  );
  return { rules, updatedAt: now.toISOString(), updatedByEmail: actorEmail };
}
