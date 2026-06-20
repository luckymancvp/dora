"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search, MessageSquareReply, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useConversations } from "@/lib/hooks/useConversations";
import { useShops } from "@/lib/hooks/useShops";
import { ShopFilter } from "@/components/messenger/ShopFilter";
import { TagFilter } from "@/components/messenger/TagFilter";
import { SheetStatusFilter } from "@/components/messenger/SheetStatusFilter";
import { useTabs } from "@/lib/store/tabs";
import type { ConversationFilters, ConversationListItem } from "@/lib/types/etsy";
import { tagClassName, tagLabel } from "@/lib/tags";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { MobileMenuButton } from "@/components/sidebar";
import { initials, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 76;

const Row = memo(function Row({
  c,
  shopName,
  active,
  onClick,
}: {
  c: ConversationListItem;
  shopName?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors",
        active ? "bg-accent" : "hover:bg-secondary",
      )}
    >
      <Avatar className="h-12 w-12 shrink-0">
        {c.avatar ? <AvatarImage src={c.avatar} alt={c.name} /> : null}
        <AvatarFallback className="bg-accent text-primary font-bold">
          {initials(c.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-bold text-sm text-foreground">
            {c.name || `#${c.conversationId}`}
            {shopName && (
              <span className="font-normal text-muted-foreground"> · {shopName}</span>
            )}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {timeAgo(c.lastMessageDate)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "truncate text-sm",
              c.hasReplied ? "text-muted-foreground" : "font-semibold text-foreground",
            )}
          >
            {c.excerpt || "—"}
          </span>
          {!c.hasReplied && (
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
          )}
        </div>
        {c.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {c.tags.map((tag) => (
              <span
                key={tag}
                className={cn(
                  "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                  tagClassName(tag),
                )}
              >
                {tagLabel(tag)}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
});

const FilterChip = memo(function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full rounded-full border px-3 py-1.5 text-center text-xs font-medium transition-colors",
        active
          ? "border-primary bg-accent text-primary"
          : "border-border text-muted-foreground hover:bg-secondary",
      )}
    >
      {label}
    </button>
  );
});

export function ConversationList({ className }: { className?: string }) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [orderHelp, setOrderHelp] = useState(false);
  const [notReplied, setNotReplied] = useState(false);
  const [sort, setSort] = useState<"asc" | "desc">("desc");

  // Khi bật Not Replied → tự chuyển sang cũ nhất trước; khi tắt → về mới nhất trước.
  useEffect(() => {
    setSort(notReplied ? "asc" : "desc");
  }, [notReplied]);
  const [hasOrder, setHasOrder] = useState(false);
  const [hasNote, setHasNote] = useState(false);
  const [shopIds, setShopIds] = useState<number[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedSheetStatuses, setSelectedSheetStatuses] = useState<string[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const { openTab, openMany, activeTabId } = useTabs();

  // Debounce search.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filters: ConversationFilters = useMemo(
    () => ({ search, orderHelp, notReplied, hasOrder, hasNote, shopIds, tags: selectedTags, sheetStatuses: selectedSheetStatuses, sort }),
    [search, orderHelp, notReplied, hasOrder, hasNote, shopIds, selectedTags, selectedSheetStatuses, sort],
  );

  const { items, data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useConversations(filters);

  // Map shopUserId → tên shop để nối vào tên khách trong danh sách.
  const { data: shops } = useShops();
  const shopNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of shops ?? []) m.set(s.userId, s.shopName);
    return m;
  }, [shops]);

  // Mở nhanh N hội thoại đầu danh sách (tự load đủ trang trước khi mở).
  const BULK_CAP = 100; // trần an toàn cho "Tất cả"
  const bulkOpen = async (target: number | "all") => {
    if (bulkLoading) return;
    setBulkLoading(true);
    try {
      const cap = target === "all" ? BULK_CAP : target;
      let flat = (data?.pages ?? []).flatMap((p) => p.items);
      let canMore = hasNextPage;
      let guard = 0;
      while (flat.length < cap && canMore && guard < 30) {
        const res = await fetchNextPage();
        flat = (res.data?.pages ?? []).flatMap((p) => p.items);
        canMore = !!res.hasNextPage;
        guard++;
      }
      openMany(
        flat
          .slice(0, cap)
          .map((c) => ({ id: c.conversationId, meta: { name: c.name, avatar: c.avatar } })),
      );
    } finally {
      setBulkLoading(false);
    }
  };

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  // Infinite scroll: gần cuối → load thêm.
  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1];
    if (!last) return;
    if (last.index >= items.length - 5 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [virtualItems, items.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className={cn("w-full flex-col border-r border-border bg-card md:w-80 lg:w-96", className)}>
      <div className="px-5 pt-6 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MobileMenuButton className="md:hidden" />
            <h1 className="text-2xl font-medium tracking-tight text-foreground">Đoạn chat</h1>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSort((v) => (v === "desc" ? "asc" : "desc"))}
              title={sort === "desc" ? "Đang: Mới nhất trước — bấm để đổi sang Cũ nhất trước" : "Đang: Cũ nhất trước — bấm để đổi sang Mới nhất trước"}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-full transition-colors",
                sort === "asc"
                  ? "bg-accent text-primary"
                  : "text-muted-foreground hover:bg-secondary",
              )}
            >
              {sort === "desc" ? (
                <ArrowDown className="h-4 w-4" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </button>
            <Link
              href="/auto-replies"
              title="Tự động trả lời"
              aria-label="Tự động trả lời"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary"
            >
              <MessageSquareReply className="h-5 w-5" />
            </Link>
          </div>
        </div>
        <div className="relative mt-4">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Tìm tên, nội dung tin nhắn, hoặc số đơn (#...)"
            className="h-10 rounded-full border-0 bg-secondary pl-10 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {/* Bộ lọc — lưới 3 cột để các nút bằng nhau, cân đối */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <FilterChip
            label="Help request"
            active={orderHelp}
            onClick={() => setOrderHelp((v) => !v)}
          />
          <FilterChip
            label="Not Replied"
            active={notReplied}
            onClick={() => setNotReplied((v) => !v)}
          />
          <FilterChip
            label="Has Order"
            active={hasOrder}
            onClick={() => setHasOrder((v) => !v)}
          />
          <FilterChip
            label="Has note"
            active={hasNote}
            onClick={() => setHasNote((v) => !v)}
          />
          <ShopFilter selected={shopIds} onChange={setShopIds} />
          <TagFilter selected={selectedTags} onChange={setSelectedTags} shopIds={shopIds} />
          <SheetStatusFilter selected={selectedSheetStatuses} onChange={setSelectedSheetStatuses} />
        </div>

        {/* Mở nhanh nhiều hội thoại */}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Mở nhanh:</span>
          {([10, 25, 50, "all"] as const).map((n) => (
            <button
              key={String(n)}
              onClick={() => bulkOpen(n)}
              disabled={bulkLoading}
              className="rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-primary/90 disabled:bg-input-strong"
            >
              {n === "all" ? "Tất cả" : n}
            </button>
          ))}
          {bulkLoading && <span className="text-xs text-muted-foreground">Đang mở…</span>}
        </div>
      </div>

      <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {isLoading ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Đang tải…</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Không có đoạn chat nào.
          </p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualItems.map((v) => {
              const c = items[v.index];
              return (
                <div
                  key={c.conversationId}
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
                  <Row
                    c={c}
                    shopName={shopNameById.get(c.shopUserId)}
                    active={activeTabId === c.conversationId}
                    onClick={() =>
                      openTab(c.conversationId, { name: c.name, avatar: c.avatar })
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
