// Chọn browser extension để đẩy lệnh theo presence — logic THUẦN, không import gì để chạy được
// bằng `node` (type-stripping) trong selftest. Luật giống hệt dora-backend
// services.PickFromPresence và Mera admin (hợp đồng C2C4 §1.1):
//   1. preferClientId có trong presence → chọn nó (lô sau của cùng đơn về đúng tab lô 1);
//   2. có member mang requiredCap → member CUỐI trong số đó;
//   3. không ai có → member cuối cả danh sách (hành vi cũ);
//   4. rỗng → null (offline).
// requiredCap rỗng = hành vi cũ (member cuối).

/** Member presence tối thiểu cần đọc (Ably PresenceMessage có thừa field khác). */
export interface PresenceMemberLike {
  clientId?: string | null;
  data?: unknown;
}

export interface TargetPick {
  clientId: string;
  /** Cap extension khai trong presence; [] = extension cũ. */
  caps: string[];
}

/** Cap trong data presence `{clientId, caps}`; data là object (SDK đã decode) hoặc chuỗi JSON. */
export function memberCaps(m: PresenceMemberLike): string[] {
  let data: unknown = m.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return [];
    }
  }
  if (!data || typeof data !== "object") return [];
  const caps = (data as { caps?: unknown }).caps;
  return Array.isArray(caps) ? caps.filter((c): c is string => typeof c === "string") : [];
}

export function pickTargetMember(
  members: readonly PresenceMemberLike[],
  requiredCap = "",
  preferClientId = "",
): TargetPick | null {
  if (members.length === 0) return null;

  if (preferClientId) {
    for (let i = members.length - 1; i >= 0; i--) {
      if (members[i].clientId === preferClientId) {
        return { clientId: preferClientId, caps: memberCaps(members[i]) };
      }
    }
  }

  if (requiredCap) {
    for (let i = members.length - 1; i >= 0; i--) {
      const m = members[i];
      const caps = memberCaps(m);
      if (m.clientId && caps.includes(requiredCap)) return { clientId: m.clientId, caps };
    }
  }

  // Hành vi cũ: client cuối; client cuối không có clientId thì coi như offline (như trước).
  const last = members[members.length - 1];
  if (!last.clientId) return null;
  return { clientId: last.clientId, caps: memberCaps(last) };
}
