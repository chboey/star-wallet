import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { contentSecurityPolicy } from "../src/lib/content-security-policy";
import { proxy } from "../src/proxy";

const nonce = "abcdefghijklmnopqrstuvwx0123456789ABCDabcdEF=";
const options = { nonce, development: false, secure: true };

test("production CSP permits only nonced scripts, local assets and the configured RPC", () => {
  const policy = contentSecurityPolicy({
    ...options,
    rpcUrl: "https://rpc.example/v2/public?key=public",
  });
  assert.match(
    policy,
    new RegExp(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic';`),
  );
  assert.match(policy, /connect-src 'self' https:\/\/rpc.example /);
  assert.match(policy, /wss:\/\/mm-sdk-relay.api.cx.metamask.io/);
  assert.match(policy, /script-src-attr 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /base-uri 'none'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /upgrade-insecure-requests/);
  assert.doesNotMatch(policy, /unsafe-eval|v2\/|key=/);
  assert.doesNotMatch(
    policy.split(";").find((part) => part.trim().startsWith("script-src "))!,
    /unsafe-inline/,
  );
});

test("development-only exceptions support HMR and local RPC, not production", () => {
  const policy = contentSecurityPolicy({
    ...options,
    development: true,
    secure: false,
    rpcUrl: "http://localhost:8545",
  });
  assert.match(policy, /unsafe-eval/);
  assert.match(policy, /ws: wss:/);
  assert.doesNotMatch(policy, /upgrade-insecure-requests/);
  for (const rpcUrl of [
    "http://localhost:8545",
    "javascript:alert(1)",
    "https://user:secret@rpc.example",
  ]) {
    assert.throws(() => contentSecurityPolicy({ ...options, rpcUrl }));
  }
  assert.throws(() =>
    contentSecurityPolicy({ ...options, nonce: "bad'; script-src *" }),
  );
});

test("each response replaces attacker-controlled nonces and cannot be cached", () => {
  const request = new NextRequest("https://star.example/wallet/kid", {
    headers: {
      "x-nonce": "attacker",
      "content-security-policy": "script-src *",
    },
  });
  const first = proxy(request);
  const second = proxy(request);
  assert.notEqual(
    first.headers.get("content-security-policy"),
    second.headers.get("content-security-policy"),
  );
  assert.equal(first.headers.get("cache-control"), "private, no-store");
  assert.equal(
    first.headers.get("x-middleware-request-content-security-policy"),
    first.headers.get("content-security-policy"),
  );
  assert.doesNotMatch(
    first.headers.get("content-security-policy")!,
    /attacker/,
  );
});
