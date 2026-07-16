"use client";

import { useState } from "react";
import { X, Package, ChevronDown, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useConversationDetail } from "@/lib/hooks/useConversationDetail";
import { TagEditor } from "@/components/messenger/TagEditor";
import { ReceiptUpdateEditor } from "@/components/messenger/ReceiptUpdateEditor";
import type { ReceiptHistoryItem } from "@/lib/types/etsy";

function ReceiptCard({ r }: { r: ReceiptHistoryItem }) {
  // Mặc định mở sẵn để nhìn đủ sản phẩm.
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-2xl border border-border">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-start gap-2 p-3 text-left"
      >
        <ChevronDown
          className={
            "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform " +
            (open ? "" : "-rotate-90")
          }
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{r.date || "—"}</p>
              {r.receiptId ? (
                <p
                  onClick={(e) => e.stopPropagation()}
                  className="cursor-text select-text text-xs text-muted-foreground"
                >
                  #{r.receiptId}
                </p>
              ) : null}
            </div>
            <span className="shrink-0 text-sm font-bold text-foreground">{r.value || "—"}</span>
          </div>
        </div>
      </div>

      {open ? (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {r.transactions.map((t) => (
            <div key={t.transactionId} className="flex items-start gap-2">
              {t.image ? (
                <img
                  src={t.image}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                  <Package className="h-5 w-5" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="break-words text-xs text-foreground">{t.title || "—"}</p>
                <p className="text-xs text-muted-foreground">
                  {t.quantity} × {t.value}
                </p>
                <p className="cursor-text select-text break-all text-xs text-muted-foreground">
                  #{r.receiptId}-{t.transactionId}
                </p>
                {t.personalizationFiles.length > 0 ? (
                  <div className="mt-1">
                    <p className="text-[11px] text-muted-foreground">Your Photo:</p>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {t.personalizationFiles.map((f, i) => (
                        <a
                          key={`${t.transactionId}-perso-${i}`}
                          href={f.url || f.thumbnailUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={f.filename || "Customer photo"}
                        >
                          <img
                            src={f.thumbnailUrl || f.url}
                            alt={f.filename || "Customer photo"}
                            className="h-12 w-12 rounded-lg border border-border object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ReceiptHistoryPanel({
  conversationId,
  onClose,
}: {
  conversationId: number;
  onClose?: () => void;
}) {
  const { data, isLoading, isError } = useConversationDetail(conversationId);
  const receipts = data?.receiptHistory ?? [];
  const storeName = data?.storeName ?? "";

  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  // Yêu cầu extension GET lại ảnh khách upload ("Your Photo") cho toàn hội thoại.
  const handleRefreshPhotos = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/personalization/refresh`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        alert(body.error || "Không gửi được yêu cầu làm mới ảnh (extension có thể chưa mở).");
        return;
      }
      // Extension fetch bất đồng bộ qua Ably → đợi rồi refetch để hiện ảnh mới.
      await new Promise((r) => setTimeout(r, 3000));
      await queryClient.invalidateQueries({ queryKey: ["conversation-detail", conversationId] });
    } catch (e) {
      console.error("[ReceiptHistoryPanel] refresh photos failed", e);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <aside className="flex h-full w-full flex-col border-l border-border bg-card">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <h3 className="font-bold text-foreground">Lịch sử đơn hàng</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefreshPhotos}
            disabled={refreshing}
            title="GET lại ảnh khách upload (Your Photo)"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-50"
            aria-label="Làm mới ảnh khách upload"
          >
            <RefreshCw className={"h-4 w-4 " + (refreshing ? "animate-spin" : "")} />
          </button>
          {onClose ? (
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary"
              aria-label="Đóng"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        {isLoading ? (
          <p className="px-1 py-4 text-sm text-muted-foreground">Đang tải…</p>
        ) : isError ? (
          <p className="px-1 py-4 text-sm text-destructive">Không tải được lịch sử đơn hàng.</p>
        ) : receipts.length === 0 ? (
          <p className="px-1 py-4 text-sm text-muted-foreground">Khách chưa có đơn hàng.</p>
        ) : (
          <>
            {/* Khối cập nhật đơn — ưu tiên Sheet, rớt sang Mera. 1 card / 1 đơn (receipt). */}
            {receipts.length > 0 ? (
              <section className="mb-4">
                <h4 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Cập nhật đơn
                </h4>
                <div className="flex flex-col gap-2">
                  {receipts.map((r) => (
                    <ReceiptUpdateEditor
                      key={r.receiptId}
                      store={storeName}
                      receiptId={r.receiptId}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {/* Lịch sử đơn hàng */}
            <h4 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Lịch sử đơn
            </h4>
            <div className="flex flex-col gap-3">
              {receipts.map((r) => (
                <ReceiptCard key={r.receiptId} r={r} />
              ))}
            </div>
          </>
        )}

        {/* Quản lý thẻ cấp hội thoại — dưới phần lịch sử đơn */}
        <div className="mt-3">
          <TagEditor conversationId={conversationId} />
        </div>
      </div>
    </aside>
  );
}
