/**
 * Backfill has_replied cho các hội thoại bị kẹt ở "Chưa trả lời".
 *
 * Nguyên nhân: logic cũ coi MỌI message_flags != 0 là auto-reply. Thực tế chỉ bit 2
 * mới là auto-reply; bit 128 (tin vừa gửi / khách chưa đọc) vẫn là tin thật của shop.
 *
 * Script chỉ lật false -> true (đúng chiều bug), không đụng hội thoại khác.
 * Mặc định DRY RUN. Ghi thật: node _backfill-has-replied.mjs --apply
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';

const APPLY = process.argv.includes('--apply');
const ENV_FILE = process.env.ENV_FILE || '.env.production.local';
const AUTO_REPLY_FLAG = 2;

const env = Object.fromEntries(
  fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; })
);

const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
await client.connect();
const conv = client.db(env.MONGODB_DB).collection('conversations');

const cursor = conv.find(
  { 'etsy.has_replied': false },
  { projection: { 'etsy.conversation_id': 1, 'etsy.detail.messages': 1, 'user_data.user_id': 1, 'etsy.user_data.user_id': 1 } },
);

let scanned = 0, toFix = [];
for await (const d of cursor) {
  scanned++;
  const shopId = d.user_data?.user_id ?? d.etsy?.user_data?.user_id;
  if (typeof shopId !== 'number' || shopId <= 0) continue;

  const msgs = d.etsy?.detail?.messages;
  if (!Array.isArray(msgs) || msgs.length === 0) continue;
  const last = msgs[msgs.length - 1];
  if (!last || typeof last !== 'object') continue;

  if (last.is_system_message === true || last.type === 'system') continue;
  if (last.sender_id !== shopId) continue;
  const flags = Number(last.message_flags ?? 0);
  if ((flags & AUTO_REPLY_FLAG) !== 0) continue;

  toFix.push({ _id: d._id, cid: d.etsy?.conversation_id, flags });
}

const byFlag = {};
for (const f of toFix) byFlag[f.flags] = (byFlag[f.flags] || 0) + 1;
console.log(`DB=${env.MONGODB_DB}  quét ${scanned} hội thoại has_replied=false`);
console.log(`→ cần sửa thành has_replied=true: ${toFix.length}`);
console.log('   phân bố message_flags:', byFlag);
console.log('   ví dụ conversation_id:', toFix.slice(0, 10).map(f => f.cid).join(', '));

if (!APPLY) {
  console.log('\nDRY RUN — chưa ghi gì. Chạy lại với --apply để cập nhật.');
} else if (toFix.length > 0) {
  const ops = toFix.map(f => ({
    updateOne: { filter: { _id: f._id }, update: { $set: { 'etsy.has_replied': true, updated_at: new Date() } } },
  }));
  let modified = 0;
  for (let i = 0; i < ops.length; i += 500) {
    const res = await conv.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    modified += res.modifiedCount;
  }
  console.log(`\nĐÃ CẬP NHẬT ${modified} hội thoại.`);
}

await client.close();
