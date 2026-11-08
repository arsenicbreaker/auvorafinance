import Link from "next/link";

const footerGroups = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "#how-it-works" },
      { label: "Inside your workspace", href: "#workspace" },
      { label: "Open dashboard", href: "/dashboard" },
    ],
  },
  {
    title: "Payments",
    links: [
      { label: "Connect wallet", href: "/dashboard#proof" },
      { label: "Set a payment", href: "/dashboard#builder" },
      { label: "Payment schedules", href: "/dashboard#workflows" },
    ],
  },
  {
    title: "Records",
    links: [
      { label: "Overview", href: "/dashboard#overview" },
      { label: "Execution reports", href: "/dashboard#history" },
      { label: "Treasury outlook", href: "/dashboard#outlook" },
    ],
  },
  {
    title: "Navigate",
    links: [
      { label: "Auvora home", href: "/" },
      { label: "Back to top", href: "#top" },
    ],
  },
];

export function LandingFooter() {
  return (
    <footer className="landing-footer">
      <div className="footer-directory">
        <div className="footer-brand">
          <Link href="/" className="wordmark" aria-label="Auvora home">
            auvora<span>.</span>
          </Link>
          <p>
            Recurring payments on NEAR, scheduled once and kept in view.
          </p>
        </div>

        <div className="footer-links">
          {footerGroups.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h2>{group.title}</h2>
              <ul>
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>
                      <span aria-hidden="true">›</span>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>

      <div className="footer-type" aria-hidden="true">
        auvora<span>.</span>
      </div>

      <div className="footer-bottom">
        <div className="footer-legal">
          <p>© 2026 Auvora. All rights reserved.</p>
          <p>
            <span aria-hidden="true" />
            NEAR testnet
          </p>
        </div>
        <nav className="footer-socials" aria-label="Auvora and NEAR links">
          <a
            href="https://github.com/arsenicbreaker/auvorafinance"
            target="_blank"
            rel="noreferrer"
            aria-label="Auvora on GitHub"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2.7a9.5 9.5 0 0 0-3 18.5c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 0 1.6 1 1.6 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.2.7-1.5-2.3-.3-4.7-1.1-4.7-4.8 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.6 9.6 0 0 1 5 0c2-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.7-2.4 4.5-4.7 4.8.4.3.7 1 .7 2v3c0 .3.2.6.7.5A9.5 9.5 0 0 0 12 2.7Z" />
            </svg>
          </a>
          <a
            href="https://x.com/NEARProtocol"
            target="_blank"
            rel="noreferrer"
            aria-label="NEAR Protocol on X"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5.2 4h3.9l3.4 4.8L16.6 4h2.2l-5.3 6.2L19.5 20h-4l-3.8-5.3L7.2 20H5l5.7-6.7L5.2 4Zm3 1.7L16.4 18h1.1L9.3 5.7H8.2Z" />
            </svg>
          </a>
          <a
            href="https://discord.gg/nearprotocol"
            target="_blank"
            rel="noreferrer"
            aria-label="NEAR Protocol Discord"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18.9 5.3a16 16 0 0 0-4-1.2l-.5 1a14.8 14.8 0 0 0-4.8 0l-.5-1a16 16 0 0 0-4 1.2C2.6 9 1.9 12.6 2.2 16.1a16.4 16.4 0 0 0 5 2.5l1.2-1.7-1.8-.9.4-.3c3.4 1.6 7 1.6 10.4 0l.4.3-1.8.9 1.2 1.7a16.4 16.4 0 0 0 5-2.5c.4-4.1-.8-7.7-3.3-10.8ZM8.7 14.3c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z" />
            </svg>
          </a>
        </nav>
      </div>
    </footer>
  );
}
