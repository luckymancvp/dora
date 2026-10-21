// Kiểm CAS order_messages (hợp đồng C2C4 §1.3–§1.5) trên dev server LOCAL — không Ably, không Etsy.
//
// Chạy (2 terminal), DB test riêng + ABLY_KEY rỗng để publish luôn trả "offline":
//   MONGODB_URI=mongodb://localhost:27017 MONGODB_DB=dora_c2c4_test ABLY_KEY= \
//   MERA_INTERNAL_API_KEY=c2c4-local-key AUTH_SECRET=c2c4-local-secret npx next dev -p 3917
//
//   BASE_URL=http://localhost:3917 MONGODB_URI=mongodb://localhost:27017 MONGODB_DB=dora_c2c4_test \
//   API_KEY=c2c4-local-key node scripts/c2c4-cas-check.mjs
//
// Script tự từ chối chạy nếu DB không bắt đầu bằng "dora_c2c4_test" hoặc Mongo không phải localhost.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";

const BASE = process.env.BASE_URL || "http://localhost:3917";
const URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB = process.env.MONGODB_DB || "";
const KEY = process.env.API_KEY || "";

if (!DB.startsWith("dora_c2c4_test")) throw new Error(`MONGODB_DB phải bắt đầu bằng dora_c2c4_test (đang: "${DB}")`);
if (!/^mongodb:\/\/(localhost|127\.0\.0\.1)[:/]/.test(URI)) throw new Error(`Chỉ chạy với Mongo localhost (đang: ${URI})`);
if (!KEY) throw new Error("Thiếu API_KEY (= MERA_INTERNAL_API_KEY của dev server)");

const client = new MongoClient(URI);
await client.connect();
const coll = client.db(DB).collection("order_messages");

async function seed(status, extra = {}) {
  const id = randomUUID();
  const now = new Date();
  await coll.insertOne({
    id, shop_name: "ZZTEST-C2C4", order_id: "4000000001", message: "hi", attachments: [],
    sender_email: "", status, created_at: now, updated_at: now, ...extra,
  });
  return id;
}
const doc = (id) => coll.findOne({ id });

async function call(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    redirect: "manual",
  });
  let data = null;
  try { data = await res.json(); } catch { /* không phải JSON */ }
  return { code: res.status, data };
}
const status = (id, body) => call("POST", `/v1/extension/order-messages/status/${id}`, body);
const cancel = (id, body = { reason: "check", actorEmail: "qa@local" }, key = KEY) =>
  call("POST", `/api/machine/order-messages/${id}/cancel`, body, key ? { "x-api-key": key } : {});

const results = [];
async function check(name, fn) {
  try { await fn(); results.push([true, name]); console.log(`ok   ${name}`); }
  catch (e) { results.push([false, name]); console.error(`FAIL ${name}\n     ${e.message}`); }
}

// --- Bảng §1.3 (route công khai extension) ---
const table = [
  // [tên, hiện tại, extra, body, code, status trả về, already, late_done, status DB]
  ["claim NEW", "NEW", {}, { status: "SENDING", client_id: "c1" }, 200, "SENDING", false, false, "SENDING"],
  ["claim NEW không client_id", "NEW", {}, { status: "SENDING" }, 200, "SENDING", false, false, "SENDING"],
  ["claim lặp cùng client", "SENDING", { claimed_by: "c1" }, { status: "SENDING", client_id: "c1" }, 200, "SENDING", true, false, "SENDING"],
  ["claim SENDING client khác", "SENDING", { claimed_by: "c1" }, { status: "SENDING", client_id: "c2" }, 409, "SENDING", false, false, "SENDING"],
  ["claim DONE", "DONE", {}, { status: "SENDING", client_id: "c1" }, 409, "DONE", false, false, "DONE"],
  ["claim FAILED", "FAILED", {}, { status: "SENDING", client_id: "c1" }, 409, "FAILED", false, false, "FAILED"],
  ["claim CANCELLED", "CANCELLED", {}, { status: "SENDING", client_id: "c1" }, 409, "CANCELLED", false, false, "CANCELLED"],
  ["DONE+convo NEW", "NEW", {}, { status: "DONE", convo_id: 555 }, 200, "DONE", false, false, "DONE"],
  ["DONE+convo SENDING", "SENDING", {}, { status: "DONE", convo_id: 555 }, 200, "DONE", false, false, "DONE"],
  ["DONE+convo DONE", "DONE", {}, { status: "DONE", convo_id: 555 }, 200, "DONE", true, false, "DONE"],
  ["DONE+convo FAILED → late", "FAILED", {}, { status: "DONE", convo_id: 555 }, 200, "DONE", false, true, "DONE"],
  ["DONE+convo CANCELLED → late", "CANCELLED", {}, { status: "DONE", convo_id: 555 }, 200, "DONE", false, true, "DONE"],
  ["DONE không convo NEW (extension cũ không claim)", "NEW", {}, { status: "DONE" }, 200, "DONE", false, false, "DONE"],
  ["DONE không convo SENDING", "SENDING", {}, { status: "DONE" }, 200, "DONE", false, false, "DONE"],
  ["DONE không convo DONE", "DONE", {}, { status: "DONE" }, 200, "DONE", true, false, "DONE"],
  ["DONE không convo FAILED", "FAILED", {}, { status: "DONE" }, 409, "FAILED", false, false, "FAILED"],
  ["DONE không convo CANCELLED", "CANCELLED", {}, { status: "DONE", convo_id: 0 }, 409, "CANCELLED", false, false, "CANCELLED"],
  ["FAILED NEW", "NEW", {}, { status: "FAILED", error: "upload failed" }, 200, "FAILED", false, false, "FAILED"],
  ["FAILED SENDING", "SENDING", {}, { status: "FAILED", error: "upload failed" }, 200, "FAILED", false, false, "FAILED"],
  ["FAILED DONE", "DONE", {}, { status: "FAILED" }, 409, "DONE", false, false, "DONE"],
  ["FAILED FAILED", "FAILED", {}, { status: "FAILED" }, 200, "FAILED", true, false, "FAILED"],
  ["FAILED CANCELLED", "CANCELLED", {}, { status: "FAILED" }, 409, "CANCELLED", false, false, "CANCELLED"],
];
for (const [name, cur, extra, body, code, st, already, late, dbSt] of table) {
  await check(`§1.3 ${name}`, async () => {
    const id = await seed(cur, extra);
    const r = await status(id, body);
    assert.equal(r.code, code, JSON.stringify(r.data));
    assert.equal(r.data?.status, st);
    assert.equal(r.data?.ok, code === 200);
    if (code === 409) assert.equal(r.data?.code, "invalid_transition");
    assert.equal(r.data?.already === true, already);
    assert.equal(r.data?.late_done === true, late);
    const d = await doc(id);
    assert.equal(d.status, dbSt);
    if (code === 200 && !already && dbSt === "DONE") {
      assert.equal(d.done_from, cur);
      assert.equal(d.late_done === true, late);
      if (body.convo_id) assert.equal(d.convo_id, body.convo_id);
    }
    if (code === 200 && !already && dbSt === "SENDING") {
      assert.ok(d.claimed_at instanceof Date);
      if (body.client_id) assert.equal(d.claimed_by, body.client_id);
    }
    if (code === 200 && !already && dbSt === "FAILED") assert.equal(d.error, "upload failed");
    if (code === 409 && extra.claimed_by) assert.equal(r.data?.claimed_by, extra.claimed_by);
  });
}

await check("không có doc → 404 not_found", async () => {
  for (const b of [{ status: "SENDING", client_id: "c1" }, { status: "DONE", convo_id: 1 }, { status: "FAILED" }]) {
    const r = await status(randomUUID(), b);
    assert.equal(r.code, 404);
    assert.equal(r.data?.code, "not_found");
  }
});
await check("NEW/CANCELLED/lạ qua route công khai → 400 invalid_status, DB không đổi", async () => {
  const id = await seed("SENDING", { claimed_by: "c1" });
  for (const s of ["NEW", "CANCELLED", "WHATEVER"]) {
    const r = await status(id, { status: s });
    assert.equal(r.code, 400, s);
    assert.equal(r.data?.code, "invalid_status");
  }
  assert.equal((await doc(id)).status, "SENDING");
  const r = await status(id, {});
  assert.equal(r.code, 400);
  assert.equal(r.data?.code, "invalid_status");
});
await check("body hỏng → 400 invalid_body", async () => {
  const r = await status(await seed("NEW"), "{not json");
  assert.equal(r.code, 400);
  assert.equal(r.data?.code, "invalid_body");
});
await check("10 tab claim cùng lúc → đúng 1 thắng", async () => {
  const id = await seed("NEW");
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => status(id, { status: "SENDING", client_id: `tab${i}` })));
  const codes = rs.map((r) => r.code);
  assert.equal(codes.filter((c) => c === 200).length, 1, codes.join(","));
  assert.equal(codes.filter((c) => c === 409).length, 9, codes.join(","));
});

// --- Route huỷ §1.4 ---
await check("huỷ: thiếu x-api-key → proxy chặn (307 /login), sai key → 401; DB không đổi", async () => {
  const id = await seed("NEW");
  assert.equal((await cancel(id, {}, "")).code, 307);
  assert.equal((await cancel(id, {}, "sai")).code, 401);
  assert.equal((await doc(id)).status, "NEW");
});
await check("huỷ NEW → CANCELLED; lặp → already; claim sau đó 409; late DONE 200; huỷ sau DONE 409", async () => {
  const id = await seed("NEW");
  let r = await cancel(id);
  assert.equal(r.code, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data, { ok: true, id, status: "CANCELLED" });
  const d = await doc(id);
  assert.equal(d.status, "CANCELLED");
  assert.equal(d.cancelled_by, "qa@local");
  assert.ok(d.cancelled_at instanceof Date);
  r = await cancel(id);
  assert.equal(r.code, 200);
  assert.equal(r.data?.already, true);
  r = await status(id, { status: "SENDING", client_id: "c1" });
  assert.equal(r.code, 409);
  assert.equal(r.data?.status, "CANCELLED");
  r = await status(id, { status: "DONE", convo_id: 777 });
  assert.equal(r.code, 200);
  assert.equal(r.data?.late_done, true);
  r = await cancel(id);
  assert.equal(r.code, 409);
  assert.equal(r.data?.code, "invalid_transition");
  assert.equal(r.data?.status, "DONE");
});
await check("huỷ: body rỗng vẫn được, cancelled_by mặc định 'mera'", async () => {
  const id = await seed("NEW");
  const r = await call("POST", `/api/machine/order-messages/${id}/cancel`, undefined, { "x-api-key": KEY });
  assert.equal(r.code, 200, JSON.stringify(r.data));
  assert.equal((await doc(id)).cancelled_by, "mera");
});
for (const st of ["SENDING", "DONE", "FAILED"]) {
  await check(`huỷ từ ${st} → 409 kèm status`, async () => {
    const id = await seed(st);
    const r = await cancel(id);
    assert.equal(r.code, 409);
    assert.equal(r.data?.ok, false);
    assert.equal(r.data?.code, "invalid_transition");
    assert.equal(r.data?.status, st);
    assert.equal((await doc(id)).status, st);
  });
}
await check("huỷ id không có → 404 not_found", async () => {
  const r = await cancel(randomUUID());
  assert.equal(r.code, 404);
  assert.equal(r.data?.code, "not_found");
});

// --- GET status (x-api-key) §1.5 ---
await check("GET /api/orders/message/status/:id trả field mới", async () => {
  const id = await seed("NEW", { after_id: "prev-1", target_client_id: "c9", target_caps: ["claim_v2", "msg_queue"] });
  await status(id, { status: "FAILED", error: "x" });
  await status(id, { status: "DONE", convo_id: 4242 });
  const r = await call("GET", `/api/orders/message/status/${id}`, undefined, { "x-api-key": KEY });
  assert.equal(r.code, 200, JSON.stringify(r.data));
  const s = r.data;
  assert.equal(s.id, id);
  assert.equal(s.status, "DONE");
  assert.equal(s.convoId, 4242);
  assert.equal(s.orderId, "4000000001");
  assert.equal(s.targetClientId, "c9");
  assert.deepEqual(s.targetCaps, ["claim_v2", "msg_queue"]);
  assert.equal(s.afterId, "prev-1");
  assert.equal(s.lateDone, true);
  assert.ok(!Number.isNaN(Date.parse(s.createdAt)) && !Number.isNaN(Date.parse(s.updatedAt)));
  const old = await seed("NEW");
  const r2 = await call("GET", `/api/orders/message/status/${old}`, undefined, { "x-api-key": KEY });
  assert.deepEqual(r2.data.targetCaps, []);
  assert.equal(r2.data.targetClientId, "");
  assert.equal(r2.data.lateDone, false);
});

// --- POST /api/orders/message (ABLY_KEY rỗng ⇒ luôn shop_offline, không publish gì) ---
await check("POST /api/orders/message: afterId lưu vào doc, offline → 409 shop_offline + doc FAILED", async () => {
  const r = await call("POST", "/api/orders/message",
    { shopName: "ZZTEST-C2C4", orderId: "4000000002", message: "hi", afterId: "prev-xyz", preferClientId: "c1" },
    { "x-api-key": KEY });
  assert.equal(r.code, 409, JSON.stringify(r.data));
  assert.equal(r.data?.code, "shop_offline");
  const d = await coll.findOne({ order_id: "4000000002" }, { sort: { created_at: -1 } });
  assert.equal(d.status, "FAILED");
  assert.equal(d.error, "shop_offline");
  assert.equal(d.after_id, "prev-xyz");
});

// --- Bằng chứng DONE muộn lấy từ BODY (convo_id), không từ doc ---
await check("DONE muộn: convo_id phải ở BODY và là số/chuỗi số; doc có convo_id cũng không tính", async () => {
  const a = await seed("FAILED", { convo_id: 999 });
  let r = await status(a, { status: "DONE" });
  assert.equal(r.code, 409, "doc có convo_id nhưng body không có → không phải bằng chứng");
  r = await status(a, { status: "DONE", convo_id: true });
  assert.equal(r.code, 409, "convo_id=true không phải bằng chứng");
  r = await status(a, { status: "DONE", convo_id: "12ab" });
  assert.equal(r.code, 409, "chuỗi lẫn chữ không phải bằng chứng");
  r = await status(a, { status: "DONE", convo_id: "4242" });
  assert.equal(r.code, 200, JSON.stringify(r.data));
  assert.equal(r.data?.late_done, true);
  assert.equal((await doc(a)).convo_id, 4242);
});

// --- Bổ sung R-ext2: callback tracking lặp/muộn (outbox extension gửi lại) ---
const jobs = client.db(DB).collection("tracking_jobs");
const tOrder = (id, extra = {}) => ({
  order_id: id, tracking_number: `TRK${id}`, carrier: -1, other_carrier: "USPS",
  precheck: "CLEAR", selected: true, add_status: "NEW", verify: "PENDING", ...extra,
});
async function seedJob(phase, orders) {
  const r = await jobs.insertOne({
    shop_name: "ZZTEST-C2C4", shop_id: null, client_id: "c1", sender_email: "",
    phase, orders, created_at: new Date(), updated_at: new Date(),
  });
  return r.insertedId;
}
const tstatus = (oid, body) => call("POST", `/v1/extension/trackings/status/${oid.toHexString()}`, body);
const strip = (j) => ({ phase: j.phase, orders: j.orders });

await check("R-ext2: DONE/FAILED/SENDING lặp khi job đang VERIFY → already, không đổi dữ liệu", async () => {
  const oid = await seedJob("VERIFY", [tOrder("1", { add_status: "DONE" }), tOrder("2", { add_status: "DONE" })]);
  const before = strip(await jobs.findOne({ _id: oid }));
  for (const st of ["DONE", "FAILED", "SENDING", "CANCELLED"]) {
    const r = await tstatus(oid, { status: st, tracking: { total: 2, sent: 2, failed: 0, results: [] } });
    assert.equal(r.code, 200, st);
    assert.deepEqual(r.data, { ok: true, already: true, phase: "VERIFY" }, st);
  }
  assert.deepEqual(strip(await jobs.findOne({ _id: oid })), before, "job bị đổi");
});
await check("R-ext2: callback khi job COMPLETED → already, không đổi", async () => {
  const oid = await seedJob("COMPLETED", [tOrder("1", { add_status: "DONE", verify: "VERIFIED" })]);
  const before = strip(await jobs.findOne({ _id: oid }));
  for (const st of ["DONE", "FAILED", "SENDING"]) {
    const r = await tstatus(oid, { status: st });
    assert.deepEqual(r.data, { ok: true, already: true, phase: "COMPLETED" }, st);
  }
  assert.deepEqual(strip(await jobs.findOne({ _id: oid })), before);
});
await check("R-ext2: QUEUED/PROGRESS/CANCELLED/lạ khi ADDING → {ok:false} 200, không đổi", async () => {
  const oid = await seedJob("ADDING", [tOrder("1"), tOrder("2")]);
  const before = strip(await jobs.findOne({ _id: oid }));
  for (const body of [
    { status: "QUEUED", client_id: "c1", ahead: 3 },
    { status: "PROGRESS", tracking: { total: 2, done: 1, sent: 1, failed: 0, results: [{ order_id: "1", ok: true }] } },
    { status: "CANCELLED", reason: "cancel-tracking", tracking: { total: 2, done: 0, sent: 0, failed: 0, results: [] } },
    { status: "WHATEVER" },
  ]) {
    const r = await tstatus(oid, body);
    assert.equal(r.code, 200, body.status);
    assert.deepEqual(r.data, { ok: false }, body.status);
  }
  assert.deepEqual(strip(await jobs.findOne({ _id: oid })), before);
  const r = await call("POST", `/v1/extension/trackings/status/${randomUUID()}`, { status: "DONE" });
  assert.deepEqual(r.data, { ok: false }, "id lạ (vd tracking của Mera)");
});
await check("R-ext2: SENDING → DONE (offline, không verify được) → DONE lặp = already, verify giữ nguyên", async () => {
  const oid = await seedJob("ADDING", [tOrder("1"), tOrder("2"), tOrder("3", { selected: false, verify: "SKIPPED" })]);
  let r = await tstatus(oid, { status: "SENDING", client_id: "c1" });
  assert.deepEqual(r.data, { ok: true });
  let j = await jobs.findOne({ _id: oid });
  assert.equal(j.phase, "ADDING");
  assert.deepEqual(j.orders.map((o) => o.add_status), ["SENDING", "SENDING", "NEW"]);
  // ABLY_KEY rỗng ⇒ publish fetch-shipments trả null ⇒ nhánh "shop offline" → COMPLETED.
  r = await tstatus(oid, { status: "DONE", tracking: { total: 2, sent: 2, failed: 0, results: [] } });
  assert.deepEqual(r.data, { ok: true });
  j = await jobs.findOne({ _id: oid });
  assert.equal(j.phase, "COMPLETED");
  assert.deepEqual(j.orders.map((o) => [o.add_status, o.verify]), [["DONE", "SKIPPED"], ["DONE", "SKIPPED"], ["NEW", "SKIPPED"]]);
  const before = strip(j);
  r = await tstatus(oid, { status: "DONE" });
  assert.deepEqual(r.data, { ok: true, already: true, phase: "COMPLETED" });
  assert.deepEqual(strip(await jobs.findOne({ _id: oid })), before);
});
await check("R-ext2: 6 DONE song song khi ADDING → đúng 1 áp dụng, còn lại already", async () => {
  const oid = await seedJob("ADDING", [tOrder("1", { add_status: "SENDING" })]);
  const rs = await Promise.all(Array.from({ length: 6 }, () => tstatus(oid, { status: "DONE" })));
  const applied = rs.filter((r) => r.data?.ok === true && !r.data?.already).length;
  const already = rs.filter((r) => r.data?.already === true).length;
  assert.equal(applied, 1, JSON.stringify(rs.map((r) => r.data)));
  assert.equal(already, 5);
  const j = await jobs.findOne({ _id: oid });
  assert.equal(j.phase, "COMPLETED");
  assert.equal(j.orders[0].add_status, "DONE");
});
await check("R-ext2: FAILED khi ADDING → COMPLETED; FAILED/DONE lặp → already", async () => {
  const oid = await seedJob("ADDING", [tOrder("1", { add_status: "SENDING" })]);
  let r = await tstatus(oid, { status: "FAILED", error: "boom" });
  assert.deepEqual(r.data, { ok: true });
  const j = await jobs.findOne({ _id: oid });
  assert.equal(j.phase, "COMPLETED");
  assert.deepEqual([j.orders[0].add_status, j.orders[0].verify], ["FAILED", "SKIPPED"]);
  for (const st of ["FAILED", "DONE"]) {
    r = await tstatus(oid, { status: st });
    assert.deepEqual(r.data, { ok: true, already: true, phase: "COMPLETED" }, st);
  }
  assert.equal((await jobs.findOne({ _id: oid })).orders[0].add_status, "FAILED");
});

// --- QA C2 D3: FAILED giữa chừng (watchdog "stalled") kèm tracking.results ---
const STALLED = "stalled: no order finished in 120s";
const ord = (j, id) => j.orders.find((o) => o.order_id === id);
await check("D3: FAILED stalled kèm results → ok:true đi verify, ok:false FAILED, đơn ngoài results KHÔNG FAILED (unreported); lặp → already", async () => {
  const oid = await seedJob("ADDING", [
    tOrder("1", { add_status: "SENDING" }), tOrder("2", { add_status: "SENDING" }),
    tOrder("3", { add_status: "SENDING" }), tOrder("4", { add_status: "SENDING" }),
    tOrder("5", { selected: false, verify: "SKIPPED" }),
  ]);
  let r = await tstatus(oid, {
    status: "FAILED", error: STALLED,
    tracking: { total: 4, done: 2, sent: 1, failed: 1, results: [
      { order_id: "1", ok: true }, { order_id: "2", ok: false, error: "HTTP 400 - Invalid tracking number" },
    ] },
  });
  assert.deepEqual(r.data, { ok: true });
  // ABLY_KEY rỗng ⇒ publish fetch-shipments (verify) trả null ⇒ nhánh offline → COMPLETED.
  const j = await jobs.findOne({ _id: oid });
  assert.equal(j.phase, "COMPLETED");
  assert.deepEqual([ord(j, "1").add_status, ord(j, "1").verify, ord(j, "1").unreported], ["DONE", "SKIPPED", undefined]);
  assert.equal(ord(j, "1").message, "Đã add nhưng không verify được (shop offline)");
  assert.deepEqual([ord(j, "2").add_status, ord(j, "2").verify], ["FAILED", "SKIPPED"]);
  assert.match(ord(j, "2").message, /Invalid tracking number/);
  for (const id of ["3", "4"]) {
    const o = ord(j, id);
    assert.notEqual(o.add_status, "FAILED", `đơn ${id} không có trong results không được FAILED`);
    assert.deepEqual([o.add_status, o.verify, o.unreported], ["DONE", "SKIPPED", STALLED], id);
    assert.match(o.message, /^Chưa xác nhận/, id);
    assert.match(o.message, /stalled/, id);
  }
  assert.deepEqual([ord(j, "5").add_status, ord(j, "5").verify], ["NEW", "SKIPPED"]);
  const before = strip(j);
  for (const st of ["FAILED", "DONE"]) {
    r = await tstatus(oid, { status: st, error: STALLED, tracking: { total: 4, done: 0, results: [] } });
    assert.deepEqual(r.data, { ok: true, already: true, phase: "COMPLETED" }, st);
  }
  assert.deepEqual(strip(await jobs.findOne({ _id: oid })), before, "lặp làm đổi job");
});
await check("D3: watchdog treo ở đơn đầu (results rỗng) → mọi đơn unreported, không đơn nào FAILED", async () => {
  const oid = await seedJob("ADDING", [tOrder("1", { add_status: "SENDING" }), tOrder("2", { add_status: "SENDING" })]);
  const r = await tstatus(oid, { status: "FAILED", error: STALLED, tracking: { total: 2, done: 0, sent: 0, failed: 0, results: [] } });
  assert.deepEqual(r.data, { ok: true });
  const j = await jobs.findOne({ _id: oid });
  assert.deepEqual(j.orders.map((o) => [o.add_status, o.verify, o.unreported]), [["DONE", "SKIPPED", STALLED], ["DONE", "SKIPPED", STALLED]]);
});
await check("D3: FAILED 'all orders failed' (mọi đơn ok:false) → cả lô FAILED, không verify", async () => {
  const oid = await seedJob("ADDING", [tOrder("1", { add_status: "SENDING" }), tOrder("2", { add_status: "SENDING" })]);
  const r = await tstatus(oid, { status: "FAILED", error: "all orders failed", tracking: { total: 2, done: 2, sent: 0, failed: 2, results: [
    { order_id: "1", ok: false, error: "e1" }, { order_id: "2", ok: false, error: "e2" },
  ] } });
  assert.deepEqual(r.data, { ok: true });
  const j = await jobs.findOne({ _id: oid });
  assert.equal(j.phase, "COMPLETED");
  assert.deepEqual(j.orders.map((o) => [o.add_status, o.verify, o.message]), [
    ["FAILED", "SKIPPED", "Extension báo add thất bại: e1"], ["FAILED", "SKIPPED", "Extension báo add thất bại: e2"],
  ]);
});
await check("D3: 6 FAILED-kèm-results song song → đúng 1 áp dụng, còn lại already", async () => {
  const oid = await seedJob("ADDING", [tOrder("1", { add_status: "SENDING" }), tOrder("2", { add_status: "SENDING" })]);
  const body = { status: "FAILED", error: STALLED, tracking: { total: 2, done: 1, results: [{ order_id: "1", ok: true }] } };
  const rs = await Promise.all(Array.from({ length: 6 }, () => tstatus(oid, body)));
  assert.equal(rs.filter((r) => r.data?.ok === true && !r.data?.already).length, 1, JSON.stringify(rs.map((r) => r.data)));
  assert.equal(rs.filter((r) => r.data?.already === true).length, 5);
  const j = await jobs.findOne({ _id: oid });
  assert.deepEqual(j.orders.map((o) => [o.add_status, o.unreported]), [["DONE", undefined], ["DONE", STALLED]]);
});
await check("D3: verify đơn unreported — Etsy có mã → VERIFIED; mã khác / không có → SKIPPED 'Chưa xác nhận' (không NOT_FOUND/CODE_MISMATCH); đơn thường vẫn NOT_FOUND", async () => {
  const oid = await seedJob("VERIFY", [
    tOrder("a", { add_status: "DONE", unreported: STALLED }), tOrder("b", { add_status: "DONE", unreported: STALLED }),
    tOrder("c", { add_status: "DONE", unreported: STALLED }), tOrder("d", { add_status: "DONE" }),
  ]);
  const r = await call("POST", "/v1/extension/trackings/shipments-result", {
    id: oid.toHexString(),
    shipments: [
      { order_id: "a", tracking_code: "TRKa", carrier_name: "USPS" },
      { order_id: "b", tracking_code: "OTHER-B", carrier_name: "UPS" },
    ],
  });
  assert.equal(r.code, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data, { ok: true });
  const j = await jobs.findOne({ _id: oid });
  assert.equal(j.phase, "COMPLETED");
  assert.equal(ord(j, "a").verify, "VERIFIED");
  assert.equal(ord(j, "b").verify, "SKIPPED");
  assert.match(ord(j, "b").message, /^Chưa xác nhận.*OTHER-B/);
  assert.equal(ord(j, "b").verified?.code, "OTHER-B");
  assert.equal(ord(j, "c").verify, "SKIPPED");
  assert.match(ord(j, "c").message, /^Chưa xác nhận/);
  assert.equal(ord(j, "d").verify, "NOT_FOUND");
});

await client.close();
const bad = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - bad}/${results.length} OK`);
process.exit(bad ? 1 : 0);
