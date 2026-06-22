import "server-only";

import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import { getSheetConfigsCollection, getSheetRowsCollection } from "@/lib/db/collections";
import { getAuthorizedSheetsClient, isInvalidGrantError, GoogleNotConnectedError } from "@/lib/google/auth";
import { bulkRefreshSheetStatuses } from "@/lib/services/conversation-sheet-status";
import {
  findHeaderIndex,
  deriveReceiptTxKey,
  normalizeStore,
} from "@/lib/google/sheet-utils";
import type { SheetConfigDoc, SheetRowDoc } from "@/lib/types/sheets";

/** TTL chỉ mục: dữ liệu liệt kê có thể cũ tối đa ~2 phút. */
export const SYNC_TTL_MS = 2 * 60 * 1000;

/**
 * Ngưỡng coi khoá `syncing` là "treo": nếu cờ được chiếm quá lâu (process chết giữa chừng,
 * không kịp nhả cờ) thì cho phép chiếm lại — tránh kẹt vĩnh viễn 1 config.
 */
export const STALE_LOCK_MS = 5 * 60 * 1000;

const UPSERT_BATCH = 2000;

function isStale(cfg: SheetConfigDoc): boolean {
  if (!cfg.lastSyncedAt) return true;
  return Date.now() - new Date(cfg.lastSyncedAt).getTime() > SYNC_TTL_MS;
}

/** Đọc tab Prefix (cột A store) → danh sách store thuộc sheet (gợi ý ưu tiên). */
async function readPrefixStores(
  sheets: Awaited<ReturnType<typeof getAuthorizedSheetsClient>>,
  spreadsheetId: string,
  prefixTabName: string,
): Promise<string[]> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${prefixTabName}!A:A`,
    });
    const rows = res.data.values ?? [];
    const stores: string[] = [];
    for (const r of rows) {
      const v = typeof r[0] === "string" ? r[0].trim() : "";
      if (!v) continue;
      if (normalizeStore(v) === "store") continue; // bỏ header
      stores.push(v);
    }
    return [...new Set(stores)];
  } catch {
    // Tab Prefix không bắt buộc cho việc tra cứu (đã khớp theo receiptTxKey).
    return [];
  }
}

/**
 * Đồng bộ ngay 1 sheet: đọc toàn bộ tab dữ liệu (1 API call), bulk upsert vào `sheet_rows`,
 * dọn dòng đã biến mất, cập nhật metadata config. Có cờ `syncing` chống chạy đua.
 */
export async function syncSheetNow(configId: ObjectId): Promise<{ rowCount: number }> {
  const configs = await getSheetConfigsCollection();
  const cfg = await configs.findOne({ _id: configId });
  if (!cfg) return { rowCount: 0 };

  // Chiếm cờ syncing (atomic). Khoá tự phục hồi: nếu lần sync trước treo quá STALE_LOCK_MS
  // (process chết giữa chừng, không nhả cờ) thì vẫn cho chiếm lại để không kẹt vĩnh viễn.
  const runStart = new Date();
  const staleCutoff = new Date(runStart.getTime() - STALE_LOCK_MS);
  const claim = await configs.updateOne(
    {
      _id: configId,
      $or: [
        { syncing: { $ne: true } },
        // syncStartedAt cũ/null/thiếu → coi như khoá treo, chiếm lại.
        { syncStartedAt: { $not: { $gt: staleCutoff } } },
      ],
    },
    { $set: { syncing: true, syncStartedAt: runStart } },
  );
  if (claim.modifiedCount === 0) return { rowCount: cfg.rowCount ?? 0 };
  try {
    const sheets = await getAuthorizedSheetsClient();

    const stores = await readPrefixStores(sheets, cfg.spreadsheetId, cfg.prefixTabName);

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: cfg.spreadsheetId,
      range: cfg.dataTabName,
      valueRenderOption: "FORMATTED_VALUE",
    });
    const grid = res.data.values ?? [];
    const headers = (grid[0] ?? []).map((h) => (typeof h === "string" ? h : String(h ?? "")));
    const itemIdIdx = findHeaderIndex(headers, "Item ID");
    const orderIdx = findHeaderIndex(headers, "Order");
    const storeIdx = findHeaderIndex(headers, "Store");

    const rowsColl = await getSheetRowsCollection();
    let rowCount = 0;
    const syncedReceiptIds = new Set<number>();

    if (itemIdIdx >= 0) {
      let ops: AnyBulkWriteOperation<SheetRowDoc>[] = [];
      const seen = new Set<string>();
      for (let r = 1; r < grid.length; r++) {
        const row = grid[r] ?? [];
        const itemId = typeof row[itemIdIdx] === "string" ? row[itemIdIdx].trim() : "";
        if (!itemId || seen.has(itemId)) continue; // bỏ rỗng/trùng (dòng sau ghi đè cũng được)
        seen.add(itemId);
        const key = deriveReceiptTxKey(itemId);
        if (!key) continue;

        const values: Record<string, string> = {};
        for (let c = 0; c < headers.length; c++) {
          const h = headers[c];
          if (!h || !h.trim()) continue;
          const cell = row[c];
          values[h] = typeof cell === "string" ? cell : cell == null ? "" : String(cell);
        }

        // Thu thập receiptId để sau sync cập nhật sheetStatuses trên conversations.
        const receiptId = Number(key.split("-")[0]);
        if (receiptId > 0) syncedReceiptIds.add(receiptId);

        const doc: Omit<SheetRowDoc, "_id"> = {
          configId,
          spreadsheetId: cfg.spreadsheetId,
          dataTabName: cfg.dataTabName,
          itemId,
          receiptTxKey: key,
          receiptKey: key.split("-")[0],
          order: orderIdx >= 0 && typeof row[orderIdx] === "string" ? row[orderIdx].trim() : "",
          rowNumber: r + 1, // 1-based, header ở dòng 1
          store: storeIdx >= 0 && typeof row[storeIdx] === "string" ? row[storeIdx].trim() : "",
          values,
          syncedAt: runStart,
        };

        ops.push({
          updateOne: {
            filter: { spreadsheetId: cfg.spreadsheetId, itemId },
            update: { $set: doc },
            upsert: true,
          },
        });
        rowCount++;

        if (ops.length >= UPSERT_BATCH) {
          await rowsColl.bulkWrite(ops, { ordered: false });
          ops = [];
        }
      }
      if (ops.length > 0) await rowsColl.bulkWrite(ops, { ordered: false });

      // Dọn dòng không còn xuất hiện trong lần sync này (đã bị xoá/đổi Item ID trên sheet).
      await rowsColl.deleteMany({ configId, syncedAt: { $lt: runStart } });

      // Cập nhật sheetStatuses trên conversations sau khi sync xong (fire-and-forget).
      void bulkRefreshSheetStatuses([...syncedReceiptIds]).catch(() => {});
    }

    await configs.updateOne(
      { _id: configId },
      {
        $set: {
          syncing: false,
          syncStartedAt: null,
          lastSyncedAt: new Date(),
          lastSyncError: null,
          rowCount,
          updatedAt: new Date(),
          ...(stores.length > 0 ? { shopNames: stores } : {}),
        },
      },
    );
    return { rowCount };
  } catch (err) {
    const message =
      err instanceof GoogleNotConnectedError
        ? "google_not_connected"
        : err instanceof Error
          ? err.message
          : "sync failed";
    await configs.updateOne(
      { _id: configId },
      { $set: { syncing: false, syncStartedAt: null, lastSyncError: message, updatedAt: new Date() } },
    );
    if (err instanceof GoogleNotConnectedError || isInvalidGrantError(err)) {
      throw new GoogleNotConnectedError();
    }
    throw err;
  }
}

/**
 * Đồng bộ lười: nếu chỉ mục cũ quá TTL → refresh. Trả promise để caller chọn await (lần đầu/cold)
 * hay fire-and-forget (đã có dữ liệu, refresh cho lần sau).
 */
export async function syncSheetIfStale(cfg: SheetConfigDoc): Promise<void> {
  if (!cfg._id) return;
  if (cfg.syncing) return;
  if (!isStale(cfg)) return;
  await syncSheetNow(cfg._id);
}
