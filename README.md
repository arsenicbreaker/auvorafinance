<div align="center">

<img src="apps/web/public/logo-auvora.png" alt="Auvora" width="160" />

# Auvora Finance

**Recurring NEAR payments with a treasury reserve**

Live website: [auvora.conoisseur.xyz](https://auvora.conoisseur.xyz)

Set a recipient, payment amount, schedule, and minimum reserve. Sign the policy in your testnet wallet, then follow each scheduled payment from the dashboard to its on-chain receipt.

![NEAR Testnet](https://img.shields.io/badge/NEAR-Testnet-155B49?style=for-the-badge)
![Rust](https://img.shields.io/badge/Contract-Rust-68442F?style=for-the-badge)
![Next.js](https://img.shields.io/badge/Web-Next.js-222222?style=for-the-badge)

<img src="docs/auvora-community-fund-payment-stack.png" alt="Auvora community fund payment stack for automated payments on NEAR" width="900" />

[Features](#features) · [How it works](#how-it-works) · [Testnet evidence](#testnet-evidence)

</div>

---

## Problem

A treasury that pays the same recipient every week has two jobs on each due date. Someone has to send the payment and check that enough funds will remain for other obligations.

## Solution

Auvora lets the owner authorize a recurring payment once. A keeper requests each due run, and the NEAR contract checks the signed terms and available balance before releasing funds. The owner can pause the schedule or cancel future runs from the dashboard.

Built for the **NEAR Hackathon 2026**. The MVP handles native NEAR on testnet. It is unaudited.

## Features

| Feature              | What you can do                                                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payment builder      | Enter an instruction, select **Fill payment fields**, then review the recipient, amount, interval, run limit, and reserve before signing. The optional NEAR AI Cloud adapter falls back to deterministic parsing. |
| Workflow management  | Authorize a recipient, create and fund a workflow, then pause, resume, cancel, or withdraw the amount the contract makes available.                                                                               |
| Sponsored management | Sign a delegate for an eligible management action. The relayer pays for the outer transaction. The owner funds workflow creation.                                                                                 |
| Treasury outlook     | Enter a public testnet account to forecast commitments and funding gaps from one finalized block. Model a hypothetical annual return by adjusting principal and APY.                                              |
| Execution record     | Inspect keeper-recorded attempts and check their hashes against finalized RPC outcomes and contract events. Unresolved attempts appear as pending or unverified.                                                  |
| Wallet recovery      | After a reload, reconnect the same owner and check a saved transaction hash. If the wallet closed before returning a hash, review wallet activity before retrying.                                                |

---

## How it works

1. **Draft and approve.** The owner reviews the payment fields, authorizes the recipient, and signs the funded workflow in a NEAR testnet wallet.
2. **Request a due run.** The keeper discovers the workflow and calls `execute_due` with its ID. The contract reads the recipient and amount from the stored policy and checks the schedule, remaining runs, reserve, and pending slot.
3. **Settle the payment.** The contract dispatches the transfer and records its outcome in a callback. A failed transfer restores the reserved ledger amount. After a keeper restart, the worker reconciles its saved transaction hash.
4. **Inspect the result.** Enter the owner's account in **Execution record** to see attempts tracked by the keeper. External transactions can fall outside this index.

For a guided walkthrough with wallet steps and expected results, follow the [demo runbook](docs/DEMO_RUNBOOK.md).

## Testnet evidence

| Recorded result                                                                                                 | Evidence                                                                                                  |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Treasury contract deployed at `oceanear.testnet`                                                                | [Deployment transaction](https://testnet.nearblocks.io/txns/FW1uXWCowcW1W17HUUryk965Rgzrn5h6x3e9tgjiimX1) |
| Workflows 2 and 4 each completed two payments of 0.001 NEAR. Workflows 3 and 5 reached the reserve guard.       | [Payment and reserve report](docs/phase-7/2026-10-30-final-report.json)                                   |
| A restarted worker recovered its transaction hash. Two keeper processes produced one payment for the next slot. | [Keeper process report](docs/phase-7/2026-10-30-process-final-report.json)                                |
| Workflow 11 completed sponsored pause, resume, cancel, and withdrawal with final receipts.                      | [Transactions and contract events](docs/phase-12/2026-11-03-sponsored-acceptance.md)                      |

The NEAR AI Cloud adapter still needs live verification. Remaining acceptance checks cover wallet redirects, device coverage, live contract edge cases, and owner/relayer balance changes. [Live acceptance checklist](docs/phase-12/LIVE_ACCEPTANCE.md)

---

## Architecture and tech stack

| Component                               | Implementation             | Role                                                                                              |
| --------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------- |
| [Web app](apps/web)                     | Next.js, React, TypeScript | Builds payment policies, connects wallets, and displays treasury forecasts and execution history. |
| [Treasury contract](contracts/treasury) | Rust on NEAR               | Enforces payment policies and accounts for transfers, reserves, and withdrawals.                  |
| [Keeper](apps/keeper)                   | Node.js, PostgreSQL        | Discovers due workflows and persists signed transactions before broadcast.                        |
| [Relayer](apps/relayer)                 | Node.js, NEP-366 delegates | Validates owner-signed management requests, reserves a sponsorship budget, and submits them.      |
| [Shared packages](packages)             | TypeScript, Prisma         | Provide workflow schemas, treasury calculations, NEAR RPC clients, and database access.           |

---

## Documentation

- [Demo runbook](docs/DEMO_RUNBOOK.md) and [recorded evidence](docs/DEMO_EVIDENCE.md)
- [Contract interface](docs/phase-1/CONTRACT_INTERFACE.md) and [security model](docs/SECURITY.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md) and [release checklist](docs/RELEASE_CHECKLIST.md)

<div align="center">

**Auvora Finance** · NEAR Hackathon 2026

</div>
