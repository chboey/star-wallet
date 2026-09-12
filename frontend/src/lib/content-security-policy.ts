import { sepolia } from "viem/chains";

type PolicyOptions = {
  nonce: string;
  development: boolean;
  secure: boolean;
  rpcUrl?: string;
};

/** Only origins enter the policy: never interpolate a URL's path, query or credentials. */
export function contentSecurityPolicy({
  nonce,
  development,
  secure,
  rpcUrl,
}: PolicyOptions) {
  if (!/^[A-Za-z0-9+/]{22,}={0,2}$/.test(nonce))
    throw new Error("Invalid CSP nonce");
  const rpc = new URL(rpcUrl || sepolia.rpcUrls.default.http[0]);
  if (
    rpc.username ||
    rpc.password ||
    !(
      rpc.protocol === "https:" ||
      (development &&
        rpc.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(rpc.hostname))
    )
  )
    throw new Error(
      "The browser RPC must use HTTPS (local HTTP is development-only)",
    );

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    // React animations use inline style properties/CSS variables. This does not permit inline JS.
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${rpc.origin} wss://mm-sdk-relay.api.cx.metamask.io${development ? " ws: wss:" : ""}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "worker-src 'none'",
    ...(secure ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
