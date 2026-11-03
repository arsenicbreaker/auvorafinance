# Phase 12: integrated acceptance work in progress

## 2026-11-03 live sponsorship acceptance

Four WF-11 management transactions (pause, resume, cancel, withdraw) were independently verified through final testnet RPC receipts. All succeeded with matching contract events, zero attached deposit, and outer signer `oceanrelayer.testnet`. Withdrawal transferred 0.00656 NEAR with a successful callback. Pending-request reload recovery is complete according to the product owner's explicit report; its specific recovered hash was not retained. See [evidence](2026-11-03-sponsored-acceptance.md). This supersedes historical claims below that no live sponsored management action has been accepted. Other live acceptance and balance-snapshot requirements remain unresolved.

## 2026-11-01 management delegate admission

Added the server-side `validateManagementDelegate` and `createManagementSnapshotReader` exports. Intake is bounded, signatures and exact management arguments are checked before RPC, and key/owner checks use one final block. Withdrawal amounts are decimal U128 strings; workflow IDs are limited to exact JavaScript integers. The reader accepts official HTTPS testnet RPC hosts, uses a shared five-second deadline, limits response size, and rejects mismatched blocks or workflow IDs.

Validation: 53 new tests; 61 relayer tests and 365 workspace tests passed. `pnpm check` passed format, lint, typecheck, and tests; `pnpm build` passed. Real read-only attempts using the regular and archival testnet RPC exceeded the snapshot deadline. Live snapshot success remains unverified, and the deadline was not increased to hide the outage. No wallet request, agent signature, transaction broadcast, database migration, or keeper start occurred.

This is admission infrastructure, not an enabled sponsorship service. Durable replay/budget reservations, prepared-transaction journaling, reconciliation, HTTP integration, compatible wallet signing, and existing live acceptance gates remain open. Evidence: `2026-11-01-relayer-admission.json`.

Date: 2026-10-31 (Asia/Jakarta)

## Delivered in this iteration

Added a public read-only execution history to the web app. It reads the owner's workflow IDs at one finalized block, restricts the keeper database query to those IDs and the configured testnet contract, selects only public transaction fields, and independently verifies each recorded hash through finalized RPC and contract-origin events. Cached database success is never enough to label a payment successful.

History is a keeper-derived index, not a complete chain indexer. It can omit older or externally submitted executions. `Pending` and `Unverified` retain real hashes for inspection. Failed receipts remain conservatively unverified when the strict evidence verifier cannot establish a matching terminal business outcome.

The API returns 20 attempts per page, uses a stable timestamp/hash cursor, limits verification concurrency to four, rejects arbitrary query parameters and malformed owners/cursors, limits process-wide requests/concurrency, and returns no-store responses. Connection/query timeouts and a reused pool with two connections bound database work. The browser validates response shape, renders exact integer amounts, suppresses stale requests after owner changes, deduplicates older pages, and supports a keyboard-focusable horizontal table on small screens.

## Baseline and automated verification

Before implementation, `pnpm check` passed 256 tests with formatting/lint/typecheck, followed by a full workspace build.

New tests cover public database projections, owner/contract/network/method scope, cursors, pool reuse and recovery, exact final evidence, failed receipts, wrong transaction identities, reserve skips, unavailable RPC, invalid requests, API rate/concurrency limits, sanitized failures, empty/unconfigured history, owner changes, pagination, and malformed amounts.

| Final gate          | Result                                                   |
| ------------------- | -------------------------------------------------------- |
| `pnpm check`        | PASS: 291 tests, formatting, lint, typecheck             |
| Web suite           | PASS: 117 tests across 13 files                          |
| New database suite  | PASS: six projection, paging, and pool cases             |
| `pnpm build`        | PASS: full workspace including dynamic `/api/executions` |
| High-severity audit | PASS: no high findings; one low and one moderate remain  |

The 35 added tests comprise six database cases and 29 web cases (16 evidence/request parsing, six API, seven component). No new third-party package was downloaded; two existing server workspace dependencies were linked and their lockfile importer entries updated.

The first production compile succeeded but typechecking found that the injected test environment had been inferred as Next's `ProcessEnv`, requiring `NODE_ENV`. The history loader now accepts only a plain dictionary of optional configuration values. Tests use source aliases for the two server-only workspace subpaths so a fresh test run does not require pre-existing compiled files; development startup prepares their compiled output for Next, and full workspace builds use dependency ordering.

## Live read-only observations

The local database contains six keeper transaction records for `oceanear.testnet`. A production API request returned HTTP 200 with four `Succeeded` and two `Skipped` attempts after independent verification.

Initial browser requests failed in the database stage. No false rows were shown. The reader originally opened/disconnected a pool per request; it now reuses a bounded pool and allows ten seconds for connection/query operations. The backend logs only a fixed failure marker and stage, without raw errors or credentials.

A later successful browser read displayed six real attempts at block 275611546: four `Succeeded`, one `Skipped` with the minimum reserve explanation, and one `Unverified` because that individual RPC status check was unavailable. The unavailable result was retained rather than promoted from cached database state. This is a separate observation from the earlier all-verified API response.

At 390 × 844, document width and scroll width were both 375 px. The table scroll region measured 307 px with 700 px of content. Keyboard focus reached that named region and ArrowRight moved its horizontal offset to 40 px while the page stayed at scrollX 0. After resetting the viewport, desktop document width and scroll width both measured 1265 px. Screenshots: [desktop](2026-10-31-desktop-history.jpg), [mobile](2026-10-31-mobile-history.jpg). The application log collector returned no warning/error entries in the successful browser state; the browser integration separately displayed its Statsig initialization warning.

The final production preview also rejected `owner.near` with the full-testnet-account message. Reading `oceanrelayer.testnet` returned an honest empty keeper record at block 275612373, checked at 2026-10-31T14:37:47.886Z. Editing the owner cleared the preceding rows. The final preview was restored to the demo owner, and the temporary viewport override was reset.

The final restored demo-owner read at block 275612462 (2026-10-31T14:38:52.954Z) verified all six existing attempts: four successes and two reserve skips. The screenshots retain the earlier sample with one unavailable status to document that uncertainty is displayed honestly. No new payment occurred between these read-only samples.

The UI retains the existing paper/forest ledger direction with ENERGY 1 / RHYTHM 2 / MOTION 1. It uses labeled inputs, native buttons, table headers/caption, an accessible named scroll region, explicit empty/loading/error states, 48 px input height, existing contrast tokens, and visible keyboard focus. Status is conveyed in text rather than color alone. The scoped antislop purpose/resilience gate passed for the delivered read-only history; it is not a claim that untested wallet/device paths passed acceptance.

The ignored local web environment was configured with `AUVORA_HISTORY_DATABASE_URL` from the already configured keeper database, without printing the URL or copying any wallet/keeper signing key. The new API is read-only. For a deployment, use a database role limited to the required SELECT operations.

## Remaining acceptance gates

### 2026-11-02 sponsored management implementation

A separate sponsored-management connector now requests one timeout-bounded NEP-366 delegate through `@fastnear/wallet` with both `signDelegateActions` and `signDelegateActionsWithTtl` required. The existing creation/funding wallet remains unchanged. The browser constrains the request to one reviewed pause, resume, cancel, or exact contract-reported withdrawal, persists the signed delegate and digest before HTTP submission, scopes recovery by owner/contract/service, and reuses the same delegate after reload without another signature. An unanswered wallet request blocks further signing. An unsubmitted delegate can be discarded only after the service confirms its block-height expiry.

The local relayer service validates network, receiver, method, arguments, zero deposit, signature, full-access key, nonce, TTL, current workflow ownership, origin, size, rate, per-owner request count, and daily budget. PostgreSQL serializes allocation across processes and enforces digest and signer-key-nonce uniqueness. The relayer signs and persists its exact outer transaction hash and bytes before broadcast, then reconciles that hash after restart or an uncertain RPC response. Final success requires matching relayer transaction identity plus the expected contract event and workflow ID. A failed receipt or `workflow_withdrawal_failed` is failure. Creation and funding are not accepted by this service.

The database migration and local service startup passed. PostgreSQL integration checks passed concurrent duplicate collapse, restart recovery, pending-request serialization, nonce replay rejection, and budget enforcement; the test scope was deleted afterward and no chain transaction was signed or sent. Unit/component verification passes 410 tests, including 78 relayer and 166 web tests. Schema validation, format, lint, typecheck, and production build pass. The local health endpoint reports testnet, `oceanear.testnet`, and relayer `oceanrelayer.testnet`; invalid payloads return a bounded error and unapproved origins receive HTTP 403.

The product owner reached the sponsored-action panel through Meteor, establishing that the new connector loaded. The action button was correctly disabled because finalized block 275831551 showed every existing workflow (0 through 10) Completed or Cancelled with zero withdrawable balance. The UI now states this reason and automatically selects the newest actionable workflow. One live sponsored action on a newly created Active/Paused fixture remains the final sponsorship acceptance gate; it must show a distinct relayer-signed hash and the requested owner workflow transition without charging the owner's wallet for transaction gas.

### 2026-11-02 management recovery and withdrawal checks

Management requests now persist an account/contract/RPC-scoped attempt before opening the wallet. Reloading before a hash is returned blocks further owner actions and explicitly displays an unknown outcome. A known rejection releases the attempt; an ambiguous connection error does not. A returned hash is backed up separately from the existing finality journal, including late wallet responses after remount. Only a matching finalized hash clears that backup. A no-hash attempt can be released only through an explicit wallet-activity acknowledgement; that acknowledgement is not proof of transaction failure and must not be used while a transaction is pending. This is not an atomic cross-tab signing lock.

Regression coverage includes remount before wallet response, late hash recovery, ambiguous wallet errors, explicit rejection, corrupt recovery data, backup-only hash reconciliation, disabled withdrawal at zero withdrawable balance, and signing only the contract-reported withdrawable amount. Native Meteor reload/redirect acceptance remains open.

Verification for this change: `pnpm check` passes formatting, lint, typecheck, and 372 tests (145 web tests); `pnpm build` passes for the entire workspace. `cargo fmt --all --check` passes. The five focused Rust withdrawal tests also pass locally on Windows. These checks do not substitute for native-wallet acceptance or a full new sandbox run.

The Rust withdrawal suite passes five tests, including a new active-workflow test rejecting one yoctoNEAR taken from a fully locked balance, exact boundaries, cancellation unlocking funds, pending-fund protection, and failed-transfer restoration. This is automated contract evidence, not a newly signed testnet rejection. The relayer suite passes 61 tests; it does not constitute a deployed sponsorship service.

The installed Meteor Wallet Selector adapter still throws for `signDelegateAction`. However, [FastNEAR's browser wallet documentation](https://github.com/fastnear/js-monorepo/blob/main/packages/x402/README.md) describes a tested Meteor delegate path via `@fastnear/near-connect` with `signDelegateActions` and `signDelegateActionsWithTtl`. This is a candidate connector migration, not an integrated Auvora feature or proof that its x402 payment adapter satisfies arbitrary workflow-management calls. Gas sponsorship remains open pending that integration, durable budget/replay/submission handling, and live wallet acceptance. No wallet software was changed or transaction signed during these checks.

### 2026-11-01 Meteor Cancel follow-up

The user connected Meteor and opened a creation approval for 0.0085 testnet NEAR, then selected Cancel. Their screenshot afterward showed initial form fields and no visible cancellation notice. The live rejection gate therefore remains open. The screenshot alone does not establish whether the page reloaded or a wallet/account transition remounted the builder.

Code inspection found that builder fields and error text were component-local, the account-keyed builder can remount, and the existing journal begins only after a hash is returned. Added a versioned recovery record scoped by owner/contract/RPC that stores reviewed fields and an attempt marker before wallet invocation. An explicit rejection can arrive after a remount and remain visible. Reloaded/unanswered requests remain unknown and block another wallet request until manually reviewed; no cancellation or success is fabricated. Returned hashes remain available through the existing finality journal and a recovery backup. Financial approval and AI instruction text are not restored.

The pre-change targeted web suite passed 117 tests. The updated web suite passes 138 tests: 19 recovery storage/classification cases and two builder remount cases were added. Full `pnpm check` passes 312 tests, formatting, lint, and typecheck. Tests cover draft restoration, account/contract/RPC isolation, pre-wallet persistence, duplicate-request blocking, conservative rejection classification, unknown-result acknowledgement, matching-hash cleanup, late-result guards, corrupt/unavailable storage, and a late rejection after component remount. Native Meteor retesting is still required.

The full workspace production build also passed, and the local web server was restarted on port 3013. No wallet request, signature, or funded fixture was issued by the agent during this fix.

A read-only final snapshot at block 275681705 found the existing six workflows (IDs 0–5), all completed/cancelled, with no pending execution. No new workflow was observed in that snapshot. This is not a substitute for wallet rejection evidence or a full account transaction-history check. The agent signed and broadcast no transaction.

The earlier user draft cannot be recovered retroactively because no pre-wallet record existed. After the updated preview is installed, the user needs to enter it once more and repeat the Cancel test.

Phase 12 is not complete. Real selected-wallet creation, rejection, reload/redirect recovery, supported sponsored management, and missing live lifecycle/rejection evidence remain open. The installed Wallet Selector interface and configured adapters do not expose the delegate-signing flow required by the planned sponsorship service; the relayer currently exports policy/signature verification and a separate proof script, not a product HTTP submission path with persisted budgets/reconciliation. The current management UI uses ordinary wallet calls and now explicitly discloses that the wallet pays testnet gas.

See [live acceptance handoff](LIVE_ACCEPTANCE.md). No new payment fixture, signature, broadcast, deployment, publication, or submission was performed. Automated and read-only checks do not close the live wallet gate or authorize proceeding to Phase 13 as an accepted release.
