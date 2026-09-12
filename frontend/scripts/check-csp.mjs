import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

// HTTP-only production smoke test. No wallet, passkey, browser storage or chain writes.
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "0",
  ],
  {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production" },
  },
);
let output = "";
const stopped = once(server, "exit");
try {
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Local production server did not become ready")),
      20_000,
    );
    const read = (chunk) => {
      output = (output + chunk.toString()).slice(-10_000);
      const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url && output.includes("Ready")) {
        clearTimeout(timer);
        resolve(url);
      }
    };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
    server.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Local production server exited before readiness"));
    });
  });
  const nonces = new Set();
  for (const path of ["/security-test-missing-page"]) {
    const response = await fetch(`${origin}${path}`, {
      headers: {
        "x-nonce": "attacker-nonce",
        "content-security-policy": "script-src *",
      },
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(
      response.status,
      path.includes("missing-page") ? 404 : 200,
      path,
    );
    const policy = response.headers.get("content-security-policy");
    assert.ok(policy, `${path}: CSP must be present`);
    assert.doesNotMatch(policy, /unsafe-eval|attacker-nonce/);
    const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
    assert.ok(nonce && !nonces.has(nonce), `${path}: nonce must be fresh`);
    nonces.add(nonce);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.match(
      response.headers.get("permissions-policy"),
      /publickey-credentials-get=\(self\)/,
    );
    const html = await response.text();
    const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)];
    assert.ok(scripts.length > 0, `${path}: expected Next runtime scripts`);
    for (const [, attributes] of scripts) {
      assert.ok(
        attributes.includes(`nonce="${nonce}"`),
        `${path}: runtime/inline script has no matching nonce`,
      );
    }
    assert.doesNotMatch(html, /<script\b[^>]*src="https?:\/\//i);
    console.log(
      `PASS ${path}: fresh CSP, nonced scripts, protected headers, no caching`,
    );
  }
} finally {
  server.kill("SIGTERM");
  const timeout = setTimeout(() => server.kill("SIGKILL"), 3_000);
  await stopped;
  clearTimeout(timeout);
}
