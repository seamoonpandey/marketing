'use client';

import { useEffect, useRef, useState } from 'react';
import { createTimeline, stagger, type Timeline } from 'animejs';

const FORMATS = [
  { name: 'Landing page', note: '1 page' },
  { name: 'Email', note: '2 versions' },
  { name: 'Social posts', note: '6 sizes' },
  { name: 'Video script', note: '30 s' },
  { name: 'Carousel', note: '5 slides' },
  { name: 'FAQ', note: '8 answers' },
  { name: 'Sales notes', note: '1 page' },
];

/* The card group's one loop (anime.js): the approved brief, then its seven formats arriving one after
   another, held, and played again; 3.2 s a cycle. It rests on its finished picture on a phone and under
   reduced motion, restarts when the pointer enters its card, and carries the kit's pause disc. */
export default function BriefFanout() {
  const root = useRef<HTMLDivElement>(null);
  const tl = useRef<Timeline | null>(null);
  const [paused, setPaused] = useState(false);
  const [still, setStill] = useState(true);
  const pausedRef = useRef(false);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const rest = window.matchMedia('(max-width: 639px), (prefers-reduced-motion: reduce)').matches;
    setStill(rest);
    if (rest) return;
    const chips = el.querySelectorAll('.fan__chip');
    const t = createTimeline({ loop: true, defaults: { ease: 'out(3)' } })
      .set(chips, { opacity: 0, translateY: 8 })
      .add(chips, { opacity: 1, translateY: 0, duration: 420, delay: stagger(110) })
      .add(chips, { opacity: 0, duration: 260, delay: 1500 });
    tl.current = t;
    const card = el.closest('.card');
    const restart = () => { if (!t.paused) t.restart(); };
    card?.addEventListener('pointerenter', restart);
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { if (!pausedRef.current) t.play(); } else t.pause(); });
    io.observe(el);
    return () => { io.disconnect(); card?.removeEventListener('pointerenter', restart); t.revert(); };
  }, []);

  const toggle = () => {
    const t = tl.current;
    if (!t) return;
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    if (pausedRef.current) t.pause(); else t.play();
  };

  return (
    <>
      <div className="stage stage--fade-b">
      <div className="island ui" style={{ '--iw': '230px', '--ib': '-24px' } as React.CSSProperties}>
      <div className="fan" ref={root} role="img" aria-label="An approved brief for a Dashain offer becomes a landing page, an email, social posts, a video script, a carousel, an FAQ and sales notes.">
        <div className="fan__brief" aria-hidden="true">
          <span className="fan__ok">Approved</span>
          <b>Dashain offer brief</b>
          <span>Audience, offer, proof and budget on one page</span>
        </div>
        <ul className="fan__list" aria-hidden="true">
          {FORMATS.map((f) => (
            <li className="fan__chip" key={f.name}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 2.5h5l3 3v8H4z" /><path d="M9 2.5v3h3" /></svg>
              {f.name}
              <em>{f.note}</em>
            </li>
          ))}
        </ul>
      </div>
      </div>
      </div>
      {!still && (
        <button type="button" className="loop-pause" aria-label={paused ? 'Play the animation' : 'Pause the animation'} aria-pressed={paused} onClick={toggle}>
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
