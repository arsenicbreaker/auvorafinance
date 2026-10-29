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

This step is not automated by the current runbook because creating the fixture and calling `execute_due` both require signed testnet transactions. Before running it:

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
