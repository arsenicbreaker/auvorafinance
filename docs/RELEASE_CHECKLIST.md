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
