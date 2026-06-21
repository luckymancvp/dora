"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Truck, AlertTriangle, CheckCircle2, XCircle, Search } from "lucide-react";
import { useShops } from "@/lib/hooks/useShops";
import { MobileMenuButton } from "@/components/sidebar";

type Precheck = "PENDING" | "CLEAR" | "EXISTS";
type AddStatus = "NEW" | "SENDING" | "DONE" | "FAILED";
type VerifyState = "PENDING" | "VERIFIED" | "MISMATCH" | "SKIPPED";
type Phase = "PRECHECK" | "AWAIT_CONFIRM" | "ADDING" | "VERIFY" | "COMPLETED";

interface JobOrder {
  order_id: string;
  tracking_number: string;
  carrier: number;
  other_carrier: string;
  precheck: Precheck;
  existing?: { code: string; carrier_name: string };
  selected: boolean;
  add_status: AddStatus;
  verify: VerifyState;
  verified?: { code: string; carrier_name: string };
  message?: string;
}

interface Job {
  id: string;
  shop_name: string;
  phase: Phase;
  orders: JobOrder[];
}

interface ParsedRow {
  order_id: string;
  tracking_number: string;
  carrier: string;
}

const CUSTOM = "__custom__";

/** Tách 1 dòng → [order_id, tracking, carrier]. Ưu tiên tab/phẩy; fallback khoảng trắng. */
function parseLine(line: string): ParsedRow | null {
  const raw = line.trim();
  if (!raw) return null;
  let parts: string[];
  if (raw.includes("\t")) parts = raw.split("\t");
  else if (raw.includes(",")) parts = raw.split(",");
  else {
    // "orderId tracking Carrier Name" → 2 token đầu, phần còn lại là carrier (giữ khoảng trắng).
    const m = raw.match(/^(\S+)\s+(\S+)\s*(.*)$/);
    parts = m ? [m[1], m[2], m[3]] : [raw];
  }
  const order_id = (parts[0] ?? "").trim();
  const tracking_number = (parts[1] ?? "").trim();
  const carrier = (parts.slice(2).join(parts.length > 3 ? " " : "") || parts[2] || "").trim();
  if (!order_id || !tracking_number) return null;
  return { order_id, tracking_number, carrier };
}

function parseRows(text: string): ParsedRow[] {
  return text
    .split("\n")
    .map(parseLine)
    .filter((r): r is ParsedRow => r !== null);
}

export default function TrackingPage() {
  const { data: shops } = useShops();

  const [shopSelect, setShopSelect] = useState("");
  const [customShop, setCustomShop] = useState("");
  const [bulk, setBulk] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [job, setJob] = useState<Job | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState(false);
  const initializedSelection = useRef<string | null>(null);

  const shopName = shopSelect === CUSTOM ? customShop.trim() : shopSelect.trim();
  const parsed = useMemo(() => parseRows(bulk), [bulk]);

  // Poll job khi đang chạy.
  const pollJob = useCallback(async (id: string) => {
    const res = await fetch(`/api/tracking/jobs/${id}`);
    if (!res.ok) return;
    const data = (await res.json()) as { job?: Job };
    if (data.job) setJob(data.job);
  }, []);

  useEffect(() => {
    if (!job || job.phase === "AWAIT_CONFIRM" || job.phase === "COMPLETED") return;
    const t = setInterval(() => void pollJob(job.id), 2000);
    return () => clearInterval(t);
  }, [job, pollJob]);

  // Khi job sang AWAIT_CONFIRM: khởi tạo lựa chọn theo precheck (CLEAR = chọn sẵn).
  useEffect(() => {
    if (job?.phase === "AWAIT_CONFIRM" && initializedSelection.current !== job.id) {
      const init: Record<string, boolean> = {};
      for (const o of job.orders) init[o.order_id] = o.precheck === "CLEAR";
      setSelected(init);
      initializedSelection.current = job.id;
    }
  }, [job]);

  const startJob = async () => {
    setError(null);
    if (!shopName) {
      setError("Hãy chọn hoặc nhập tên shop.");
      return;
    }
    if (parsed.length === 0) {
      setError("Chưa có dòng nào hợp lệ (cần order_id và tracking).");
      return;
    }
    setCreating(true);
    setJob(null);
    initializedSelection.current = null;
    try {
      const shopId = shops?.find((s) => s.shopName === shopName)?.userId;
      const res = await fetch("/api/tracking/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopName, shopId: shopId ?? null, orders: parsed }),
      });
      const data = (await res.json()) as { job?: Job; error?: string };
      if (!res.ok) {
        setError(data.error ?? `Lỗi ${res.status}`);
        return;
      }
      if (data.job) {
        setJob(data.job);
        void pollJob(data.job.id);
      }
    } finally {
      setCreating(false);
    }
  };

  const confirmAdd = async () => {
    if (!job) return;
    const orderIds = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (orderIds.length === 0) {
      setError("Chưa chọn đơn nào để add.");
      return;
    }
    setError(null);
    setConfirming(true);
    try {
      const res = await fetch(`/api/tracking/jobs/${job.id}/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds }),
      });
      const data = (await res.json()) as { job?: Job; error?: string };
      if (!res.ok) {
        setError(data.error ?? `Lỗi ${res.status}`);
        return;
      }
      if (data.job) setJob(data.job);
    } finally {
      setConfirming(false);
    }
  };

  const reset = () => {
    setJob(null);
    initializedSelection.current = null;
    setSelected({});
    setError(null);
  };

  const existsCount = job?.orders.filter((o) => o.precheck === "EXISTS").length ?? 0;
  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <MobileMenuButton className="-ml-1" />
        <Truck className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-medium tracking-tight text-foreground">Add Tracking lên Etsy</h1>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        Chọn shop, dán danh sách đơn (mỗi dòng: <code>order_id</code> &nbsp;tab/phẩy&nbsp;{" "}
        <code>tracking</code> &nbsp;tab/phẩy&nbsp; <code>carrier</code>). Hệ thống sẽ kiểm tra tracking hiện
        có trên Etsy, cảnh báo đơn đã có, add rồi xác minh lại.
      </p>

      {/* Form nhập liệu */}
      {!job && (
        <div className="space-y-4 rounded-2xl border border-border p-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Shop</label>
            <select
              value={shopSelect}
              onChange={(e) => setShopSelect(e.target.value)}
              className="w-full rounded-xl border-0 bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">— Chọn shop —</option>
              {(shops ?? []).map((s) => (
                <option key={s.userId} value={s.shopName}>
                  {s.online ? "🟢" : "⚪"} {s.shopName}
                </option>
              ))}
              <option value={CUSTOM}>✏️ Tự nhập tên shop…</option>
            </select>
            {shopSelect === CUSTOM && (
              <input
                value={customShop}
                onChange={(e) => setCustomShop(e.target.value)}
                placeholder="Tên shop (đúng tên channel Ably)"
                className="mt-2 w-full rounded-xl border-0 bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Đơn hàng ({parsed.length} dòng hợp lệ)
            </label>
            <textarea
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              rows={8}
              placeholder={"4078744073\tLT401168241GB\tRoyal Mail\n4078744074\tLT401168242GB\tRoyal Mail"}
              className="w-full resize-y rounded-xl border-0 bg-secondary px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {parsed.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Order ID</th>
                    <th className="px-3 py-2 text-left">Tracking</th>
                    <th className="px-3 py-2 text-left">Carrier</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {parsed.map((r, i) => (
                    <tr key={`${r.order_id}-${i}`}>
                      <td className="px-3 py-1.5 font-mono">{r.order_id}</td>
                      <td className="px-3 py-1.5 font-mono">{r.tracking_number}</td>
                      <td className="px-3 py-1.5">{r.carrier || <span className="text-muted-foreground">Other</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            onClick={startJob}
            disabled={creating}
            className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:bg-input-strong"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Kiểm tra & Add
          </button>
        </div>
      )}

      {/* Trạng thái job */}
      {job && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Shop: <strong className="text-foreground">{job.shop_name}</strong> · {job.orders.length} đơn
            </div>
            <button onClick={reset} className="text-sm text-muted-foreground hover:text-foreground">
              ← Tạo lượt mới
            </button>
          </div>

          {(job.phase === "PRECHECK" || job.phase === "ADDING" || job.phase === "VERIFY") && (
            <div className="flex items-center gap-2 rounded-xl bg-secondary px-4 py-3 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              {job.phase === "PRECHECK" && "Đang kiểm tra tracking hiện có trên Etsy…"}
              {job.phase === "ADDING" && "Đang gửi tracking lên Etsy…"}
              {job.phase === "VERIFY" && "Đang xác minh lại tracking trên Etsy…"}
            </div>
          )}

          {job.phase === "AWAIT_CONFIRM" && existsCount > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>
                {existsCount} đơn <strong>đã có tracking</strong> trên Etsy. Tick chọn nếu vẫn muốn add đè.
              </span>
            </div>
          )}

          {/* Bảng kết quả / xác nhận */}
          <div className="overflow-hidden rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-xs text-muted-foreground">
                <tr>
                  {job.phase === "AWAIT_CONFIRM" && <th className="w-10 px-3 py-2"></th>}
                  <th className="px-3 py-2 text-left">Order ID</th>
                  <th className="px-3 py-2 text-left">Tracking</th>
                  <th className="px-3 py-2 text-left">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {job.orders.map((o) => (
                  <tr key={o.order_id}>
                    {job.phase === "AWAIT_CONFIRM" && (
                      <td className="px-3 py-2 align-top">
                        <input
                          type="checkbox"
                          checked={!!selected[o.order_id]}
                          onChange={(e) =>
                            setSelected((p) => ({ ...p, [o.order_id]: e.target.checked }))
                          }
                          className="h-4 w-4 accent-primary"
                        />
                      </td>
                    )}
                    <td className="px-3 py-2 font-mono align-top">{o.order_id}</td>
                    <td className="px-3 py-2 font-mono align-top">{o.tracking_number}</td>
                    <td className="px-3 py-2 align-top">
                      <OrderStatusCell order={o} phase={job.phase} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {job.phase === "AWAIT_CONFIRM" && (
            <button
              onClick={confirmAdd}
              disabled={confirming || selectedCount === 0}
              className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:bg-input-strong"
            >
              {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
              Xác nhận add ({selectedCount} đơn)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function OrderStatusCell({ order: o, phase }: { order: JobOrder; phase: Phase }) {
  if (phase === "PRECHECK") {
    return <span className="text-muted-foreground">Đang kiểm tra…</span>;
  }
  if (phase === "AWAIT_CONFIRM") {
    if (o.precheck === "EXISTS") {
      return (
        <span className="inline-flex items-center gap-1 text-warning">
          <AlertTriangle className="h-3.5 w-3.5" />
          Đã có: {o.existing?.code} ({o.existing?.carrier_name || "?"})
        </span>
      );
    }
    return <span className="text-success">Chưa có tracking — sẵn sàng add</span>;
  }
  // ADDING / VERIFY / COMPLETED
  if (o.verify === "VERIFIED") {
    return (
      <span className="inline-flex items-center gap-1 text-success">
        <CheckCircle2 className="h-3.5 w-3.5" /> Đã add & xác minh
      </span>
    );
  }
  if (o.verify === "MISMATCH" || o.add_status === "FAILED") {
    return (
      <span className="inline-flex items-center gap-1 text-destructive">
        <XCircle className="h-3.5 w-3.5" />
        {o.message ?? "Thất bại"}
        {o.verified?.code ? ` (Etsy: ${o.verified.code})` : ""}
      </span>
    );
  }
  if (o.add_status === "DONE") {
    return <span className="text-muted-foreground">Đã gửi, đang xác minh…</span>;
  }
  if (o.add_status === "SENDING") {
    return <span className="text-muted-foreground">Đang gửi…</span>;
  }
  if (o.verify === "SKIPPED" && !o.selected) {
    return <span className="text-muted-foreground">Bỏ qua</span>;
  }
  return <span className="text-muted-foreground">—</span>;
}
