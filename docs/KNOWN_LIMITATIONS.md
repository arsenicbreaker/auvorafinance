# Known Limitations

Status date: 2026-10-30

## Product scope

- Testnet only. Mainnet is intentionally blocked.
- Native NEAR only. Stablecoins, swaps, lending, staking, yield, cross-chain execution, and NEAR Intents are not implemented.
- A workflow recipient and financial policy are immutable after creation. The owner cancels and replaces a workflow instead of editing it in place.
- The contract remains upgrade-trusted by the deployment account.
- The project has not received an independent security audit.

## AI draft parser

- NEAR AI Cloud is configurable, but the live provider path has not been verified with a project API key and model.
- Without provider configuration, parsing uses a narrow deterministic fallback.
- The fallback supports native NEAR, full testnet account IDs, supported intervals, explicit run limits, reserve, and ISO timestamps. Ambiguous instructions require manual edits.
- Rate limiting is in process memory and is per web instance. A distributed deployment needs a shared limiter.
- Prompts are not deliberately persisted by the application, but upstream infrastructure and provider retention depend on deployment configuration.
- AI output never signs or submits transactions. It can still suggest a harmful draft that a user might approve, so the review screen and wallet remain security boundaries.

## Keeper and database

- The keeper uses one configured RPC endpoint. Multi-provider consistency and failover are not implemented.
- PostgreSQL leases reduce duplicate submissions but are not the idempotency boundary; the contract pending slot is authoritative.
- A provider outage delays execution. The contract intentionally does not burst through missed intervals.
- Ambiguous transfer callbacks require investigation. There is no time-based automatic refund because it could double-credit a successful transfer.
- Current local database evidence does not identify the older transaction that completed workflow `1`. Fresh workflow `2` now supplies two independently verified finalized payment hashes.

## Relayer

- The relayer proof covers constrained, nonpayable management actions.
- Initial workflow funding is not sponsored because a relayer would also fund the attached deposit.
- Production-grade shared rate limiting, monitoring, and budget alerting are not deployed.
- Wallet compatibility for every NEP-366 signing implementation has not been demonstrated.

## Demo evidence

- Workflow `2` completed two scheduled payments on 2026-10-30; workflow `3` produced a verified reserve rejection with zero recipient and workflow balance deltas. Both fixture balances were withdrawn to zero. Hashes and the final RPC report are recorded in [Demo evidence](DEMO_EVIDENCE.md).
- The initial live runner stopped after cancellation had committed. Final RPC confirmed the cancelled state; journal-based recovery withdrew the existing fixture balances without creating another fixture or repeating the cancellation. Owner hashes are now journaled before broadcast and reconciled through full receipt queries.
- A follow-up [OS process proof](phase-7/PROCESS_VALIDATION.md) terminated a keeper-cycle worker after broadcast, recovered its persisted hash in a new process without another submission, and verified one payment from two competing OS processes. These are one-cycle worker processes; service-manager restart, sustained load, and long-running deployment availability are not established.
- The first process-proof collector stopped before retaining restart diagnostics. A recovery-only process reconciled the existing transaction and the runner resumed the same fixture. The original collector-stop cause was not retained; child result/error reporting and resumable journal commands now exist.
- Callback failure, live pause/dispatch prevention, post-cancel dispatch prevention, and withdrawal rejection while obligations are locked still need captured Phase 7 evidence. A successful withdrawal from completed/cancelled fixtures does not prove those rejection paths.
- The Linux sandbox test passes in WSL2 and in the hosted Ubuntu 24.04 CI run for commit `d78b2d3`.

## Dependency advisories

- The high-severity npm advisories from `nanoid@5.1.5` are mitigated by a workspace override to `5.1.16`. One low and one moderate npm advisory remain visible below the configured high-severity release threshold.
- The coordinated upgrade to `near-sdk` 5.30.0 and `near-workspaces` 0.24.0 removed five of the nine RustSec findings, including the `rustls` and `rustls-webpki` findings.
- Four findings remain in host-side NEAR unit-test and sandbox dependencies: `crypto-bigint` (`RUSTSEC-2026-0387`), `zstd` (`RUSTSEC-2026-0391`), and two `zstd-safe` findings (`RUSTSEC-2026-0398` and `RUSTSEC-2026-0403`). A target-specific dependency-tree check confirms these packages are absent from the contract's normal `wasm32-unknown-unknown` graph.
- CI keeps RustSec enabled and explicitly acknowledges only those four IDs. The exceptions must be removed when the NEAR dependency graph provides patched compatible versions.
- The Windows run covered Rust unit tests, Clippy, formatting, the TypeScript suite, and a 233.9 KB optimized WASM build without embedded ABI. The full Linux run also passed the `near-workspaces` sandbox integration test.
- Native Windows ABI generation currently fails while linking NEAR host functions. The optimized WASM itself builds successfully with `--no-abi`; hosted Ubuntu CI verifies the ABI-embedded artifact.

## Operations and privacy

- The web app has no user account system or private off-chain treasury metadata store.
- Browser wallet sessions depend on supported NEAR Wallet Selector wallets.
- Explorer availability is not proof of contract state; final RPC results remain authoritative.
- No formal incident response, key rotation automation, monitored SLO, privacy review, or legal review exists for this MVP.
