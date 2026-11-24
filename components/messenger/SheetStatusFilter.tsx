"use client";

import { useEffect, useRef, useState } from "react";
import { PackageCheck, Check, ChevronDown } from "lucide-react";
import { useStatusNames } from "@/lib/hooks/useSheets";
import { useMeraStatuses, useMeraStatusesInUse } from "@/lib/hooks/useMera";
import { cn } from "@/lib/utils";

export function SheetStatusFilter({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (statuses: string[]) => void;
}) {
  const statuses = useStatusNames();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = (status: string) => {
    onChange(
      selected.includes(status)
        ? selected.filter((s) => s !== status)
        : [...selected, status],
    );
  };

  // Bộ lọc khớp cả status trên Mera (đơn mới không còn trên Sheet) → liệt kê thêm status của Mera
  // mà danh sách của dora-1 chưa có: status cấu hình + status đang thực sự nằm trên đơn (gồm cả
  // status hệ thống tự gán như "NO PRODUCT TYPE"). Mera lỗi/chưa cấu hình → chỉ còn danh sách cũ.
  const meraConfigured = useMeraStatuses().data?.statuses ?? [];
  const meraInUse = useMeraStatusesInUse().data?.statuses ?? [];
  const names = [...new Set([...statuses, ...meraConfigured, ...meraInUse])];

  // Đảm bảo các status đang chọn nhưng không còn trong danh sách vẫn hiện để bỏ chọn được.
  const rows = [...names, ...selected.filter((s) => !names.includes(s))];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
          selected.length > 0
            ? "border-primary bg-accent text-primary"
            : "border-border text-muted-foreground hover:bg-secondary",
        )}
      >
        <PackageCheck className="h-3.5 w-3.5" />
        Status
        {selected.length > 0 && (
          <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">
            {selected.length}
          </span>
        )}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute left-0 z-20 mt-1 max-h-64 w-52 overflow-y-auto rounded-xl border border-border bg-card py-1 shadow-lg">
          {selected.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="w-full px-3 py-1.5 text-left text-xs text-primary hover:bg-secondary"
            >
              Bỏ chọn tất cả
            </button>
          )}
          {rows.length === 0 ? (
            <p className="px-3 py-3 text-center text-xs text-muted-foreground">Chưa có status nào</p>
          ) : (
            rows.map((status) => {
              const isSel = selected.includes(status);
              return (
                <button
                  key={status}
                  onClick={() => toggle(status)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-secondary"
                >
                  <span className="flex-1 truncate text-xs text-foreground">{status}</span>
                  {isSel && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
