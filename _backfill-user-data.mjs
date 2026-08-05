// Backfill user_data top-level từ etsy.user_data cho các conversation mồ côi.
// Chạy: node _backfill-user-data.mjs          → dry-run (không ghi)
//       node _backfill-user-data.mjs apply    → ghi thật
import { MongoClient } from "mongodb";
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.production.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const APPLY = process.argv[2] === "apply";
const BACKUP = "C:/Users/admin/AppData/Local/Temp/claude/d--Pamo-dora-1/dada9658-91ca-4645-94e0-28c1c5a6ac98/scratchpad/orphan-backup.json";

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const coll = client.db(env.MONGODB_DB).collection("conversations");

const FILTER = { user_data: { $exists: false } };
const FIXABLE = { ...FILTER, "etsy.user_data.user_id": { $gt: 0 } };

const total = await coll.countDocuments(FILTER);
const fixable = await coll.countDocuments(FIXABLE);
console.log(`orphan tổng: ${total} | vá được từ etsy.user_data: ${fixable} | không vá được: ${total - fixable}`);

const targets = await coll
  .find(FIXABLE, { projection: { "etsy.conversation_id": 1, "etsy.user_data.user_id": 1, "etsy.user_data.shop_name": 1 } })
  .toArray();
fs.writeFileSync(BACKUP, JSON.stringify(targets, null, 1));
console.log(`đã lưu danh sách _id để rollback: ${BACKUP}`);

if (!APPLY) {
  console.log("\n[DRY-RUN] chưa ghi gì. Chạy lại với tham số 'apply' để thực thi.");
  await client.close();
  process.exit(0);
}

// Aggregation pipeline update: copy nguyên object etsy.user_data ra top-level.
const res = await coll.updateMany(FIXABLE, [{ $set: { user_data: "$etsy.user_data" } }]);
console.log(`\n[APPLY] matched=${res.matchedCount} modified=${res.modifiedCount}`);

console.log("orphan còn lại:", await coll.countDocuments(FILTER));
const bad = await coll.countDocuments({ "user_data.user_id": { $not: { $gt: 0 } } });
console.log("doc còn thiếu user_data.user_id hợp lệ:", bad);

await client.close();
