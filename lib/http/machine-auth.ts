import { createHash, timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";

/**
 * true khi request mang header x-api-key khớp MERA_INTERNAL_API_KEY (máy gọi máy: Mera).
 * So sánh an toàn thời gian: băm SHA-256 cả hai vế cho cùng độ dài rồi timingSafeEqual,
 * để thời gian phản hồi không lộ key đúng tới ký tự thứ mấy. Env thiếu → luôn false.
 */
export function hasMachineApiKey(req: NextRequest): boolean {
  const expected = process.env.MERA_INTERNAL_API_KEY?.trim();
  const got = req.headers.get("x-api-key")?.trim();
  if (!expected || !got) return false;
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Đọc body JSON dạng object; body hỏng/không phải object → null (route trả 400 thay vì 500). */
export async function readJsonObject(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Như readJsonObject nhưng body rỗng hợp lệ → {} (route có body tuỳ chọn). Hỏng → null. */
export async function readOptionalJsonObject(
  req: NextRequest,
): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return null;
  }
  if (!raw.trim()) return {};
  try {
    const body: unknown = JSON.parse(raw);
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** actorEmail (string) trong body/query → đã trim; không phải string → "". */
export function readActorEmail(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** conversation_id Etsy trong path → số nguyên dương an toàn, không hợp lệ → null. */
export function parseConversationIdParam(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Response 400 chuẩn cho route máy gọi. */
export function machineBadRequest(error: string): NextResponse {
  return NextResponse.json({ error, code: "bad_request" }, { status: 400 });
}

/** Response 401 chuẩn cho route máy gọi khi thiếu/sai x-api-key. */
export function machineUnauthorized(): NextResponse {
  return NextResponse.json({ error: "unauthenticated", code: "unauthenticated" }, { status: 401 });
}

/** Response 403 khi actorEmail chưa từng đăng nhập dora-1 (không có trong `users`). */
export function actorNotDoraUser(email: string): NextResponse {
  return NextResponse.json(
    {
      code: "actor_not_dora_user",
      error: `Tài khoản ${email || "(trống)"} chưa từng đăng nhập Dora nên không được ghi (gửi tin, note, mẫu câu)`,
    },
    { status: 403 },
  );
}
