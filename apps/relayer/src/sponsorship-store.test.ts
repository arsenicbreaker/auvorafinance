import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { SponsorshipStore } from "./sponsorship-store.js";

const input = {
  digest: "digest",
  sender: "owner.testnet",
  publicKey: "key",
  nonce: 2n,
  workflow: 7,
  method: "pause_workflow",
  reserved: 30n,
  dailyBudget: 100n,
};
function fixture(
  options: {
    existing?: boolean;
    pending?: boolean;
    spent?: string;
    requests?: string;
    replay?: boolean;
    insertFails?: boolean;
  } = {},
) {
  const order: string[] = [];
  const query = vi.fn(async (sql: string) => {
    order.push(sql);
    if (sql.includes("digest=$2"))
      return {
        rows: options.existing ? [{ hash: "original", state: "Pending" }] : [],
        rowCount: options.existing ? 1 : 0,
      };
    if (sql.includes("state='Pending'"))
      return { rows: [], rowCount: options.pending ? 1 : 0 };
    if (sql.includes("sum(reserved)"))
      return {
        rows: [
          { spent: options.spent ?? "0", requests: options.requests ?? "0" },
        ],
      };
    if (sql.includes("public_key=$3"))
      return { rows: [], rowCount: options.replay ? 1 : 0 };
    if (sql.startsWith("INSERT") && options.insertFails)
      throw new Error("database unavailable");
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn();
  const pool = { connect: async () => ({ query, release }) } as unknown as Pool;
  const prepare = vi.fn(async () => {
    order.push("SIGN");
    return { hash: "hash", signed: "bytes" };
  });
  return {
    store: new SponsorshipStore(pool, "testnet:contract:relayer"),
    prepare,
    order,
    release,
  };
}
describe("durable sponsorship reservation", () => {
  it("commits signed bytes before returning them for broadcast", async () => {
    const f = fixture();
    await f.store.reserve(input, f.prepare);
    expect(f.order.findIndex((s) => s.startsWith("INSERT"))).toBeGreaterThan(
      f.order.indexOf("SIGN"),
    );
    expect(f.order.at(-1)).toBe("COMMIT");
    expect(f.release).toHaveBeenCalled();
  });
  it.each([
    { pending: true },
    { spent: "71" },
    { requests: "20" },
    { replay: true },
  ])("rejects unsafe allocation before signing: %j", async (options) => {
    const f = fixture(options);
    await expect(f.store.reserve(input, f.prepare)).rejects.toThrow();
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.order.at(-1)).toBe("ROLLBACK");
  });
  it("returns the existing hash for an identical request without signing", async () => {
    const f = fixture({ existing: true });
    expect(await f.store.reserve(input, f.prepare)).toMatchObject({
      hash: "original",
    });
    expect(f.prepare).not.toHaveBeenCalled();
  });
  it("does not return a transaction when persistence fails", async () => {
    const f = fixture({ insertFails: true });
    await expect(f.store.reserve(input, f.prepare)).rejects.toThrow(
      "database unavailable",
    );
    expect(f.order.at(-1)).toBe("ROLLBACK");
  });
});
