"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMessages } from "@/lib/hooks/useMessages";
import type { PendingMessage } from "@/lib/types/etsy";
import { ImageLightbox, MessageBubble } from "@/components/messenger/MessageBubble";
import { cn } from "@/lib/utils";

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

  // Ảnh tải xong → bubble cao lên. Đo lại đúng chiều cao để các tin không bị đè lên nhau.
  const remeasureFromImage = useCallback(
    (img: HTMLImageElement) => {
      const node = img.closest<HTMLElement>("[data-index]");
      if (node) virtualizer.measureElement(node);
    },
    [virtualizer],
  );

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
                    <MessageBubble
                      m={m}
                      onOpenImage={openImage}
                      onImageLoad={remeasureFromImage}
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
