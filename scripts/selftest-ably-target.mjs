// Selftest pickTargetMember (lib/services/ably-target.ts) — không framework, không mạng.
// Chạy: node scripts/selftest-ably-target.mjs   (Node ≥ 22.18: type-stripping nạp thẳng file .ts)
// Bảng ca giống Go dora-backend services/ably_presence_test.go để 2 bên chọn client y hệt nhau.
import assert from "node:assert/strict";
import { memberCaps, pickTargetMember } from "../lib/services/ably-target.ts";

const ALL = ["claim_v2", "msg_queue", "tracking_v2"];
const oldA = { clientId: "oldA", data: { clientId: "oldA" } };
const newB = { clientId: "newB", data: { clientId: "newB", caps: ALL } };
const newC = { clientId: "newC", data: { clientId: "newC", caps: ["claim_v2"] } };
const oldD = { clientId: "oldD", data: { clientId: "oldD" } };

const cases = [
  ["rỗng → offline", [], "claim_v2", "", null],
  ["không yêu cầu cap → member cuối (hành vi cũ)", [newB, oldA], "", "", { clientId: "oldA", caps: [] }],
  ["có cap → member cuối trong số có cap", [newB, newC, oldD], "claim_v2", "", { clientId: "newC", caps: ["claim_v2"] }],
  ["chỉ 1 member có cap đứng đầu", [newB, oldA, oldD], "tracking_v2", "", { clientId: "newB", caps: ALL }],
  ["không ai có cap → member cuối", [oldA, oldD], "claim_v2", "", { clientId: "oldD", caps: [] }],
  ["prefer có mặt → chọn prefer dù không có cap", [oldA, newB], "claim_v2", "oldA", { clientId: "oldA", caps: [] }],
  ["prefer vắng → theo cap", [oldA, newB, oldD], "claim_v2", "gone", { clientId: "newB", caps: ALL }],
  ["data chuỗi JSON (REST thô) vẫn đọc được caps", [oldA, { clientId: "s", data: JSON.stringify({ caps: ["claim_v2"] }) }, oldD], "claim_v2", "", { clientId: "s", caps: ["claim_v2"] }],
  ["data hỏng coi như không cap", [newB, { clientId: "bad", data: "not-json" }], "claim_v2", "", { clientId: "newB", caps: ALL }],
  ["member cuối không có clientId → offline như cũ", [oldA, { data: {} }], "", "", null],
  ["caps lẫn kiểu lạ bị lọc", [{ clientId: "x", data: { caps: ["claim_v2", 1, null] } }], "claim_v2", "", { clientId: "x", caps: ["claim_v2"] }],
];

let failed = 0;
for (const [name, members, cap, prefer, want] of cases) {
  try {
    assert.deepEqual(pickTargetMember(members, cap, prefer), want);
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${name}\n${e.message}`);
  }
}
assert.deepEqual(memberCaps({ clientId: "z" }), []);

if (failed) {
  console.error(`\n${failed}/${cases.length} ca FAIL`);
  process.exit(1);
}
console.log(`\n${cases.length}/${cases.length} ca OK`);
