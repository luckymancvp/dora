"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DeliveryApiError, useBulkRefreshJob, useStartBulkRefresh } from "@/lib/hooks/useDelivery";
import { BULK_MAX_PER_SHOP, selectionShopCounts, type TrackingSelection } from "@/lib/delivery/trackingSelection";
import type { BulkRefreshJob, BulkRefreshShop } from "@/lib/types/delivery";
import { cn } from "@/lib/utils";

const PHASE_LABEL: Record<BulkRefreshShop["phase"], string> = {
  queued: "Chờ",
  shipments: "Đọc vận đơn",
  reviews: "Đọc đánh giá",
  done: "Xong",
  failed: "Lỗi",
};

/**
 * Thanh làm mới hàng loạt màn Giao hàng (chép Mera `pages/tracking/BulkRefreshBar.tsx`): số mã đã
 * chọn theo shop (≤50 / shop), nút gửi, rồi tiến độ từng shop (Mera chạy nền: shop song song, trong
 * shop giãn request). Hỏi tiến độ 3s/lần qua useBulkRefreshJob; xong → onDone (tải lại bảng).
 */
export function BulkRefreshBar({
  selection,
  onClear,
  onDone,
}: {
  selection: TrackingSelection;
  onClear: () => void;
  onDone: (job: BulkRefreshJob) => void;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const start = useStartBulkRefresh();
  const jobQuery = useBulkRefreshJob(jobId);
  // Lỗi đọc tiến độ (job hết hạn / mạng) → coi như không còn job (poll đã dừng), như Mera.
  const pollError = jobId ? jobQuery.error : null;
  const job = jobId && !pollError ? (jobQuery.data ?? null) : null;

  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  // Báo xong đúng 1 lần cho mỗi job (kể cả job `done` ngay từ lúc tạo).
  const doneHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!job?.done || doneHandledRef.current === job.id) return;
    doneHandledRef.current = job.id;
    onDoneRef.current(job);
  }, [job]);

  useEffect(() => {
    if (pollError) toast.error(`Không đọc được tiến độ: ${pollError.message}`);
  }, [pollError]);

  const counts = [...selectionShopCounts(selection).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const running = job != null && !job.done;
  const starting = start.isPending;

  const handleStart = () => {
    if (selection.size === 0 || running || starting) return;
    start.mutate([...selection.keys()], {
      onSuccess: (j) => setJobId(j.id),
      onError: (e) => {
        const code = e instanceof DeliveryApiError ? e.code : undefined;
        const msg = e.message || "Không bắt đầu được";
        if (code === "shop_bulk_running") toast.warning(msg);
        else toast.error(msg);
      },
    });
  };

  if (selection.size === 0 && !job) return null;

  return (
    <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium text-foreground">Đã chọn {selection.size.toLocaleString()} mã</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {counts.map(([shop, n]) => (
            <span
              key={shop}
              className={cn(
                "rounded-full border bg-background px-2 py-0.5 text-xs",
                n >= BULK_MAX_PER_SHOP ? "border-primary text-primary" : "border-border text-muted-foreground",
              )}
            >
              {shop} {n}/{BULK_MAX_PER_SHOP}
            </span>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {job?.done && (
            <Button variant="ghost" size="sm" onClick={() => setJobId(null)}>
              Đóng kết quả
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClear} disabled={running || starting || selection.size === 0}>
            <X className="h-3.5 w-3.5" /> Bỏ chọn
          </Button>
          <Button
            size="sm"
            onClick={handleStart}
            disabled={running || starting || selection.size === 0}
            title="Đọc lại Etsy cho các mã đã chọn: mỗi shop 1 lượt đọc vận đơn (≤50 mã), các shop chạy song song; mã đã giao đọc thêm đánh giá, giãn cách trong từng shop"
          >
            {running || starting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Làm mới hàng loạt
          </Button>
        </div>
      </div>

      {job && (
        <div className="space-y-1">
          {job.shops.map((s) => (
            <div key={s.shop} className="flex items-start gap-2 text-xs">
              <span className="w-4 pt-0.5">
                {s.phase === "done" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                ) : s.phase === "failed" ? (
                  <XCircle className="h-3.5 w-3.5 text-destructive" />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                )}
              </span>
              <span className="min-w-[120px] font-medium text-foreground">{s.shop}</span>
              <span className="text-muted-foreground">
                {PHASE_LABEL[s.phase] ?? s.phase} · vận đơn {s.updated}/{s.codes}
                {s.failed ? ` (lỗi ${s.failed})` : ""}
                {s.review_receipts > 0 &&
                  ` · đánh giá ${s.reviews_read}/${s.review_receipts} đơn${s.item_reviews ? `, ${s.item_reviews} item có sao` : ""}`}
              </span>
              {(s.error || s.review_error) && (
                <span className="text-destructive">{[s.error, s.review_error].filter(Boolean).join(" · ")}</span>
              )}
            </div>
          ))}
          {(job.no_receipt ?? []).length > 0 && (
            <div className="text-xs text-muted-foreground">
              Bỏ qua {job.no_receipt.length} mã không còn đơn Etsy: {job.no_receipt.join(", ")}
            </div>
          )}
          {running && (
            <div className="text-xs text-muted-foreground">
              Đang chạy nền — vẫn sang trang khác của bảng được (đừng rời màn Giao hàng để xem tiến độ); đọc đánh
              giá giãn ~30s mỗi lượt 10 đơn trong một shop.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
