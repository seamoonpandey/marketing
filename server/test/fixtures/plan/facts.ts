import type { ApprovedFact } from '../../../src/contracts/common.ts';

export const F1 = '0196f3c2-0000-7000-8000-000000000001';
export const F2 = '0196f3c2-0000-7000-8000-000000000002';
export const F3 = '0196f3c2-0000-7000-8000-000000000003';

export const fact = (id: string, field = 'price', value: unknown = 4000): ApprovedFact => ({
  id, section: 'products', subjectType: 'product', subjectId: null, subjectName: 'Shawl', field, value, unit: 'NPR', language: 'en',
  sourceId: null, verifiedAt: '2026-11-01T00:00:00Z', expiresAt: null,
});
export const facts = [fact(F1), fact(F2, 'material', 'pashmina')];
