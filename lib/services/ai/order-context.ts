import type { WithId } from "mongodb";
import { getEtsyOrdersCollection } from "@/lib/db/collections";
import { mapOrder } from "@/lib/services/orders-read";
import { getOrderTrackingMap } from "@/lib/services/orders-tracking";
import type { EtsyOrderDoc, OrderListItem } from "@/lib/types/etsy";

/**
 * Giai đoạn 1 — Grounding: lấy đơn hàng THẬT của khách để AI trả lời có căn cứ
 * (tracking, ngày ship, sản phẩm) thay vì đi hỏi lại thứ nhân viên đã có.
 *
 * Join: conversation.etsy.other_user.user_id  ⇄  etsy_orders.data.buyer_id
 * (fallback data.buyer.buyer_id) — cùng khóa với order-conversation.ts.
 */

/** Số đơn gần nhất đưa vào prompt (giới hạn để tiết kiệm token). */
const MAX_ORDERS_FOR_PROMPT = 3;

/**
 * Link tracking CÔNG KHAI chính thức theo hãng — chỉ dựng cho hãng có URL
 * pattern chuẩn 100%; hãng khác trả "" (prompt chỉ đưa carrier + mã).
 * KHÔNG dùng tracking_url lưu trong order_tracking: đó là link
 * etsy.com/your/orders/... nội bộ của tài khoản shop, khách bấm vào bị chặn.
 */
function publicTrackingUrl(carrier: string, code: string): string {
  const c = carrier.trim().toLowerCase();
  const e = encodeURIComponent(code.trim());
  if (!e) return "";
  // Định dạng mới của USPS (link cũ /go/TrackConfirmAction?tLabels= vẫn sống
  // nhưng bị redirect về đây — xác nhận bằng trình duyệt 2026-07).
  if (c.includes("usps")) return `https://tools.usps.com/tracking/${e}`;
  if (c.includes("ups")) return `https://www.ups.com/track?loc=en_US&tracknum=${e}`;
  if (c.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${e}`;
  // DHL: không có URL pattern công khai được xác nhận chắc chắn (2026-07) →
  // không dựng link, prompt chỉ đưa "DHL <mã>" (quy tắc: không chuẩn 100% thì thôi).
  return "";
}

/** unix giây → "YYYY-MM-DD" (UTC). Trả "" nếu không có/không hợp lệ. */
function fmtDate(unixSec: number): string {
  if (!unixSec || unixSec <= 0) return "";
  const d = new Date(unixSec * 1000);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/**
 * Lấy tối đa MAX_ORDERS_FOR_PROMPT đơn gần nhất của 1 khách (theo buyer_id).
 * Tái dùng mapOrder + getOrderTrackingMap của orders-read (không viết lại map).
 * KHÔNG ném lỗi ra ngoài — hỏng thì trả [] để gợi ý AI vẫn chạy (fallback hỏi khách).
 */
export async function getOrderContextForConversation(
  buyerId: number,
): Promise<OrderListItem[]> {
  if (!buyerId || buyerId <= 0) return [];
  try {
    const coll = await getEtsyOrdersCollection();
    const docs = (await coll
      .find({ $or: [{ "data.buyer_id": buyerId }, { "data.buyer.buyer_id": buyerId }] })
      .sort({ "data.order_date": -1, _id: -1 })
      .limit(MAX_ORDERS_FOR_PROMPT)
      .toArray()) as WithId<EtsyOrderDoc>[];
    if (docs.length === 0) return [];

    // shopName không cần cho prompt AI → truyền map rỗng (mapOrder fallback data.shop_name).
    const items = docs.map((d) => mapOrder(d, new Map<number, string>()));

    // Gắn tracking thật từ order_tracking (giống getOrders).
    const trackingMap = await getOrderTrackingMap(
      items.map((i) => i.orderId).filter((id) => id > 0),
    );
    for (const item of items) {
      item.trackings = trackingMap.get(item.orderId) ?? [];
    }
    return items;
  } catch (err) {
    console.error("[ai] getOrderContextForConversation failed:", err);
    return [];
  }
}

/**
 * Dựng khối <orders> đưa vào prompt. Rút gọn tối đa, chỉ giữ field cần để trả lời.
 * Trả "" nếu không có đơn → prompt không có khối orders → AI hỏi khách như cũ.
 */
export function formatOrdersForPrompt(orders: OrderListItem[]): string {
  if (orders.length === 0) return "";

  const lines: string[] = ["<orders>"];
  lines.push(
    `The customer has ${orders.length} recent order(s) on record. ` +
      `Use ONLY these facts; do not invent any other order details. ` +
      `Tracking links below are public carrier pages, safe to share with the customer. ` +
      `If a tracking has NO link, give only the carrier name + tracking code — NEVER make up a URL.`,
  );

  for (const o of orders) {
    const orderNo = o.orderId > 0 ? `#${o.orderId}` : "(unknown id)";
    const placed = fmtDate(o.orderDate);
    lines.push("");
    lines.push(
      `Order ${orderNo}${placed ? ` — placed ${placed}` : ""}, status: ${o.stateName || "unknown"}`,
    );

    // Trạng thái giao hàng.
    const ship = o.shipping;
    const shipStatus = ship.statusSummary || (ship.wasShipped ? "Shipped" : "Not shipped yet");
    const shipParts: string[] = [shipStatus];
    const shipDate = fmtDate(ship.shipDate);
    if (shipDate) shipParts.push(`shipped ${shipDate}`);
    if (o.shippingMethod) shipParts.push(o.shippingMethod);
    const dispatchBy = fmtDate(o.dispatchBy);
    if (dispatchBy && !ship.wasShipped) shipParts.push(`dispatch by ${dispatchBy}`);
    lines.push(`  Shipping: ${shipParts.join(", ")}`);

    // Sản phẩm + biến thể + personalization.
    if (o.transactions.length > 0) {
      lines.push("  Items:");
      for (const t of o.transactions) {
        const variants = t.variations.map((v) => `${v.property}: ${v.value}`).join(", ");
        const parts = [`"${t.title || "item"}" x${t.quantity || 1}`];
        if (variants) parts.push(`[${variants}]`);
        if (t.personalizations.length > 0) {
          const p = t.personalizations
            .map((x) => `${x.label}: "${x.value.replace(/\s+/g, " ").trim()}"`)
            .join(", ");
          parts.push(`personalization: {${p}}`);
        }
        lines.push(`    - ${parts.join(" ")}`);
      }
    }

    // Tracking thật — link chỉ khi dựng được URL công khai của hãng (tr.url là
    // link nội bộ etsy.com của shop, không bao giờ đưa cho khách).
    for (const tr of o.trackings) {
      const carrier = tr.carrier ? `${tr.carrier} ` : "";
      const delivered = tr.isDelivered ? "delivered" : "not delivered yet";
      const publicUrl = publicTrackingUrl(tr.carrier ?? "", tr.code);
      lines.push(`  Tracking: ${carrier}${tr.code} (${delivered})${publicUrl ? ` ${publicUrl}` : ""}`);
    }
  }

  lines.push("</orders>");
  return lines.join("\n");
}
