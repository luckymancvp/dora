"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTabs } from "@/lib/store/tabs";

const BASE = "/messages";

/**
 * Cập nhật URL theo tab đang active (tab đổi → /messages/<id>).
 *
 * CHỈ phản ứng khi `activeTabId` thật sự đổi (do click/mở tab) — KHÔNG phản ứng
 * theo `pathname`. Nếu phản ứng theo pathname, lúc người dùng dán link tin nhắn
 * khác vào thanh địa chỉ, pathname đổi trước khi activeTabId kịp cập nhật, UrlSync
 * sẽ "sửa" URL về activeTabId cũ, rồi OpenFromRoute lại kéo về id mới → đua nhau
 * làm nhảy tab qua lại liên tục.
 */
export function UrlSync() {
  const { activeTabId, isHydrated } = useTabs();
  const router = useRouter();
  const pathname = usePathname();
  const prevActiveRef = useRef<number | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (!isHydrated) return;

    // Lần chạy đầu sau hydrate: chỉ ghi nhận giá trị, KHÔNG ghi đè URL — tránh
    // đè deep-link (URL vừa dán) bằng activeTabId cũ khôi phục từ storage.
    if (!initRef.current) {
      initRef.current = true;
      prevActiveRef.current = activeTabId;
      return;
    }

    if (prevActiveRef.current === activeTabId) return;
    prevActiveRef.current = activeTabId;

    const target = activeTabId === null ? BASE : `${BASE}/${activeTabId}`;
    if (pathname !== target) router.replace(target);
  }, [activeTabId, isHydrated, pathname, router]);

  return null;
}

/**
 * Mở/ kích hoạt tab theo conversation_id trên URL (deep-link).
 * CHỈ phản ứng theo `id` (URL) — KHÔNG phụ thuộc activeTabId, tránh loop khi
 * page cũ chưa unmount kịp lúc chuyển route làm nhảy tab qua lại.
 */
export function OpenFromRoute({ id }: { id: number }) {
  const { openTab, isHydrated } = useTabs();

  useEffect(() => {
    if (!isHydrated) return;
    if (Number.isFinite(id)) openTab(id);
  }, [id, isHydrated, openTab]);

  return null;
}
