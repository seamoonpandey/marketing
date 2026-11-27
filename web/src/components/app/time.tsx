'use client';

import { instantLabel } from '@/lib/time';
import { useBrand, useBrandId } from './brand-scope';

/**
 * An instant written in the brand's timezone, the zone named beside it ("Tue 1 Dec, 10:00 Asia/Kathmandu").
 * Pass `tz` when the API already sent it; else it is read from the brand in the URL.
 */
export function Time({ iso, tz, day = true, year = false }: { iso: string; tz?: string; day?: boolean; year?: boolean }) {
  const brand = useBrand(useBrandId());
  const zone = tz ?? brand.data?.timezone ?? 'UTC';
  return (
    <time dateTime={iso} className="num">
      {instantLabel(iso, zone, { day, year })} <span className="text-muted">{zone}</span>
    </time>
  );
}
