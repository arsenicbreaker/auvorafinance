import Link from "next/link";
import { redirect } from "next/navigation";
import { LandingNavigation } from "./landing-navigation";
import { PaymentStory } from "./payment-story";

const paymentRoutes = [
  "M0 130h180q28 0 28 28v120q0 28 28 28h150q28 0 28 28V2000",
  "M1440 130h-180q-28 0-28 28v120q0 28-28 28h-150q-28 0-28 28V2000",
  "M0 390h250q30 0 30 30v140q0 30 30 30h220q30 0 30 30V2000",
  "M1440 390h-250q-30 0-30 30v140q0 30-30 30H910q-30 0-30 30V2000",
];

const capabilities = [
  {
    number: "01",
    title: "Your wallet. Your approval.",
    text: "Connect your NEAR wallet and approve the payment schedule yourself.",
    href: "/dashboard#proof",
    label: "Connect your wallet",
  },
  {
    number: "02",
    title: "Give every payment a rhythm.",
    text: "Choose a recipient, amount, and interval. Review the funding before you sign.",
    href: "/dashboard#builder",
    label: "Set a payment schedule",
  },
  {
    number: "03",
    title: "Stay close to every run.",
    text: "Follow execution history, manage workflows, and plan around your commitments.",
    href: "/dashboard#workflows",
    label: "View your workflows",
  },
];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // Preserve wallet callbacks opened before the dashboard moved to its own route.
  if (
    [
      "transactionHashes",
      "errorCode",
      "account_id",
      "public_key",
      "all_keys",
    ].some((key) => params[key] !== undefined)
  ) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value))
        value.forEach((item) => query.append(key, item));
      else if (value !== undefined) query.set(key, value);
    }
    redirect(`/dashboard?${query.toString()}`);
  }

  return (
    <main className="landing" id="top">
      <a className="skip-link" href="#overview">
        Skip to content
      </a>
      <section className="landing-light">
        <LandingNavigation />
        <div className="landing-hero" id="overview">
          <svg
            className="payment-paths"
            viewBox="0 0 1440 720"
            fill="none"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            <g stroke="currentColor" strokeWidth="1.4">
              {paymentRoutes.map((route) => (
                <path key={route} d={route} />
              ))}
              <path d="M330-200v260q0 28 28 28h90q28 0 28-28V-200" />
              <path d="M1110-200v260q0 28-28 28h-90q-28 0-28-28V-200" />
            </g>
            <g className="payment-route-motion">
              {paymentRoutes.map((route, index) => (
                <g key={route}>
                  <path
                    className="payment-route-trace"
                    d={route}
                    pathLength="100"
                    style={{ animationDelay: `${index * -2}s` }}
                  />
                </g>
              ))}
            </g>
            {[
              { x: 92, y: 111, symbol: "↗" },
              { x: 1288, y: 111, symbol: "↗" },
              { x: 120, y: 371, symbol: "≈" },
              { x: 1260, y: 371, symbol: "≈" },
            ].map(({ x, y, symbol }) => (
              <g
                key={x}
                className="payment-node"
                transform={`translate(${x} ${y})`}
              >
                <rect width="60" height="38" rx="9" />
                <text className="payment-node-idle" x="30" y="25">
                  {symbol}
                </text>
                <text className="payment-node-hover" x="30" y="25">
                  $
                </text>
              </g>
            ))}
          </svg>
          <p className="hero-kicker">
            <span aria-hidden="true" /> Recurring payments, built on NEAR
          </p>
          <h1>
            Set it once.
            <br />
            <span>Let payments</span> flow.
          </h1>
          <p className="hero-description">
            A rhythm for your recurring payments.
            <br />
            One workspace to schedule, fund, and follow every run.
          </p>
          <div className="hero-actions">
            <Link className="ui-button ui-button-dark" href="/dashboard">
              Open your workspace
            </Link>
            <a className="ui-button ui-button-light" href="#how-it-works">
              See how it works
            </a>
          </div>
          <p className="hero-footnote">Available on NEAR testnet</p>
        </div>
        <div className="landing-preview">
          <div className="preview-intro">
            <p className="section-caption">A calmer payment routine</p>
            <h2>
              Less repetition.
              <br />
              <span>More room to move.</span>
            </h2>
            <p>
              Turn recurring transfers into a funded schedule, with the controls
              always within reach.
            </p>
          </div>
          <div className="flow-object" aria-hidden="true">
            <div className="flow-object-face">
              <span>au</span>
              <i />
              <i />
              <i />
            </div>
            <span className="object-caption">Set. Fund. Flow.</span>
          </div>
          <div className="preview-panel">
            <div className="preview-panel-top">
              <span>Payment workflow</span>
              <span>Overview</span>
            </div>
            <h3>A plan for every transfer.</h3>
            <ol>
              <li>
                <span>01</span>
                <div>
                  Connect wallet<small>Start with your NEAR account</small>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  Set your schedule<small>Recipient, amount, and timing</small>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  Follow each run<small>History and workflow controls</small>
                </div>
              </li>
            </ol>
          </div>
        </div>
      </section>
      <PaymentStory items={capabilities} />
      <section
        className="landing-workspace"
        id="workspace"
        aria-labelledby="workspace-title"
      >
        <div className="workspace-copy">
          <p className="section-caption">Inside your workspace</p>
          <h2 id="workspace-title">
            Every schedule.
            <br />
            <span>One clear view.</span>
          </h2>
          <p>
            See what is running, revisit past executions, and understand what
            your treasury has committed.
          </p>
          <Link className="ui-button ui-button-dark" href="/dashboard">
            Explore the dashboard
          </Link>
        </div>
        <div className="workspace-preview">
          <Link
            className="workspace-bubble workspace-bubble-control"
            href="/dashboard#workflows"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 11.5V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2l4 3v-3h6a2 2 0 0 0 2-2v-5.5Z" />
              <path d="m8 10 2.5 2.5L16 7" />
            </svg>
            <span>Your schedule. Your say.</span>
          </Link>
          <div className="workspace-outline">
            <p className="workspace-outline-heading">
              Your payment workspace <span>NEAR testnet</span>
            </p>
            <div>
              <span>01</span>
              <h3>Workflow controls</h3>
              <p>Pause, resume, cancel, or withdraw from your workflows.</p>
            </div>
            <div>
              <span>02</span>
              <h3>Execution history</h3>
              <p>Follow each payment run and its transaction details.</p>
            </div>
            <div>
              <span>03</span>
              <h3>Treasury outlook</h3>
              <p>Plan around payment commitments and explore scenarios.</p>
            </div>
          </div>
          <Link
            className="workspace-bubble workspace-bubble-history"
            href="/dashboard#history"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 11.5V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2l4 3v-3h6a2 2 0 0 0 2-2v-5.5Z" />
              <path d="M8 8h8M8 12h5" />
            </svg>
            <span>Every run, accounted for.</span>
          </Link>
        </div>
      </section>
      <section className="landing-cta">
        <p className="section-caption">Make room for what comes next</p>
        <h2>
          Your next payment,
          <br />
          <span>already in the plan.</span>
        </h2>
        <Link className="ui-button ui-button-light" href="/dashboard#proof">
          Start with your wallet
        </Link>
        <p>Testnet only. Connect when you are ready.</p>
      </section>
      <footer className="landing-footer">
        <div>
          <Link href="/" className="wordmark">
            auvora<span>.</span>
          </Link>
          <p>Recurring payments on NEAR.</p>
        </div>
        <nav aria-label="Footer navigation">
          <a href="#how-it-works">How it works</a>
          <Link href="/dashboard">Dashboard</Link>
          <a href="#top">Back to top ↑</a>
        </nav>
        <div className="footer-type" aria-hidden="true">
          auvora<span>.</span>
        </div>
        <p className="footer-bottom">Auvora · NEAR testnet</p>
      </footer>
    </main>
  );
}
