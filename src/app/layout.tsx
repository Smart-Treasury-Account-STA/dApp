import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppProviders } from "@/providers/app-providers";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "STA Testnet Console",
  description:
    "Smart Treasury Account testnet dApp for Stellar treasury operators.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
