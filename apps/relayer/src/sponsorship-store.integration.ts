import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { SponsorshipStore } from "./sponsorship-store.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  connectionTimeoutMillis: 30000,
  query_timeout: 15000,
});
const scope = `integration-only:${randomUUID()}`;
const store = new SponsorshipStore(pool, scope);
const input = {
  digest: randomUUID(),
  sender: "fixture.testnet",
  publicKey: "fixture-key",
  nonce: 1n,
  workflow: 0,
  method: "pause_workflow",
  reserved: 30n,
  dailyBudget: 100n,
};
let signs = 0;
const prepare = async () => {
  signs++;
  return { hash: `test-hash-${signs}`, signed: "test-only-not-a-transaction" };
};
try {
  const warmOne = await pool.connect();
  const warmTwo = await pool.connect();
  warmOne.release();
  warmTwo.release();
  const outcomes = await Promise.allSettled([
    store.reserve(input, prepare),
    store.reserve(input, prepare),
  ]);
  const firstResult = outcomes[0]!;
  const duplicateResult = outcomes[1]!;
  if (firstResult.status === "rejected") throw firstResult.reason;
  if (duplicateResult.status === "rejected") throw duplicateResult.reason;
  const first = firstResult.value;
  const duplicate = duplicateResult.value;
  assert.equal(first.hash, duplicate.hash);
  assert.equal(signs, 1);
  const afterRestart = new SponsorshipStore(pool, scope);
  assert.equal((await afterRestart.find(input.digest))?.hash, first.hash);
  await assert.rejects(
    store.reserve({ ...input, digest: randomUUID(), nonce: 2n }, prepare),
    /RELAYER_RECONCILING/,
  );
  await store.finalize(input.digest, "Succeeded");
  await assert.rejects(
    store.reserve({ ...input, digest: randomUUID() }, prepare),
    /DELEGATE_REPLAY/,
  );
  await assert.rejects(
    store.reserve(
      { ...input, digest: randomUUID(), nonce: 2n, reserved: 71n },
      prepare,
    ),
    /SPONSOR_BUDGET_EXHAUSTED/,
  );
  const second = await store.reserve(
    { ...input, digest: randomUUID(), nonce: 2n },
    prepare,
  );
  assert.equal(signs, 2);
  assert.equal(second.state, "Pending");
  console.log(
    "PASS: PostgreSQL concurrency, restart recovery, nonce replay, pending lock, and budget enforcement. No chain transaction signed or sent.",
  );
} finally {
  // Remove only rows created under this run's unique integration-test scope.
  await pool.query("DELETE FROM auvora_sponsorship WHERE scope=$1", [scope]);
  await pool.end();
}
