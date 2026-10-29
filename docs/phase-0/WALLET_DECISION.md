# Phase 0 Wallet Decision

Date: 2026-10-22  
Decision: Wallet Selector is the primary NEAR testnet path; HOT Kit is not on the MVP critical path.

## Evidence

- NEAR's current frontend guidance documents Wallet Selector for browser wallet integration.
- The pinned Wallet Selector packages share version `10.1.4`.
- HOT Kit's documented setup requires additional HOT and WalletConnect or Reown configuration, increasing external dependencies for the hero flow.
- A live wallet sign-in, payable call, account-change test, and NEP-366 delegate-signing test have not yet been performed. This decision is therefore an integration baseline, not a compatibility claim.

## Go or no-go criteria

Wallet Selector remains selected only if the web spike proves:

1. explicit testnet selection;
2. connect, disconnect, reconnect, and account-change behavior;
3. visible account ID and network state;
4. a harmless owner-signed function call finalized on testnet;
5. a compatible NEP-366 delegate signature for a nonpayable owner action, either directly or through a narrowly scoped companion library.

If criterion 5 fails, the gasless management-action requirement is blocked. The team must choose a wallet path that can produce the required signature or approve a product requirement change. Auvora must not silently charge the user management gas.

## HOT Kit revisit

Revisit HOT Kit only when test credentials are available and there is time to test its NEAR connector against the same criteria. Do not add it only for a partner badge or claimed integration.
