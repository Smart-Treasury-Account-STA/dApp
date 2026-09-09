import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppProviders } from "@/providers/app-providers";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Smart Treasury Account",
  description:
    "Operator console for Smart Treasury Account: policy-controlled payments, approvals, scheduled operations, and recovery on Stellar.",
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
