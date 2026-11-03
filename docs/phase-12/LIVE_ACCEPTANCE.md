# Phase 12 live acceptance handoff

## Current update: 2026-11-03

WF-11 sponsored Pause, Resume, Cancel, and Withdraw are now independently verified at FINAL through testnet RPC, with matching contract events and relayer signer `oceanrelayer.testnet`. Withdrawal transferred 0.00656 NEAR successfully. The product owner also reports completing the pending-request reload recovery test. See [recorded evidence and remaining boundaries](2026-11-03-sponsored-acceptance.md). The older statements below about needing a first active sponsorship fixture are superseded; do not request another fixture to repeat these completed tests. Balance-delta snapshots and other unresolved live acceptance gates remain open.

Status: open. The new execution history can be reviewed without a wallet at `http://127.0.0.1:3013/#history`.

Selected wallet: **Meteor Wallet**, chosen by the product owner on 2026-10-31. Installed integration: `@near-wallet-selector/meteor-wallet` 10.1.4 with `@meteorwallet/sdk` 1.0.24. Start at `http://127.0.0.1:3013/#proof`, select **Connect wallet**, choose **Meteor Wallet**, and use a testnet account. Connection/signature acceptance is not yet verified. The product owner corrected the sender to `oceanear.testnet`, verified to exist at final block 275615075. A distinct recipient is preferred for observable balance deltas; existing project test recipient `oceanrelayer.testnet` was verified at block 275615076 and proposed for the draft, but its selection is still pending.

## Reviewable wallet test plan

### 2026-11-02 desktop Meteor observations

Follow-up evidence: the user's execution-history screenshot checked at 2026-11-02T00:59:01.456Z shows WF-008 runs 1 and 2 as `Succeeded`, each 0.001 NEAR, with distinct transaction links (hashes truncated in the screenshot). Older records show `Unverified`; this does not establish failure. The user then reported cancel/withdraw for WF-009 and pause/resume/cancel/withdraw for WF-010. A finalized read at block 275828084 independently confirms both WF-009 and WF-010 are `Cancelled`, with zero completed runs, zero available and withdrawable balances, and no pending execution. The intermediate pause/resume transitions are user-reported; this final-state read does not independently prove their transaction receipts. Reload/redirect recovery, locked-withdrawal rejection, and gas sponsorship remain open.

The user's Brave screenshots show an explicit Meteor creation rejection (`User cancelled the action`) with the reviewed form retained, followed by successful creation visible as WF-006. The user subsequently reported WF-008 completed with two runs. A read-only finalized RPC query at block 275825636 independently confirms WF-008 is `Completed`, `runs_completed: 2`, `max_runs: 2`, `available_balance: 0`, `withdrawable: 0`, and no pending execution. Recipient is `oceanrelayer.testnet`, amount per run is 0.001 NEAR. This state check does not independently verify each payment transaction hash, recipient balance deltas, or the withdrawal receipt.

The deprecated `rpc.testnet.near.org` endpoint returned explicit retirement errors. Local web/keeper configuration and current application defaults now use `https://test.rpc.fastnear.com`, verified to report testnet. Remaining gates include per-transaction evidence, reload/redirect recovery, pause/resume and locked-withdrawal rejection, and sponsored management. The historical setup statements above predate these observations; Phase 12 remains open.

After the 2026-11-01 recovery update, hard-refresh the local preview once before retesting. The preceding draft was lost before persistence existed and must be entered once more. On subsequent return/remount, expect restored fields without restored approval. A known rejection should remain visible; an interrupted request with no returned hash must remain explicitly unknown. Check Meteor activity before manually clearing an interrupted request, and wait if a transaction is pending. This native retest remains open despite passing automated remount regressions.

Use a human-controlled NEAR testnet wallet and a recipient account controlled by the tester. Do not paste a seed phrase or private key into the app or chat.

1. Connect Meteor Wallet and record wallet/version/account plus desktop/mobile context.
2. Fill a manual draft: 0.001 NEAR per run, every minute, maximum two runs, 0.002 NEAR reserve, first run at least five minutes after review. The exact recipient, UTC start time, storage quote, and attached total must be displayed and reviewed before any signature. Scheduled payments total 0.002 NEAR; payments plus reserve total 0.004 NEAR, with the measured storage deposit additional.
3. If authorization is needed, review `add_allowed_recipient` and its separate 0.001 NEAR attached storage allowance. If already authorized, skip that action.
4. Reject the first creation wallet request. Expect no success message, no fabricated hash, and an editable/reviewable form.
5. Review again, approve `create_workflow` only after inspecting the exact fields and deposit, and record its hash. This step needs the human to approve in the wallet; no transaction has been pre-approved by this document.
6. Start the keeper only after checking database access, `pnpm local:doctor`, its restricted key, and the active funded workflows it could execute. Wait for two finalized payments and compare recipient/ledger deltas with the final RPC evidence. Read the new execution history and inspect both real hashes.
7. If a real wallet response returns a hash before finality is known, reload and reconnect the same account on the same origin/contract/RPC. The original hash should be checked without another signature. A redirect before a hash is returned remains a documented recovery limitation.
8. Use a separately reviewed lifecycle fixture for pause/resume/cancel and locked-withdrawal rejection. Do not assume a completed fixture proves those rejection paths. Record exact arguments and funding before authorizing it.

## Sponsorship blocker

Update on 2026-11-02: the technical blocker below has been addressed with a separate FastNEAR connector and a durable local sponsorship service. Automated validation and local database/service checks pass. The product owner reached the sponsored-action panel through Meteor, but no action was eligible because all existing workflows were final with zero withdrawable balance. Final live acceptance now requires creating one reviewed Active fixture, signing a sponsored pause (or another eligible management action), and verifying its distinct relayer transaction hash, finalized contract event, resulting workflow state, and owner/relayer balance deltas. Until that evidence exists, Phase 12 remains open.

Supported nonpayable management still requires an integrated NEP-366-capable wallet signing path, a constrained HTTP relayer, persisted request/budget/replay state, pre-broadcast hash journaling, reconciliation, and end-to-end balance verification. The installed general Wallet Selector adapter does not expose that delegate-signing capability. No gasless claim or fallback that silently charges gas counts as satisfying the sponsorship criterion. The ordinary wallet path is disclosed for manual testnet testing.

The installed Meteor adapter's runtime bundle contains a `signDelegateAction` method, but its body throws `Method not supported by ${metadata.name}`. The method's presence is not evidence of support. Its ordinary `signAndSendTransaction(s)` path forwards requests to the Meteor SDK. This audit reads the installed implementation; it is not live wallet acceptance. No wallet software was installed, no login was performed, and no signature or transaction was requested in this step.

## Evidence to retain

Record actual final hashes, method/receiver/deposit, rejection outcomes, account balance deltas, workflow/run counters, wallet screenshots without secrets, and the evidence report. Keep submitted/unknown status separate from final success. Missing or conflicting evidence leaves the corresponding gate open.

Phase 13 remains pending until these acceptance items are resolved or the product owner explicitly revises the MVP scope. Publication and immutable hackathon submission retain their separate human review requirements.
