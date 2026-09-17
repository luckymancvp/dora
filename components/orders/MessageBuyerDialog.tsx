"use client";

import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from "react";
import { ExternalLink, Loader2, MessageSquare, Send, X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { ImageLightbox, MessageBubble } from "@/components/messenger/MessageBubble";
import { uploadImageFiles } from "@/lib/upload-image";
import type { MessageItem, OrderListItem } from "@/lib/types/etsy";

interface OrderConversation {
  conversationId: number | null;
  buyerName: string;
  buyerUsername: string;
  buyerAvatar: string;
  messages: MessageItem[];
  /** "inbox" = có trong Messenger; "order" = chỉ có ở trang đơn; "none" = chưa có gì. */
  source: "inbox" | "order" | "none";
  /** unix giây lần cuối extension GET thread từ trang đơn (0 = chưa bao giờ). */
  fetchedAt: number;
}

/** Số lần + nhịp poll sau khi nhờ extension GET thread từ trang đơn (~24s). */
const POLL_TIMES = 8;
const POLL_INTERVAL_MS = 3000;

/** Trần số ảnh mỗi tin — phải khớp chốt chặn ở app/api/orders/message/route.ts. */
const MAX_ATTACHMENTS = 10;

/** Poll trạng thái gửi thật (extension báo về) sau khi bấm Gửi — ~15s. */
const SEND_POLL_TIMES = 10;
const SEND_POLL_INTERVAL_MS = 1500;

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
  // Ảnh đính kèm = mảng public URL Vercel Blob; extension tự upload2Etsy để đổi thành image_id.
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [convo, setConvo] = useState<OrderConversation | null>(null);
  const [loadingConvo, setLoadingConvo] = useState(true);
  // Đang nhờ extension GET thread từ trang đơn (khách guest/chưa trả lời không có trong inbox).
  const [fetchingRemote, setFetchingRemote] = useState(false);
  const [fetchNote, setFetchNote] = useState("");
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const openImage = useCallback((src: string) => setLightboxSrc(src), []);
  const threadEndRef = useRef<HTMLDivElement>(null);
  // Panel đóng giữa lúc đang poll trạng thái gửi → dừng, tránh setState sau unmount.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const noShop = !order.shopName.trim();

  // Đóng bằng phím Esc (giống OrderSheetSidebar).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loadConvo = useCallback(async (): Promise<OrderConversation | null> => {
    try {
      const r = await fetch(`/api/orders/conversation?orderId=${order.orderId}`);
      return r.ok ? ((await r.json()) as OrderConversation) : null;
    } catch {
      return null;
    }
  }, [order.orderId]);

  // Tải hội thoại đã có; nếu DB chưa có gì thì nhờ extension GET từ trang đơn rồi poll.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      });

    (async () => {
      setLoadingConvo(true);
      setFetchNote("");
      const first = await loadConvo();
      if (!alive) return;
      setConvo(first);
      setLoadingConvo(false);

      // Đã có tin, hoặc extension từng trả lời "đơn này không có hội thoại" → khỏi hỏi lại.
      if (first && (first.messages.length > 0 || first.fetchedAt > 0)) return;
      if (noShop) return;

      setFetchingRemote(true);
      let triggered = false;
      try {
        const res = await fetch("/api/orders/conversation/fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shopName: order.shopName, orderId: order.orderId }),
        });
        triggered = res.ok;
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { code?: string };
          if (alive) {
            setFetchNote(
              d.code === "shop_offline"
                ? "Shop chưa có extension online nên chưa lấy được hội thoại cũ — hãy mở Etsy của shop này."
                : "Không yêu cầu được extension lấy hội thoại.",
            );
          }
        }
      } catch {
        if (alive) setFetchNote("Lỗi mạng khi yêu cầu lấy hội thoại.");
      }
      if (!alive || !triggered) {
        if (alive) setFetchingRemote(false);
        return;
      }

      for (let i = 0; i < POLL_TIMES; i++) {
        await sleep(POLL_INTERVAL_MS);
        if (!alive) return;
        const next = await loadConvo();
        if (!alive) return;
        if (next) setConvo(next);
        // fetchedAt > 0 = extension đã trả lời (kể cả khi đơn thật sự chưa có hội thoại).
        if (next && (next.messages.length > 0 || next.fetchedAt > 0)) {
          setFetchingRemote(false);
          return;
        }
      }
      if (alive) {
        setFetchingRemote(false);
        setFetchNote("Chưa lấy được hội thoại từ Etsy — thử mở lại panel sau.");
      }
    })();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [loadConvo, noShop, order.shopName, order.orderId]);

  // Cuộn xuống tin mới nhất khi đã tải xong thread.
  useEffect(() => {
    if (convo?.messages.length) threadEndRef.current?.scrollIntoView();
  }, [convo]);

  // Dán ảnh (Ctrl+V) trong ô soạn tin → upload lên Blob rồi đính kèm.
  // Clipboard không có ảnh thì để trình duyệt dán text như bình thường.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null);
    if (imageFiles.length === 0) return;
    e.preventDefault();

    // Cắt trước khi upload: route chặn ở 10 ảnh, dán quá thì ảnh thừa vẫn nằm lại
    // trên Blob vĩnh viễn mà tin lại bị 400.
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      toast.error(`Tối đa ${MAX_ATTACHMENTS} ảnh mỗi tin.`);
      return;
    }
    const files = imageFiles.slice(0, room);
    if (files.length < imageFiles.length) {
      toast.error(`Chỉ nhận ${MAX_ATTACHMENTS} ảnh mỗi tin — đã bỏ bớt ảnh thừa.`);
    }

    void (async () => {
      setUploading(true);
      try {
        const urls = await uploadImageFiles(files);
        if (urls.length === 0) {
          toast.error("Tải ảnh thất bại: loại file không hợp lệ.");
          return;
        }
        // uploadImageFiles bỏ qua file sai MIME — báo để user biết ảnh nào không lên.
        if (urls.length < files.length) {
          toast.error(`Đã bỏ qua ${files.length - urls.length} ảnh không hợp lệ.`);
        }
        setAttachments((prev) => [...prev, ...urls]);
      } catch (err) {
        toast.error(`Tải ảnh thất bại: ${err instanceof Error ? err.message : "Lỗi mạng"}`);
      } finally {
        setUploading(false);
      }
    })();
  };

  const removeAttachment = (url: string) =>
    setAttachments((prev) => prev.filter((u) => u !== url));

  /** Poll trạng thái tới khi extension chốt DONE/FAILED; null nếu hết giờ. */
  const waitSendResult = async (
    id: string,
  ): Promise<{ status: string; error: string } | null> => {
    for (let i = 0; i < SEND_POLL_TIMES; i++) {
      await new Promise((r) => setTimeout(r, SEND_POLL_INTERVAL_MS));
      if (!aliveRef.current) return null;
      try {
        const r = await fetch(`/api/orders/message/status/${id}`);
        if (!r.ok) continue;
        const d = (await r.json()) as { status?: string; error?: string };
        if (d.status === "DONE" || d.status === "FAILED") {
          return { status: d.status, error: d.error ?? "" };
        }
      } catch {
        /* mạng chập chờn — thử tiếp */
      }
    }
    return null;
  };

  const send = async () => {
    if (!message.trim() || noShop || uploading) return;
    setSending(true);
    try {
      const res = await fetch("/api/orders/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopName: order.shopName,
          orderId: order.orderId,
          message: message.trim(),
          attachments,
        }),
      });
      const data = (await res.json()) as { error?: string; code?: string; id?: string };
      if (!res.ok) {
        toast.error(
          data.code === "shop_offline"
            ? "Shop chưa có extension online — hãy mở Etsy của shop này."
            : data.error ?? `Lỗi ${res.status}`,
        );
        return;
      }

      // Publish Ably xong KHÔNG có nghĩa Etsy đã nhận: ảnh có thể upload lỗi, Etsy có
      // thể từ chối. Chờ extension báo trạng thái thật rồi mới kết luận.
      const sent = data.id ? await waitSendResult(data.id) : null;
      if (!aliveRef.current) return;

      if (sent?.status === "FAILED") {
        // Giữ nguyên nội dung + ảnh để gửi lại, không đóng panel.
        toast.error(`Gửi thất bại: ${sent.error || "extension báo lỗi"}`);
        return;
      }
      if (!sent || sent.status !== "DONE") {
        toast.error("Đã gửi yêu cầu nhưng chưa nhận được xác nhận từ extension — kiểm tra lại trên Etsy.");
        return;
      }

      toast.success(
        convo?.conversationId
          ? "Đã gửi vào hội thoại hiện có."
          : "Đã gửi cho khách. Hội thoại sẽ xuất hiện sau khi sync.",
      );
      setAttachments([]);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lỗi mạng");
    } finally {
      setSending(false);
    }
  };

  const hasThread = !!convo && convo.messages.length > 0;
  // Chỉ hội thoại có trong inbox mới mở được trang Messenger; thread lấy từ trang đơn thì không.
  const messengerHref =
    convo?.source === "inbox" && convo.conversationId ? `/messages/${convo.conversationId}` : null;

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
            {messengerHref ? (
              <Link
                href={messengerHref}
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
          ) : fetchingRemote ? (
            <div className="flex items-center justify-center gap-2 py-6 text-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang lấy hội thoại từ trang đơn Etsy…
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Khách chưa có hội thoại nào — tin gửi đi sẽ tạo hội thoại mới.
            </p>
          )}
        </div>

        {fetchNote && !hasThread && (
          <p className="mb-2 rounded-xl border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
            {fetchNote}
          </p>
        )}

        {noShop && (
          <p className="mb-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            Không xác định được shop của đơn này nên chưa thể gửi.
          </p>
        )}

        {/* Preview ảnh đã dán (Ctrl+V) */}
        {(attachments.length > 0 || uploading) && (
          <div className="mb-2 flex shrink-0 flex-wrap gap-2">
            {attachments.map((url) => (
              <div key={url} className="relative h-16 w-16">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt=""
                  className="h-16 w-16 rounded-lg border border-border object-cover"
                />
                <button
                  onClick={() => removeAttachment(url)}
                  aria-label="Xoá ảnh"
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-white hover:bg-black"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {uploading && (
              <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-input-strong text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}
          </div>
        )}

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onPaste={onPaste}
          rows={3}
          placeholder="Nội dung tin nhắn gửi khách… (Ctrl+V để dán ảnh)"
          className="w-full shrink-0 resize-y rounded-xl border-0 bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />

        {/* Đơn chưa có hội thoại thì extension cần text để tạo hội thoại → ảnh trần không gửi được. */}
        {attachments.length > 0 && !message.trim() && (
          <p className="mt-2 shrink-0 text-xs text-warning">
            Ảnh phải gửi kèm nội dung tin nhắn.
          </p>
        )}

        <div className="mt-3 flex shrink-0 justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            Huỷ
          </button>
          <button
            onClick={send}
            disabled={sending || uploading || !message.trim() || noShop}
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
