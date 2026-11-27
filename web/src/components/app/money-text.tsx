import type { Money } from '@/lib/api/client';
import { groupNpr } from '@/lib/money';

/** An amount in NPR, with the USD value in the title (and to screen readers). */
export function MoneyText({ value, className }: { value: Money; className?: string }) {
  return (
    <span className={`num whitespace-nowrap ${className ?? ''}`} title={`USD ${value.usd}`}>
      NPR {groupNpr(value.npr)}
      <span className="sr-only"> (USD {value.usd})</span>
    </span>
  );
}
