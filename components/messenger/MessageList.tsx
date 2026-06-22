"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMessages } from "@/lib/hooks/useMessages";
import type { MessageItem, PendingMessage } from "@/lib/types/etsy";
import { etsyText, initials, timeAgo } from "@/lib/format";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
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

const Bubble = memo(function Bubble({
  m,
  onOpenImage,
  buyerName,
  buyerAvatar,
}: {
  m: MessageItem;
  onOpenImage: (src: string) => void;
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
          {etsyText(m.message)}
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
        <span className="ml-9 mt-0.5 text-[11px] text-muted-foreground">
          {timeAgo(m.createDate)}
        </span>
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

const PendingBubble = memo(function PendingBubble({ p }: { p: PendingMessage }) {
  return (
    <div className="flex flex-col items-end px-6 py-1">
      <div
        className={cn(
          "max-w-[70%] rounded-3xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words",
          p.status === "failed"
            ? "bg-destructive-soft text-destructive"
            : "bg-primary/70 text-white",
        )}
      >
        {p.text}
      </div>
      <span className="mt-0.5 text-[11px] text-muted-foreground">
        {p.status === "failed" ? "Gửi thất bại" : "Đang gửi…"}
      </span>
    </div>
  );
});

export function MessageList({
  conversationId,
  pending = [],
}: {
  conversationId: number;
  pending?: PendingMessage[];
}) {
  const { items, name, avatar, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useMessages(conversationId);

  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const openImage = useCallback((src: string) => setLightboxSrc(src), []);
  const closeImage = useCallback(() => setLightboxSrc(null), []);

  const parentRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(0);
  const fetchingOlderRef = useRef(false);
  const didInitialScrollRef = useRef(false);
  const atBottomRef = useRef(true);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 10,
  });

  // Reset khi đổi conversation.
  useEffect(() => {
    didInitialScrollRef.current = false;
    prevLenRef.current = 0;
    fetchingOlderRef.current = false;
  }, [conversationId]);

  // Giữ vị trí scroll khi prepend tin cũ / cuộn đáy khi tin mới.
  useLayoutEffect(() => {
    const added = items.length - prevLenRef.current;
    if (added <= 0) {
      prevLenRef.current = items.length;
      return;
    }

    if (!didInitialScrollRef.current && items.length > 0) {
      virtualizer.scrollToIndex(items.length - 1, { align: "end" });
      didInitialScrollRef.current = true;
    } else if (fetchingOlderRef.current) {
      virtualizer.scrollToIndex(added, { align: "start" });
      fetchingOlderRef.current = false;
    } else {
      virtualizer.scrollToIndex(items.length - 1, { align: "end" });
    }
    prevLenRef.current = items.length;
  }, [items.length, virtualizer]);

  // Cuộn lên đầu → load tin cũ hơn.
  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => {
    const first = virtualItems[0];
    if (!first) return;
    if (first.index <= 2 && hasNextPage && !isFetchingNextPage) {
      fetchingOlderRef.current = true;
      fetchNextPage();
    }
  }, [virtualItems, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Có tin đang gửi → cuộn xuống đáy để thấy.
  useEffect(() => {
    const el = parentRef.current;
    if (el && pending.length > 0) el.scrollTop = el.scrollHeight;
  }, [pending.length]);

  // Bám đáy khi vùng tin nhắn co lại (mở panel gợi ý AI, gõ nhiều dòng, đính kèm ảnh…)
  // để tin mới nhất không bị panel AI/composer che mất. Chỉ bám khi người dùng đang ở đáy.
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const NEAR = 120;
    const updateAtBottom = () => {
      atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR;
    };
    updateAtBottom();
    el.addEventListener("scroll", updateAtBottom, { passive: true });
    const ro = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateAtBottom);
      ro.disconnect();
    };
  }, []);

  const empty = !isLoading && items.length === 0 && pending.length === 0;

  return (
    <>
      <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto bg-card py-4">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Đang tải tin nhắn…</p>
        ) : empty ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Chưa có tin nhắn.</p>
        ) : (
          <>
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {isFetchingNextPage && (
                <div className="absolute left-0 top-0 w-full text-center text-xs text-muted-foreground">
                  Đang tải tin cũ…
                </div>
              )}
              {virtualItems.map((v) => {
                const m = items[v.index];
                return (
                  <div
                    key={m.id}
                    ref={virtualizer.measureElement}
                    data-index={v.index}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${v.start}px)`,
                    }}
                  >
                    <Bubble
                      m={m}
                      onOpenImage={openImage}
                      buyerName={name}
                      buyerAvatar={avatar}
                    />
                  </div>
                );
              })}
            </div>
            {pending.map((p) => (
              <PendingBubble key={p.localId} p={p} />
            ))}
          </>
        )}
      </div>
      {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={closeImage} />}
    </>
  );
}
