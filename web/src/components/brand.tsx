/* Prachaar's logo and mascot. The artwork is the owner's master files in public/brand/:
   prachaar-logo-master.png (the mascot, a robot in a dhaka topi with a megaphone, beside the wordmark whose P
   is a speech bubble with a play triangle) and prachaar-mascot-master.png (the mascot alone); the web copies
   beside them are trimmed and resized from those. The P mark is redrawn as vector for the smallest uses, where a
   picture would blur; the favicon is the mascot's head (public/brand/favicon-*.png). */

const MARK = 'M12 12A8 8 0 0 1 20 4H27A15 15 0 0 1 27 34H24L12 46ZM23.5 12.5L33.5 19L23.5 25.5Z';

type Props = { className?: string; label?: string; sizes?: string };

/** The P mark alone: the smallest uses (the nav under 400px). */
export function Mark({ className, label = 'Prachaar' }: Props) {
  return (
    <svg className={className} viewBox="5 3 44 44" role="img" aria-label={label}>
      <path fill="var(--theme-brand)" fillRule="evenodd" d={MARK} />
    </svg>
  );
}

/** The main logo: the mascot beside the wordmark. */
export function Lockup({ className, label = 'Prachaar', sizes = '160px' }: Props) {
  return (
    <img className={className} src="/brand/prachaar-logo.png" srcSet="/brand/prachaar-logo-small.png 400w, /brand/prachaar-logo.png 1280w"
      sizes={sizes} width={1280} height={381} alt={label} />
  );
}

export type Mood = 'smile' | 'happy' | 'wink' | 'love' | 'surprised' | 'sad' | 'confused' | 'frustrated';

/** The mascot alone, in one of its moods (public/brand/mascot/: the master artwork with its eyes repainted and
    small accents added). Decorative by default: pass a label where it carries meaning. */
export function Mascot({ className, label = '', sizes = '280px', mood = 'smile' }: Props & { mood?: Mood }) {
  return (
    <img className={className} src={`/brand/mascot/${mood}.png`} srcSet={`/brand/mascot/${mood}-small.png 240w, /brand/mascot/${mood}.png 560w`}
      sizes={sizes} width={560} height={553} alt={label} loading="lazy" />
  );
}
