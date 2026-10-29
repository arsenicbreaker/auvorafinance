import { aiWorkflowParserRequestSchema } from "@auvora/workflow-schema";

import { parseWorkflowInstruction } from "../../../../server/ai/parser";

export const runtime = "nodejs";

const REQUESTS_PER_MINUTE = 8;
const WINDOW_MS = 60_000;
const MAX_TRACKED_CLIENTS = 1_000;
const OVERFLOW_CLIENT_KEY = "__overflow__";
const requestWindows = new Map<string, { count: number; startedAt: number }>();

export async function POST(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 4_096) {
    return json({ error: "REQUEST_TOO_LARGE" }, 413);
  }

  const now = Date.now();
  const clientKey = getClientKey(request, now);
  if (!consumeRateLimit(clientKey, now)) {
    return json({ error: "RATE_LIMITED" }, 429, { "retry-after": "60" });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const input = aiWorkflowParserRequestSchema.safeParse(payload);
  if (!input.success) {
    return json(
      {
        error: "INVALID_REQUEST",
        fields: input.error.issues.map((issue) => issue.path.join(".")),
      },
      400,
    );
  }

  const result = await parseWorkflowInstruction(input.data.prompt);
  return json(result, 200);
}

function getClientKey(request: Request, now: number): string {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim()
    .slice(0, 128);

  if (requestWindows.size >= MAX_TRACKED_CLIENTS) {
    for (const [key, window] of requestWindows) {
      if (now - window.startedAt >= WINDOW_MS) requestWindows.delete(key);
    }
  }

  if (
    requestWindows.size >= MAX_TRACKED_CLIENTS &&
    !requestWindows.has(forwarded || "local")
  ) {
    return OVERFLOW_CLIENT_KEY;
  }

  return forwarded || "local";
}

function consumeRateLimit(key: string, now: number): boolean {
  const current = requestWindows.get(key);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    requestWindows.set(key, { count: 1, startedAt: now });
    return true;
  }
  if (current.count >= REQUESTS_PER_MINUTE) return false;
  current.count += 1;
  return true;
}

function json(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      ...headers,
    },
  });
}
