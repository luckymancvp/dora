"use client";

import { memo } from "react";
import { X, XCircle } from "lucide-react";
import { useTabs } from "@/lib/store/tabs";
import { cn } from "@/lib/utils";

const Tab = memo(function Tab({
  id,
  label,
  active,
  onActivate,
  onClose,
}: {
  id: number;
  label: string;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onActivate}
      className={cn(
        "group flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-t-lg border-b-2 px-3 text-sm transition-colors",
        active
          ? "border-primary bg-card font-semibold text-foreground"
          : "border-transparent text-muted-foreground hover:bg-secondary",
      )}
      title={label}
    >
      <span className="max-w-[140px] truncate">{label || `#${id}`}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground opacity-60 hover:bg-border hover:opacity-100"
        aria-label="Đóng tab"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
});

export function TabBar() {
  const { openTabs, activeTabId, meta, setActive, closeTab, closeAll } = useTabs();
  if (openTabs.length === 0) return null;

  return (
    <div className="hidden items-end border-b border-border bg-muted pt-1 md:flex">
      <div className="flex flex-1 items-end gap-1 overflow-x-auto px-2">
        {openTabs.map((id) => (
          <Tab
            key={id}
            id={id}
            label={meta[id]?.name ?? ""}
            active={id === activeTabId}
            onActivate={() => setActive(id)}
            onClose={() => closeTab(id)}
          />
        ))}
      </div>
      <button
        onClick={closeAll}
        className="mb-1 mr-2 flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive-soft hover:text-destructive"
        title="Đóng tất cả tab"
      >
        <XCircle className="h-3.5 w-3.5" />
        Đóng tất cả ({openTabs.length})
      </button>
    </div>
  );
}
