import { expect, test } from '@playwright/test';
import { label, languageName } from '../src/lib/labels';
import { groupNpr, sumMoney } from '../src/lib/money';
import { addDays, dayKey, formatYmd, instantLabel, weekRange, weekStartOf, wallToIso } from '../src/lib/time';

// Pure helpers shared by every module; no browser, no API.
test('an instant is written in the brand zone, whatever the machine zone is', () => {
  const iso = '2026-12-01T04:15:00.000Z'; // 10:00 in Kathmandu (+05:45)
  expect(instantLabel(iso, 'Asia/Kathmandu')).toBe('Tue 1 Dec, 10:00');
  expect(instantLabel(iso, 'Asia/Kathmandu', { year: true })).toBe('Tue 1 Dec 2026, 10:00');
  expect(instantLabel(iso, 'Asia/Kathmandu', { day: false })).toBe('10:00');
  expect(instantLabel(iso, 'America/Los_Angeles')).toBe('Mon 30 Nov, 20:15');
  expect(instantLabel(iso, 'Not/AZone')).toBe('Tue 1 Dec, 04:15'); // a bad zone falls back to UTC
  expect(dayKey('2026-12-01T20:00:00Z', 'Asia/Kathmandu')).toBe('2026-12-02');
});

test('a wall-clock time becomes an instant with the zone offset, across a change of offset', () => {
  expect(wallToIso('2026-12-01', '10:00', 'Asia/Kathmandu')).toBe('2026-12-01T10:00:00+05:45');
  expect(wallToIso('2026-07-01', '09:30', 'America/New_York')).toBe('2026-07-01T09:30:00-04:00');
  expect(wallToIso('2026-12-01', '09:30', 'America/New_York')).toBe('2026-12-01T09:30:00-05:00');
});

test('calendar dates shift by days and snap to the first day of the week without time zones', () => {
  expect(addDays('2026-11-29', 7)).toBe('2026-12-06');
  expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  expect(weekStartOf('2026-11-25', 0)).toBe('2026-11-22'); // a Sunday week
  expect(weekStartOf('2026-11-25', 1)).toBe('2026-11-23'); // a Monday week
  expect(weekStartOf('2026-11-22', 0)).toBe('2026-11-22');
  expect(formatYmd('2026-11-29', { weekday: 'long', day: 'numeric', month: 'short' })).toBe('Sunday 29 Nov');
  expect(weekRange('2026-11-29')).toBe('29 Nov – 5 Dec 2026');
});

test('money keeps its decimals as text, groups the Nepali way and adds exactly', () => {
  expect(groupNpr('1860.00')).toBe('1,860.00');
  expect(groupNpr('12500000')).toBe('1,25,00,000');
  expect(groupNpr('-4500.5')).toBe('−4,500.5');
  expect(sumMoney([{ npr: '0.1000', usd: '0.0007' }, { npr: '0.2000', usd: '0.0013' }])).toEqual({ npr: '0.30', usd: '0.00' });
});

test('codes are named the same way everywhere', () => {
  expect(label('linkedin')).toBe('LinkedIn');
  expect(label('founder_team')).toBe('Founder and team');
  expect(label('static')).toBe('Single image');
  expect(label(null)).toBe('Not set');
  expect(languageName('ne')).toBe('Nepali');
});
