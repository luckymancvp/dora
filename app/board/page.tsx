"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConversations } from "@/lib/hooks/useConversations";
import { useBoardDispatch } from "@/lib/hooks/useBoardDispatch";
import { BoardToolbar } from "@/components/board/BoardToolbar";
import { BoardCell, type CellStatus } from "@/components/board/BoardCell";
import type { ConversationFilters, ConversationListItem } from "@/lib/types/etsy";

// Trần cứng số ô render để tránh treo trình duyệt dù chọn page size lớn.
const HARD_CAP = 100;
// Giãn cách giữa các lần kích hoạt AI khi bấm "Tạo AI tất cả" (tránh bắn Gemini cùng lúc).
const AI_STAGGER_MS = 400;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const DEFAULT_FILTERS: ConversationFilters = {
  search: "",
  notReplied: false,
  hasOrder: false,
  orderHelp: false,
  hasNote: false,
  shopIds: [],
  tags: [],
  sheetStatuses: [],
  sort: "asc", // mặc định: chờ lâu nhất lên đầu
};

export default function BoardPage() {
  // Bộ lọc ĐÃ ÁP DỤNG — điều khiển truy vấn + render. Chỉ đổi khi bấm "Lọc".
  const [filters, setFilters] = useState<ConversationFilters>(DEFAULT_FILTERS);
  const [maxMessages, setMaxMessages] = useState<number | null>(null);
  const [waitingHours, setWaitingHours] = useState<number | null>(null);
  // Bộ lọc ĐANG SOẠN — người dùng chỉnh trên toolbar, chưa áp dụng tới khi bấm "Lọc".
  const [draftFilters, setDraftFilters] = useState<ConversationFilters>(DEFAULT_FILTERS);
  const [draftMaxMessages, setDraftMaxMessages] = useState<number | null>(null);
  const [draftWaitingHours, setDraftWaitingHours] = useState<number | null>(null);
  const [columns, setColumns] = useState(2);
  const [pageSize, setPageSize] = useState(20);

  const [drafts, setDrafts] = useState<Map<number, string>>(new Map());
  const [statuses, setStatuses] = useState<Map<number, CellStatus>>(new Map());
  // Mỗi lần tăng → ô tương ứng gọi gợi ý AI (ConversationView lắng nghe aiTrigger).
  const [aiTriggers, setAiTriggers] = useState<Map<number, number>>(new Map());
  const [aiGen, setAiGen] = useState({ running: false, total: 0, done: 0 });

  const dispatch = useBoardDispatch();

  // Toolbar chỉnh BẢN SOẠN; chỉ "Lọc" mới đẩy sang bản áp dụng.
  const onFiltersChange = useCallback(
    (patch: Partial<ConversationFilters>) => setDraftFilters((f) => ({ ...f, ...patch })),
    [],
  );

  // Đã chỉnh nhưng chưa áp dụng → còn "bẩn", cần bấm Lọc.
  const filtersDirty =
    JSON.stringify(draftFilters) !== JSON.stringify(filters) ||
    draftMaxMessages !== maxMessages ||
    draftWaitingHours !== waitingHours;

  const applyFilters = useCallback(() => {
    setFilters(draftFilters);
    setMaxMessages(draftMaxMessages);
    setWaitingHours(draftWaitingHours);
  }, [draftFilters, draftMaxMessages, draftWaitingHours]);

  const { items, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } =
    useConversations(filters);

  // --- Giữ lại hội thoại đã hiển thị trong phiên lọc hiện tại ---
  // Khi đang lọc "Chưa trả lời", sau khi shop trả lời thì server loại hội thoại
  // khỏi kết quả và refetch khiến nó biến mất giữa chừng. Ta giữ lại (đúng vị
  // trí cũ) để user còn kiểm tra; chỉ reset khi đổi bộ lọc hoặc reload trang.
  const filtersKey = JSON.stringify(filters);
  const retainMapRef = useRef<Map<number, ConversationListItem>>(new Map());
  const [retainOrder, setRetainOrder] = useState<number[]>([]);
  // Hội thoại người dùng đã bấm X để bỏ khỏi danh sách (không xử lý).
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  useEffect(() => {
    // Đổi bộ lọc → bắt đầu phiên giữ mới.
    retainMapRef.current = new Map();
    setRetainOrder([]);
    setDismissed(new Set());
  }, [filtersKey]);

  const dismiss = useCallback(
    (id: number) => setDismissed((prev) => new Set(prev).add(id)),
    [],
  );

  useEffect(() => {
    const map = retainMapRef.current;
    const added: number[] = [];
    for (const c of items) {
      if (!map.has(c.conversationId)) added.push(c.conversationId);
      map.set(c.conversationId, c); // luôn cập nhật bản mới nhất từ server
    }
    if (added.length) setRetainOrder((prev) => [...prev, ...added]);
  }, [items]);

  // Hợp nhất theo thứ tự đã thấy: item nào server đã loại (đã trả lời) vẫn còn
  // trong map nên tiếp tục hiển thị tại đúng vị trí.
  const retainedItems = useMemo(
    () =>
      retainOrder
        .map((id) => retainMapRef.current.get(id))
        .filter((c): c is ConversationListItem => c != null),
    // items nằm trong deps để đọc lại bản mới nhất sau mỗi lần refetch.
    [retainOrder, items],
  );

  // Lọc client: số tin nhắn + thời gian chờ.
  const filtered = useMemo(() => {
    const now = Date.now();
    return retainedItems.filter((c) => {
      if (dismissed.has(c.conversationId)) return false;
      if (maxMessages != null && !(c.messageCount < maxMessages)) return false;
      if (waitingHours != null) {
        const ageH = (now - c.lastMessageDate * 1000) / 3_600_000;
        if (ageH < waitingHours) return false;
      }
      return true;
    });
  }, [retainedItems, maxMessages, waitingHours, dismissed]);

  const limit = Math.min(pageSize, HARD_CAP);
  const cells = filtered.slice(0, limit);
  const overflow = filtered.length - cells.length;

  // Tự nạp thêm trang cho tới khi đủ số ô của page size (bộ lọc client có thể
  // loại bớt nên dựa trên số đã lọc), dừng khi hết trang.
  useEffect(() => {
    if (filtered.length < limit && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [filtered.length, limit, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // ---- Draft / status helpers ----
  const setDraft = useCallback((id: number, v: string) => {
    setDrafts((prev) => {
      const n = new Map(prev);
      if (v) n.set(id, v);
      else n.delete(id);
      return n;
    });
    // Sửa lại nội dung → bỏ trạng thái ok/fail cũ.
    setStatuses((prev) => {
      if (!prev.has(id)) return prev;
      const n = new Map(prev);
      n.delete(id);
      return n;
    });
  }, []);

  const setStatus = useCallback((id: number, s: CellStatus) => {
    setStatuses((prev) => new Map(prev).set(id, s));
  }, []);

  const draftCount = cells.filter((c) => (drafts.get(c.conversationId) ?? "").trim()).length;

  const fillTemplate = useCallback(
    (text: string) => {
      setDrafts(() => new Map(cells.map((c) => [c.conversationId, text])));
      setStatuses(new Map());
    },
    [cells],
  );

  const clearDrafts = useCallback(() => {
    setDrafts(new Map());
    setStatuses(new Map());
  }, []);

  // ---- Gửi hàng loạt ----
  const sendAll = useCallback(() => {
    const batch = cells
      .map((c) => ({ conversationId: c.conversationId, message: drafts.get(c.conversationId) ?? "" }))
      .filter((it) => it.message.trim());
    if (batch.length === 0) return;
    if (!window.confirm(`Gửi ${batch.length} tin nhắn? Các tin sẽ gửi tuần tự.`)) return;
    void dispatch.run(batch, (id, outcome) => {
      setStatus(id, outcome);
      if (outcome === "ok") setDraft(id, "");
    });
  }, [cells, drafts, dispatch, setDraft, setStatus]);

  // ---- Tạo AI tất cả: kích hoạt từng ô, giãn cách để không bắn Gemini cùng lúc ----
  const generateAllAI = useCallback(async () => {
    if (aiGen.running) return;
    const ids = cells.map((c) => c.conversationId);
    setAiGen({ running: true, total: ids.length, done: 0 });
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      setAiTriggers((prev) => new Map(prev).set(id, (prev.get(id) ?? 0) + 1));
      setAiGen((s) => ({ ...s, done: i + 1 }));
      if (i < ids.length - 1) await sleep(AI_STAGGER_MS);
    }
    setAiGen((s) => ({ ...s, running: false }));
  }, [aiGen.running, cells]);

  const cellStatus = (id: number): CellStatus => {
    if (dispatch.state.current === id) return "sending";
    return statuses.get(id) ?? "idle";
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <BoardToolbar
        filters={draftFilters}
        onFiltersChange={onFiltersChange}
        maxMessages={draftMaxMessages}
        onMaxMessages={setDraftMaxMessages}
        waitingHours={draftWaitingHours}
        onWaitingHours={setDraftWaitingHours}
        onApply={applyFilters}
        filtersDirty={filtersDirty}
        columns={columns}
        onColumns={setColumns}
        pageSize={pageSize}
        onPageSize={setPageSize}
        onFillTemplate={fillTemplate}
        onClearDrafts={clearDrafts}
        draftCount={draftCount}
        shown={cells.length}
        total={filtered.length}
        loading={isLoading || isFetchingNextPage}
        onGenerateAllAI={generateAllAI}
        aiGen={aiGen}
        onSendAll={sendAll}
        dispatch={dispatch.state}
        onCancelSend={dispatch.cancel}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Đang tải…</p>
        ) : cells.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Không có hội thoại nào khớp bộ lọc.
          </p>
        ) : (
          <>
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            >
              {cells.map((c) => (
                <BoardCell
                  key={c.conversationId}
                  conv={c}
                  draft={drafts.get(c.conversationId) ?? ""}
                  onDraftChange={(v) => setDraft(c.conversationId, v)}
                  status={cellStatus(c.conversationId)}
                  aiTrigger={aiTriggers.get(c.conversationId) ?? 0}
                  onDismiss={() => dismiss(c.conversationId)}
                />
              ))}
            </div>
            {overflow > 0 && (
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Đang hiển thị {cells.length} hội thoại đầu — còn {overflow} nữa. Tăng Page Size hoặc lọc thêm để xử lý hết.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
