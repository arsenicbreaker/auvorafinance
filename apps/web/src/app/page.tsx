import Link from "next/link";
import { redirect } from "next/navigation";

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
        <header className="landing-nav">
          <Link href="/" className="wordmark" aria-label="Auvora home">
            auvora<span>.</span>
          </Link>
          <nav aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#workspace">The workspace</a>
          </nav>
          <Link className="ui-button ui-button-dark" href="/dashboard">
            Open dashboard <span aria-hidden="true">↗</span>
          </Link>
        </header>
        <div className="landing-hero" id="overview">
          <svg
            className="payment-paths"
            viewBox="0 0 1440 720"
            fill="none"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            <g stroke="currentColor" strokeWidth="1.4">
              <path d="M0 130h180q28 0 28 28v120q0 28 28 28h150" />
              <path d="M1440 130h-180q-28 0-28 28v120q0 28-28 28h-150" />
              <path d="M0 390h250q30 0 30 30v140q0 30 30 30h220" />
              <path d="M1440 390h-250q-30 0-30 30v140q0 30-30 30H910" />
              <path d="M330 0v60q0 28 28 28h90" />
              <path d="M1110 0v60q0 28-28 28h-90" />
            </g>
            <g fill="var(--landing-paper)" stroke="currentColor">
              <rect x="92" y="111" width="60" height="38" rx="9" />
              <rect x="1288" y="111" width="60" height="38" rx="9" />
              <rect x="120" y="371" width="60" height="38" rx="9" />
              <rect x="1260" y="371" width="60" height="38" rx="9" />
            </g>
            <g fill="currentColor" fontSize="17" textAnchor="middle">
              <text x="122" y="136">
                ↗
              </text>
              <text x="1318" y="136">
                ↗
              </text>
              <text x="150" y="397">
                ≈
              </text>
              <text x="1290" y="397">
                ≈
              </text>
            </g>
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
      <section
        className="landing-story"
        id="how-it-works"
        aria-labelledby="story-title"
      >
        <p className="section-caption">From intention to execution</p>
        <h2 id="story-title">
          Your payments have a rhythm.
          <br />
          <span>Now your workspace does, too.</span>
        </h2>
        <div className="capability-list">
          {capabilities.map((item) => (
            <article key={item.number}>
              <span className="capability-number">{item.number}</span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
              <Link href={item.href}>
                {item.label} <span aria-hidden="true">↗</span>
              </Link>
            </article>
          ))}
        </div>
      </section>
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
