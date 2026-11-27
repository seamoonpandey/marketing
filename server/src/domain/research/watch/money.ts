import type { Money } from '../../../contracts/common.ts';

const units = (d: string, scale: number) => {
  const [w, f = ''] = d.split('.');
  return BigInt(w! + f.padEnd(scale, '0').slice(0, scale));
};
const fmt = (v: bigint, scale: number) => {
  const s = v.toString().padStart(scale + 1, '0');
  return `${s.slice(0, -scale)}.${s.slice(-scale)}`;
};

/** Adds Money values exactly (usd to 4 places, npr to 2). */
export function addMoney(list: Money[]): Money {
  return {
    usd: fmt(list.reduce((t, m) => t + units(m.usd, 4), 0n), 4),
    npr: fmt(list.reduce((t, m) => t + units(m.npr, 2), 0n), 2),
  };
}
