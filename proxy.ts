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
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/uploads") ||
    pathname.startsWith("/v1/")
  )
    return NextResponse.next();

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
