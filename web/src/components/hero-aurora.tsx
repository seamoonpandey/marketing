'use client';

import { useEffect, useState } from 'react';
import Aurora from '@/components/Aurora';

/* The hero frame's one effect (React Bits Aurora) in the palette's teal and sky. It moves for more than
   5 s, so it carries the kit's pause disc (WCAG 2.2.2). On a phone it is drawn once and held, as the kit
   holds every ground there; reduced motion is handled inside Aurora. */
export default function HeroAurora() {
  const [paused, setPaused] = useState(false);
  const [phone, setPhone] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  return (
    <>
      <Aurora
        className="hero__aurora"
        colorStops={['#0f5257', '#5f93cc', '#c3d7e5']}
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
