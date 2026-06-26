"use client";

import { useState } from "react";
import { Check, AlertCircle, Loader2 } from "lucide-react";
import { ConversationView } from "@/components/messenger/ConversationView";
import { ReceiptHistoryPanel } from "@/components/messenger/ReceiptHistoryPanel";
import { NotesPanel } from "@/components/messenger/NotesPanel";
import { SlideInPanel } from "@/components/messenger/SlideInPanel";
import type { ConversationListItem } from "@/lib/types/etsy";
import { cn } from "@/lib/utils";

/** Trạng thái gửi của ô (điều khiển từ page khi gửi hàng loạt). */
export type CellStatus = "idle" | "sending" | "ok" | "fail";

/**
 * Một ô trên Bảng xử lý = MỘT hộp thoại đầy đủ y như trang Messages:
 * tái dùng ConversationView (composer, đính kèm, tin nhắn sẵn, gợi ý AI, gửi)
 * + panel Ghi chú và Lịch sử đơn hàng có nút ẩn/hiện (giống ChatPanel).
 * Draft được điều khiển từ page để hỗ trợ "điền mẫu / gửi tất cả".
 */
export function BoardCell({
  conv,
  draft,
  onDraftChange,
  status,
  aiTrigger,
  onDismiss,
}: {
  conv: ConversationListItem;
  draft: string;
  onDraftChange: (v: string) => void;
  status: CellStatus;
  aiTrigger: number;
  onDismiss: () => void;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  return (
    <div
      className={cn(
        "relative flex h-[680px] min-h-0 overflow-hidden rounded-2xl border bg-card transition-opacity",
        status === "ok" && "border-success opacity-60",
        status === "fail" && "border-destructive",
        status !== "ok" && status !== "fail" && "border-border",
      )}
    >
      {/* Cờ trạng thái gửi hàng loạt — góc trên trái, không chắn nút ở header. */}
      {status !== "idle" && (
        <div className="pointer-events-none absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-card shadow">
          {status === "sending" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          {status === "ok" && <Check className="h-4 w-4 text-success" />}
          {status === "fail" && <AlertCircle className="h-4 w-4 text-destructive" />}
        </div>
      )}

      <ConversationView
        conversationId={conv.conversationId}
        meta={{ name: conv.name, avatar: conv.avatar }}
        draft={draft}
        onDraftChange={onDraftChange}
        autoFetchAI={false}
        aiTrigger={aiTrigger}
        infoOpen={infoOpen}
        onToggleInfo={() => setInfoOpen((v) => !v)}
        notesOpen={notesOpen}
        onToggleNotes={() => setNotesOpen((v) => !v)}
        onDismiss={onDismiss}
      />
      <SlideInPanel open={notesOpen}>
        <NotesPanel
          conversationId={conv.conversationId}
          onClose={() => setNotesOpen(false)}
        />
      </SlideInPanel>
      <SlideInPanel open={infoOpen} widthClass="w-80">
        <ReceiptHistoryPanel
          conversationId={conv.conversationId}
          onClose={() => setInfoOpen(false)}
        />
      </SlideInPanel>
    </div>
  );
}
