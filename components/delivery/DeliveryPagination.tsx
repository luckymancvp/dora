"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { selectClass } from "@/components/delivery/DeliveryToolbar";
import { TRACKING_PAGE_SIZES } from "@/lib/delivery/deliveryTracking";

/** Phân trang: "1–50 / 1.234 mã" · số dòng/trang 50/100/200 · trước/sau. */
export function DeliveryPagination({
  page,
  limit,
  total,
  loading,
  onPage,
  onLimit,
}: {
  page: number;
  limit: number;
  total: number;
  loading: boolean;
  onPage: (page: number) => void;
  onLimit: (limit: number) => void;
}) {
  if (total <= 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <div className="flex items-center gap-3">
        <span>
          {((page - 1) * limit + 1).toLocaleString()}–{Math.min(page * limit, total).toLocaleString()}
          {" / "}
          <b className="text-foreground">{total.toLocaleString()}</b> mã
        </span>
        <select
          value={limit}
          onChange={(e) => onLimit(Number(e.target.value))}
          className={`${selectClass} h-8`}
          aria-label="Số mã mỗi trang"
        >
          {TRACKING_PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n} / trang
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          disabled={page <= 1 || loading}
          onClick={() => onPage(page - 1)}
          aria-label="Trang trước"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="px-2">
          Trang {page} / {totalPages}
        </span>
        <Button
          variant="ghost"
          size="icon"
          disabled={page >= totalPages || loading}
          onClick={() => onPage(page + 1)}
          aria-label="Trang sau"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
