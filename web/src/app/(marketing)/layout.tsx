import type { Metadata, Viewport } from 'next';
import KitBoot from '@/components/kit-boot';
import { THEME, THEMES } from '@/theme';
import './islands.css';

/* The marketing root layout: the taste kit's system (public/assets) on a static page. The product app
   gets its own root layout in its own route group. */

export const metadata: Metadata = {
  // SITE_URL: the public origin, for absolute share-image links (canonical waits for the chosen domain)
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3040'),
  title: 'Prachaar: AI marketing team for Nepali brands',
  description:
    'Twenty AI roles plan, write, design and schedule a brand’s marketing, price each job in rupees first and post nothing you have not approved.',
  openGraph: {
    type: 'website',
    title: 'Prachaar: AI marketing team for Nepali brands',
    description: 'AI roles that plan, write and schedule your marketing, with every post approved by you.',
    images: ['/share.jpg'],
  },
  twitter: { card: 'summary_large_image' },
  // the mascot's head (public/brand: favicon-32, favicon-64, apple-touch-icon; made from mascot/head-master.jpg)
  icons: {
    icon: [
      { url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/brand/favicon-64.png', sizes: '64x64', type: 'image/png' },
    ],
    apple: '/brand/apple-touch-icon.png',
  },
  other: { 'site-kind': 'software', 'page-type': 'software' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: THEMES[THEME].themeColor,
};

const KIT_CSS = [
  '/assets/system.css',
  '/assets/ui/cards.css',
  '/assets/motion/motion.css',
  '/assets/backgrounds/backgrounds.css',
  '/assets/layout/layout.css',
  '/assets/icons/icon.css',
];
const PAGE_CSS = [
  '/assets/ui/base.css',
  '/assets/ui/window/fragment.css',
  '/assets/ui/doc/fragment.css',
  '/assets/ui/notify/fragment.css',
  '/assets/ui/checklist/fragment.css',
  '/assets/diagrams/diagram.css',
  '/landing.css',
];


// the hero's words wait for motion.js (700 ms fallback); the moments' guard (2.5 s fallback)
const HEAD_JS = `document.documentElement.classList.add('m-enter');setTimeout(()=>document.documentElement.classList.add('m-enter-done'),700);document.documentElement.classList.add('mo-js');setTimeout(()=>document.documentElement.classList.add('mo-safe'),2500);`;

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-type="software"
      data-radius="soft"
      data-theme={THEME}
      data-ground={THEMES[THEME].ground}
      data-buttons="arrow"
      data-motion=""
      suppressHydrationWarning
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400..500&display=swap" rel="stylesheet" />
        {KIT_CSS.map((href) => <link key={href} rel="stylesheet" href={href} />)}
        {/* colours and type: public/theme.css (palette, themes, the kit's --p-* bridge) */}
        <link rel="stylesheet" href="/theme.css" />
        {PAGE_CSS.map((href) => <link key={href} rel="stylesheet" href={href} />)}
        <script dangerouslySetInnerHTML={{ __html: HEAD_JS }} />
        <script src="/assets/backgrounds/backgrounds.js" />
        <link rel="modulepreload" href="/assets/moments/moments.js" />
        <link rel="modulepreload" href="/assets/moments/lib.js" />
        <link rel="modulepreload" href="/assets/moments/letters-assemble/moment.js" />
      </head>
      <body>
        {children}
        <KitBoot />
      </body>
    </html>
  );
}
