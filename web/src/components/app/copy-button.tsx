'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/** Copies `text` and says so, to the eye and to screen readers. `label` names what is copied ("Caption"). */
export function CopyButton({ text, label, className = '' }: { text: string; label: string; className?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // No clipboard permission (an old browser): copy through a hidden field.
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setDone(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 2500);
  }
  return (
    <>
      <button type="button" onClick={copy} aria-label={`Copy ${label}`} className={`btn btn-secondary shrink-0 ${className}`}>
        {done ? <Check className="size-5" aria-hidden /> : <Copy className="size-5" aria-hidden />}
        {done ? 'Copied' : 'Copy'}
      </button>
      <span role="status" className="sr-only">{done ? `${label} copied` : ''}</span>
    </>
  );
}
