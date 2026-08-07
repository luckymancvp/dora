"use client";

import { useEffect, useState } from "react";

interface IntentMetric {
  intentTag: string;
  withSuggestion: number;
  sentAsIs: number;
  edited: number;
  custom: number;
  usageRate: number;
}
interface Metrics {
  rangeDays: number;
  totals: {
    total: number;
    withSuggestion: number;
    sentAsIs: number;
    edited: number;
    custom: number;
    noSuggestion: number;
  };
  rates: { usageRate: number; acceptAsIsRate: number };
  byIntent: IntentMetric[];
}

const RANGES = [7, 30, 90];
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default function AiMetricsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    fetch(`/api/ai/metrics?days=${days}`)
      .then(async (r) => {
        const j = (await r.json()) as Metrics & { error?: string };
        if (!r.ok) throw new Error(j.error ?? String(r.status));
        return j;
      })
      .then((j) => alive && setData(j))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [days]);

  const t = data?.totals;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Hiệu quả gợi ý AI</h1>
        <div className="flex gap-1">
          {RANGES.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={
                "rounded-full px-3 py-1 text-sm font-medium transition-colors " +
                (days === d
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:bg-accent")
              }
            >
              {d} ngày
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
      {error && <p className="text-sm text-destructive">Lỗi: {error}</p>}

      {data && t && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card label="Tỉ lệ dùng gợi ý" value={pct(data.rates.usageRate)} hint="gửi y hệt + có sửa" />
            <Card label="Gửi gần y hệt" value={pct(data.rates.acceptAsIsRate)} hint="không chỉnh sửa" />
            <Card label="Lần có gợi ý" value={String(t.withSuggestion)} hint={`trên ${t.total} tin gửi`} />
            <Card label="Gửi không gợi ý" value={String(t.noSuggestion)} hint="nhân viên tự viết" />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3">
            <Card label="Gửi y hệt" value={String(t.sentAsIs)} />
            <Card label="Có sửa" value={String(t.edited)} />
            <Card label="Bỏ gợi ý (tự viết)" value={String(t.custom)} />
          </div>

          <h2 className="mb-2 mt-6 text-sm font-bold text-foreground">Theo phân loại (tag)</h2>
          {data.byIntent.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có dữ liệu.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Tag</th>
                    <th className="px-3 py-2 text-right font-medium">Có gợi ý</th>
                    <th className="px-3 py-2 text-right font-medium">Y hệt</th>
                    <th className="px-3 py-2 text-right font-medium">Sửa</th>
                    <th className="px-3 py-2 text-right font-medium">Bỏ</th>
                    <th className="px-3 py-2 text-right font-medium">Tỉ lệ dùng</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byIntent.map((r) => (
                    <tr key={r.intentTag} className="border-t border-border">
                      <td className="px-3 py-2 text-foreground">{r.intentTag}</td>
                      <td className="px-3 py-2 text-right">{r.withSuggestion}</td>
                      <td className="px-3 py-2 text-right">{r.sentAsIs}</td>
                      <td className="px-3 py-2 text-right">{r.edited}</td>
                      <td className="px-3 py-2 text-right">{r.custom}</td>
                      <td className="px-3 py-2 text-right font-medium text-foreground">{pct(r.usageRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            Mục tiêu GĐ3: &quot;Tỉ lệ dùng gợi ý&quot; tăng dần theo tuần khi kho ví dụ được học thêm.
          </p>
        </>
      )}
      </div>
    </div>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold text-foreground">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
