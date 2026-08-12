"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMessages } from "@/lib/hooks/useMessages";
import type { PendingMessage } from "@/lib/types/etsy";
import { ImageLightbox, MessageBubble } from "@/components/messenger/MessageBubble";
import { cn } from "@/lib/utils";

const FAILED_LABEL: Record<string, string> = {
  default: "Gửi thất bại",
  "no-browser": "Gửi thất bại — shop chưa mở tab Dora",
  "shop-unknown": "Gửi thất bại — hội thoại chưa xác định shop",
};

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
        {p.status === "failed" ? FAILED_LABEL[p.reason ?? "default"] : "Đang gửi…"}
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
  const pinRafRef = useRef(0);
  // True khi đã ghim xong xuống đáy lần đầu. Chặn việc tải tin CŨ kích hoạt sớm
  // (lúc mới mở scroll còn ở top) làm cướp scroll, kẹt ở giữa.
  const initialPinnedRef = useRef(false);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 10,
    // Cache chiều cao theo id ổn định, KHÔNG theo index. Khi cuộn lên load tin cũ
    // (prepend vào đầu mảng) index của mọi tin bị dịch — nếu cache theo index thì
    // chiều cao đã đo nằm sai chỗ → các bong bóng đè lên nhau (phải reload mới hết).
    getItemKey: (index) => items[index]?.id ?? index,
  });

  // Ảnh tải xong → bubble cao lên. Đo lại đúng chiều cao để các tin không bị đè lên nhau.
  const remeasureFromImage = useCallback(
    (img: HTMLImageElement) => {
      const node = img.closest<HTMLElement>("[data-index]");
      if (node) virtualizer.measureElement(node);
    },
    [virtualizer],
  );

  // Cuộn xuống tin MỚI NHẤT một cách CHẮC CHẮN. Virtualizer đo chiều cao động sau
  // khi render nên scrollToIndex gọi một lần thường rơi chưa tới đáy (người dùng phải
  // tự kéo xuống — phiền). Lặp ghim đáy qua nhiều frame cho tới khi chiều cao tổng
  // ổn định (đã đo xong các bong bóng/ảnh) rồi mới dừng.
  const pinToBottom = useCallback(() => {
    cancelAnimationFrame(pinRafRef.current);
    let lastH = -1;
    let stable = 0;
    let tries = 0;
    const step = () => {
      const el = parentRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      atBottomRef.current = true;
      if (el.scrollHeight === lastH) stable += 1;
      else {
        stable = 0;
        lastH = el.scrollHeight;
      }
      // Dừng khi đáy không đổi 3 frame liên tiếp, hoặc chạm trần an toàn (~40 frame).
      if (stable < 3 && tries < 40) {
        tries += 1;
        pinRafRef.current = requestAnimationFrame(step);
      } else {
        initialPinnedRef.current = true;
      }
    };
    pinRafRef.current = requestAnimationFrame(step);
  }, []);

  // Reset khi đổi conversation; huỷ vòng ghim đáy đang chạy.
  useEffect(() => {
    didInitialScrollRef.current = false;
    initialPinnedRef.current = false;
    prevLenRef.current = 0;
    fetchingOlderRef.current = false;
    return () => cancelAnimationFrame(pinRafRef.current);
  }, [conversationId]);

  // Giữ vị trí scroll khi prepend tin cũ / cuộn đáy khi tin mới.
  useLayoutEffect(() => {
    const added = items.length - prevLenRef.current;
    if (added <= 0) {
      prevLenRef.current = items.length;
      return;
    }

    if (!didInitialScrollRef.current && items.length > 0) {
      // Lần đầu mở hội thoại → ghim chắc xuống tin mới nhất.
      didInitialScrollRef.current = true;
      pinToBottom();
    } else if (fetchingOlderRef.current) {
      // Vừa nạp tin CŨ hơn (prepend) → giữ nguyên vị trí đang xem.
      virtualizer.scrollToIndex(added, { align: "start" });
      fetchingOlderRef.current = false;
    } else if (atBottomRef.current) {
      // Có tin mới ở cuối và người dùng đang ở đáy → bám theo tin mới nhất.
      pinToBottom();
    }
    prevLenRef.current = items.length;
  }, [items.length, virtualizer, pinToBottom]);

  // Cuộn lên đầu → load tin cũ hơn.
  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => {
    // Chỉ tải tin cũ SAU khi đã ghim xong xuống đáy — nếu không, lúc mới mở scroll
    // còn ở top sẽ kích hoạt tải tin cũ và làm scroll kẹt ở giữa.
    if (!initialPinnedRef.current) return;
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
