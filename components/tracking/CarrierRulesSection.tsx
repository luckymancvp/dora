"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ClipboardPaste,
  Loader2,
  Plus,
  Save,
  Trash2,
  Truck,
  XCircle,
} from "lucide-react";
import { useCarrierRules, useSaveCarrierRules } from "@/lib/hooks/useCarrierRules";
import {
  CARRIER_MATCH_KIND_LABEL,
  CARRIER_MATCH_SCOPE_LABEL,
  emptyCarrierRule,
  evaluateCarrierRules,
  parseSheetCarrierFormula,
  type CarrierMatchKind,
  type CarrierMatchScope,
  type CarrierRule,
} from "@/lib/types/carrier-rule";

const KINDS: CarrierMatchKind[] = ["prefix", "suffix", "contains", "regex"];
const SCOPES: CarrierMatchScope[] = ["all", "first", "last"];

/** Regex hỏng phải báo ngay lúc nhập — lúc chạy import nó chỉ âm thầm không khớp. */
function badRegex(rule: CarrierRule): string | null {
  if (rule.kind !== "regex") return null;
  for (const p of rule.patterns) {
    if (!p.trim()) continue;
    try {
      new RegExp(p);
    } catch {
      return p;
    }
  }
  return null;
}

export function CarrierRulesSection() {
  const { data, isLoading } = useCarrierRules();
  const save = useSaveCarrierRules();

  const [rules, setRules] = useState<CarrierRule[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [formula, setFormula] = useState("");
  const [probe, setProbe] = useState("");

  // Nạp từ server khi chưa có sửa đổi chưa lưu (không đè mất thao tác đang dở).
  useEffect(() => {
    if (data && !dirty) setRules(data.rules);
  }, [data, dirty]);

  const mutate = (next: CarrierRule[]) => {
    setRules(next);
    setDirty(true);
    setNote(null);
  };

  const patch = (id: string, p: Partial<CarrierRule>) =>
    mutate(rules.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= rules.length) return;
    const next = [...rules];
    [next[index], next[to]] = [next[to], next[index]];
    mutate(next);
  };

  const addRule = () =>
    mutate([...rules, emptyCarrierRule(`r${Date.now()}`)]);

  const removeRule = (id: string) => mutate(rules.filter((r) => r.id !== id));

  const importFormula = () => {
    setError(null);
    const { rules: parsed, matched } = parseSheetCarrierFormula(formula);
    if (parsed.length === 0) {
      setError(
        matched > 0
          ? "Đọc được cặp REGEXMATCH nhưng không cặp nào có tên carrier."
          : "Không tìm thấy cặp REGEXMATCH(...)…,\"Carrier\" nào trong công thức.",
      );
      return;
    }
    // Thay hẳn danh sách: công thức là nguồn sự thật đầy đủ, trộn vào sẽ sinh quy tắc trùng.
    mutate(parsed);
    setShowPaste(false);
    setFormula("");
    setNote(`Đã đọc ${parsed.length} quy tắc từ công thức. Kiểm tra rồi bấm Lưu.`);
  };

  const onSave = async () => {
    setError(null);
    const broken = rules.find((r) => badRegex(r));
    if (broken) {
      setError(`Regex không hợp lệ ở quy tắc "${broken.carrier || "(chưa đặt tên)"}"`);
      return;
    }
    const noCarrier = rules.findIndex((r) => !r.carrier.trim());
    if (noCarrier >= 0) {
      setError(`Quy tắc #${noCarrier + 1} chưa có tên carrier`);
      return;
    }
    const noPattern = rules.findIndex((r) => r.patterns.every((p) => !p.trim()));
    if (noPattern >= 0) {
      setError(`Quy tắc #${noPattern + 1} chưa có mẫu nào`);
      return;
    }
    try {
      await save.mutateAsync(rules);
      setDirty(false);
      setNote("Đã lưu.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lưu thất bại");
    }
  };

  // Thử 1 mã tracking để thấy quy tắc nào thắng — kiểm tra thứ tự trước khi lưu.
  const probeResult = useMemo(
    () => (probe.trim() ? evaluateCarrierRules(probe, rules) : null),
    [probe, rules],
  );
  const probeIndex = probeResult ? rules.findIndex((r) => r.id === probeResult.rule.id) : -1;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Khi file import <strong>không có carrier</strong>, hệ thống suy carrier từ số tracking theo
        các quy tắc dưới đây — thay cho công thức <code>IFS(REGEXMATCH(…))</code> trên Sheet. Thứ tự
        quan trọng: <strong>quy tắc khớp đầu tiên thắng</strong>. Thứ tự chốt carrier là ô trong
        file → quy tắc này → carrier mặc định của nguồn.
      </p>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Đang tải…
        </div>
      )}

      {/* Nhập nhanh từ công thức Google Sheet */}
      {showPaste ? (
        <div className="space-y-3 rounded-2xl border border-border p-4">
          <label className="block text-sm font-medium text-foreground">
            Dán công thức từ Google Sheet
          </label>
          <textarea
            value={formula}
            onChange={(e) => setFormula(e.target.value)}
            rows={8}
            placeholder={'=ARRAYFORMULA(IF(AV1:AV="","",IFS(\n  REGEXMATCH(AV1:AV,"^1Z"),"UPS",\n  REGEXMATCH(AV1:AV,"^(IT|LT)"),"Royal Mail",\n  TRUE,""\n)))'}
            className="w-full resize-y rounded-xl border-0 bg-secondary px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            Đọc các cặp <code>REGEXMATCH(…,&quot;mẫu&quot;),&quot;Carrier&quot;</code> theo đúng thứ
            tự. Mẫu đơn giản (<code>^1Z</code>, <code>^(IT|LT)</code>) được rút gọn thành
            &quot;bắt đầu bằng&quot; cho dễ sửa; mẫu phức tạp giữ nguyên dạng regex.
            <strong> Thay toàn bộ</strong> danh sách hiện tại.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={importFormula}
              disabled={!formula.trim()}
              className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:bg-input-strong"
            >
              <ClipboardPaste className="h-4 w-4" /> Đọc công thức
            </button>
            <button
              onClick={() => setShowPaste(false)}
              className="rounded-full px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Huỷ
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowPaste(true)}
          className="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary"
        >
          <ClipboardPaste className="h-4 w-4" /> Nhập từ công thức Google Sheet
        </button>
      )}

      {/* Thử nhanh 1 mã tracking */}
      {rules.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-border p-4">
          <label className="block text-sm font-medium text-foreground">Thử một số tracking</label>
          <input
            value={probe}
            onChange={(e) => setProbe(e.target.value)}
            placeholder="LT401168241GB"
            className="w-full rounded-xl border-0 bg-secondary px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {probe.trim() && (
            <p className="text-sm">
              {probeResult ? (
                <span className="inline-flex items-center gap-1.5 text-success">
                  <CheckCircle2 className="h-4 w-4" />
                  <strong>{probeResult.carrier}</strong>
                  <span className="text-muted-foreground">
                    (quy tắc #{probeIndex + 1})
                  </span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-warning">
                  <XCircle className="h-4 w-4" /> Không quy tắc nào khớp — sẽ dùng carrier mặc định
                  của nguồn.
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {!isLoading && rules.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Chưa có quy tắc nào. Dán công thức Google Sheet ở trên để nhập nhanh, hoặc thêm từng quy
          tắc.
        </div>
      )}

      <div className="space-y-2">
        {rules.map((rule, i) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            index={i}
            total={rules.length}
            highlight={probeIndex === i}
            onPatch={(p) => patch(rule.id, p)}
            onMove={(d) => move(i, d)}
            onRemove={() => removeRule(rule.id)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={addRule}
          className="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary"
        >
          <Plus className="h-4 w-4" /> Thêm quy tắc
        </button>
        <button
          onClick={() => void onSave()}
          disabled={save.isPending || !dirty}
          className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:bg-input-strong"
        >
          {save.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Lưu {rules.length} quy tắc
        </button>
        {dirty && <span className="text-xs text-warning">Có thay đổi chưa lưu.</span>}
        {note && <span className="text-xs text-success">{note}</span>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function RuleRow({
  rule,
  index,
  total,
  highlight,
  onPatch,
  onMove,
  onRemove,
}: {
  rule: CarrierRule;
  index: number;
  total: number;
  highlight: boolean;
  onPatch: (p: Partial<CarrierRule>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const invalidRegex = badRegex(rule);

  return (
    <div
      className={`space-y-3 rounded-2xl border p-3 ${
        highlight ? "border-success/60 bg-success/5" : "border-border"
      } ${rule.enabled ? "" : "opacity-60"}`}
    >
      <div className="flex items-center gap-2">
        <span className="w-8 shrink-0 text-xs text-muted-foreground">#{index + 1}</span>

        <Truck className="h-4 w-4 shrink-0 text-primary" />
        <input
          value={rule.carrier}
          onChange={(e) => onPatch({ carrier: e.target.value })}
          placeholder="Tên carrier (vd Royal Mail)"
          className="min-w-40 flex-1 rounded-xl border-0 bg-secondary px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
        />

        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => onMove(-1)}
            disabled={index === 0}
            title="Lên (ưu tiên cao hơn)"
            className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            title="Xuống"
            className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onRemove}
            title="Xoá quy tắc"
            className="rounded-full p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pl-8">
        <select
          value={rule.kind}
          onChange={(e) => onPatch({ kind: e.target.value as CarrierMatchKind })}
          className="rounded-xl border-0 bg-secondary px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {CARRIER_MATCH_KIND_LABEL[k]}
            </option>
          ))}
        </select>

        <input
          value={rule.patterns.join(", ")}
          onChange={(e) =>
            // Nhiều mẫu ngăn bởi dấu phẩy = "khớp bất kỳ" (tương ứng ^(IT|IW|QL) trên Sheet).
            onPatch({ patterns: e.target.value.split(",").map((s) => s.trim()) })
          }
          placeholder={rule.kind === "regex" ? "^(IT|IW)" : "IT, IW, QL"}
          className="min-w-48 flex-1 rounded-xl border-0 bg-secondary px-3 py-1.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />

        <span className="text-xs text-muted-foreground">trong</span>
        <select
          value={rule.scope}
          onChange={(e) => onPatch({ scope: e.target.value as CarrierMatchScope })}
          className="rounded-xl border-0 bg-secondary px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {SCOPES.map((s) => (
            <option key={s} value={s}>
              {CARRIER_MATCH_SCOPE_LABEL[s]}
            </option>
          ))}
        </select>
        {rule.scope !== "all" && (
          <input
            value={String(rule.scopeLength)}
            onChange={(e) =>
              onPatch({ scopeLength: Number(e.target.value.replace(/\D/g, "") || 0) })
            }
            inputMode="numeric"
            title="Số ký tự"
            className="w-16 rounded-xl border-0 bg-secondary px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        )}

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={rule.caseSensitive}
            onChange={(e) => onPatch({ caseSensitive: e.target.checked })}
            className="h-3.5 w-3.5 accent-primary"
          />
          Phân biệt hoa/thường
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(e) => onPatch({ enabled: e.target.checked })}
            className="h-3.5 w-3.5 accent-primary"
          />
          Bật
        </label>
      </div>

      {invalidRegex && (
        <p className="pl-8 text-xs text-destructive">Regex không hợp lệ: {invalidRegex}</p>
      )}
    </div>
  );
}
