# Auvora Finance MVP Implementation Plan

Status: Phases 1–6 are implemented; Phase 7 live/product acceptance remains in progress. Phases 8–11 (treasury planning, transaction recovery, local diagnostics, and keeper readiness) are implemented and tested locally. Two closing phases remain: integrated wallet/payment acceptance and the release/demo package. Live evidence and product acceptance remain release gates.

Rule: do not begin a phase until the prior phase is accepted by the product owner

On 2026-10-31, the product owner explicitly requested continuing to the next development phase with testing before progression. Phase 8 development therefore followed a passing Phase 7 automated baseline; the open live/product release gates were not marked accepted.

## 1. Delivery strategy

The plan optimizes for one verified end-to-end flow rather than feature count. The critical path is:

```text
manual reviewed config
  -> owner-signed workflow
  -> funded testnet ledger
  -> keeper trigger
  -> finalized native NEAR payment
  -> reserve rejection
  -> pause/cancel and safe withdrawal
```

The AI parser is added after the deterministic manual path works. This ordering preserves the PRD requirement that provider failure cannot break the demo.

Every phase ends with evidence. A screenshot without a test log, transaction hash, or reproducible command is not acceptance evidence.

### Hackathon constraints carried into the plan

- Development window: 2026-11-01 00:00 UTC through 2026-11-14 23:59 UTC, which is 2026-11-01 07:00 WIB through 2026-11-15 06:59 WIB.
- The repository must be public before the deadline and understandable by both human and AI judges.
- The human team publishes the public X demo post and supplies its URL. The application agent does not post it.
- There is one final submission per team and it cannot be edited.
- The exact submission JSON must be shown to and explicitly approved by the human before sending.
- Project identity, lead name, email, team size, mainnet payout account, repository URL, demo URL, track list, description, and consent must never be invented.
- Primary track is `business`. Additional track claims require working evidence in the final build.
- The live `HACKATHON.md` must be fetched again immediately before publication and submission because the local file warns that rules can change.

## 2. Phase 0: foundation and dependency proof

### Objective

Establish a reproducible monorepo and prove that the chosen current NEAR libraries work together before product code expands.

### PRD requirements

- Enables FR-01 and the contract foundation for FR-05 through FR-09.
- Enforces the testnet-only and no-secret engineering constraints.

### Technical approach

- Create pnpm workspace, TypeScript strict configuration, Rust contract crate, environment schema, and CI.
- Pin stable dependencies and commit lockfiles.
- Build a minimal contract and deploy it to a disposable sandbox.
- Prove Wallet Selector testnet login, a view call, and a harmless signed call.
- Prove `near-api-js` keeper signing with a restricted test account.
- Prove the selected wallet can sign a NEP-366 delegate action and a test relayer can validate, submit, and finalize it.
- Run `near-workspaces` on Ubuntu CI because native Windows sandbox support is not documented.
- Timebox HOT Kit to four hours and record pass/fail against the criteria in `TECH_STACK.md`.

### Files to create or modify

- Root workspace manifests and toolchain files.
- `apps/web/` minimal shell.
- `apps/keeper/` minimal health process.
- `apps/relayer/` minimal policy and delegate-action proof.
- `contracts/treasury/` minimal contract and tests.
- `packages/config/`.
- `.github/workflows/ci.yml`.
- `.env.example` with names only.
- `README.md` development setup.

### Acceptance criteria

- Fresh clone setup succeeds using documented Node/Rust versions.
- TypeScript typecheck and Rust format/clippy/test pass in CI.
- Contract WASM builds with `cargo-near`.
- Sandbox test deploys and calls one method.
- Testnet wallet connects and displays the exact account ID and network.
- A user signs a harmless testnet contract call and its final status is displayed.
- Keeper proof uses a function-call key restricted to the test contract method.
- A nonpayable owner action succeeds through the relayer without charging the user's wallet for gas.
- The relayer rejects a wrong receiver, unknown method, expired delegate action, altered arguments, and any attached deposit.
- Secret scan reports no committed key material.
- HOT decision record selects or rejects HOT for the MVP based on observed behavior.

### Stop condition

Do not begin Phase 1 until the toolchain and wallet path are reproducible on a second run.

## 3. Phase 1: contract policy and accounting core

### Objective

Implement the smallest contract that can create, fund, inspect, pause, resume, cancel, and safely withdraw a workflow without sending payments yet.

### PRD requirements

- FR-05 payment configuration.
- FR-06 reserve guard, allowlist, and transaction limit.
- FR-08 owner controls and safe withdrawal.

### Technical approach

- Define bounded workflow, state, allowlist, ledger, and config hash types.
- Keep financial fields immutable; edits use replacement workflows.
- Charge storage to the creator and separate storage/operational funds from workflow ledger liability.
- Implement conservative active-workflow withdrawal formula.
- Emit versioned NEP-297 events for every state transition.
- Add invariant helpers used by methods and tests.

### Files to create or modify

- `contracts/treasury/src/lib.rs` and focused modules for types, policy, accounting, and events.
- Contract unit and sandbox tests.
- `packages/workflow-schema/` canonical TypeScript schema.
- `packages/domain/` amount and schedule utilities.
- Contract interface documentation in `docs/`.

### Acceptance criteria

- Only owner can mutate or withdraw from a workflow.
- Recipient must be allowlisted.
- A workflow cannot be created with zero amount, invalid interval, invalid max runs, or amount above max per run.
- Funding credits only the target workflow ledger.
- A workflow cannot spend or withdraw another workflow's ledger.
- Exact reserve/withdrawal boundary tests pass at yoctoNEAR precision.
- Pause, resume, cancel, completed, and invalid transitions are tested.
- Storage underpayment fails and excess handling is tested.
- No floating point appears in contract or money conversion code.

### Stop condition

Do not implement keeper execution until ledger conservation and withdrawal tests pass.

## 4. Phase 2: async payment execution and idempotency

### Objective

Execute native NEAR payments safely and prove that retries or concurrent triggers cannot pay a run twice.

### PRD requirements

- FR-07 keeper-triggered execution and idempotency.
- FR-09 pending, success, failed, and skipped audit states.
- Demo criteria for successful and reserve-blocked execution.

### Technical approach

- Implement permissionless, nonpayable `execute_due(workflow_id)`.
- Derive the execution slot from contract state.
- Reserve the slot and move funds from available to pending before creating the transfer promise.
- Implement a minimal private callback that advances the run and schedule on success, or restores funds and leaves the same slot retryable on confirmed failure.
- Emit stable reason codes such as `NOT_DUE`, `PAUSED`, `RECIPIENT_NOT_ALLOWED`, `RESERVE_GUARD`, `ALREADY_DISPATCHED`, and `TRANSFER_FAILED`.
- Halt new dispatch while an execution is unresolved.

### Files to create or modify

- Contract execution, callback, and event modules.
- Contract unit and `near-workspaces` tests.
- Shared event and error-code types.
- A test-only recipient setup and failure fixture.

### Acceptance criteria

- A due funded workflow transfers the exact native NEAR amount in sandbox.
- Two concurrent trigger attempts produce at most one transfer.
- Retrying the same execution slot cannot produce a second transfer.
- A transfer that would breach reserve is skipped and emits `RESERVE_GUARD`.
- Transfer failure restores the workflow ledger exactly once.
- A failed transfer does not consume one of `max_runs`; a later retry targets the same scheduled slot.
- Direct external callback invocation fails.
- Pause or cancel prevents future dispatch but does not misreport an already pending transfer.
- Max runs transitions the workflow to completed.
- Missed-run behavior matches the approved product decision.

### Stop condition

Do not deploy the keeper until concurrency and failed-callback-path tests pass.

## 5. Phase 3: keeper and reconciliation

### Objective

Run scheduled execution without browser involvement and produce finality-aware evidence.

### PRD requirements

- FR-07 configurable polling scheduler.
- FR-09 transaction status and explorer history.

### Technical approach

- Add PostgreSQL schema and migrations.
- Discover workflows in bounded contract-view pages.
- Acquire expiring per-workflow leases.
- Re-read chain state before submission.
- Submit with a method-restricted function-call key.
- Wait for finality and parse Auvora events.
- Reconcile unknown submissions by hash before retry.
- Expose liveness/readiness and last-poll metrics.

### Files to create or modify

- `apps/keeper/src/` modules.
- `packages/db/` Prisma schema and migrations.
- `packages/near-client/` RPC, signer, event parser, and explorer helpers.
- Keeper container/deployment files.
- Integration tests with fake RPC responses plus a testnet smoke script.

### Acceptance criteria

- Keeper discovers and executes a due workflow with no browser open.
- Keeper restart does not duplicate an in-flight or finalized run.
- Two keeper processes cause at most one on-chain payment.
- Unknown RPC outcome is reconciled before retry.
- Restricted key cannot call pause, cancel, fund, allowlist, or withdraw methods.
- Health endpoint exposes last successful poll without secrets.
- A real testnet payment reaches `FINAL` and has a valid transaction hash.

### Stop condition

Do not build dashboard success claims until finality and reconciliation behavior are validated.

## 6. Phase 4: gas sponsorship relayer

### Objective

Make supported workflow-management actions gas-sponsored without giving Auvora custody of the user's wallet key.

### PRD requirements

- Improves FR-01 onboarding and FR-08 controls while preserving explicit user authorization.
- Maintains the rule that the AI has no wallet authority.

### Technical approach

- User signs a short-lived NEP-366 delegate action containing the exact Auvora contract call.
- Relayer decodes and validates receiver, method, arguments, nonce, expiry, network, and sponsorship budget.
- Relayer rejects attached deposits and arbitrary batches.
- Relayer submits, waits for finality, and returns a transaction hash.
- Initial native NEAR funding remains a normal user-signed payable transaction because a meta-transaction relayer would otherwise pay the attached balance too.
- Testnet onboarding provides faucet guidance or a small allocation sufficient for the deposit transaction's gas.

### Files to create or modify

- `apps/relayer/src/` policy, delegate validation, submission, reconciliation, and health modules.
- `packages/near-client/` delegate-action types and signing adapter.
- Database sponsorship request and budget tables.
- Web transaction adapter for sponsored versus payable actions.
- Relayer integration and abuse tests.

### Acceptance criteria

- Eligible nonpayable owner actions use the approved sponsorship path.
- User wallet is not charged gas for a successfully sponsored action.
- Contract still identifies and authorizes the user as workflow owner.
- Relayer cannot change signed arguments.
- Wrong contract, wrong method, wrong network, expired height, invalid nonce/signature, attached deposit, duplicate request, rate-limit excess, and budget excess are rejected.
- Known transaction hashes are reconciled before retry.
- Relayer and keeper use distinct keys.

### Stop condition

Do not advertise gasless management until the selected wallet path signs compatible delegate actions end to end.

## 7. Phase 5: deterministic web product flow

### Objective

Deliver the complete manual create, review, authorize, fund, monitor, and control flow.

### PRD requirements

- FR-01 wallet session.
- FR-02 overview.
- FR-04 review/edit/approval.
- FR-05 through FR-09 user-facing flow.

### Technical approach

- Implement manual payment form as the baseline.
- Show all financial fields, time zone, UTC time, policy checks, and funding runway in review.
- Require separate user actions for authorization and any necessary funding.
- Route eligible nonpayable management actions through the relayer and route the native NEAR deposit through the normal payable wallet path.
- Query contract views as authority and database history as a derived view.
- Render explicit empty, loading, submitted, pending, success, skipped, failed, stale, and RPC-error states.
- Put pause/cancel warnings near pending execution state.

### Files to create or modify

- `apps/web/src/app/` routes.
- Feature modules for wallet, workflow builder, overview, workflow detail, and history.
- Typed contract hooks and transaction-state components.
- Browser and component tests.

### Acceptance criteria

- User connects a testnet wallet and sees a clear testnet indicator.
- Manual form rejects ambiguous/invalid account, amount, interval, time, reserve, and run count.
- Review displays atomic-impact values in human units without float conversion.
- Owner signs and funds a workflow on testnet.
- Eligible management actions do not reduce the user's wallet balance for gas.
- Dashboard matches contract views after refresh.
- UI does not show success before finality.
- Reserve skip, pause, resume, cancel, and safe withdrawal are operable and reflected after refresh.
- Keyboard navigation and responsive states pass the agreed UI quality gate.

### Stop condition

Do not add AI until the manual end-to-end flow is repeatable.

## 8. Phase 6: AI draft parser and fallback

### Objective

Turn natural language into an editable workflow draft without increasing transaction authority.

### PRD requirements

- FR-03 natural-language to workflow JSON.
- FR-04 preview and explicit approval.

### Technical approach

- Implement provider adapter with NEAR AI Cloud as the first configured provider.
- Send only the minimum prompt context.
- Parse JSON, validate with Zod, and allow one repair attempt.
- Return clarification requirements and warnings as data.
- Keep the manual form populated and editable after parsing.
- Disable prompt retention by default.

### Files to create or modify

- `apps/web/src/server/ai/` adapter and prompt contract.
- Parser route handler with rate limits and timeouts.
- `packages/workflow-schema/` AI result types.
- Parser test corpus.
- Builder UI draft/clarification states.

### Acceptance criteria

- The PRD hero prompt produces all required fields or a clear clarification request.
- Missing recipient, amount, reserve, or ambiguous schedule cannot reach authorization.
- Unsupported asset is rejected; only native NEAR is accepted.
- Malformed JSON and provider timeout fall back to the manual form.
- The AI cannot submit or sign any transaction in tests and code review.
- User edits after parsing are included in the canonical reviewed configuration.

### Stop condition

AI integration must not destabilize the already passing manual flow.

## 9. Phase 7: hardening and reproducible demo

### Progress on 2026-10-31

- Hardened web finality classification and added same-hash status rechecks for builder, ledger, and proof actions. Mock wallet/RPC regressions cover rejection, missing hashes, unresolved outcomes, failed receipts, and cleanup; real wallet acceptance remains open. Read-only RPC checks accepted two existing finalized testnet hashes. See [wallet verification](phase-7/WALLET_VALIDATION.md).
- Updated the Meteor SDK's decoder to 0.5.1 with a one-line CommonJS loader patch. SDK URI compatibility tests pass; audit has no high findings. Node 22.12+ within 22.x is now required for the ESM loader interop.
- Expanded the local NEAR sandbox scenario to verify finalized retry rejection, pause across an observed due timestamp, withdrawal rejection one yoctoNEAR above the unlocked amount, resume to completion, repeated failed-transfer restoration, external callback rejection, and dispatch prevention plus full withdrawal after cancellation.
- Added pending-transfer unit cases proving cancellation cannot unlock in-flight funds and failed callback replay cannot double-credit the ledger after available funds have been withdrawn.
- All 34 Rust unit tests and the expanded sandbox scenario passed in WSL Ubuntu. Clippy passed on Windows and Linux; Linux includes the sandbox code. The test now waits for observed block timestamps rather than assuming a fixed block count equals a payment interval.
- These are local-runtime proofs, not new testnet hashes or product acceptance. Phase 7 remains in progress; live lifecycle/rejection evidence and wallet/device acceptance remain open. See [contract verification](phase-7/CONTRACT_VALIDATION.md).

### Progress on 2026-10-30

- Added independent final-RPC verification of keeper transaction hashes, signer, receiver, decoded `execute_due` arguments, zero deposit, and contract-origin execution events.
- Evidence reporting now pages through all workflows, detects multiple successful hashes for one run slot, supports database-free `--chain-only` inspection, and exits nonzero with `--require-evidence` when payment or reserve evidence is missing.
- Added `pnpm proof:payments`, a read-only preview by default. Explicit execution creates two isolated testnet fixtures, runs two scheduled payments, exercises persisted-hash recovery and concurrent keeper cycles, verifies recipient/ledger deltas, captures reserve rejection, and withdraws remaining fixture balances.
- Before signed execution, a read-only check confirmed `phase-2-ready` with an empty evidence database; strict reporting correctly returned code 1 for missing evidence.
- The product owner approved the concrete 0.1 NEAR testnet fixture plan. Workflow `2` completed two 0.001 NEAR payments; workflow `3` returned `RESERVE_GUARD` with zero balance deltas. All three execution hashes independently verified at finality.
- Persisted-hash recovery signed no replacement transaction; concurrent keeper cycles submitted one payment for the second slot. The initial runner stopped after cancellation committed; journal-based recovery confirmed cancellation and withdrew both remaining fixture balances to zero. Owner transactions now persist their hash before broadcast and use full final receipt queries.
- A follow-up process proof terminated worker PID `8736` after broadcast and recovered its pending database hash in worker PID `27900` with zero new submissions. Two separate contender processes produced one payment on the existing fixture. Workflow `4` completed two runs; reserve fixture `5` was cancelled and both balances were withdrawn to zero. See [OS process evidence](phase-7/PROCESS_VALIDATION.md).
- Desktop browser checks cover editable parsing, missing recipient, unsupported USDC, zero-amount rejection, disconnected state, and a keyboard navigation sample. Provider-failure tests found and fixed invalid decimal strings throwing from schema `safeParse`. Live pause/rejection paths and remaining wallet/device acceptance stay open. See [product evidence](phase-7/PRODUCT_VALIDATION.md).

### Progress on 2026-10-29

- Added a read-only evidence report, judge runbook, evidence ledger, known limitations, and release checklist.
- Added high-severity npm audit, RustSec audit, and Git-history key-material scan gates to CI.
- Patched the transitive Meteor Wallet `nanoid` dependency from 5.1.5 to 5.1.16; the high-severity npm audit gate now passes.
- Confirmed the live contract is `phase-2-ready` with one completed workflow and no pending liability.
- Blockers at that time: two captured scheduled-payment hashes, live reserve rejection, final lifecycle/restart evidence, Linux sandbox evidence, and a coordinated NEAR Rust dependency update. The Linux sandbox and coordinated dependency upgrade subsequently passed; four documented host-side RustSec exceptions remain.

### Objective

Produce the proof required by the PRD and hackathon rules, remove misleading states, and make the demo repeatable by judges.

### PRD requirements

- All P0 acceptance criteria and Definition of Done.
- Hackathon public repository, README, and demo evidence requirements.

### Technical approach

- Run full security matrix and dependency/secret scans.
- Deploy a fresh testnet contract from documented steps.
- Execute the hero script twice from a clean workflow.
- Capture final transaction hashes and reserve-block evidence.
- Test keeper restart, duplicate trigger, callback failure, pause/cancel, and withdrawal.
- Test relayer replay protection, method policy, sponsorship limits, and balance exhaustion.
- Write a machine-readable and human-readable README.
- Clearly list live integrations, simulated features, and non-goals.

### Files to create or modify

- `README.md`.
- `docs/DEMO_RUNBOOK.md`.
- `docs/KNOWN_LIMITATIONS.md`.
- `THIRD_PARTY_NOTICES.md` if any third-party source was copied.
- CI security workflows and release checklist.
- Deployment configuration and sample environment file.

### Acceptance criteria

- Two real scheduled testnet executions have finalized hashes and valid explorer links.
- One reserve guard rejection is reproducible.
- Duplicate trigger test shows one payment only.
- Pause/cancel prevents the next due dispatch.
- Safe withdrawal works in tested states.
- README says exactly what is live, simulated, or deferred.
- Fresh judge setup follows `do X -> see Y` without undocumented secrets.
- Public repository and demo post are prepared, but publication/submission remains a human action.
- No feature is described as audited or production-ready.

### Stop condition

Submission is not sent until the human reviews the exact immutable payload and explicitly confirms it, as required by `HACKATHON.md`.

## 10. Phase 8: optional P1 treasury planning

### Progress on 2026-10-31

- Before implementation: `pnpm check` passed 95 TypeScript tests plus format/lint/typecheck; the full workspace build passed; WSL Rust tests passed 34 unit tests and one sandbox scenario.
- Added a read-only outlook that pins every workflow page to one finalized block and checks returned block identity, ownership, and duplicate workflow IDs.
- Added integer-only per-workflow forecasts, protected reserves and remaining obligations, an editable fee buffer, funding gaps, paused/no-catch-up handling, and explicit pending-transfer uncertainty.
- Added a separate one-year APY scenario with editable assumptions, a principal cap at uncommitted funds, default zero APY, and no wallet/provider/DeFi transaction capability.
- After implementation: 150 TypeScript tests, formatting, lint, typecheck, and the full production build passed. Browser verification used existing public testnet data, including a nonzero ledger, invalid owner recovery, and an empty owner account. See [Phase 8 validation](phase-8/VALIDATION.md).
- Remaining Phase 7 live wallet/lifecycle acceptance continues to gate release. The subsequent request to continue development extends the plan with Phase 9 below.

### Objective

Add deterministic treasury forecast and a clearly labeled yield simulation without moving assets into DeFi.

### PRD requirements

- FR-10 and FR-11 only.

### Acceptance criteria

- Forecast is derived from on-chain balance, approved obligations, reserve, and stated fee assumption.
- Simulation assumptions are editable and labeled.
- Simulated values never appear as on-chain balances or guaranteed returns.
- No lending, staking, swap, cross-chain, or yield transaction exists.

## 11. Phase 9: workflow transaction recovery

### Objective

Preserve known unresolved workflow transaction hashes across reloads and reconnects, so an owner can check the original transaction before signing another action. This follow-up addresses the browser-session limitation recorded after Phase 8.

### Scope and acceptance criteria

- A versioned browser journal stores only a hash, sender, action, and workflow ID where relevant. Records are separated by testnet RPC, contract, owner, and builder/ledger channel.
- Recipient authorization, creation, pause, resume, cancel, and withdrawal restore a status-check path without restoring a draft approval or requesting a signature.
- Pending or unavailable finality keeps the original hash and blocks a new action in the same channel. Only verified final success or failure clears its matching record.
- Invalid records and unavailable storage block signing. A write failure after wallet submission retains the hash in the mounted component and displays a copy/keep-open instruction.
- Other tabs receive storage changes, and signing checks storage again. This is not a cross-tab signing mutex; simultaneous wallet requests remain an operational limitation.
- Component and journal regressions cover remounts, scope isolation, corruption, unavailable reads/writes, all supported actions, and same-hash finality without another signature.
- Wallet redirects before a hash is returned, the separate deployment-owner proof action, cleared browser storage, and cross-device recovery remain outside this phase.

### Transition baseline

Before implementation on 2026-10-31, `pnpm check` passed all 150 TypeScript tests plus format/lint/typecheck, and `pnpm build` passed across the workspace. The Rust contract and workers are unchanged in this phase; the preceding Phase 8 baseline already passed 34 Rust unit tests and one Linux sandbox scenario.

Remaining live wallet/lifecycle and publication gates still apply. See [Phase 9 validation](phase-9/VALIDATION.md) for final verification.

## 12. Phase 10: local readiness diagnostics

### Objective

Make local testing reproducible by identifying configuration, web, keeper, RPC, contract, and restricted-key blockers before an owner starts a wallet/payment test. The product owner's request to continue after Phase 9 extends the roadmap with this operational follow-up.

### Implemented scope

- `pnpm local:doctor` checks ignored/untracked local configuration, supported Node, web/keeper contract and RPC alignment, the local Auvora page, recent keeper readiness, testnet RPC identity, finalized contract status, and the keeper's exact `execute_due` restriction and positive allowance.
- A configurable loopback web port, configuration-only `--offline`, structured `--json`, and bounded requests support manual troubleshooting and repeatable diagnostics.
- A failed or unverified network identity prevents further chain queries. Only read-only RPC methods are used, and raw errors, database credentials, and private keys never enter the report.
- Failures include concrete next steps. Offline success and HTTP health remain distinct from signed wallet acceptance, completed payment evidence, and release readiness.
- No service startup, database mutation, key provisioning, signature, deployment, or publication is part of this command.
- The doctor regression suite is included in root `pnpm test`, so the existing `pnpm check` CI path runs it.

### Verification

Before implementation, `pnpm check` passed all 181 TypeScript tests plus formatting/lint/typecheck, then the workspace build passed. Post-change tests and read-only local checks are recorded in [Phase 10 validation](phase-10/VALIDATION.md). Earlier live wallet/lifecycle gates remain open.

## 13. Closing plan after Phase 10

The product owner asked on 2026-10-31 to continue development and state how many phases remain. The remaining MVP work is grouped into three closing phases below. This grouping does not declare earlier live acceptance complete, and does not promise release while a gate remains unresolved.

### Phase 11: keeper readiness and reported runtime identity

- Expose a versioned health response with public network, contract, signer, and instance identity.
- Keep readiness false after a failed cycle, including during its retry, until a full cycle and database heartbeat succeed.
- Reject stale/future polling timestamps and provide an explicit readiness reason.
- Require the local doctor to compare reported runtime identity with intended configuration.
- Verify state transitions and actual HTTP status/cache behavior without starting a payment worker or signing a transaction.

Implementation on 2026-10-31 adds versioned public identity and readiness reasons, preserves failure state during retries, persists the database heartbeat before marking success, rejects future/stale timestamps, and requires doctor identity matches. The 229-test baseline and full workspace build passed before code changes. See [Phase 11 validation](phase-11/VALIDATION.md) for final evidence. This completes the local development scope; it does not claim that an operational keeper or wallet has passed live acceptance.

### Phase 12: integrated wallet and payment acceptance

- Verify the selected wallet, canonical manual/AI-fallback flow, rejection, uncertain finality, and reload recovery on testnet.
- Close gaps exposed by acceptance, including the supported sponsorship path and user-facing execution history where necessary.
- Capture missing live lifecycle, duplicate-trigger, callback/withdrawal rejection, and explorer/final-RPC evidence using bounded, reviewed fixtures.
- Human wallet signatures and any new funded fixtures require their concrete approval flow; automated mocks do not replace live acceptance.

### Phase 13: release and demo package

- Reconcile the PRD, README, evidence, limitations, and final release checklist against the actual tested behavior.
- Verify fresh setup, repeatable demo instructions, dependency/key-material gates, and the final build.
- Prepare a concrete repository/demo/submission package for human review. Public hosting, publication, and submission remain separately authorized human actions.

Phase count is a work breakdown, not a readiness score. Findings can add work within these phases. Optional product expansion beyond the MVP is not part of this closing plan.

## 14. Measurable MVP release gate

The MVP is a go only if all are true:

- Wallet path works on NEAR testnet.
- Manual creation path works without AI.
- AI path works or visibly falls back.
- Owner signs the canonical workflow.
- Keeper executes two finalized native NEAR payments.
- Reserve guard blocks one run.
- Same-slot retry and concurrent keeper tests produce one payment.
- Pause/cancel and withdrawal tests pass.
- Supported management actions are gas-sponsored and the initial payable deposit is clearly identified as the only user-funded transaction path.
- History distinguishes pending from final status and links real hashes.
- Contract, worker, and web automated checks pass.
- No committed secret and no false security/integration claim exists.

If time is short, remove forecasts, extra dashboard charts, HOT integration, and optional analytics before weakening contract tests or finality handling.

## 15. Technical risks

| Risk | Probability | Impact | Mitigation and evidence required |
| --- | --- | --- | --- |
| Async transfer/callback accounting bug | Medium | Critical | Pre-debit design, private minimal callback, sandbox failure tests, invariant checks |
| Callback itself fails after transfer | Low | High | Halt unresolved workflow, no automatic guess-based repair, document testnet limitation |
| Shared-vault accounting bug | Medium | Critical | Per-workflow ledger, global solvency invariant, property tests |
| Duplicate keeper submissions | High | High | On-chain slot reservation plus concurrency test |
| Contract storage locks liquid balance | Medium | High | Storage charging, bounded state, operational buffer, storage tests |
| Wallet library compatibility changes | Medium | Medium | Phase 0 spike and adapter boundary |
| Selected wallet cannot sign delegate actions | Medium | High | Phase 0 go/no-go spike; select a compatible wallet path before UI expansion |
| Relayer sponsorship abuse | Medium | Medium | Exact policy, no deposits, nonce/expiry checks, per-user and global budgets |
| Native Windows cannot run sandbox | High in local environment | Medium | WSL2/Docker or Ubuntu CI as required gate |
| NEAR AI access/model unavailable | Medium | Low to core demo | Provider adapter and manual form |
| RPC/explorer outage during demo | Medium | Medium | Configurable RPC, cached hashes, fail-closed status, recorded runbook |
| Keeper host sleeps/restarts | Medium | High | Long-running container, restart policy, DB lease expiry, health monitor |
| Missed schedules create payment burst | Medium | High | Default no-catch-up policy, explicit product approval |
| Testnet contract upgrade key is powerful | Medium | High if misunderstood | Testnet disclosure, key separation, no production claim |
| FlowPilot code copied without notice | Low | Medium | Concept-only reuse by default; notice file if copied |
| Hackathon rules change | Low | High | Re-fetch live `HACKATHON.md` before publication and submission |

## 16. Approved decisions and remaining approvals

Approved on 2026-10-22:

- **Gas sponsorship:** Auvora pays gas for supported management actions through a restricted relayer and pays scheduled execution gas through the keeper. The user supplies treasury funds through the initial normal payable deposit. Testnet onboarding covers or sources the small amount needed for that deposit transaction's gas.

Remaining decisions:

1. **Wallet path:** approve Wallet Selector as the default, with HOT Kit limited to a Phase 0 spike.
2. **Missed runs:** approve no burst catch-up. A delayed workflow pays once, then schedules the next run at least one interval later.
3. **Withdrawal policy:** approve conservative locking of all remaining scheduled obligations plus minimum reserve while active/paused.
4. **Financial edits:** approve immutable financial fields; replace a workflow instead of editing recipient/amount/reserve/schedule in place.
5. **Shared contract model:** approve one multi-tenant testnet contract with segregated per-workflow ledgers instead of one deployed contract per user.
6. **Keeper hosting:** choose the container/database provider after Phase 0, while preserving portable deployment.
7. **AI provider:** approve NEAR AI Cloud as preferred but non-blocking, with manual fallback.
8. **Execution history:** approve bounded on-chain current state plus NEP-297 event history indexed in PostgreSQL, rather than unbounded on-chain history.
9. **Contract upgrade trust:** decide whether the demo contract account remains upgradeable through the hackathon or is locked only after the final verified deployment.
10. **Track claims:** submit under `business`; add `security` or `agents` only if final working functionality clearly supports those tracks.

No Phase 0 implementation should begin until these planning documents and the open decisions are approved.
