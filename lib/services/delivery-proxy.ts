import "server-only";

import { asNumber, firstString, getPath } from "@/lib/services/etsy-utils";
import { meraFetch, type MeraFetchInit } from "@/lib/services/mera-order";
import type {
  BulkRefreshJob,
  DeliveryApiErrorBody,
  DeliveryProject,
  DeliveryProjectsResponse,
  DeliveryStoreCount,
  DeliveryTracking,
  DeliveryTrackingDetail,
  DeliveryTrackingListResponse,
} from "@/lib/types/delivery";

/**
 * Proxy MỎNG tới màn tracking của Mera (`/api/v2/delivery-trackings/*`) cho trang /delivery
 * (contract _workspace/01 §3). dora-1 không có role (A1): mọi gọi dùng internal key (thấy mọi
 * project + Dora), `X-Actor-Email` = email session để Mera ghi audit đúng người.
 *
 * Nguyên tắc: KHÔNG map field (types mirror nguyên snake_case Mera), KHÔNG validate lại tham số
 * (Mera validate, trả code để FE phân nhánh) — chỉ (1) chuẩn hoá mảng/obj có thể vắng để FE khỏi
 * phải `?? []` khắp nơi, (2) chuyển tiếp NGUYÊN body lỗi Mera, (3) đổi lỗi "hạ tầng" sang code riêng.
 */

/** Lỗi đã có body + status cuối cùng cho FE — route trả nguyên (lib/http/delivery-error.ts). */
export class DeliveryProxyError extends Error {
  status: number;
  body: DeliveryApiErrorBody;
  constructor(status: number, body: DeliveryApiErrorBody) {
    super(body.error);
    this.name = "DeliveryProxyError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Refresh 1 mã: Mera đọc Etsy qua extension (≤45s/shop) rồi đọc review → cần lâu hơn mặc định 15s.
 * 55s (không phải 60s) để còn biên trả 502 mera_unavailable trước khi route chạm maxDuration = 60.
 */
const REFRESH_TIMEOUT_MS = 55_000;

const BASE = "/api/v2/delivery-trackings";

/** Key query list được chuyển tiếp (contract §3.1) — chặn param lạ lọt sang Mera. */
const LIST_QUERY_KEYS = [
  "project_id",
  "status",
  "q",
  "store",
  "provider",
  "date_field",
  "from",
  "to",
  "review",
  "rating",
  "sort",
  "page",
  "limit",
] as const;

type Json = Record<string, unknown>;

function isPlainObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function objects(v: unknown): Json[] {
  return asArray(v).filter(isPlainObject);
}

function badResponse(status: number): DeliveryProxyError {
  return new DeliveryProxyError(502, {
    error: `Mera trả phản hồi không hợp lệ (${status})`,
    code: "mera_bad_response",
  });
}

/**
 * Gọi Mera + ánh xạ lỗi theo bảng §3.2. 2xx → body object; còn lại throw DeliveryProxyError.
 * Lỗi mạng/thiếu env: meraFetch tự throw MeraApiError (502 mera_unavailable / 503 mera_not_configured).
 * Export cho các proxy Mera khác (review-request-proxy.ts) dùng chung đúng bảng lỗi này.
 */
export async function callMera(path: string, init: MeraFetchInit): Promise<Json> {
  const { status, data } = await meraFetch(path, init);
  if (status >= 200 && status < 300) {
    if (!isPlainObject(data)) throw badResponse(status);
    return data;
  }
  // 401 từ Mera = internal key bị từ chối. KHÔNG chuyển tiếp 401: FE coi 401 là hết phiên dora-1.
  if (status === 401) {
    throw new DeliveryProxyError(502, { error: "Mera từ chối khoá nội bộ", code: "mera_auth_failed" });
  }
  // Lỗi nghiệp vụ Mera ({error, code, shop, retry_after…}) → giữ NGUYÊN status + body để FE phân nhánh.
  if (status >= 400 && isPlainObject(data) && typeof data.error === "string") {
    throw new DeliveryProxyError(status, data as unknown as DeliveryApiErrorBody);
  }
  // Không phải JSON / thiếu `error` (vd route chưa deploy → gin 404 dạng text) → lỗi phản hồi.
  throw badResponse(status);
}

/** orders[] luôn là mảng, mỗi order có items[] — Mera có thể bỏ field khi rỗng (omitempty / nil slice). */
function normalizeTracking<T extends Json>(t: T): T & { orders: Json[] } {
  return {
    ...t,
    orders: objects(t.orders).map((o) => ({ ...o, items: objects(o.items) })),
  };
}

/** Detail/refresh: bóc `{tracking}` nếu Mera bọc (giữ review_check/review_error ở ngoài), events luôn mảng. */
function normalizeDetail(data: Json): DeliveryTrackingDetail {
  let doc: Json = data;
  if (isPlainObject(data.tracking)) {
    doc = { ...data.tracking };
    if (data.review_check !== undefined && doc.review_check === undefined) doc.review_check = data.review_check;
    if (data.review_error !== undefined && doc.review_error === undefined) doc.review_error = data.review_error;
  }
  const out = { ...normalizeTracking(doc), events: objects(doc.events) };
  // Pass-through: shape còn lại đúng hợp đồng Mera (lib/types/delivery.ts phần A).
  return out as unknown as DeliveryTrackingDetail;
}

/** Job bulk: mảng shops/no_receipt luôn có (FE đọc thẳng). */
function normalizeJob(data: Json): BulkRefreshJob {
  return {
    ...data,
    shops: objects(data.shops),
    no_receipt: asArray(data.no_receipt).filter((s): s is string => typeof s === "string"),
  } as unknown as BulkRefreshJob;
}

/** GET /api/v2/delivery-trackings — chuyển tiếp query whitelist, chuẩn hoá mảng. */
export async function listDeliveryTrackings(
  query: URLSearchParams,
  actorEmail: string,
): Promise<DeliveryTrackingListResponse> {
  const qs = new URLSearchParams();
  for (const key of LIST_QUERY_KEYS) {
    for (const v of query.getAll(key)) qs.append(key, v);
  }
  const s = qs.toString();
  const data = await callMera(s ? `${BASE}?${s}` : BASE, { actorEmail });

  const items = objects(data.items).map(normalizeTracking) as unknown as DeliveryTracking[];
  return {
    items,
    total: asNumber(data.total) ?? 0,
    page: asNumber(data.page) ?? 1,
    limit: asNumber(data.limit) ?? 0,
    counts: (isPlainObject(data.counts) ? data.counts : {}) as DeliveryTrackingListResponse["counts"],
    stores: objects(data.stores) as unknown as DeliveryTrackingListResponse["stores"],
    providers: objects(data.providers) as unknown as DeliveryTrackingListResponse["providers"],
  };
}

/** GET /api/v2/delivery-trackings/:id */
export async function getDeliveryTracking(id: string, actorEmail: string): Promise<DeliveryTrackingDetail> {
  const data = await callMera(`${BASE}/${encodeURIComponent(id)}`, { actorEmail });
  return normalizeDetail(data);
}

/** POST /api/v2/delivery-trackings/:id/refresh — đọc Etsy ngay (timeout 55s). */
export async function refreshDeliveryTracking(
  id: string,
  actorEmail: string,
): Promise<DeliveryTrackingDetail> {
  const data = await callMera(`${BASE}/${encodeURIComponent(id)}/refresh`, {
    method: "POST",
    actorEmail,
    timeoutMs: REFRESH_TIMEOUT_MS,
  });
  return normalizeDetail(data);
}

/** POST /api/v2/delivery-trackings/bulk-refresh — Mera trả 202 + job (có thể `done` ngay). */
export async function startBulkRefresh(ids: string[], actorEmail: string): Promise<BulkRefreshJob> {
  const data = await callMera(`${BASE}/bulk-refresh`, { method: "POST", body: { ids }, actorEmail });
  return normalizeJob(data);
}

/** GET /api/v2/delivery-trackings/bulk-refresh/:job */
export async function getBulkRefreshJob(jobId: string, actorEmail: string): Promise<BulkRefreshJob> {
  const data = await callMera(`${BASE}/bulk-refresh/${encodeURIComponent(jobId)}`, { actorEmail });
  return normalizeJob(data);
}

/**
 * Shop Dora trên Mera. Lỗi BẤT KỲ (endpoint chưa deploy, rollout lag, Mera down) → null để FE ẩn
 * option Dora thay vì làm hỏng cả select Project — list "Tất cả" vẫn chạy được (contract §7.2).
 */
async function fetchDoraShops(actorEmail: string): Promise<DeliveryStoreCount[] | null> {
  try {
    const { status, data } = await meraFetch(`${BASE}/dora-shops`, { actorEmail });
    if (status !== 200) return null;
    const raw = getPath(data, "shops");
    if (!Array.isArray(raw)) return null;
    const shops = raw
      .map((s) => ({ store: firstString(s, ["store"]), count: asNumber(getPath(s, "count")) ?? 0 }))
      .filter((s) => s.store !== "");
    shops.sort((a, b) => a.store.localeCompare(b.store));
    return shops;
  } catch {
    return null;
  }
}

/**
 * Nguyên liệu select Project: project Mera (`GET /api/v1/projects`, internal key = mọi project)
 * + shop Dora, gọi song song. Lỗi projects → cả route lỗi (ánh xạ §3.2); lỗi dora-shops → null.
 */
export async function getDeliveryProjects(actorEmail: string): Promise<DeliveryProjectsResponse> {
  const [data, doraShops] = await Promise.all([
    callMera("/api/v1/projects", { actorEmail }),
    fetchDoraShops(actorEmail),
  ]);
  // Chỉ giữ {id,name} — bỏ team_member_ids (không cần cho UI, tránh lộ danh sách thành viên).
  const projects: DeliveryProject[] = asArray(data.projects)
    .map((p) => ({ id: firstString(p, ["id"]), name: firstString(p, ["name"]) }))
    .filter((p) => p.id !== "");
  projects.sort((a, b) => a.name.localeCompare(b.name));
  return { projects, doraShops };
}
