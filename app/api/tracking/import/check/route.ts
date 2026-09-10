import { NextResponse, type NextRequest } from "next/server";
import { requireEmail, errorResponse } from "@/lib/http/api-helpers";
import { checkImportRows } from "@/lib/services/tracking-import";
import { IMPORT_MAX_ROWS, type ImportCheckRequest } from "@/lib/types/tracking-import";

// Đọc Mongo + gọi Mera qua fetch → Node runtime.
export const runtime = "nodejs";

// POST /api/tracking/import/check
// body: { shopName?, rows: [{ rowNumber, order_id, tracking_number, carrier }] }
// Tra status trên Google Sheet (ưu tiên) rồi Mera; chỉ đơn PROCESSING mới ELIGIBLE.
// Carrier chốt tại đây (ô file → quy tắc carrier) để preview và lượt add dùng CHUNG một
// kết quả, không lệch giữa client và server. Không suy được carrier ⇒ bỏ qua dòng đó.
export async function POST(req: NextRequest) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;

    const body = (await req.json()) as Partial<ImportCheckRequest>;
    // shopName chỉ là gợi ý ưu tiên sheet — store thật suy từ tiền tố order id từng dòng.
    const shopName = String(body.shopName ?? "").trim();

    const rows = (Array.isArray(body.rows) ? body.rows : [])
      .slice(0, IMPORT_MAX_ROWS)
      .map((r, i) => ({
        // rowNumber chỉ để hiển thị; hỏng thì rơi về thứ tự trong mảng.
        rowNumber: Number.isFinite(Number(r?.rowNumber)) ? Number(r.rowNumber) : i + 1,
        order_id: String(r?.order_id ?? ""),
        tracking_number: String(r?.tracking_number ?? ""),
        carrier: String(r?.carrier ?? ""),
      }));

    if (rows.length === 0) {
      return NextResponse.json({ error: "Không có dòng nào để kiểm tra" }, { status: 400 });
    }

    const result = await checkImportRows({
      storeName: shopName,
      rows,
      actorEmail: gate.email,
    });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err, "POST /api/tracking/import/check");
  }
}
