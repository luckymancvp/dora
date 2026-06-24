"use client";

import { memo, useEffect } from "react";
import { createPortal } from "react-dom";
import type { MessageItem } from "@/lib/types/etsy";
import { etsyText, initials, timeAgo } from "@/lib/format";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

// Tách text thành các đoạn, biến URL thành link bấm được.
const URL_RE = /((?:https?:\/\/|www\.)[^\s]+)/gi;

export function linkify(text: string, linkClass: string) {
  const parts = text.split(URL_RE);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      const href = part.startsWith("http") ? part : `https://${part}`;
      return (
        <a
          key={i}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

export function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain drop-shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-lg text-white backdrop-blur-sm transition hover:bg-black/60"
        onClick={onClose}
      >
        ✕
      </button>
    </div>,
    document.body,
  );
}

/**
 * 1 bong bóng tin nhắn — dùng chung cho cả trang Messenger lẫn dialog "Nhắn khách"
 * (page Orders) để hiển thị y hệt: tin của khách căn trái + avatar, của shop căn phải,
 * text qua etsyText (xử lý <br>/entity/HTML) + linkify, ảnh mở lightbox.
 */
export const MessageBubble = memo(function MessageBubble({
  m,
  onOpenImage,
  onImageLoad,
  buyerName,
  buyerAvatar,
}: {
  m: MessageItem;
  onOpenImage: (src: string) => void;
  onImageLoad?: (img: HTMLImageElement) => void;
  buyerName: string;
  buyerAvatar: string;
}) {
  if (m.isSystem) {
    return (
      <div className="my-1 flex justify-center px-6">
        <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
          {etsyText(m.message)}
        </span>
      </div>
    );
  }

  const hasText = m.message.trim().length > 0;
  const hasImages = m.images.length > 0;

  const bubble = (
    <div className={cn("max-w-full", hasText && hasImages ? "flex flex-col gap-1" : "")}>
      {hasText && (
        <div
          className={cn(
            "rounded-3xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words",
            m.fromMe ? "bg-primary text-white" : "bg-secondary text-foreground",
          )}
        >
          {linkify(
            etsyText(m.message),
            cn(
              "underline underline-offset-2 break-all hover:opacity-80",
              m.fromMe ? "text-white font-medium" : "text-primary",
            ),
          )}
        </div>
      )}
      {hasImages && (
        <div className={cn("flex flex-wrap gap-1.5", m.fromMe ? "justify-end" : "justify-start")}>
          {m.images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={src}
              alt=""
              className="max-h-60 max-w-xs cursor-zoom-in rounded-2xl object-cover shadow-sm transition hover:opacity-90"
              onClick={() => onOpenImage(src)}
              onLoad={(e) => onImageLoad?.(e.currentTarget)}
            />
          ))}
        </div>
      )}
    </div>
  );

  if (!m.fromMe) {
    return (
      <div className="flex flex-col items-start px-6 py-1">
        <div className="flex max-w-[75%] items-end gap-2">
          <Avatar className="h-7 w-7 shrink-0" title={buyerName}>
            {buyerAvatar ? <AvatarImage src={buyerAvatar} alt={buyerName} /> : null}
            <AvatarFallback className="bg-muted text-[10px] font-bold text-muted-foreground">
              {initials(buyerName || "?")}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">{bubble}</div>
        </div>
        <span className="ml-9 mt-0.5 text-[11px] text-muted-foreground">{timeAgo(m.createDate)}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end px-6 py-1">
      <div className="flex max-w-[75%] items-end gap-2">
        <div className="min-w-0">{bubble}</div>
        <Avatar className="h-7 w-7 shrink-0" title={m.senderName || m.senderEmail}>
          {m.senderAvatar ? <AvatarImage src={m.senderAvatar} alt={m.senderName} /> : null}
          <AvatarFallback className="bg-accent text-[10px] font-bold text-primary">
            {initials(m.senderName || "?")}
          </AvatarFallback>
        </Avatar>
      </div>
      <span className="mr-9 mt-0.5 text-[11px] text-muted-foreground">
        {m.senderName ? `${m.senderName} · ` : ""}
        {timeAgo(m.createDate)}
      </span>
    </div>
  );
});
