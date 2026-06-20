"use client";

import { useEffect } from "react";
import { TabsProvider, useTabs } from "@/lib/store/tabs";
import { ConversationList } from "@/components/messenger/ConversationList";
import { TabBar } from "@/components/messenger/TabBar";
import { ChatPanel } from "@/components/messenger/ChatPanel";
import { UrlSync } from "@/components/messenger/RouteSync";
import { PendingOpenSync } from "@/components/messenger/PendingOpenSync";
import { useRealtimeMessages } from "@/lib/hooks/useRealtimeMessages";
import { usePrefetchTabs } from "@/lib/hooks/usePrefetchTabs";
import { cn } from "@/lib/utils";

function RealtimeBridge() {
  useRealtimeMessages();
  return null;
}

function PrefetchController() {
  usePrefetchTabs();
  return null;
}

// Ctrl+`  → tab kế tiếp; Ctrl+Shift+`  → tab trước.
function TabHotkeys() {
  const { cycleActive } = useTabs();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.code === "Backquote" || e.key === "`")) {
        e.preventDefault();
        cycleActive(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cycleActive]);
  return null;
}

// Master–detail: trên mobile chỉ hiện 1 cột tại một thời điểm (danh sách HOẶC khung chat),
// quyết định theo activeTabId. Trên md+ hiển thị song song như cũ.
function MessagesPanes() {
  const { activeTabId } = useTabs();
  const hasActive = activeTabId !== null;
  return (
    <div className="flex h-full">
      <ConversationList className={hasActive ? "hidden md:flex" : "flex md:flex"} />
      <div
        className={cn(
          "flex-1 flex-col overflow-hidden md:flex",
          hasActive ? "flex" : "hidden md:flex",
        )}
      >
        <TabBar />
        <ChatPanel />
      </div>
    </div>
  );
}

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  return (
    <TabsProvider>
      <RealtimeBridge />
      <PrefetchController />
      <TabHotkeys />
      <UrlSync />
      <PendingOpenSync />
      {/* children = page sync deep-link (không render gì hiển thị). */}
      {children}
      <MessagesPanes />
    </TabsProvider>
  );
}
