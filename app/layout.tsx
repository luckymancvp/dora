import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Sidebar } from '@/components/sidebar'
import { Providers } from '@/components/providers'
import { MobileNavProvider } from '@/lib/store/mobile-nav'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'EtsyChat — Nhắn tin trực tuyến',
  description: 'Ứng dụng chat đơn giản, nhanh và đẹp.',
  generator: 'v0.app',
}

export const viewport: Viewport = {
  themeColor: '#0064e0',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="vi" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} bg-background`}>
      <body className="font-sans antialiased">
        <Providers>
          <MobileNavProvider>
            <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
              <Sidebar />
              <main className="flex-1 overflow-hidden">{children}</main>
            </div>
          </MobileNavProvider>
        </Providers>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
