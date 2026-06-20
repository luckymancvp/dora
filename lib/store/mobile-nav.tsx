"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

interface MobileNavState {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  close: () => void;
}

const MobileNavContext = createContext<MobileNavState | null>(null);

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  const value = useMemo<MobileNavState>(
    () => ({ open, setOpen, toggle, close }),
    [open, toggle, close],
  );

  return <MobileNavContext.Provider value={value}>{children}</MobileNavContext.Provider>;
}

export function useMobileNav(): MobileNavState {
  const ctx = useContext(MobileNavContext);
  if (!ctx) throw new Error("useMobileNav must be used within MobileNavProvider");
  return ctx;
}
