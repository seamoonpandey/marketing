import type { Money } from './api/client';

/** Nepali grouping (lakh, crore), as on the brand's own price lists. The amount stays a string: no float. */
export function groupNpr(decimal: string): string {
  const negative = decimal.startsWith('-');
  const [whole, frac] = decimal.replace('-', '').split('.');
  const last3 = whole!.slice(-3);
  const rest = whole!.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${negative ? '−' : ''}${rest ? `${rest},` : ''}${last3}${frac ? `.${frac}` : ''}`;
}

/** An NPR amount as running text: "NPR 1,25,000". The one way money is written outside `MoneyText`. */
export const nprText = (npr: string) => `NPR ${groupNpr(npr)}`;

/** Adds NPR/USD decimal strings without floats (4 decimals, as the API sends them). */
export function sumMoney(values: Money[]): Money {
  const scale = (s: string) => {
    const [w, f = ''] = s.split('.');
    return Number(w + f.padEnd(4, '0').slice(0, 4)); // whole 1/10000ths: exact below 2^53
  };
  const fmt = (n: number) => (Math.round(n / 100) / 100).toFixed(2); // shown to 2 decimals
  return {
    npr: fmt(values.reduce((a, v) => a + scale(v.npr), 0)),
    usd: fmt(values.reduce((a, v) => a + scale(v.usd), 0)),
  };
}
