# Phase 1 Treasury Contract Interface

Network: NEAR testnet  
Contract: `oceanear.testnet`

Phase 1 implements workflow policy and accounting only. Scheduled transfers and
keeper execution intentionally begin in Phase 2.

## Accounting model

- Every workflow has an isolated `available_balance` in yoctoNEAR.
- Creating a workflow charges the exact serialized-state growth. The remaining
  attached deposit becomes that workflow's balance.
- Funding credits only the selected workflow.
- Active and paused workflows lock all remaining scheduled obligations plus
  `min_reserve`.
- Cancelled and completed workflows unlock their full remaining balance.
- A failed withdrawal transfer restores the debited workflow ledger in a private
  callback.
- Contract and TypeScript money paths use integers (`u128`/`bigint`) only.

## Change methods

| Method                                    |                  Deposit | Authorization  | Purpose                                             |
| ----------------------------------------- | -----------------------: | -------------- | --------------------------------------------------- |
| `add_allowed_recipient(account_id)`       |          Storage deposit | Calling owner  | Add a recipient; excess storage deposit is refunded |
| `remove_allowed_recipient(account_id)`    |                     None | Calling owner  | Remove a recipient and refund released storage      |
| `create_workflow(args)`                   | Storage + optional funds | Calling owner  | Create immutable financial configuration            |
| `fund_workflow(workflow_id)`              |           Workflow funds | Workflow owner | Credit one workflow ledger                          |
| `pause_workflow(workflow_id)`             |                     None | Workflow owner | Active → paused                                     |
| `resume_workflow(workflow_id)`            |                     None | Workflow owner | Paused → active                                     |
| `cancel_workflow(workflow_id)`            |                     None | Workflow owner | Active/paused → cancelled                           |
| `withdraw_available(workflow_id, amount)` |                     None | Workflow owner | Withdraw only the conservative available amount     |

All `amount` values are decimal strings containing yoctoNEAR when encoded as
JSON `U128` values. `interval_ms` is bounded from 60,000 through
31,536,000,000 milliseconds; `max_runs` is bounded from 1 through 1,000.

## View methods

- `get_workflow(workflow_id)`
- `get_withdrawable(workflow_id)`
- `list_owner_workflows(owner_id, cursor, limit)` with a maximum page of 50
- `is_recipient_allowed(owner_id, account_id)`
- `get_status()` (retained from Phase 0)

## Events

State changes emit NEP-297-formatted log envelopes with standard `auvora` and
version `1.0.0`. Current event names are `recipient_allowed`,
`recipient_removed`, `workflow_created`, `workflow_funded`, `workflow_paused`,
`workflow_resumed`, `workflow_cancelled`, and `workflow_withdrawn`.
Failed withdrawal receipts additionally emit `workflow_withdrawal_failed` after
restoring the ledger.

## Upgrade

`pnpm upgrade:phase1:testnet` deploys the release WASM and calls `migrate` in
one transaction. It is testnet-only, requires the contract account full-access
key from the ignored `.env.deploy.local`, verifies `DEPLOY_CONFIRM`, and refuses
to run when the Phase 1 interface already exists.
