# Auvora Finance

Your Treasury, on Autopilot.

Auvora Finance is a testnet-only treasury automation project for the NEAR Hackathon 2026 Autonomous Business track. The MVP target is a user-authorized recurring native NEAR payment with contract-enforced recipient, spending, reserve, and idempotency rules.

This repository has completed the live **Phase 0 foundation and dependency proof** and is entering **Phase 1: contract policy and accounting core**. It does not yet move treasury funds.

## Phase 0 contents

- Strict TypeScript pnpm workspace.
- Next.js testnet proof shell with Wallet Selector, final contract reads, and a zero-deposit owner call.
- Minimal Rust and `near-sdk` contract with a view, harmless owner call, and keeper proof call.
- Typed testnet-only environment parsing.
- Keeper service boundary with no financial parameters.
- Relayer sponsorship policy that rejects deposits, unknown methods, wrong receivers, expired actions, and excessive gas.
- Ubuntu CI for TypeScript, Rust, sandbox deployment, WASM build, and a basic tracked-file secret pattern scan.

## Prerequisites

- Node.js 22.x
- Corepack with pnpm 12.14.0
- Rust 1.99.1 with `rustfmt`, `clippy`, and `wasm32-unknown-unknown`
- `cargo-near` 0.22.0
- Linux, WSL2, or Ubuntu CI for `near-workspaces` sandbox tests

Do not place a wallet seed phrase or user private key in this repository. The keeper and relayer use separate, limited testnet service keys supplied only through their deployment secret stores.

## Setup

```bash
corepack enable
corepack prepare pnpm@12.14.0 --activate
pnpm install --frozen-lockfile
rustup show
cargo install --locked cargo-near --version 0.22.0
```

Copy `.env.example` to an untracked `.env` only when running service proofs. For the Next.js wallet proof, put `NEXT_PUBLIC_AUVORA_CONTRACT_ID` and the public testnet RPC URL in `apps/web/.env.local`. Values in `.env.example` are names or public defaults, not secrets.

Run the web proof after deploying the Phase 0 contract:

```bash
pnpm --filter @auvora/web dev
```

The page remains in an explicit configuration state until a contract ID is set. It never asks for a seed phrase or private key.

Local credential files are already prepared and ignored by Git:

- `apps/web/.env.local` contains public browser configuration only.
- `.env.keeper.local` contains the restricted keeper account configuration.
- `.env.relayer.local` contains the separately funded relayer configuration.

See [Phase 0 environment setup](docs/phase-0/ENV_SETUP.md) before adding any key.

Deploy and initialize the Phase 0 contract atomically on testnet after filling
the ignored `.env.deploy.local` file with the owner account's full-access key:

```bash
pnpm deploy:testnet
```

The deployment command is locked to `testnet`, requires an exact
`DEPLOY_CONFIRM` match, and refuses to overwrite an account that already has
contract code.

## Validation

```bash
pnpm check
pnpm build
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --locked
cd contracts/treasury
cargo near build non-reproducible-wasm --locked
```

Native Windows is suitable for the TypeScript checks and Rust unit tests after Rust is installed. Run the sandbox integration test on Linux, WSL2, or Ubuntu CI.

## Current proof status

The Phase 0 contract is deployed at `oceanear.testnet`. Meteor Wallet completed an owner-signed call, the restricted `oceankeeper.testnet` key called only its allowlisted method, and `oceanrelayer.testnet` finalized a sponsored NEP-366 call without reducing the owner's total balance. Details and transaction evidence are recorded in [Phase 0 validation](docs/phase-0/VALIDATION.md). The Ubuntu sandbox/CI proof remains a release gate.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Technology stack](docs/TECH_STACK.md)
- [Security model](docs/SECURITY.md)
- [Phase 0 validation](docs/phase-0/VALIDATION.md)
- [Wallet decision](docs/phase-0/WALLET_DECISION.md)
- [Phase 0 web design record](docs/phase-0/WEB_DESIGN.md)

## Scope boundary

The hackathon MVP is NEAR testnet only. It excludes mainnet funds, yield farming, lending, cross-chain execution, and unrestricted AI wallet authority. AI proposes a draft; a user reviews and authorizes canonical financial fields; the contract makes the final execution decision.
