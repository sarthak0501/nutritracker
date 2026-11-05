import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken } from "@/lib/auth-token";
import { safeOAuthReturn } from "@/lib/oauth-config";

const publicMcpPaths = new Set([
  "/api/mcp", "/oauth/authorize", "/oauth/consent", "/oauth/token", "/oauth/register", "/oauth/revoke",
  "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp",
]);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (publicMcpPaths.has(pathname)) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
    response.headers.set("X-Frame-Options", "DENY");
    return response;
  }

  if (pathname.startsWith("/_next") || pathname.startsWith("/api/auth") || ["/favicon.ico", "/manifest.webmanifest", "/icon.svg", "/apple-icon"].includes(pathname)) {
    return NextResponse.next();
  }

  const token = req.cookies.get("nt_session")?.value;
  const isLoggedIn = token ? Boolean(await verifySessionToken(token)) : false;

  if (!isLoggedIn && pathname !== "/login") {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (isLoggedIn && pathname === "/login") {
    return NextResponse.redirect(new URL(safeOAuthReturn(req.nextUrl.searchParams.get("next")) ?? "/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
