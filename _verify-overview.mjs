// Read-only: mô phỏng logic MỚI của getMessageOverview và so với getTagsOverview.
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

const HANDLED_TAGS = ["handled", "approved"];
const UNREAD_EXPR = {
  $and: [
    { $eq: ["$etsy.has_replied", false] },
    { $eq: [{ $size: { $setIntersection: [{ $ifNull: ["$tags", []] }, HANDLED_TAGS] } }, 0] },
  ],
};

const days = process.argv[2] ? Number(process.argv[2]) : 7;
const from = Math.floor(Date.now() / 1000) - days * 86400;
const base = { lastMessageDate: { $gte: from } };

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const coll = client.db(env.MONGODB_DB).collection("conversations");

const [tagsTotals] = await coll
  .aggregate([
    { $match: base },
    { $group: { _id: null, total: { $sum: 1 }, unread: { $sum: { $cond: [UNREAD_EXPR, 1, 0] } } } },
  ])
  .toArray();

const counts = await coll
  .aggregate([
    { $match: base },
    {
      $group: {
        _id: "$user_data.user_id",
        total: { $sum: 1 },
        unread: { $sum: { $cond: [UNREAD_EXPR, 1, 0] } },
      },
    },
  ])
  .toArray();

const valid = (v) => typeof v === "number" && v > 0;
const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
const shopRows = counts.filter((r) => valid(r._id));
const unknownRows = counts.filter((r) => !valid(r._id));

const oldTotals = { total: sum(shopRows, "total"), unread: sum(shopRows, "unread") };
const newTotals = {
  total: oldTotals.total + sum(unknownRows, "total"),
  unread: oldTotals.unread + sum(unknownRows, "unread"),
};

console.log(`Cửa sổ ${days} ngày:`);
console.log("  Panel Tag            :", { total: tagsTotals.total, unread: tagsTotals.unread });
console.log("  Panel tin nhắn (CŨ)  :", oldTotals);
console.log("  Panel tin nhắn (MỚI) :", newTotals);
console.log("  Dòng 'Chưa xác định shop':", {
  total: sum(unknownRows, "total"),
  unread: sum(unknownRows, "unread"),
});
const ok = newTotals.total === tagsTotals.total && newTotals.unread === tagsTotals.unread;
console.log(ok ? "\n✅ KHỚP: 2 panel bằng nhau." : "\n❌ VẪN LỆCH");

await client.close();
