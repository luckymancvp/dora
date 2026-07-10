"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Loader2, Pencil, Check, X } from "lucide-react";

interface Rule {
  _id: string;
  trigger: string;
  reply: string;
  enabled: boolean;
}

export default function AutoRepliesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [trigger, setTrigger] = useState("");
  const [reply, setReply] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sửa inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTrigger, setEditTrigger] = useState("");
  const [editReply, setEditReply] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auto-replies");
      const data = (await res.json()) as { items?: Rule[] };
      setRules(data.items ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setError(null);
    if (!trigger.trim() || !reply.trim()) {
      setError("Cần nhập cả trigger và nội dung trả lời.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/auto-replies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: trigger.trim(), reply: reply.trim() }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Lỗi ${res.status}`);
        return;
      }
      setTrigger("");
      setReply("");
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (r: Rule) => {
    await fetch(`/api/auto-replies/${r._id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !r.enabled }),
    });
    setRules((prev) =>
      prev.map((x) => (x._id === r._id ? { ...x, enabled: !x.enabled } : x)),
    );
  };

  const startEdit = (r: Rule) => {
    setEditingId(r._id);
    setEditTrigger(r.trigger);
    setEditReply(r.reply);
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const saveEdit = async (id: string) => {
    setEditError(null);
    if (!editTrigger.trim() || !editReply.trim()) {
      setEditError("Cần nhập cả trigger và nội dung trả lời.");
      return;
    }
    setEditSaving(true);
    try {
      const res = await fetch(`/api/auto-replies/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: editTrigger.trim(), reply: editReply.trim() }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setEditError(data.error ?? `Lỗi ${res.status}`);
        return;
      }
      setRules((prev) =>
        prev.map((x) =>
          x._id === id ? { ...x, trigger: editTrigger.trim(), reply: editReply.trim() } : x,
        ),
      );
      setEditingId(null);
    } finally {
      setEditSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Xoá quy tắc này?")) return;
    await fetch(`/api/auto-replies/${id}`, { method: "DELETE" });
    setRules((prev) => prev.filter((x) => x._id !== id));
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/messages"
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
          aria-label="Quay lại"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-medium tracking-tight text-foreground">
          Tự động trả lời
        </h1>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        Khi tin nhắn khách khớp <strong>chính xác</strong> một trigger (đã chuẩn hoá: thường
        hoá, bỏ dấu câu), hệ thống tự gửi nội dung trả lời tương ứng. Nhiều trigger ngăn cách
        bằng dấu chấm phẩy <code>;</code> (dấu phẩy được giữ nguyên trong câu).
      </p>

      {/* Form tạo mới */}
      <div className="mb-6 rounded-2xl border border-border p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <textarea
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            rows={2}
            placeholder="Trigger (vd: hello; hi)"
            className="min-h-[40px] resize-y rounded-xl border-0 bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={2}
            placeholder="Nội dung trả lời"
            className="min-h-[40px] resize-y rounded-xl border-0 bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <button
          onClick={create}
          disabled={saving}
          className="mt-3 flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:bg-input-strong"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Thêm quy tắc
        </button>
      </div>

      {/* Danh sách */}
      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Đang tải…</p>
      ) : rules.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Chưa có quy tắc nào.</p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {rules.map((r) =>
            editingId === r._id ? (
              <li key={r._id} className="px-4 py-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <textarea
                    value={editTrigger}
                    onChange={(e) => setEditTrigger(e.target.value)}
                    rows={2}
                    placeholder="Trigger (nhiều trigger ngăn bằng ;)"
                    className="min-h-[40px] resize-y rounded-xl border-0 bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <textarea
                    value={editReply}
                    onChange={(e) => setEditReply(e.target.value)}
                    rows={2}
                    placeholder="Nội dung trả lời"
                    className="min-h-[40px] resize-y rounded-xl border-0 bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                {editError && <p className="mt-2 text-sm text-destructive">{editError}</p>}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => saveEdit(r._id)}
                    disabled={editSaving}
                    className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:bg-input-strong"
                  >
                    {editSaving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    Lưu
                  </button>
                  <button
                    onClick={cancelEdit}
                    disabled={editSaving}
                    className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                  >
                    <X className="h-3.5 w-3.5" />
                    Huỷ
                  </button>
                </div>
              </li>
            ) : (
              <li key={r._id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {r.trigger}
                  </div>
                  <div className="truncate text-sm text-muted-foreground">{r.reply}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={r.enabled}
                  aria-label={r.enabled ? "Tắt quy tắc" : "Bật quy tắc"}
                  onClick={() => toggle(r)}
                  className={
                    "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 " +
                    (r.enabled ? "bg-success" : "bg-border")
                  }
                >
                  <span
                    className={
                      "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform " +
                      (r.enabled ? "translate-x-[22px]" : "translate-x-[2px]")
                    }
                  />
                </button>
                <button
                  onClick={() => startEdit(r)}
                  aria-label="Sửa"
                  className="shrink-0 text-muted-foreground hover:text-primary"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => remove(r._id)}
                  aria-label="Xoá"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      </div>
    </div>
  );
}
