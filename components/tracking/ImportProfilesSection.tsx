"use client";

import { useRef, useState } from "react";
import { Loader2, Plus, Save, Trash2, Upload, X, FileSpreadsheet } from "lucide-react";
import {
  useCreateImportProfile,
  useDeleteImportProfile,
  useImportProfiles,
  usePreviewImportFile,
  useUpdateImportProfile,
} from "@/lib/hooks/useTrackingImport";
import {
  columnIndex,
  normalizeHeader,
  type ImportColumn,
  type TrackingImportProfileDTO,
  type TrackingImportProfileInput,
} from "@/lib/types/tracking-import";

/** Form state — mirror TrackingImportProfileDTO, bỏ id/ngày (không sửa được từ form). */
interface FormState {
  name: string;
  orderIdColumn: string;
  trackingColumn: string;
  carrierColumn: string;
  /** Giữ nguyên signature đã học được khi sửa (không hiện trên form). */
  signature: string[];
}

const EMPTY: FormState = {
  name: "",
  orderIdColumn: "A",
  trackingColumn: "B",
  carrierColumn: "C",
  signature: [],
};

function toForm(p: TrackingImportProfileDTO): FormState {
  return {
    name: p.name,
    orderIdColumn: p.orderIdColumn,
    trackingColumn: p.trackingColumn,
    carrierColumn: p.carrierColumn,
    signature: p.signature,
  };
}

/** Validate ngay tại client để không phải round-trip mới biết sai cột. */
function validate(f: FormState): string | null {
  if (!f.name.trim()) return "Cần nhập tên nguồn (vd Printbell)";
  if (columnIndex(f.orderIdColumn) < 0) return "Cột Order ID phải là chữ cái (A, B, C…)";
  if (columnIndex(f.trackingColumn) < 0) return "Cột Tracking phải là chữ cái (A, B, C…)";
  if (f.carrierColumn.trim() && columnIndex(f.carrierColumn) < 0) {
    return "Cột Carrier phải là chữ cái (A, B, C…) hoặc để trống";
  }
  // KHÔNG bắt buộc cột Carrier: bỏ trống là hợp lệ — carrier sẽ suy từ số tracking theo mục
  // "Quy tắc carrier". Dòng nào cuối cùng vẫn không ra carrier thì bị bỏ qua lúc kiểm tra import.
  return null;
}

function toInput(f: FormState): TrackingImportProfileInput {
  return {
    name: f.name.trim(),
    orderIdColumn: f.orderIdColumn.trim().toUpperCase(),
    trackingColumn: f.trackingColumn.trim().toUpperCase(),
    carrierColumn: f.carrierColumn.trim().toUpperCase(),
    signature: f.signature,
  };
}

export function ImportProfilesSection() {
  const { data: profiles, isLoading } = useImportProfiles();
  const create = useCreateImportProfile();
  const update = useUpdateImportProfile();
  const remove = useDeleteImportProfile();

  // null = không mở form; "new" = form thêm mới; còn lại = id đang sửa.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const openNew = () => {
    setEditing("new");
    setForm(EMPTY);
    setError(null);
  };
  const openEdit = (p: TrackingImportProfileDTO) => {
    setEditing(p.id);
    setForm(toForm(p));
    setError(null);
  };
  const close = () => {
    setEditing(null);
    setError(null);
  };

  const save = async () => {
    const invalid = validate(form);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    try {
      if (editing === "new") await create.mutateAsync(toInput(form));
      else if (editing) await update.mutateAsync({ id: editing, ...toInput(form) });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lưu thất bại");
    }
  };

  const del = async (p: TrackingImportProfileDTO) => {
    if (!confirm(`Xoá nguồn "${p.name}"?`)) return;
    try {
      await remove.mutateAsync(p.id);
      if (editing === p.id) close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xoá thất bại");
    }
  };

  const saving = create.isPending || update.isPending;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Mỗi nguồn file (vd <strong>Printbell</strong>) khai báo một lần: order id nằm cột nào,
        tracking cột nào, carrier cột nào. Lần sau import đúng file của bên đó, hệ thống tự nhận
        cấu hình theo dòng tiêu đề.
      </p>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Đang tải…
        </div>
      )}

      {!isLoading && (profiles?.length ?? 0) === 0 && editing === null && (
        <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Chưa có nguồn nào. Thêm nguồn đầu tiên để import file được tự động map cột.
        </div>
      )}

      <div className="space-y-2">
        {(profiles ?? []).map((p) =>
          editing === p.id ? (
            <ProfileForm
              key={p.id}
              form={form}
              onChange={setForm}
              onSave={save}
              onCancel={close}
              saving={saving}
              error={error}
              title={`Sửa "${p.name}"`}
            />
          ) : (
            <div
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-border px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate">{p.name}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Order ID <code className="text-foreground">{p.orderIdColumn}</code> · Tracking{" "}
                  <code className="text-foreground">{p.trackingColumn}</code> · Carrier{" "}
                  <code className="text-foreground">{p.carrierColumn || "theo quy tắc"}</code>
                  {p.signature.length > 0 && <> · tự nhận diện theo {p.signature.length} cột</>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => openEdit(p)}
                  className="rounded-full px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
                >
                  Sửa
                </button>
                <button
                  onClick={() => void del(p)}
                  disabled={remove.isPending}
                  className="rounded-full p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  title="Xoá nguồn"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ),
        )}
      </div>

      {editing === "new" ? (
        <ProfileForm
          form={form}
          onChange={setForm}
          onSave={save}
          onCancel={close}
          saving={saving}
          error={error}
          title="Nguồn mới"
        />
      ) : (
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary"
        >
          <Plus className="h-4 w-4" /> Thêm nguồn
        </button>
      )}

      {error && editing === null && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function ProfileForm({
  form,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
  title,
}: {
  form: FormState;
  onChange: (f: FormState) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
  title: string;
}) {
  const set = (patch: Partial<FormState>) => onChange({ ...form, ...patch });

  const previewMut = usePreviewImportFile();
  const fileRef = useRef<HTMLInputElement>(null);
  // Cột của file mẫu (nếu có) → chọn cột theo TÊN thay vì đoán chữ cái.
  const [columns, setColumns] = useState<ImportColumn[] | null>(null);
  const [sampleName, setSampleName] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState<string | null>(null);

  const loadSample = async (file: File | undefined) => {
    if (!file) return;
    setSampleError(null);
    try {
      const data = await previewMut.mutateAsync(file);
      setColumns(data.columns);
      setSampleName(data.fileName);
      // Học header của file mẫu → lần sau import file cùng bên sẽ tự nhận nguồn này.
      set({
        signature: data.columns.map((c) => normalizeHeader(c.header)).filter(Boolean),
      });
    } catch (e) {
      setColumns(null);
      setSampleName(null);
      setSampleError(e instanceof Error ? e.message : "Không đọc được file mẫu");
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-border p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <button
          onClick={onCancel}
          className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" /> Đóng
        </button>
      </div>

      <Field label="Tên nguồn">
        <input
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Printbell"
          className="w-full rounded-xl border-0 bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </Field>

      {/* File mẫu: vừa để chọn cột theo tên, vừa để học tiêu đề cho auto-detect. */}
      <div className="space-y-2 rounded-xl border border-dashed border-border p-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xlsm"
          onChange={(e) => {
            void loadSample(e.target.files?.[0]);
            e.target.value = "";
          }}
          className="hidden"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={previewMut.isPending}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary disabled:opacity-50"
          >
            {previewMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Nạp file mẫu
          </button>
          <span className="text-xs text-muted-foreground">
            {sampleName ? (
              <>
                Đã đọc <strong className="text-foreground">{sampleName}</strong> — chọn cột theo tên
                bên dưới.
              </>
            ) : form.signature.length > 0 ? (
              <>Đã học {form.signature.length} cột tiêu đề — nạp file mẫu mới để cập nhật.</>
            ) : (
              <>Chưa có file mẫu: nhập chữ cái cột, và nguồn này sẽ chưa được tự nhận diện.</>
            )}
          </span>
        </div>
        {sampleError && <p className="text-xs text-destructive">{sampleError}</p>}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Cột Order ID">
          <ColumnInput
            value={form.orderIdColumn}
            columns={columns}
            onChange={(v) => set({ orderIdColumn: v })}
          />
        </Field>
        <Field label="Cột Tracking">
          <ColumnInput
            value={form.trackingColumn}
            columns={columns}
            onChange={(v) => set({ trackingColumn: v })}
          />
        </Field>
        <Field label="Cột Carrier">
          <ColumnInput
            value={form.carrierColumn}
            columns={columns}
            onChange={(v) => set({ carrierColumn: v })}
            allowEmpty
          />
        </Field>
      </div>

      {/* Nói rõ hành vi tại chỗ — người dùng không phải đoán khi bỏ trống cột Carrier. */}
      <p className="text-xs text-muted-foreground">
        Carrier lấy từ <strong>ô trong file</strong>; ô trống (hoặc không chọn cột) thì suy từ số
        tracking theo <strong>Quy tắc carrier</strong>. Không suy được thì dòng đó bị bỏ qua.
        Dòng 1 của file luôn được coi là tiêu đề và bỏ qua.
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <button
        onClick={onSave}
        disabled={saving}
        className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:bg-input-strong"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Lưu
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-foreground">{label}</label>
      {children}
    </div>
  );
}

/**
 * Chọn cột: có file mẫu → dropdown theo tên cột (khó chọn nhầm); chưa có → nhập chữ cái A-Z.
 * Dù chọn kiểu nào, giá trị lưu vẫn là chữ cái A1 nên profile không phụ thuộc tên header.
 */
function ColumnInput({
  value,
  columns,
  onChange,
  allowEmpty,
}: {
  value: string;
  columns: ImportColumn[] | null;
  onChange: (v: string) => void;
  allowEmpty?: boolean;
}) {
  if (columns && columns.length > 0) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border-0 bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {allowEmpty && <option value="">— Không có —</option>}
        {/* Cột đã lưu nhưng nằm ngoài file mẫu → vẫn giữ để không âm thầm đổi cấu hình. */}
        {value && !columns.some((c) => c.key === value) && (
          <option value={value}>{value} · (ngoài file mẫu)</option>
        )}
        {columns.map((c) => (
          <option key={c.key} value={c.key}>
            {c.key}
            {c.header ? ` · ${c.header}` : ""}
            {!c.header && c.samples[0] ? ` · ${c.samples[0]}` : ""}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase())}
      // KHÔNG placeholder là chữ cái cột: chữ xám "A" trông y hệt giá trị đã nhập, nhìn không
      // phân biệt được "đang chọn cột A" với "đang để trống".
      placeholder={allowEmpty ? "Trống — dùng quy tắc carrier" : ""}
      maxLength={3}
      className="w-full rounded-xl border-0 bg-secondary px-3 py-2 font-mono text-sm uppercase placeholder:font-sans placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-ring"
    />
  );
}
