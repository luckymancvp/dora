import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "crypto";
import { put } from "@vercel/blob";

// MIME ảnh được phép — giữ đúng danh sách của /api/uploads.
const ALLOWED = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * POST /api/uploads/mera — đặt một ảnh vào Vercel Blob và trả về public URL.
 *
 * Vì sao tồn tại: extension đính ảnh vào Etsy bằng `fetch(link)` chạy trong content
 * script trên https://www.etsy.com, tức một cross-origin fetch chịu CORS. Vercel Blob
 * trả `Access-Control-Allow-Origin: *` nên fetch được; drive.google.com không trả
 * header nào nên trình duyệt CHẶN và ảnh không bao giờ đính được (curl thì vẫn 200 —
 * curl không áp CORS, nên chỗ này rất dễ kết luận nhầm là chạy được).
 *
 * Hai cách gửi, dùng cái nào là do bên gọi quyết theo kích thước ảnh:
 *  - body nhị phân + Content-Type ảnh: bên gọi đã CẦM sẵn bytes (Mera tải bằng Drive
 *    API đã xác thực) → không phụ thuộc việc file Drive có public hay không. Giới hạn
 *    ~4.5MB body của Serverless Function.
 *  - body JSON {url}: server tự tải. Không giới hạn kích thước, nhưng URL phải tải
 *    được mà không cần đăng nhập.
 *
 * Auth: CHỈ x-api-key khớp MERA_INTERNAL_API_KEY (máy gọi máy, không có session).
 * Middleware miễn auth cho cả /api/uploads nên route phải tự gác.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const expectedKey = process.env.MERA_INTERNAL_API_KEY?.trim();
  const apiKey = req.headers.get("x-api-key")?.trim();
  if (!expectedKey || !apiKey || apiKey !== expectedKey) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  try {
    const reqType = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();

    let buf: Buffer;
    let contentType: string;
    let source: string;

    if (ALLOWED.includes(reqType)) {
      buf = Buffer.from(await req.arrayBuffer());
      contentType = reqType;
      source = "bytes";
    } else if (reqType === "application/json") {
      const body = (await req.json()) as { url?: unknown };
      const url = typeof body.url === "string" ? body.url.trim() : "";
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return NextResponse.json({ error: "url phải là http(s)" }, { status: 400 });
      }
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) {
        return NextResponse.json(
          { error: `Không tải được ảnh nguồn (HTTP ${res.status})`, code: "fetch_failed" },
          { status: 502 },
        );
      }
      const srcType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!ALLOWED.includes(srcType)) {
        // Drive trả text/html khi link không public (trang "xin quyền truy cập").
        // Đẩy nguyên trang đó lên blob rồi gửi cho khách thì tệ hơn hẳn báo lỗi.
        return NextResponse.json(
          {
            error: `Nguồn không phải ảnh (content-type: ${srcType || "không rõ"})`,
            code: "not_an_image",
          },
          { status: 415 },
        );
      }
      buf = Buffer.from(await res.arrayBuffer());
      contentType = srcType;
      source = url;
    } else {
      return NextResponse.json(
        { error: `Content-Type không hỗ trợ: ${reqType || "(trống)"}`, code: "bad_content_type" },
        { status: 415 },
      );
    }

    if (buf.byteLength === 0) {
      return NextResponse.json({ error: "Ảnh rỗng", code: "empty" }, { status: 400 });
    }
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json(
        { error: `Ảnh lớn hơn ${MAX_BYTES / 1024 / 1024}MB`, code: "too_large" },
        { status: 413 },
      );
    }

    // Đường dẫn suy TẤT ĐỊNH từ chính nội dung (hoặc URL nguồn) + ghi đè: gửi lại cùng
    // một mockup sẽ ghi đè đúng chỗ cũ thay vì sinh thêm một bản sao mỗi lần chạy lại.
    const key = createHash("sha256")
      .update(source === "bytes" ? buf : source)
      .digest("hex")
      .slice(0, 32);
    const blob = await put(`mera/${key}.${EXT[contentType]}`, buf, {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    return NextResponse.json({ url: blob.url, pathname: blob.pathname, size: buf.byteLength });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /api/uploads/mera]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
