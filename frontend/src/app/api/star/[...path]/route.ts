import { proxyStarRequest } from "@/lib/star-api-proxy";

type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: RouteContext) {
  const { path } = await context.params;
  return proxyStarRequest(request, path, {
    apiUrl: process.env.STAR_API_URL,
    timeoutMs: process.env.STAR_API_TIMEOUT_MS,
  });
}

export const GET = handle;
export const POST = handle;
