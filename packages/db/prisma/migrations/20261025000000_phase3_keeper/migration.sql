CREATE TYPE "TransactionFinalState" AS ENUM ('Pending', 'Success', 'Failed');
CREATE TYPE "ExecutionRecordStatus" AS ENUM ('Pending', 'Succeeded', 'Failed', 'Skipped', 'Ignored');

CREATE TABLE "workflow_snapshot" (
    "network" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "workflow_id" BIGINT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "amount_yocto" TEXT NOT NULL,
    "min_reserve_yocto" TEXT NOT NULL,
    "available_yocto" TEXT NOT NULL,
    "interval_ms" BIGINT NOT NULL,
    "next_run_at_ms" BIGINT NOT NULL,
    "max_runs" INTEGER NOT NULL,
    "runs_completed" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "pending_run_index" INTEGER,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "workflow_snapshot_pkey" PRIMARY KEY ("network", "contract_id", "workflow_id")
);

CREATE TABLE "execution" (
    "network" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "workflow_id" BIGINT NOT NULL,
    "run_index" INTEGER NOT NULL,
    "scheduled_for_ms" BIGINT NOT NULL,
    "amount_yocto" TEXT NOT NULL,
    "status" "ExecutionRecordStatus" NOT NULL,
    "reason_code" TEXT,
    "transaction_hash" TEXT,
    "dispatched_at" TIMESTAMPTZ(3),
    "finalized_at" TIMESTAMPTZ(3),
    CONSTRAINT "execution_pkey" PRIMARY KEY ("network", "contract_id", "workflow_id", "run_index")
);

CREATE TABLE "keeper_lease" (
    "network" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "workflow_id" BIGINT NOT NULL,
    "holder_id" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "acquired_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "keeper_lease_pkey" PRIMARY KEY ("network", "contract_id", "workflow_id")
);

CREATE TABLE "submitted_transaction" (
    "network" TEXT NOT NULL,
    "transaction_hash" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "workflow_id" BIGINT NOT NULL,
    "run_index" INTEGER NOT NULL,
    "scheduled_for_ms" BIGINT NOT NULL,
    "amount_yocto" TEXT NOT NULL,
    "signer_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "final_state" "TransactionFinalState" NOT NULL,
    "error_code" TEXT,
    "finalized_at" TIMESTAMPTZ(3),
    CONSTRAINT "submitted_transaction_pkey" PRIMARY KEY ("network", "transaction_hash")
);

CREATE TABLE "service_heartbeat" (
    "service_id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "last_poll_started_at" TIMESTAMPTZ(3) NOT NULL,
    "last_successful_poll_at" TIMESTAMPTZ(3),
    "last_error_code" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "service_heartbeat_pkey" PRIMARY KEY ("service_id")
);

CREATE INDEX "workflow_snapshot_due_idx" ON "workflow_snapshot" ("network", "contract_id", "state", "next_run_at_ms");
CREATE INDEX "execution_transaction_hash_idx" ON "execution" ("transaction_hash");
CREATE INDEX "keeper_lease_expires_at_idx" ON "keeper_lease" ("expires_at");
CREATE INDEX "submitted_transaction_workflow_idx" ON "submitted_transaction" ("network", "contract_id", "workflow_id", "run_index", "final_state");
CREATE INDEX "service_heartbeat_network_success_idx" ON "service_heartbeat" ("network", "last_successful_poll_at");
