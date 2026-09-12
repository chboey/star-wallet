import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  createStarApi,
  retryStarQuery,
  StarApiError,
  type ApiRequestOptions,
} from "../src/lib/star-api";

const wallet = "0x0000000000000000000000000000000000001234";
const intent = {
  chainId: 11155111,
  signerRole: "PARENT",
  to: wallet,
  data: "0x12345678",
  value: "0",
  summary: "Fund WETH",
};
const envelope = { intents: [intent] };
const apiReturning = (body: unknown, status = 200) =>
  createStarApi(async () => Response.json(body, { status }));

const ensPreparations = [
  (api: ReturnType<typeof createStarApi>, options?: ApiRequestOptions) =>
    api.prepareEnsNamespace({ signer: wallet }, options),
  (api: ReturnType<typeof createStarApi>, options?: ApiRequestOptions) =>
    api.prepareEnsFamily(
      { signer: wallet, label: "tan", secret: `0x${"ab".repeat(32)}` },
      options,
    ),
  (api: ReturnType<typeof createStarApi>, options?: ApiRequestOptions) =>
    api.prepareEnsSubdomain(
      { label: "amelia", signer: wallet, owner: wallet, address: wallet },
      options,
    ),
];

test("onboarding ENS plans wait beyond the browser deadline for headers and body without retrying", async () => {
  const plan = {
    name: "amelia.tan.starwallet.eth",
    checkedAtBlock: "123",
    status: "READY",
    step: null,
    requiresConfirmation: false,
    transaction: null,
  };
  for (const prepare of ensPreparations) {
    let calls = 0;
    const api = createStarApi(async (_url, init) => {
      calls++;
      assert.equal(init?.signal, undefined);
      await delay(15);
      return new Response(
        new ReadableStream({
          async start(controller) {
            await delay(15);
            controller.enqueue(new TextEncoder().encode(JSON.stringify(plan)));
            controller.close();
          },
        }),
      );
    }, 5);
    assert.deepEqual(await prepare(api), plan);
    assert.equal(calls, 1);
    await assert.rejects(prepare(apiReturning({})), {
      code: "STAR_API_INVALID_RESPONSE",
    });
    await assert.rejects(
      prepare(
        apiReturning(
          { code: "ENS_UNAVAILABLE", message: "Verification failed" },
          503,
        ),
      ),
      { code: "ENS_UNAVAILABLE", status: 503 },
    );
  }
});

test("deadline-free onboarding ENS still cancels before or during a request", async () => {
  for (const prepare of ensPreparations)
    for (const alreadyAborted of [true, false]) {
      const controller = new AbortController();
      const reason = new DOMException("Onboarding cancelled", "AbortError");
      if (alreadyAborted) controller.abort(reason);
      let calls = 0;
      const api = createStarApi(async (_url, init) => {
        calls++;
        assert.equal(init?.signal, controller.signal);
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
          controller.abort(reason);
        });
      });
      await assert.rejects(
        prepare(api, { signal: controller.signal }),
        (error) => error === reason,
      );
      assert.equal(calls, alreadyAborted ? 0 : 1);
    }
});

test("ENS registration uses standalone plans and refuses wrong-signer or nonzero-value transactions", async () => {
  const plan = {
    name: "maya.starwallet.eth",
    checkedAtBlock: "123",
    status: "TRANSACTION_REQUIRED",
    step: "REGISTER_SUBDOMAIN",
    requiresConfirmation: true,
    transaction: {
      chainId: 11155111,
      from: wallet,
      to: wallet,
      data: "0x12345678",
      value: "0",
    },
  };
  const input = {
    label: "maya",
    signer: wallet,
    owner: wallet,
    address: wallet,
  };
  const api = createStarApi(async (url, init) => {
    assert.equal(url, "/api/star/ens/subdomains");
    assert.deepEqual(JSON.parse(String(init?.body)), input);
    return Response.json(plan);
  });
  assert.deepEqual(await api.prepareEnsSubdomain(input), plan);
  for (const tx of [
    { ...plan.transaction, value: "1" },
    { ...plan.transaction, chainId: 1 },
    { ...plan.transaction, from: "0x1000000000000000000000000000000000000001" },
    { ...plan.transaction, to: "0x0000000000000000000000000000000000000000" },
    { ...plan.transaction, data: "0x" },
  ]) {
    await assert.rejects(
      apiReturning({ ...plan, transaction: tx }).prepareEnsSubdomain(input),
      { code: "STAR_API_INVALID_RESPONSE" },
    );
  }
  const ready = {
    name: plan.name,
    checkedAtBlock: "124",
    status: "READY",
    step: null,
    requiresConfirmation: false,
    transaction: null,
  };
  assert.deepEqual(
    await apiReturning(ready).prepareEnsNamespace({ signer: wallet }),
    ready,
  );
  await assert.rejects(
    apiReturning({
      ...ready,
      transaction: plan.transaction,
    }).prepareEnsNamespace({ signer: wallet }),
    { code: "STAR_API_INVALID_RESPONSE" },
  );
});

test("typed intents serialize base-unit strings and use the same-origin JSON proxy once", async () => {
  let calls = 0;
  const api = createStarApi(async (url, init) => {
    calls++;
    assert.equal(url, "/api/star/intents/savings/fund-weth");
    assert.equal(init?.method, "POST");
    assert.equal(
      new Headers(init?.headers).get("content-type"),
      "application/json",
    );
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "same-origin");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      familyId: "1",
      amountWethUnits: "900719925474099300000",
    });
    return Response.json(envelope);
  });
  assert.deepEqual(
    await api.intent("fundWeth", {
      familyId: "1",
      amountWethUnits: "900719925474099300000",
    }),
    envelope,
  );
  assert.equal(calls, 1);
});

test("read methods build pagination and cursor URLs without component string concatenation", async () => {
  const paths: string[] = [];
  const api = createStarApi(async (url, init) => {
    paths.push(String(url));
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("content-type"), null);
    return Response.json({});
  });
  await api.family("12", { first: 50, skip: 100 });
  await api.childByWallet(wallet);
  await api.activity("12", { before: "9007199254740993000" });
  assert.deepEqual(paths, [
    "/api/star/families/12?first=50&skip=100",
    `/api/star/children/by-wallet/${wallet}?first=100&skip=0`,
    "/api/star/families/12/activity?first=100&before=9007199254740993000",
  ]);
});

test("ENS query parameters remain data rather than extra query parameters", async () => {
  const name = "name&expectedAddress=attacker.eth";
  const api = createStarApi(async (url) => {
    const parsed = new URL(String(url), "https://star.example");
    assert.equal(parsed.searchParams.get("name"), name);
    assert.equal(parsed.searchParams.get("expectedAddress"), wallet);
    assert.equal([...parsed.searchParams].length, 2);
    return Response.json({});
  });
  await api.resolveEns(name, wallet);
});

test("invalid IDs, addresses and pagination fail before fetching", () => {
  const api = createStarApi(async () => {
    throw new Error("must not fetch");
  });
  for (const id of [
    "0",
    "-1",
    "../status",
    "1?first=1",
    "1/portfolio",
    (1n << 256n).toString(),
  ])
    assert.throws(() => api.family(id), StarApiError);
  assert.throws(
    () => api.childByWallet("https://attacker.example"),
    StarApiError,
  );
  assert.throws(() => api.activity("1", { before: "-1" }), StarApiError);
  assert.throws(() => api.family("1", { first: 101 }), StarApiError);
  assert.throws(() => api.family("1", { skip: -1 }), StarApiError);
});

test("preserves structured backend status, error code, validation details and request ID", async () => {
  const api = apiReturning(
    {
      code: "INVALID_REQUEST",
      message: "Invalid fee",
      details: { fee: "too high" },
      requestId: "req-1",
    },
    400,
  );
  await assert.rejects(api.status(), (error) => {
    assert.ok(error instanceof StarApiError);
    assert.equal(error.status, 400);
    assert.equal(error.code, "INVALID_REQUEST");
    assert.equal(error.requestId, "req-1");
    assert.deepEqual(error.details, { fee: "too high" });
    return true;
  });
});

test("handles not-found responses without a backend message", async () => {
  await assert.rejects(
    apiReturning({ code: "CHILD_NOT_FOUND" }, 404).childByWallet(wallet),
    (error) => {
      assert.ok(error instanceof StarApiError);
      assert.equal(error.status, 404);
      assert.equal(error.code, "CHILD_NOT_FOUND");
      assert.match(error.message, /not been indexed/);
      return true;
    },
  );
});

test("rejects empty, non-JSON and non-object successful responses", async () => {
  for (const body of ["", "<html>gateway</html>", "null", "[]"]) {
    const api = createStarApi(async () => new Response(body));
    await assert.rejects(
      api.status(),
      (error) =>
        error instanceof StarApiError &&
        error.code === "STAR_API_INVALID_RESPONSE",
    );
  }
});

test("rejects malformed intent envelopes and native value before wallet submission", async () => {
  const invalid = [
    {},
    { intents: [] },
    { intents: [intent, { ...intent, value: "1" }] },
    ...[
      { chainId: "11155111" },
      { chainId: -1 },
      { chainId: 1 },
      { chainId: 8453 },
      { chainId: 84532 },
      { signerRole: "TAKER" },
      { to: "0x" },
      { to: `0x${"0".repeat(40)}` },
      { data: "0x" },
      { data: "0x1234567" },
      { value: 0 },
      { value: "-1" },
      { summary: "" },
    ].map((change) => ({ intents: [{ ...intent, ...change }] })),
  ];
  for (const body of invalid)
    await assert.rejects(
      apiReturning(body).intent("fundWeth", {
        familyId: "1",
        amountWethUnits: "1",
      }),
      (error) =>
        error instanceof StarApiError &&
        error.code === "STAR_API_INVALID_RESPONSE",
    );
});

test("checks onboarding metadata and rejects bigint request bodies", async () => {
  await assert.rejects(
    apiReturning(envelope).intent("createFamily", { ensName: "test.eth" }),
    StarApiError,
  );
  await assert.rejects(
    apiReturning(envelope).intent("registerChild", {
      familyId: "1",
      childWallet: wallet,
      ensName: "child.test.eth",
    }),
    StarApiError,
  );
  await assert.rejects(
    apiReturning(envelope).intent("fundWeth", {
      familyId: "1",
      amountWethUnits: 1n,
    } as never),
    (error) =>
      error instanceof StarApiError && error.code === "INVALID_REQUEST",
  );
});

test("cancellation is preserved and an already-cancelled query does not fetch", async () => {
  const controller = new AbortController();
  const reason = new DOMException("Query cancelled", "AbortError");
  controller.abort(reason);
  let calls = 0;
  const api = createStarApi(async () => {
    calls++;
    return Response.json({});
  });
  await assert.rejects(
    api.status({ signal: controller.signal }),
    (error) => error === reason,
  );
  assert.equal(calls, 0);
});

test("child-account config waits beyond the browser deadline without retrying", async () => {
  const config = {
    chainId: 11155111,
    entryPoint: wallet,
    factory: wallet,
    rpId: "localhost",
    sponsorshipConfigured: true,
  };
  let calls = 0;
  const api = createStarApi(async (url, init) => {
    calls++;
    assert.equal(url, "/api/star/child-accounts/config");
    assert.equal(init?.signal, undefined);
    await delay(25);
    return Response.json(config);
  }, 5);
  assert.deepEqual(await api.childAccountConfig(), config);
  assert.equal(calls, 1);
  await assert.rejects(apiReturning({}).childAccountConfig(), {
    code: "STAR_API_INVALID_RESPONSE",
  });
  await assert.rejects(
    apiReturning(
      { code: "PROTOCOL_UNAVAILABLE", message: "Verification failed" },
      503,
    ).childAccountConfig(),
    { code: "PROTOCOL_UNAVAILABLE", status: 503 },
  );
});

test("child-account config preserves cancellation before and during verification", async () => {
  for (const alreadyAborted of [true, false]) {
    const controller = new AbortController();
    const reason = new DOMException("Setup cancelled", "AbortError");
    if (alreadyAborted) controller.abort(reason);
    let calls = 0;
    const api = createStarApi(async (_url, init) => {
      calls++;
      assert.equal(init?.signal, controller.signal);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          {
            once: true,
          },
        );
        controller.abort(reason);
      });
    });
    await assert.rejects(
      api.childAccountConfig({ signal: controller.signal }),
      (error) => error === reason,
    );
    assert.equal(calls, alreadyAborted ? 0 : 1);
  }
});

test("network failures and timeouts are distinct and never auto-retry intents", async () => {
  let calls = 0;
  const offline = createStarApi(async () => {
    calls++;
    throw new Error("offline");
  });
  await assert.rejects(
    offline.intent("fundWeth", { familyId: "1", amountWethUnits: "1" }),
    (error) =>
      error instanceof StarApiError && error.code === "STAR_API_UNAVAILABLE",
  );
  assert.equal(calls, 1);
  const stalled = createStarApi(
    async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
      }),
    5,
  );
  await Promise.all([
    assert.rejects(
      stalled.status(),
      (error) =>
        error instanceof StarApiError && error.code === "STAR_API_TIMEOUT",
    ),
    delay(25),
  ]);
});

test("read retry policy excludes permanent, malformed and unconfigured responses", () => {
  assert.equal(
    retryStarQuery(0, new StarApiError("rate limited", { status: 429 })),
    false,
  );
  assert.equal(
    retryStarQuery(0, new StarApiError("unavailable", { status: 503 })),
    true,
  );
  assert.equal(
    retryStarQuery(2, new StarApiError("unavailable", { status: 503 })),
    false,
  );
  assert.equal(
    retryStarQuery(0, new StarApiError("missing", { status: 404 })),
    false,
  );
  assert.equal(
    retryStarQuery(
      0,
      new StarApiError("config", {
        status: 503,
        code: "STAR_API_NOT_CONFIGURED",
      }),
    ),
    false,
  );
  assert.equal(
    retryStarQuery(
      0,
      new StarApiError("bad JSON", {
        status: 502,
        code: "STAR_API_INVALID_RESPONSE",
      }),
    ),
    false,
  );
});
