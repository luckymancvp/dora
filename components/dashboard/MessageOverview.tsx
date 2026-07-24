"use client";

import { useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { useMessageOverview } from "@/lib/hooks/useAnalytics";
import type { AnalyticsFilters } from "@/lib/types/etsy";
import { PanelCard, StatCard } from "./PanelCard";
import { useOpenMultiple } from "./useOpenMultiple";
import { AllClearCelebration } from "./AllClearCelebration";
import { RiveIcon } from "@/components/RiveIcon";

export function MessageOverview({ filters }: { filters: AnalyticsFilters }) {
  const { data, isPending, isError } = useMessageOverview(filters);
  const openMultiple = useOpenMultiple();

  const totals = data?.totals ?? { total: 0, unread: 0, completed: 0 };
  // Sắp xếp shop theo số tin chưa trả lời (lớn → nhỏ).
  const shops = useMemo(
    () => [...(data?.shopBreakdown ?? [])].sort((a, b) => b.unread - a.unread),
    [data?.shopBreakdown],
  );

  // Gộp toàn bộ hội thoại chưa trả lời (cho nút "Mở tất cả tin chưa đọc"),
  // đính kèm tên shop để bảng "mở nhiều" hiển thị được.
  const allUnread = useMemo(
    () =>
      shops.flatMap((s) =>
        s.unreadConversations.map((c) => ({ ...c, shop: s.shopName })),
      ),
    [shops],
  );

  // Đã có dữ liệu thật (không còn ở trạng thái tải lần đầu) → cho phép ăn mừng.
  const ready = !isPending && !isError && data != null;

  return (
    <PanelCard
      title="Tổng quan tin nhắn"
      subtitle="Theo từng shop"
      loading={isPending}
      className="xl:col-span-1"
    >
      {/* Mèo chơi đùa vắt lên mép trên panel (nền trong suốt). */}
      <div className="pointer-events-none absolute -top-22.5 right-6 z-10">
        <RiveIcon
          src="/rive/cat-playing.riv"
          artboard="Cat playing animation"
          animation="Cat playing animation"
          size={140}
        />
      </div>

      {/* Ăn mừng khi số tin chưa trả lời chuyển về 0. */}
      <AllClearCelebration unread={totals.unread} ready={ready} />

      {/* 3 thẻ số liệu */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard value={totals.total} label="Tổng tin" />
        <StatCard
          value={totals.unread}
          label="Chưa trả lời"
          tone={totals.unread === 0 ? "success" : "danger"}
        >
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

      {/* Bảng theo shop */}
      <div className="mt-5 overflow-x-auto">
        {isError ? (
          <p className="py-6 text-center text-sm text-destructive">Không tải được dữ liệu.</p>
        ) : shops.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Chưa có dữ liệu.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-bold">Shop</th>
                <th className="px-2 py-2 text-center font-bold">Tổng</th>
                <th className="px-2 py-2 text-center font-bold">Chưa trả lời</th>
                <th className="px-2 py-2 text-center font-bold">Đã xong</th>
                <th className="py-2 pl-2 text-right font-bold">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary">
              {shops.map((s) => (
                <tr key={s.shopId}>
                  <td className="py-2.5 pr-3">
                    <span className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${s.online ? "bg-success" : "bg-warning"}`}
                      />
                      <span className="truncate font-bold text-foreground">{s.shopName}</span>
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-center font-bold text-foreground">{s.total}</td>
                  <td className="px-2 py-2.5 text-center">
                    <span
                      className={`inline-flex min-w-6 justify-center rounded-full px-2 py-0.5 text-xs font-bold ${
                        s.unread > 0
                          ? "bg-destructive-soft text-destructive"
                          : "bg-success-soft text-success"
                      }`}
                    >
                      {s.unread}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-center font-bold text-success">
                    {s.completed}
                  </td>
                  <td className="py-2.5 pl-2 text-right">
                    {s.unreadConversations.length > 0 ? (
                      <button
                        type="button"
                        onClick={() =>
                          openMultiple(
                            s.unreadConversations.map((c) => ({ ...c, shop: s.shopName })),
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-bold text-primary transition-colors hover:bg-accent"
                      >
                        Mở {s.unreadConversations.length}
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PanelCard>
  );
}
