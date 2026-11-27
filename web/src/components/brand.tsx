/* Prachaar's logo and mascot. The logo is the owner's artwork, public/brand/prachaar-logo-master.png (the
   mascot beside the wordmark whose P is a speech bubble with a play triangle); the web copies beside it are
   trimmed and resized from it. The mascot's poses are the owner's artwork in public/brand/mascot. The P mark is redrawn as vector for the smallest uses, where a
   picture would blur; the favicon is the mascot's head (public/brand/favicon-*.png, from mascot/head-master.jpg). */

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

/** The mascot artwork in public/brand/mascot: each <name>-master.jpg as delivered, and its web copies
    (<name>.webp 640 wide, <name>-small.webp 280 wide, made by scripts/mascot-assets.py). Heights at 640 wide. */
const ART = { wave: 677, 'wave-left': 677, celebrate: 728, point: 827, 'think-right': 801, 'think-left': 813, head: 549 } as const;
export type Art = keyof typeof ART;
const set = (a: Art) => `/brand/mascot/${a}-small.webp 280w, /brand/mascot/${a}.webp 640w`;

/** The mascot, turned toward the content beside it. `narrow` swaps in another picture under 1024px, where the
    layout moves the content to its other side. Decorative by default: pass a label where it carries meaning. */
export function Mascot({ className, label = '', art, narrow, sizes = '300px' }: Props & { art: Art; narrow?: Art }) {
  const img = (
    <img className={narrow ? undefined : className} src={`/brand/mascot/${art}.webp`} srcSet={set(art)} sizes={sizes}
      width={640} height={ART[art]} alt={label} loading="lazy" />
  );
  if (!narrow) return img;
  return (
    <picture className={className}>
      <source media="(max-width: 1023px)" srcSet={set(narrow)} sizes={sizes} />
      {img}
    </picture>
  );
}
