'use client';

import { useEffect } from 'react';

const KIT = ['/assets/system.js', '/assets/motion/motion.js', '/assets/layout/layout.js', '/assets/diagrams/mount.js'];

/* The taste kit's scripts add pause buttons, fragments and moments to server-rendered markup. Loaded
   only after React has hydrated, so those additions never meet a hydration check. */
export default function KitBoot() {
  useEffect(() => {
    for (const src of KIT) {
      if (document.querySelector(`script[src="${src}"]`)) continue;
      const s = document.createElement('script');
      s.type = 'module';
      s.src = src;
      document.body.append(s);
    }
  }, []);
  return null;
}
