"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import {
  PRESETS,
  type DateRange,
  type PresetKey,
  rangeForPreset,
} from "@/lib/dashboard/date-presets";
import { cn } from "@/lib/utils";

interface Props {
  presetKey: PresetKey;
  range: DateRange;
  onChange: (presetKey: PresetKey, range: DateRange) => void;
}

const SECONDS = 1000;
// Thứ trong tuần (bắt đầu từ Thứ Hai): Hai, Ba, Tư, Năm, Sáu, Bảy, Chủ nhật.
const WEEKDAYS = ["H", "B", "T", "N", "S", "B", "C"];
const MONTHS = [
  "Một", "Hai", "Ba", "Tư", "Năm", "Sáu",
  "Bảy", "Tám", "Chín", "Mười", "Mười Một", "Mười Hai",
];

function startOfDaySec(d: Date): number {
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0).getTime() / SECONDS);
}
function endOfDaySec(d: Date): number {
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).getTime() / SECONDS);
}
function secToDate(sec: number | null): Date | null {
  if (sec == null) return null;
  const d = new Date(sec * SECONDS);
  return Number.isNaN(d.getTime()) ? null : d;
}
function fmt(sec: number | null): string {
  const d = secToDate(sec);
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
/** Số so sánh ngày (bỏ qua giờ) để xét trong/ngoài khoảng. */
function dayKey(d: Date): number {
  return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
}

/** Lịch chọn khoảng ngày tuỳ chỉnh (không dùng input[type=date] của trình duyệt). */
function RangeCalendar({
  range,
  onChange,
  onClose,
}: {
  range: DateRange;
  onChange: Props["onChange"];
  onClose: () => void;
}) {
  const fromD = secToDate(range.from);
  const toD = secToDate(range.to);
  const [view, setView] = useState(() => {
    const base = fromD ?? new Date();
    return { y: base.getFullYear(), m: base.getMonth() };
  });
  // Mốc chọn đầu tiên — bấm mốc thứ 2 sẽ chốt khoảng.
  const [anchor, setAnchor] = useState<Date | null>(null);

  // 42 ô (6 hàng × 7 cột), bắt đầu từ Thứ Hai của tuần chứa ngày 1.
  const first = new Date(view.y, view.m, 1);
  const leading = (first.getDay() + 6) % 7;
  const start = new Date(view.y, view.m, 1 - leading);
  const cells = Array.from(
    { length: 42 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );

  const inRange = (d: Date) => {
    if (!fromD || !toD) return false;
    const k = dayKey(d);
    return k >= dayKey(fromD) && k <= dayKey(toD);
  };
  const isEnd = (d: Date) =>
    (fromD && sameDay(d, fromD)) || (toD && sameDay(d, toD));

  const pick = (d: Date) => {
    if (!anchor) {
      // Bấm lần 1: đặt mốc, hiển thị tạm 1 ngày.
      setAnchor(d);
      onChange("custom", { from: startOfDaySec(d), to: endOfDaySec(d) });
      return;
    }
    // Bấm lần 2: chốt khoảng (tự sắp xếp nếu chọn ngược).
    const [lo, hi] = dayKey(anchor) <= dayKey(d) ? [anchor, d] : [d, anchor];
    onChange("custom", { from: startOfDaySec(lo), to: endOfDaySec(hi) });
    setAnchor(null);
    onClose();
  };

  const prevMonth = () =>
    setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }));
  const nextMonth = () =>
    setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }));

  return (
    <div className="w-64 rounded-xl border border-border bg-card p-3 shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">
          Tháng {MONTHS[view.m]} {view.y}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={prevMonth}
            aria-label="Tháng trước"
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={nextMonth}
            aria-label="Tháng sau"
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="py-1 text-xs font-semibold text-muted-foreground">
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === view.m;
          const within = inRange(d);
          const end = isEnd(d);
          return (
            <button
              key={i}
              type="button"
              onClick={() => pick(d)}
              className={cn(
                "h-8 rounded-md text-sm transition-colors",
                !inMonth && "text-muted-foreground/40 hover:bg-secondary",
                inMonth && !within && "text-foreground hover:bg-secondary",
                within && !end && "bg-primary/20 text-foreground",
                end && "bg-primary font-semibold text-white",
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
        <button
          type="button"
          onClick={() => {
            onChange("all", { from: null, to: null });
            setAnchor(null);
            onClose();
          }}
          className="text-xs font-medium text-primary hover:underline"
        >
          Xóa
        </button>
        <button
          type="button"
          onClick={() => {
            const t = new Date();
            setView({ y: t.getFullYear(), m: t.getMonth() });
            onChange("custom", { from: startOfDaySec(t), to: endOfDaySec(t) });
            setAnchor(null);
          }}
          className="text-xs font-medium text-primary hover:underline"
        >
          Hôm nay
        </button>
      </div>
    </div>
  );
}

/** Bộ lọc thời gian global: preset buttons + lịch chọn khoảng tuỳ chỉnh. */
export function DashboardDateFilter({ presetKey, range, onChange }: Props) {
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

  const label =
    range.from || range.to ? `${fmt(range.from)} – ${fmt(range.to)}` : "Chọn thời gian";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onChange(p.key, rangeForPreset(p.key))}
          className={cn(
            "rounded-full px-4 py-2 text-sm font-bold transition-colors",
            presetKey === p.key
              ? "bg-primary text-white"
              : "border border-border bg-card text-muted-foreground hover:bg-secondary",
          )}
        >
          {p.label}
        </button>
      ))}

      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition-colors",
            presetKey === "custom"
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border bg-card text-muted-foreground hover:bg-secondary",
          )}
        >
          <CalendarIcon className="h-4 w-4 shrink-0" />
          <span>{label}</span>
        </button>

        {open ? (
          <div className="absolute right-0 z-40 mt-1">
            <RangeCalendar range={range} onChange={onChange} onClose={() => setOpen(false)} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
