"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Save,
  Search,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import {
  useCheckImportRows,
  useCreateImportProfile,
  useImportProfiles,
  usePreviewImportFile,
} from "@/lib/hooks/useTrackingImport";
import {
  columnIndex,
  countSkipReasons,
  groupEligibleByStore,
  IMPORT_SKIP_REASON_LABEL,
  normalizeHeader,
  type ImportCheckedRow,
  type ImportCheckResponse,
  type ImportMappedRow,
  type ImportPreviewResponse,
  type ImportCarrierSource,
  type ImportRowState,
  type ImportStoreGroup,
  type TrackingImportProfileDTO,
} from "@/lib/types/tracking-import";

const MANUAL = "__manual__";

/** Map cột đang áp dụng — từ profile đã chọn hoặc do người dùng chỉnh tay. */
interface Mapping {
  orderIdColumn: string;
  trackingColumn: string;
  carrierColumn: string;
}

const DEFAULT_MAPPING: Mapping = {
  orderIdColumn: "A",
  trackingColumn: "B",
  carrierColumn: "C",
};

function mappingOf(p: TrackingImportProfileDTO): Mapping {
  return {
    orderIdColumn: p.orderIdColumn,
    trackingColumn: p.trackingColumn,
    carrierColumn: p.carrierColumn,
  };
}

/** Áp mapping lên ma trận ô → các dòng đã map. Dòng 1 luôn là tiêu đề nên luôn bỏ. */
function applyMapping(preview: ImportPreviewResponse, m: Mapping): ImportMappedRow[] {
  const oi = columnIndex(m.orderIdColumn);
  const ti = columnIndex(m.trackingColumn);
  const ci = columnIndex(m.carrierColumn);

  const out: ImportMappedRow[] = [];
  for (let r = 1; r < preview.rows.length; r++) {
    const cells = preview.rows[r];
    const order_id = oi >= 0 ? (cells[oi] ?? "") : "";
    const tracking_number = ti >= 0 ? (cells[ti] ?? "") : "";
    // CHỈ lấy ô trong file. Quy tắc suy carrier do server chốt (xem ImportCheckRequest) —
    // điền sẵn ở đây sẽ vô hiệu hoá quy tắc.
    const carrier = ci >= 0 ? (cells[ci] ?? "").trim() : "";
    // Dòng hoàn toàn trắng ở cả 2 cột khoá = dòng đệm cuối file → bỏ hẳn, không báo lỗi giả.
    if (!order_id.trim() && !tracking_number.trim()) continue;
    out.push({ rowNumber: r + 1, order_id, tracking_number, carrier });
  }
  return out;
}

/** Nhãn nguồn carrier — để người dùng biết dòng nào do quy tắc suy ra mà kiểm lại. */
const CARRIER_SOURCE_LABEL: Record<ImportCarrierSource, string> = {
  file: "",
  rule: "theo quy tắc",
  none: "",
};

const STATE_LABEL: Record<ImportRowState, string> = {
  ELIGIBLE: "Sẽ add",
  SKIPPED_STATUS: "Bỏ qua (status)",
  NOT_FOUND: "Không thấy đơn",
  INVALID: "Dòng lỗi",
};

export function ImportPanel({
  onApply,
  onClose,
}: {
  /**
   * Nhận các đơn PROCESSING ĐÃ GOM THEO SHOP (shop suy từ tiền tố order id) để trang dựng
   * sẵn mỗi shop một khối. Nhóm `store` rỗng = không suy được shop, người dùng tự chọn.
   */
  onApply: (groups: ImportStoreGroup[]) => void;
  onClose: () => void;
}) {
  const { data: profiles } = useImportProfiles();
  const previewMut = usePreviewImportFile();
  const checkMut = useCheckImportRows();
  const createProfile = useCreateImportProfile();

  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [profileId, setProfileId] = useState<string>(MANUAL);
  const [mapping, setMapping] = useState<Mapping>(DEFAULT_MAPPING);
  const [checked, setChecked] = useState<ImportCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setChecked(null);
    setSavedNote(null);
    try {
      const data = await previewMut.mutateAsync(file);
      setPreview(data);
      // Tự nhận diện nguồn theo header; không khớp thì giữ map thủ công để người dùng tự chọn.
      const matched = data.matchedProfileId
        ? (profiles ?? []).find((p) => p.id === data.matchedProfileId)
        : undefined;
      if (matched) {
        setProfileId(matched.id);
        setMapping(mappingOf(matched));
      } else {
        setProfileId(MANUAL);
        setMapping(DEFAULT_MAPPING);
      }
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "Không đọc được file");
    }
  };

  const selectProfile = (id: string) => {
    setProfileId(id);
    setChecked(null);
    const p = (profiles ?? []).find((x) => x.id === id);
    if (p) setMapping(mappingOf(p));
  };

  // Đổi cột thủ công → rời khỏi profile đang chọn (map không còn khớp nguồn đó nữa).
  const setMap = (patch: Partial<Mapping>) => {
    setMapping((m) => ({ ...m, ...patch }));
    setProfileId(MANUAL);
    setChecked(null);
  };

  const mapped = useMemo(
    () => (preview ? applyMapping(preview, mapping) : []),
    [preview, mapping],
  );

  const runCheck = async () => {
    setError(null);
    if (mapped.length === 0) {
      setError("Không có dòng dữ liệu nào sau khi bỏ dòng tiêu đề.");
      return;
    }
    try {
      setChecked(await checkMut.mutateAsync({ rows: mapped }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kiểm tra thất bại");
    }
  };

  const applyEligible = useCallback(() => {
    if (!checked) return;
    const groups = groupEligibleByStore(checked.rows);
    if (groups.length === 0) return;
    onApply(groups);
    onClose();
  }, [checked, onApply, onClose]);

  const saveAsProfile = async () => {
    const name = saveName.trim();
    if (!name || !preview) return;
    setError(null);
    try {
      await createProfile.mutateAsync({
        name,
        orderIdColumn: mapping.orderIdColumn,
        trackingColumn: mapping.trackingColumn,
        carrierColumn: mapping.carrierColumn,
        // Học tiêu đề (dòng 1) của chính file này để lần sau tự nhận diện đúng nguồn.
        signature: (preview.rows[0] ?? []).map(normalizeHeader).filter(Boolean),
      });
      setSaveName("");
      setSavedNote(`Đã lưu nguồn "${name}" — lần sau import file này sẽ tự nhận.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lưu nguồn thất bại");
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-primary/40 bg-secondary/40 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Import CSV / XLSX</span>
        <button
          onClick={onClose}
          className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" /> Đóng
        </button>
      </div>

      {/* Bước 1: chọn file */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xlsm"
          onChange={(e) => {
            void pickFile(e.target.files?.[0]);
            // Reset để chọn lại đúng file vừa chọn vẫn kích hoạt onChange.
            e.target.value = "";
          }}
          className="hidden"
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={previewMut.isPending}
          className="flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary disabled:opacity-50"
        >
          {previewMut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Chọn file
        </button>
        {preview && (
          <span className="text-sm text-muted-foreground">
            <strong className="text-foreground">{preview.fileName}</strong> · {preview.rowCount} dòng
            {preview.truncated && <> (đã cắt còn tối đa cho phép)</>}
          </span>
        )}
      </div>

      {preview && (
        <>
          {/* Bước 2: chọn nguồn / map cột */}
          <div className="space-y-3 rounded-xl border border-border bg-background p-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm font-medium text-foreground">Nguồn:</label>
              <select
                value={profileId}
                onChange={(e) => selectProfile(e.target.value)}
                className="rounded-xl border-0 bg-secondary px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value={MANUAL}>— Chọn cột thủ công —</option>
                {(profiles ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {preview.matchedProfileId && preview.matchedProfileId === profileId && (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Tự nhận diện theo tiêu đề
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <ColumnPicker
                label="Order ID"
                value={mapping.orderIdColumn}
                columns={preview.columns}
                onChange={(v) => setMap({ orderIdColumn: v })}
              />
              <ColumnPicker
                label="Tracking"
                value={mapping.trackingColumn}
                columns={preview.columns}
                onChange={(v) => setMap({ trackingColumn: v })}
              />
              <ColumnPicker
                label="Carrier"
                value={mapping.carrierColumn}
                columns={preview.columns}
                onChange={(v) => setMap({ carrierColumn: v })}
                allowEmpty
              />
            </div>

            <p className="text-xs text-muted-foreground">
              {mapped.length} dòng dữ liệu (đã bỏ dòng 1 — tiêu đề). Ô carrier trống sẽ được suy
              từ số tracking theo <strong>Quy tắc carrier</strong> (tab Cấu hình import); không suy
              được thì dòng đó bị bỏ qua.
            </p>

            {/* Lưu map hiện tại thành nguồn để lần sau tự nhận */}
            {profileId === MANUAL && mapped.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="Tên nguồn (vd Printbell)"
                  className="min-w-48 flex-1 rounded-xl border-0 bg-secondary px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  onClick={() => void saveAsProfile()}
                  disabled={!saveName.trim() || createProfile.isPending}
                  className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary disabled:opacity-50"
                >
                  {createProfile.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  Lưu cấu hình này thành nguồn
                </button>
              </div>
            )}
            {savedNote && <p className="text-xs text-success">{savedNote}</p>}
          </div>

          {/* Bước 3: kiểm tra Sheet → Mera */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => void runCheck()}
              disabled={checkMut.isPending || mapped.length === 0}
              className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:bg-input-strong"
            >
              {checkMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Kiểm tra Sheet / Mera ({mapped.length} dòng)
            </button>
          </div>
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {checked && <CheckResult result={checked} onApply={applyEligible} />}
    </div>
  );
}

function ColumnPicker({
  label,
  value,
  columns,
  onChange,
  allowEmpty,
}: {
  label: string;
  value: string;
  columns: ImportPreviewResponse["columns"];
  onChange: (v: string) => void;
  allowEmpty?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border-0 bg-secondary px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {allowEmpty && <option value="">— Không có —</option>}
        {columns.map((c) => (
          <option key={c.key} value={c.key}>
            {c.key}
            {c.header ? ` · ${c.header}` : ""}
            {!c.header && c.samples[0] ? ` · ${c.samples[0]}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function CheckResult({
  result,
  onApply,
}: {
  result: ImportCheckResponse;
  onApply: () => void;
}) {
  const { counts } = result;
  // Đơn sẽ add, gom theo shop suy từ tiền tố — đây chính là các khối shop sắp được dựng.
  const groups = groupEligibleByStore(result.rows);
  const unknown = groups.find((g) => !g.store);

  // Thống kê lý do bỏ qua: trả lời "vì sao chỉ N đơn add được" mà không phải cuộn cả nghìn dòng.
  const reasons = countSkipReasons(result.rows);
  const [filter, setFilter] = useState<ImportRowState | "ALL">("ALL");
  const visible = filter === "ALL" ? result.rows : result.rows.filter((r) => r.state === filter);

  const TABS: { key: ImportRowState | "ALL"; label: string; n: number }[] = [
    { key: "ALL", label: "Tất cả", n: counts.total },
    { key: "ELIGIBLE", label: "Sẽ add", n: counts.eligible },
    { key: "SKIPPED_STATUS", label: "Trạng thái khác", n: counts.skippedStatus },
    { key: "NOT_FOUND", label: "Không thấy đơn", n: counts.notFound },
    { key: "INVALID", label: "Dòng lỗi", n: counts.invalid },
  ];

  return (
    <div className="space-y-3">
      <div
        className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
          counts.eligible > 0
            ? "border-success/40 bg-success/10"
            : "border-warning/40 bg-warning/10"
        }`}
      >
        {counts.eligible > 0 ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        )}
        <span>
          {counts.total} dòng: <strong className="text-success">{counts.eligible} đang
          PROCESSING</strong>
          {counts.skippedStatus > 0 && <> · {counts.skippedStatus} trạng thái khác</>}
          {counts.notFound > 0 && <> · {counts.notFound} không thấy đơn</>}
          {counts.invalid > 0 && <> · {counts.invalid} dòng lỗi</>}.
          {result.meraUnavailable && (
            <> Chưa tra được Mera (thiếu cấu hình hoặc Mera không phản hồi) — chỉ đối chiếu Sheet.</>
          )}
        </span>
      </div>

      {groups.length > 0 && (
        <div className="space-y-2 rounded-xl border border-border bg-background px-4 py-3 text-sm">
          <div className="text-xs font-medium text-muted-foreground">
            Sẽ tách thành {groups.length} khối shop:
          </div>
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <span
                key={g.store || "__unknown__"}
                className={`rounded-full px-3 py-1 text-xs ${
                  g.store
                    ? "bg-secondary text-foreground"
                    : "bg-warning/15 font-medium text-warning"
                }`}
              >
                {g.store || "Chưa rõ shop"} · {g.rows.length}
              </span>
            ))}
          </div>
          {unknown && (
            <p className="text-xs text-warning">
              {unknown.rows.length} đơn không suy được shop (order id không có tiền tố đã đăng ký
              trong tab Prefix) — khối của nhóm này để trống shop, bạn tự chọn.
            </p>
          )}
        </div>
      )}

      {reasons.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-border bg-background px-4 py-3">
          <div className="text-xs font-medium text-muted-foreground">Vì sao bị bỏ qua:</div>
          {reasons.map((r) => (
            <div key={r.reason} className="flex items-baseline gap-2 text-sm">
              <span className="w-14 shrink-0 text-right font-medium tabular-nums text-foreground">
                {r.count}
              </span>
              <span className="text-muted-foreground">
                {IMPORT_SKIP_REASON_LABEL[r.reason]}
                {r.statuses.length > 0 && (
                  <span className="text-foreground"> — {r.statuses.join(", ")}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1 text-xs">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            disabled={t.n === 0}
            className={`rounded-full px-3 py-1 font-medium transition-colors disabled:opacity-40 ${
              filter === t.key
                ? "bg-primary text-white"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label} ({t.n})
          </button>
        ))}
      </div>

      <div className="max-h-80 overflow-auto rounded-xl border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-secondary text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Dòng</th>
              <th className="px-3 py-2 text-left">Order ID</th>
              <th className="px-3 py-2 text-left">Shop</th>
              <th className="px-3 py-2 text-left">Tracking</th>
              <th className="px-3 py-2 text-left">Carrier</th>
              <th className="px-3 py-2 text-left">Kết quả</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {/* Trần 300 dòng: file vài nghìn dòng render hết sẽ treo UI. Dùng tab lọc để soi nhóm. */}
            {visible.slice(0, 300).map((r) => (
              <ResultRow key={`${r.rowNumber}-${r.raw_order_id}`} row={r} />
            ))}
          </tbody>
        </table>
      </div>
      {visible.length > 300 && (
        <p className="text-xs text-muted-foreground">
          Hiện 300/{visible.length} dòng của nhóm này.
        </p>
      )}

      <button
        onClick={onApply}
        disabled={counts.eligible === 0}
        className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:bg-input-strong"
      >
        <CheckCircle2 className="h-4 w-4" />
        Đưa {counts.eligible} đơn PROCESSING vào {groups.length} khối shop
      </button>
    </div>
  );
}

function ResultRow({ row: r }: { row: ImportCheckedRow }) {
  const eligible = r.state === "ELIGIBLE";
  return (
    <tr className={eligible ? undefined : "bg-secondary/50 text-muted-foreground"}>
      <td className="px-3 py-2 align-top text-xs">{r.rowNumber}</td>
      <td className="px-3 py-2 align-top font-mono">
        {r.order_id || r.raw_order_id || "—"}
        {/* Order id trong file có prefix (vd PB-4078…) → cho thấy đã chuẩn hoá về receipt id nào. */}
        {r.order_id && r.raw_order_id !== r.order_id && (
          <div className="text-xs text-muted-foreground">từ {r.raw_order_id}</div>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        {r.store || <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-2 align-top font-mono">{r.tracking_number || "—"}</td>
      <td className="px-3 py-2 align-top">
        {r.carrier || "—"}
        {CARRIER_SOURCE_LABEL[r.carrierSource] && (
          <div className="text-xs text-muted-foreground">
            {CARRIER_SOURCE_LABEL[r.carrierSource]}
          </div>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <span
          className={`inline-flex items-center gap-1 ${
            eligible ? "text-success" : r.state === "INVALID" ? "text-destructive" : "text-warning"
          }`}
        >
          {eligible ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : r.state === "INVALID" ? (
            <XCircle className="h-3.5 w-3.5" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5" />
          )}
          {STATE_LABEL[r.state]}
        </span>
        {r.message && <div className="text-xs text-muted-foreground">{r.message}</div>}
        {r.source && (
          <div className="text-xs text-muted-foreground">
            Nguồn: {r.source === "sheet" ? "Google Sheet" : "Mera"}
          </div>
        )}
      </td>
    </tr>
  );
}
