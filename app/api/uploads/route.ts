import { NextResponse, type NextRequest } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/auth";

// MIME ảnh được phép — tương ứng isImageFile của DORA (message_service.go),
// bổ sung webp cho phù hợp ảnh hiện đại.
const ALLOWED = ["image/jpeg", "image/png", "image/gif", "image/webp"];

/**
 * POST /api/uploads  (JSON body từ @vercel/blob/client)
 * Cấp token để client upload ảnh TRỰC TIẾP lên Vercel Blob, bỏ qua giới hạn
 * 4.5MB body của Serverless Function → KHÔNG giới hạn dung lượng (Blob tới 5TB).
 * Trả về public URL để extension fetch rồi upload2Etsy.
 *
 * Lưu ý: route này được middleware (proxy.ts) miễn auth để webhook
 * blob.upload-completed (không có cookie) đi qua được. Bảo mật được đảm bảo bởi:
 *  - onBeforeGenerateToken kiểm tra session trước khi cấp token upload.
 *  - handleUpload tự xác thực chữ ký của webhook.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as HandleUploadBody;
    const json = await handleUpload({
      body,
      request: req,
      // Chỉ người đã đăng nhập mới được cấp token upload.
      onBeforeGenerateToken: async () => {
        const session = await auth();
        if (!session?.user?.email) {
          throw new Error("unauthenticated");
        }
        return {
          allowedContentTypes: ALLOWED,
          addRandomSuffix: true,
          // Không đặt maximumSizeInBytes → không giới hạn dung lượng.
        };
      },
      // Ảnh đã có public URL ngay sau upload; không cần xử lý thêm.
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(json);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POST /api/uploads]", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
