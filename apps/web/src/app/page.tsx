import Link from "next/link";
import Image from "next/image";
import { DashboardIcon } from "../features/dashboard/dashboard-icon";
import { redirect } from "next/navigation";
import { LandingNavigation } from "./landing-navigation";
import { LandingFooter } from "./landing-footer";
import { PaymentStory } from "./payment-story";

const paymentRoutes = [
  "M0 130h180q28 0 28 28v120q0 28 28 28h150q28 0 28 28V2000",
  "M1440 130h-180q-28 0-28 28v120q0 28-28 28h-150q-28 0-28 28V2000",
  "M0 390h250q30 0 30 30v140q0 30 30 30h220q30 0 30 30V2000",
  "M1440 390h-250q-30 0-30 30v140q0 30-30 30H910q-30 0-30 30V2000",
];

const paymentRailItems = [
  "Connect wallet",
  "Set schedule",
  "Fund workflow",
  "Automatic execution",
  "Track every run",
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
              { x: 92, y: 111, symbol: "payment" as const },
              { x: 1288, y: 111, symbol: "payment" as const },
              { x: 120, y: 371, symbol: "waves" as const },
              { x: 1260, y: 371, symbol: "waves" as const },
            ].map(({ x, y, symbol }) => (
              <g
                key={x}
                className="payment-node"
                transform={`translate(${x} ${y})`}
              >
                <rect width="60" height="38" rx="9" />
                <g transform="translate(19 8)">
                  <g className="payment-node-idle">
                    <DashboardIcon name={symbol} />
                  </g>
                  <g className="payment-node-hover">
                    <DashboardIcon name="dollar" />
                  </g>
                </g>
              </g>
            ))}
          </svg>
          <p className="hero-kicker">
            <Image
              className="near-mark"
              src="/near-logo.png"
              alt=""
              width={864}
              height={865}
              aria-hidden="true"
            />
            Built on NEAR
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
        </div>
        <div className="landing-preview">
          <div className="flow-object" aria-hidden="true">
            <div className="flow-object-face">
              <span>au</span>
              <i />
              <i />
              <i />
            </div>
            <span className="object-caption">Set. Fund. Flow.</span>
          </div>
          <div className="payment-rail" aria-label="Payment workflow">
            <div className="payment-rail-track">
              {[false, true].map((duplicate) => (
                <div
                  className="payment-rail-group"
                  key={duplicate ? "duplicate" : "primary"}
                  role={duplicate ? undefined : "list"}
                  aria-hidden={duplicate || undefined}
                >
                  {paymentRailItems.map((item) => (
                    <span
                      className="payment-rail-item"
                      key={`${duplicate ? "duplicate" : "primary"}-${item}`}
                      role={duplicate ? undefined : "listitem"}
                    >
                      <i aria-hidden="true" />
                      {item}
                    </span>
                  ))}
                </div>
              ))}
            </div>
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
        <div className="cta-copy">
          <p className="section-caption">
            <span aria-hidden="true" />
            Make room for what comes next
          </p>
          <h2>
            Your next payment,
            <br />
            <span>already in the plan.</span>
          </h2>
          <Link className="ui-button ui-button-light" href="/dashboard#proof">
            Start with your wallet
          </Link>
          <p className="cta-note">Testnet only. Connect when you are ready.</p>
        </div>
        <div className="cta-route" aria-hidden="true">
          <svg
            className="cta-route-lines"
            viewBox="0 0 560 470"
            fill="none"
            preserveAspectRatio="none"
          >
            <path d="M312 74c110 0 158 40 158 112 0 43-26 66-68 78" />
            <path d="M356 269c-78 17-116 62-116 132" />
            <path className="cta-route-pulse" pathLength="100" d="M312 74c110 0 158 40 158 112 0 43-26 66-68 78" />
            <path className="cta-route-pulse cta-route-pulse-next" pathLength="100" d="M356 269c-78 17-116 62-116 132" />
            <circle cx="402" cy="264" r="5" />
            <circle cx="240" cy="401" r="5" />
          </svg>
          <div className="cta-route-card cta-route-card-wallet">
            <span className="cta-route-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M5 8.5h14v9H5z" />
                <path d="M7 8.5V6.8c0-1 .8-1.8 1.8-1.8H17" />
                <path d="M15.5 12.8h3.5" />
              </svg>
            </span>
            <span>Your wallet</span>
          </div>
          <div className="cta-route-card cta-route-card-plan">
            <span className="cta-route-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M7 3v3M17 3v3M4.5 9h15" />
                <rect x="4.5" y="5" width="15" height="15" rx="2" />
                <path d="m8 14 2.2 2.2L16 11" />
              </svg>
            </span>
            <span>Your plan</span>
          </div>
          <div className="cta-route-card cta-route-card-payment">
            <span className="cta-route-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M6 16.5h12M8 12.5h8M10 8.5h4" />
              </svg>
            </span>
            <span>Next payment</span>
          </div>
        </div>
      </section>
      <LandingFooter />
    </main>
  );
}
