import type { Metadata, Viewport } from 'next';
import KitBoot from '@/components/kit-boot';
import './islands.css';

/* The marketing root layout: the taste kit's system (public/assets) on a static page. The product app
   gets its own root layout in its own route group. */

export const metadata: Metadata = {
  // SITE_URL: the public origin, for absolute share-image links (canonical waits for the chosen domain)
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3040'),
  title: 'Pracharo: AI marketing team for Nepali brands',
  description:
    'Twenty AI roles plan, write, design and schedule a brand’s marketing, price each job in rupees first and post nothing you have not approved.',
  openGraph: {
    type: 'website',
    title: 'Pracharo: AI marketing team for Nepali brands',
    description: 'AI roles that plan, write and schedule your marketing, with every post approved by you.',
    images: ['/share.jpg'],
  },
  twitter: { card: 'summary_large_image' },
  icons: { icon: { url: '/favicon.svg', type: 'image/svg+xml' } },
  other: { 'site-kind': 'software', 'page-type': 'software' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#c3d7e5',
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

// the palette and type exactly as start.mjs dealt them (swap-pastels, geist); keep after layout.css
const ROOT = `:root {
  --p-bg: #c3d7e5; --p-surface: #d0e0eb; --p-ink: #141414; --p-muted: #4a5068;
  --p-accent: #0f5257; --p-accent-ink: #ffffff; --p-action: #0f5257; --p-action-ink: #ffffff;
  --p-inv-bg: #141414; --p-inv-surface: #1e1f20; --p-inv-ink: #c3d7e5; --p-inv-muted: #808b94;
  --p-inv-accent: #c3d7e5; --p-inv-accent-ink: #141414; --p-inv-action: #c3d7e5; --p-inv-action-ink: #141414;
  --font-display: "Geist", system-ui, sans-serif;
  --font-text: "Geist", system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  --display-weight: 500;
  --display-tracking: -0.035em;
  --display-tracking-xl: -0.045em;
}`;

// the hero's words wait for motion.js (700 ms fallback); the moments' guard (2.5 s fallback)
const HEAD_JS = `document.documentElement.classList.add('m-enter');setTimeout(()=>document.documentElement.classList.add('m-enter-done'),700);document.documentElement.classList.add('mo-js');setTimeout(()=>document.documentElement.classList.add('mo-safe'),2500);`;

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-type="software"
      data-radius="soft"
      data-ground="sage"
      data-buttons="arrow"
      data-motion=""
      suppressHydrationWarning
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400..500&display=swap" rel="stylesheet" />
        {KIT_CSS.map((href) => <link key={href} rel="stylesheet" href={href} />)}
        <style dangerouslySetInnerHTML={{ __html: ROOT }} />
        {PAGE_CSS.map((href) => <link key={href} rel="stylesheet" href={href} />)}
        <script dangerouslySetInnerHTML={{ __html: HEAD_JS }} />
        <script src="/assets/backgrounds/backgrounds.js" />
        <link rel="modulepreload" href="/assets/moments/moments.js" />
        <link rel="modulepreload" href="/assets/moments/lib.js" />
        <link rel="modulepreload" href="/assets/moments/line-carries-colour/moment.js" />
      </head>
      <body>
        {children}
        <KitBoot />
      </body>
    </html>
  );
}
