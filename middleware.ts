import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? "fallback-secret-change-me");

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/_next") || pathname.startsWith("/api/auth") || pathname.startsWith("/api/debug") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  const token = req.cookies.get("nt_session")?.value;
  const isLoggedIn = token ? await jwtVerify(token, SECRET).then(() => true).catch(() => false) : false;

  if (!isLoggedIn && pathname !== "/login") {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (isLoggedIn && pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
