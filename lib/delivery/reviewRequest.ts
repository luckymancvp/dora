import { hasReview } from "@/lib/delivery/review";
import {
  DORA_PROJECT_ID,
  REVIEW_REQUEST_TEMPLATE_TITLE_MAX,
  REVIEW_REQUEST_VARIABLES,
  isDoraProjectId,
} from "@/lib/types/delivery";
import type {
  DeliveryApiErrorBody,
  DeliveryOrderReviewRequest,
  DeliveryTracking,
  ReviewRequestSendRequest,
  ReviewRequestSendWarning,
  ReviewRequestSkipReason,
  ReviewRequestSkippedCounts,
  ReviewRequestTemplate,
  ReviewRequestTemplatesResponse,
} from "@/lib/types/delivery";

/**
 * Logic thuần "Request reviews" màn Giao hàng (contract _workspace/01 §4.2, plan request-reviews §6):
 * map project UI → project_id Mera, badge dòng, biến mẫu tin + xem trước, cảnh báo trước khi gửi tay.
 */

/**
 * R-A1: project của bộ lọc UI → `project_id` của API review-requests.
 * `<hex>` → hex · `dora` / `dora:<store>` → "dora" · '' (Tất cả) → null (phải chọn project trước).
 */
export function reviewRequestProjectId(project: string): string | null {
  const p = project.trim();
  if (!p) return null;
  if (isDoraProjectId(p)) return DORA_PROJECT_ID;
  return p;
}

export type ReviewRequestBadgeTone = "ok" | "pending" | "error" | "muted";

export interface ReviewRequestBadge {
  label: string;
  tone: ReviewRequestBadgeTone;
  /** Tooltip. */
  title: string;
}

/**
 * Nhãn lý do bỏ qua — một bảng cho cả 3 nguồn (khớp Go `ReviewSkipCounts` + `ReviewSendSkipped.Reason`):
 * key số đếm preview/run (`skipped{}`), `skip_reason` của sổ ghi, `send.skipped[].reason` (gửi tay).
 */
export const SKIP_REASON_LABEL: Record<ReviewRequestSkipReason, string> & Partial<Record<string, string>> = {
  // preview / run / skip_reason
  has_conversation: "Đã có hội thoại với buyer",
  reviewed: "Đơn đã có review",
  already_requested: "Đã xin review trước đó",
  send_blocked_env: "Shop không được phép gửi ở môi trường này",
  shop_offline: "Shop offline (extension không chạy)",
  conversation_unknown: "Chưa đọc được hội thoại từ Etsy (lần chạy sau thử lại)",
  manual_failed: "Lần gửi tay trước bị lỗi (không tự gửi lại)",
  // send (gửi tay)
  not_found: "Không tìm thấy mã tracking",
  no_orders: "Mã không có đơn trong phạm vi đang xem",
  no_receipt: "Đơn chưa có Etsy receipt",
  sending: "Đang gửi dở — không gửi lại",
  // §13: đơn người dùng bỏ tích trong "Đơn sẽ gửi"
  excluded: "Đã bỏ khỏi danh sách",
};

/** Nhãn lý do bỏ qua; key lạ → nguyên key; rỗng → "Bỏ qua". */
export function skipReasonLabel(reason: string | null | undefined): string {
  const r = (reason ?? "").trim();
  if (!r) return "Bỏ qua";
  return SKIP_REASON_LABEL[r] ?? r;
}

/** 3 key gốc luôn hiện (kể cả 0) trong preview; key khác chỉ hiện khi > 0. */
export const SKIPPED_BASE_KEYS = ["has_conversation", "reviewed", "already_requested"] as const;

/** Các cặp [lý do, số] để hiển thị: 3 key gốc (khi `withBase`) + mọi key khác > 0 (key lạ giữ nguyên tên). */
export function skippedCountEntries(skipped: ReviewRequestSkippedCounts | null | undefined, withBase = true): [string, number][] {
  const out: [string, number][] = [];
  const base: readonly string[] = SKIPPED_BASE_KEYS;
  if (withBase) for (const k of SKIPPED_BASE_KEYS) out.push([k, skipped?.[k] ?? 0]);
  for (const [k, n] of Object.entries(skipped ?? {})) {
    if (typeof n !== "number" || n <= 0) continue;
    if (withBase && base.includes(k)) continue;
    out.push([k, n]);
  }
  return out;
}

/** "3 Đã có hội thoại với buyer; 2 Shop offline…" (bỏ key 0); không có → "". */
export function skippedCountsSummary(skipped: ReviewRequestSkippedCounts | null | undefined): string {
  return skippedCountEntries(skipped, false)
    .map(([k, n]) => `${n.toLocaleString()} ${skipReasonLabel(k)}`)
    .join("; ");
}

export const SEND_WARNING_LABEL: Record<ReviewRequestSendWarning["kind"], string> = {
  already_requested: "Đã xin review trước đó",
  reviewed: "Đã có review",
};

/** Nhãn cảnh báo trước khi gửi tay (FE) — thêm "sending": Mera bỏ qua đơn đang gửi dở (reason sending). */
export const MANUAL_WARNING_LABEL: Record<ManualWarning["kind"], string> = {
  ...SEND_WARNING_LABEL,
  sending: "Đang gửi — sẽ bị bỏ qua",
};

const VN_TIME_ZONE = "Asia/Ho_Chi_Minh";

/** "dd/MM" giờ VN; không hợp lệ → "". */
function formatDayMonthVN(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", timeZone: VN_TIME_ZONE });
}

/** "dd/MM/yyyy HH:mm" giờ VN; không hợp lệ → "". */
export function formatDateTimeVN(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("vi-VN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: VN_TIME_ZONE,
  });
}

const MODE_LABEL: Record<DeliveryOrderReviewRequest["mode"], string> = {
  auto: "tự động",
  manual: "gửi tay",
};

/**
 * Badge cột Status từ `orders[].review_request` (plan §6 "Dòng bảng"):
 * sent → "Đã xin review · dd/MM" (ok) · queued|checking|sending → "Đang chờ gửi" (pending) ·
 * failed → "Gửi lỗi" (error, tooltip = error) · skipped → "Bỏ qua" (muted, tooltip = lý do) · null/vắng → null.
 */
export function reviewRequestBadge(rr: DeliveryOrderReviewRequest | null | undefined): ReviewRequestBadge | null {
  if (!rr) return null;
  const mode = MODE_LABEL[rr.mode] ?? "";
  switch (rr.status) {
    case "sent": {
      const day = formatDayMonthVN(rr.sent_at);
      const at = formatDateTimeVN(rr.sent_at);
      return {
        label: day ? `Đã xin review · ${day}` : "Đã xin review",
        tone: "ok",
        title: ["Đã gửi tin xin review", mode && `(${mode})`, at && `lúc ${at}`].filter(Boolean).join(" "),
      };
    }
    case "queued":
    case "sending":
    case "checking":
      return {
        label: "Đang chờ gửi",
        tone: "pending",
        title:
          rr.status === "checking"
            ? "Đang nhờ extension kiểm lại hội thoại trên Etsy trước khi gửi"
            : rr.status === "sending"
              ? "Đang gửi tin xin review"
              : "Đã xếp hàng gửi tin xin review",
      };
    case "failed":
      // Không rõ kết quả (dora-1 chưa báo DONE/FAILED) — buyer có thể đã nhận → vàng, không phải lỗi.
      if (rr.unconfirmed === true) {
        return {
          label: "Chưa xác nhận",
          tone: "pending",
          title: "Không rõ buyer đã nhận tin chưa — hệ thống đang kiểm lại",
        };
      }
      return { label: "Gửi lỗi", tone: "error", title: rr.error || "Gửi tin xin review lỗi" };
    case "skipped":
      return { label: "Bỏ qua", tone: "muted", title: `Không gửi tin xin review: ${skipReasonLabel(rr.skip_reason)}` };
    default:
      return null;
  }
}

/** Token biến của mẫu tin: `variables` rỗng → REVIEW_REQUEST_VARIABLES; token thiếu `{}` → bọc `{}`. */
export function reviewRequestVariables(s?: Pick<ReviewRequestTemplatesResponse, "variables"> | null): string[] {
  const out: string[] = [];
  for (const raw of s?.variables ?? []) {
    if (typeof raw !== "string") continue;
    const t = raw.trim().replace(/^\{+|\}+$/g, "");
    if (!t) continue;
    const token = `{${t}}`;
    if (!out.includes(token)) out.push(token);
  }
  return out.length > 0 ? out : [...REVIEW_REQUEST_VARIABLES];
}

export interface ReviewTemplateVars {
  buyer_name: string;
  order_id: string;
  shop_name: string;
}

/** Thay `{buyer_name}` / `{order_id}` / `{shop_name}` (mọi lần xuất hiện); token khác giữ nguyên. */
export function renderReviewTemplate(tpl: string, v: ReviewTemplateVars): string {
  return tpl.replace(/\{(buyer_name|order_id|shop_name)\}/g, (_m, k: keyof ReviewTemplateVars) => v[k]);
}

/**
 * Kiểm biến mẫu tin phía client (QA B5 — Mera chỉ bắt `\{[A-Za-z_]+\}`): mọi cụm `{…}` khác đúng 3 biến
 * chuẩn (`{ buyer_name }`, `{shop-name}`, `{buyer_name1}`…), ngoặc kép `{{…}}` và ngoặc lẻ đều là lỗi —
 * vì sẽ tới tay khách nguyên văn. Trả các cụm sai (bỏ trùng, giữ thứ tự); [] = hợp lệ.
 */
export function invalidTemplateTokens(tpl: string): string[] {
  const out: string[] = [];
  const add = (t: string) => {
    if (!out.includes(t)) out.push(t);
  };
  let rest = tpl.replace(/\{\{[^{}\n]*\}\}/g, (m) => {
    add(m);
    return " ";
  });
  rest = rest.replace(/\{(buyer_name|order_id|shop_name)\}/g, " ");
  rest = rest.replace(/\{[^{}\n]*\}/g, (m) => {
    add(m.length > 42 ? `${m.slice(0, 40)}…}` : m);
    return " ";
  });
  if (rest.includes("{")) add("{");
  if (rest.includes("}")) add("}");
  return out;
}

/** Câu lỗi cho các cụm biến sai; [] → "". */
export function invalidTemplateMessage(tokens: string[]): string {
  if (tokens.length === 0) return "";
  return `Biến không hợp lệ: ${tokens.join(", ")} — chỉ dùng ${REVIEW_REQUEST_VARIABLES.join(", ")} (đúng chính tả, không khoảng trắng, một cặp ngoặc).`;
}

/** Giá trị mẫu cho khung "Xem trước" của dialog cài đặt. */
export const REVIEW_PREVIEW_SAMPLE_VARS: ReviewTemplateVars = {
  buyer_name: "Emma",
  order_id: "3456789012",
  shop_name: "YourShop",
};

/**
 * review_request coi là "đã xin review" (cảnh báo khi gửi tay, khớp Mera `service.go` + QA N2/B3):
 * từng gửi (`sent_at`) · đang trong hàng đợi / đã gửi · lỗi "unconfirmed"/"interrupted" (không rõ khách
 * đã nhận chưa — có thể đã tới tay). Bỏ qua / lỗi khác chưa gửi = không cảnh báo. `sending` xét riêng
 * (cảnh báo "sending" trong manualWarnings).
 */
function isRequested(rr: DeliveryOrderReviewRequest | null | undefined): boolean {
  if (!rr) return false;
  if (rr.sent_at || rr.unconfirmed === true) return true;
  if (rr.status === "sent" || rr.status === "queued" || rr.status === "checking") return true;
  const err = (rr.error ?? "").trim().toLowerCase();
  return err.startsWith("unconfirmed") || err.startsWith("interrupted");
}

/** Khoảng tự tải lại danh sách khi còn đơn chưa gửi xong (badge "Đang chờ gửi"). */
export const REVIEW_PENDING_POLL_MS = 10_000;

/** Còn đơn nào đang trong hàng đợi / kiểm hội thoại / đang gửi — trạng thái sẽ tự đổi phía Mera. */
export function hasPendingReviewRequest(rows: Pick<DeliveryTracking, "orders">[] | null | undefined): boolean {
  return (rows ?? []).some((r) =>
    (r.orders ?? []).some((o) => {
      const s = o.review_request?.status;
      return s === "queued" || s === "checking" || s === "sending";
    }),
  );
}

export interface ManualWarning {
  order_id: string;
  store: string;
  /** "sending" chỉ có ở FE: đơn đang gửi dở → Mera sẽ bỏ qua (reason sending), không gửi lại. */
  kind: ReviewRequestSendWarning["kind"] | "sending";
}

/**
 * R-A3: cảnh báo (không chặn) trước khi gửi tay, tính từ dòng đang có trên FE:
 * đơn đang gửi dở (status sending → sẽ bị bỏ qua) / đã được xin review (`review_request`) / có item đã có review.
 */
export function manualWarnings(rows: DeliveryTracking[]): ManualWarning[] {
  const out: ManualWarning[] = [];
  const seen = new Set<string>();
  const push = (w: ManualWarning) => {
    const k = `${w.order_id}\u0000${w.store}\u0000${w.kind}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(w);
  };
  for (const r of rows) {
    for (const o of r.orders ?? []) {
      if (o.review_request?.status === "sending") push({ order_id: o.order_id, store: o.store, kind: "sending" });
      else if (isRequested(o.review_request)) push({ order_id: o.order_id, store: o.store, kind: "already_requested" });
      if ((o.items ?? []).some((it) => hasReview(it.review))) {
        push({ order_id: o.order_id, store: o.store, kind: "reviewed" });
      }
    }
  }
  return out;
}

// ---- §11 Thư viện mẫu tin ----

/**
 * Câu tiếng Việt cho mã lỗi thư viện mẫu (Mera trả `error` tiếng Anh): POST/PUT/DELETE /templates,
 * preview/run/send khi mẫu đã bị xoá, `template_required` (dora-1 tự chặn run thiếu mẫu).
 */
export const REVIEW_TEMPLATE_ERROR_LABEL: Partial<Record<string, string>> = {
  duplicate_title: "Tiêu đề này đã có (không phân biệt hoa thường) — đặt tiêu đề khác",
  invalid_title: `Tiêu đề không hợp lệ — bắt buộc, tối đa ${REVIEW_REQUEST_TEMPLATE_TITLE_MAX} ký tự`,
  invalid_template: "Nội dung mẫu không hợp lệ",
  system_template: "Mẫu mặc định của hệ thống không sửa / xoá được",
  template_not_found: "Mẫu tin không còn tồn tại (có thể vừa bị xoá) — chọn mẫu khác",
  template_required: "Chưa chọn mẫu tin",
};

/**
 * Mẫu có đúng `id` trong thư viện; không có (đã bị xoá ở nơi khác / chưa tải) → null. KHÔNG tự rơi về
 * mẫu khác (QA MT-3): UI giữ id đã chọn, hiện "(đã xoá)" và khoá chạy/gửi theo mẫu.
 */
export function pickReviewTemplate(
  items: ReviewRequestTemplate[] | undefined,
  id: string,
): ReviewRequestTemplate | null {
  return (items ?? []).find((t) => t.id === id) ?? null;
}

/** Tiêu đề Mera giữ chỗ cho mẫu hệ thống `default` — không được đặt trùng (mọi kiểu hoa thường). */
export const REVIEW_DEFAULT_TEMPLATE_TITLE = "Mẫu mặc định";

/** Số ký tự như Mera (utf8.RuneCountInString): đếm code point, không đếm đơn vị UTF-16. */
export function reviewTextLength(text: string): number {
  return [...text].length;
}

/**
 * Tiêu đề như Mera lưu (QA MT-4/MT-6): chuẩn hoá Unicode NFC (Unikey "Unicode tổ hợp" sinh NFD) →
 * gộp mọi chuỗi khoảng trắng / tab / xuống dòng thành 1 dấu cách → bỏ khoảng trắng 2 đầu.
 */
export function normalizeReviewTemplateTitle(title: string): string {
  return title.normalize("NFC").replace(/\s+/g, " ").trim();
}

/**
 * Kiểm tiêu đề phía client (Mera kiểm lại), trên bản đã chuẩn hoá: bắt buộc, ≤
 * REVIEW_REQUEST_TEMPLATE_TITLE_MAX code point, không trùng (không phân biệt hoa thường) mẫu khác trong
 * thư viện hay tiêu đề giữ chỗ "Mẫu mặc định". "" = hợp lệ.
 */
export function reviewTemplateTitleError(
  title: string,
  items: ReviewRequestTemplate[] | undefined,
  selfId: string | null,
): string {
  const t = normalizeReviewTemplateTitle(title);
  if (!t) return "Nhập tiêu đề";
  if (reviewTextLength(t) > REVIEW_REQUEST_TEMPLATE_TITLE_MAX) {
    return `Tiêu đề tối đa ${REVIEW_REQUEST_TEMPLATE_TITLE_MAX} ký tự`;
  }
  const key = t.toLowerCase();
  const taken =
    key === normalizeReviewTemplateTitle(REVIEW_DEFAULT_TEMPLATE_TITLE).toLowerCase() ||
    (items ?? []).some((it) => it.id !== selfId && normalizeReviewTemplateTitle(it.title).toLowerCase() === key);
  if (taken) return "Tiêu đề này đã có — đặt tiêu đề khác";
  return "";
}

/**
 * Câu lỗi route review-requests: mã lỗi mẫu tin (§11) → câu tiếng Việt, còn lại `body.error`
 * (+ shop nếu Mera trả kèm và câu chưa nhắc tới; + `unknown_vars` của invalid_template / invalid_message
 * khi câu chưa liệt kê; invalid_template không kèm biến (vd quá dài) → nối câu gốc của Mera).
 */
export function reviewRequestErrorText(body: DeliveryApiErrorBody | undefined, fallback: string): string {
  const label = body?.code ? REVIEW_TEMPLATE_ERROR_LABEL[body.code] : undefined;
  const raw = body?.error?.trim() ?? "";
  let msg = label || raw || fallback || "Lỗi không rõ";
  if (label && body?.code === "invalid_template" && !(body.unknown_vars ?? []).length && raw) {
    msg = `${msg}: ${raw}`;
  }
  const shop = body?.shop?.trim();
  if (shop && !msg.includes(shop)) msg = `${msg} (shop ${shop})`;
  const vars = (body?.unknown_vars ?? []).filter((v) => typeof v === "string" && v && !msg.includes(v));
  if (vars.length > 0) msg = `${msg} — biến không hợp lệ: ${vars.join(", ")}`;
  return msg;
}

// ---- §13 Bỏ đơn khỏi danh sách gửi tay ----

export interface ManualSendInput {
  /** Mọi mã đang chọn (kể cả mã ở trang chưa tải — không biết đơn nên luôn gửi). */
  selectionIds: string[];
  /** Dòng đang có của các mã đã chọn. */
  rows: Pick<DeliveryTracking, "id" | "orders">[];
  /** order_id người dùng bỏ tích (khoá theo order_id như API `exclude_order_ids`). */
  excluded: ReadonlySet<string>;
  templateId: string;
  /** Nội dung ô soạn — trim rỗng ⇒ bỏ field (Mera dùng template_id). */
  message: string;
  /** project_id đã map của bộ lọc; null = không giới hạn. */
  projectId: string | null;
}

export interface ManualSendPlan {
  request: ReviewRequestSendRequest;
  /** Số đơn (order_id khác nhau) trên các dòng đang có. */
  total: number;
  /** Trong total: số đơn còn tích (sẽ gửi). */
  included: number;
}

/**
 * Body gửi tay sau khi bỏ đơn (plan §13): mã có đơn mà MỌI đơn bị bỏ tích ⇒ bỏ khỏi `ids`; mã còn
 * ít nhất 1 đơn ⇒ giữ, và các đơn bị bỏ của mã đó vào `exclude_order_ids` (vắng khi rỗng). Mã không
 * có dòng (trang khác) / không có đơn ⇒ giữ nguyên (Mera quyết, vd `no_orders`).
 */
export function buildManualSendPlan(input: ManualSendInput): ManualSendPlan {
  const rowById = new Map(input.rows.map((r) => [r.id, r]));
  const all = new Set<string>();
  const ids: string[] = [];
  const exclude = new Set<string>();
  for (const id of input.selectionIds) {
    const orders = rowById.get(id)?.orders ?? [];
    for (const o of orders) all.add(o.order_id);
    const kept = orders.filter((o) => !input.excluded.has(o.order_id));
    if (orders.length > 0 && kept.length === 0) continue;
    ids.push(id);
    for (const o of orders) if (input.excluded.has(o.order_id)) exclude.add(o.order_id);
  }
  const text = input.message.trim();
  const request: ReviewRequestSendRequest = {
    ids,
    template_id: input.templateId,
    ...(text ? { message: text } : {}),
    ...(exclude.size > 0 ? { exclude_order_ids: [...exclude] } : {}),
    ...(input.projectId ? { project_id: input.projectId } : {}),
  };
  let included = 0;
  for (const oid of all) if (!input.excluded.has(oid)) included++;
  return { request, total: all.size, included };
}
