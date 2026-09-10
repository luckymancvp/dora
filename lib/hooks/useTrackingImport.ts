"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { jsonFetch } from "@/lib/hooks/useSheets";
import type {
  ImportCheckRequest,
  ImportCheckResponse,
  ImportPreviewResponse,
  TrackingImportProfileDTO,
  TrackingImportProfileInput,
} from "@/lib/types/tracking-import";

const PROFILES_KEY = ["tracking-import-profiles"];

// ---- Cấu hình nguồn file (tab "Cấu hình import") ----

export function useImportProfiles() {
  return useQuery({
    queryKey: PROFILES_KEY,
    queryFn: async () => {
      const data = await jsonFetch<{ profiles: TrackingImportProfileDTO[] }>(
        "/api/tracking/import/profiles",
      );
      return data.profiles;
    },
    // Ít đổi (người dùng tự thêm nguồn) nhưng phải tươi khi vừa lưu → invalidate ở mutation.
    staleTime: 60_000,
  });
}

export function useCreateImportProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TrackingImportProfileInput) =>
      jsonFetch<{ profile: TrackingImportProfileDTO }>("/api/tracking/import/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROFILES_KEY }),
  });
}

export function useUpdateImportProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & Partial<TrackingImportProfileInput>) =>
      jsonFetch<{ profile: TrackingImportProfileDTO }>(`/api/tracking/import/profiles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROFILES_KEY }),
  });
}

export function useDeleteImportProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      jsonFetch<void>(`/api/tracking/import/profiles/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROFILES_KEY }),
  });
}

// ---- Import: upload 1 lần → map cột ở client → check status ----

/**
 * Bước 1: upload file, nhận ma trận ô + cột + profile tự nhận diện.
 * KHÔNG dùng jsonFetch vì body là FormData (jsonFetch không set Content-Type đa phần,
 * nhưng ở đây cần để trình duyệt tự sinh boundary → giữ fetch trần cho rõ ý).
 */
export function usePreviewImportFile() {
  return useMutation({
    mutationFn: async (file: File): Promise<ImportPreviewResponse> => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/tracking/import/preview", { method: "POST", body: form });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Lỗi ${res.status}`);
      }
      return (await res.json()) as ImportPreviewResponse;
    },
  });
}

/** Bước 3: tra Sheet (ưu tiên) → Mera, lọc đơn PROCESSING. */
export function useCheckImportRows() {
  return useMutation({
    mutationFn: (body: ImportCheckRequest) =>
      jsonFetch<ImportCheckResponse>("/api/tracking/import/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
  });
}
