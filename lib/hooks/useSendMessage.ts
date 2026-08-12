"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PendingMessage } from "@/lib/types/etsy";

const POLL_INTERVAL = 1000;
const POLL_MAX = 8; // ~8s

export function useSendMessage(conversationId: number) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const markFailed = useCallback((localId: string, reason?: PendingMessage["reason"]) => {
    setPending((prev) =>
      prev.map((p) => (p.localId === localId ? { ...p, status: "failed", reason } : p)),
    );
  }, []);

  const remove = useCallback((localId: string) => {
    setPending((prev) => prev.filter((p) => p.localId !== localId));
  }, []);

  const pollStatus = useCallback(
    (localId: string, serverId: string) => {
      let tries = 0;
      const tick = async () => {
        if (!mounted.current) return;
        tries++;
        try {
          const res = await fetch(`/v1/messages/status/${serverId}`);
          if (res.ok) {
            const msg = (await res.json()) as { status?: string };
            if (msg.status === "DONE") {
              // Refetch xong rồi mới gỡ bubble tạm → tránh tin nhắn biến mất
              // rồi hiện lại (khoảng trống giữa lúc gỡ và lúc tin thật về).
              await queryClient.refetchQueries({
                queryKey: ["messages", conversationId],
              });
              if (!mounted.current) return;
              remove(localId);
              queryClient.invalidateQueries({ queryKey: ["conversations"] });
              return;
            }
            if (msg.status === "FAILED") {
              markFailed(localId);
              return;
            }
          }
        } catch {
          /* ignore, sẽ thử lại */
        }
        if (tries >= POLL_MAX) {
          markFailed(localId);
          return;
        }
        setTimeout(tick, POLL_INTERVAL);
      };
      setTimeout(tick, POLL_INTERVAL);
    },
    [conversationId, queryClient, markFailed, remove],
  );

  const send = useCallback(
    async (text: string, attachments: string[] = []) => {
      const trimmed = text.trim();
      if (!trimmed && attachments.length === 0) return;
      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const label = trimmed || (attachments.length > 0 ? "🖼️ Đang gửi ảnh…" : "");
      setPending((prev) => [
        ...prev,
        { localId, serverId: null, text: label, status: "sending" },
      ]);

      try {
        const res = await fetch(`/api/conversations/${conversationId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, attachments }),
        });
        if (!res.ok) {
          markFailed(localId);
          return;
        }
        const created = (await res.json()) as {
          id: string;
          status: string;
          reason?: PendingMessage["reason"];
        };
        setPending((prev) =>
          prev.map((p) => (p.localId === localId ? { ...p, serverId: created.id } : p)),
        );
        if (created.status === "FAILED") {
          markFailed(localId, created.reason);
          return;
        }
        pollStatus(localId, created.id);
      } catch {
        markFailed(localId);
      }
    },
    [conversationId, markFailed, pollStatus],
  );

  const retryRemove = remove;

  return { pending, send, retryRemove };
}
