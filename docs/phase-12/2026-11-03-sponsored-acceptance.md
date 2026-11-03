# WF-11 sponsored management acceptance

Date: 2026-11-03 (Asia/Jakarta). Network: NEAR testnet.

The product owner performed these actions through the sponsored-management UI using Meteor. Transaction hashes were retrieved with a read-only query of the relayer database, then independently checked through `EXPERIMENTAL_tx_status` with `wait_until: FINAL` at `https://test.rpc.fastnear.com`. No transaction was signed or broadcast by the agent during verification.

| Action   | Final transaction hash                         | Contract event       |
| -------- | ---------------------------------------------- | -------------------- |
| Pause    | `D4obnfmPe2Mz9aA8fZarJFd3Dsou9Z5ULxevQj95xwGC` | `workflow_paused`    |
| Resume   | `6f9DLzpc94sfCUPvrQAEaeRc17vW7DeETpiLk1b5LX2t` | `workflow_resumed`   |
| Cancel   | `AtvC4J59VSsUXvrMwmD8CcTWbJVi4tftJKYLvF94unox` | `workflow_cancelled` |
| Withdraw | `HxTHjayLxZk4HMijPRXJWzhHuKBMpEJLsM9kipt1VPLA` | `workflow_withdrawn` |

All four RPC responses returned FINAL, successful top-level outcomes, and zero failed receipts. Each signed delegate called the corresponding management method with zero attached deposit and workflow ID 11. Matching events originated from `oceanear.testnet`. The outer transaction signer was `oceanrelayer.testnet` in every case, establishing the sponsored transaction path.

Withdrawal arguments and event amount were `6560000000000000000000` yoctoNEAR (0.00656 NEAR). The transfer receipt to `oceanear.testnet` succeeded and `on_withdraw_complete` returned true. The user's subsequent UI screenshot showed WF-11 Cancelled with zero withdrawable balance. No separate current-state RPC snapshot was captured in this verification.

## Recovery evidence

The product owner explicitly reported having already tested recovery after reloading while a request was pending. Record this manual test as user-reported complete; do not ask for a duplicate fixture solely to repeat it. The conversation does not retain the specific recovered request hash or before/after storage capture. This is distinct from the independently verified transaction receipts above and does not establish all creation/redirect/device recovery paths.

## Remaining acceptance boundaries

### Receipt cost reconciliation

A subsequent read-only RPC verification summed `tokens_burnt` from each transaction outcome and all receipt outcomes using integer arithmetic:

| Action   | Total tokens burnt (yoctoNEAR) |
| -------- | ------------------------------ |
| Pause    | 281113999029400000000          |
| Resume   | 281150319474800000000          |
| Cancel   | 281211871044200000000          |
| Withdraw | 549790420719700000000          |

These are receipt-level protocol burn totals, not measured account balance deltas or a reconstructed net fee after all rewards/refunds. All four outer signers are the relayer. No before/after account snapshots are available in this evidence set, so that separate checklist requirement stays open.

### Checklist reconciliation

The sponsored lifecycle gate is supported by final receipts. Sponsored pending-request reload is supported by the owner's report. The earlier 2026-11-02 handoff records creation rejection with retained fields and successful creation, but does not establish abandonment or every redirect path. Existing contract unit/sandbox evidence covers locked withdrawal, duplicate dispatch, failed transfer restoration, callback rejection, and pause/cancel rules; it does not replace the specifically required live rejection/dispatch evidence. Existing mobile history and keyboard samples do not establish full wallet-selector/device acceptance. Fresh-setup acceptance is also still unchecked. These gaps keep Phase 12 open; no duplicate sponsored lifecycle or reload test is requested.

- Separate before/after owner and relayer balance snapshots were not captured. Relayer transaction identity is verified, but a balance-delta comparison is not claimed.
- This lifecycle sequence does not prove pause/cancel prevents a due dispatch, locked-withdrawal rejection, direct duplicate-trigger protection, or failed-transfer/callback behavior on live testnet. Earlier automated coverage remains separate.
- Remaining selected-wallet redirect, device/keyboard, and release checklist gates must be reconciled against existing evidence; this document does not mark the whole of Phase 12 complete or authorize Phase 13 publication.

## Local verification already performed this session

Follow-up audit: formatting-only corrections to the two web files removed the earlier blocker. A fresh `pnpm check` passed formatting, lint, all workspace typechecks, and 416 tests (357 workspace tests plus 59 doctor tests). No runtime behavior was changed. The production build passed earlier in the session and was not rerun for the subsequent documentation/format-only changes. Git ignore exceptions now expose this report and the two Phase 12 handoff/validation documents; they have not been committed or pushed.

Relayer: 78 tests passed. Web: 172 tests passed. Both typechecks and the full workspace production build passed. The full `pnpm check` stopped at formatting warnings in `apps/web/src/app/page.tsx` and `apps/web/src/app/payment-story.tsx`; these results describe that earlier run, not a fresh check of subsequent edits. Sponsorship schema setup and local health/invalid-payload checks passed. No new automated run is necessary for this evidence-only documentation update.
