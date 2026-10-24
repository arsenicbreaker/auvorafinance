import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@near-wallet-selector/modal-ui/styles.css";
import "./styles.css";

export const metadata: Metadata = {
  description: "A testnet-only proof surface for Auvora treasury automation.",
  title: "Auvora | Testnet proof",
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
