# Phase 1 Validation

Status: implementation and live testnet proof complete; awaiting product-owner
acceptance before Phase 2.

## Local evidence

| Check                                        | Result    |
| -------------------------------------------- | --------- |
| Contract unit tests                          | 18 passed |
| Rust format                                  | Passed    |
| Rust clippy with warnings denied             | Passed    |
| Optimized WASM build                         | Passed    |
| Workspace format, lint, typecheck, and tests | Passed    |
| TypeScript domain tests                      | 4 passed  |
| TypeScript workflow-schema tests             | 3 passed  |

Final optimized WASM:

- Size: 237,749 bytes
- SHA-256: `80E3B0967D63D1E23DB2DDD6AA179228428C329AFAF9DDD10A42365F2C034D07`

The contract tests cover owner authorization, recipient allowlisting, invalid
amount/interval/run/time policy, isolated workflow ledgers, exact one-yocto
withdrawal boundaries, lifecycle transitions, storage underpayment, storage
excess handling, Phase 0 migration, and failed-withdrawal restoration.

## Testnet deployment

The first atomic upgrade attempt was rejected before commit because
`oceanear.testnet` did not have enough liquid balance for the larger code state.
No Phase 0 state or code changed. After the account was topped up, the optimized
contract was deployed and migrated atomically:

- Upgrade transaction:
  `6Pi8aHBnWEXsnaUdX2CDVZFr5sdT8U1Q717xt3XsQb6c`
- New code hash: `9g8ZD7HU9VdgTjVwg3SDhTZpDuDtBGARj5goLnTMtCnJ`
- Status: `phase-1-ready`
- Preserved keeper: `oceankeeper.testnet`
- Preserved owner: `oceanear.testnet`

Post-upgrade RPC calls returned `null` for workflow `0`, an empty owner workflow
list, and `false` for the recipient check, proving that the new interface was
active with a clean Phase 1 state.

## Live workflow proof

The reproducible `pnpm proof:phase1` flow allowlisted
`oceanrelayer.testnet`, created workflow `0`, funded it, paused it, resumed it,
cancelled it, and withdrew its unlocked ledger. No payment was sent to the
recipient.

| Transition | Final transaction hash                         |
| ---------- | ---------------------------------------------- |
| Create     | `DoXbeEsDTEbSCKcfBBLbFXnJEsMudsVFaWNCRXy6UpZL` |
| Fund       | `4S5VCbqv15CAgsGTuhq3nEATQMi3fMqSrZtZ3zCtnCK5` |
| Pause      | `JAJLBK4G77Zx4otym2UPfgbpL8GLiVMaRMtYTzPERnUS` |
| Resume     | `7rvorTfDF9jmr4Z26KLnKukqGa9RjLrususZ4UCgUNSZ` |
| Cancel     | `APPponiNh2bMCVtWrh9X9DubJCdzCRkA73sLkJYJ1Fyr` |
| Withdraw   | `BUGSDPYMwHUtLqHQVLsxWaBcAnBTMyevU8aiNqATxrD6` |

The final RPC state was `Cancelled` with `available_balance = 0`, proving that
the withdrawal used only workflow `0`'s unlocked ledger.

## Remaining acceptance evidence

- Linux `near-workspaces` sandbox run (the test exists but remains gated to
  Linux in the native Windows environment).
