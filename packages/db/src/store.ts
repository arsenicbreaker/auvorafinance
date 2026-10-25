import type {
  HeartbeatInput,
  KeeperStore,
  PendingTransaction,
  TransactionFinalization,
  TransactionSubmission,
  WorkflowSnapshotInput,
} from "./types.js";
import type { AuvoraPrismaClient } from "./client.js";

export class PrismaKeeperStore implements KeeperStore {
  constructor(private readonly client: AuvoraPrismaClient) {}

  async upsertWorkflowSnapshot(input: WorkflowSnapshotInput): Promise<void> {
    const key = {
      network_contractId_workflowId: {
        network: input.network,
        contractId: input.contractId,
        workflowId: input.workflowId,
      },
    };
    const values = {
      ownerId: input.ownerId,
      recipientId: input.recipientId,
      amountYocto: input.amountYocto,
      minReserveYocto: input.minReserveYocto,
      availableYocto: input.availableYocto,
      intervalMs: input.intervalMs,
      nextRunAtMs: input.nextRunAtMs,
      maxRuns: input.maxRuns,
      runsCompleted: input.runsCompleted,
      state: input.state,
      pendingRunIndex: input.pendingRunIndex,
      observedAt: input.observedAt,
    };
    await this.client.workflowSnapshot.upsert({
      where: key,
      create: {
        network: input.network,
        contractId: input.contractId,
        workflowId: input.workflowId,
        ...values,
      },
      update: values,
    });
  }

  async acquireLease(input: {
    network: "testnet";
    contractId: string;
    workflowId: bigint;
    holderId: string;
    now: Date;
    expiresAt: Date;
  }): Promise<boolean> {
    const rows = await this.client.$queryRawUnsafe<
      Array<{ holder_id: string }>
    >(
      `INSERT INTO "keeper_lease"
         ("network", "contract_id", "workflow_id", "holder_id", "expires_at", "acquired_at")
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ("network", "contract_id", "workflow_id") DO UPDATE
       SET "holder_id" = EXCLUDED."holder_id",
           "expires_at" = EXCLUDED."expires_at",
           "acquired_at" = EXCLUDED."acquired_at"
       WHERE "keeper_lease"."expires_at" <= $6
          OR "keeper_lease"."holder_id" = $4
       RETURNING "holder_id"`,
      input.network,
      input.contractId,
      input.workflowId,
      input.holderId,
      input.expiresAt,
      input.now,
    );
    return rows.length === 1 && rows[0]?.holder_id === input.holderId;
  }

  async releaseLease(input: {
    network: "testnet";
    contractId: string;
    workflowId: bigint;
    holderId: string;
  }): Promise<void> {
    await this.client.keeperLease.deleteMany({
      where: {
        network: input.network,
        contractId: input.contractId,
        workflowId: input.workflowId,
        holderId: input.holderId,
      },
    });
  }

  async hasPendingTransaction(input: {
    network: "testnet";
    contractId: string;
    workflowId: bigint;
    runIndex: number;
  }): Promise<boolean> {
    return (
      (await this.client.submittedTransaction.count({
        where: {
          network: input.network,
          contractId: input.contractId,
          workflowId: input.workflowId,
          runIndex: input.runIndex,
          finalState: "Pending",
        },
      })) > 0
    );
  }

  async listPendingTransactions(input: {
    network: "testnet";
    contractId: string;
    signerId: string;
  }): Promise<PendingTransaction[]> {
    const rows = await this.client.submittedTransaction.findMany({
      where: {
        network: input.network,
        contractId: input.contractId,
        signerId: input.signerId,
        finalState: "Pending",
      },
      orderBy: { submittedAt: "asc" },
    });
    return rows.map((row) => ({
      network: row.network as "testnet",
      transactionHash: row.transactionHash,
      contractId: row.contractId,
      workflowId: row.workflowId,
      runIndex: row.runIndex,
      scheduledForMs: row.scheduledForMs,
      amountYocto: row.amountYocto,
      signerId: row.signerId,
    }));
  }

  async recordSubmission(input: TransactionSubmission): Promise<void> {
    await this.client.$transaction([
      this.client.submittedTransaction.upsert({
        where: {
          network_transactionHash: {
            network: input.network,
            transactionHash: input.transactionHash,
          },
        },
        create: {
          network: input.network,
          transactionHash: input.transactionHash,
          contractId: input.contractId,
          workflowId: input.workflowId,
          runIndex: input.runIndex,
          scheduledForMs: input.scheduledForMs,
          amountYocto: input.amountYocto,
          signerId: input.signerId,
          method: input.method,
          submittedAt: input.submittedAt,
          finalState: "Pending",
        },
        update: {},
      }),
      this.client.execution.upsert({
        where: {
          network_contractId_workflowId_runIndex: {
            network: input.network,
            contractId: input.contractId,
            workflowId: input.workflowId,
            runIndex: input.runIndex,
          },
        },
        create: {
          network: input.network,
          contractId: input.contractId,
          workflowId: input.workflowId,
          runIndex: input.runIndex,
          scheduledForMs: input.scheduledForMs,
          amountYocto: input.amountYocto,
          status: "Pending",
          transactionHash: input.transactionHash,
          dispatchedAt: input.submittedAt,
        },
        update: {
          transactionHash: input.transactionHash,
          status: "Pending",
          dispatchedAt: input.submittedAt,
        },
      }),
    ]);
  }

  async finalizeTransaction(input: TransactionFinalization): Promise<void> {
    const finalState = input.status === "Failed" ? "Failed" : "Success";
    await this.client.$transaction([
      this.client.submittedTransaction.update({
        where: {
          network_transactionHash: {
            network: input.network,
            transactionHash: input.transactionHash,
          },
        },
        data: {
          finalState,
          errorCode: input.reasonCode,
          finalizedAt: input.finalizedAt,
        },
      }),
      this.client.execution.upsert({
        where: {
          network_contractId_workflowId_runIndex: {
            network: input.network,
            contractId: input.contractId,
            workflowId: input.workflowId,
            runIndex: input.runIndex,
          },
        },
        create: {
          network: input.network,
          contractId: input.contractId,
          workflowId: input.workflowId,
          runIndex: input.runIndex,
          scheduledForMs: input.scheduledForMs,
          amountYocto: input.amountYocto,
          status: input.status,
          reasonCode: input.reasonCode,
          transactionHash: input.transactionHash,
          finalizedAt: input.finalizedAt,
        },
        update: {
          status: input.status,
          reasonCode: input.reasonCode,
          transactionHash: input.transactionHash,
          finalizedAt: input.finalizedAt,
        },
      }),
    ]);
  }

  async recordHeartbeat(input: HeartbeatInput): Promise<void> {
    await this.client.serviceHeartbeat.upsert({
      where: { serviceId: input.serviceId },
      create: input,
      update: input,
    });
  }

  async disconnect(): Promise<void> {
    await this.client.$disconnect();
  }
}
