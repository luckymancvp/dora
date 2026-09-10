import { NextResponse, type NextRequest } from "next/server";
import { requireEmail, errorResponse } from "@/lib/http/api-helpers";
import { previewImportFile, TrackingImportError } from "@/lib/services/tracking-import";
import { IMPORT_MAX_FILE_BYTES } from "@/lib/types/tracking-import";

// exceljs cần Node runtime (zlib/stream) — không chạy được trên edge.
export const runtime = "nodejs";

// POST /api/tracking/import/preview — multipart form-data, field "file" (.csv | .xlsx).
// Trả ImportPreviewResponse: ma trận ô + mô tả cột + profile tự nhận diện theo header.
export async function POST(req: NextRequest) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Thiếu file" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "File rỗng" }, { status: 400 });
    }
    if (file.size > IMPORT_MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `File quá lớn (tối đa ${IMPORT_MAX_FILE_BYTES / 1024 / 1024}MB)` },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const preview = await previewImportFile({ fileName: file.name, buffer });
    return NextResponse.json(preview);
  } catch (err) {
    if (err instanceof TrackingImportError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return errorResponse(err, "POST /api/tracking/import/preview");
  }
}
