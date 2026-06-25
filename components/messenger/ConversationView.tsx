"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { upload } from "@vercel/blob/client";
import { Send, Info, StickyNote, Paperclip, X, Loader2, Sparkles, BookMarked, ArrowLeft, ExternalLink } from "lucide-react";
import { TemplatePicker } from "@/components/messenger/TemplatePicker";
import { MessageList } from "@/components/messenger/MessageList";
import { useSendMessage } from "@/lib/hooks/useSendMessage";
import { useMessages } from "@/lib/hooks/useMessages";
import { useShops } from "@/lib/hooks/useShops";
import type { TabMeta } from "@/lib/store/tabs";
import type { AIResponse } from "@/lib/types/etsy";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/format";

// Loại ảnh hợp lệ — khớp với ALLOWED ở app/api/uploads/route.ts.
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export function ConversationView({
  conversationId,
  meta,
  onBack,
  infoOpen = false,
  onToggleInfo,
  notesOpen = false,
  onToggleNotes,
  draft: controlledDraft,
  onDraftChange,
  autoFetchAI = true,
  aiTrigger = 0,
  onResolveMeta,
}: {
  conversationId: number;
  meta?: TabMeta;
  onBack?: () => void;
  infoOpen?: boolean;
  onToggleInfo?: () => void;
  notesOpen?: boolean;
  onToggleNotes?: () => void;
  /** Khi truyền → draft do bên ngoài điều khiển (cho Bảng xử lý: điền mẫu / gửi hàng loạt). */
  draft?: string;
  onDraftChange?: (v: string) => void;
  /** Tự gọi gợi ý AI khi mở (mặc định bật). Bảng xử lý tắt để không bắn Gemini hàng loạt. */
  autoFetchAI?: boolean;
  /** Tăng giá trị này để kích hoạt gợi ý AI từ bên ngoài (nút "Tạo AI tất cả"). */
  aiTrigger?: number;
  /** Báo tên/avatar lấy được từ messages (khi mở deep-link chưa có meta) để cập nhật tab. */
  onResolveMeta?: (meta: TabMeta) => void;
}) {
  const [internalDraft, setInternalDraft] = useState("");
  const draft = controlledDraft ?? internalDraft;
  const setDraft = onDraftChange ?? setInternalDraft;
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { pending, send } = useSendMessage(conversationId);
  const qc = useQueryClient();

  // Tên shop + tên/avatar khách: lấy từ messages (cache dùng chung với MessageList).
  const { shopUserId, name: fetchedName, avatar: fetchedAvatar } = useMessages(conversationId);
  // Mở từ deep-link thì meta rỗng → dùng tên fetch được làm fallback (tránh hiện "#id").
  const name = meta?.name || fetchedName || `#${conversationId}`;
  const avatarUrl = meta?.avatar || fetchedAvatar || "";

  // Khi đã fetch được tên mà tab chưa có meta → báo ra ngoài để cập nhật nhãn tab.
  useEffect(() => {
    if (fetchedName && !meta?.name && onResolveMeta) {
      onResolveMeta({ name: fetchedName, avatar: meta?.avatar || fetchedAvatar || "" });
    }
  }, [fetchedName, fetchedAvatar, meta?.name, meta?.avatar, onResolveMeta]);
  const { data: shops } = useShops();
  const shopName = useMemo(
    () => shops?.find((s) => s.userId === shopUserId)?.shopName ?? "",
    [shops, shopUserId],
  );

  // Tự cao theo nội dung: thu về 0 để đo đúng, cap ở MAX, chỉ bật cuộn khi tràn.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const MAX = 128; // = max-h-32
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, MAX);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX ? "auto" : "hidden";
  }, [draft]);

  const submit = () => {
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    if (uploading) return;
    send(text, attachments);
    setDraft("");
    setAttachments([]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd + Enter → gọi gợi ý AI.
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setAiOpen(true);
      void fetchAI();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const f of files) {
        if (f.type && !ALLOWED_IMAGE_TYPES.has(f.type)) {
          alert(`Tải ảnh thất bại: loại file không hợp lệ (${f.type})`);
          continue;
        }
        // Upload trực tiếp lên Vercel Blob qua token từ /api/uploads, bỏ qua
        // giới hạn 4.5MB của Serverless → không giới hạn dung lượng. upload()
        // tự xử lý phản hồi và ném Error rõ ràng nếu thất bại.
        const blob = await upload(f.name || "image.png", f, {
          access: "public",
          handleUploadUrl: "/api/uploads",
          contentType: f.type || undefined,
        });
        urls.push(blob.url);
      }
      if (urls.length > 0) setAttachments((prev) => [...prev, ...urls]);
    } catch (err) {
      alert(`Tải ảnh thất bại: ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const onPickFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    void uploadFiles(files);
  };

  // Dán ảnh (Ctrl+V) trong ô chat → upload như đính kèm.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null);
    if (imageFiles.length === 0) return;
    e.preventDefault();
    void uploadFiles(imageFiles);
  };

  const removeAttachment = (url: string) =>
    setAttachments((prev) => prev.filter((u) => u !== url));

  const [templateOpen, setTemplateOpen] = useState(false);

  // ---- Gợi ý AI (dùng chính ô chat làm định hướng) ----
  const [aiOpen, setAiOpen] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AIResponse | null>(null);

  // Tự động fetch gợi ý AI khi mở conversation (tắt được cho Bảng xử lý).
  useEffect(() => {
    if (autoFetchAI) void fetchAI();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, autoFetchAI]);

  // Kích hoạt gợi ý AI từ bên ngoài (nút "Tạo AI tất cả" của Bảng xử lý).
  useEffect(() => {
    if (aiTrigger > 0) {
      setAiOpen(true);
      void fetchAI();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiTrigger]);

  // Nội dung đang gõ trong ô chat = định hướng (input) cho AI; rỗng cũng được.
  // Dùng fetchQuery thay vì fetch thủ công: React Query tự GỘP các request trùng
  // key đang bay thành 1 (chống StrictMode/đa trigger gọi Gemini 2 lần), và cache
  // kết quả nên mở lại cùng hội thoại không gọi lại. force=true (nút "Tạo lại")
  // bỏ cache để sinh mới.
  const fetchAI = async (opts?: { force?: boolean }) => {
    const guide = draft.trim();
    const queryKey = ["ai-suggestion", conversationId, guide] as const;
    setAiLoading(true);
    try {
      if (opts?.force) qc.removeQueries({ queryKey });
      const data = await qc.fetchQuery({
        queryKey,
        queryFn: async () => {
          const qs = guide ? `?input=${encodeURIComponent(guide)}` : "";
          const res = await fetch(`/api/conversations/${conversationId}/ai${qs}`);
          const json = (await res.json()) as AIResponse & { error?: string };
          if (!res.ok) throw new Error(json.error ?? String(res.status));
          return json;
        },
        staleTime: Infinity,
      });
      setAiResult(data);
    } catch (err) {
      alert(`Gợi ý AI thất bại: ${(err as Error).message}`);
    } finally {
      setAiLoading(false);
    }
  };

  const toggleAi = () => {
    const next = !aiOpen;
    setAiOpen(next);
    if (next) void fetchAI();
  };

  const useSuggestion = (text: string) => {
    if (text) setDraft(text);
    setAiOpen(false);
    // Trả focus về ô chat để Enter gửi được ngay (nếu không, focus kẹt ở
    // nút gợi ý vừa bị unmount → rơi về body → Enter không kích hoạt onKeyDown).
    textareaRef.current?.focus();
  };

  const aiOptions: { key: string; label: string; text: string }[] = (aiResult?.options ?? [])
    .map((o, i) => ({ key: String(i), label: o.label, text: o.text }))
    .filter((o) => o.text);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border px-4 py-3">
        {onBack ? (
          <button
            onClick={onBack}
            aria-label="Quay lại danh sách"
            className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary md:hidden"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        ) : null}
        <Avatar className="h-8 w-8">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
          <AvatarFallback className="bg-accent text-xs font-bold text-primary">
            {initials(name)}
          </AvatarFallback>
        </Avatar>
        <h2 className="min-w-0 truncate font-bold leading-tight text-foreground">
          {name}
          {shopName && (
            <span className="font-normal text-muted-foreground"> · {shopName}</span>
          )}
        </h2>
        {/* Mã hội thoại + nút mở tab mới — gom cùng nhóm, căn giữa, sát nhau (không bị tên đẩy xa). */}
        <div className="flex shrink-0 items-center gap-1 text-sm font-normal text-muted-foreground">
          {name !== `#${conversationId}` && (
            <span className="select-all whitespace-nowrap">· #{conversationId}</span>
          )}
          <a
            href={`/messages/${conversationId}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Mở tin nhắn ở tab mới"
            aria-label="Mở tin nhắn ở tab mới"
            className="inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-secondary hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {onToggleNotes ? (
            <button
              onClick={onToggleNotes}
              aria-label="Ghi chú"
              aria-pressed={notesOpen}
              className={
                "flex h-8 w-8 items-center justify-center rounded-full transition-colors " +
                (notesOpen
                  ? "bg-accent text-primary"
                  : "text-muted-foreground hover:bg-secondary")
              }
            >
              <StickyNote className="h-4 w-4" />
            </button>
          ) : null}
          {onToggleInfo ? (
            <button
              onClick={onToggleInfo}
              aria-label="Lịch sử đơn hàng"
              aria-pressed={infoOpen}
              className={
                "flex h-8 w-8 items-center justify-center rounded-full transition-colors " +
                (infoOpen
                  ? "bg-accent text-primary"
                  : "text-muted-foreground hover:bg-secondary")
              }
            >
              <Info className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </header>

      <MessageList conversationId={conversationId} pending={pending} />

      {/* Panel gợi ý AI — bám sát ô chat, dùng nội dung đang gõ làm định hướng.
          translate="no": chặn extension dịch trang (Google Translate) bọc/dời text node
          trong subtree động này — nếu không, React swap icon/option sẽ gây
          "insertBefore ... not a child of this node" và sập cả panel. */}
      {aiOpen && (
        <div
          translate="no"
          className="shrink-0 border-t border-border bg-info-soft px-3 py-2.5 md:px-6"
        >
          <div className="flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1 font-semibold text-info">
              <Sparkles className="h-3.5 w-3.5" /> Gợi ý AI
            </span>
            {aiResult?.suggested_tag ? (
              <span className="rounded-full bg-info-soft px-2 py-0.5 font-medium text-info">
                {aiResult.suggested_tag}
              </span>
            ) : null}
            <button
              onClick={() => fetchAI({ force: true })}
              disabled={aiLoading}
              className="ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-info hover:bg-info-soft disabled:opacity-50"
            >
              {aiLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Tạo lại
            </button>
            <button
              onClick={() => setAiOpen(false)}
              aria-label="Đóng"
              className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {aiLoading && aiOptions.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">Đang tạo gợi ý…</p>
          ) : aiOptions.length > 0 ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {aiOptions.map((o) => (
                <button
                  key={o.key}
                  onClick={() => useSuggestion(o.text)}
                  title="Bấm để đưa vào ô chat"
                  className="rounded-xl border border-info-soft bg-card p-2.5 text-left text-sm text-foreground transition-colors hover:border-info hover:bg-info-soft"
                >
                  <div className="mb-1 text-xs font-semibold text-info">{o.label}</div>
                  <div className="line-clamp-4 whitespace-pre-wrap break-words">{o.text}</div>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Composer */}
      <div className="relative shrink-0 border-t border-border px-3 py-4 md:px-6">
        {/* Preview ảnh đã chọn */}
        {(attachments.length > 0 || uploading) && (
          <div className="mb-3 flex flex-wrap gap-2">
            {attachments.map((url) => (
              <div key={url} className="relative h-20 w-20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt=""
                  className="h-20 w-20 rounded-lg border border-border object-cover"
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
              <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-input-strong text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}
          </div>
        )}
        {templateOpen && (
          <TemplatePicker
            onSelect={(content) => {
              setDraft(content);
              setTemplateOpen(false);
              textareaRef.current?.focus();
            }}
            onClose={() => setTemplateOpen(false)}
          />
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={onPickFiles}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            aria-label="Đính kèm ảnh"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-50"
          >
            <Paperclip className="h-5 w-5" />
          </button>
          <button
            onClick={() => setTemplateOpen((v) => !v)}
            aria-label="Mẫu câu sẵn"
            aria-pressed={templateOpen}
            className={
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors " +
              (templateOpen
                ? "bg-accent text-primary"
                : "text-muted-foreground hover:bg-secondary")
            }
          >
            <BookMarked className="h-5 w-5" />
          </button>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            placeholder="Nhập tin nhắn… (Enter gửi · Shift+Enter xuống dòng · Ctrl+Enter gợi ý AI)"
            className="chat-input-scroll max-h-32 flex-1 resize-none overflow-y-hidden rounded-2xl border-0 bg-secondary px-4 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={toggleAi}
            aria-label="Gợi ý AI"
            aria-pressed={aiOpen}
            className={
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors " +
              (aiOpen
                ? "bg-info-soft text-info"
                : "text-info hover:bg-info-soft")
            }
          >
            <Sparkles className="h-5 w-5" />
          </button>
          <button
            onClick={submit}
            disabled={(!draft.trim() && attachments.length === 0) || uploading}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-primary/90 disabled:bg-input-strong"
            aria-label="Gửi tin nhắn"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
