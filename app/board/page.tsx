"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConversations } from "@/lib/hooks/useConversations";
import { useBoardDispatch } from "@/lib/hooks/useBoardDispatch";
import { BoardToolbar } from "@/components/board/BoardToolbar";
import { BoardCell, type CellStatus } from "@/components/board/BoardCell";
import { rangeForPreset, type DateRange, type PresetKey } from "@/lib/dashboard/date-presets";
import {
  DEFAULT_CONVERSATION_FILTERS,
  type ConversationFilters,
  type ConversationListItem,
} from "@/lib/types/etsy";

// Trần cứng số ô render để tránh treo trình duyệt dù chọn page size lớn.
const HARD_CAP = 100;
// Giãn cách giữa các lần kích hoạt AI khi bấm "Tạo AI tất cả" (tránh bắn Gemini cùng lúc).
const AI_STAGGER_MS = 400;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Bộ lọc mặc định của board: chưa trả lời + cũ nhất trước + 7 NGÀY (khớp Dashboard,
 * vốn cũng mặc định preset "7days") để hai trang ra cùng một con số.
 *
 * Là FUNCTION chứ không phải const module-scope: rangeForPreset() đọc Date.now(), nếu
 * đặt ở module scope thì khoảng bị đóng băng ở lần load module đầu tiên (đứng yên qua
 * nhiều giờ mở tab). Hàm này chỉ được gọi làm LAZY INITIALIZER của useState → snapshot
 * đúng 1 lần mỗi lần mount.
 */
function makeDefaultFilters(): ConversationFilters {
  return {
    ...DEFAULT_CONVERSATION_FILTERS,
    notReplied: true, // mặc định: chỉ hiện hội thoại chưa trả lời
    sort: "asc", // mặc định: chờ lâu nhất lên đầu
    datePreset: "7days",
    ...rangeForPreset("7days"),
  };
}

export default function BoardPage() {
  // Snapshot khoảng ngày MỘT LẦN mỗi mount (lazy initializer: truyền hàm, KHÔNG gọi hàm).
  // Dùng CÙNG MỘT object cho cả applied lẫn draft → filtersDirty = false lúc mount; nếu gọi
  // makeDefaultFilters() hai lần thì hai mốc `to` có thể lệch 1 giây và nút "Lọc" sáng vô cớ.
  const [initialFilters] = useState<ConversationFilters>(makeDefaultFilters);
  // Bộ lọc ĐÃ ÁP DỤNG — điều khiển truy vấn + render. Chỉ đổi khi bấm "Lọc".
  const [filters, setFilters] = useState<ConversationFilters>(initialFilters);
  // Bộ lọc ĐANG SOẠN — người dùng chỉnh trên toolbar, chưa áp dụng tới khi bấm "Lọc".
  // maxMessages/waitingHours đã nằm TRONG ConversationFilters (lọc ở server) nên không
  // còn state riêng: chúng tự đi theo cặp draft/applied và tự vào filtersDirty.
  const [draftFilters, setDraftFilters] = useState<ConversationFilters>(initialFilters);
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

  // Hai ô số vẫn giữ signature (number | null) của toolbar — chỉ nối vào draft filters.
  const onMaxMessages = useCallback(
    (v: number | null) => setDraftFilters((f) => ({ ...f, maxMessages: v })),
    [],
  );
  const onWaitingHours = useCallback(
    (v: number | null) => setDraftFilters((f) => ({ ...f, waitingHours: v })),
    [],
  );

  // Đổi khoảng ngày → chỉ vào BẢN SOẠN. Đây là event handler người dùng, là nơi DUY NHẤT
  // (ngoài makeDefaultFilters) được phép sinh mốc thời gian mới: rangeForPreset() do chính
  // DateRangeFilter gọi khi bấm preset, kết quả đưa vào đây rồi đứng yên tới lần bấm sau.
  const onDateChange = useCallback((key: PresetKey, r: DateRange) => {
    setDraftFilters((f) => ({ ...f, datePreset: key, from: r.from, to: r.to }));
  }, []);

  // Đã chỉnh nhưng chưa áp dụng → còn "bẩn", cần bấm Lọc. Nay bao trọn cả khoảng ngày,
  // maxMessages và waitingHours vì cả ba đã nằm trong ConversationFilters.
  const filtersDirty = JSON.stringify(draftFilters) !== JSON.stringify(filters);

  // Chỉ copy draft — TUYỆT ĐỐI không đọc lại Date.now() ở đây.
  const applyFilters = useCallback(() => setFilters(draftFilters), [draftFilters]);

  const { items, total, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } =
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

  // Lọc client CHỈ còn hội thoại người dùng bấm X (thuần client, server không biết).
  // maxMessages/waitingHours đã đẩy xuống Mongo để mẫu số `total` (server) và tập hiển thị
  // (client) là CÙNG một tập — đúng bug mẫu số > tử số mà lượt này đi sửa.
  const filtered = useMemo(
    () => retainedItems.filter((c) => !dismissed.has(c.conversationId)),
    [retainedItems, dismissed],
  );

  const limit = Math.min(pageSize, HARD_CAP);
  const cells = filtered.slice(0, limit);
  const overflow = filtered.length - cells.length;

  // Tự nạp thêm trang cho tới khi đủ số ô của page size (dismissed có thể loại bớt nên
  // dựa trên số đã lọc), dừng khi hết trang. Nay hội tụ nhanh hơn vì maxMessages/
  // waitingHours lọc ở server → server không còn trả item mà client sẽ loại.
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
        onDateChange={onDateChange}
        maxMessages={draftFilters.maxMessages}
        onMaxMessages={onMaxMessages}
        waitingHours={draftFilters.waitingHours}
        onWaitingHours={onWaitingHours}
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
        total={total}
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
