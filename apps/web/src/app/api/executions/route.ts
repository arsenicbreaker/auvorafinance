import {
  HistoryError,
  loadExecutionHistory,
  parseHistoryRequest,
} from "../../../server/execution-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let active = 0;
let windowStart = 0;
let requests = 0;

export async function GET(request: Request): Promise<Response> {
  let input;
  try {
    input = parseHistoryRequest(request.url);
  } catch {
    return json({ error: "INVALID_REQUEST" }, 400);
  }
  const now = Date.now();
  if (now - windowStart >= 60000) {
    windowStart = now;
    requests = 0;
  }
  if (requests >= 20 || active >= 4)
    return json({ error: "RATE_LIMITED" }, 429);
  requests++;
  active++;
  try {
    return json(await loadExecutionHistory(input), 200);
  } catch (error) {
    const code =
      error instanceof HistoryError ? error.code : "HISTORY_UNAVAILABLE";
    return json({ error: code }, code === "INVALID_REQUEST" ? 400 : 503);
  } finally {
    active--;
  }
}

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      ...(status === 429 ? { "retry-after": "60" } : {}),
    },
  });
}
