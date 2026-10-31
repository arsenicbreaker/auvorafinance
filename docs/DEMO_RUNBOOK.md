# Auvora Demo Runbook

Date prepared: 2026-10-29  
Network: NEAR testnet  
Contract: `oceanear.testnet`

This runbook separates read-only verification from actions that require a human wallet signature. Never paste a seed phrase into a terminal, browser form, or repository file.

## 1. Preflight

From the repository root:

```bash
node --version
pnpm --version
rustc --version
pnpm install --frozen-lockfile
```

Expected:

- Node is version 22.x.
- pnpm is version 12.14.0.
- Rust follows `rust-toolchain.toml`.
- The frozen lockfile install succeeds.

Confirm the four local environment files are ignored:

```bash
git check-ignore .env.deploy.local .env.keeper.local .env.relayer.local apps/web/.env.local
```

Expected: all four paths are printed. Do not print their contents during a demo.

### Local readiness diagnosis

Before connecting a wallet or running payment fixtures:

```bash
pnpm local:doctor
```

It checks the web app at `http://127.0.0.1:3000`. If using the existing production preview, run `pnpm local:doctor --web-url http://127.0.0.1:3010`. Use `--offline` for configuration-only checks or `--json` for structured output. The script reads ignored local configuration and public status; it does not start the keeper, migrate the database, provision keys, or send transactions.

A failed web check means the app is unavailable or the selected port is wrong. A failed keeper check means its readiness response is unavailable, old, mismatched with expected network/contract/signer/instance, or not a recent error-free poll; inspect PostgreSQL, keeper configuration, and logs, then follow the startup commands below. Restart older keeper processes so they expose `healthVersion: 1`. Exit 1 indicates these operational blockers, not a failed automated test. Offline exit 0 does not prove service readiness. Existing web builds may retain older public configuration. Keeper identity is self-reported and does not cryptographically attest the running process. Wallet and scheduled-payment acceptance still require the following demo steps.

## 2. Read final contract state

Run the read-only evidence report:

```bash
pnpm proof:report
```

Expected JSON:

- `network` is `testnet`.
- `contractId` is `oceanear.testnet`.
- `chain.status.status` is `phase-2-ready`.
- Every keeper transaction includes a hash and a testnet NearBlocks URL.
- No private key, signed transaction bytes, database URL, or AI key is printed.

If `keeper.transactions` is empty, the database does not contain the execution evidence. Do not claim a payment hash until it has been captured from a finalized transaction.

The report independently queries each recorded hash at `FINAL`. Only matching signer, receiver, workflow/run/schedule/amount, a single nonpayable `execute_due` action, successful receipt outcomes, and events emitted by the configured contract can produce `evidence.verified: true`. Database `finalState` remains a cached value. Unknown or unavailable RPC results remain unverified.

For inspection without a database:

```bash
pnpm proof:report --chain-only
```

For a strict payment-and-reserve evidence check:

```bash
pnpm proof:report --require-evidence
```

The strict command exits 1 unless at least two distinct payment slots and one reserve rejection are independently verified, no duplicate successful slot is found, and no recorded transaction remains unverified. It does not certify recipient balance deltas, lifecycle controls, concurrency, or process restart; retain separate evidence for those gates.

### Optional signed fixture runner

Preview the concrete fixture plan without sending a transaction:

```bash
pnpm proof:payments
```

After the human approves the displayed accounts, methods, parameters, and deposits:

```bash
pnpm proof:payments --execute
```

The runner loads the ignored keeper and owner deployment environments, verifies that the keeper key is restricted to the contract and `execute_due`, and requires `DEPLOY_CONFIRM` to match the contract. Stop any other keeper against this contract for the proof so external executions do not invalidate balance measurements. It refuses to start with unresolved database submissions.

The two fixtures attach 0.05 testnet NEAR each. If the recipient is not already allowed, another 0.01 testnet NEAR is attached for allowlist storage. The payment fixture sends 0.001 NEAR twice, with a 0.002 NEAR minimum reserve. The rejection fixture has a 0.1 NEAR reserve, exceeding its entire creation deposit. After verification, the runner cancels that fixture and withdraws remaining ledger balances from both fixtures. Storage and gas remain spent.

Public proof records go to ignored `result/phase7-*.jsonl`; execution hashes also remain in PostgreSQL. The journal records owner methods and arguments before submission. On any uncertain owner transaction or failed assertion, inspect the journal and final chain state before running again. It does not automatically recreate fixtures or guess refunds. A stopped proof may leave a funded active fixture requiring owner cancellation and withdrawal.

Owner calls persist their locally computed hash before broadcast and query complete receipts at `FINAL`. After inspecting a stopped run, recover only its recorded fixtures with:

```bash
pnpm proof:payments --cleanup-journal /absolute/path/to/auvora/result/phase7-TIMESTAMP.jsonl
```

Recovery validates the journal's contract, owner, recipient, fixture IDs and configuration hashes, and reconciles known owner hashes first. It skips an already committed cancellation, cancels only the reserve fixture if necessary, and withdraws completed/cancelled balances. It refuses to cancel an unfinished payment fixture or withdraw while a transfer remains pending. No new fixture or deposit is created by this mode.

Recovery reconstructs the client and database store after an intentionally interrupted finality read, then checks that the persisted hash is reconciled without a new signature. Concurrency uses two independent keeper cycles and instance IDs inside one process. Capture separate operating-system restart and multi-process evidence before checking those broader release gates.

For actual OS process termination and multiple keeper processes, preview with `pnpm proof:payments --processes`, then use the approved fixture plan with `pnpm proof:payments --processes --execute`. The parent terminates a worker after persisted broadcast; a recovery-only worker then reconciles its known hash without discovering new due work. Two independent worker processes connect to PostgreSQL, wait at an IPC barrier, and compete for the next slot. Owner and relayer credentials are excluded from worker environments.

If the process collector stops, inspect the journal and final chain state. Resume the existing bounded two-run payment fixture and its reserve proof with:

```bash
pnpm proof:payments --resume-process-journal /absolute/path/to/auvora/result/phase7-TIMESTAMP.jsonl
```

Resume reconciles pending hashes first, checks the recorded payment workflow identity and run limit, skips an already completed payment workflow, reuses an existing reserve fixture, and creates at most the missing reserve fixture. It does not recreate the payment fixture. Do not resume an uncertain owner creation until its hash and workflow identity have been reconciled; use the cleanup-only mode when no further proof execution is intended. The [recorded process proof](phase-7/PROCESS_VALIDATION.md) documents the actual run and its collector interruption.

## 3. Start the product

Terminal A:

```bash
pnpm --filter @auvora/web dev
```

Open <http://localhost:3000>. Expected:

- Header says `NEAR testnet` and `oceanear.testnet`.
- The page has Connect wallet, Set up payment, and Track workflows sections.
- No wallet request appears on page load.

Terminal B, after the database is migrated:

```bash
pnpm db:migrate:deploy
pnpm keeper:dev
```

Expected keeper output is one JSON line per cycle. A healthy idle cycle has `event: "keeper_cycle"`. The `/live` and `/ready` endpoints listen on port `3001` by default.

`/ready` includes `healthVersion`, public `identity`, `readinessReason`, polling timestamps, and `pollRunning`. Expected reasons are `starting`, `poll_failed`, `clock_skew`, `stale`, or `ready`. A failed cycle stays HTTP 503 during retry and only returns HTTP 200 after a complete successful cycle and persisted database heartbeat. `/live` stays HTTP 200 independently of polling readiness. GET and HEAD are supported; responses must not be cached.

## 4. Parse the hero instruction

Paste this non-sensitive instruction into **Describe the payment**:

```text
Pay 0.001 NEAR to oceanrelayer.testnet every minute starting five minutes from now, maximum 2 times, and keep a 0.002 NEAR reserve.
```

Select **Fill payment fields**. Expected:

- The form is populated but remains editable.
- Native NEAR is the only asset.
- Missing or ambiguous start time becomes a clarification instead of a wallet action.
- No wallet opens and no transaction is submitted.

Set **First run (UTC)** to an exact time at least five minutes in the future. Select **Review payment**. Expected:

- Recipient, amount, reserve, interval, first run, maximum runs, storage estimate, and total funding are visible together.
- Changing any field requires another review before creation.

## 5. Human-signed two-run proof

The following actions spend testnet NEAR and require the human to approve the wallet prompt:

1. If the recipient is not allowed, select **Allow recipient** and review the wallet transaction.
2. Select **Create workflow** and review the receiver, method, arguments, and attached testnet deposit in the wallet.
3. Wait for the keeper to discover the workflow after the scheduled time.
4. Let run 1 finalize.
5. Wait one more interval and let run 2 finalize.

Expected final state:

- `runs_completed` is `2`.
- `max_runs` is `2`.
- State is `Completed`.
- There is no pending execution.
- Two distinct finalized `execute_due` transaction hashes are recorded.
- The recipient received exactly 0.001 NEAR in each run.

Run `pnpm proof:report` and copy the two explorer URLs into [Demo evidence](DEMO_EVIDENCE.md). A submitted hash is not enough; confirm final success and the contract's completed state.

## 6. Duplicate and restart evidence

For the duplicate proof, start two keeper instances with different `KEEPER_INSTANCE_ID` values against the same database before a due slot. Expected:

PowerShell for the second instance:

```powershell
$env:KEEPER_INSTANCE_ID = "keeper-2"
$env:KEEPER_HEALTH_PORT = "3002"
pnpm keeper:dev
```

The first instance keeps the values from `.env.keeper.local`, normally `keeper-1` and port `3001`.

- At most one instance acquires the database lease.
- Even if two calls reach the contract, the pending execution slot permits one dispatch.
- The evidence report contains one finalized payment for the workflow and run index.

For the restart proof:

1. Stop the keeper after a transaction hash has been persisted.
2. Restart it with the same database.
3. Confirm it reconciles or rebroadcasts the same signed transaction instead of signing a new one.

Record both hashes if two submissions appear. They must be identical for a safe rebroadcast.

## 7. Reserve-guard proof

The normal web flow intentionally funds all scheduled payments plus reserve, so it cannot create an underfunded workflow accidentally. The reserve rejection therefore needs a dedicated testnet fixture created with only its measured storage deposit and less than `amount + min_reserve` left in its workflow ledger.

The optional fixture runner above automates this proof after approval. A manual fixture also requires signed testnet transactions. Before running either path:

1. Show the exact fixture arguments and attached deposit to the human.
2. Obtain explicit approval for both signed actions.
3. Use a disposable workflow ID.
4. Confirm the execution returns `RESERVE_GUARD`.
5. Confirm recipient balance and workflow balance are unchanged.
6. Record the finalized transaction hash and event log.

Do not simulate this result or substitute a unit-test result for the required live testnet evidence.

## 8. Pause, cancel, and withdrawal

Use a separate funded workflow for lifecycle controls. Each action requires the human wallet:

- Pause before the next due time; keeper calls must not dispatch a payment.
- Resume; the workflow becomes eligible again.
- Cancel; later keeper calls return an inactive result.
- Withdraw only the value shown as owner-withdrawable.

Record the finalized hashes and re-read the workflow after every action. Phase 1 lifecycle evidence already exists, but Phase 7 should capture the final deployed contract behavior too.

## 9. Failure rules

Stop the demo and report the exact blocker when any of these occurs:

- Network or contract ID is not testnet and `oceanear.testnet`.
- Wallet receiver, method, arguments, or attached deposit differ from the review.
- The keeper key is full access or can call methods other than `execute_due`.
- A transaction remains unknown after reconciliation.
- An explorer page disagrees with final RPC state.
- The same workflow and run index produce two successful transfers.
- The reserve fixture changes recipient balance.

Never publish, push, sign a mainnet transaction, or send the hackathon submission as part of this runbook.
