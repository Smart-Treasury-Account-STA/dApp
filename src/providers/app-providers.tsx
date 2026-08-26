"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";

import { Toaster } from "@/components/ui/sonner";
import { WalletProvider } from "@/providers/wallet-provider";
import type { ReactNode } from "react";
import { useState } from "react";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <QueryClientProvider client={queryClient}>
        <WalletProvider>
          {children}
          <Toaster position="top-center" duration={8000} richColors closeButton />
        </WalletProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
