# Release Checklist

Use this checklist before the public repository, demo post, or hackathon submission. A checked item needs evidence, not an assumption.

## Automated gates

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm format:check`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm audit --audit-level high`
- [ ] `cargo fmt --all --check`
- [ ] `cargo clippy --workspace --all-targets -- -D warnings`
- [ ] `cargo test --workspace --locked`
- [ ] `cargo audit`
- [ ] `cargo near build non-reproducible-wasm --locked`
- [ ] Ubuntu CI sandbox test passes
- [ ] Git history secret scan passes

## Contract and keeper evidence

- [ ] UI, keeper, documentation, and evidence report all use `testnet` and `oceanear.testnet`
- [ ] Keeper key is restricted to `oceanear.testnet` and `execute_due`
- [ ] Two scheduled payments have distinct finalized hashes and expected recipient deltas
- [ ] Duplicate trigger produces one successful transfer for one workflow/run slot
- [ ] Keeper restart reconciles the same persisted hash
- [ ] Reserve guard returns `RESERVE_GUARD` without changing recipient or workflow balance
- [ ] Transfer failure restores the workflow ledger exactly once
- [ ] Direct or repeated callback cannot mutate resolved state
- [ ] Pause prevents the next dispatch
- [ ] Cancel prevents all later dispatches
- [ ] Withdrawal cannot consume active obligations, reserve, or pending value
- [ ] Every explorer URL agrees with final RPC state

## Product evidence

- [ ] Fresh setup follows [Demo runbook](DEMO_RUNBOOK.md) without undocumented credentials
- [ ] Natural-language parser fills an editable form and does not open a wallet
- [ ] Missing or ambiguous fields produce clarification
- [ ] Unsupported assets are rejected
- [ ] Provider timeout or malformed output leaves the manual form usable
- [ ] Wallet rejection or abandonment does not show success
- [ ] Submitted and unknown transactions are not presented as finalized
- [ ] Empty, loading, error, and disconnected states are visible and understandable
- [ ] Keyboard path and mobile layout have been checked

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
