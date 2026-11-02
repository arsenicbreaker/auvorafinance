import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@near-wallet-selector/modal-ui/styles.css";
import "./styles.css";
import "./interface.css";

export const metadata: Metadata = {
  description:
    "Schedule, fund, and follow recurring payments on NEAR testnet with Auvora.",
  title: "Auvora | Payments in rhythm",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
