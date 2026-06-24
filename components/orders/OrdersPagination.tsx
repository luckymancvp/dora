"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

export function OrdersPagination({
  page,
  totalPages,
  pageSize,
  onPage,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 0) return null;
  return (
    <div className="flex items-center justify-end gap-3 text-sm text-muted-foreground">
      <span>{pageSize} orders per page</span>
      <span>
        Page {page} of {totalPages}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-border hover:bg-secondary disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-border hover:bg-secondary disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
