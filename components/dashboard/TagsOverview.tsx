"use client";

import { useMemo } from "react";
import { ExternalLink, Loader2, Pin, Tag } from "lucide-react";
import { useTagsOverview } from "@/lib/hooks/useAnalytics";
import { usePinnedTags, useTogglePinnedTag } from "@/lib/hooks/usePinnedTags";
import type {
  AnalyticsFilters,
  CompletedScope,
  TagOverviewRow,
  UnreadConvItem,
} from "@/lib/types/etsy";
import { UNTAGGED_PIN_KEY } from "@/lib/types/user-preferences";
import { tagLabel } from "@/lib/tags";
import { PanelCard, StatCard } from "./PanelCard";
import { useOpenMultiple } from "./useOpenMultiple";
import { completedScopeKey, useOpenCompleted } from "./useOpenCompleted";

/** Khoá ghim của 1 dòng — giá trị DB của tag (không phải nhãn hiển thị), dòng No Tag dùng sentinel. */
function pinKeyOf(t: TagOverviewRow): string {
  return t.untagged ? UNTAGGED_PIN_KEY : t.tag;
}

function completedScopeOf(t: TagOverviewRow): CompletedScope {
  return t.untagged ? { kind: "untagged" } : { kind: "tag", tag: t.tag };
}

export function TagsOverview({ filters }: { filters: AnalyticsFilters }) {
  const { data, isPending, isError } = useTagsOverview(filters);
  const openMultiple = useOpenMultiple();
  const { openCompleted, pendingKey } = useOpenCompleted(filters);
  const pinnedQuery = usePinnedTags();
  const togglePin = useTogglePinnedTag();

  // Đang tải / lỗi → coi như chưa ghim tag nào.
  const pinnedSet = useMemo(
    () => new Set(pinnedQuery.data?.pinnedTags ?? []),
    [pinnedQuery.data?.pinnedTags],
  );

  const totals = data?.totals ?? { total: 0, unread: 0, completed: 0 };
  // Tag ghim lên đầu; trong mỗi nhóm sắp theo số tin chưa trả lời (lớn → nhỏ).
  const tags = useMemo(
    () =>
      [...(data?.tags ?? [])].sort((a, b) => {
        const pa = pinnedSet.has(pinKeyOf(a)) ? 1 : 0;
        const pb = pinnedSet.has(pinKeyOf(b)) ? 1 : 0;
        if (pa !== pb) return pb - pa;
        return b.unread - a.unread;
      }),
    [data?.tags, pinnedSet],
  );

  const allUnread = useMemo<UnreadConvItem[]>(() => {
    // Gộp theo conversationId để không trùng khi 1 hội thoại có nhiều tag.
    const map = new Map<number, UnreadConvItem>();
    for (const t of tags) for (const c of t.unreadConversations) map.set(c.conversationId, c);
    return [...map.values()];
  }, [tags]);

  return (
    <PanelCard title="Tổng quan theo Tag" subtitle="Phân loại hội thoại" loading={isPending}>
      <div className="grid grid-cols-3 gap-3">
        <StatCard value={totals.total} label="Tổng tin" />
        <StatCard value={totals.unread} label="Chưa trả lời" tone="danger">
          {allUnread.length > 0 && (
            <button
              type="button"
              onClick={() => openMultiple(allUnread)}
              className="mt-2 inline-flex items-center gap-1 self-start rounded-full border border-destructive px-3 py-1 text-xs font-bold text-destructive transition-colors hover:bg-destructive-soft"
            >
              <ExternalLink className="h-3 w-3" />
              Mở tin
            </button>
          )}
        </StatCard>
        <StatCard value={totals.completed} label="Đã xong" tone="success" />
      </div>

      <div className="mt-5 max-h-80 overflow-y-auto">
        {isError ? (
          <p className="py-6 text-center text-sm text-destructive">Không tải được dữ liệu.</p>
        ) : tags.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Chưa có dữ liệu.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-bold">Tag</th>
                <th className="px-2 py-2 text-center font-bold">Tổng</th>
                <th className="px-2 py-2 text-center font-bold">Chưa trả lời</th>
                <th className="px-2 py-2 text-center font-bold">Đã xong</th>
                <th className="py-2 pl-2 text-right font-bold">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary">
              {tags.map((t) => {
                const pinKey = pinKeyOf(t);
                const isPinned = pinnedSet.has(pinKey);
                const scope = completedScopeOf(t);
                const completedPending = pendingKey === completedScopeKey(scope);
                return (
                  <tr key={t.untagged ? "__notag__" : t.tag}>
                    <td className="py-2.5 pr-3">
                      <span className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => togglePin.mutate({ tag: pinKey, pinned: !isPinned })}
                          aria-label={isPinned ? "Bỏ ghim tag" : "Ghim tag"}
                          title={isPinned ? "Bỏ ghim tag" : "Ghim tag"}
                          aria-pressed={isPinned}
                          className="shrink-0 rounded p-0.5 transition-colors hover:bg-accent"
                        >
                          <Pin
                            className={`h-3.5 w-3.5 ${
                              isPinned ? "fill-current text-primary" : "text-muted-foreground"
                            }`}
                          />
                        </button>
                        <Tag className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <span
                          className={`truncate font-bold ${t.untagged ? "italic text-muted-foreground" : "text-foreground"}`}
                        >
                          {t.untagged ? "No Tag" : tagLabel(t.tag)}
                        </span>
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-center font-bold text-foreground">{t.total}</td>
                    <td className="px-2 py-2.5 text-center">
                      <span
                        className={`inline-flex min-w-6 justify-center rounded-full px-2 py-0.5 text-xs font-bold ${
                          t.unread > 0 ? "bg-destructive-soft text-destructive" : "bg-success-soft text-success"
                        }`}
                      >
                        {t.unread}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      {t.completed > 0 ? (
                        <button
                          type="button"
                          onClick={() => void openCompleted(scope)}
                          disabled={completedPending}
                          title="Mở tin đã xong"
                          className="inline-flex min-w-6 items-center justify-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-bold text-success transition-shadow hover:ring-1 hover:ring-success disabled:cursor-wait disabled:opacity-70"
                        >
                          {completedPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <ExternalLink className="h-3 w-3" />
                          )}
                          {t.completed}
                        </button>
                      ) : (
                        <span className="text-xs font-bold text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="py-2.5 pl-2 text-right">
                      {t.unreadConversations.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => openMultiple(t.unreadConversations)}
                          className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-bold text-primary transition-colors hover:bg-accent"
                        >
                          Mở {t.unreadConversations.length}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </PanelCard>
  );
}
