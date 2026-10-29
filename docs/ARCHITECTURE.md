# Auvora Finance MVP Architecture

Status: proposed for approval  
Scope: planning only, NEAR testnet MVP  
Last reviewed: 2026-10-22 (Asia/Jakarta)

## 1. Objective and source requirements

This architecture is designed for the PRD's hero flow: a user reviews and authorizes a recurring native NEAR payment, a permissionless keeper triggers it, the contract protects a minimum reserve and prevents duplicate payment, and the UI proves the final result. It covers FR-01 through FR-09. FR-10 and FR-11 remain optional simulations. FR-12 through FR-14 are outside the MVP.

The design follows these rules:

- The smart contract is the authority for ownership, policy, spendable balance, schedule, and execution state.
- The AI produces an untrusted draft. It cannot sign, fund, execute, change policy, or withdraw.
- The keeper can ask the contract to execute a due workflow. It cannot select a different recipient or amount.
- The database is a derived read model and scheduler aid, never the authority for money movement.
- All production claims are out of scope. The target is a reproducible NEAR testnet demonstration.

## 2. FlowPilot review

FlowPilot was reviewed at commit `e486a9129307e9ff4c8f7ffbf9aec5bf5ba246c8`. It is a useful product and interaction reference, but not a safe base to port line by line.

### Patterns worth reusing conceptually

| FlowPilot pattern | Auvora use |
| --- | --- |
| Template selection followed by configuration | Use one payment template, then populate it from an AI draft or manual form. |
| Review/onboarding sequence | Preserve the explicit review and confirmation step before wallet signing. |
| Agent cockpit with active and completed views | Adapt into Overview, Automations, and workflow detail states. |
| Execution-chain/history presentation | Show scheduled time, internal execution ID, final state, transaction hash, and explorer link. |
| Backend reconciliation and caching | Reconcile the database against contract views and finalized transaction outcomes. |
| Cancellation flow and visible transaction state | Keep controls close to the workflow and distinguish submitted, pending, and final states. |

### Components that must be redesigned

| FlowPilot component | Reason it cannot be reused directly | Auvora replacement |
| --- | --- | --- |
| Cadence contracts and Flow Transaction Scheduler | Chain-specific execution and capability model | Rust `near-sdk` vault contract plus an external keeper |
| FCL and Flow React SDK | Flow-only wallet and transaction APIs | NEAR Wallet Selector and `near-api-js` behind adapters |
| Find Labs scheduled-transaction scanner | Flow-specific API and credentials | Contract views, NEP-297 event ingestion, and RPC finality checks |
| MongoDB agent mirror | The Auvora domain needs relational uniqueness and execution leases | PostgreSQL with Prisma and explicit unique constraints |
| Chained scheduled transactions | NEAR does not provide Flow's scheduler primitive in this design | Polling keeper calls permissionless `execute_due` |
| Placeholder pause/resume transactions | The referenced file labels these as placeholders | Real owner-only contract methods with sandbox tests |
| Large 902-line cockpit component | It combines data, transaction, and presentation concerns | Feature modules with typed hooks and small screen components |
| Claimed status inferred from cached API data | Financial UI must not treat submission as settlement | Finality-aware transaction state and contract reconciliation |

### License obligation

FlowPilot is MIT licensed with `Copyright (c) 2025 Lemon Tree`. Ideas and observed interaction patterns can be used without copying source. If Auvora copies or substantially adapts FlowPilot code, the copied distribution must retain the FlowPilot copyright and MIT permission notice. The implementation phase should maintain `THIRD_PARTY_NOTICES.md` and identify copied files in commit history. No FlowPilot source should be copied by default.

References:

- [FlowPilot repository](https://github.com/Lem0nTree/FlowPilot)
- [FlowPilot license](https://github.com/Lem0nTree/FlowPilot/blob/main/LICENSE)
- [FlowPilot cockpit component](https://github.com/Lem0nTree/FlowPilot/blob/main/frontend/components/agent-cockpit-wrapper.tsx)
- [FlowPilot placeholder controls](https://github.com/Lem0nTree/FlowPilot/blob/main/frontend/lib/flow/transactions.ts)

## 3. System context

```text
User + NEAR testnet wallet
        |
        | signs initial payable deposit or off-chain delegate action
        v
Next.js web application
  |       |                     |
  |       | server-side parse   | delegate action / payable wallet call
  |       v                     v
  |  AI provider adapter    Gas sponsorship relayer
  |       |                     |
  |  untrusted draft            | sponsored nonpayable call
  |                             v
  |                       NEAR testnet RPC
  |                             |
  |                             v
  |                       Auvora vault contract
  |                             ^
  v                             | execute_due(workflow_id)
PostgreSQL read model <---- Keeper worker
  ^                             |
  | finalized tx + events       | restricted function-call key
  +-----------------------------+
```

Trust boundaries:

1. The browser and AI output are untrusted inputs.
2. The web server may hold an AI API key but no user wallet key.
3. The keeper holds only a testnet function-call key restricted to the Auvora contract and `execute_due`.
4. The contract alone approves or rejects a transfer.
5. RPC responses are reconciled at finality before the UI reports success.

### Approved gas sponsorship model

Product decision approved on 2026-10-22:

- Users provide the native NEAR assigned to their treasury workflow.
- Auvora sponsors gas for supported management actions through a NEP-366 relayer.
- The keeper sponsors gas for scheduled `execute_due` calls.
- On testnet, onboarding may direct the user to a faucet or provide a small testnet allocation for the initial native NEAR deposit transaction.

The initial native NEAR deposit remains a normal user-signed payable transaction. NEAR meta-transactions charge both gas and any attached balance to the relayer, so a delegated payable call cannot cleanly take the attached native NEAR from the user's balance while Auvora pays only its gas. This distinction must be explicit in the UI.

## 4. Module boundaries

### Web application

Responsibilities:

- Connect a NEAR testnet wallet.
- Accept natural language or manual configuration.
- Validate AI output with a shared schema.
- Convert human amounts to decimal strings and atomic yoctoNEAR without floating point.
- Convert the user's local time and time zone to a UTC timestamp, then require confirmation.
- Build explicit transaction requests for wallet signing.
- Render contract state and derived execution history.
- Label simulated forecasts separately from on-chain balances.

The web application does not schedule jobs, custody a wallet key, or decide whether a payment is allowed.

### AI workflow parser

The parser is a server-only adapter with a provider-neutral interface:

```text
parseInstruction(text, ownerAccountId, locale, now) -> WorkflowDraft
```

The response is accepted only after schema validation. Missing recipient, amount, interval, start time, or reserve produces a clarification result, not an executable draft. Provider failure falls back to the manual form. The model name and endpoint are configuration, not hardcoded domain logic.

### Contract client

The client adapter isolates wallet and RPC libraries from feature code. It exposes typed operations such as `getWorkflow`, `listOwnerWorkflows`, `createWorkflow`, and `pauseWorkflow`. Method names are Auvora contract methods, not SDK methods.

### Gas sponsorship relayer

The relayer accepts a user-signed, short-lived NEP-366 delegate action, verifies its nonce, expiry, network, receiver, method, arguments, and sponsorship policy, then wraps and submits it using the relayer account. The contract still observes the delegated action as originating from the user's account for owner authorization.

The MVP relayer sponsors only explicitly allowlisted nonpayable methods. It rejects arbitrary receivers, unknown methods, attached deposits, broad batches, expired actions, and requests above per-account limits. The relayer and keeper may share deployment infrastructure, but they use separate keys, budgets, modules, and audit records.

Wallet support for signing delegate actions must be proven in Phase 0. If the selected wallet cannot produce a compatible signature, the team must select a compatible wallet flow or explicitly revise the gasless requirement. The implementation must not silently fall back to charging users for management gas.

### Keeper worker

The keeper discovers candidate workflows, checks their current chain state, acquires a short database lease, submits `execute_due`, waits for finality, and records the result. It never calculates a replacement recipient or amount.

### Reconciler and read model

The reconciler normalizes contract views, NEP-297 logs, submitted transaction hashes, and final RPC outcomes into PostgreSQL. It can repair a stale cache by re-reading the contract. A database row may be deleted and rebuilt without changing financial truth.

### Smart contract

The contract owns the policy and payment state machine described below. It does not call an AI service, depend on the database, or trust the keeper's clock.

## 5. Smart contract model

### Core records

`Workflow`:

- `id`: monotonically assigned `u64`
- `owner_id`: NEAR account that authorized the workflow
- `recipient_id`: immutable for the MVP
- `amount`: `NearToken` or serialized `u128` in yoctoNEAR
- `max_per_run`: must be greater than or equal to `amount`
- `min_reserve`: minimum workflow ledger balance after a payment
- `interval_ms`: bounded minimum and maximum interval
- `next_run_at_ms`: UTC Unix timestamp
- `max_runs`: bounded positive integer
- `runs_completed`: number of transfers confirmed successful by callbacks
- `available_balance`: workflow funds not currently reserved by a pending transfer, excluding storage credit
- `pending_amount`: amount reserved by the optional in-flight execution
- `state`: `Active`, `Paused`, `Completed`, or `Cancelled`
- `pending_execution_id`: optional in-flight execution
- `config_hash`: hash of canonical approved configuration
- `last_execution`: bounded current execution summary

`ExecutionSummary`:

- deterministic `execution_id`
- `workflow_id`
- `run_index`
- `scheduled_for_ms`
- `attempt`
- `status`: `Pending`, `Success`, `Failed`, or `Skipped`
- machine-readable reason code
- dispatch and finalization timestamps

Full history is emitted as NEP-297-compatible event logs and indexed off-chain. The contract keeps only bounded state needed for idempotency and recovery. The transaction hash is obtained from RPC; a contract does not receive its outer transaction hash as a normal method argument.

### Policy invariants

For every transfer dispatch, the contract checks all of the following using its own state and block time:

1. The workflow is active.
2. `block_timestamp >= next_run_at`.
3. `runs_completed < max_runs`.
4. No transfer for the same execution slot has already been dispatched.
5. The recipient is still in the owner's allowlist.
6. `amount <= max_per_run`.
7. `ledger_balance - amount >= min_reserve`.
8. The physical contract balance remains above storage staking and an operational safety buffer after the transfer.
9. The workflow has no unresolved in-flight execution.

The shared contract account is physically pooled, but every workflow has a segregated internal ledger. `available_balance` is the withdrawable/accounted liability; `pending_amount` is a separately locked, in-flight amount whose transfer receipt may already have left the contract before its callback runs. One owner or workflow cannot spend another workflow's recorded available balance.

### Proposed methods

Owner-authorized methods:

- `create_workflow(args)` (payable): create an active policy from the reviewed configuration; exact storage cost is retained and remaining deposit may be credited to the workflow ledger.
- `fund_workflow(workflow_id)` (payable): credit only the selected workflow ledger.
- `add_allowed_recipient(account_id)` and `remove_allowed_recipient(account_id)`.
- `pause_workflow(workflow_id)`.
- `resume_workflow(workflow_id)`.
- `cancel_workflow(workflow_id)`.
- `withdraw_available(workflow_id, amount)`.

Permissionless method:

- `execute_due(workflow_id)`: evaluate policy, reserve a deterministic run slot, and dispatch a native NEAR transfer when permitted.

Private callback:

- `on_transfer_complete(execution_id)`: record the promise result without accepting arbitrary external calls.

Views:

- `get_workflow(workflow_id)`.
- `list_owner_workflows(owner_id, cursor, limit)`.
- `list_workflows(cursor, limit)` for bounded keeper discovery in the MVP.
- `get_withdrawable(workflow_id)`.
- `get_contract_health()` for storage and operational balance visibility.

Final names and signatures are fixed only after Phase 1 contract tests.

### Idempotency and async transfer sequence

```text
execute_due
  -> validate policy and deterministic run slot
  -> move amount from available_balance to pending_amount
  -> store Pending execution and emit payment_dispatched
  -> Promise::transfer(recipient)
  -> private callback
       success: clear pending_amount, runs_completed++, advance next_run_at,
                mark Success, emit payment_succeeded
       failure: move pending_amount back to available_balance,
                keep the same run slot due for a later retry,
                mark Failed, emit payment_failed
```

State is reserved before the promise is created, so concurrent keepers cannot dispatch the same run twice. NEAR cross-contract calls and callbacks are asynchronous and do not automatically roll back prior state. The callback must therefore be minimal, private, amply funded with gas, and written so known outcomes do not panic. See [NEAR cross-contract calls](https://docs.near.org/smart-contracts/anatomy/crosscontract).

A callback can still fail independently. The safe failure mode is to halt new dispatch for that workflow while `pending_execution_id` remains set. The MVP must not provide an automatic timeout that guesses whether money moved. Recovery from an ambiguous callback requires explicit operator investigation and is a documented testnet limitation.

### Reserve and withdrawal semantics

The execution guard is:

```text
post_payment_balance = available_balance - amount
allow payment only if post_payment_balance >= min_reserve
```

For an active or paused workflow, the recommended conservative withdrawal calculation is:

```text
pending_runs = 1 if a transfer is pending, otherwise 0
future_obligations = amount * (max_runs - runs_completed - pending_runs)
locked_from_available = min_reserve + future_obligations
withdrawable = max(available_balance - locked_from_available, 0)
```

After cancellation or completion, future obligations and reserve are unlocked, but an already dispatched transfer remains reserved until its callback resolves. This policy favors predictable funding over maximum liquidity.

### Schedule semantics

- The frontend converts local input to UTC and displays both local time and UTC in the review.
- The contract stores integer Unix milliseconds and uses block time.
- The MVP uses a fixed interval, not cron syntax.
- Recommended missed-run policy: no burst catch-up. After a delayed execution, the next run is scheduled at least one interval in the future.
- Pause and cancel stop future dispatches. They cannot undo a transfer already in `Pending`.

The missed-run rule is an open product decision listed in `IMPLEMENTATION_PLAN.md`.

## 6. Scheduler and keeper design

### Discovery loop

1. Poll contract workflow IDs in bounded pages every 10 to 30 seconds.
2. Filter candidates using chain views, not cached due times alone.
3. Acquire a PostgreSQL lease keyed by `(network, contract_id, workflow_id)`.
4. Re-read the workflow immediately before submission.
5. Submit `execute_due(workflow_id)`.
6. Wait for `FINAL` execution status.
7. Store transaction hash, final outcome, and parsed events.
8. Release or expire the lease. Contract idempotency remains the final concurrency control.

### Keeper account

- Use a dedicated testnet account.
- Store its private key only in deployment secrets.
- Prefer a function-call access key restricted to the Auvora contract and `execute_due`.
- Set a finite gas allowance and monitor depletion.
- Do not grant a full-access key to the application runtime.
- Do not permit keeper calls to owner methods, recipient changes, funding, or withdrawal.

NEAR function-call keys are restricted by receiver, optional method list, and gas allowance, and cannot attach NEAR to a call. This fits a nonpayable trigger method. See [NEAR access keys](https://docs.near.org/protocol/accounts-contracts/access-keys).

### Relayer account

- Use a dedicated account and key separate from the keeper.
- Maintain a method allowlist for sponsored actions.
- Reject any delegate action with an attached balance in the MVP.
- Enforce short expiry, nonce validation, network and contract binding, rate limits, and per-account daily gas budgets.
- Query finality and return the transaction hash to the client.
- Monitor balance and pause sponsorship when budget or RPC health checks fail.
- Never accept a private key, seed phrase, or unsigned executable payload from the user.

### Retry policy

- Network error before a transaction hash: re-read chain state, then retry with exponential backoff.
- Transaction hash obtained: never blindly resubmit; query the hash to finality first.
- Contract returns not due, paused, completed, already dispatched, or reserve blocked: record a non-retryable decision until state or due time changes.
- RPC unavailable or inconsistent: fail closed and alert; do not infer success.
- Two keepers submit concurrently: one may spend gas, but only one can reserve the run slot.

### Deployment shape

The keeper must be a long-running Node.js process or a frequent platform scheduler. It must not rely on a browser tab or an unbounded loop inside a serverless request. For the demo, deploy it as a small container with a health endpoint and use PostgreSQL for leases. A second standby process is optional because the contract is idempotent.

## 7. Data ownership and consistency

| Data | Authority | Cache/read model |
| --- | --- | --- |
| Workflow policy and status | Smart contract | PostgreSQL and UI query cache |
| Workflow ledger and reserve | Smart contract | PostgreSQL snapshot |
| Owner and allowlist | Smart contract | PostgreSQL snapshot |
| Execution dispatch/final state | Contract state plus finalized receipt | PostgreSQL execution row |
| Transaction hash and explorer URL | Finalized RPC response | PostgreSQL |
| AI draft | User review session | Optional short-lived database row |
| Human-readable explanation | AI output, explicitly non-authoritative | Draft only |
| Forecast | Deterministic application calculation | Not written on-chain |

The UI may show `Submitted` after wallet or keeper submission, but only shows `Success` after final RPC status and the expected contract event/state agree.

## 8. Failure states that must be visible

- Wallet rejected the signature.
- Transaction submitted but not finalized.
- Contract rejected the call with a stable error code.
- Execution skipped because reserve, allowlist, schedule, state, or storage safety failed.
- Native transfer failed and the ledger was restored.
- Callback unresolved and workflow halted for investigation.
- RPC or index cache stale.
- AI unavailable or invalid, with manual form available.
- Keeper offline or last heartbeat stale.

## 9. Proposed folder structure

```text
auvora/
├── apps/
│   ├── web/                       # Next.js UI and server-only AI endpoint
│   │   └── src/
│   │       ├── app/
│   │       ├── features/
│   │       │   ├── wallet/
│   │       │   ├── workflows/
│   │       │   ├── execution-history/
│   │       │   └── treasury-overview/
│   │       └── server/
│   │           └── ai/
│   ├── keeper/                    # Long-running TypeScript worker
│   │   └── src/
│   │       ├── discovery/
│   │       ├── execution/
│   │       ├── reconciliation/
│   │       └── health/
│   └── relayer/                   # NEP-366 gas sponsorship service
│       └── src/
│           ├── policy/
│           ├── delegate-actions/
│           ├── submission/
│           └── health/
├── contracts/
│   └── treasury/
│       ├── src/
│       ├── tests/
│       └── Cargo.toml
├── packages/
│   ├── config/                    # Typed environment validation
│   ├── db/                        # Prisma schema, migrations, client
│   ├── domain/                    # TypeScript domain types and pure calculations
│   ├── near-client/               # RPC/wallet adapters and event parsing
│   └── workflow-schema/           # Zod draft schema and canonicalization
├── docs/
├── scripts/                       # Reproducible deploy/demo helpers, no secrets
├── .github/workflows/
├── pnpm-workspace.yaml
└── README.md
```

This is a target structure, not permission to create application code before Phase 1 approval.

## 10. External references

- [NEAR transfers and actions](https://docs.near.org/smart-contracts/anatomy/actions)
- [NEAR asynchronous cross-contract calls](https://docs.near.org/smart-contracts/anatomy/crosscontract)
- [NEAR access keys](https://docs.near.org/protocol/accounts-contracts/access-keys)
- [NEAR frontend and Wallet Selector guide](https://docs.near.org/web3-apps/tutorials/mastering-near/2.1-frontend)
- [NEAR storage cost attacks](https://docs.near.org/smart-contracts/security/storage)
- [NEP-297 event format](https://github.com/near/NEPs/blob/master/neps/nep-0297.md)
- [NEAR transaction finality guidance](https://docs.near.org/integrations/create-transactions)
- [NEAR meta-transactions](https://docs.near.org/protocol/transactions/meta-tx)
- [NEP-366](https://github.com/near/NEPs/blob/master/neps/nep-0366.md)
- [NEAR Workspaces](https://github.com/near/near-workspaces-rs)
- [NEAR AI Cloud API](https://github.com/nearai/cloud-api)
