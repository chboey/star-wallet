import {
  isDeadlineFreeStarRequest,
  isStarRouteAllowed,
} from "./star-api.contract";

type ProxyConfig = { apiUrl?: string; timeoutMs?: string };
const requestLimit = 64_000;
const responseLimit = 2_000_000;

/** Server-side only. Configuration is injected by the Next route; never imported by client code. */
export async function proxyStarRequest(
  request: Request,
  path: readonly string[],
  config: ProxyConfig,
  fetcher: typeof fetch = (...args) => fetch(...args),
): Promise<Response> {
  const route = path.join("/");
  if (
    !path.every((segment) => /^[a-zA-Z0-9-]+$/.test(segment)) ||
    !isStarRouteAllowed(route, request.method)
  ) {
    return failure(
      404,
      "ROUTE_NOT_ALLOWED",
      "This Star API route is not exposed.",
    );
  }
  let base: URL;
  let timeoutMs: number;
  try {
    if (!config.apiUrl?.trim()) throw new Error("Missing API URL");
    base = new URL(config.apiUrl.trim());
    if (
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      throw new Error("Invalid API URL");
    const prefix = base.pathname.replace(/\/+$/, "") || "/v1";
    if (!prefix.endsWith("/v1")) throw new Error("API URL must point to /v1");
    base.pathname = `${prefix}/`;
    timeoutMs = config.timeoutMs?.trim() ? Number(config.timeoutMs) : 15_000;
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1_000 ||
      timeoutMs > 18_000
    )
      throw new Error("Invalid API timeout");
  } catch {
    if (route === "status") return json({ configured: false });
    return failure(
      503,
      "STAR_API_NOT_CONFIGURED",
      "The Star API server configuration is missing or invalid.",
    );
  }
  // Configured is deliberately not a claim about backend readiness or on-chain deployment.
  if (route === "status") return json({ configured: true });

  // ENS setup and child-account configuration wait without an application deadline.
  // Backend verification and caller/disconnect cancellation are unchanged.
  const timeout = isDeadlineFreeStarRequest(route, request.method)
    ? undefined
    : AbortSignal.timeout(timeoutMs);
  const signal = timeout
    ? AbortSignal.any([request.signal, timeout])
    : request.signal;
  try {
    signal.throwIfAborted();
    const source = new URL(request.url);
    if (source.search.length > 8_192)
      return failure(414, "REQUEST_TOO_LARGE", "The request URL is too large.");
    const target = new URL(route, base);
    target.search = source.search;
    let body: string | undefined;
    if (request.method === "POST") {
      if (!hasSameOrigin(request, source))
        return failure(
          403,
          "ORIGIN_NOT_ALLOWED",
          "Cross-origin intent requests are not allowed.",
        );
      if (
        !/^application\/json(?:\s*;|$)/i.test(
          request.headers.get("content-type") ?? "",
        )
      ) {
        return failure(
          415,
          "INVALID_CONTENT_TYPE",
          "Intent requests must contain JSON.",
        );
      }
      body = await readLimited(request.body, requestLimit, signal, true);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return failure(
          400,
          "INVALID_REQUEST",
          "The request body must be valid JSON.",
        );
      }
      if (!record(parsed))
        return failure(
          400,
          "INVALID_REQUEST",
          "The request body must be a JSON object.",
        );
    }
    const upstream = await fetcher(target, {
      method: request.method,
      body,
      signal,
      cache: "no-store",
      redirect: "error",
      headers:
        body === undefined
          ? { accept: "application/json" }
          : { accept: "application/json", "content-type": "application/json" },
    });
    if (upstream.status >= 300 && upstream.status < 400)
      return failure(
        502,
        "STAR_API_INVALID_RESPONSE",
        "The Star API returned an unexpected redirect.",
      );
    const text = await readLimited(upstream.body, responseLimit, signal, false);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
    if (!record(payload))
      return failure(
        502,
        "STAR_API_INVALID_RESPONSE",
        "The Star API returned an invalid response.",
      );
    if (!upstream.ok) {
      // Do not expose upstream URLs, stack traces or credentials in server error details.
      return json(
        {
          code:
            typeof payload.code === "string" ? payload.code : "STAR_API_ERROR",
          message:
            typeof payload.message === "string"
              ? payload.message
              : "The Star service could not complete this request.",
          ...(upstream.status < 500 && payload.details !== undefined
            ? { details: payload.details }
            : {}),
          ...(typeof payload.requestId === "string"
            ? { requestId: payload.requestId }
            : {}),
        },
        upstream.status,
        upstream.headers.get("retry-after"),
      );
    }
    return json(payload, upstream.status);
  } catch (error) {
    if (error instanceof BodyLimitError)
      return failure(
        error.requestBody ? 413 : 502,
        error.requestBody ? "REQUEST_TOO_LARGE" : "STAR_API_INVALID_RESPONSE",
        error.message,
      );
    if (request.signal.aborted)
      return failure(499, "REQUEST_ABORTED", "The request was cancelled.");
    if (timeout?.aborted)
      return failure(
        504,
        "STAR_API_TIMEOUT",
        "The Star service timed out. Please try again.",
      );
    return failure(
      503,
      "STAR_API_UNAVAILABLE",
      "The Star service could not be reached.",
    );
  }
}

function hasSameOrigin(request: Request, source: URL): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  // Next may build request.url from its internal bind hostname. Host represents
  // the browser-facing destination; reverse proxies must preserve it. Do not
  // trust an arbitrary X-Forwarded-Host header here.
  try {
    const target = new URL(
      `${source.protocol}//${request.headers.get("host") ?? source.host}`,
    );
    return (
      !target.username &&
      !target.password &&
      target.pathname === "/" &&
      !target.search &&
      !target.hash &&
      origin === target.origin
    );
  } catch {
    return false;
  }
}

class BodyLimitError extends Error {
  constructor(readonly requestBody: boolean) {
    super(
      requestBody
        ? "The request body is too large."
        : "The Star API response is too large.",
    );
  }
}
async function readLimited(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
  signal: AbortSignal,
  requestBody: boolean,
): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        void reader.cancel().catch(() => {});
        throw new BodyLimitError(requestBody);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function json(body: unknown, status = 200, retryAfter?: string | null) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      ...(retryAfter ? { "retry-after": retryAfter } : {}),
    },
  });
}
function failure(status: number, code: string, message: string) {
  return json({ code, message }, status);
}
