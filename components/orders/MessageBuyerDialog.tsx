"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, MessageSquare, Send, X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { ImageLightbox, MessageBubble } from "@/components/messenger/MessageBubble";
import type { MessageItem, OrderListItem } from "@/lib/types/etsy";

interface OrderConversation {
  conversationId: number | null;
  buyerName: string;
  buyerUsername: string;
  buyerAvatar: string;
  messages: MessageItem[];
}

/** Panel nhắn khách theo đơn (trượt từ phải, non-modal) — hiện full hội thoại cũ (nếu có) trước khi gửi. */
export function MessageBuyerDialog({
  order,
  onClose,
}: {
  order: OrderListItem;
  onClose: () => void;
}) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [convo, setConvo] = useState<OrderConversation | null>(null);
  const [loadingConvo, setLoadingConvo] = useState(true);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const openImage = useCallback((src: string) => setLightboxSrc(src), []);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const noShop = !order.shopName.trim();

  // Đóng bằng phím Esc (giống OrderSheetSidebar).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Tải hội thoại hiện có của khách khi mở panel.
  useEffect(() => {
    let alive = true;
    setLoadingConvo(true);
    fetch(`/api/orders/conversation?orderId=${order.orderId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: OrderConversation | null) => {
        if (alive) setConvo(d);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoadingConvo(false);
      });
    return () => {
      alive = false;
    };
  }, [order.orderId]);

  // Cuộn xuống tin mới nhất khi đã tải xong thread.
  useEffect(() => {
    if (convo?.messages.length) threadEndRef.current?.scrollIntoView();
  }, [convo]);

  const send = async () => {
    if (!message.trim() || noShop) return;
    setSending(true);
    try {
      const res = await fetch("/api/orders/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopName: order.shopName,
          orderId: order.orderId,
          message: message.trim(),
        }),
      });
      const data = (await res.json()) as { error?: string; code?: string };
      if (!res.ok) {
        toast.error(
          data.code === "shop_offline"
            ? "Shop chưa có extension online — hãy mở Etsy của shop này."
            : data.error ?? `Lỗi ${res.status}`,
        );
        return;
      }
      toast.success(
        convo?.conversationId
          ? "Đã gửi vào hội thoại hiện có."
          : "Đã gửi yêu cầu nhắn khách. Hội thoại sẽ xuất hiện sau khi sync.",
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lỗi mạng");
    } finally {
      setSending(false);
    }
  };

  const hasThread = !!convo?.conversationId && convo.messages.length > 0;

  return (
    // Panel không chặn tương tác (non-modal): không có overlay, trang chính vẫn click được.
    <div
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-background shadow-xl"
      role="dialog"
    >
        <div className="flex items-start justify-between gap-2 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <MessageSquare className="h-5 w-5 text-primary" />
              Nhắn khách
            </h2>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {order.buyerName || convo?.buyerName || "Khách"} · Order #{order.orderId}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {convo?.conversationId ? (
              <Link
                href={`/messages/${convo.conversationId}`}
                className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-primary hover:bg-secondary"
                title="Mở trong Messenger"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Messenger
              </Link>
            ) : null}
            <button
              onClick={onClose}
              className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-4">
        {/* Hội thoại hiện có — hiển thị y hệt trang Messenger */}
        <div className="mb-3 min-h-0 flex-1 overflow-y-auto rounded-xl bg-card py-3">
          {loadingConvo ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang tải hội thoại…
            </div>
          ) : hasThread ? (
            <div>
              {convo!.messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  m={m}
                  onOpenImage={openImage}
                  buyerName={convo!.buyerName}
                  buyerAvatar={convo!.buyerAvatar}
                />
              ))}
              <div ref={threadEndRef} />
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Khách chưa có hội thoại nào — tin gửi đi sẽ tạo hội thoại mới.
            </p>
          )}
        </div>

        {noShop && (
          <p className="mb-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            Không xác định được shop của đơn này nên chưa thể gửi.
          </p>
        )}

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="Nội dung tin nhắn gửi khách…"
          className="w-full shrink-0 resize-y rounded-xl border-0 bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />

        <div className="mt-3 flex shrink-0 justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            Huỷ
          </button>
          <button
            onClick={send}
            disabled={sending || !message.trim() || noShop}
            className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:bg-input-strong"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Gửi
          </button>
        </div>
      </div>

      {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  );
}
