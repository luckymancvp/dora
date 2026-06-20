"use client";

import { useMemo, useState } from "react";
import { DashboardDateFilter } from "@/components/dashboard/DashboardDateFilter";
import { MessageOverview } from "@/components/dashboard/MessageOverview";
import { ShopAnalytics } from "@/components/dashboard/ShopAnalytics";
import { AgentPerformance } from "@/components/dashboard/AgentPerformance";
import { TagsOverview } from "@/components/dashboard/TagsOverview";
import { rangeForPreset, type DateRange, type PresetKey } from "@/lib/dashboard/date-presets";
import { MobileMenuButton } from "@/components/sidebar";
import type { AnalyticsFilters } from "@/lib/types/etsy";

export default function DashboardPage() {
  const [presetKey, setPresetKey] = useState<PresetKey>("7days");
  const [range, setRange] = useState<DateRange>(() => rangeForPreset("7days"));

  const handleChange = (key: PresetKey, r: DateRange) => {
    setPresetKey(key);
    setRange(r);
  };

  // Filters dùng chung cho 4 panel (shopIds để [] = tất cả shop).
  const filters = useMemo<AnalyticsFilters>(
    () => ({ from: range.from, to: range.to, shopIds: [] }),
    [range.from, range.to],
  );

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="w-full px-6 py-8 md:px-10 md:py-10">
        {/* Header + global date filter */}
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <MobileMenuButton className="md:hidden" />
            <div>
              <h1 className="text-2xl font-medium tracking-tight text-foreground">Dashboard</h1>
              <p className="mt-1 text-sm text-muted-foreground">Tổng quan tin nhắn &amp; năng suất</p>
            </div>
          </div>
          <DashboardDateFilter presetKey={presetKey} range={range} onChange={handleChange} />
        </div>

        {/* Lưới 4 panel */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <MessageOverview filters={filters} />
          <TagsOverview filters={filters} />
          <AgentPerformance filters={filters} />
          <ShopAnalytics filters={filters} />
        </div>
      </div>
    </div>
  );
}
