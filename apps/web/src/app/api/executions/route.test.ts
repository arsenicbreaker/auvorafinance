import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HistoryError,
  loadExecutionHistory,
} from "../../../server/execution-history";
import { GET } from "./route";
vi.mock("../../../server/execution-history", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../server/execution-history")
  >()),
  loadExecutionHistory: vi.fn(),
}));
let clock = 2000000000000;
beforeEach(() => {
  vi.resetAllMocks();
  clock += 60001;
  vi.spyOn(Date, "now").mockReturnValue(clock);
  vi.mocked(loadExecutionHistory).mockResolvedValue({
    rows: [],
  } as unknown as Awaited<ReturnType<typeof loadExecutionHistory>>);
});
afterEach(() => vi.restoreAllMocks());
const request = () =>
  new Request("https://app.test/api/executions?owner=owner.testnet");
describe("execution history API", () => {
  it("returns read-only history without caching", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects invalid requests before querying storage", async () => {
    const response = await GET(
      new Request("https://app.test/api/executions?owner=owner.near"),
    );
    expect(response.status).toBe(400);
    expect(loadExecutionHistory).not.toHaveBeenCalled();
  });
  it("reports missing configuration without exposing secrets", async () => {
    vi.mocked(loadExecutionHistory).mockRejectedValue(
      new HistoryError("NOT_CONFIGURED"),
    );
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "NOT_CONFIGURED" });
  });
  it("sanitizes unexpected database errors", async () => {
    vi.mocked(loadExecutionHistory).mockRejectedValue(
      new Error("postgresql://private:password@host"),
    );
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "HISTORY_UNAVAILABLE" });
  });
  it("bounds requests per process and permits a new window", async () => {
    for (let i = 0; i < 20; i++)
      expect((await GET(request())).status).toBe(200);
    const limited = await GET(request());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    vi.spyOn(Date, "now").mockReturnValue(clock + 60001);
    expect((await GET(request())).status).toBe(200);
  });
  it("allows only four concurrent history loads and releases capacity afterward", async () => {
    const resolvers: Array<
      (value: Awaited<ReturnType<typeof loadExecutionHistory>>) => void
    > = [];
    vi.mocked(loadExecutionHistory).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const inFlight = Array.from({ length: 4 }, () => GET(request()));
    expect((await GET(request())).status).toBe(429);
    for (const resolve of resolvers)
      resolve({ rows: [] } as unknown as Awaited<
        ReturnType<typeof loadExecutionHistory>
      >);
    await Promise.all(inFlight);
    vi.mocked(loadExecutionHistory).mockResolvedValue({
      rows: [],
    } as unknown as Awaited<ReturnType<typeof loadExecutionHistory>>);
    expect((await GET(request())).status).toBe(200);
  });
});
