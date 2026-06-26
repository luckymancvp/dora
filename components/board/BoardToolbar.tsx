"use client";

import { useState } from "react";
import {
  Search,
  ArrowUp,
  ArrowDown,
  Send,
  Sparkles,
  Loader2,
  Columns3,
  Eraser,
  Filter,
  X,
} from "lucide-react";
import { ShopFilter } from "@/components/messenger/ShopFilter";
import { TagFilter } from "@/components/messenger/TagFilter";
import { SheetStatusFilter } from "@/components/messenger/SheetStatusFilter";
import { FilterChip } from "@/components/messenger/FilterChip";
import { Input } from "@/components/ui/input";
import { MobileMenuButton } from "@/components/sidebar";
import type { ConversationFilters } from "@/lib/types/etsy";
import type { DispatchState } from "@/lib/hooks/useBoardDispatch";
import { cn } from "@/lib/utils";

/** Tiến độ "Tạo AI tất cả". */
export interface BoardAIGenState {
  running: boolean;
  total: number;
  done: number;
}

const COLUMN_CHOICES = [1, 2];
const PAGE_SIZES = [20, 50, 100];

export function BoardToolbar({
  filters,
  onFiltersChange,
  maxMessages,
  onMaxMessages,
  waitingHours,
  onWaitingHours,
  onApply,
  filtersDirty,
  columns,
  onColumns,
  pageSize,
  onPageSize,
  onFillTemplate,
  onClearDrafts,
  draftCount,
  shown,
  total,
  loading,
  onGenerateAllAI,
  aiGen,
  onSendAll,
  dispatch,
  onCancelSend,
}: {
  filters: ConversationFilters;
  onFiltersChange: (patch: Partial<ConversationFilters>) => void;
  maxMessages: number | null;
  onMaxMessages: (v: number | null) => void;
  waitingHours: number | null;
  onWaitingHours: (v: number | null) => void;
  onApply: () => void;
  filtersDirty: boolean;
  columns: number;
  onColumns: (n: number) => void;
  pageSize: number;
  onPageSize: (n: number) => void;
  onFillTemplate: (text: string) => void;
  onClearDrafts: () => void;
  draftCount: number;
  shown: number;
  total: number;
  loading: boolean;
  onGenerateAllAI: () => void;
  aiGen: BoardAIGenState;
  onSendAll: () => void;
  dispatch: DispatchState;
  onCancelSend: () => void;
}) {
  const [template, setTemplate] = useState("");

  const fill = () => {
    const t = template.trim();
    if (t) onFillTemplate(t);
  };

  const numOrNull = (raw: string): number | null => {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  return (
    <div className="sticky top-0 z-20 shrink-0 space-y-2.5 border-b border-border bg-card px-4 py-3">
      {/* Hàng 1: tiêu đề + cột + đếm */}
      <div className="flex flex-wrap items-center gap-3">
        <MobileMenuButton className="-ml-1" />
        <h1 className="text-xl font-medium tracking-tight text-foreground">Bảng xử lý</h1>
        <span className="text-sm text-muted-foreground">
          Hiện <span className="font-bold text-foreground">{shown}</span>
          {total !== shown && <> / {total}</>} hội thoại
          {loading && <Loader2 className="ml-1 inline h-3.5 w-3.5 animate-spin" />}
        </span>

        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            Page Size
            <select
              value={pageSize}
              onChange={(e) => onPageSize(parseInt(e.target.value, 10))}
              className="rounded-lg border border-border bg-background px-2 py-1 text-sm font-bold text-foreground outline-none focus:border-primary"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1.5">
            <Columns3 className="h-4 w-4 text-muted-foreground" />
            {COLUMN_CHOICES.map((n) => (
              <button
                key={n}
                onClick={() => onColumns(n)}
                className={cn(
                  "h-7 w-7 rounded-lg text-xs font-bold transition-colors",
                  columns === n
                    ? "bg-primary text-white"
                    : "border border-border text-muted-foreground hover:bg-secondary",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Hàng 2: tìm + lọc */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(e) => onFiltersChange({ search: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") onApply();
            }}
            placeholder="Tìm tên, nội dung, hoặc #đơn"
            className="h-9 rounded-full border-0 bg-secondary pl-9 text-sm"
          />
        </div>
        <button
          onClick={() => onFiltersChange({ sort: filters.sort === "desc" ? "asc" : "desc" })}
          title={filters.sort === "desc" ? "Mới nhất trước" : "Cũ nhất trước (chờ lâu nhất lên đầu)"}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full transition-colors",
            filters.sort === "asc" ? "bg-accent text-primary" : "text-muted-foreground hover:bg-secondary",
          )}
        >
          {filters.sort === "desc" ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
        </button>
        <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap">
          <div className="w-28">
            <FilterChip
              label="Help request"
              active={filters.orderHelp}
              onClick={() => onFiltersChange({ orderHelp: !filters.orderHelp })}
            />
          </div>
          <div className="w-28">
            <FilterChip
              label="Not replied"
              active={filters.notReplied}
              onClick={() => onFiltersChange({ notReplied: !filters.notReplied })}
            />
          </div>
          <div className="w-28">
            <FilterChip
              label="Has order"
              active={filters.hasOrder}
              onClick={() => onFiltersChange({ hasOrder: !filters.hasOrder })}
            />
          </div>
          <div className="w-28">
            <FilterChip
              label="Has note"
              active={filters.hasNote}
              onClick={() => onFiltersChange({ hasNote: !filters.hasNote })}
            />
          </div>
          <div className="w-28">
            <ShopFilter selected={filters.shopIds} onChange={(ids) => onFiltersChange({ shopIds: ids })} />
          </div>
          <div className="w-28">
            <TagFilter
              selected={filters.tags}
              onChange={(tags) => onFiltersChange({ tags })}
              shopIds={filters.shopIds}
              label="Tags"
            />
          </div>
          <div className="w-28">
            <SheetStatusFilter
              selected={filters.sheetStatuses}
              onChange={(s) => onFiltersChange({ sheetStatuses: s })}
            />
          </div>
        </div>
      </div>

      {/* Hàng 3: lọc client */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-1.5 text-muted-foreground">
          Dưới
          <input
            type="number"
            min={1}
            value={maxMessages ?? ""}
            onChange={(e) => onMaxMessages(numOrNull(e.target.value))}
            placeholder="—"
            className="w-16 rounded-lg border border-border bg-background px-2 py-1 text-sm font-bold text-foreground outline-none focus:border-primary"
          />
          tin nhắn
        </label>
        <label className="flex items-center gap-1.5 text-muted-foreground">
          Chờ &gt;
          <input
            type="number"
            min={1}
            value={waitingHours ?? ""}
            onChange={(e) => onWaitingHours(numOrNull(e.target.value))}
            placeholder="—"
            className="w-16 rounded-lg border border-border bg-background px-2 py-1 text-sm font-bold text-foreground outline-none focus:border-primary"
          />
          giờ
        </label>
        <button
          onClick={onApply}
          title="Áp dụng bộ lọc đang chọn"
          className={cn(
            "ml-auto flex h-9 items-center gap-1.5 rounded-full px-5 text-sm font-bold transition-colors",
            filtersDirty
              ? "bg-primary text-white hover:bg-primary/90"
              : "border border-border bg-card text-muted-foreground hover:bg-secondary",
          )}
        >
          <Filter className="h-4 w-4" />
          Lọc
          {filtersDirty && <span className="h-2 w-2 rounded-full bg-white" />}
        </button>
      </div>

      {/* Hàng 4: điền mẫu + hành động hàng loạt */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl bg-secondary/60 p-2">
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={1}
          placeholder="Điền một mẫu trả lời cho TẤT CẢ ô đang hiển thị…"
          className="min-h-[38px] min-w-[240px] flex-1 resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
        <button
          onClick={fill}
          disabled={!template.trim()}
          className="flex h-9 items-center gap-1.5 rounded-full bg-foreground px-4 text-sm font-bold text-background transition-colors hover:opacity-90 disabled:opacity-40"
        >
          Điền cho tất cả
        </button>
        <button
          onClick={onClearDrafts}
          disabled={draftCount === 0}
          className="flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm font-bold text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-40"
        >
          <Eraser className="h-4 w-4" />
          Xoá draft
        </button>
        <button
          onClick={onGenerateAllAI}
          disabled={aiGen.running}
          className="flex h-9 items-center gap-1.5 rounded-full border border-info bg-info-soft px-4 text-sm font-bold text-info transition-colors hover:bg-info-soft/70 disabled:opacity-50"
        >
          {aiGen.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {aiGen.running ? `Tạo AI ${aiGen.done}/${aiGen.total}` : "Tạo AI tất cả"}
        </button>

        {dispatch.running ? (
          <div className="flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-sm font-bold text-white">
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang gửi {dispatch.done}/{dispatch.total} (✓{dispatch.ok} ✗{dispatch.fail})
            <button onClick={onCancelSend} className="ml-1 rounded-full p-0.5 hover:bg-white/20" title="Dừng">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={onSendAll}
            disabled={draftCount === 0}
            className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-bold text-white transition-colors hover:bg-primary/90 disabled:bg-input-strong"
          >
            <Send className="h-4 w-4" />
            Gửi tất cả ({draftCount})
          </button>
        )}
      </div>
    </div>
  );
}
