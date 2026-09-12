import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { contentSecurityPolicy } from "./lib/content-security-policy";

export function proxy(request: NextRequest) {
  const nonce = randomBytes(32).toString("base64");
  const policy = contentSecurityPolicy({
    nonce,
    development: process.env.NODE_ENV === "development",
    secure: request.nextUrl.protocol === "https:",
    rpcUrl: process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL,
  });
  const headers = new Headers(request.headers);
  // Never trust a client-supplied nonce/CSP. Next uses this request policy during SSR.
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    "/((?!api(?:/|$)|_next/static|_next/image|illustrations/|fonts/|favicon.ico).*)",
  ],
};
