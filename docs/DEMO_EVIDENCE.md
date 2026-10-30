# Demo Evidence Ledger

Last read-only verification: 2026-10-30

Network: NEAR testnet  
Contract: `oceanear.testnet`

## Current final state

The final RPC view returned:

- Contract status: `phase-2-ready`
- Owner: `oceanear.testnet`
- Last keeper: `oceankeeper.testnet`
- Available liability: `4560000000000000000000` yoctoNEAR
- Pending liability: `0`
- Workflow `0`: cancelled, 0 of 2 runs, no available balance
- Workflow `1`: completed, 1 of 1 run, 0.00456 NEAR withdrawable, no pending execution
- Workflow `2`: completed, 2 of 2 runs, available balance `0`, no pending execution
- Workflow `3`: cancelled after reserve rejection, 0 of 1 run, available balance `0`, no pending execution
- Workflow `4`: completed, 2 of 2 runs, available balance `0`, no pending execution
- Workflow `5`: cancelled after reserve rejection, 0 of 1 run, available balance `0`, no pending execution

The older workflow `1` still has no captured execution hash. Fresh workflow `2` now provides two independently verified finalized scheduled payments. The [Phase 7 validation](phase-7/VALIDATION.md) records hashes, balance deltas, concurrency/recovery observations, cleanup, and remaining gates.

The later [OS process proof](phase-7/PROCESS_VALIDATION.md) adds two finalized payments from workflow `4` and a reserve rejection from workflow `5`. The [latest final report](phase-7/2026-10-30-process-final-report.json) independently verifies four payment slots and two reserve rejections, with no duplicate successful slots or unverified transactions. It exits 0 under `--require-evidence`.

Worker PID `8736` was terminated after persisted broadcast. Worker PID `27900` recovered its hash with zero new submissions. Separate processes `1848` and `26764` then produced one payment for the next slot. Both follow-up fixture balances were withdrawn to zero. This does not close the separate direct-contract duplicate-trigger gate.

[Product verification](phase-7/PRODUCT_VALIDATION.md) records desktop browser parsing, clarification, unsupported assets, manual editing, keyboard focus, and invalid-amount rejection. The current automated suite has 68 tests, including provider-failure fallback and invalid financial-decimal regression cases.

## Recorded finalized transactions

| Proof                        | Transaction                                                                                                                     | Status                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Initial deployment           | [FW1uXWCowcW1W17HUUryk965Rgzrn5h6x3e9tgjiimX1](https://testnet.nearblocks.io/txns/FW1uXWCowcW1W17HUUryk965Rgzrn5h6x3e9tgjiimX1) | Recorded               |
| Phase 1 upgrade              | [6Pi8aHBnWEXsnaUdX2CDVZFr5sdT8U1Q717xt3XsQb6c](https://testnet.nearblocks.io/txns/6Pi8aHBnWEXsnaUdX2CDVZFr5sdT8U1Q717xt3XsQb6c) | Recorded               |
| Dependency hardening upgrade | [BpAT9eRzUT3fHbiYDnMXSUMi9856qcfX5hzbK69XniW8](https://testnet.nearblocks.io/txns/BpAT9eRzUT3fHbiYDnMXSUMi9856qcfX5hzbK69XniW8) | Final success          |
| Keeper restricted-key proof  | [DdDZQzEGBFWbAvQfb1cr5t1qyBo1y8ar2xF1St8UaNNd](https://testnet.nearblocks.io/txns/DdDZQzEGBFWbAvQfb1cr5t1qyBo1y8ar2xF1St8UaNNd) | Recorded               |
| Sponsored relayer proof      | [5tXH5JGDeyf9WhkCED94E9D7yqGtERNEh3HhYYrEcY7H](https://testnet.nearblocks.io/txns/5tXH5JGDeyf9WhkCED94E9D7yqGtERNEh3HhYYrEcY7H) | Recorded               |
| Owner wallet proof           | [MFaieneZw88gcdhwSsneX5h6jBibeNrDjmJQGPow7Nd](https://testnet.nearblocks.io/txns/MFaieneZw88gcdhwSsneX5h6jBibeNrDjmJQGPow7Nd)   | Recorded               |
| Scheduled payment 1          | [2fjohRCc12mt7ngr36iu5i6jY8yuukPj3KHmSdyCtZsn](https://testnet.nearblocks.io/txns/2fjohRCc12mt7ngr36iu5i6jY8yuukPj3KHmSdyCtZsn) | Final, verified        |
| Scheduled payment 2          | [EU1hXmfCwKKh6TZhbBDw2uBfX9K2qkS1RTn3PsT6DBN3](https://testnet.nearblocks.io/txns/EU1hXmfCwKKh6TZhbBDw2uBfX9K2qkS1RTn3PsT6DBN3) | Final, verified        |
| Live reserve rejection       | [7z5FYzrez1E7nCrt3Y4HqWT7LftUtf62rCsw3UKWgJj8](https://testnet.nearblocks.io/txns/7z5FYzrez1E7nCrt3Y4HqWT7LftUtf62rCsw3UKWgJj8) | Final, `RESERVE_GUARD` |

Phase 1 create, fund, pause, resume, cancel, and withdrawal hashes are recorded in [Phase 1 validation](phase-1/VALIDATION.md).

## Hardening evidence

### Phase 7 verifier on 2026-10-30

- Read-only preflight confirmed `phase-2-ready` and an initially empty evidence database; strict reporting correctly exited 1 before execution.
- After explicit approval, `pnpm proof:payments --execute` created workflows `2` and `3` with total 0.1 NEAR attached deposits. It captured two finalized 0.001 NEAR payments and a reserve rejection with zero balance deltas.
- Persisted-hash reconciliation submitted no replacement transaction. Two competing keeper cycles submitted one payment for the next slot. Both fixture balances were subsequently withdrawn to zero through journal-based recovery; the original run stopped after cancellation had committed.
- Final `pnpm proof:report --require-evidence` exited 0 with two verified payment slots, one verified reserve rejection, no duplicate successful slots, and no unverified records. See the [final report](phase-7/2026-10-30-final-report.json) and [validation](phase-7/VALIDATION.md).
- The new verifier suite passed 17 cases, including non-final status, incorrect signer/receiver/hash, attached deposit, action batches, malformed arguments, forged event origin, slot mismatch, receipt failure, missing dispatch, reserve rejection, and duplicate successful slot detection.
- The complete TypeScript suite passed 54 tests. Workspace formatting, lint, typecheck and production build passed before live execution; keeper typecheck, six keeper tests, and keeper build passed after the recovery change. Real process-restart and remaining release evidence stay open.

| Check                                    | Result on 2026-10-29                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| High-severity npm audit                  | Passed after pinning `nanoid` 5.1.16; low and moderate advisories remain to be reviewed                 |
| Working tree high-confidence secret scan | No actual secret found; the initial broad pattern matched a code template in `provision-keeper-key.mjs` |
| Git history high-confidence secret scan  | No actual secret found with the refined key-material patterns                                           |
| Local credential files ignored           | `.env.deploy.local`, `.env.keeper.local`, `.env.relayer.local`, and `apps/web/.env.local` are ignored   |
| RustSec audit                            | 5 findings resolved; 4 documented host-side NEAR test/sandbox exceptions remain                         |
| TypeScript tests                         | Passed: 37 tests across config, domain, schema, client, web, relayer, and keeper                        |
| Rust unit tests                          | Passed: 32 contract tests; formatting and Clippy also passed                                            |
| Workspace build                          | Passed: all packages, Prisma generation, workers, and Next.js production build                          |
| Linux sandbox integration                | Passed in WSL2: 1 transfer/failure-restoration integration test                                         |
| Optimized contract WASM                  | Passed without embedded ABI: 233,867 bytes; SHA-256 `55aa751b...f1e827`                                 |
| Hosted Ubuntu CI                         | [Passed on commit `d78b2d3`](https://github.com/arsenicbreaker/auvorafinance/actions/runs/40832107510)  |

The dependency upgrade moved `near-sdk` from 5.29.1 to 5.30.0 and `near-workspaces` from 0.23.0 to 0.24.0. It resolved the `rustls` and `rustls-webpki` advisories and reduced RustSec findings from nine to four. The remaining `crypto-bigint`, `zstd`, and `zstd-safe` findings are reached only through NEAR's host-side unit-test and sandbox dependencies; a `wasm32-unknown-unknown` normal dependency-tree check returned none of those packages. CI lists the four advisory IDs explicitly so the exception is visible and removable rather than silently disabling the audit.

The native Windows ABI-generation step fails at the linker because NEAR host functions are unresolved outside the chain VM. The same `cargo-near` build with `--no-abi` produced an optimized 233,867-byte WASM artifact with SHA-256 `55aa751bae66b8d0d02232097cb924995317b5ba798885ec4b1800e787f1e827`. Ubuntu CI verified the ABI-embedded build, sandbox test, and remaining Rust gates before the artifact was deployed to `oceanear.testnet` in finalized transaction `BpAT9eRzUT3fHbiYDnMXSUMi9856qcfX5hzbK69XniW8`.

## Evidence completion rules

For every new live proof, record:

- network and contract account;
- signer account, never its key;
- method and decoded arguments;
- attached deposit and gas when relevant;
- finalized transaction hash;
- final RPC status and expected state;
- testnet NearBlocks URL;
- recipient and workflow balance deltas when proving a payment or rejection.

Do not label a submitted or unknown transaction as successful.
