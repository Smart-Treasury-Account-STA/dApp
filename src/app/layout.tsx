import type { ReactNode } from 'react'

import type { Metadata } from 'next'

import '@/app/globals.css'
import { AppProviders } from '@/providers/app-providers'

export const metadata: Metadata = {
  title: 'Smart Treasury Account',
  description:
    'Operator console for Smart Treasury Account: policy-controlled payments, approvals, scheduled operations, and recovery on Stellar.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
