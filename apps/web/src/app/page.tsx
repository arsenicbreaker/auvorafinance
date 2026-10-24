import { WalletProof } from "../features/wallet/wallet-proof";

export default function Home() {
  return (
    <main>
      <header className="masthead">
        <a className="wordmark" href="#proof" aria-label="Auvora proof console">
          Auvora
        </a>
        <div className="network-label" aria-label="Network: NEAR testnet">
          <span aria-hidden="true" /> NEAR testnet
        </div>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">Phase 0 / wallet path</p>
        <h1 id="page-title">Prove every signature before automating a cent.</h1>
        <p className="lede">
          Connect a user-controlled testnet wallet, inspect the deployed
          contract, then sign one harmless owner call. No treasury workflow or
          payment is available in this phase.
        </p>
      </section>

      <WalletProof
        contractId={process.env.NEXT_PUBLIC_AUVORA_CONTRACT_ID ?? ""}
        rpcUrl={
          process.env.NEXT_PUBLIC_NEAR_RPC_URL ?? "https://rpc.testnet.near.org"
        }
      />

      <footer>
        <p>Testnet only. Never paste a seed phrase or private key here.</p>
        <p>Contract state is read at finality.</p>
      </footer>
    </main>
  );
}
