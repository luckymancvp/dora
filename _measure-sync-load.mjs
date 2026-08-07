// Read-only: đo tải thật của luồng sync để đánh giá phương án tối ưu.
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

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const db = client.db(env.MONGODB_DB);
const conv = db.collection("conversations");
const msgs = db.collection("messages");

const DAYS = 60;
const since = new Date(Date.now() - DAYS * 86400_000);

console.log("=== 1. Conversation TẠO MỚI mỗi ngày, theo shop (top ngày cao nhất) ===");
const perDay = await conv
  .aggregate([
    { $match: { created_at: { $gte: since } } },
    {
      $group: {
        _id: {
          shop: "$user_data.shop_name",
          day: { $dateToString: { date: "$created_at", format: "%Y-%m-%d" } },
        },
        n: { $sum: 1 },
      },
    },
    { $sort: { n: -1 } },
    { $limit: 12 },
  ])
  .toArray();
for (const r of perDay) console.log(`  ${r._id.day}  ${String(r._id.shop).padEnd(22)} ${r.n}`);

console.log("\n=== 2. Tổng conversation mới / ngày (toàn hệ thống), 14 ngày gần nhất ===");
const totalPerDay = await conv
  .aggregate([
    { $match: { created_at: { $gte: new Date(Date.now() - 14 * 86400_000) } } },
    { $group: { _id: { $dateToString: { date: "$created_at", format: "%Y-%m-%d" } }, n: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ])
  .toArray();
for (const r of totalPerDay) console.log(`  ${r._id}  ${r.n}`);

console.log("\n=== 3. MESSAGE mới theo GIỜ trong ngày (UTC), 14 ngày gần nhất ===");
const perHour = await msgs
  .aggregate([
    { $match: { created_at: { $gte: new Date(Date.now() - 14 * 86400_000) } } },
    { $group: { _id: { $hour: "$created_at" }, n: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ])
  .toArray();
const maxH = Math.max(...perHour.map((r) => r.n), 1);
for (const r of perHour) {
  const perTick = r.n / 14 / 360; // 360 tick 10s mỗi giờ
  console.log(
    `  ${String(r._id).padStart(2, "0")}h ${"█".repeat(Math.round((r.n / maxH) * 40)).padEnd(40)} ${String(r.n).padStart(5)}  → ${(perTick * 100).toFixed(1)}% tick có tin`,
  );
}

console.log("\n=== 4. Giờ CAO ĐIỂM nhất từng ghi nhận (message/giờ, theo shop) ===");
const peak = await msgs
  .aggregate([
    { $match: { created_at: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { date: "$created_at", format: "%Y-%m-%d %H" } },
        n: { $sum: 1 },
      },
    },
    { $sort: { n: -1 } },
    { $limit: 8 },
  ])
  .toArray();
for (const r of peak) console.log(`  ${r._id}h  ${r.n} message  → ${(r.n / 360).toFixed(2)} msg/tick`);

console.log("\n=== 5. Số shop hoạt động (có conversation cập nhật trong 24h) ===");
const activeShops = await conv.distinct("user_data.shop_name", {
  updated_at: { $gte: new Date(Date.now() - 86400_000) },
});
console.log("  ", activeShops.length, "shop:", activeShops.filter(Boolean).join(", "));

console.log("\n=== 6. Unread THEO CHUẨN ETSY (chưa mở) hiện tại — liên quan bug length===20 ===");
// Xấp xỉ: hội thoại chưa trả lời là cận dưới của unread Etsy.
const unreadNow = await conv
  .aggregate([
    { $match: { "etsy.has_replied": false, tags: { $nin: ["handled", "approved"] } } },
    { $group: { _id: "$user_data.shop_name", n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 15 },
  ])
  .toArray();
for (const r of unreadNow) {
  console.log(`  ${String(r._id).padEnd(22)} ${String(r.n).padStart(4)} ${r.n >= 20 ? "  ⚠️ >= 20" : ""}`);
}

console.log("\n=== 7. Backlog: hội thoại chưa trả lời CŨ hơn 24h (đo khả năng bắt kịp) ===");
const cutoff = Math.floor(Date.now() / 1000) - 86400;
console.log(
  "  ",
  await conv.countDocuments({
    "etsy.has_replied": false,
    tags: { $nin: ["handled", "approved"] },
    lastMessageDate: { $lt: cutoff },
  }),
  "hội thoại",
);

await client.close();
