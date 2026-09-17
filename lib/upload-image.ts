"use client";

import { upload } from "@vercel/blob/client";

/**
 * MIME ảnh được phép — PHẢI khớp `ALLOWED` trong app/api/uploads/route.ts,
 * vì token upload chỉ được cấp cho đúng các content-type này.
 */
export const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

/**
 * Upload ảnh TRỰC TIẾP lên Vercel Blob qua token từ /api/uploads (bỏ qua giới
 * hạn 4.5MB body của Serverless Function) và trả về mảng public URL.
 *
 * - File sai MIME bị bỏ qua (không nằm trong mảng kết quả).
 * - `upload()` tự ném Error rõ ràng khi thất bại → caller bắt và toast.error.
 */
export async function uploadImageFiles(files: File[]): Promise<string[]> {
  const urls: string[] = [];
  for (const f of files) {
    if (f.type && !ALLOWED_IMAGE_TYPES.has(f.type)) continue;
    const blob = await upload(f.name || "image.png", f, {
      access: "public",
      handleUploadUrl: "/api/uploads",
      contentType: f.type || undefined,
    });
    urls.push(blob.url);
  }
  return urls;
}
