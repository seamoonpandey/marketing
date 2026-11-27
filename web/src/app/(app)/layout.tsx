import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Noto_Sans_Devanagari } from 'next/font/google';
import { QueryProvider } from '@/lib/api/query';
import { THEME, THEMES } from '@/theme';
import './app.css';

/* The product's root layout (/app/*): the active theme, Geist with Noto Sans Devanagari for Nepali
   text, and the data providers. The landing page keeps its own root layout in (marketing). */

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });
const devanagari = Noto_Sans_Devanagari({ subsets: ['devanagari'], variable: '--font-devanagari', preload: false });

export const metadata: Metadata = {
  title: { default: 'Prachaar', template: '%s · Prachaar' },
  // Not public while there is no login.
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/brand/favicon-64.png', sizes: '64x64', type: 'image/png' },
    ],
    apple: '/brand/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: THEMES[THEME].themeColor,
};

export default function AppRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme={THEME} className={`${geist.variable} ${geistMono.variable} ${devanagari.variable}`}>
      <head>
        {/* colours: public/theme.css (the palette and every theme's tokens) */}
        <link rel="stylesheet" href="/theme.css" />
      </head>
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
