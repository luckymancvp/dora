import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;

  // Extension sync endpoints (/v1/*) được gọi không có session — bỏ qua auth.
  // TODO: thêm shared-secret token cho /v1 như system_token của dora-backend.
  // /api/uploads: webhook blob.upload-completed của Vercel gọi không kèm cookie;
  // route tự kiểm auth() khi cấp token và xác thực chữ ký webhook nên an toàn.
  // /api/cron: Vercel Cron gọi không có session; route tự kiểm CRON_SECRET.
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/uploads") ||
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/v1/")
  )
    return NextResponse.next();

  // /api/orders/message: Apps Script gọi bằng x-api-key, KHÔNG có session cookie —
  // trước đây middleware đẩy về /login nên nhánh x-api-key trong route là code chết.
  // Chỉ cho qua request thực sự MANG header; route tự so key với MERA_INTERNAL_API_KEY
  // rồi mới xử lý, không mang header thì vẫn bị chặn như cũ.
  if (pathname === "/api/orders/message" && req.headers.get("x-api-key")) {
    return NextResponse.next();
  }

  const isLoginPage = pathname === "/login";

  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
