import { Pool } from "pg";

export type SponsoredRequest = {
  digest: string;
  sender: string;
  workflow: number;
  method: string;
  hash: string;
  signed: string;
  state: "Pending" | "Succeeded" | "Failed";
};

export const sponsorshipSchema = `
CREATE TABLE IF NOT EXISTS auvora_sponsorship (
  digest text PRIMARY KEY,
  scope text NOT NULL,
  sender text NOT NULL,
  public_key text NOT NULL,
  nonce numeric(20,0) NOT NULL,
  workflow bigint NOT NULL,
  method text NOT NULL,
  hash text NOT NULL,
  signed text NOT NULL,
  reserved numeric(39,0) NOT NULL CHECK (reserved > 0),
  state text NOT NULL CHECK (state IN ('Pending','Succeeded','Failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope,sender,public_key,nonce)
);
CREATE INDEX IF NOT EXISTS auvora_sponsorship_scope_date ON auvora_sponsorship(scope,created_at);
`;

export class SponsorshipStore {
  constructor(
    readonly pool: Pool,
    readonly scope: string,
  ) {}

  async find(digest: string): Promise<SponsoredRequest | null> {
    const result = await this.pool.query<SponsoredRequest>(
      "SELECT digest,sender,workflow::int,method,hash,signed,state FROM auvora_sponsorship WHERE scope=$1 AND digest=$2",
      [this.scope, digest],
    );
    return result.rows[0] ?? null;
  }

  async pending(): Promise<SponsoredRequest[]> {
    return (
      await this.pool.query<SponsoredRequest>(
        "SELECT digest,sender,workflow::int,method,hash,signed,state FROM auvora_sponsorship WHERE scope=$1 AND state='Pending' ORDER BY created_at LIMIT 1",
        [this.scope],
      )
    ).rows;
  }

  async finalize(digest: string, state: "Succeeded" | "Failed") {
    await this.pool.query(
      "UPDATE auvora_sponsorship SET state=$3 WHERE scope=$1 AND digest=$2 AND state='Pending'",
      [this.scope, digest, state],
    );
  }

  async reserve(
    input: {
      digest: string;
      sender: string;
      publicKey: string;
      nonce: bigint;
      workflow: number;
      method: string;
      reserved: bigint;
      dailyBudget: bigint;
    },
    prepare: () => Promise<{ hash: string; signed: string }>,
  ): Promise<SponsoredRequest> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize signing, budget checks, and nonce allocation across service processes.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [this.scope],
      );
      const existing = await client.query<SponsoredRequest>(
        "SELECT digest,sender,workflow::int,method,hash,signed,state FROM auvora_sponsorship WHERE scope=$1 AND digest=$2",
        [this.scope, input.digest],
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return existing.rows[0];
      }
      const pending = await client.query(
        "SELECT 1 FROM auvora_sponsorship WHERE scope=$1 AND state='Pending' LIMIT 1",
        [this.scope],
      );
      if (pending.rowCount) throw new Error("RELAYER_RECONCILING");
      const budget = await client.query<{ spent: string; requests: string }>(
        "SELECT COALESCE(sum(reserved),0)::text AS spent, count(*) FILTER (WHERE sender=$2)::text AS requests FROM auvora_sponsorship WHERE scope=$1 AND created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",
        [this.scope, input.sender],
      );
      if (BigInt(budget.rows[0]!.spent) + input.reserved > input.dailyBudget)
        throw new Error("SPONSOR_BUDGET_EXHAUSTED");
      if (Number(budget.rows[0]!.requests) >= 20)
        throw new Error("OWNER_DAILY_LIMIT");
      const replay = await client.query(
        "SELECT 1 FROM auvora_sponsorship WHERE scope=$1 AND sender=$2 AND public_key=$3 AND nonce=$4",
        [this.scope, input.sender, input.publicKey, input.nonce.toString()],
      );
      if (replay.rowCount) throw new Error("DELEGATE_REPLAY");
      const prepared = await prepare();
      await client.query(
        "INSERT INTO auvora_sponsorship (digest,scope,sender,public_key,nonce,workflow,method,hash,signed,reserved,state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Pending')",
        [
          input.digest,
          this.scope,
          input.sender,
          input.publicKey,
          input.nonce.toString(),
          input.workflow,
          input.method,
          prepared.hash,
          prepared.signed,
          input.reserved.toString(),
        ],
      );
      await client.query("COMMIT");
      return {
        digest: input.digest,
        sender: input.sender,
        workflow: input.workflow,
        method: input.method,
        ...prepared,
        state: "Pending",
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
