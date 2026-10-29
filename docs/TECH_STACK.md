# Auvora Finance MVP Technology Stack

Status: proposed for approval  
Target: NEAR testnet, 1 to 14 November 2026 development window  
Dependency check date: 2026-10-22

## 1. Recommended stack

| Layer | Choice | Why | Trade-off |
| --- | --- | --- | --- |
| Repository | pnpm workspaces | One TypeScript dependency graph without adding monorepo orchestration during a two-week build | Fewer build-cache features than Turborepo or Nx |
| Web | Next.js 16, React 19, TypeScript strict | Current server/client framework, route handlers for the AI endpoint, strong demo ergonomics | Must keep wallet code in client-only boundaries |
| UI styling | Tailwind CSS 4 plus a small accessible primitive set | Fast implementation with explicit product-specific components | Avoid importing a large copied design system |
| Forms | React Hook Form plus Zod | Editable review form and shared runtime validation | Zod schemas must not be treated as contract validation |
| Wallet | NEAR Wallet Selector for the MVP, behind an adapter | Official NEAR-focused signing path and current documentation | NEAR organization labels it as legacy; keep replacement seam |
| Chain client | `near-api-js` v7 for keeper/RPC; Wallet Selector for browser signing | Official library, finality-aware transaction queries, TypeScript support | API changes from older tutorials require a Phase 0 spike |
| Contract | Rust stable, `near-sdk` 5.x, WebAssembly | Required by the brief and appropriate for deterministic policy enforcement | Async promise semantics require careful tests |
| Contract build | `cargo-near` | Official NEAR contract build tooling | Pin exact stable version in lock/setup docs |
| Contract tests | Rust unit tests plus `near-workspaces` sandbox/integration tests | Tests real receipts, callbacks, and concurrency behavior | Sandbox supports Linux/macOS, not native Windows per repository docs |
| Database | PostgreSQL plus Prisma | Relational unique constraints, leases, migrations, and a disposable read model | More infrastructure than SQLite, but safer for worker concurrency |
| Keeper | Node.js 22 LTS, TypeScript, compiled with `tsc` or `tsx` in development | Same language and domain packages as web, independent long-running process | Needs a container or worker host, not a pure serverless request |
| Gas relayer | Separate Node.js TypeScript service using NEP-366 delegate actions | Auvora sponsors management gas without holding the user's wallet key | Wallet signature compatibility and relayer abuse controls require an early spike |
| AI | Provider adapter, NEAR AI Cloud first when credentials and model access work | Current NEAR AI Cloud exposes an OpenAI-compatible API | Access, model behavior, and structured-output support must be tested |
| AI fallback | Manual workflow form, always enabled | Removes provider availability from the payment demo's critical path | Less impressive when the model is unavailable, but functionally complete |
| Events | NEP-297-compatible contract logs | Standard, parseable activity records | Logs need an off-chain index for full history UX |
| Explorer | NearBlocks testnet link built from a validated transaction hash | Human-verifiable proof for the demo | Explorer availability is external to Auvora |
| CI | GitHub Actions on Ubuntu | Supports Rust sandbox tests that are unavailable natively on Windows | CI setup must be complete before relying on integration results |

## 2. Version policy

Do not write floating `latest` dependencies. At Phase 0:

1. Resolve current stable versions from official registries.
2. Pin direct dependencies in manifests and commit lockfiles.
3. Record Node and Rust toolchains.
4. Run a minimal wallet sign-in, view call, signed call, contract build, and sandbox callback test.
5. Upgrade only through explicit pull requests after the demo baseline is stable.

Versions observed during this review:

| Package/tool | Observed stable version | Source |
| --- | --- | --- |
| `near-sdk` | 5.29.1 | Official GitHub release list and crates.io API |
| `near-workspaces` | 0.23.0 | crates.io API |
| `cargo-near` | 0.22.0 | crates.io API |
| Rust | 1.99.1 | Official stable release on 2026-10-15; selected during Phase 0 after current NEAR crates exceeded the planning-time compiler floor |
| `@near-wallet-selector/core` | 10.1.4 | npm registry |
| `near-api-js` | 7.3.1 | npm registry |
| Next.js | 16.4.2 | npm registry |
| Zod | 4.6.7 | npm registry |

These observations are evidence for planning, not a permanent pin. Recheck at Phase 0 because current versions can change before development starts.

## 3. Wallet decision

### Recommendation

Use NEAR Wallet Selector for the primary testnet path and isolate it behind `packages/near-client`. It is documented in NEAR's current frontend guide and supports user-controlled signing without exposing keys to Auvora.

### HOT Kit evaluation

HOT Kit currently documents a NEAR connector and multiple wallet options, but its setup requires a HOT API key and a WalletConnect/Reown project ID for the documented configuration. That adds two external dependencies to the hero path. It is valuable for later onboarding and chain abstraction, but it should not replace the NEAR-native path until a timeboxed Phase 0 test confirms:

- NEAR testnet network selection is explicit and reliable.
- The signed function-call payload can be reviewed before confirmation.
- Native NEAR payable contract calls work end to end.
- Disconnect/reconnect and account changes are observable.
- No application-controlled full-access wallet key is created.

If the test passes and the team wants the partner integration, the adapter boundary allows HOT Kit to be added without changing workflow domain logic.

References:

- [NEAR Wallet Selector](https://github.com/near/wallet-selector)
- [NEAR frontend guide](https://docs.near.org/web3-apps/tutorials/mastering-near/2.1-frontend)
- [HOT Kit documentation](https://docs.hotdao.ai/hot-kit)

## 4. NEAR client decision

Use Wallet Selector for interactive browser signing. Use `near-api-js` v7 in the keeper and server utilities for RPC reads, signing with the restricted keeper key, submitting function calls, and waiting for finality.

Do not copy API examples from old `near-api-js` versions. The current official transaction guide uses `Account`, `JsonRpcProvider`, `KeyPairSigner`, and `waitUntil: "FINAL"`. All Phase 1 calls must be verified against installed type definitions.

`near-kit` is a credible newer option and supports newer key types. The approved gas-sponsorship requirement makes it relevant in Phase 0 because current NEAR documentation identifies it as supporting DelegateV2. Test it alongside the installed wallet path. Use it only if its real delegate signing, submission, and finality flow passes the spike. No library is selected for this role based on documentation alone.

References:

- [Current NEAR transaction guide](https://docs.near.org/integrations/create-transactions)
- [`near-api-js` repository](https://github.com/near/near-api-js)

## 5. Contract tooling decision

- Use `near-sdk` with `NearToken`, integer timestamps, typed account IDs, private callbacks, and bounded collections.
- Build reproducibly with `cargo-near`.
- Run fast unit tests on every change.
- Run `near-workspaces` sandbox tests on Ubuntu CI or WSL2/Docker during development because native Windows sandbox is not supported by the project documentation.
- Add a small set of testnet smoke tests only after sandbox tests pass. Testnet is not a replacement for deterministic integration tests.

Do not introduce fungible-token standards, NEAR Intents, cross-chain assets, staking, lending, or yield contracts in the MVP.

## 6. Database decision

Select PostgreSQL instead of SQLite because the keeper needs leases and unique execution records even if multiple worker processes run. Prisma is selected to stay within the PRD's proposed choices and provide typed migrations quickly.

Minimum tables:

- `workflow_snapshot`: derived chain state keyed by network, contract, and workflow ID.
- `execution`: unique on network, contract, workflow ID, and run index.
- `keeper_lease`: expiring lease keyed by workflow.
- `submitted_transaction`: hash, signer, method, submission time, final state, and error code.
- `ai_draft` (optional): short-lived sanitized input, validated output, provider metadata, and approval timestamp. Disable prompt retention by default.
- `service_heartbeat`: keeper version and last healthy poll.

No database row grants spending authority.

## 7. AI integration decision

NEAR AI Cloud is the preferred provider only after credentials, available models, rate limits, and response behavior are tested. Its current Cloud API describes OpenAI-compatible chat-completion and response endpoints. The application should use a small provider interface rather than importing provider-specific types throughout the codebase.

The MVP must not assume provider-enforced structured output. Instead:

1. Ask for one JSON object matching a documented schema.
2. Parse text as JSON.
3. Validate with Zod.
4. Reject or request clarification for missing or ambiguous financial fields.
5. Allow at most one repair attempt.
6. Present an editable preview.
7. Require wallet authorization for the canonical configuration.

Never send seed phrases, private keys, wallet session material, or unnecessary financial history to the model.

References:

- [NEAR AI Cloud API](https://github.com/nearai/cloud-api)
- [NEAR AI inference SDK](https://github.com/nearai/inference-sdk)

## 8. Hosting recommendation

Keep deployment portable:

- `apps/web`: Node-compatible Next.js hosting.
- `apps/keeper`: a continuously running container with restart policy and health checks.
- `apps/relayer`: a separate service or separately keyed process with rate limits, sponsorship budgets, and an independently rotatable key.
- PostgreSQL: managed database with TLS and backups.
- Secrets: platform secret store, never committed or prefixed with `NEXT_PUBLIC_`.
- RPC: configurable testnet endpoint with conservative retry and optional secondary endpoint.

The final provider is an approval decision. The architecture should not depend on provider-specific cron behavior.

## 9. Rejected or deferred choices

| Choice | Status | Reason |
| --- | --- | --- |
| Backend-held user private key | Rejected | Violates custody and authorization boundaries |
| Full-access keeper key | Rejected | Trigger service does not need broad account control |
| One shared key for keeper and relayer | Rejected | Execution and user sponsorship have different permissions and abuse risks |
| AI tool that calls `execute_due` directly | Rejected | Scheduling is deterministic and permissionless; AI adds no authority |
| SQLite for deployed keeper | Rejected | Weak fit for concurrent leases and multiple processes |
| Redis/BullMQ | Deferred | PostgreSQL polling and leases are sufficient for MVP |
| Full NEAR Lake indexer | Deferred | Operationally heavy for a bounded testnet demo |
| NEAR Intents | Deferred | Cross-chain execution is explicitly outside MVP |
| OutLayer custody | Deferred | Native contract policy path must work without a third party |
| HOT social login | Deferred pending spike | Additional API and WalletConnect dependencies |
| Real yield integration | Rejected for MVP | Explicit PRD non-goal |

## 10. Environment variables planned

Names only, with no values committed:

- `NEAR_NETWORK_ID=testnet`
- `NEAR_RPC_URL`
- `AUVORA_CONTRACT_ID`
- `KEEPER_ACCOUNT_ID`
- `KEEPER_PRIVATE_KEY` (keeper deployment only)
- `RELAYER_ACCOUNT_ID`
- `RELAYER_PRIVATE_KEY` (relayer deployment only)
- `RELAYER_MAX_GAS_PER_REQUEST`
- `RELAYER_DAILY_BUDGET`
- `DATABASE_URL`
- `AI_PROVIDER`
- `NEAR_AI_BASE_URL`
- `NEAR_AI_API_KEY`
- `AI_MODEL`
- `NEXT_PUBLIC_NEAR_NETWORK_ID`
- `NEXT_PUBLIC_AUVORA_CONTRACT_ID`

The keeper secret must never be present in the web build environment.
