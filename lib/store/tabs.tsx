"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface TabMeta {
  name: string;
  avatar: string;
}

interface TabsState {
  openTabs: number[];
  activeTabId: number | null;
  meta: Record<number, TabMeta>;
  /** true sau khi đã khôi phục tab từ localStorage (để deep-link không bị ghi đè). */
  isHydrated: boolean;
  openTab: (id: number, meta?: TabMeta) => void;
  openMany: (entries: { id: number; meta?: TabMeta }[]) => void;
  closeTab: (id: number) => void;
  closeAll: () => void;
  setActive: (id: number) => void;
  /** Bỏ chọn tab đang active (giữ nguyên danh sách tab) — dùng để quay về danh sách trên mobile. */
  clearActive: () => void;
  cycleActive: (delta: number) => void;
}

const TabsContext = createContext<TabsState | null>(null);
const STORAGE_KEY = "messenger.tabs.v1";

interface Persisted {
  openTabs: number[];
  activeTabId: number | null;
  meta: Record<number, TabMeta>;
}

export function TabsProvider({ children }: { children: React.ReactNode }) {
  const [openTabs, setOpenTabs] = useState<number[]>([]);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [meta, setMeta] = useState<Record<number, TabMeta>>({});
  const hydrated = useRef(false);
  const [isHydrated, setIsHydrated] = useState(false);
  // Tab mở qua "?batch=" là tab trình duyệt riêng biệt → lưu state vào sessionStorage
  // (cô lập theo từng tab) thay vì localStorage, để các đợt mở không trộn vào nhau.
  const storageRef = useRef<Storage | null>(null);

  // Khôi phục tab từ storage phù hợp (local cho messenger chính, session cho batch).
  useEffect(() => {
    let storage: Storage = localStorage;
    try {
      const token = new URLSearchParams(window.location.search).get("batch");
      // batchMode “dính” theo tab để giữ cô lập qua reload/điều hướng (URL bị thay đổi).
      if (token !== null) {
        sessionStorage.setItem("messenger.batchMode", "1");
        sessionStorage.setItem("messenger.batchToken", token);
      }
      if (sessionStorage.getItem("messenger.batchMode") === "1") storage = sessionStorage;
    } catch {
      /* ignore */
    }
    storageRef.current = storage;

    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Persisted;
        setOpenTabs(p.openTabs ?? []);
        setActiveTabId(p.activeTabId ?? null);
        setMeta(p.meta ?? {});
      }
    } catch {
      /* ignore */
    }
    hydrated.current = true;
    setIsHydrated(true);
  }, []);

  // Persist mỗi khi thay đổi (sau hydrate).
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      (storageRef.current ?? localStorage).setItem(
        STORAGE_KEY,
        JSON.stringify({ openTabs, activeTabId, meta } satisfies Persisted),
      );
    } catch {
      /* ignore */
    }
  }, [openTabs, activeTabId, meta]);

  const openTab = useCallback((id: number, m?: TabMeta) => {
    setOpenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActiveTabId(id);
    if (m) setMeta((prev) => ({ ...prev, [id]: m }));
  }, []);

  const openMany = useCallback((entries: { id: number; meta?: TabMeta }[]) => {
    if (entries.length === 0) return;
    setOpenTabs((prev) => {
      const seen = new Set(prev);
      const added: number[] = [];
      for (const e of entries) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          added.push(e.id);
        }
      }
      if (added.length > 0) setActiveTabId(added[0]);
      return added.length > 0 ? [...prev, ...added] : prev;
    });
    setMeta((prev) => {
      const next = { ...prev };
      for (const e of entries) if (e.meta) next[e.id] = e.meta;
      return next;
    });
  }, []);

  const closeTab = useCallback((id: number) => {
    setOpenTabs((prev) => {
      const idx = prev.indexOf(id);
      const next = prev.filter((t) => t !== id);
      setActiveTabId((cur) => {
        if (cur !== id) return cur;
        if (next.length === 0) return null;
        // Active sang tab kế bên.
        return next[Math.min(idx, next.length - 1)];
      });
      return next;
    });
  }, []);

  const closeAll = useCallback(() => {
    setOpenTabs([]);
    setActiveTabId(null);
  }, []);

  const setActive = useCallback((id: number) => setActiveTabId(id), []);

  const clearActive = useCallback(() => setActiveTabId(null), []);

  // Chuyển active tab theo hướng (+1 kế tiếp, -1 lùi), wrap vòng.
  const cycleActive = useCallback(
    (delta: number) => {
      setActiveTabId((cur) => {
        if (openTabs.length === 0) return cur;
        const idx = cur === null ? -1 : openTabs.indexOf(cur);
        const next = (idx + delta + openTabs.length) % openTabs.length;
        return openTabs[next];
      });
    },
    [openTabs],
  );

  const value = useMemo<TabsState>(
    () => ({
      openTabs,
      activeTabId,
      meta,
      isHydrated,
      openTab,
      openMany,
      closeTab,
      closeAll,
      setActive,
      clearActive,
      cycleActive,
    }),
    [
      openTabs,
      activeTabId,
      meta,
      isHydrated,
      openTab,
      openMany,
      closeTab,
      closeAll,
      setActive,
      clearActive,
      cycleActive,
    ],
  );

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

export function useTabs(): TabsState {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("useTabs must be used within TabsProvider");
  return ctx;
}
