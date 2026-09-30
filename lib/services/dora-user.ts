import { getDb } from "@/lib/db/collections";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Tra email trong collection `users` do next-auth adapter ghi (cùng DB MONGODB_DB, xem auth.ts),
 * so KHÔNG phân biệt hoa thường. Trả email đúng như lưu trong `users` (để join tên nhân viên
 * trong getUsersByEmail — hàm đó so khớp chính xác), hoặc null nếu user chưa từng đăng nhập dora-1.
 */
export async function findDoraUserEmail(email: string): Promise<string | null> {
  const e = email.trim();
  if (!e) return null;
  const db = await getDb();
  const user = await db
    .collection("users")
    .findOne(
      { email: { $regex: `^${escapeRegex(e)}$`, $options: "i" } },
      { projection: { email: 1 } },
    );
  return user && typeof user.email === "string" ? user.email : null;
}
