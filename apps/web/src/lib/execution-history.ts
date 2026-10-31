export type ExecutionStatus =
  | "Succeeded"
  | "Failed"
  | "Skipped"
  | "Pending"
  | "Unverified";
export interface ExecutionHistoryRow {
  hash: string;
  workflowId: string;
  runIndex: number;
  amountYocto: string;
  submittedAt: string;
  status: ExecutionStatus;
  reason: string | null;
}
export interface ExecutionHistoryPage {
  ownerId: string;
  contractId: string;
  observedAt: string;
  blockHeight: number;
  rows: ExecutionHistoryRow[];
  nextCursor: string | null;
}

export function parseExecutionHistoryPage(
  value: unknown,
): ExecutionHistoryPage {
  const page = value as ExecutionHistoryPage | null;
  const hashes = new Set<string>();
  if (
    !page ||
    typeof page.ownerId !== "string" ||
    typeof page.contractId !== "string" ||
    !Number.isSafeInteger(page.blockHeight) ||
    page.blockHeight < 0 ||
    !Number.isFinite(Date.parse(page.observedAt)) ||
    !(page.nextCursor === null || typeof page.nextCursor === "string") ||
    !Array.isArray(page.rows) ||
    page.rows.length > 20 ||
    page.rows.some((row) => {
      if (
        !row ||
        !/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(row.hash) ||
        hashes.has(row.hash) ||
        !/^\d{1,16}$/.test(row.workflowId) ||
        !Number.isSafeInteger(Number(row.workflowId)) ||
        !Number.isSafeInteger(row.runIndex) ||
        row.runIndex < 0 ||
        row.runIndex > 999 ||
        !/^[1-9]\d{0,38}$/.test(row.amountYocto) ||
        BigInt(row.amountYocto) > (1n << 128n) - 1n ||
        !Number.isFinite(Date.parse(row.submittedAt)) ||
        !["Succeeded", "Failed", "Skipped", "Pending", "Unverified"].includes(
          row.status,
        ) ||
        !(row.reason === null || typeof row.reason === "string")
      )
        return true;
      hashes.add(row.hash);
      return false;
    })
  )
    throw new Error(
      "History returned an unreadable result. Try refreshing the record.",
    );
  return page;
}
