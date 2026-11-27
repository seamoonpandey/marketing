'use client';

import { useEffect, useState } from 'react';
import Aurora from '@/components/Aurora';

const STOPS = ['--theme-glow-1', '--theme-glow-2', '--theme-glow-3'];

/* The hero frame's one effect (React Bits Aurora), in the active theme's glow colours (public/theme.css),
   read again when <html data-theme> changes. It moves for more than 5 s, so it carries the kit's pause
   disc (WCAG 2.2.2). On a phone it is drawn once and held, as the kit holds every ground there; reduced
   motion is handled inside Aurora. */
export default function HeroAurora() {
  const [paused, setPaused] = useState(false);
  const [phone, setPhone] = useState(false);
  const [stops, setStops] = useState<string[] | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const onPhone = () => setPhone(mq.matches);
    onPhone();
    mq.addEventListener('change', onPhone);
    const root = document.documentElement;
    const read = () => {
      const css = getComputedStyle(root);
      setStops(STOPS.map((v) => css.getPropertyValue(v).trim()));
    };
    read();
    const themeWatch = new MutationObserver(read);
    themeWatch.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { mq.removeEventListener('change', onPhone); themeWatch.disconnect(); };
  }, []);

  if (!stops) return null;
  return (
    <>
      <Aurora
        className="hero__aurora"
        colorStops={stops}
        amplitude={0.9}
        blend={0.55}
        speed={0.6}
        lightMode
        paused={paused || phone}
      />
      {!phone && (
        <button
          type="button"
          className="loop-pause"
          aria-label={paused ? 'Play the background' : 'Pause the background'}
          aria-pressed={paused}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? (
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7.5-4.5z" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z" /></svg>
          )}
        </button>
      )}
    </>
  );
}
