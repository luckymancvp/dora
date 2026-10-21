/**
 * Link tra cứu của một mã tracking trên màn Giao hàng (chép nguyên văn
 * `mera-fulfill-frontend/src/lib/carrierTrackingUrl.ts`).
 *
 * Etsy trả `tracking_url` theo shipment (đọc qua Dora extension), nhưng (đo prod 2026-10-16):
 *   - mã ĐÃ GIAO → link của hãng (USPS, UPS, Royal Mail…), luôn chứa nguyên số tracking;
 *   - mã CHƯA GIAO (pre_shipment/transit/…) → trang của Etsy `etsy.com/your/orders/<o>/order_tracking/<s>`
 *     — chỉ mở được khi đang đăng nhập đúng shop;
 *   - UniUni / Evri / GOFO kể cả đã giao → trang chung của hãng, không kèm số.
 * Nên: link hãng có số → giữ; còn lại (trang Etsy, trang chung, không có link) → dựng link theo tên
 * hãng. Mẫu lấy đúng từ link hãng Etsy trả cho mã đã giao (thay số = {code}); riêng UniUni/Evri/GOFO
 * xác minh trên trang tra cứu của hãng:
 *   - UniUni: trang đọc `?no=`, tự điền + tự tra
 *   - Evri:   route chi tiết kiện /track/parcel/<mã>/details
 *   - GOFO:   trang đọc `?searchID=`, tự tra (giữ vùng của link Etsy, mặc định us)
 *   - Amazon Shipping (mã TBA…): Etsy không trả link lẫn sự kiện ("No tracking") → trang
 *     track.amazon.com/tracking/<mã> (user đưa 2026-10-16)
 * Hãng chưa có mẫu (FedEx, DHL, Korea Post, Stallion, SF Express, UBI…) → giữ link Etsy.
 */

const CARRIER_TEMPLATES: Record<string, string> = {
  usps: "https://tools.usps.com/go/TrackConfirmAction_input?qtc_tLabels1={code}",
  ups: "http://wwwapps.ups.com/WebTracking/processInputRequest?TypeOfInquiryNumber=T&InquiryNumber1={code}",
  "4pxworldwideexpress": "https://track.4px.com/#/result/0/{code}",
  australiapost: "http://auspost.com.au/track/track.html?id={code}",
  canadapost: "http://www.canadapost.ca/cpotools/apps/track/personal/findByTrackNumber?trackingNumber={code}",
  dhlglobalmail: "http://webtrack.dhlglobalmail.com/?trackingnumber={code}",
  laposte: "http://www.csuivi.courrier.laposte.fr/suivi/index?id={code}",
  royalmail: "https://www.royalmail.com/portal/rm/track?trackNumber={code}",
  singaporepost:
    "http://www.singpost.com/index.php?track_items={code}&option=com_tablink&controller=tracking&task=tracking&Itemid=377",
  intelcom: "https://intelcom.ca/en/track-your-package/?tracking-id={code}",
  yunexpress: "https://www.yuntrack.com/parcelTracking?id={code}",
  uniuni: "https://www.uniuni.com/tracking/?no={code}",
  evri: "https://www.evri.com/track/parcel/{code}/details",
  gofo: "https://www.gofo.com/{region}/track?searchID={code}",
  gofoexpress: "https://www.gofo.com/{region}/track?searchID={code}",
  amazonshipping: "https://track.amazon.com/tracking/{code}",
  amazon: "https://track.amazon.com/tracking/{code}",
};

function carrierKey(carrier: string): string {
  return carrier.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Link `tracking_url` là trang order_tracking của Etsy. */
function isEtsyTrackingPage(u: URL): boolean {
  return /(^|\.)etsy\.com$/i.test(u.hostname) && /\/order_tracking\//i.test(u.pathname);
}

/** Trang chung (không kèm số) của UniUni / Evri / GOFO Etsy hay trả. */
function isGenericCarrierPage(u: URL): boolean {
  if (u.search || u.hash) return false;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "").toLowerCase();
  return (
    (host === "uniuni.com" && path === "/tracking") ||
    (host === "evri.com" && path === "/track-a-parcel") ||
    (host === "gofo.com" && /^\/[a-z]{2}\/track$/.test(path))
  );
}

function genericKeyFromHost(u: URL): string | null {
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "uniuni.com") return "uniuni";
  if (host === "evri.com") return "evri";
  if (host === "gofo.com") return "gofo";
  return null;
}

type TrackingLike = { code: string; carrier?: string | null; tracking_url?: string | null };

export function carrierTrackingUrl(t: TrackingLike): string | null {
  const code = (t.code || "").trim();
  const raw = (t.tracking_url || "").trim();
  const u = raw ? parseUrl(raw) : null;
  // Link hãng cụ thể (hoặc chuỗi lạ không parse được) → giữ nguyên.
  if (raw && (!u || (!isEtsyTrackingPage(u) && !isGenericCarrierPage(u)))) return raw;
  if (!code) return raw || null;
  const key = (u && isGenericCarrierPage(u) ? genericKeyFromHost(u) : null) ?? carrierKey(t.carrier || "");
  const tpl = CARRIER_TEMPLATES[key];
  if (!tpl) return raw || null;
  const region =
    u && isGenericCarrierPage(u) ? u.pathname.match(/^\/([a-z]{2})\/track/i)?.[1]?.toLowerCase() : undefined;
  return tpl.replace("{code}", encodeURIComponent(code)).replace("{region}", region || "us");
}

/**
 * Trang tracking của Etsy khi link chính đã được thay bằng link hãng — hiện thêm chữ "Etsy" nhỏ để
 * vẫn xem được timeline Etsy. null = không có / link chính chính là trang Etsy.
 */
export function etsyTrackingPage(t: TrackingLike): string | null {
  const raw = (t.tracking_url || "").trim();
  const u = raw ? parseUrl(raw) : null;
  if (!u || !isEtsyTrackingPage(u)) return null;
  return carrierTrackingUrl(t) !== raw ? raw : null;
}
