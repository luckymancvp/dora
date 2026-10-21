import { carrierTrackingUrl } from "@/lib/delivery/carrierTrackingUrl";
import { deliveryStatusLabel, formatDate, formatDateTime } from "@/lib/delivery/deliveryTracking";
import type {
  DeliveryOrderSource,
  DeliveryTracking,
  DeliveryTrackingListParams,
  DeliveryTrackingListResponse,
} from "@/lib/types/delivery";

/**
 * Export XLSX màn Giao hàng: toàn bộ kết quả của bộ lọc đang chọn (mọi trang), 1 dòng = 1 item
 * (mã mang nhiều đơn/item → lặp phần mã ở từng dòng, để lọc/đếm trong Excel). Mã không có item
 * trong phạm vi → 1 dòng chỉ có phần mã.
 *
 * Chép `mera-fulfill-frontend/src/lib/trackingExport.ts`; khác Mera: ghi file bằng `exceljs` có sẵn
 * (dynamic import phía client — không kéo vào bundle đầu trang), KHÔNG thêm `xlsx` (A9).
 */

export const TRACKING_EXPORT_HEADER = [
  "Tracking Number", "Carrier", "Tracking Link", "Status", "Etsy State", "Latest Event", "Event Time", "Location",
  "Transit Days", "Paid", "Ship", "Delivered", "Order ID", "Source", "Shop", "Etsy Receipt", "Item Key", "Product",
  "Fulfill", "Item Status", "Stars", "Review", "Review Date", "Last Checked",
] as const;

type Cell = string | number;

const d = (iso: string | null | undefined) => (iso ? formatDate(iso).replace("—", "") : "");
const dt = (iso: string | null | undefined) => (iso ? formatDateTime(iso).replace("—", "") : "");

/** Cột Source: đơn Mera hay dòng Google Sheet của dora-1 (BE cũ không gửi `source` → Mera). */
export function orderSourceLabel(source: DeliveryOrderSource | undefined): string {
  return source === "dora_sheet" ? "Dora" : "Mera";
}

export function trackingExportRows(items: DeliveryTracking[]): Cell[][] {
  const rows: Cell[][] = [];
  for (const t of items) {
    const head: Cell[] = [
      t.code,
      t.carrier || "",
      carrierTrackingUrl(t) || "",
      deliveryStatusLabel(t.status),
      t.major_state || "",
      t.latest_event?.desc || "",
      dt(t.latest_event?.time),
      t.latest_event?.location || "",
      t.transit_days ?? "",
      d(t.paid_at),
      d(t.mailing_date),
      d(t.delivered_at),
    ];
    const tail: Cell[] = [dt(t.last_checked_at)];
    let any = false;
    for (const o of t.orders ?? []) {
      for (const it of o.items ?? []) {
        any = true;
        const r = it.review;
        rows.push([
          ...head,
          o.order_id, orderSourceLabel(o.source), o.store || "", o.etsy_receipt_id || "",
          it.item_key, it.product_name || "", it.latest_provider || "", it.status || "",
          r ? r.rating : "", r?.message || "", r ? d(r.review_created_at) : "",
          ...tail,
        ]);
      }
    }
    if (!any) rows.push([...head, "", "", "", "", "", "", "", "", "", "", "", ...tail]);
  }
  return rows;
}

/** Số mã mỗi lần gọi khi gom đủ các trang (trần limit của BE). */
const EXPORT_PAGE_SIZE = 200;

/** Tải Blob xuống máy qua thẻ `<a download>` tạm. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Trả URL sau 1 nhịp để trình duyệt kịp bắt đầu tải.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Gom mọi trang của bộ lọc (bỏ page/limit của màn) rồi tải file. `onProgress(đã lấy, tổng)`.
 * `list` = `fetchDeliveryList` (lib/hooks/useDelivery.ts) — không qua cache React Query.
 */
export async function exportTrackingXlsx(
  list: (p: DeliveryTrackingListParams, signal?: AbortSignal) => Promise<DeliveryTrackingListResponse>,
  params: DeliveryTrackingListParams,
  filename: string,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<number> {
  const all: DeliveryTracking[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let page = 1; ; page++) {
    const res = await list({ ...params, page, limit: EXPORT_PAGE_SIZE }, signal);
    total = res.total;
    // Danh sách có thể đổi giữa các trang (refresh nền) → bỏ mã trùng.
    for (const it of res.items) {
      if (!seen.has(it.id)) {
        seen.add(it.id);
        all.push(it);
      }
    }
    onProgress?.(all.length, total);
    if (res.items.length < EXPORT_PAGE_SIZE || page * EXPORT_PAGE_SIZE >= total) break;
  }

  const mod = await import("exceljs");
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Tracking");
  ws.addRow([...TRACKING_EXPORT_HEADER]);
  const body = trackingExportRows(all);
  ws.addRows(body);
  TRACKING_EXPORT_HEADER.forEach((h, i) => {
    ws.getColumn(i + 1).width =
      h === "Tracking Link" || h === "Review" || h === "Latest Event" ? 40 : Math.max(12, h.length + 2);
  });
  ws.getRow(1).font = { bold: true };
  const lastCol = ws.getColumn(TRACKING_EXPORT_HEADER.length).letter;
  ws.autoFilter = `A1:${lastCol}${body.length + 1}`;

  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    filename,
  );
  return all.length;
}
