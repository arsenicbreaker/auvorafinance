import type { Metadata } from "next";
import { Inter_Tight } from "next/font/google";
import type { ReactNode } from "react";

import "@near-wallet-selector/modal-ui/styles.css";
import "./styles.css";
import "./interface.css";

const interTight = Inter_Tight({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter-tight",
});

export const metadata: Metadata = {
  description:
    "Schedule, fund, and follow recurring payments on NEAR testnet with Auvora.",
  title: "Auvora | Payments in rhythm",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={interTight.variable}>
      <body>{children}</body>
    </html>
  );
}
