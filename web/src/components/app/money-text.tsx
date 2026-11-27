import type { Money } from '@/lib/api/client';

// Nepali grouping (lakh, crore), as on the brand's own price lists. The amount stays a string: no float.
function group(decimal: string): string {
  const negative = decimal.startsWith('-');
  const [whole, frac] = decimal.replace('-', '').split('.');
  const last3 = whole!.slice(-3);
  const rest = whole!.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${negative ? '−' : ''}${rest ? `${rest},` : ''}${last3}${frac ? `.${frac}` : ''}`;
}

/** An amount in NPR, with the USD value in the title (and to screen readers). */
export function MoneyText({ value, className }: { value: Money; className?: string }) {
  return (
    <span className={`num whitespace-nowrap ${className ?? ''}`} title={`USD ${value.usd}`}>
      NPR {group(value.npr)}
      <span className="sr-only"> (USD {value.usd})</span>
    </span>
  );
}
