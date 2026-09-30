import type { NextRequest } from "next/server";
import type { AnalyticsOpts } from "@/lib/services/analytics";
import type { CompletedScope } from "@/lib/types/etsy";

/** Độ dài tối đa tên tag nhận ở query `tag=` (khớp PINNED_TAG_MAX_LENGTH). */
const SCOPE_TAG_MAX_LENGTH = 100;

/** Parse from/to (unix giây) + shopIds từ query string của 1 request analytics. */
export function parseAnalyticsParams(req: NextRequest): AnalyticsOpts {
  const sp = req.nextUrl.searchParams;

  const num = (key: string): number | null => {
    const raw = sp.get(key);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const shopIdsRaw = sp.get("shopIds");
  const shopIds = shopIdsRaw
    ? shopIdsRaw.split(",").map(Number).filter(Number.isFinite)
    : [];

  return { from: num("from"), to: num("to"), shopIds };
}

/**
 * Parse phạm vi danh sách "tin đã xong": đúng 1 trong `tag=<tên>` | `untagged=1` | `shopId=<int ≥ 0>`.
 * Trả `{ error }` để route map 400. `tag` KHÔNG trim — phải khớp y hệt giá trị tag trong DB
 * (chỉ từ chối rỗng/toàn khoảng trắng). shopId=0 hợp lệ = dòng "Chưa xác định shop".
 */
export function parseCompletedScope(req: NextRequest): CompletedScope | { error: string } {
  const sp = req.nextUrl.searchParams;
  const tag = sp.get("tag");
  const untagged = sp.get("untagged");
  const shopIdRaw = sp.get("shopId");

  const given = [tag, untagged, shopIdRaw].filter((v) => v !== null).length;
  if (given !== 1) {
    return { error: "cần đúng 1 trong các tham số: tag, untagged, shopId" };
  }

  if (tag !== null) {
    if (!tag.trim()) return { error: "tag không được rỗng" };
    if (tag.length > SCOPE_TAG_MAX_LENGTH) {
      return { error: `tag tối đa ${SCOPE_TAG_MAX_LENGTH} ký tự` };
    }
    return { kind: "tag", tag };
  }

  if (untagged !== null) {
    if (untagged !== "1") return { error: "untagged chỉ nhận giá trị 1" };
    return { kind: "untagged" };
  }

  // Chỉ nhận chuỗi chữ số thuần: Number("") = 0, Number(" 5") = 5, Number("1e3") = 1000
  // đều "hợp lệ" với Number() nhưng không phải shopId người dùng gửi.
  const raw = shopIdRaw ?? "";
  if (!/^\d+$/.test(raw)) return { error: "shopId phải là số nguyên ≥ 0" };
  const shopId = Number(raw);
  if (!Number.isSafeInteger(shopId)) return { error: "shopId phải là số nguyên ≥ 0" };
  return { kind: "shop", shopId };
}
