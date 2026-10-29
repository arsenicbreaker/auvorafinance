# Known Limitations

Status date: 2026-10-29

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
- Current local database evidence does not identify the transaction that completed workflow `1`; the hash must be recaptured in a fresh proof.

## Relayer

- The relayer proof covers constrained, nonpayable management actions.
- Initial workflow funding is not sponsored because a relayer would also fund the attached deposit.
- Production-grade shared rate limiting, monitoring, and budget alerting are not deployed.
- Wallet compatibility for every NEP-366 signing implementation has not been demonstrated.

## Demo evidence

- One completed workflow is visible in final contract state, but its execution hash is not in the current evidence store.
- Two finalized scheduled payment hashes are still required.
- A live reserve-guard rejection is still required.
- Keeper restart, concurrent duplicate trigger, callback failure, final-contract pause/cancel, and final-contract withdrawal need captured Phase 7 evidence.
- The Linux sandbox test passes in WSL2. A hosted CI result has not yet been recorded in this workspace.

## Dependency advisories

- The high-severity npm advisories from `nanoid@5.1.5` are mitigated by a workspace override to `5.1.16`. One low and one moderate npm advisory remain visible below the configured high-severity release threshold.
- The coordinated upgrade to `near-sdk` 5.30.0 and `near-workspaces` 0.24.0 removed five of the nine RustSec findings, including the `rustls` and `rustls-webpki` findings.
- Four findings remain in host-side NEAR unit-test and sandbox dependencies: `crypto-bigint` (`RUSTSEC-2026-0387`), `zstd` (`RUSTSEC-2026-0391`), and two `zstd-safe` findings (`RUSTSEC-2026-0398` and `RUSTSEC-2026-0403`). A target-specific dependency-tree check confirms these packages are absent from the contract's normal `wasm32-unknown-unknown` graph.
- CI keeps RustSec enabled and explicitly acknowledges only those four IDs. The exceptions must be removed when the NEAR dependency graph provides patched compatible versions.
- The Windows run covered Rust unit tests, Clippy, formatting, the TypeScript suite, and a 233.9 KB optimized WASM build without embedded ABI. The full Linux run also passed the `near-workspaces` sandbox integration test.
- Native Windows ABI generation currently fails while linking NEAR host functions. The optimized WASM itself builds successfully with `--no-abi`; CI's Ubuntu build remains the gate for the ABI-embedded artifact.

## Operations and privacy

- The web app has no user account system or private off-chain treasury metadata store.
- Browser wallet sessions depend on supported NEAR Wallet Selector wallets.
- Explorer availability is not proof of contract state; final RPC results remain authoritative.
- No formal incident response, key rotation automation, monitored SLO, privacy review, or legal review exists for this MVP.
