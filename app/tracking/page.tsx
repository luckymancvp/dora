"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Loader2,
  Truck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Search,
  Plus,
  X,
} from "lucide-react";
import { useShops } from "@/lib/hooks/useShops";
import { MobileMenuButton } from "@/components/sidebar";
import { carrierLabel } from "@/lib/types/tracking";

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
  error?: string;
}

interface ParsedRow {
  order_id: string;
  tracking_number: string;
  carrier: string;
}

/** 1 khối nhập liệu cho 1 shop. */
interface ShopBlock {
  key: string;
  shopSelect: string;
  customShop: string;
  bulk: string;
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

/** Các trường bắt buộc còn thiếu của 1 đơn (để cảnh báo đỏ & chặn tick chọn). */
function missingFields(o: JobOrder): string[] {
  const missing: string[] = [];
  if (!o.order_id?.trim()) missing.push("Order ID");
  if (!o.tracking_number?.trim()) missing.push("Tracking");
  if (!carrierLabel(o.carrier, o.other_carrier).trim()) missing.push("Carrier");
  return missing;
}

export default function TrackingPage() {
  const { data: shops } = useShops();

  const blockSeq = useRef(1);
  const newBlock = useCallback(
    (): ShopBlock => ({ key: `b${blockSeq.current++}`, shopSelect: "", customShop: "", bulk: "" }),
    [],
  );

  const [blocks, setBlocks] = useState<ShopBlock[]>(() => [
    { key: "b0", shopSelect: "", customShop: "", bulk: "" },
  ]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [createErrors, setCreateErrors] = useState<{ shop: string; error: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Theo dõi phase của từng card để bật nút "xác nhận tất cả".
  const [phases, setPhases] = useState<Record<string, Phase>>({});
  const cardRefs = useRef<Map<string, JobCardHandle>>(new Map());
  const [confirmingAll, setConfirmingAll] = useState(false);
  const onPhase = useCallback((id: string, phase: Phase) => {
    setPhases((p) => (p[id] === phase ? p : { ...p, [id]: phase }));
  }, []);
  const awaitingCount = Object.values(phases).filter((p) => p === "AWAIT_CONFIRM").length;

  const confirmAll = async () => {
    setConfirmingAll(true);
    try {
      await Promise.all(Array.from(cardRefs.current.values()).map((h) => h.confirm()));
    } finally {
      setConfirmingAll(false);
    }
  };

  const shopNameOf = (b: ShopBlock) =>
    b.shopSelect === CUSTOM ? b.customShop.trim() : b.shopSelect.trim();

  const updateBlock = (key: string, patch: Partial<ShopBlock>) =>
    setBlocks((bs) => bs.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  const addBlock = () => setBlocks((bs) => [...bs, newBlock()]);
  const removeBlock = (key: string) =>
    setBlocks((bs) => (bs.length > 1 ? bs.filter((b) => b.key !== key) : bs));

  const startJobs = async () => {
    setError(null);
    setCreateErrors([]);

    const valid = blocks
      .map((b) => ({ shopName: shopNameOf(b), parsed: parseRows(b.bulk) }))
      .filter((x) => x.shopName && x.parsed.length > 0);

    if (valid.length === 0) {
      setError("Cần ít nhất 1 shop có tên và đơn hợp lệ (order_id + tracking).");
      return;
    }
    const names = valid.map((v) => v.shopName.toLowerCase());
    if (new Set(names).size !== names.length) {
      setError("Có shop bị trùng. Gộp các đơn của cùng 1 shop vào một khối.");
      return;
    }

    setCreating(true);
    try {
      const settled = await Promise.all(
        valid.map(async (v) => {
          try {
            // KHÔNG gửi shopId: userId trong dora-1 là Etsy user_id, KHÔNG phải shop_id.
            // Để null → extension tự lấy shop_id đúng qua getShopId() từ tab đang login.
            const res = await fetch("/api/tracking/jobs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ shopName: v.shopName, shopId: null, orders: v.parsed }),
            });
            const data = (await res.json()) as { job?: Job; error?: string };
            if (!res.ok || !data.job) {
              return { error: { shop: v.shopName, error: data.error ?? `Lỗi ${res.status}` } };
            }
            return { job: data.job };
          } catch (e) {
            return { error: { shop: v.shopName, error: e instanceof Error ? e.message : "Lỗi mạng" } };
          }
        }),
      );
      setJobs(settled.flatMap((s) => (s.job ? [s.job] : [])));
      setCreateErrors(settled.flatMap((s) => (s.error ? [s.error] : [])));
    } finally {
      setCreating(false);
    }
  };

  const reset = () => {
    setJobs([]);
    setCreateErrors([]);
    setError(null);
    setPhases({});
    cardRefs.current.clear();
  };

  const inputMode = jobs.length === 0;
  const validBlockCount = blocks.filter(
    (b) => shopNameOf(b) && parseRows(b.bulk).length > 0,
  ).length;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <MobileMenuButton className="-ml-1" />
        <Truck className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-medium tracking-tight text-foreground">Add Tracking lên Etsy</h1>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        Mỗi shop một khối: chọn shop, dán danh sách đơn (mỗi dòng: <code>order_id</code>{" "}
        &nbsp;tab/phẩy&nbsp; <code>tracking</code> &nbsp;tab/phẩy&nbsp; <code>carrier</code>). Hệ thống
        kiểm tra tracking hiện có, cảnh báo đơn đã có, add lần lượt rồi xác minh lại — các shop chạy song
        song.
      </p>

      {/* Chế độ nhập liệu nhiều shop */}
      {inputMode && (
        <div className="space-y-4">
          {blocks.map((b, idx) => (
            <ShopBlockEditor
              key={b.key}
              block={b}
              index={idx}
              shops={shops ?? []}
              canRemove={blocks.length > 1}
              onChange={(patch) => updateBlock(b.key, patch)}
              onRemove={() => removeBlock(b.key)}
            />
          ))}

          <button
            onClick={addBlock}
            className="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary"
          >
            <Plus className="h-4 w-4" /> Thêm shop
          </button>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div>
            <button
              onClick={startJobs}
              disabled={creating || validBlockCount === 0}
              className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:bg-input-strong"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Kiểm tra & Add ({validBlockCount} shop)
            </button>
          </div>
        </div>
      )}

      {/* Chế độ chạy job: 1 card / shop */}
      {!inputMode && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">{jobs.length} shop đang xử lý</div>
            <div className="flex items-center gap-3">
              {awaitingCount > 0 && (
                <button
                  onClick={confirmAll}
                  disabled={confirmingAll}
                  className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:bg-input-strong"
                >
                  {confirmingAll ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Truck className="h-4 w-4" />
                  )}
                  Xác nhận add tất cả ({awaitingCount} shop)
                </button>
              )}
              <button onClick={reset} className="text-sm text-muted-foreground hover:text-foreground">
                ← Tạo lượt mới
              </button>
            </div>
          </div>

          {createErrors.length > 0 && (
            <div className="space-y-1 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
              {createErrors.map((e) => (
                <div key={e.shop} className="flex items-start gap-2">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <span>
                    <strong>{e.shop}</strong>: {e.error}
                  </span>
                </div>
              ))}
            </div>
          )}

          {jobs.map((j) => (
            <JobCard
              key={j.id}
              initial={j}
              onPhase={onPhase}
              ref={(h) => {
                if (h) cardRefs.current.set(j.id, h);
                else cardRefs.current.delete(j.id);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ShopBlockEditor({
  block,
  index,
  shops,
  canRemove,
  onChange,
  onRemove,
}: {
  block: ShopBlock;
  index: number;
  shops: { userId: number; shopName: string; online: boolean }[];
  canRemove: boolean;
  onChange: (patch: Partial<ShopBlock>) => void;
  onRemove: () => void;
}) {
  const parsed = useMemo(() => parseRows(block.bulk), [block.bulk]);

  return (
    <div className="space-y-4 rounded-2xl border border-border p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Shop #{index + 1}</span>
        {canRemove && (
          <button
            onClick={onRemove}
            className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" /> Xoá
          </button>
        )}
      </div>

      <div>
        <select
          value={block.shopSelect}
          onChange={(e) => onChange({ shopSelect: e.target.value })}
          className="w-full rounded-xl border-0 bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">— Chọn shop —</option>
          {shops.map((s) => (
            <option key={s.userId} value={s.shopName}>
              {s.online ? "🟢" : "⚪"} {s.shopName}
            </option>
          ))}
          <option value={CUSTOM}>✏️ Tự nhập tên shop…</option>
        </select>
        {block.shopSelect === CUSTOM && (
          <input
            value={block.customShop}
            onChange={(e) => onChange({ customShop: e.target.value })}
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
          value={block.bulk}
          onChange={(e) => onChange({ bulk: e.target.value })}
          rows={6}
          placeholder={"4078744073\tLT401168241GB\tRoyal Mail\n4078744074\tLT401168242GB\tRoyal Mail"}
          className="w-full resize-y rounded-xl border-0 bg-secondary px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
    </div>
  );
}

interface JobCardHandle {
  /** Xác nhận add các đơn đã chọn nếu đang ở AWAIT_CONFIRM (no-op nếu chưa chọn gì). */
  confirm: () => Promise<void>;
}

const JobCard = forwardRef<JobCardHandle, { initial: Job; onPhase: (id: string, phase: Phase) => void }>(
  function JobCard({ initial, onPhase }, ref) {
  const [job, setJob] = useState<Job>(initial);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const initializedSelection = useRef<string | null>(null);

  const pollJob = useCallback(async (id: string) => {
    const res = await fetch(`/api/tracking/jobs/${id}`);
    if (!res.ok) return;
    const data = (await res.json()) as { job?: Job };
    if (data.job) setJob(data.job);
  }, []);

  // Poll khi job đang chạy (PRECHECK / ADDING / VERIFY).
  useEffect(() => {
    if (job.phase === "AWAIT_CONFIRM" || job.phase === "COMPLETED") return;
    const t = setInterval(() => void pollJob(job.id), 2000);
    return () => clearInterval(t);
  }, [job, pollJob]);

  // Khi sang AWAIT_CONFIRM: khởi tạo lựa chọn theo precheck (CLEAR = chọn sẵn).
  useEffect(() => {
    if (job.phase === "AWAIT_CONFIRM" && initializedSelection.current !== job.id) {
      const init: Record<string, boolean> = {};
      for (const o of job.orders)
        init[o.order_id] = o.precheck === "CLEAR" && missingFields(o).length === 0;
      setSelected(init);
      initializedSelection.current = job.id;
    }
  }, [job]);

  // Báo phase lên cha (cho nút "xác nhận tất cả").
  useEffect(() => {
    onPhase(job.id, job.phase);
  }, [job.id, job.phase, onPhase]);

  const submitAdd = useCallback(
    async (orderIds: string[]) => {
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
    },
    [job.id],
  );

  const confirmAdd = useCallback(async () => {
    const orderIds = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (orderIds.length === 0) {
      setError("Chưa chọn đơn nào để add.");
      return;
    }
    await submitAdd(orderIds);
  }, [selected, submitAdd]);

  const existsCount = job.orders.filter((o) => o.precheck === "EXISTS").length;
  const selectedCount = Object.values(selected).filter(Boolean).length;

  // Cho cha gọi để xác nhận hàng loạt (bỏ qua nếu chưa ở AWAIT_CONFIRM hoặc chưa chọn đơn nào).
  useImperativeHandle(
    ref,
    () => ({
      confirm: async () => {
        if (job.phase !== "AWAIT_CONFIRM") return;
        const orderIds = Object.entries(selected)
          .filter(([, v]) => v)
          .map(([k]) => k);
        if (orderIds.length === 0) return;
        await submitAdd(orderIds);
      },
    }),
    [job.phase, selected, submitAdd],
  );

  const summary = useMemo(() => {
    if (job.phase !== "COMPLETED" || job.error) return null;
    const sent = job.orders.filter((o) => o.selected);
    const verified = sent.filter((o) => o.verify === "VERIFIED").length;
    const mismatch = sent.filter((o) => o.verify === "MISMATCH").length;
    const failed = sent.filter((o) => o.add_status === "FAILED").length;
    const skipped = sent.filter((o) => o.verify === "SKIPPED" && o.add_status !== "FAILED").length;
    return { total: sent.length, verified, mismatch, failed, skipped };
  }, [job]);

  const q = query.trim().toLowerCase();
  const ordersFiltered = useMemo(
    () =>
      !q
        ? job.orders
        : job.orders.filter((o) =>
            `${o.order_id} ${o.tracking_number} ${carrierLabel(o.carrier, o.other_carrier)} ${o.existing?.carrier_name ?? ""}`
              .toLowerCase()
              .includes(q),
          ),
    [job.orders, q],
  );

  return (
    <div className="space-y-3 rounded-2xl border border-border p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Shop: <strong className="text-foreground">{job.shop_name}</strong> · {job.orders.length} đơn
        </div>
        {job.error ? (
          <span className="rounded-full bg-destructive/15 px-2.5 py-1 text-xs font-medium text-destructive">
            Lỗi
          </span>
        ) : (
          <PhaseBadge phase={job.phase} />
        )}
      </div>

      {job.error && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>
            Không lấy được tracking từ Etsy: <strong>{job.error}</strong>. Chưa thay đổi gì trên Etsy — hãy
            kiểm tra shop/đăng nhập rồi tạo lượt mới.
          </span>
        </div>
      )}

      {!job.error && (job.phase === "PRECHECK" || job.phase === "ADDING" || job.phase === "VERIFY") && (
        <div className="flex items-center gap-2 rounded-xl bg-secondary px-4 py-3 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          {job.phase === "PRECHECK" && "Đang kiểm tra tracking hiện có trên Etsy…"}
          {job.phase === "ADDING" && "Đang gửi tracking lần lượt lên Etsy…"}
          {job.phase === "VERIFY" && "Đang xác minh lại tracking trên Etsy…"}
        </div>
      )}

      {summary && (
        <div
          className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
            summary.mismatch || summary.failed
              ? "border-warning/40 bg-warning/10"
              : "border-success/40 bg-success/10"
          }`}
        >
          {summary.mismatch || summary.failed ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          )}
          <span>
            Hoàn tất {summary.total} đơn:{" "}
            <strong className="text-success">{summary.verified} đã xác minh</strong>
            {summary.mismatch > 0 && (
              <>
                {" · "}
                <strong className="text-destructive">{summary.mismatch} lệch tracking</strong>
              </>
            )}
            {summary.failed > 0 && (
              <>
                {" · "}
                <strong className="text-destructive">{summary.failed} thất bại</strong>
              </>
            )}
            {summary.skipped > 0 && <> · {summary.skipped} bỏ qua xác minh</>}.
          </span>
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

      <SearchBox value={query} onChange={setQuery} count={ordersFiltered.length} total={job.orders.length} />

      <div className="max-h-[28rem] overflow-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-secondary text-xs text-muted-foreground">
            <tr>
              {job.phase === "AWAIT_CONFIRM" && <th className="w-10 px-3 py-2"></th>}
              <th className="px-3 py-2 text-left">Order ID</th>
              <th className="px-3 py-2 text-left">Tracking</th>
              <th className="px-3 py-2 text-left">Carrier</th>
              <th className="px-3 py-2 text-left">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ordersFiltered.map((o) => {
              const missing = missingFields(o);
              const incomplete = missing.length > 0;
              const carrierText = carrierLabel(o.carrier, o.other_carrier);
              return (
              <tr key={o.order_id} className={incomplete ? "bg-destructive/10" : undefined}>
                {job.phase === "AWAIT_CONFIRM" && (
                  <td className="px-3 py-2 align-top">
                    <input
                      type="checkbox"
                      checked={!incomplete && !!selected[o.order_id]}
                      disabled={incomplete}
                      title={incomplete ? `Thiếu ${missing.join(", ")} — không thể add` : undefined}
                      onChange={(e) =>
                        setSelected((p) => ({ ...p, [o.order_id]: e.target.checked }))
                      }
                      className="h-4 w-4 accent-primary disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </td>
                )}
                <td className="px-3 py-2 font-mono align-top">
                  {o.order_id || <span className="text-destructive">Thiếu Order ID</span>}
                </td>
                <td className="px-3 py-2 font-mono align-top">
                  {o.tracking_number || <span className="text-destructive">Thiếu Tracking</span>}
                </td>
                <td className="px-3 py-2 align-top">
                  {carrierText ? (
                    carrierText
                  ) : (
                    <span className="inline-flex items-center gap-1 font-medium text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" /> Thiếu Carrier
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  {incomplete ? (
                    <span className="inline-flex items-center gap-1 text-destructive">
                      <XCircle className="h-3.5 w-3.5" /> Thiếu {missing.join(", ")} — không thể add
                    </span>
                  ) : (
                    <OrderStatusCell order={o} phase={job.phase} />
                  )}
                </td>
              </tr>
              );
            })}
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
  );
});

function PhaseBadge({ phase }: { phase: Phase }) {
  const label: Record<Phase, string> = {
    PRECHECK: "Đang kiểm tra",
    AWAIT_CONFIRM: "Chờ xác nhận",
    ADDING: "Đang gửi",
    VERIFY: "Đang xác minh",
    COMPLETED: "Hoàn tất",
  };
  return (
    <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
      {label[phase]}
    </span>
  );
}

function SearchBox({
  value,
  onChange,
  count,
  total,
}: {
  value: string;
  onChange: (v: string) => void;
  count: number;
  total: number;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Tìm theo Order ID, tracking, carrier…"
        className="w-full rounded-xl border-0 bg-secondary py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {value.trim() && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {count}/{total}
        </span>
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
