import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { proxyStarRequest } from "../src/lib/star-api-proxy";
import {
  intentPaths,
  isStarRouteAllowed,
  isDeadlineFreeStarRequest,
} from "../src/lib/star-api.contract";

const config = { apiUrl: "http://backend.test:3000/v1" };

test("deadline exemptions are exact ENS setup routes and child config, never general intents or lookups", () => {
  for (const route of ["ens/namespace", "ens/families", "ens/subdomains"])
    assert.equal(isDeadlineFreeStarRequest(route, "POST"), true);
  assert.equal(isDeadlineFreeStarRequest("child-accounts/config", "GET"), true);
  for (const [route, method] of [
    ["ens/families", "GET"],
    ["ens/namespace", "GET"],
    ["ens/resolve", "GET"],
    ["ens/subdomains/extra", "POST"],
    ["child-accounts/config", "POST"],
    ["child-accounts/lookup", "GET"],
    ["families/1", "GET"],
    ...Object.values(intentPaths).map((route) => [route, "POST"]),
  ])
    assert.equal(
      isDeadlineFreeStarRequest(route, method),
      false,
      `${method} ${route}`,
    );
});

test("ENS setup proxy waits past the configured deadline for slow headers and response bodies", async () => {
  await Promise.all(
    ["ens/namespace", "ens/families", "ens/subdomains"].map(async (route) => {
      const request = new Request(`http://star.test/api/star/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      let calls = 0;
      const response = await proxyStarRequest(
        request,
        route.split("/"),
        { ...config, timeoutMs: "1000" },
        async (_url, init) => {
          calls++;
          assert.equal(init?.signal, request.signal);
          await delay(650, undefined, { signal: init?.signal ?? undefined });
          return new Response(
            new ReadableStream({
              async start(controller) {
                await delay(650);
                controller.enqueue(
                  new TextEncoder().encode('{"status":"READY"}'),
                );
                controller.close();
              },
            }),
          );
        },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: "READY" });
      assert.equal(calls, 1);
    }),
  );
});

test("deadline-free ENS setup still cancels stalled upstream bodies on disconnect", async () => {
  for (const route of ["ens/namespace", "ens/families", "ens/subdomains"]) {
    const controller = new AbortController();
    let cancelled = false;
    const response = await proxyStarRequest(
      new Request(`http://star.test/api/star/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: controller.signal,
      }),
      route.split("/"),
      config,
      async () =>
        new Response(
          new ReadableStream({
            async pull() {
              await delay(0);
              controller.abort();
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
    );
    assert.equal(response.status, 499);
    assert.equal(cancelled, true);
  }
});

const get = (path: string) => new Request(`http://star.test/api/star/${path}`);
const post = (
  body: string,
  headers: HeadersInit = { "content-type": "application/json" },
) =>
  new Request("http://star.test/api/star/intents/rewards", {
    method: "POST",
    headers,
    body,
  });

test("browser fetch metadata rejects cross-site POSTs even without Origin", async () => {
  for (const site of ["cross-site", "same-site"]) {
    const response = await proxyStarRequest(
      post("{}", {
        "content-type": "application/json",
        "sec-fetch-site": site,
      }),
      ["intents", "rewards"],
      config,
      async () => assert.fail("must not reach the backend"),
    );
    assert.equal(response.status, 403);
  }
});

test("ENS namespace and registration plans pass through the same-origin allowlist", async () => {
  for (const path of ["ens/namespace", "ens/subdomains", "ens/families"]) {
    const body = { signer: "0x1000000000000000000000000000000000000001" };
    const response = await proxyStarRequest(
      new Request(`http://star.test/api/star/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://star.test",
        },
        body: JSON.stringify(body),
      }),
      path.split("/"),
      config,
      async (url, init) => {
        assert.equal(String(url), `http://backend.test:3000/v1/${path}`);
        assert.equal(init?.method, "POST");
        assert.deepEqual(JSON.parse(String(init?.body)), body);
        return Response.json({ status: "READY", transaction: null });
      },
    );
    assert.equal(response.status, 200);
  }
  assert.equal(isStarRouteAllowed("ens/namespace", "GET"), true);
  assert.equal(isStarRouteAllowed("ens/subdomains", "GET"), false);
});

test("every typed intent is exposed by the shared allowlist and unsupported methods are denied", () => {
  for (const path of Object.values(intentPaths)) {
    assert.equal(isStarRouteAllowed(path, "POST"), true);
    assert.equal(isStarRouteAllowed(path, "GET"), false);
  }
  assert.equal(isStarRouteAllowed("status", "DELETE"), false);
});

test("configuration status validates URLs without probing the backend", async () => {
  const noFetch: typeof fetch = async () => {
    throw new Error("must not fetch");
  };
  for (const apiUrl of [
    undefined,
    "",
    "not a url",
    "file:///etc/passwd",
    "https://user:secret@backend.test/v1",
    "https://backend.test/v1?key=secret",
  ]) {
    const response = await proxyStarRequest(
      get("status"),
      ["status"],
      { apiUrl },
      noFetch,
    );
    assert.deepEqual(await response.json(), { configured: false });
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.deepEqual(
    await (
      await proxyStarRequest(get("status"), ["status"], config, noFetch)
    ).json(),
    { configured: true },
  );
  assert.equal(
    (await proxyStarRequest(get("families/1"), ["families", "1"], {}, noFetch))
      .status,
    503,
  );
});

test("allowlist blocks traversal, encoded separators, unknown routes and wrong methods before fetching", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json({});
  };
  for (const path of [
    ["..", "health"],
    ["families", "..", "1"],
    ["families%2f1"],
    ["https:", "attacker.test"],
    ["health"],
    ["intents", "rewards"],
  ]) {
    assert.equal(
      (await proxyStarRequest(get("status"), path, config, fetcher)).status,
      404,
    );
  }
  assert.equal(calls, 0);
});

test("normalizes origin and /v1 configuration without forwarding credentials or cookies", async () => {
  for (const apiUrl of [
    "http://backend.test:3000",
    "http://backend.test:3000/v1",
    "http://backend.test:3000/v1/",
  ]) {
    const request = new Request(
      "http://star.test/api/star/families/1?first=10&skip=2",
      { headers: { cookie: "secret=session", authorization: "Bearer secret" } },
    );
    const response = await proxyStarRequest(
      request,
      ["families", "1"],
      { apiUrl },
      async (url, init) => {
        assert.equal(
          String(url),
          "http://backend.test:3000/v1/families/1?first=10&skip=2",
        );
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("cookie"), null);
        assert.equal(headers.get("authorization"), null);
        assert.equal(init?.cache, "no-store");
        assert.equal(init?.redirect, "error");
        return Response.json({ id: "1" });
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: "1" });
  }
});

test("valid JSON intents reach the backend unchanged", async () => {
  const body = JSON.stringify({ childId: "1", stars: "10", reason: "Reading" });
  const response = await proxyStarRequest(
    post(body),
    ["intents", "rewards"],
    config,
    async (_url, init) => {
      assert.equal(init?.body, body);
      assert.equal(init?.method, "POST");
      return Response.json({ intents: [] });
    },
  );
  assert.equal(response.status, 200);
});

test("rejects invalid content types, cross-origin POSTs, malformed JSON and arrays", async () => {
  const noFetch: typeof fetch = async () => {
    throw new Error("must not fetch");
  };
  const cases = [
    [post("{}", { "content-type": "text/plain" }), 415],
    [
      post("{}", {
        "content-type": "application/json",
        origin: "http://attacker.test",
      }),
      403,
    ],
    [post("{"), 400],
    [post("[]"), 400],
    [post("null"), 400],
  ] as const;
  for (const [request, status] of cases)
    assert.equal(
      (await proxyStarRequest(request, ["intents", "rewards"], config, noFetch))
        .status,
      status,
    );
});

test("checks browser-facing Host when Next uses an internal hostname, without trusting forwarded hosts", async () => {
  for (const [origin, expected] of [
    ["https://star.test", 200],
    ["https://localhost:3001", 403],
    ["https://attacker.test", 403],
    ["https://star.test:444", 403],
    ["http://star.test", 403],
    ["null", 403],
  ] as const) {
    let calls = 0;
    const request = new Request(
      "https://localhost:3001/api/star/intents/rewards",
      {
        method: "POST",
        headers: {
          host: "star.test",
          origin,
          "x-forwarded-host": "attacker.test",
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    const response = await proxyStarRequest(
      request,
      ["intents", "rewards"],
      config,
      async () => {
        calls++;
        return Response.json({ intents: [] });
      },
    );
    assert.equal(response.status, expected);
    assert.equal(calls, expected === 200 ? 1 : 0);
  }
});

test("enforces request size in UTF-8 bytes and limits upstream response size", async () => {
  const oversized = JSON.stringify({ reason: "⭐".repeat(22_000) });
  assert.ok(oversized.length < 64_000);
  const rejected = await proxyStarRequest(
    post(oversized),
    ["intents", "rewards"],
    config,
    async () => {
      throw new Error("must not fetch");
    },
  );
  assert.equal(rejected.status, 413);
  const response = await proxyStarRequest(
    get("families/1"),
    ["families", "1"],
    config,
    async () => new Response("a".repeat(2_000_001)),
  );
  assert.equal(response.status, 502);
});

test("malformed upstream JSON and redirects become controlled gateway errors", async () => {
  for (const response of [
    new Response("<html>Error</html>"),
    Response.json(null),
    new Response(null, {
      status: 302,
      headers: { location: "http://attacker.test" },
    }),
  ]) {
    const result = await proxyStarRequest(
      get("families/1"),
      ["families", "1"],
      config,
      async () => response,
    );
    assert.equal(result.status, 502);
    assert.equal(result.headers.get("location"), null);
  }
});

test("preserves backend errors and request IDs but strips internal server error details", async () => {
  const response = await proxyStarRequest(
    get("families/1"),
    ["families", "1"],
    config,
    async () =>
      Response.json(
        {
          code: "GRAPH_UNAVAILABLE",
          message: "Index unavailable",
          details: { url: "https://rpc.test/secret" },
          requestId: "req-42",
        },
        { status: 503, headers: { "retry-after": "5" } },
      ),
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "5");
  assert.deepEqual(await response.json(), {
    code: "GRAPH_UNAVAILABLE",
    message: "Index unavailable",
    requestId: "req-42",
  });
  const missing = await proxyStarRequest(
    get("families/1"),
    ["families", "1"],
    config,
    async () => Response.json({ code: "FAMILY_NOT_FOUND" }, { status: 404 }),
  );
  assert.equal(missing.status, 404);
});

test("network errors are sanitized without leaking the upstream URL", async () => {
  const response = await proxyStarRequest(
    get("families/1"),
    ["families", "1"],
    config,
    async () => {
      throw new Error("https://private-rpc.test/secret");
    },
  );
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private-rpc|secret/);
});

test("child-account config waits for slow headers and body without a proxy deadline", async () => {
  const request = get("child-accounts/config");
  let calls = 0;
  const response = await proxyStarRequest(
    request,
    ["child-accounts", "config"],
    { ...config, timeoutMs: "1000" },
    async (_url, init) => {
      calls++;
      assert.equal(init?.signal, request.signal);
      await delay(650, undefined, { signal: init?.signal ?? undefined });
      return new Response(
        new ReadableStream({
          async start(controller) {
            await delay(650);
            controller.enqueue(
              new TextEncoder().encode('{"rpId":"localhost"}'),
            );
            controller.close();
          },
        }),
      );
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { rpId: "localhost" });
  assert.equal(calls, 1);
});

test("child-account config can still cancel a stalled response body", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const response = proxyStarRequest(
    new Request("http://star.test/api/star/child-accounts/config", {
      signal: controller.signal,
    }),
    ["child-accounts", "config"],
    config,
    async () =>
      new Response(
        new ReadableStream({
          async pull() {
            await delay(0);
            controller.abort();
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  assert.equal((await response).status, 499);
  assert.equal(cancelled, true);
});

test("request cancellation reaches the upstream fetch signal", async () => {
  const controller = new AbortController();
  const request = new Request("http://star.test/api/star/families/1", {
    signal: controller.signal,
  });
  const result = proxyStarRequest(
    request,
    ["families", "1"],
    config,
    async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
        controller.abort();
      }),
  );
  assert.equal((await result).status, 499);
});

test("timeout also covers a stalled upstream response body", async () => {
  let cancelled = false;
  const response = proxyStarRequest(
    get("families/1"),
    ["families", "1"],
    { ...config, timeoutMs: "1000" },
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  const [result] = await Promise.all([response, delay(1_050)]);
  assert.equal(result.status, 504);
  assert.equal(cancelled, true);
});
