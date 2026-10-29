# Phase 0 Local Environment Setup

The local environment is split by trust boundary. Do not copy private keys into `apps/web/.env.local` or any `NEXT_PUBLIC_*` variable.

## Web proof

Edit `apps/web/.env.local` and set:

- `NEXT_PUBLIC_AUVORA_CONTRACT_ID`: the deployed Phase 0 testnet contract account ID.
- `NEXT_PUBLIC_NEAR_RPC_URL`: keep the default unless a different public testnet RPC is intentionally selected.

The web file contains public values only.

## Keeper proof

Edit `.env.keeper.local` and set:

- `AUVORA_CONTRACT_ID`: the same deployed testnet contract ID.
- `KEEPER_ACCOUNT_ID`: the dedicated keeper testnet account.
- `KEEPER_PRIVATE_KEY`: a function-call key restricted on-chain to the contract and `keeper_ping` method.
- `DATABASE_URL`: the Phase 0 local database connection when the keeper starts using persistence.

Do not use the contract owner key. Verify the access-key permission on-chain before recording Phase 0 evidence.

## Relayer proof

Edit `.env.relayer.local` and set:

- `AUVORA_CONTRACT_ID`: the same deployed testnet contract ID.
- `RELAYER_ACCOUNT_ID`: the dedicated funded relayer testnet account.
- `RELAYER_PRIVATE_KEY`: the relayer account key.
- `DATABASE_URL`: the Phase 0 local database connection when the relayer starts using persistence.

Do not reuse the owner or keeper key. The relayer policy must continue to reject deposits, unknown methods, wrong receivers, expired actions, and excessive gas.

## One-time testnet deployment

Edit `.env.deploy.local` and set:

- `OWNER_ACCOUNT_ID`: the account that owns and currently hosts the Phase 0 contract (`oceanear.testnet`).
- `OWNER_PRIVATE_KEY`: a full-access key for that owner account, used only by the local deployment command.
- `DEPLOY_CONFIRM`: must exactly match `AUVORA_CONTRACT_ID` or deployment stops.
- `WASM_PATH`: the local path to the compiled treasury contract.

Run `pnpm deploy:testnet` only after the WASM build succeeds. The command deploys and initializes in one transaction, refuses mainnet, and refuses to overwrite existing contract code.

## Safe handling

- Paste keys only into the local ignored files, never into chat, screenshots, shell arguments, or tracked documentation.
- Keep the `ed25519:` prefix exactly as exported by the NEAR tooling.
- Use testnet-only accounts with the minimum permissions and balance needed for the proof.
- Rotate a key immediately if it appears in terminal output, Git history, a screenshot, or a message.
- Deployment secret stores must receive keeper and relayer keys as separate secrets.
