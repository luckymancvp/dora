"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { PinTagBody, PinnedTagsResponse } from "@/lib/types/user-preferences";

const PINNED_TAGS_KEY = ["me", "pinned-tags"] as const;

async function fetchPinnedTags(): Promise<PinnedTagsResponse> {
  const res = await fetch("/api/me/pinned-tags");
  if (!res.ok) throw new Error(`pinned-tags ${res.status}`);
  return (await res.json()) as PinnedTagsResponse;
}

async function patchPinnedTag(body: PinTagBody): Promise<PinnedTagsResponse> {
  const res = await fetch("/api/me/pinned-tags", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`pin tag ${res.status}`);
  return (await res.json()) as PinnedTagsResponse;
}

/** Danh sách tag đã ghim của người dùng hiện tại (lưu server theo email). */
export function usePinnedTags() {
  return useQuery({
    queryKey: PINNED_TAGS_KEY,
    queryFn: fetchPinnedTags,
    staleTime: 5 * 60_000,
  });
}

/**
 * Ghim / bỏ ghim 1 tag — cập nhật lạc quan (optimistic), lỗi thì hoàn lại.
 * Chỉ invalidate khi là mutation cuối cùng đang chạy, tránh response của lần bấm trước
 * đè lên trạng thái lạc quan của lần bấm sau.
 */
export function useTogglePinnedTag() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: PINNED_TAGS_KEY,
    mutationFn: patchPinnedTag,
    onMutate: async ({ tag, pinned }: PinTagBody) => {
      await qc.cancelQueries({ queryKey: PINNED_TAGS_KEY });
      const previous = qc.getQueryData<PinnedTagsResponse>(PINNED_TAGS_KEY);
      qc.setQueryData<PinnedTagsResponse>(PINNED_TAGS_KEY, (old) => {
        const current = old?.pinnedTags ?? [];
        const without = current.filter((t) => t !== tag);
        return { pinnedTags: pinned ? [...without, tag] : without };
      });
      return { previous };
    },
    onError: (_err, _body, context) => {
      if (context) qc.setQueryData(PINNED_TAGS_KEY, context.previous);
      toast.error("Không lưu được tag ghim");
    },
    onSettled: () => {
      if (qc.isMutating({ mutationKey: PINNED_TAGS_KEY }) === 1) {
        qc.invalidateQueries({ queryKey: PINNED_TAGS_KEY });
      }
    },
  });
}
