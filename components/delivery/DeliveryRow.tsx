"use client";

import Link from "next/link";
import { AlertTriangle, CheckCheck, Copy, ExternalLink, History, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReviewLine } from "@/components/delivery/ReviewStars";
import { carrierTrackingUrl, etsyTrackingPage } from "@/lib/delivery/carrierTrackingUrl";
import {
  deliveryStatusBadgeClass,
  deliveryStatusLabel,
  formatAgo,
  formatDate,
  formatDateTime,
  formatTransitDays,
  orderProviders,
} from "@/lib/delivery/deliveryTracking";
import { doraOrdersLink, isDoraSheetOrder } from "@/lib/delivery/orderLink";
import { collectItemReviews } from "@/lib/delivery/review";
import type { DeliveryTracking } from "@/lib/types/delivery";
import { cn } from "@/lib/utils";

/** Số đơn hiện trong ô Order ID trước khi gộp "+N". */
const MAX_ORDERS_SHOWN = 3;
/** Số dòng đánh giá sao hiện trong cột Status trước khi gộp "+N" (mở drawer). */
const MAX_REVIEWS_SHOWN = 2;

/** Nhãn nhỏ "Dora" cạnh mã đơn `source=dora_sheet` (dòng Google Sheet đẩy từ dora-1). */
export function DoraSourceBadge() {
  return (
    <span
      className="rounded bg-violet-100 px-1 text-[10px] text-violet-800 dark:bg-violet-500/20 dark:text-violet-300"
      title="Đơn từ Google Sheet của Dora (dora-1 đẩy sang Mera)"
    >
      Dora
    </span>
  );
}

export interface DeliveryRowProps {
  row: DeliveryTracking;
  refreshing: boolean;
  onRefresh: (row: DeliveryTracking) => void;
  onCopyCode: (code: string) => void;
  onOpenHistory: (rowId: string) => void;
  copiedId: string | null;
  onCopyId: (text: string) => void;
  /** Hiện dòng "Giao <ngày>" trong cột Date (tab Đã giao · chưa/có đánh giá). */
  showDelivered: boolean;
  selected: boolean;
  /** Lý do không tick được (shop đủ 50 / không có đơn); null = tick được. */
  selectBlocked: string | null;
  onToggleSelect: (row: DeliveryTracking) => void;
}

/** 1 dòng bảng Giao hàng (chép TrackingRow của Mera, bỏ icon hội thoại Dora — A10). */
export function DeliveryRow({
  row,
  refreshing,
  onRefresh,
  onCopyCode,
  onOpenHistory,
  copiedId,
  onCopyId,
  showDelivered,
  selected,
  selectBlocked,
  onToggleSelect,
}: DeliveryRowProps) {
  const shownOrders = row.orders.slice(0, MAX_ORDERS_SHOWN);
  const hiddenOrders = row.orders.length - shownOrders.length;
  const reviews = collectItemReviews(row.orders);
  const shownReviews = reviews.slice(0, MAX_REVIEWS_SHOWN);
  const hiddenReviews = reviews.length - shownReviews.length;
  // Nhãn item chỉ cần khi mã mang nhiều item (để biết sao của item nào).
  const multiItem = row.orders.reduce((n, o) => n + (o.items?.length ?? 0), 0) > 1;
  // Link tra cứu của hãng (Etsy chỉ trả link hãng khi đã giao → dựng theo tên hãng); trang Etsy giữ ở chữ "Etsy".
  const trackUrl = carrierTrackingUrl(row);
  const etsyUrl = etsyTrackingPage(row);
  const openHistory = () => onOpenHistory(row.id);

  return (
    <tr className={cn("group align-top hover:bg-secondary/50", refreshing && "opacity-60", selected && "bg-primary/5")}>
      <td className="w-8 py-2 pl-3 pr-0">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-primary disabled:opacity-40"
          checked={selected}
          disabled={!!selectBlocked}
          onChange={() => onToggleSelect(row)}
          title={selectBlocked ?? "Chọn để làm mới hàng loạt"}
          aria-label={`Chọn ${row.code}`}
        />
      </td>

      {/* Tracking Number + hãng */}
      <td className="whitespace-nowrap px-3 py-2">
        <div className="flex min-h-[24px] items-center gap-1">
          {trackUrl ? (
            <a
              href={trackUrl}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[13px] text-blue-700 hover:underline dark:text-sky-400"
              title="Mở trang tra cứu của hãng"
            >
              {row.code}
            </a>
          ) : (
            <span className="font-mono text-[13px] text-foreground">{row.code}</span>
          )}
          <button
            type="button"
            onClick={() => onCopyCode(row.code)}
            className="p-0.5 text-muted-foreground hover:text-foreground"
            title="Copy mã"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="text-xs text-muted-foreground">
          {trackUrl ? (
            <a
              href={trackUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-blue-700 hover:underline dark:text-sky-400"
              title="Mở trang tra cứu của hãng"
            >
              {row.carrier || "Tra cứu"} <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            row.carrier || "—"
          )}
          {etsyUrl && (
            <a
              href={etsyUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-1.5 text-muted-foreground hover:text-foreground hover:underline"
              title="Trang tracking trên Etsy (cần đăng nhập đúng shop)"
            >
              Etsy
            </a>
          )}
        </div>
      </td>

      {/* Order ID */}
      <td className="whitespace-nowrap px-3 py-2">
        {shownOrders.map((o, i) => (
          // Cùng order_id có thể đến từ 2 nguồn (Mera + sheet Dora) → key kèm vị trí.
          <div key={`${o.order_id}-${i}`} className="flex min-h-[24px] items-center gap-1">
            {/* Ô mã đơn rộng tối thiểu cố định → icon copy thẳng cột dù mã dài ngắn. */}
            <span className="inline-flex min-w-[8.5rem]">
              <Link
                href={doraOrdersLink(o)}
                target="_blank"
                className="inline-flex items-center gap-0.5 font-mono text-xs text-blue-700 hover:underline dark:text-sky-400"
                title={`${o.store} — mở đơn trên trang Orders`}
              >
                {o.order_id}
                <ExternalLink className="h-3 w-3 opacity-60" />
              </Link>
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCopyId(o.order_id);
              }}
              className="rounded p-0.5 transition-colors hover:bg-muted"
              title={copiedId === o.order_id ? "Copied!" : "Click to copy"}
              aria-label="Copy Order ID"
            >
              {copiedId === o.order_id ? (
                <CheckCheck className="h-3 w-3 text-success" />
              ) : (
                <Copy className="h-3 w-3 opacity-0 group-hover:opacity-50" />
              )}
            </button>
            {isDoraSheetOrder(o) && <DoraSourceBadge />}
            {o.on_etsy === false && (
              <span
                className="rounded bg-orange-100 px-1 text-[10px] text-orange-800"
                title="Etsy không có mã này trên receipt"
              >
                không trên Etsy
              </span>
            )}
          </div>
        ))}
        {hiddenOrders > 0 && (
          <button type="button" onClick={openHistory} className="text-xs text-muted-foreground hover:underline">
            +{hiddenOrders} đơn khác
          </button>
        )}
        {row.orders[0]?.store && <div className="text-[11px] text-muted-foreground">{row.orders[0].store}</div>}
      </td>

      {/* Fulfill — bên fulfill (latest_provider) của từng đơn, cùng hàng với Order ID. */}
      <td className="whitespace-nowrap px-3 py-2">
        {shownOrders.map((o, i) => {
          const providers = orderProviders(o);
          return (
            <div key={`${o.order_id}-${i}`} className="flex min-h-[24px] items-center text-xs">
              {providers.length > 0 ? (
                <span className="text-foreground" title={providers.join(", ")}>
                  {providers.join(", ")}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          );
        })}
      </td>

      {/* Status */}
      <td className="max-w-[320px] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold",
              deliveryStatusBadgeClass(row.status),
            )}
            title={row.major_state ? `Etsy: ${row.major_state}` : undefined}
          >
            {deliveryStatusLabel(row.status)}
          </span>
          {row.last_error && (
            <span title={`Lần đọc gần nhất lỗi: ${row.last_error} — dữ liệu có thể cũ`}>
              <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            </span>
          )}
        </div>
        {row.latest_event ? (
          <div className="mt-0.5">
            <div className="line-clamp-2 text-xs text-foreground/80" title={row.latest_event.desc}>
              {row.latest_event.desc}
              {row.latest_event.location && (
                <span className="text-muted-foreground"> · {row.latest_event.location}</span>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground" title="Thời điểm của sự kiện vận chuyển (hãng ghi)">
              Sự kiện: {formatDateTime(row.latest_event.time)}
            </div>
          </div>
        ) : null}
        {/* Luôn hiện lần Mera đọc Etsy gần nhất (khác giờ sự kiện của hãng). */}
        <div className="mt-0.5 text-[11px] text-muted-foreground" title={formatDateTime(row.last_checked_at)}>
          Đọc Etsy: {formatAgo(row.last_checked_at)}
        </div>
        {shownReviews.length > 0 && (
          <div className="mt-1 space-y-0.5">
            {shownReviews.map((r) => (
              <ReviewLine
                key={r.item_key}
                review={r.review}
                label={multiItem ? `${r.product_name || r.item_key} · ${r.item_key}` : undefined}
              />
            ))}
            {hiddenReviews > 0 && (
              <button type="button" onClick={openHistory} className="text-[11px] text-muted-foreground hover:underline">
                +{hiddenReviews} đánh giá khác
              </button>
            )}
          </div>
        )}
      </td>

      {/* Transit Time */}
      <td className="whitespace-nowrap px-3 py-2 text-foreground/80">{formatTransitDays(row.transit_days)}</td>

      {/* Date */}
      <td className="whitespace-nowrap px-3 py-2 text-xs">
        <div>
          <span className="text-muted-foreground">Paid </span>
          {formatDate(row.paid_at)}
        </div>
        <div>
          <span className="text-muted-foreground">Ship </span>
          {formatDate(row.mailing_date)}
        </div>
        {showDelivered && row.delivered_at && (
          <div className="font-medium text-success" title={formatDateTime(row.delivered_at)}>
            <span className="font-normal opacity-80">Giao </span>
            {formatDate(row.delivered_at)}
          </div>
        )}
      </td>

      {/* Action */}
      <td className="whitespace-nowrap px-3 py-2 text-right">
        <div className="inline-flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            disabled={refreshing}
            onClick={() => onRefresh(row)}
            title={`Làm mới từ Etsy (lần cuối: ${formatAgo(row.last_checked_at)})`}
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={openHistory} title="Xem lịch sử sự kiện">
            <History className="h-4 w-4" />
          </Button>
        </div>
      </td>
    </tr>
  );
}
