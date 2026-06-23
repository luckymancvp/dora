"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, MessageCircle, RotateCcw, Users, X } from "lucide-react";
import {
  OPENED_KEY,
  readOpenedIds,
  readSplit,
  readStaged,
  setOpenedIds,
  splitEven,
  STAGE_KEY,
  writeBatch,
  writeSplit,
  type OpenEntry,
} from "@/lib/store/open-multiple";

const BATCH_SIZES = [10, 20, 40];

export default function OpenMultiplePage() {
  const [allEntries, setAllEntries] = useState<OpenEntry[]>([]);
  const [opened, setOpened] = useState<Set<number>>(new Set());
  const [people, setPeople] = useState(1);
  const [part, setPart] = useState(1);
  const [peopleInput, setPeopleInput] = useState("1"); // ô nhập "số người" (cho gõ tự do)

  // Nạp danh sách + đánh dấu; đồng bộ khi dashboard stage danh sách mới (storage event).
  useEffect(() => {
    setAllEntries(readStaged());
    setOpened(new Set(readOpenedIds()));
    const s = readSplit();
    setPeople(s.people);
    setPart(s.part);
    setPeopleInput(String(s.people));
    const onStorage = (e: StorageEvent) => {
      if (e.key === STAGE_KEY || e.key === null) {
        setAllEntries(readStaged());
        setOpened(new Set(readOpenedIds()));
      } else if (e.key === OPENED_KEY) {
        setOpened(new Set(readOpenedIds()));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Sắp xếp theo id cố định để mọi máy cắt ra cùng các phần (không trùng/sót),
  // rồi lấy đúng phần của mình. people=1 → giữ nguyên toàn bộ danh sách.
  const sorted = useMemo(
    () => [...allEntries].sort((a, b) => a.id - b.id),
    [allEntries],
  );
  const groups = useMemo(() => splitEven(sorted, people), [sorted, people]);
  const safePart = Math.min(Math.max(1, part), people);
  const entries = useMemo(
    () => (people <= 1 ? sorted : groups[safePart - 1] ?? []),
    [people, sorted, groups, safePart],
  );

  // Đổi cách chia: lưu lại để mở tab khác / reload vẫn giữ.
  const applySplit = useCallback((nextPeople: number, nextPart: number) => {
    const p = Math.max(1, Math.floor(nextPeople));
    const k = Math.min(Math.max(1, nextPart), p);
    setPeople(p);
    setPart(k);
    setPeopleInput(String(p));
    writeSplit({ people: p, part: k });
  }, []);

  // Ô nhập số người: cho gõ tự do, áp dụng ngay khi là số hợp lệ; trống thì để yên.
  const onPeopleInput = useCallback(
    (raw: string) => {
      setPeopleInput(raw);
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n >= 1) {
        const cap = Math.max(1, sorted.length);
        applySplit(Math.min(n, cap), part);
      }
    },
    [applySplit, part, sorted.length],
  );

  // Mỗi đợt mở = MỘT TAB TRÌNH DUYỆT MỚI: handoff theo token, mở /messages?batch=token.
  // Tab mới mở đúng đợt này thành tab trong app (cơ chế giữ nguyên). Không trộn tab cũ.
  const openList = useCallback((list: OpenEntry[]) => {
    if (list.length === 0) return;
    const token =
      Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    writeBatch(token, list);
    window.open(`/messages?batch=${token}`, `dora-batch-${token}`);
    setOpened((prev) => {
      const next = new Set(prev);
      for (const e of list) next.add(e.id);
      setOpenedIds([...next]);
      return next;
    });
  }, []);

  const remaining = entries.filter((e) => !opened.has(e.id));

  const openNext = (n: number) => openList(remaining.slice(0, n));
  const openAll = () => openList(remaining);

  const reset = () => {
    setOpenedIds([]);
    setOpened(new Set());
  };

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div
        className={`mx-auto px-6 py-10 md:px-12 md:py-14 ${
          people > 1 ? "max-w-6xl" : "max-w-3xl"
        }`}
      >
        <button
          type="button"
          onClick={() => window.close()}
          className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
          Đóng tab
        </button>

        <h1 className="text-2xl font-medium tracking-tight text-foreground">
          Mở nhiều hội thoại
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tổng <span className="font-bold text-foreground">{sorted.length}</span> hội thoại
          {people > 1 ? (
            <>
              {" "}
              chia thành <span className="font-bold text-foreground">{people}</span> ô. Mỗi người
              phụ trách một ô; phần được cắt theo thứ tự cố định nên không ai mở trùng.
            </>
          ) : (
            <>
              {" "}
              — còn lại <span className="font-bold text-foreground">{remaining.length}</span> chưa
              mở. Nhập số người để chia thành các ô.
            </>
          )}{" "}
          Mỗi lần mở bật một tab trình duyệt mới.
        </p>

        {/* Chia việc: ô nhập số người */}
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4">
          <label
            htmlFor="people-input"
            className="inline-flex items-center gap-2 text-sm font-bold text-foreground"
          >
            <Users className="h-4 w-4 text-primary" />
            Chia cho
          </label>
          <input
            id="people-input"
            type="number"
            min={1}
            max={Math.max(1, sorted.length)}
            inputMode="numeric"
            value={peopleInput}
            onChange={(ev) => onPeopleInput(ev.target.value)}
            onBlur={() => setPeopleInput(String(people))}
            className="w-24 rounded-xl border border-border bg-background px-3 py-2 text-sm font-bold text-foreground outline-none focus:border-primary"
          />
          <span className="text-sm text-muted-foreground">người</span>

          <button
            type="button"
            onClick={reset}
            disabled={opened.size === 0}
            className="ml-auto inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-bold text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-40"
          >
            <RotateCcw className="h-4 w-4" />
            Reset đã mở
          </button>
        </div>

        {sorted.length === 0 ? (
          <div className="mt-8 rounded-3xl border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
            Không có hội thoại nào. Hãy mở lại từ Dashboard.
          </div>
        ) : people <= 1 ? (
          /* 1 người: danh sách + nút mở như cũ */
          <>
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={openAll}
                disabled={remaining.length === 0}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary/90 disabled:opacity-40"
              >
                <ExternalLink className="h-4 w-4" />
                Mở tất cả ({remaining.length})
              </button>
              {BATCH_SIZES.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => openNext(n)}
                  disabled={remaining.length === 0}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
                >
                  Mở {n}
                </button>
              ))}
            </div>

            <div className="mt-8 overflow-hidden rounded-3xl border border-border bg-card">
              <ul className="divide-y divide-border">
                {entries.slice(0, 200).map((e, idx) => (
                  <ConvRow key={e.id} e={e} idx={idx} opened={opened.has(e.id)} onOpen={openList} />
                ))}
              </ul>
              {entries.length > 200 && (
                <div className="px-6 py-3 text-center text-xs text-muted-foreground">
                  + {entries.length - 200} hội thoại khác
                </div>
              )}
            </div>
          </>
        ) : (
          /* Nhiều người: lưới các ô, mỗi ô là phần của một người */
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g, i) => {
              const gRemaining = g.filter((e) => !opened.has(e.id));
              const isMine = safePart === i + 1;
              return (
                <div
                  key={i}
                  className={`flex flex-col overflow-hidden rounded-2xl border bg-card ${
                    isMine ? "border-primary ring-1 ring-primary" : "border-border"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                    <button
                      type="button"
                      onClick={() => applySplit(people, i + 1)}
                      className="min-w-0 text-left"
                      title="Đánh dấu đây là phần của tôi"
                    >
                      <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                        Người {i + 1}
                        {isMine && (
                          <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-white">
                            của bạn
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{g.length} hội thoại</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => openList(gRemaining)}
                      disabled={gRemaining.length === 0}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-primary/90 disabled:opacity-40"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Mở {gRemaining.length}
                    </button>
                  </div>
                  {/* Mở từng đợt trong phần này (như tab tổng) */}
                  <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2.5">
                    {BATCH_SIZES.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => openList(gRemaining.slice(0, n))}
                        disabled={gRemaining.length === 0}
                        className="rounded-full border border-border bg-card px-3 py-1 text-xs font-bold text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
                      >
                        Mở {n}
                      </button>
                    ))}
                  </div>
                  <ul className="max-h-72 divide-y divide-border overflow-y-auto">
                    {g.map((e, idx) => (
                      <ConvRow
                        key={e.id}
                        e={e}
                        idx={idx}
                        opened={opened.has(e.id)}
                        onOpen={openList}
                        compact
                      />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Một dòng hội thoại (dùng chung cho chế độ 1 người và lưới nhiều người). */
function ConvRow({
  e,
  idx,
  opened,
  onOpen,
  compact = false,
}: {
  e: OpenEntry;
  idx: number;
  opened: boolean;
  onOpen: (list: OpenEntry[]) => void;
  compact?: boolean;
}) {
  return (
    <li className={`flex items-center gap-2 text-sm ${compact ? "px-3 py-2" : "gap-3 px-6 py-3"}`}>
      <span className="w-6 shrink-0 text-xs text-muted-foreground">{idx + 1}</span>
      {opened ? (
        <Check className="h-4 w-4 shrink-0 text-success" />
      ) : (
        <MessageCircle className="h-4 w-4 shrink-0 text-primary" />
      )}
      <button
        type="button"
        onClick={() => onOpen([e])}
        title="Mở hội thoại này ở tab mới"
        className="min-w-0 flex-1 text-left"
      >
        <span
          className={`block truncate font-bold transition-colors hover:text-primary ${
            opened ? "text-muted-foreground line-through" : "text-foreground"
          }`}
        >
          {e.name || `Hội thoại ${e.id}`}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {e.shop ? `${e.shop} · ` : ""}#{e.id}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onOpen([e])}
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-bold text-primary transition-colors hover:bg-accent"
      >
        {opened ? "Mở lại" : "Mở"}
      </button>
    </li>
  );
}
