import "server-only";

import { asNumber, asString } from "@/lib/services/etsy-utils";
import { callMera } from "@/lib/services/delivery-proxy";
import {
  REVIEW_REQUEST_MAX_DAYS_DEFAULT,
  type ReviewRequestFailedItem,
  type ReviewRequestPreview,
  type ReviewRequestPreviewSample,
  type ReviewRequestRunResult,
  type ReviewRequestSendRequest,
  type ReviewRequestSendResult,
  type ReviewRequestSendSkipped,
  type ReviewRequestSendWarning,
  type ReviewRequestSettings,
  type ReviewRequestSettingsUpdate,
  type ReviewRequestSkippedCounts,
  type ReviewRequestSummary,
} from "@/lib/types/delivery";

/**
 * Proxy MỎNG tới Request reviews của Mera (`/api/v2/review-requests/*`, plan request-reviews §5)
 * cho trang /delivery (contract _workspace/01 §3). Cùng nguyên tắc delivery-proxy.ts: internal key
 * + `X-Actor-Email`, lỗi Mera chuyển tiếp NGUYÊN VĂN qua `callMera` (bảng §3.2 contract delivery cũ).
 *
 * Mera BE làm song song + rollout lag ⇒ mọi field có thể vắng/sai kiểu: chuẩn hoá về mặc định ở đây
 * để FE đọc thẳng, KHÔNG suy diễn số liệu (vắng = 0 / "" / null, không bịa).
 */

const BASE = "/api/v2/review-requests";

/** Preview/run/send phải quét sổ ghi + tracking của cả project trên Mera → cho lâu hơn mặc định 15s. */
const HEAVY_TIMEOUT_MS = 30_000;

type Json = Record<string, unknown>;

function isPlainObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function objects(v: unknown): Json[] {
  return Array.isArray(v) ? v.filter(isPlainObject) : [];
}

function num(v: unknown): number {
  return asNumber(v) ?? 0;
}

/** Id Etsy có thể là số (Go int64) hoặc chuỗi tuỳ Mera serialize → luôn trả chuỗi. */
function idString(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return asString(v);
}

/** Thời điểm RFC3339; rỗng/sai kiểu → null (Go zero time cũng có thể bị omitempty bỏ). */
function timeOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function withProject(path: string, projectId: string): string {
  return `${path}?${new URLSearchParams({ project_id: projectId }).toString()}`;
}

function normalizeSettings(data: Json): ReviewRequestSettings {
  return {
    project_id: asString(data.project_id),
    template: asString(data.template),
    max_days: asNumber(data.max_days) ?? REVIEW_REQUEST_MAX_DAYS_DEFAULT,
    is_default: data.is_default === true,
    default_template: asString(data.default_template),
    // Rỗng giữ rỗng — FE tự fallback REVIEW_REQUEST_VARIABLES (helper reviewRequestVariables).
    variables: Array.isArray(data.variables)
      ? data.variables.filter((v): v is string => typeof v === "string")
      : [],
    updated_by: asString(data.updated_by),
    updated_at: timeOrNull(data.updated_at),
  };
}

/**
 * Giữ MỌI key số Mera trả (send_blocked_env, shop_offline, conversation_unknown, manual_failed… và lý
 * do Mera thêm sau) — bỏ bớt thì dialog báo "0 đơn" mà không nói lý do (QA B4). Chỉ bỏ giá trị không
 * phải số; 3 key gốc luôn có (Mera có thể bỏ key bằng 0 hoặc bỏ cả object).
 */
function normalizeSkippedCounts(v: unknown): ReviewRequestSkippedCounts {
  const o = isPlainObject(v) ? v : {};
  const out: ReviewRequestSkippedCounts = { has_conversation: 0, reviewed: 0, already_requested: 0 };
  for (const [k, raw] of Object.entries(o)) {
    const n = asNumber(raw);
    if (n !== undefined) out[k] = n;
  }
  return out;
}

function normalizeSample(o: Json): ReviewRequestPreviewSample {
  return {
    order_id: idString(o.order_id),
    etsy_receipt_id: idString(o.etsy_receipt_id),
    project_id: asString(o.project_id),
    tracking_id: asString(o.tracking_id),
    shop_name: asString(o.shop_name),
    store: asString(o.store),
    tracking_code: asString(o.tracking_code),
    delivered_at: timeOrNull(o.delivered_at),
    // Chỉ nhận boolean thật: null = resolver chưa xác định (KHÔNG coi vắng là "chưa có hội thoại").
    has_conversation: typeof o.has_conversation === "boolean" ? o.has_conversation : null,
  };
}

function isWarningKind(v: unknown): v is ReviewRequestSendWarning["kind"] {
  return v === "already_requested" || v === "reviewed";
}

function normalizeSendResult(data: Json): ReviewRequestSendResult {
  // Cảnh báo kind lạ (Mera thêm loại mới trước khi dora-1 kịp cập nhật) → bỏ, vì FE map nhãn theo union.
  const warnings: ReviewRequestSendWarning[] = objects(data.warnings)
    .filter((w) => isWarningKind(w.kind))
    .map((w) => ({ order_id: idString(w.order_id), kind: w.kind as ReviewRequestSendWarning["kind"] }));
  const skipped: ReviewRequestSendSkipped[] = objects(data.skipped).map((s) => ({
    order_id: idString(s.order_id),
    // reason "not_found": Mera chỉ biết tracking_id (không có order/code) → FE tự map sang code.
    tracking_id: asString(s.tracking_id),
    tracking_code: asString(s.tracking_code),
    reason: asString(s.reason),
  }));
  return { queued: num(data.queued), warnings, skipped };
}

function normalizeFailed(o: Json): ReviewRequestFailedItem {
  return {
    order_id: idString(o.order_id),
    shop_name: asString(o.shop_name),
    error: asString(o.error),
    at: timeOrNull(o.at),
    // Mera `failed_recent[].unconfirmed` (bool) — chỉ giữ khi true (vắng = false).
    ...(o.unconfirmed === true ? { unconfirmed: true } : {}),
  };
}

/** GET /api/v2/review-requests/settings?project_id= */
export async function getReviewRequestSettings(
  projectId: string,
  actorEmail: string,
): Promise<ReviewRequestSettings> {
  const data = await callMera(withProject(`${BASE}/settings`, projectId), { actorEmail });
  return normalizeSettings(data);
}

/** PUT /api/v2/review-requests/settings — Mera kiểm giới hạn template/max_days, trả lại settings mới. */
export async function updateReviewRequestSettings(
  body: ReviewRequestSettingsUpdate,
  actorEmail: string,
): Promise<ReviewRequestSettings> {
  const data = await callMera(`${BASE}/settings`, { method: "PUT", body, actorEmail });
  return normalizeSettings(data);
}

/** POST /api/v2/review-requests/preview — đếm ứng viên tự động, không ghi gì. */
export async function previewReviewRequests(
  projectId: string,
  actorEmail: string,
): Promise<ReviewRequestPreview> {
  const data = await callMera(`${BASE}/preview`, {
    method: "POST",
    body: { project_id: projectId },
    actorEmail,
    timeoutMs: HEAVY_TIMEOUT_MS,
  });
  return {
    candidates: num(data.candidates),
    will_check_conversation: num(data.will_check_conversation),
    skipped: normalizeSkippedCounts(data.skipped),
    sample: objects(data.sample).map(normalizeSample),
  };
}

/** POST /api/v2/review-requests/run — ghi hàng đợi rồi trả ngay (không chờ gửi xong). */
export async function runReviewRequests(
  projectId: string,
  actorEmail: string,
): Promise<ReviewRequestRunResult> {
  const data = await callMera(`${BASE}/run`, {
    method: "POST",
    body: { project_id: projectId },
    actorEmail,
    timeoutMs: HEAVY_TIMEOUT_MS,
  });
  return {
    queued: num(data.queued),
    checking: num(data.checking),
    skipped: normalizeSkippedCounts(data.skipped),
  };
}

/** POST /api/v2/review-requests/send — gửi tay theo mã tracking (body đã được route làm sạch). */
export async function sendReviewRequests(
  body: ReviewRequestSendRequest,
  actorEmail: string,
): Promise<ReviewRequestSendResult> {
  const data = await callMera(`${BASE}/send`, {
    method: "POST",
    body,
    actorEmail,
    timeoutMs: HEAVY_TIMEOUT_MS,
  });
  return normalizeSendResult(data);
}

/** GET /api/v2/review-requests/summary?project_id= — chân dialog, FE poll khi còn hàng đợi. */
export async function getReviewRequestSummary(
  projectId: string,
  actorEmail: string,
): Promise<ReviewRequestSummary> {
  const data = await callMera(withProject(`${BASE}/summary`, projectId), { actorEmail });
  return {
    // queued ĐÃ GỒM checking (Mera đếm queued + checking) — FE không cộng thêm.
    queued: num(data.queued),
    checking: num(data.checking),
    sending: num(data.sending),
    sent_today: num(data.sent_today),
    failed_recent: objects(data.failed_recent).map(normalizeFailed),
  };
}
