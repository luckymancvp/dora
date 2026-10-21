import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { after } from "next/server";
import type { Filter, ObjectId } from "mongodb";
import { getSheetConfigsCollection, getSheetRowsCollection } from "@/lib/db/collections";
import { listCarrierRules } from "@/lib/services/carrier-rule";
import { asNumber, firstString, getPath, isObject } from "@/lib/services/etsy-utils";
import { MeraApiError, meraFetch } from "@/lib/services/mera-order";
import { evaluateCarrierRules, type CarrierRule } from "@/lib/types/carrier-rule";
import {
  DELIVERY_PUSH_ACTOR,
  DELIVERY_PUSH_CHUNK_SIZE,
  DELIVERY_PUSH_SOURCE,
  DELIVERY_PUSH_WINDOW_DAYS,
  type DeliveryPushApplied,
  type DeliveryPushRequest,
  type DeliveryPushResult,
  type DeliveryPushRow,
} from "@/lib/types/delivery";
import type { SheetRowDoc } from "@/lib/types/sheets";

/**
 * Đẩy mã tracking từ `sheet_rows` (đã sync từ Google Sheet) sang Mera —
 * `POST /api/v2/delivery-trackings/external-refs` (plan Mera §4, contract _workspace/01 §2).
 *
 * Mỗi sheet_config = 1 "scope" trên Mera; mỗi lượt gửi TOÀN BỘ snapshot của scope (chia chunk 1000),
 * Mera tự so với snapshot trước để tạo/giữ/gỡ ref. Vì vậy:
 *  - KHÔNG lọc Status ở đây (Mera cần thấy dòng DELIVERED/CANCELLED để giữ/gỡ ref — D3/D7).
 *  - Chỉ đọc `sheet_rows` có sẵn, không gọi Google (A4) — cron chỉ đẩy dữ liệu đã sync.
 *  - Hàm public KHÔNG throw: push là việc phụ, không bao giờ được làm hỏng sync sheet hay cron.
 */

/** Khoá push coi là treo sau 15 phút (process chết giữa chừng / after() bị cắt bởi maxDuration). */
export const DELIVERY_PUSH_STALE_LOCK_MS = 15 * 60_000;

/** Hash trùng nhưng lần push thành công đã quá 24h → vẫn gửi lại (A6, lưới an toàn). */
const RESEND_AFTER_MS = 24 * 60 * 60_000;

/** Timeout chunk giữa: Mera chỉ lưu tạm chunk vào `delivery_external_snapshots` — nhanh. */
const CHUNK_TIMEOUT_MS = 30_000;

/**
 * Chunk CUỐI: Mera chờ khoá scope (≤20s) rồi áp cả snapshot (≈19k dòng) trong cùng request nên
 * cần lâu hơn. Mera áp tiếp kể cả khi dora-1 ngắt, và gửi lại NGUYÊN body chunk cuối sẽ nhận kết
 * quả đã lưu (đã áp → cùng 200) (Mera delivery_external_refs.go). Vì vậy ở chunk cuối, các phản hồi
 * "tạm thời" sau được GỬI LẠI thay vì coi là lỗi (nếu không, lượt sau dựng snapshot mới ⇒ Mera áp
 * lại từ đầu): timeout/mạng (mera_unavailable), 202 applying, 409 scope_busy, 502 mera_shops_unavailable
 * (snapshot vẫn pending, gửi lại = thử áp lại).
 *
 * Tối đa 3 lần gửi lại, chờ 10/15/20s; riêng scope_busy chờ đúng `retry_after` Mera gợi ý (60s).
 * Mọi lần chờ phải lọt NGÂN SÁCH 225s tính từ lần gửi chunk cuối đầu tiên (gồm cả timeout 45s của
 * lần gửi kế) — không lọt thì bỏ, outcome failed, cron 30 phút thử lại. 225s < maxDuration 300 cron.
 */
const LAST_CHUNK_TIMEOUT_MS = 45_000;
const LAST_CHUNK_RETRY_DELAYS_MS = [10_000, 15_000, 20_000] as const;
const LAST_CHUNK_BUDGET_MS = 225_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Giờ VN cố định +07:00, không DST (D9). */
const VN_OFFSET_MS = 7 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** Cột sheet cần cho push — projection để không kéo cả `values` (hàng chục cột/dòng × ~19k dòng). */
const PUSH_ROW_PROJECTION = {
  itemId: 1,
  order: 1,
  receiptKey: 1,
  store: 1,
  "values.Tracking": 1,
  "values.Status": 1,
  "values.Date": 1,
  "values.Time": 1,
  "values.Product Name": 1,
  "values.Bên in": 1,
} as const;

/**
 * Lọc SƠ BỘ phía Mongo để khỏi kéo ~19k dòng/lượt (sync gọi push ~2 phút/config). Chỉ loại dòng mà
 * `buildDeliveryPushRows` CHẮC CHẮN cũng loại — JS vẫn là nguồn sự thật (lọc lại đầy đủ):
 *  - Tracking rỗng/thiếu.
 *  - Date đúng "YYYY-MM-DD" (không khoảng trắng) và < ngày của window_from (so chuỗi = so ngày)
 *    VÀ Time hợp lệ hoặc rỗng — khi đó paid_at parse được và chắc chắn < window_from.
 *    Date/Time sai định dạng (paid_at null, A7) đều được GIỮ để vẫn gửi Mera.
 * Lệch duy nhất có thể: ngày đúng định dạng nhưng không tồn tại (vd "2025-02-30") cũ hơn cửa sổ —
 * JS gửi với paid_at null, Mongo bỏ. Mera đằng nào cũng bỏ dòng đó (skipped_invalid), chỉ lệch số đếm.
 * `\s` của Mongo (PCRE) hẹp hơn `trim()` JS → khoảng trắng lạ chỉ làm GIỮ thêm dòng (an toàn).
 */
function pushRowsFilter(configId: ObjectId, windowFromIso: string): Filter<SheetRowDoc> {
  const windowDate = windowFromIso.slice(0, 10);
  return {
    configId,
    "values.Tracking": { $nin: ["", null] },
    $or: [
      { "values.Date": { $gte: windowDate } },
      { "values.Date": { $not: /^\d{4}-\d{2}-\d{2}$/ } },
      { "values.Time": { $not: /^\s*(([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?)?\s*$/ } },
    ],
  };
}

/**
 * Cờ bật push (A5) — env `DELIVERY_PUSH`:
 *  unset / "" / "off" → tắt; "*" → mọi config; còn lại = danh sách configId hex phân tách dấu phẩy.
 * Danh sách id phục vụ bước rollout "push một scope trước" (plan §6). Mặc định TẮT.
 */
export function isDeliveryPushEnabledFor(configId: string): boolean {
  const raw = (process.env.DELIVERY_PUSH ?? "").trim();
  if (!raw || raw.toLowerCase() === "off") return false;
  if (raw === "*") return true;
  const id = configId.trim().toLowerCase();
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .some((s) => s !== "" && s === id);
}

/** "YYYY-MM-DD" của ngày VN chứa thời điểm `ms`. */
function vnDateString(ms: number): string {
  return new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Mốc cửa sổ 60 ngày (A6/D6) = 00:00 giờ VN của (hôm nay VN − 60 ngày).
 * Cố định theo NGÀY (không theo giờ) để hash ổn định trong ngày; sang ngày mới hash đổi
 * ⇒ snapshot tự gửi lại ≥1 lần/ngày, Mera trượt cửa sổ đóng băng ref cũ.
 */
export function deliveryWindowFrom(now: Date = new Date()): { iso: string; at: Date } {
  const day = vnDateString(now.getTime() - DELIVERY_PUSH_WINDOW_DAYS * DAY_MS);
  const iso = `${day}T00:00:00+07:00`;
  return { iso, at: new Date(Date.parse(iso)) };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Date ("YYYY-MM-DD") + Time ("H:mm:ss" | "HH:mm" | rỗng → 00:00:00) của sheet → RFC3339 giờ VN (D9).
 * STRICT: sai định dạng / ngày không tồn tại (2026-02-30) → null. Dòng null vẫn được gửi (A7) để
 * Mera đếm `skipped_invalid` — quan sát được thay vì dòng biến mất im lặng.
 */
export function sheetPaidAt(date: string, time: string): string | null {
  const d = (date ?? "").trim();
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!dm) return null;
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const da = Number(dm[3]);
  // Round-trip qua Date.UTC để loại ngày tràn (JS tự "cuộn" 02-30 → 03-02).
  const probe = new Date(Date.UTC(y, mo - 1, da));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== da) {
    return null;
  }

  const t = (time ?? "").trim();
  let hh = 0;
  let mm = 0;
  let ss = 0;
  if (t !== "") {
    const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
    if (!tm) return null;
    hh = Number(tm[1]);
    mm = Number(tm[2]);
    ss = tm[3] !== undefined ? Number(tm[3]) : 0;
    if (hh > 23 || mm > 59 || ss > 59) return null;
  }
  return `${d}T${pad2(hh)}:${pad2(mm)}:${pad2(ss)}+07:00`;
}

/**
 * Cột "Bên in" → provider. Cột này hay bị gõ nhầm số (giá/cân nặng như "21.5", "3") —
 * số thuần không phải tên bên in nên bỏ thành "" (plan §3).
 */
export function cleanSheetProvider(raw: string): string {
  const v = (raw ?? "").trim();
  return /^\d+([.,]\d+)?$/.test(v) ? "" : v;
}

/** Ô sheet → string đã có (projection/sync có thể thiếu key hoặc lưu kiểu khác). */
function cell(values: unknown, header: string): string {
  if (!isObject(values)) return "";
  const v = (values as Record<string, unknown>)[header];
  return typeof v === "string" ? v : "";
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Map `sheet_rows` → rows push (thuần, không I/O). Giữ dòng có Tracking, MỌI Status;
 * bỏ dòng paid_at < windowFrom (D6) nhưng GIỮ dòng paid_at null (A7). Kết quả đã sort
 * (item_id rồi code) để hash ổn định bất kể thứ tự Mongo trả về.
 */
export function buildDeliveryPushRows(
  rows: SheetRowDoc[],
  rules: CarrierRule[],
  windowFrom: Date,
): DeliveryPushRow[] {
  const windowMs = windowFrom.getTime();
  const out: DeliveryPushRow[] = [];

  for (const r of rows) {
    // Ô nhiều mã ("A, B") gửi nguyên chuỗi đã trim — Mera đánh dấu invalid (contract §7.3).
    const code = cell(r.values, "Tracking").trim();
    if (!code) continue;
    const itemId = str(r.itemId);
    if (!itemId) continue;

    const paidAt = sheetPaidAt(cell(r.values, "Date"), cell(r.values, "Time"));
    if (paidAt !== null && Date.parse(paidAt) < windowMs) continue;

    out.push({
      item_id: itemId,
      // Cột "Order" có thể trống ở sheet cũ → suy từ Item ID (prefix-receipt-tx) bỏ đoạn "-<tx>" cuối.
      order_id: str(r.order) || itemId.replace(/-\d+$/, ""),
      etsy_receipt_id: str(r.receiptKey),
      store: str(r.store),
      code,
      carrier: evaluateCarrierRules(code, rules)?.carrier ?? "",
      sheet_status: cell(r.values, "Status").trim().toUpperCase(),
      product_name: cell(r.values, "Product Name").trim(),
      provider: cleanSheetProvider(cell(r.values, "Bên in")),
      paid_at: paidAt,
    });
  }

  // So sánh code-unit (không localeCompare) — thứ tự phải tất định giữa các máy/ICU để hash ổn định.
  out.sort((a, b) =>
    a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0,
  );
  return out;
}

/** sha256 hex của [window_from, rows đã sort] — gồm window_from nên đổi ngày là hash đổi (A6). */
export function deliveryPushHash(windowFromIso: string, rows: DeliveryPushRow[]): string {
  return createHash("sha256").update(JSON.stringify([windowFromIso, rows])).digest("hex");
}

/** Đọc `applied` phòng thủ — Mera mới viết, đừng tin shape tuyệt đối. */
function parseApplied(raw: unknown): DeliveryPushApplied | null {
  if (!isObject(raw)) return null;
  const n = (k: string) => asNumber(getPath(raw, k)) ?? 0;
  return {
    rows: n("rows"),
    upserted_refs: n("upserted_refs"),
    removed_refs: n("removed_refs"),
    new_codes: n("new_codes"),
    skipped_mera_shop: n("skipped_mera_shop"),
    skipped_invalid: n("skipped_invalid"),
  };
}

/** "<httpStatus> <code>: <message>" — giới hạn độ dài vì ghi vào sheet_configs. */
function formatPushError(status: number, code: string, message: string): string {
  return `${status} ${code || "-"}: ${message || "-"}`.slice(0, 500);
}

/**
 * Kết quả gửi 1 chunk. `retry` chỉ xuất hiện ở chunk cuối (gửi lại nguyên body).
 * `responded` = Mera có trả HTTP (để đếm `chunks` trong kết quả).
 */
type ChunkReply =
  | { kind: "accepted"; responded: true }
  | { kind: "done"; applied: DeliveryPushApplied; responded: true }
  /** `retryAfterMs`: Mera gợi ý chờ bao lâu (scope_busy.retry_after); vắng → lịch chờ mặc định. */
  | { kind: "retry"; error: string; responded: boolean; retryAfterMs?: number }
  | { kind: "superseded"; error: string; responded: true }
  | { kind: "failed"; error: string; responded: boolean };

/** Gửi 1 chunk + phân loại phản hồi theo contract §2.3 (và luật gửi lại chunk cuối). */
async function sendChunk(body: DeliveryPushRequest, isLast: boolean): Promise<ChunkReply> {
  const where = `chunk ${body.chunk}/${body.chunk_total}`;
  let status: number;
  let data: unknown;
  try {
    ({ status, data } = await meraFetch("/api/v2/delivery-trackings/external-refs", {
      method: "POST",
      body,
      actorEmail: DELIVERY_PUSH_ACTOR,
      timeoutMs: isLast ? LAST_CHUNK_TIMEOUT_MS : CHUNK_TIMEOUT_MS,
    }));
  } catch (err) {
    const e = err instanceof MeraApiError ? err : null;
    const error = formatPushError(
      e?.status ?? 500,
      e?.code ?? "",
      `${err instanceof Error ? err.message : String(err)} (${where})`,
    );
    // Timeout/mạng ở chunk cuối: Mera có thể vẫn đang áp → gửi lại để lấy kết quả đã lưu.
    // Thiếu env (mera_not_configured) thì gửi lại vô ích.
    if (isLast && e?.code === "mera_unavailable") return { kind: "retry", error, responded: false };
    return { kind: "failed", error, responded: false };
  }

  const code = firstString(data, ["code"]);
  const message = firstString(data, ["error", "message"]);

  if (status === 409 && code === "snapshot_superseded") {
    // Đã có snapshot mới hơn cho scope này (lượt khác chạy sau) — dừng, không phải lỗi thật.
    return { kind: "superseded", error: formatPushError(status, code, message), responded: true };
  }
  if (isLast && status === 409 && code === "scope_busy") {
    // Snapshot KHÁC của cùng scope đang được áp — chờ `retry_after` rồi gửi lại chunk cuối.
    const retryAfterS = asNumber(getPath(data, "retry_after"));
    return {
      kind: "retry",
      error: formatPushError(status, code, message),
      responded: true,
      retryAfterMs: retryAfterS !== undefined && retryAfterS > 0 ? retryAfterS * 1000 : undefined,
    };
  }
  if (isLast && status === 502 && code === "mera_shops_unavailable") {
    // Mera chưa lấy được danh sách shop từ admin — snapshot vẫn pending, gửi lại = thử áp lại.
    return { kind: "retry", error: formatPushError(status, code, message), responded: true };
  }
  if (status >= 400) {
    return { kind: "failed", error: formatPushError(status, code, message || where), responded: true };
  }
  if (!isLast) {
    if (status === 202 && getPath(data, "done") === false) return { kind: "accepted", responded: true };
    return {
      kind: "failed",
      error: formatPushError(status, "unexpected_response", `${where} kỳ vọng 202 done:false`),
      responded: true,
    };
  }
  const applied = parseApplied(getPath(data, "applied"));
  if (status === 200 && getPath(data, "done") === true && applied) {
    return { kind: "done", applied, responded: true };
  }
  if (status === 202 && getPath(data, "done") === false && getPath(data, "applying") === true) {
    // Chính snapshot này đang được áp bởi request trước (đã timeout phía dora-1).
    return { kind: "retry", error: formatPushError(status, "applying", `${where} Mera đang áp dụng`), responded: true };
  }
  return {
    kind: "failed",
    error: formatPushError(status, "unexpected_response", `${where} kỳ vọng 200 done:true`),
    responded: true,
  };
}

function emptyResult(
  configId: string,
  title: string,
  outcome: DeliveryPushResult["outcome"],
  error: string | null = null,
): DeliveryPushResult {
  return { configId, title, outcome, rows: 0, chunks: 0, applied: null, error };
}

function logResult(r: DeliveryPushResult): void {
  const tail = r.applied
    ? ` applied=${JSON.stringify(r.applied)}`
    : r.error
      ? ` error=${r.error}`
      : "";
  const line = `[delivery-push] config=${r.configId} outcome=${r.outcome} rows=${r.rows} chunks=${r.chunks}${tail}`;
  if (r.outcome === "failed") console.error(line);
  else console.log(line);
}

/**
 * Gửi snapshot của 1 sheet_config sang Mera (contract §2.3). KHÔNG throw — mọi lỗi thành outcome
 * `failed` + ghi `deliveryPushError`. `force` bỏ qua luật "hash trùng & < 24h".
 */
export async function pushDeliveryForConfig(
  configId: ObjectId,
  opts?: { force?: boolean },
): Promise<DeliveryPushResult> {
  const idHex = configId.toHexString();
  let title = "";
  let lockAt: Date | null = null;

  try {
    const configs = await getSheetConfigsCollection();
    const cfg = await configs.findOne(
      { _id: configId },
      { projection: { title: 1, enabled: 1, deliveryPushHash: 1, deliveryPushedAt: 1 } },
    );
    title = cfg?.title ?? "";
    if (!cfg || cfg.enabled === false || !isDeliveryPushEnabledFor(idHex)) {
      return emptyResult(idHex, title, "disabled");
    }

    // Chiếm khoá atomic: 2 lượt (after-sync + cron, hoặc 2 instance) cùng config không được gửi
    // song song — snapshot sau sẽ làm Mera trả superseded cho snapshot trước, tốn công vô ích.
    const now = new Date();
    const claim = await configs.updateOne(
      {
        _id: configId,
        $or: [
          { deliveryPushStartedAt: null },
          { deliveryPushStartedAt: { $exists: false } },
          { deliveryPushStartedAt: { $lt: new Date(now.getTime() - DELIVERY_PUSH_STALE_LOCK_MS) } },
        ],
      },
      { $set: { deliveryPushStartedAt: now } },
    );
    if (claim.matchedCount === 0) {
      const r = emptyResult(idHex, title, "skipped_locked");
      logResult(r);
      return r;
    }
    lockAt = now;

    const window = deliveryWindowFrom(now);
    const rowsColl = await getSheetRowsCollection();
    const [sheetRows, rules] = await Promise.all([
      rowsColl.find(pushRowsFilter(configId, window.iso), { projection: PUSH_ROW_PROJECTION }).toArray(),
      listCarrierRules(),
    ]);
    const rows = buildDeliveryPushRows(sheetRows, rules, window.at);
    const hash = deliveryPushHash(window.iso, rows);

    const pushedAtMs = cfg.deliveryPushedAt ? new Date(cfg.deliveryPushedAt).getTime() : 0;
    if (
      !opts?.force &&
      cfg.deliveryPushHash === hash &&
      pushedAtMs > now.getTime() - RESEND_AFTER_MS
    ) {
      await configs.updateOne(
        { _id: configId, deliveryPushStartedAt: lockAt },
        { $set: { deliveryPushStartedAt: null } },
      );
      lockAt = null;
      const r = emptyResult(idHex, title, "skipped_unchanged");
      logResult(r);
      return r;
    }

    // Snapshot rỗng vẫn gửi 1 chunk rows:[] để Mera gỡ ref trong cửa sổ khi sheet bị xoá sạch (A8).
    const snapshotId = randomUUID();
    const chunkTotal = Math.max(1, Math.ceil(rows.length / DELIVERY_PUSH_CHUNK_SIZE));
    let applied: DeliveryPushApplied | null = null;
    let outcome: DeliveryPushResult["outcome"] = "pushed";
    let error: string | null = null;
    let sent = 0;

    for (let chunk = 1; chunk <= chunkTotal; chunk++) {
      const isLast = chunk === chunkTotal;
      const body: DeliveryPushRequest = {
        source: DELIVERY_PUSH_SOURCE,
        scope: idHex,
        snapshot_id: snapshotId,
        chunk,
        chunk_total: chunkTotal,
        window_from: window.iso,
        rows: rows.slice((chunk - 1) * DELIVERY_PUSH_CHUNK_SIZE, chunk * DELIVERY_PUSH_CHUNK_SIZE),
      };

      const lastDeadline = Date.now() + LAST_CHUNK_BUDGET_MS;
      let reply = await sendChunk(body, isLast);
      if (reply.responded) sent = chunk;
      // Chunk cuối: gửi lại NGUYÊN body (cùng snapshot_id) — Mera trả kết quả đã lưu khi áp xong.
      // (`retry` chỉ sinh ở chunk cuối nên vòng này không chạy cho chunk giữa.)
      let resends = 0;
      while (reply.kind === "retry" && resends < LAST_CHUNK_RETRY_DELAYS_MS.length) {
        const wait = reply.retryAfterMs ?? LAST_CHUNK_RETRY_DELAYS_MS[resends];
        // Chờ + 1 lần gửi (tối đa timeout) phải lọt ngân sách, không thì bỏ cho cron thử lại.
        if (Date.now() + wait + LAST_CHUNK_TIMEOUT_MS > lastDeadline) break;
        await sleep(wait);
        resends++;
        reply = await sendChunk(body, true);
        if (reply.responded) sent = chunk;
      }

      if (reply.kind === "accepted") continue;
      if (reply.kind === "done") {
        applied = reply.applied;
        break;
      }
      if (reply.kind === "superseded") {
        outcome = "superseded";
        error = reply.error;
        break;
      }
      // failed, hoặc retry đã hết lượt (Mera vẫn đang áp / scope bận / mạng) → lượt sau thử lại.
      outcome = "failed";
      error =
        reply.kind === "retry"
          ? `${reply.error} — bỏ sau ${resends} lần gửi lại chunk cuối`.slice(0, 500)
          : reply.error;
      break;
    }

    // Chỉ ghi khi khoá còn là của lượt này — nếu đã bị chiếm lại (treo > 15 phút) thì để lượt kia ghi.
    if (outcome === "pushed") {
      await configs.updateOne(
        { _id: configId, deliveryPushStartedAt: lockAt },
        {
          $set: {
            deliveryPushedAt: new Date(),
            deliveryPushHash: hash,
            deliveryPushError: null,
            deliveryPushApplied: applied,
            deliveryPushStartedAt: null,
          },
        },
      );
    } else {
      // KHÔNG ghi hash ⇒ lượt sau gửi lại dù dữ liệu không đổi.
      await configs.updateOne(
        { _id: configId, deliveryPushStartedAt: lockAt },
        { $set: { deliveryPushError: error, deliveryPushStartedAt: null } },
      );
    }
    lockAt = null;

    const result: DeliveryPushResult = {
      configId: idHex,
      title,
      outcome,
      rows: rows.length,
      chunks: outcome === "pushed" ? chunkTotal : sent,
      applied,
      error,
    };
    logResult(result);
    return result;
  } catch (err) {
    // Lỗi bất ngờ (Mongo…) — nhả khoá nếu đã chiếm để lượt sau không phải chờ 15 phút.
    const message = formatPushError(500, "internal_error", err instanceof Error ? err.message : String(err));
    if (lockAt) {
      try {
        const configs = await getSheetConfigsCollection();
        await configs.updateOne(
          { _id: configId, deliveryPushStartedAt: lockAt },
          { $set: { deliveryPushError: message, deliveryPushStartedAt: null } },
        );
      } catch {
        // Mongo vẫn lỗi → khoá tự hết hạn sau DELIVERY_PUSH_STALE_LOCK_MS.
      }
    }
    const r = emptyResult(idHex, title, "failed", message);
    logResult(r);
    return r;
  }
}

/**
 * Push mọi sheet_config đang bật (hoặc đúng `configId`) — TUẦN TỰ để không dội Mera nhiều snapshot
 * cùng lúc. Dùng bởi cron /api/cron/delivery-push. Không throw khi 1 config lỗi.
 */
export async function pushDeliveryAll(opts?: {
  force?: boolean;
  configId?: ObjectId;
}): Promise<DeliveryPushResult[]> {
  let ids: ObjectId[];
  if (opts?.configId) {
    ids = [opts.configId];
  } else {
    const configs = await getSheetConfigsCollection();
    const docs = await configs
      .find({ enabled: true }, { projection: { _id: 1 } })
      .sort({ order: 1 })
      .toArray();
    ids = docs.map((d) => d._id);
  }

  const results: DeliveryPushResult[] = [];
  for (const id of ids) {
    results.push(await pushDeliveryForConfig(id, { force: opts?.force }));
  }
  return results;
}

/**
 * Hẹn push sau khi sync sheet xong (contract §2.4a). KHÔNG throw.
 *
 * Tự khởi chạy promise rồi mới đưa cho `after(promise)` (không dùng `after(callback)`): nhiều đường
 * sync chạy nền và gọi tới đây SAU khi response đã đóng (sheet-order.ts, tracking-import.ts) — lúc đó
 * callback của `after` không bao giờ được gọi và promise waitUntil treo. Dạng promise: push luôn chạy,
 * `after` chỉ giữ hàm sống tới khi xong nếu còn trong request; ngoài request scope `after` throw → bỏ qua.
 */
export function scheduleDeliveryPush(configId: ObjectId): void {
  // Tắt → khỏi đọc DB sau mỗi lần sync (sync chạy ~2 phút/lần/config).
  if (!isDeliveryPushEnabledFor(configId.toHexString())) return;

  // Không bao giờ reject (pushDeliveryForConfig đã không throw; catch là lưới cuối).
  const p = pushDeliveryForConfig(configId).then(
    () => undefined,
    (err: unknown) => {
      console.error("[delivery-push] schedule", err instanceof Error ? err.message : err);
    },
  );
  try {
    after(p);
  } catch {
    // Ngoài request scope — promise đã chạy, không cần làm gì thêm.
  }
}
