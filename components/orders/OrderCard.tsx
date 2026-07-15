"use client";

import { CheckCircle2, MessageCircle, SquarePen, Store, Tag, Truck } from "lucide-react";
import type { OrderListItem, OrderTransaction } from "@/lib/types/etsy";

/** Format unix giây → "03 Jul, 2026" (giống Etsy). */
function formatDate(unix: number): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** 1 card đơn hàng — bám sát layout card trong trang Orders của Etsy. */
export function OrderCard({
  order,
  onMessage,
  onUpdate,
}: {
  order: OrderListItem;
  onMessage: (order: OrderListItem) => void;
  onUpdate: (order: OrderListItem) => void;
}) {
  const addr = order.toAddress;
  return (
    <div className="rounded-2xl border border-border p-4">
      {/* Header: buyer + shop + trạng thái + order# + total + coupon */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-foreground">{order.buyerName || "Khách"}</span>
            {order.shopName && (
              <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                <Store className="h-3 w-3" />
                {order.shopName}
              </span>
            )}
            {order.stateName && (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                {order.stateName}
              </span>
            )}
            {order.shipping.statusSummary && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                  order.shipping.statusSummary.toLowerCase() === "delivered"
                    ? "bg-success/15 text-success"
                    : "bg-primary/10 text-primary"
                }`}
              >
                {order.shipping.statusSummary.toLowerCase() === "delivered" ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <Truck className="h-3 w-3" />
                )}
                {order.shipping.statusSummary}
                {order.shipping.shipDate ? ` · ${formatDate(order.shipping.shipDate)}` : ""}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">#{order.orderId}</span>
            {order.total && <span>{order.total}</span>}
            {order.coupon && (
              <span className="inline-flex items-center gap-1 text-primary">
                <Tag className="h-3 w-3" />
                {order.coupon}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => onUpdate(order)}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary"
          >
            <SquarePen className="h-4 w-4" />
            Cập nhật
          </button>
          <button
            onClick={() => onMessage(order)}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary"
          >
            <MessageCircle className="h-4 w-4" />
            Nhắn khách
          </button>
        </div>
      </div>

      {/* Sản phẩm */}
      <div className="mt-3 space-y-3">
        {order.transactions.map((t) => (
          <div key={t.transactionId} className="flex gap-3">
            {t.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={t.image}
                alt={t.title}
                className="h-16 w-16 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <div className="h-16 w-16 shrink-0 rounded-lg bg-secondary" />
            )}
            <div className="min-w-0 text-sm">
              <p className="line-clamp-2 font-medium text-foreground">{t.title}</p>
              <p className="text-muted-foreground">Quantity {t.quantity}</p>
              {/* Thứ tự bám Etsy: option (Color, Size) trước, Personalization sau cùng. */}
              {t.variations.map((v, i) => (
                <p key={i} className="text-muted-foreground">
                  <span className="text-foreground">{v.property}</span> {v.value}
                </p>
              ))}
              {/* Mỗi dòng personalization giữ nhãn riêng (Personalization / Back Side / Your Photo…). */}
              {t.personalizations.map((p, i) => (
                <div key={i} className="mt-1">
                  <p className="text-xs font-medium text-muted-foreground">{p.label}</p>
                  {/* Giá trị có thể nhiều dòng ("My Husband\nWendy") → giữ xuống dòng. */}
                  <p className="whitespace-pre-line text-foreground">{p.value}</p>
                </div>
              ))}
              <PersonalizationPhotos t={t} />
            </div>
          </div>
        ))}
      </div>

      {/* Footer: dispatch / delivery / địa chỉ */}
      <div className="mt-3 grid gap-3 border-t border-border pt-3 text-sm sm:grid-cols-2">
        <div className="space-y-0.5">
          <p className="text-foreground">
            Dispatches by <span className="font-medium">{formatDate(order.dispatchBy)}</span>
          </p>
          {order.shippingMethod && (
            <p className="text-muted-foreground">{order.shippingMethod}</p>
          )}
          {order.trackings.map((tr, i) => (
            <p key={i} className="flex items-center gap-1 text-muted-foreground">
              <Truck className="h-3.5 w-3.5 shrink-0" />
              {tr.carrier && <span className="text-foreground">{tr.carrier}</span>}
              {tr.url ? (
                <a
                  href={tr.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  {tr.code}
                </a>
              ) : (
                <span className="font-medium text-foreground">{tr.code}</span>
              )}
              {tr.isDelivered && <CheckCircle2 className="h-3 w-3 text-success" />}
            </p>
          ))}
        </div>
        {(addr.name || addr.city) && (
          <div className="space-y-0.5 sm:text-right">
            <p className="text-muted-foreground">Deliver to</p>
            <p className="font-medium text-foreground">{addr.name}</p>
            <p className="text-muted-foreground">
              {[addr.city, addr.state, addr.country].filter(Boolean).join(", ")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Ảnh khách upload ("Your Photo") của 1 dòng sản phẩm — thumbnail click mở ảnh gốc. */
function PersonalizationPhotos({ t }: { t: OrderTransaction }) {
  if (t.personalizationFiles.length === 0) return null;
  return (
    <div className="mt-1.5">
      <span className="text-xs font-medium text-muted-foreground">Your photo</span>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {t.personalizationFiles.map((f, i) => (
          <a
            key={i}
            href={f.url || f.thumbnailUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={f.filename}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={f.thumbnailUrl || f.url}
              alt={f.filename}
              className="h-14 w-14 rounded-lg border border-border object-cover hover:opacity-80"
            />
          </a>
        ))}
      </div>
    </div>
  );
}
