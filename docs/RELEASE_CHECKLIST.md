# Release Checklist

Use this checklist before the public repository, demo post, or hackathon submission. A checked item needs evidence, not an assumption.

## Automated gates

- [x] `pnpm install --frozen-lockfile`
- [x] `pnpm format:check`
- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] `pnpm build`
- [x] `pnpm audit --audit-level high`
- [x] `cargo fmt --all --check`
- [x] `cargo clippy --workspace --all-targets -- -D warnings`
- [x] `cargo test --workspace --locked`
- [x] `cargo audit` with the four documented host-side NEAR exceptions
- [x] `cargo near build non-reproducible-wasm --locked`
- [x] Ubuntu CI sandbox test passes
- [x] Git history secret scan passes

## Contract and keeper evidence

- [ ] UI, keeper, documentation, and evidence report all use `testnet` and `oceanear.testnet`
- [x] Keeper key is restricted to `oceanear.testnet` and `execute_due` (live preflight, 2026-10-30)
- [x] Two scheduled payments have distinct finalized hashes and expected recipient deltas ([Phase 7 evidence](phase-7/VALIDATION.md))
- [ ] Duplicate trigger produces one successful transfer for one workflow/run slot
- [x] Keeper-cycle worker restart reconciles the same persisted hash after OS termination ([process proof](phase-7/PROCESS_VALIDATION.md))
- [x] Two independent keeper processes produce one payment through the database lease ([process proof](phase-7/PROCESS_VALIDATION.md))
- [x] Reserve guard returns `RESERVE_GUARD` without changing recipient or workflow balance ([Phase 7 evidence](phase-7/VALIDATION.md))
- [ ] Transfer failure restores the workflow ledger exactly once
- [ ] Direct or repeated callback cannot mutate resolved state
- [ ] Pause prevents the next dispatch
- [ ] Cancel prevents all later dispatches
- [ ] Withdrawal cannot consume active obligations, reserve, or pending value
- [ ] Every explorer URL agrees with final RPC state

Local contract verification on 2026-10-31 passed 34 unit tests and an expanded Linux sandbox scenario covering duplicate dispatch, failed-transfer accounting, private callback rejection, pause/resume/cancel, and withdrawal rejection. See [contract verification](phase-7/CONTRACT_VALIDATION.md). The unchecked live-evidence gates above remain open; local sandbox results do not supply testnet hashes.

## Product evidence

Automated wallet-state verification now covers rejection/abandonment, missing hashes, unknown/final results, receipt failures, and status rechecks without a second signature. Read-only RPC checks use two existing testnet hashes. These mocked component tests and the disconnected mobile browser sample do not replace real selected-wallet acceptance. See [wallet verification](phase-7/WALLET_VALIDATION.md).

- [ ] Fresh setup follows [Demo runbook](DEMO_RUNBOOK.md) without undocumented credentials
- [x] Natural-language parser fills an editable form and does not open a wallet ([desktop browser proof](phase-7/PRODUCT_VALIDATION.md))
- [x] Missing recipient produces clarification; existing corpus tests cover ambiguous start time ([product evidence](phase-7/PRODUCT_VALIDATION.md))
- [x] Unsupported assets are rejected ([USDC browser proof](phase-7/PRODUCT_VALIDATION.md))
- [ ] Provider timeout or malformed output leaves the manual form usable
- [ ] Wallet rejection or abandonment does not show success
- [ ] Submitted and unknown transactions are not presented as finalized
- [ ] Empty, loading, error, and disconnected states are visible and understandable
- [ ] Keyboard path and mobile layout have been checked

## Optional Phase 8 development verification

- [x] Prior-phase automated baseline passed before implementation: 95 TypeScript tests, 34 Rust unit tests, one Linux sandbox scenario, and the workspace build.
- [x] Pinned-block pagination, owner checks, and duplicate workflow rejection have RPC regressions.
- [x] Per-workflow obligations, reserve, pending value, fee assumptions, and one-yocto boundaries have domain regressions.
- [x] Hypothetical APY and principal assumptions cannot consume protected funds or modify displayed on-chain balances.
- [x] Phase 8 has no wallet session, signing method, or DeFi execution path.
- [x] 150 TypeScript tests, lint, formatting, typecheck, and production builds pass.
- [x] Public testnet views match the forecast; browser checks cover nonzero balances, invalid owner recovery, and empty results.

See [Phase 8 validation](phase-8/VALIDATION.md). These development checks do not close the earlier live wallet/lifecycle or human publication gates.

## Phase 9 development verification

- [x] Before implementation, 150 TypeScript tests, format/lint/typecheck, and the workspace build passed.
- [x] Pending workflow hashes recover after remount without restoring financial approval or requesting another signature.
- [x] Recipient authorization, creation, pause, resume, cancel, and withdrawal use the original hash for finality checks.
- [x] Owner, contract, RPC, and component channels isolate stored records; storage events update mounted readers.
- [x] Corrupt records and storage errors prevent new signatures; post-submission write failure keeps the hash and displays a warning.
- [x] Only final success/failure removes the matching hash; checking an old hash cannot overwrite or remove another saved transaction.
- [x] 181 TypeScript tests (88 web), format/lint/typecheck, production build, and the high-severity audit gate passed.

See [Phase 9 validation](phase-9/VALIDATION.md). Automated wallet/RPC regressions remain distinct from real selected-wallet acceptance.

## Phase 10 development verification

- [x] Phase 9 transition baseline: all 181 existing tests and format/lint/typecheck passed, followed by the full workspace build.
- [x] `pnpm local:doctor` provides text/JSON and offline modes, accepts only loopback web URLs, and bounds HTTP/RPC requests.
- [x] Configuration alignment, ignore/tracking rules, runtime health, network identity, contract status, and exact keeper-key restrictions have deterministic regressions.
- [x] Output omits raw credentials and error bodies; chain requests are restricted to read-only `status` and finalized `query` calls.
- [x] Root `pnpm check` passed 229 tests, including 48 doctor cases; the full workspace build and high-severity audit gate passed.
- [x] Live local checks distinguish a working web page from an unavailable keeper. A later unavailable RPC check correctly prevented further chain queries.
- [x] Offline success is explicitly marked as configuration-only; no service is started and no transaction is sent.

See [Phase 10 validation](phase-10/VALIDATION.md). Operational dependencies and the earlier real wallet/release acceptance gates remain separate from this development verification.

## Phase 11 development verification

- [x] Before implementation, 229 tests, formatting/lint/typecheck, and the full workspace build passed.
- [x] Health responses include versioned public network/contract/signer/instance identity and a readiness reason.
- [x] Failure remains visible during retry, and successful database heartbeat persistence precedes in-memory poll success.
- [x] Startup, failure, stale/future timestamps, and invalid freshness settings cannot report ready.
- [x] Actual health HTTP tests verify liveness/readiness status, no-store headers, HEAD, unsupported methods, and unknown paths.
- [x] Doctor rejects old/mismatched identity and inconsistent readiness; three cases cross the real local HTTP boundary with mocked web/RPC dependencies.
- [x] Final `pnpm check` passed 256 tests; full workspace build, high-severity audit gate, and whitespace checks passed.

See [Phase 11 validation](phase-11/VALIDATION.md). These are local development proofs; no production keeper was started and no new live wallet/payment evidence was captured. The closing plan has two remaining phases: integrated wallet/payment acceptance, then release/demo preparation.

## Documentation truth check

- [ ] README lists live, local-only, configurable, deferred, and excluded features accurately
- [ ] README contains no fabricated security, performance, adoption, or audit claim
- [ ] [Known limitations](KNOWN_LIMITATIONS.md) matches the deployed behavior
- [ ] [Demo evidence](DEMO_EVIDENCE.md) contains final hashes, decoded methods, and balance deltas
- [ ] Third-party notices are added if source or assets were copied
- [ ] No secret, signed transaction bytes, personal submission payload, or local `.env` file is tracked

## Human-only publication gates

- [ ] Human confirms the repository may be made public
- [ ] Human verifies the public repository is readable without authentication
- [ ] Human records and publishes the demo post
- [ ] Human supplies project name, lead name, email, team size, tracks, mainnet prize account, public repository URL, public demo URL, and project description
- [ ] Contact notice is read verbatim and the human agrees
- [ ] Exact immutable submission JSON is printed for review
- [ ] Human explicitly confirms sending that exact payload

Do not push, publish, post, sign a mainnet transaction, or send the submission automatically.
