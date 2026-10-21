"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, Loader2, MapPin, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DoraSourceBadge } from "@/components/delivery/DeliveryRow";
import { ReviewDetail } from "@/components/delivery/ReviewStars";
import { useDeliveryTracking } from "@/lib/hooks/useDelivery";
import { carrierTrackingUrl, etsyTrackingPage } from "@/lib/delivery/carrierTrackingUrl";
import {
  deliveryStatusBadgeClass,
  deliveryStatusLabel,
  formatAgo,
  formatDate,
  formatDateTime,
  formatTransitDays,
} from "@/lib/delivery/deliveryTracking";
import { doraOrdersLink, isDoraSheetOrder } from "@/lib/delivery/orderLink";
import { hasReview } from "@/lib/delivery/review";
import type { DeliveryTracking } from "@/lib/types/delivery";
import { cn } from "@/lib/utils";

/**
 * Drawer lịch sử sự kiện của 1 mã (chép Mera `TrackingEventsDrawer.tsx`). Dòng trên bảng là nguồn
 * mới nhất cho phần tóm tắt; detail (useDeliveryTracking) bổ sung events / flags / mera_carrier.
 * Nút "Làm mới" dùng chung handler của bảng (useRefreshDelivery vá cả detail lẫn dòng).
 */
export function DeliveryEventsDrawer({
  tracking,
  onClose,
  onRefresh,
  refreshing,
}: {
  /** Dòng đang xem; null = đóng. */
  tracking: DeliveryTracking | null;
  onClose: () => void;
  onRefresh: (row: DeliveryTracking) => void;
  refreshing: boolean;
}) {
  const { data: detail, isLoading, error } = useDeliveryTracking(tracking?.id ?? null);

  // Esc để đóng.
  const open = !!tracking;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!tracking) return null;

  const sameDetail = detail?.id === tracking.id ? detail : undefined;
  const view: DeliveryTracking = { ...(sameDetail ?? {}), ...tracking };
  const events = sameDetail?.events ?? [];
  const trackUrl = carrierTrackingUrl(view);
  const etsyUrl = etsyTrackingPage(view);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Lịch sử ${view.code}`}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[560px] flex-col border-l border-border bg-background shadow-xl"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
          <span className="font-mono text-base font-semibold text-foreground">{view.code}</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Đóng"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5 text-sm">
          {/* Tóm tắt */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                  deliveryStatusBadgeClass(view.status),
                )}
              >
                {deliveryStatusLabel(view.status)}
              </span>
              {view.major_state && <span className="text-xs text-muted-foreground">Etsy: {view.major_state}</span>}
              <span className="text-xs text-muted-foreground">{view.carrier || "—"}</span>
              {sameDetail?.mera_carrier &&
                sameDetail.mera_carrier.toUpperCase() !== (view.carrier || "").toUpperCase() && (
                  <span className="text-xs text-warning" title="Hãng ghi trên item Mera khác tên hãng Etsy trả về">
                    Mera: {sameDetail.mera_carrier}
                  </span>
                )}
              {trackUrl && (
                <a
                  href={trackUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-xs text-blue-700 hover:underline dark:text-sky-400"
                >
                  Tra cứu hãng <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {etsyUrl && (
                <a
                  href={etsyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:underline"
                  title="Cần đăng nhập đúng shop"
                >
                  Etsy <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                Paid: <b className="text-foreground">{formatDate(view.paid_at)}</b>
              </span>
              <span>
                Ship: <b className="text-foreground">{formatDate(view.mailing_date)}</b>
              </span>
              <span>
                Transit: <b className="text-foreground">{formatTransitDays(view.transit_days)}</b>
              </span>
              <span>
                Delivered: <b className="text-foreground">{formatDate(view.delivered_at)}</b>
              </span>
            </div>
          </div>

          {/* Lần đọc Etsy */}
          <div className="space-y-1.5 rounded-lg border border-border bg-secondary/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                Đọc Etsy lần cuối:{" "}
                <b className="text-foreground" title={formatDateTime(view.last_checked_at)}>
                  {formatAgo(view.last_checked_at)}
                </b>
                {view.last_checked_at && <span> · {formatDateTime(view.last_checked_at)}</span>}
              </div>
              <Button size="sm" variant="outline" disabled={refreshing} onClick={() => onRefresh(tracking)}>
                {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Làm mới
              </Button>
            </div>
            {view.next_check_at ? (
              <div className="text-xs text-muted-foreground">
                Lần đọc tự động kế tiếp: {formatDateTime(view.next_check_at)}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Không còn lịch đọc tự động.</div>
            )}
            {sameDetail?.flags && !sameDetail.flags.detailed && (
              <div className="text-xs text-muted-foreground">
                Extension Dora bản cũ — chỉ biết đã gửi / đã giao, chưa có trạng thái chi tiết.
              </div>
            )}
            {view.last_error && (
              <div className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs text-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                <span>
                  Lần đọc gần nhất lỗi{view.last_error_at ? ` (${formatDateTime(view.last_error_at)})` : ""}:{" "}
                  {view.last_error}
                  {" — "}dữ liệu đang hiện có thể đã cũ.
                </span>
              </div>
            )}
          </div>

          {/* Đơn mang mã này */}
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">
              Đơn ({view.orders.length})
            </div>
            <ul className="space-y-1.5">
              {view.orders.map((o, i) => (
                <li key={`${o.order_id}-${i}`} className="rounded-md border border-border px-2.5 py-1.5">
                  <div className="flex items-center gap-2">
                    <Link
                      href={doraOrdersLink(o)}
                      target="_blank"
                      className="inline-flex items-center gap-1 font-mono text-xs text-blue-700 hover:underline dark:text-sky-400"
                      title="Mở đơn trên trang Orders"
                    >
                      {o.order_id}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                    <span className="text-xs text-muted-foreground">{o.store}</span>
                    {isDoraSheetOrder(o) && <DoraSourceBadge />}
                    {o.on_etsy === false && (
                      <span className="rounded bg-orange-100 px-1.5 text-[11px] text-orange-800">Không có trên Etsy</span>
                    )}
                  </div>
                  {(o.items ?? []).map((it) => (
                    <div key={it.item_key} className="truncate text-xs text-muted-foreground" title={it.product_name}>
                      {it.product_name || it.item_key}
                      {it.latest_provider && <span className="opacity-70"> · {it.latest_provider}</span>}
                    </div>
                  ))}
                  {(o.items ?? [])
                    .flatMap((it) => (hasReview(it.review) ? [{ it, review: it.review }] : []))
                    .map(({ it, review }) => (
                      <div
                        key={`review-${it.item_key}`}
                        className="mt-1.5 rounded-md border border-amber-200/60 bg-amber-50/60 px-2 py-1.5 dark:border-amber-500/20 dark:bg-amber-500/10"
                      >
                        <ReviewDetail
                          review={review}
                          label={o.items.length > 1 ? `${it.product_name || it.item_key} · ${it.item_key}` : undefined}
                          interactive
                        />
                      </div>
                    ))}
                </li>
              ))}
            </ul>
          </div>

          {/* Timeline */}
          <div>
            <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Lịch sử sự kiện</div>
            {isLoading && events.length === 0 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Đang tải…
              </div>
            )}
            {error && <div className="text-xs text-destructive">{error.message || "Không tải được lịch sử"}</div>}
            {!isLoading && !error && events.length === 0 && (
              <div className="text-xs text-muted-foreground">Chưa có sự kiện nào từ hãng vận chuyển.</div>
            )}
            {events.length > 0 && (
              <ol className="relative ml-1.5 space-y-3 border-l border-border">
                {events.map((ev, i) => (
                  <li key={`${ev.time}-${i}`} className="ml-4">
                    <span
                      className={cn(
                        "absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border border-background",
                        i === 0 ? "bg-blue-600" : "bg-muted-foreground/40",
                      )}
                    />
                    <div className={cn("text-sm", i === 0 ? "font-medium text-foreground" : "text-foreground/80")}>
                      {ev.desc || "—"}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatDateTime(ev.time)}</span>
                      {ev.location && (
                        <span className="inline-flex items-center gap-0.5">
                          <MapPin className="h-3 w-3" />
                          {ev.location}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
