/**
 * Dựng link tra cứu tracking. Tách riêng vì dùng ở 2 chỗ với luật khác nhau:
 * card đơn (người bán, được phép dùng link Etsy nội bộ + phương án cuối) và
 * prompt AI (gửi cho khách, chỉ nhận link hãng chính thức).
 */

/**
 * Link tracking CÔNG KHAI chính thức theo hãng — chỉ dựng cho hãng có URL
 * pattern chuẩn 100%; hãng khác trả "".
 *
 * Royal Mail dùng URL hiện hành (trang tra cứu SPA, mã nằm ở hash route) —
 * KHÔNG dùng link /portal/rm/track?trackNumber= mà Etsy còn trả trong
 * order_tracking, đó là định dạng cũ.
 *
 * Australia Post / Vietnam Post lấy nguyên pattern từ tracking_url Etsy trả
 * (không đoán) — nhưng cũng là link cũ, cần soi lại khi có mã thật để thử:
 *   Australia Post http://auspost.com.au/track/track.html?id=…
 *   Vietnam Post   http://www.vnpost.vn/TrackandTrace/tabid/130/n/…/t/2/s/1/Default.aspx
 */
export function publicTrackingUrl(carrier: string, code: string): string {
  const c = carrier.trim().toLowerCase();
  const e = encodeURIComponent(code.trim());
  if (!e) return "";
  // Định dạng mới của USPS (link cũ /go/TrackConfirmAction?tLabels= vẫn sống
  // nhưng bị redirect về đây — xác nhận bằng trình duyệt 2026-07).
  if (c.includes("usps")) return `https://tools.usps.com/tracking/${e}`;
  if (c.includes("ups")) return `https://www.ups.com/track?loc=en_US&tracknum=${e}`;
  if (c.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${e}`;
  if (c.includes("royal mail") || c.includes("royalmail")) {
    return `https://www.royalmail.com/track-your-item#/tracking-results/${e}`;
  }
  if (c.includes("australia post") || c.includes("auspost")) {
    return `http://auspost.com.au/track/track.html?id=${e}`;
  }
  if (c.includes("vietnam post") || c.includes("vnpost")) {
    return `http://www.vnpost.vn/TrackandTrace/tabid/130/n/${e}/t/2/s/1/Default.aspx`;
  }
  // 4PX: trang tra cứu SPA, mã nằm ở hash route (vd 4PX3003134890445CN).
  if (c.includes("4px")) return `https://track.4px.com/#/result/0/${e}`;
  // DHL: không có URL pattern công khai được xác nhận chắc chắn (2026-07) →
  // không dựng link ở đây (quy tắc: không chuẩn 100% thì thôi).
  return "";
}

/**
 * Link 17track — tự dò hãng từ mã. KHÔNG dùng cho prompt AI vì đây là bên thứ
 * ba, không phải trang chính thức của hãng.
 */
function universalTrackingUrl(code: string): string {
  const e = encodeURIComponent(code.trim());
  return e ? `https://t.17track.net/en#nums=${e}` : "";
}

/**
 * Link hiển thị trên card đơn (người bán bấm).
 *
 * Vì sao cần fallback: Etsy CHỈ trả tracking_url khi nhận diện được hãng. Khi
 * người bán gõ tên hãng sai/tự chế ("USSS", "uus", "UPPS"…) thì tracking_url
 * về rỗng, trước đây card render mã dạng text chết — đó là lý do có đơn bấm ra
 * link, có đơn không (phụ thuộc hãng, KHÔNG phụ thuộc trạng thái giao).
 *
 * Dùng 17track làm link CHÍNH thay vì ghép link từng hãng, vì:
 *   - luôn ra link kể cả khi người bán gõ sai/tự chế tên hãng ("USSS", "uus"…),
 *     đúng trường hợp Etsy không trả tracking_url nên trước đây mã là text chết;
 *   - không lỗi thời khi hãng đổi URL (Royal Mail đã đổi, link Etsy lưu vẫn cũ).
 * Link hãng chính thức vẫn giữ cho prompt AI qua publicTrackingUrl.
 *
 * Hai nhánh sau chỉ chạy khi không có mã (thực tế getOrderTrackingMap đã lọc bỏ
 * entry thiếu tracking_code) — giữ để hàm vẫn đúng nếu được gọi từ chỗ khác.
 */
export function resolveTrackingUrl(storedUrl: string, carrier: string, code: string): string {
  return universalTrackingUrl(code) || publicTrackingUrl(carrier, code) || storedUrl.trim();
}
