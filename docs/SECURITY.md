# Auvora Finance MVP Security Model

Status: proposed for approval, not an audit  
Scope: NEAR testnet MVP

## 1. Security goal

The MVP must demonstrate constrained automation, not autonomous custody. A user explicitly authorizes a deterministic policy. The smart contract enforces that policy each time an external keeper asks it to execute. Compromise of the AI service, web server, database, or keeper must not allow an attacker to change the recipient, increase the amount, reduce the reserve, or withdraw another user's funds.

This document is a design review. It does not justify claims such as audited, production-ready, secure custody, or safe for mainnet.

## 2. Assets and trust boundaries

Assets to protect:

- Native testnet NEAR assigned to workflow ledgers.
- Owner authorization and wallet session integrity.
- Workflow policy, allowlist, schedule, and state.
- Keeper function-call key and AI provider key.
- Correct execution status and audit evidence.
- User prompts and any treasury metadata retained off-chain.

Trusted for financial decisions:

- Deployed Auvora contract code and NEAR execution.
- The owner's wallet signature for owner-only changes.

Not trusted for financial decisions:

- AI output.
- Browser inputs.
- Keeper timing or request payload beyond workflow ID.
- PostgreSQL cache.
- RPC response from a single failed or inconsistent request.
- Explorer UI.

## 3. Permission matrix

| Capability | User wallet | AI service | Web server | Keeper | Contract |
| --- | ---: | ---: | ---: | ---: | ---: |
| Suggest workflow fields | Yes | Yes | Transports | No | No |
| Approve canonical config | Yes | No | No | No | Verifies signer |
| Add/remove recipient allowlist | Yes | No | No | No | Enforces owner |
| Fund workflow | Yes | No | No | No | Credits ledger |
| Change amount/reserve/schedule | Yes, through an explicit signed replacement flow | No | No | No | Enforces owner and invariants |
| Trigger due evaluation | Yes | No | No | Yes | Final decision |
| Choose recipient or amount at execution | No | No | No | No | Reads approved policy |
| Pause/resume/cancel | Yes | No | No | No | Enforces owner |
| Withdraw available balance | Yes | No | No | No | Calculates and enforces limit |
| Mark payment successful | No | No | No | No | Private callback plus final receipt |

For sponsored management actions, the user signs a delegate action off-chain and the relayer pays gas. The signature still binds the user to the exact receiver, method, arguments, nonce, and expiry. The relayer does not become the workflow owner.

The recommended MVP does not support in-place edits to financial fields. An owner pauses or cancels the old workflow and signs a replacement. This reduces state-machine and authorization complexity.

## 4. Contract controls

### Authorization

- `predecessor_account_id` must equal the stored workflow owner for all policy and withdrawal methods.
- Callback methods must be private and accept only the contract itself as predecessor.
- `execute_due` is permissionless and nonpayable. Its only caller-controlled financial input is the workflow ID.
- A workflow recipient is immutable in the MVP.
- The owner-level recipient allowlist is checked at creation and again at execution.

### Numeric safety

- Use `u128`/`NearToken` for yoctoNEAR and checked arithmetic.
- Accept decimal NEAR only in the UI, convert with a tested decimal utility, and serialize atomic amounts as strings.
- Never use JavaScript `number` or Rust floating point for money.
- Bound interval, start time, max runs, pagination, and string lengths.
- Reject zero amount, zero max runs, impossible timestamps, self-recipient if the policy forbids it, and values that overflow multiplication.

### Accounting invariants

- Sum of workflow available balances must never exceed usable contract funds after storage and operational buffers. Pending outgoing amounts are tracked separately because the transfer receipt may execute before its callback.
- A workflow can debit only its own ledger.
- Move value from available to pending and reserve the idempotency slot before transfer promise creation.
- A failed transfer callback restores exactly the reserved amount once.
- Success callbacks cannot be replayed.
- Withdrawals cannot consume active obligations, minimum reserve, pending transfer amount, storage staking, or operational buffer.
- Cancellation does not reclaim an already dispatched payment.

Tests should assert these invariants after every state transition, not only expected output values.

### Storage safety

NEAR requires an account balance proportional to stored data. Unpaid state growth can lock contract funds. The contract must:

- Measure storage used by owner-created records and charge attached deposit.
- Bound workflows per owner, max runs, metadata, and pagination.
- Avoid storing arbitrary prompts or explanations on-chain.
- Keep execution state bounded and use NEP-297 events for history.
- Include storage stake in physical-balance safety checks.
- Define refund behavior for excess storage deposit and deleted state.

Reference: [NEAR storage cost attacks](https://docs.near.org/smart-contracts/security/storage).

### Async call safety

NEAR transfers and callbacks execute in separate receipts. A downstream failure does not automatically roll back earlier state. Controls:

- Reserve and debit the run slot before dispatch.
- Use one in-flight execution per workflow.
- Give the callback explicit gas and keep it small.
- Never panic for expected success or failure results.
- Mark callback private.
- Halt a workflow if a pending callback becomes ambiguous.
- Do not provide a time-based auto-refund that could credit money after a successful transfer.

Reference: [NEAR cross-contract calls](https://docs.near.org/smart-contracts/anatomy/crosscontract).

## 5. Duplicate-payment threat model

Duplicate triggers can come from keeper retries, two keeper replicas, a user calling the method, an RPC timeout after submission, or a malicious caller.

The idempotency key is derived from contract state, such as `(workflow_id, run_index, scheduled_for_ms)`. The caller cannot choose it. `execute_due` stores the pending key and moves the amount from available to pending in one receipt before creating the transfer promise. Any later call observes the pending slot. Only a successful callback increments the completed-run counter and advances the schedule. A confirmed transfer failure restores available balance and permits a later retry of the same slot.

Database uniqueness and leases reduce wasted gas but are not security controls. The contract test suite must include concurrent submission attempts and a retry after an unknown client-side result.

## 6. Keeper security

- Dedicated testnet account, never a user account.
- Function-call key restricted to one contract and `execute_due`.
- Finite gas allowance with alerting.
- Key stored only in the keeper host's secret manager.
- No key in `.env.example`, logs, CI artifacts, browser variables, or database.
- Rotate by adding a new restricted key, deploying it, verifying it, then deleting the old key.
- If compromised, remove the public key from the keeper account and replace it. Funds remain controlled by the contract policy.

Function-call keys cannot attach NEAR and are restricted to a receiver and methods, which matches the nonpayable trigger design. See [NEAR access keys](https://docs.near.org/protocol/accounts-contracts/access-keys).

## 7. Gas relayer security

The approved product model sponsors gas for nonpayable management actions. It does not sponsor the user's native NEAR treasury principal.

- Use NEP-366 signed delegate actions so the relayer never receives the user's wallet key.
- Accept only the configured testnet network and Auvora contract receiver.
- Allowlist exact nonpayable methods and validate their decoded arguments.
- Reject attached deposits and arbitrary action batches.
- Require a short `max_block_height`, valid nonce, and signature owned by the claimed sender account.
- Apply per-account, per-IP, and global rate limits plus daily gas budgets.
- Record request ID, sender, method, nonce, transaction hash, gas outcome, and reason code without logging wallet secrets.
- Use a dedicated relayer key, separate from the keeper key.
- Stop accepting requests when the relayer budget, RPC health, or nonce state is uncertain.
- Reconcile an obtained transaction hash before permitting the client to retry.

NEAR's protocol documentation states that the relayer pays gas and also pays any attached balance in a meta-transaction. Therefore the MVP does not relay the initial payable native NEAR deposit. The user signs that funding transaction normally using testnet NEAR. A faucet or small testnet onboarding allocation can cover its gas. See [NEAR meta-transactions](https://docs.near.org/protocol/transactions/meta-tx).

## 8. AI agent boundary

Allowed:

- Extract candidate recipient, amount, interval, start time, max runs, reserve, and explanation.
- Flag ambiguity and suggest safer values.
- Calculate a non-authoritative forecast from already validated inputs.

Forbidden:

- Access wallet private keys or seed phrases.
- Sign or submit transactions.
- Hold a function-call key.
- Call owner-only contract methods.
- Change an authorized workflow.
- Select a different recipient, amount, reserve, or schedule during execution.
- Interpret model prose as executable configuration.
- Claim yields, security guarantees, or compliance.

Every draft passes schema validation and an editable review. The wallet signs canonical fields, not the original prompt or free-form explanation. The contract independently validates the same financial constraints.

## 9. Web and API controls

- Keep AI credentials server-side.
- Apply rate limits, request-size limits, and timeouts to the parser endpoint.
- Use a strict schema and reject unknown executable fields.
- Set Content Security Policy and avoid rendering model output as HTML.
- Validate NEAR account IDs with the installed NEAR library or documented rules.
- Do not trust `NEXT_PUBLIC_*` values for secrets.
- Avoid storing prompts by default; if enabled for debugging, redact account-sensitive text and apply retention limits.
- Use wallet-signed challenges before any private off-chain metadata mutation. Public read endpoints do not need to pretend an account ID is authentication.
- Return stable error codes without stack traces or secret-bearing provider responses.

## 10. Database and reconciliation controls

- Unique constraint on execution slot.
- Expiring leases so crashed workers do not block forever.
- Submitted transaction hash is immutable once recorded.
- Store `submitted`, `final_success`, `final_failure`, and `unknown` separately.
- Reconcile unknown transactions by hash before any retry.
- Contract state wins over stale database status.
- Parse only events from the configured contract account and expected event standard/version.
- Do not infer success from an explorer URL or an HTTP 200 RPC response alone.

## 11. Threats and mitigations

| Threat | Mitigation | Residual MVP risk |
| --- | --- | --- |
| Prompt injection changes financial fields | Strict draft schema, editable review, canonical wallet signature, contract checks | User can still approve a bad draft; UI must make values prominent |
| Keeper compromise | Restricted function-call key, permissionless method has no financial parameters | Attacker can waste gas or trigger legitimately due payments early within block-time rules |
| Relayer abuse drains sponsorship budget | Exact receiver/method policy, no attached deposit, nonce/expiry checks, rate limits, daily budgets | Attacker can still consume some bounded gas before blocking |
| Replayed delegate action | Protocol nonce plus short expiry and request reconciliation | RPC uncertainty can temporarily block a legitimate retry |
| Malicious delegated arguments | Decode and validate arguments, bind signature to exact payload, contract owner checks | User can authorize a harmful policy for their own funds |
| Two keepers pay twice | On-chain slot reservation before promise | One losing call may still consume gas |
| RPC timeout causes blind retry | Query known hash and re-read contract state | Provider outage delays execution |
| Recipient removed after creation | Check allowlist at every execution | Workflow becomes blocked until owner action |
| Reserve bypass through withdrawal | Contract computes conservative withdrawable amount | Policy can be overly restrictive |
| Cross-workflow fund theft | Per-workflow internal ledger and global solvency invariant | Shared contract bugs remain systemic |
| Transfer succeeds, callback fails | Pre-debit, halt unresolved workflow, manual investigation | Status can remain ambiguous; no automatic safe repair |
| Callback reports transfer failure | Restore ledger exactly once | Callback itself still needs sufficient gas |
| State-growth attack | Storage charging and hard bounds | Exact constants require measurement tests |
| Frontend reports false success | Wait for finality, expected event, and reconciled contract state | External explorer can be unavailable |
| Deployer upgrades malicious code | Testnet-only disclosure; separate deployment key; optional lock after demo | MVP contract remains upgrade-trusted unless account is locked |
| AI/provider outage | Manual form always available | Natural-language demo is unavailable |
| Database loss | Rebuild from contract views, known transactions, and logs | Full history recovery depends on retained event source |

## 12. Security test matrix

Contract unit and sandbox tests must cover:

- Non-owner attempts for every owner method.
- Unallowlisted recipient at create and execution.
- Amount above max per run.
- Reserve boundary at exactly equal, one yocto below, and one yocto above.
- Zero and maximum accepted values.
- Execution before due time.
- Duplicate trigger in the same slot.
- Two concurrent triggers.
- Maximum-run completion.
- Pause, resume, cancel, and attempted execution in each state.
- Withdrawal in active, paused, cancelled, completed, and pending states.
- Successful transfer callback.
- Failed transfer to a nonexistent named account and ledger restoration.
- Callback replay and direct external callback call.
- Insufficient physical operational balance.
- Storage deposit underpayment and refund.
- Schedule advancement after keeper downtime.
- Property tests for ledger conservation and no negative/overflow state.

Application tests must cover:

- AI returns malformed JSON, extra fields, scientific notation, decimal overflow, invalid account, ambiguous time, and unsupported token.
- Wallet rejects or abandons signing.
- RPC returns timeout before and after a transaction hash exists.
- UI never shows success for submitted/pending/unknown states.
- Keeper restarts with an existing lease and an unknown transaction.
- Secret scan and dependency audit in CI.
- Valid sponsored pause, resume, cancel, allowlist, and withdraw delegate actions.
- Wrong receiver, wrong network, unknown method, attached deposit, expired height, stale nonce, altered arguments, invalid signature, and duplicate delegate submission.
- Relayer rate-limit and budget exhaustion fail closed.
- Wallet compatibility for signing the exact NEP-366 payload.

## 13. Operational checklist before the demo

- Confirm network and contract ID in UI, keeper, and README are testnet.
- Verify no secret is present in Git history.
- Rotate any key used during local experiments before public release.
- Fund the keeper only for gas.
- Fund the relayer only to the approved sponsorship budget and verify it rejects attached deposits.
- Record the keeper public key and verify its on-chain permission scope.
- Test reserve rejection, duplicate trigger, pause, cancel, withdrawal, and callback failure on the deployed testnet contract.
- Capture at least two finalized payment hashes and one reserve-block event.
- Confirm NearBlocks links open.
- Label all mock or simulated data.
- Do not claim an audit.

## 14. Mainnet blockers

Mainnet is prohibited for the MVP plan. Before any future mainnet release, require an independent contract audit, formal accounting review, upgrade/governance design, incident response plan, monitored multi-provider RPC strategy, recovery procedure for ambiguous callbacks, load and storage-economic testing, privacy review, and legal/compliance review.
