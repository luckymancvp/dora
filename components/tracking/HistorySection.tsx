"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  X,
} from "lucide-react";
import { useShops } from "@/lib/hooks/useShops";
import { useTrackingHistory, useTrackingJob } from "@/lib/hooks/useTrackingHistory";
import {
  carrierLabel,
  isVerifyFailure,
  isVerifyWarning,
  VERIFY_LABEL,
  type TrackingHistoryItem,
  type TrackingJobOrder,
  type TrackingPhase,
  type TrackingValue,
} from "@/lib/types/tracking";

const PAGE_SIZE = 20;

const PHASE_LABEL: Record<TrackingPhase, string> = {
  PRECHECK: "Đang kiểm tra",
  AWAIT_CONFIRM: "Chờ xác nhận",
  ADDING: "Đang gửi",
  VERIFY: "Đang xác minh",
  COMPLETED: "Hoàn tất",
};

/** Format ISO string → "dd/MM/yyyy HH:mm" theo giờ địa phương. */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HistorySection() {
  const { data: shops } = useShops();

  const [rawQ, setRawQ] = useState("");
  const [q, setQ] = useState("");
  const [shop, setShop] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  // Debounce ô search: gõ xong 350ms mới đổi query (và về trang 1).
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(rawQ);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [rawQ]);

  const { data, isLoading, isFetching, isError } = useTrackingHistory({
    q,
    shop,
    page,
    limit: PAGE_SIZE,
  });

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;

  return (
    <div className="space-y-4">
      {/* Bộ lọc: search (debounce) + chọn shop */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={rawQ}
            onChange={(e) => setRawQ(e.target.value)}
            placeholder="Tìm theo Order ID hoặc mã tracking (dán mã đầy đủ)…"
            className="w-full rounded-xl border-0 bg-secondary py-2 pl-9 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {rawQ.trim() && (
            <button
              onClick={() => setRawQ("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-input-strong hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <select
          value={shop}
          onChange={(e) => {
            setShop(e.target.value);
            setPage(1);
          }}
          className="rounded-xl border-0 bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring sm:w-56"
        >
          <option value="">— Tất cả shop —</option>
          {(shops ?? []).map((s) => (
            <option key={s.userId} value={s.shopName}>
              {s.shopName}
            </option>
          ))}
        </select>
      </div>

      {/* Trạng thái tải / lỗi / rỗng */}
      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl bg-secondary px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> Đang tải lịch sử…
        </div>
      ) : isError ? (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>Không tải được lịch sử. Thử lại sau.</span>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl bg-secondary px-4 py-8 text-center text-sm text-muted-foreground">
          Chưa có lượt add tracking nào khớp bộ lọc.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <HistoryRow
              key={item.id}
              item={item}
              open={openId === item.id}
              onToggle={() => setOpenId((cur) => (cur === item.id ? null : item.id))}
            />
          ))}
        </div>
      )}

      {/* Phân trang */}
      {!isLoading && !isError && items.length > 0 && (
        <div className="flex items-center justify-between gap-3 pt-1 text-sm text-muted-foreground">
          <span>
            {total} lượt · trang {data?.page ?? page}/{totalPages}
            {isFetching && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 hover:bg-secondary disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" /> Trước
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 hover:bg-secondary disabled:opacity-40"
            >
              Sau <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 1 dòng lịch sử (click để mở chi tiết đơn). */
function HistoryRow({
  item,
  open,
  onToggle,
}: {
  item: TrackingHistoryItem;
  open: boolean;
  onToggle: () => void;
}) {
  const c = item.counts;
  return (
    <div className="rounded-xl border border-border">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary/60"
      >
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <strong className="text-sm text-foreground">{item.shop_name}</strong>
            <span className="text-xs text-muted-foreground">
              {formatDateTime(item.created_at)}
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {item.sender_email || "—"}
          </div>
        </div>

        {/* Tóm tắt counts + trạng thái */}
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <CountBadges counts={c} />
          {item.error ? (
            <span className="rounded-full bg-destructive/15 px-2.5 py-1 text-xs font-medium text-destructive">
              Lỗi
            </span>
          ) : (
            <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
              {PHASE_LABEL[item.phase]}
            </span>
          )}
        </div>
      </button>

      {open && <HistoryDetail id={item.id} error={item.error} />}
    </div>
  );
}

function CountBadges({ counts }: { counts: TrackingHistoryItem["counts"] }) {
  return (
    <>
      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
        {counts.total} đơn
      </span>
      {counts.verified > 0 && (
        <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
          {counts.verified} xác minh
        </span>
      )}
      {/* CẢNH BÁO, không phải lỗi: các đơn này ĐÃ nằm trong `verified` ở trên — Etsy nhận
          tracking rồi, chỉ ghi tên carrier theo danh mục của nó. Badge vàng, không cộng thêm. */}
      {counts.carrier_mismatch > 0 && (
        <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
          {counts.carrier_mismatch} đổi tên carrier
        </span>
      )}
      {counts.mismatch > 0 && (
        <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
          {counts.mismatch} lệch
        </span>
      )}
      {counts.failed > 0 && (
        <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
          {counts.failed} lỗi
        </span>
      )}
      {counts.skipped > 0 && (
        <span className="rounded-full bg-input-strong px-2 py-0.5 text-xs text-muted-foreground">
          {counts.skipped} bỏ qua
        </span>
      )}
    </>
  );
}

/** Chi tiết 1 lượt: fetch GET /api/tracking/jobs/[id] → bảng đơn read-only. */
function HistoryDetail({ id, error }: { id: string; error?: string }) {
  const { data: job, isLoading, isError } = useTrackingJob(id);

  const orders = useMemo(() => job?.orders ?? [], [job]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 border-t border-border px-4 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" /> Đang tải chi tiết…
      </div>
    );
  }
  if (isError || !job) {
    return (
      <div className="border-t border-border px-4 py-4 text-sm text-destructive">
        Không tải được chi tiết lượt add.
      </div>
    );
  }

  return (
    <div className="border-t border-border px-4 py-3">
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>
            Không lấy được tracking từ Etsy: <strong>{error}</strong>.
          </span>
        </div>
      )}
      <div className="max-h-[24rem] overflow-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-secondary text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Order ID</th>
              <th className="px-3 py-2 text-left">Tracking</th>
              <th className="px-3 py-2 text-left">Carrier</th>
              <th className="px-3 py-2 text-left">Kết quả</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {orders.map((o) => (
              <tr key={o.order_id}>
                <td className="px-3 py-2 align-top font-mono">{o.order_id}</td>
                <td className="px-3 py-2 align-top font-mono">{o.tracking_number}</td>
                <td className="px-3 py-2 align-top">
                  {carrierLabel(o.carrier, o.other_carrier) || "—"}
                </td>
                <td className="px-3 py-2 align-top">
                  <ResultCell order={o} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Giá trị Etsy ĐANG CÓ cho đơn này — để đối chiếu ngay trên bảng với cái đã gửi
 * (cột Tracking + cột Carrier của chính dòng đó).
 */
function EtsyEcho({ value }: { value?: TrackingValue }) {
  if (!value) return null;
  const parts = [value.code?.trim(), value.carrier_name?.trim()].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  return (
    <span className="block text-xs text-muted-foreground">Etsy đang có: {parts.join(" · ")}</span>
  );
}

/**
 * Cell cho mọi ca verify CÓ CHUYỆN ĐỂ NÓI — lỗi thật (đỏ) lẫn cảnh báo (vàng).
 * Dùng CHUNG giữa tab Lịch sử (ResultCell) và job đang chạy (OrderStatusCell ở
 * app/tracking/page.tsx) để hai nơi mô tả cùng một đơn giống hệt nhau.
 *
 * Tông màu suy 100% từ `o.verify`: CARRIER_MISMATCH là add THÀNH CÔNG (Etsy chỉ đổi tên
 * carrier) nên phải vàng — tô đỏ khiến người vận hành tưởng tracking chưa vào Etsy.
 */
export function VerifyIssueCell({ order: o }: { order: TrackingJobOrder }) {
  const warn = isVerifyWarning(o.verify);
  const label = isVerifyFailure(o.verify) || warn ? VERIFY_LABEL[o.verify] : "Add thất bại";
  const Icon = warn ? AlertTriangle : XCircle;
  return (
    <span className={`inline-flex items-start gap-1 ${warn ? "text-warning" : "text-destructive"}`}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        <strong className="font-medium">{label}</strong>
        {o.message && <span className="block text-xs text-muted-foreground">{o.message}</span>}
        <EtsyEcho value={o.verified} />
      </span>
    </span>
  );
}

/** Trạng thái kết quả read-only 1 đơn (rút gọn từ OrderStatusCell của JobCard). */
function ResultCell({ order: o }: { order: TrackingJobOrder }) {
  if (!o.selected && o.verify === "SKIPPED") {
    return <span className="text-muted-foreground">Bỏ qua</span>;
  }
  if (o.verify === "VERIFIED") {
    return (
      <span className="inline-flex items-start gap-1 text-success">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {VERIFY_LABEL.VERIFIED}
      </span>
    );
  }
  // Lỗi thật (đỏ) + cảnh báo carrier lệch (vàng) + ca add lỗi, gồm cả legacy "MISMATCH".
  if (isVerifyFailure(o.verify) || isVerifyWarning(o.verify) || o.add_status === "FAILED") {
    return <VerifyIssueCell order={o} />;
  }
  if (o.precheck === "EXISTS" && !o.selected) {
    return (
      <span className="inline-flex items-center gap-1 text-warning">
        <AlertTriangle className="h-3.5 w-3.5" />
        Đã có sẵn — không add
      </span>
    );
  }
  // Đã add nhưng không verify được (GET lỗi / shop offline). Phải đứng trước nhánh
  // add_status === "DONE", nếu không o.message bị nuốt và đơn hiện "Đã gửi" như bình thường.
  if (o.verify === "SKIPPED" && o.selected) {
    return (
      <span className="inline-flex items-start gap-1 text-warning">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {/* Không dùng VERIFY_LABEL.SKIPPED ("Bỏ qua"): đơn này ĐÃ add lên Etsy, chỉ là
              không verify được. Gọi là "bỏ qua" sẽ bị hiểu nhầm thành chưa add. */}
          Đã add nhưng CHƯA xác minh được
          {o.message && <span className="block text-xs text-muted-foreground">{o.message}</span>}
        </span>
      </span>
    );
  }
  if (o.add_status === "DONE") {
    return <span className="text-muted-foreground">Đã gửi</span>;
  }
  return <span className="text-muted-foreground">—</span>;
}
