# Auvora Finance

Auvora is a testnet-only recurring native NEAR payment system. A user defines and signs a payment policy, a keeper asks the contract to execute due runs, and the contract enforces the recipient, amount, schedule, run limit, reserve, and workflow ledger.

This repository is a NEAR Hackathon 2026 project. It is not audited, production-ready, or intended for mainnet funds.

## What works

| Capability                                      | Status                              | Authority boundary                                          |
| ----------------------------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| Recurring native NEAR workflow                  | Live on `oceanear.testnet`          | Owner wallet creates and funds it                           |
| Recipient allowlist                             | Live                                | Contract owner signs changes                                |
| Due-run execution and callback accounting       | Live                                | Keeper supplies only the workflow ID; contract decides      |
| Pause, resume, cancel, and safe withdrawal      | Live                                | Workflow owner signs each action                            |
| Keeper discovery and restart reconciliation     | Implemented                         | Restricted keeper key and PostgreSQL records                |
| Sponsored nonpayable call proof                 | Live proof recorded                 | Relayer cannot sponsor deposits or change signed arguments  |
| Natural-language draft parsing                  | Implemented locally                 | Produces editable fields only; cannot open or sign a wallet |
| NEAR AI Cloud adapter                           | Configurable, not yet live-verified | Falls back to deterministic parsing when unavailable        |
| Mainnet, stablecoins, swaps, lending, and yield | Not implemented                     | Outside the MVP                                             |

The live contract returned `phase-2-ready` at finality on 2026-10-30. Workflows `2` and `4` each completed two scheduled 0.001 NEAR payments with distinct finalized hashes; workflows `3` and `5` returned `RESERVE_GUARD`. All four fixture ledgers were withdrawn to zero. A keeper-cycle worker was terminated after broadcast and a separate OS process reconciled its persisted hash without submitting a replacement. Two independent keeper processes also produced one payment for the next slot. Direct concurrent contract triggers and remaining lifecycle/product gates stay open. See [Demo evidence](docs/DEMO_EVIDENCE.md).

## Judge path: do X, see Y

1. Install the pinned tools and dependencies.
2. Start the web app.
3. Connect a NEAR testnet wallet that owns the workflow.
4. Enter the example payment instruction and select **Fill payment fields**.
5. See an editable native NEAR draft. No wallet opens at this step.
6. Review the canonical fields. The wallet opens only for an explicit on-chain action.
7. Start the keeper and wait until a due workflow finalizes.
8. Run the evidence report to read final contract state and recorded transaction hashes.

The exact commands, expected outputs, and human-only signing steps are in [Demo runbook](docs/DEMO_RUNBOOK.md).

## Prerequisites

- Node.js 22.x
- Corepack with pnpm 12.14.0
- Rust 1.99.1 with `rustfmt`, `clippy`, and `wasm32-unknown-unknown`
- `cargo-near` 0.22.0
- PostgreSQL for the keeper evidence store
- Linux, WSL2, or Ubuntu CI for the `near-workspaces` sandbox test
- A NEAR testnet wallet only when performing the human-signed demo path

```bash
corepack enable
corepack prepare pnpm@12.14.0 --activate
pnpm install --frozen-lockfile
rustup show
cargo install --locked cargo-near --version 0.22.0
```

## Configuration

Use [.env.example](.env.example) as the field list. Keep credentials only in ignored local files or deployment secret stores:

- `apps/web/.env.local`: public browser configuration only.
- `.env.keeper.local`: restricted keeper account and database configuration.
- `.env.relayer.local`: separately funded relayer configuration.
- `.env.deploy.local`: owner deployment credentials for an explicitly approved deployment or upgrade.

Never paste a seed phrase into the app. Never commit a private key or AI provider key.

Minimal web configuration:

```dotenv
NEXT_PUBLIC_NEAR_RPC_URL=https://rpc.testnet.near.org
NEXT_PUBLIC_AUVORA_CONTRACT_ID=oceanear.testnet
```

Optional AI provider configuration:

```dotenv
AI_PROVIDER=near-ai
NEAR_AI_BASE_URL=https://cloud-api.near.ai
NEAR_AI_API_KEY=
AI_MODEL=
AI_TIMEOUT_MS=8000
```

If the provider key or model is absent, the web app keeps the manual form available and uses the deterministic parser for supported instructions.

## Run locally

Web:

```bash
pnpm --filter @auvora/web dev
```

Keeper, after the database migration and restricted-key setup:

```bash
pnpm db:migrate:deploy
pnpm keeper:dev
```

The keeper exposes `/live` and `/ready` on port `3001` by default. It persists signed transaction bytes and the derived hash before broadcast, then reconciles that same hash after restart or an uncertain RPC response.

Read-only evidence report:

```bash
pnpm proof:report
```

The report reads final contract views plus the keeper's transaction records. It never imports a wallet key into the browser and never submits a transaction.

It independently verifies recorded execution hashes with final RPC outcomes and contract-origin events. Use `pnpm proof:report --chain-only` without database access, or `pnpm proof:report --require-evidence` to fail when the payment-and-reserve evidence is incomplete. Neither command certifies all MVP release gates.

`pnpm proof:payments` previews the two signed Phase 7 fixtures without sending transactions. After human approval, `pnpm proof:payments --execute` runs the scheduled payments, reserve rejection, persisted-hash recovery, and concurrent keeper cycles, then withdraws remaining fixture balances. Read the accounts, testnet deposits, limitations, and recovery instructions in the [Demo runbook](docs/DEMO_RUNBOOK.md) first.

## Validation commands

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm audit --audit-level high
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --locked
cargo audit
cd contracts/treasury
cargo near build non-reproducible-wasm --locked
```

Native Windows supports the TypeScript checks and Rust unit tests. Run the sandbox integration test on Linux, WSL2, or Ubuntu CI.

## Security boundary

- AI output is untrusted draft data.
- The user reviews canonical fields before a wallet request.
- The keeper cannot choose a recipient, amount, reserve, or schedule.
- `execute_due` accepts a workflow ID and the contract re-checks every policy.
- One pending execution slot prevents duplicate dispatch for the same run.
- Failed transfer callbacks restore the reserved ledger amount once.
- Withdrawals cannot consume active obligations, reserve, or pending value.
- The MVP is testnet-only and remains upgrade-trusted.

Read [Security model](docs/SECURITY.md) and [Known limitations](docs/KNOWN_LIMITATIONS.md) before relying on a demo result.

## Testnet evidence already recorded

- Contract deployment: [FW1uXWCowcW1W17HUUryk965Rgzrn5h6x3e9tgjiimX1](https://testnet.nearblocks.io/txns/FW1uXWCowcW1W17HUUryk965Rgzrn5h6x3e9tgjiimX1)
- Phase 1 upgrade: [6Pi8aHBnWEXsnaUdX2CDVZFr5sdT8U1Q717xt3XsQb6c](https://testnet.nearblocks.io/txns/6Pi8aHBnWEXsnaUdX2CDVZFr5sdT8U1Q717xt3XsQb6c)
- NEAR dependency hardening upgrade: [BpAT9eRzUT3fHbiYDnMXSUMi9856qcfX5hzbK69XniW8](https://testnet.nearblocks.io/txns/BpAT9eRzUT3fHbiYDnMXSUMi9856qcfX5hzbK69XniW8)
- Restricted keeper call: [DdDZQzEGBFWbAvQfb1cr5t1qyBo1y8ar2xF1St8UaNNd](https://testnet.nearblocks.io/txns/DdDZQzEGBFWbAvQfb1cr5t1qyBo1y8ar2xF1St8UaNNd)
- Sponsored relayer proof: [5tXH5JGDeyf9WhkCED94E9D7yqGtERNEh3HhYYrEcY7H](https://testnet.nearblocks.io/txns/5tXH5JGDeyf9WhkCED94E9D7yqGtERNEh3HhYYrEcY7H)
- Owner wallet proof: [MFaieneZw88gcdhwSsneX5h6jBibeNrDjmJQGPow7Nd](https://testnet.nearblocks.io/txns/MFaieneZw88gcdhwSsneX5h6jBibeNrDjmJQGPow7Nd)
- Phase 1 lifecycle hashes: [Phase 1 validation](docs/phase-1/VALIDATION.md)

## Documentation

- [Demo runbook](docs/DEMO_RUNBOOK.md)
- [Demo evidence](docs/DEMO_EVIDENCE.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Technology stack](docs/TECH_STACK.md)
- [Security model](docs/SECURITY.md)
- [Phase 0 validation](docs/phase-0/VALIDATION.md)
- [Phase 1 validation](docs/phase-1/VALIDATION.md)

## Publication boundary

Repository publication, the public demo post, and the final hackathon submission are human actions. The submission must not be sent until the human reviews and explicitly confirms the exact immutable payload described in [HACKATHON.md](HACKATHON.md).
