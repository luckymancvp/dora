import "server-only";

import { asNumber, asString } from "@/lib/services/etsy-utils";
import { callMera, DeliveryProxyError } from "@/lib/services/delivery-proxy";
import {
  REVIEW_REQUEST_DEFAULT_TEMPLATE_ID,
  REVIEW_REQUEST_MAX_DAYS_DEFAULT,
  type ReviewRequestFailedItem,
  type ReviewRequestPreview,
  type ReviewRequestPreviewRequest,
  type ReviewRequestPreviewSample,
  type ReviewRequestRunRequest,
  type ReviewRequestRunResult,
  type ReviewRequestSendRequest,
  type ReviewRequestSendResult,
  type ReviewRequestSendSkipped,
  type ReviewRequestSendWarning,
  type ReviewRequestSettings,
  type ReviewRequestSettingsUpdate,
  type ReviewRequestSkippedCounts,
  type ReviewRequestSummary,
  type ReviewRequestTemplate,
  type ReviewRequestTemplateDeleteResult,
  type ReviewRequestTemplateInput,
  type ReviewRequestTemplateUpdate,
  type ReviewRequestTemplatesResponse,
} from "@/lib/types/delivery";

/**
 * Proxy MỎNG tới Request reviews của Mera (`/api/v2/review-requests/*`, plan request-reviews §5 + §11 mẫu tin)
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

/** Rỗng giữ rỗng — FE tự fallback REVIEW_REQUEST_VARIABLES (helper reviewRequestVariables). */
function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function normalizeSettings(data: Json): ReviewRequestSettings {
  return {
    project_id: asString(data.project_id),
    max_days: asNumber(data.max_days) ?? REVIEW_REQUEST_MAX_DAYS_DEFAULT,
    is_default: data.is_default === true,
    variables: stringList(data.variables),
    updated_by: asString(data.updated_by),
    updated_at: timeOrNull(data.updated_at),
    // §11: template / default_template đã bỏ khỏi settings. Chỉ giữ khi Mera bản cũ còn trả chuỗi
    // (rollout lag) — KHÔNG điền "" khi vắng, để FE phân biệt "Mera mới" với "mẫu rỗng".
    ...(typeof data.template === "string" ? { template: data.template } : {}),
    ...(typeof data.default_template === "string" ? { default_template: data.default_template } : {}),
  };
}

function normalizeTemplate(o: Json): ReviewRequestTemplate {
  return {
    // Mera trả ObjectId hex dạng chuỗi; idString phòng khi lỡ serialize số.
    id: idString(o.id),
    title: asString(o.title),
    content: asString(o.content),
    is_system: o.is_system === true,
    // §15: chỉ nhận true thật (vắng = chưa sửa). editable vắng (Mera trước §15) ⇒ suy từ is_system như luật cũ.
    customized: o.customized === true,
    editable: typeof o.editable === "boolean" ? o.editable : o.is_system !== true,
    created_by: asString(o.created_by),
    updated_by: asString(o.updated_by),
    updated_at: timeOrNull(o.updated_at),
  };
}

/**
 * Mera trả mẫu ở gốc body; một số handler gin hay bọc `{template: {...}}` — bóc nếu có. Thiếu id ⇒ coi
 * như phản hồi hỏng (FE cần id để setQueryData / sửa tiếp), không bịa id.
 */
function templateFromBody(data: Json): ReviewRequestTemplate {
  const t = normalizeTemplate(isPlainObject(data.template) ? data.template : data);
  if (!t.id) {
    throw new DeliveryProxyError(502, {
      error: "Mera trả mẫu tin không có id",
      code: "mera_bad_response",
    });
  }
  return t;
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

/** PUT /api/v2/review-requests/settings — Mera kiểm max_days (1–30), trả lại settings mới. */
export async function updateReviewRequestSettings(
  body: ReviewRequestSettingsUpdate,
  actorEmail: string,
): Promise<ReviewRequestSettings> {
  const data = await callMera(`${BASE}/settings`, { method: "PUT", body, actorEmail });
  return normalizeSettings(data);
}

/** POST /api/v2/review-requests/preview — đếm ứng viên tự động, không ghi gì. */
export async function previewReviewRequests(
  body: ReviewRequestPreviewRequest,
  actorEmail: string,
): Promise<ReviewRequestPreview> {
  const data = await callMera(`${BASE}/preview`, {
    method: "POST",
    body,
    actorEmail,
    timeoutMs: HEAVY_TIMEOUT_MS,
  });
  return {
    // Mera bản cũ (trước §11) không trả → "" (không tự điền id đã gửi: FE cần biết Mera dùng mẫu nào thật).
    template_id: asString(data.template_id),
    candidates: num(data.candidates),
    will_check_conversation: num(data.will_check_conversation),
    skipped: normalizeSkippedCounts(data.skipped),
    sample: objects(data.sample).map(normalizeSample),
    // Chỉ nhận true thật — Mera cũ không có field (sample ≤20, FE so với candidates nếu cần).
    sample_truncated: data.sample_truncated === true,
  };
}

/** POST /api/v2/review-requests/run — ghi hàng đợi rồi trả ngay (không chờ gửi xong). */
export async function runReviewRequests(
  body: ReviewRequestRunRequest,
  actorEmail: string,
): Promise<ReviewRequestRunResult> {
  const data = await callMera(`${BASE}/run`, {
    method: "POST",
    body,
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

// --- §11 Thư viện mẫu tin (dùng chung toàn hệ thống, không theo project) ---

/** GET /api/v2/review-requests/templates — `default` (is_system) luôn đứng đầu, giữ nguyên thứ tự Mera. */
export async function listReviewRequestTemplates(
  actorEmail: string,
): Promise<ReviewRequestTemplatesResponse> {
  const data = await callMera(`${BASE}/templates`, { actorEmail });
  return {
    // Item thiếu id thì FE không chọn/sửa/xoá được (và trùng React key) → bỏ thay vì bịa id.
    items: objects(data.items)
      .map(normalizeTemplate)
      .filter((t) => t.id !== ""),
    variables: stringList(data.variables),
  };
}

/** POST /api/v2/review-requests/templates — Mera kiểm title/content, trả mẫu vừa tạo. */
export async function createReviewRequestTemplate(
  body: ReviewRequestTemplateInput,
  actorEmail: string,
): Promise<ReviewRequestTemplate> {
  const data = await callMera(`${BASE}/templates`, { method: "POST", body, actorEmail });
  return templateFromBody(data);
}

/** PUT /api/v2/review-requests/templates/:id — 403 system_template / 404 template_not_found chuyển tiếp nguyên. */
export async function updateReviewRequestTemplate(
  id: string,
  body: ReviewRequestTemplateUpdate,
  actorEmail: string,
): Promise<ReviewRequestTemplate> {
  const data = await callMera(`${BASE}/templates/${encodeURIComponent(id)}`, {
    method: "PUT",
    body,
    actorEmail,
  });
  return templateFromBody(data);
}

/**
 * DELETE /api/v2/review-requests/templates/:id. 2xx (callMera đã bảo đảm body là object) = xoá xong →
 * luôn trả `{ok:true}` thay vì tin field `ok` của Mera.
 */
export async function deleteReviewRequestTemplate(
  id: string,
  actorEmail: string,
): Promise<ReviewRequestTemplateDeleteResult> {
  await callMera(`${BASE}/templates/${encodeURIComponent(id)}`, { method: "DELETE", actorEmail });
  return { ok: true };
}

/**
 * POST /api/v2/review-requests/templates/default/reset (§15) — bỏ bản sửa, về nội dung gốc trong code Mera.
 * Chỉ mẫu `default` có endpoint này (route dora-1 chặn id khác). Trả mẫu sau khi khôi phục.
 */
export async function resetDefaultReviewRequestTemplate(
  actorEmail: string,
): Promise<ReviewRequestTemplate> {
  const data = await callMera(
    `${BASE}/templates/${encodeURIComponent(REVIEW_REQUEST_DEFAULT_TEMPLATE_ID)}/reset`,
    { method: "POST", actorEmail },
  );
  return templateFromBody(data);
}
