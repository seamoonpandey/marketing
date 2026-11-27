// What each platform accepts (§9.1). Text limits are the Studio design's (section 3); null means none.
// lastVerified is null for every platform: each value must be checked against the platform before a
// real connector ships.

export const platforms = ['facebook', 'instagram', 'tiktok', 'youtube', 'linkedin', 'x', 'whatsapp', 'email', 'website'] as const;
export type Platform = (typeof platforms)[number];

export type Capabilities = {
  textLimit: number | null;
  ratios: string[]; // in order of preference: the first one a draft has is the shape that is posted
  maxMedia: number;
  lastVerified: string | null;
  manualFallback: true;
};

const ALL = ['1:1', '4:5', '9:16', '16:9'];
const cap = (textLimit: number | null, ratios: string[], maxMedia: number): Capabilities => ({ textLimit, ratios, maxMedia, lastVerified: null, manualFallback: true });

export const CAPABILITIES: Record<Platform, Capabilities> = {
  facebook: cap(2000, ALL, 10),
  instagram: cap(2200, ['1:1', '4:5', '9:16'], 10),
  tiktok: cap(2200, ['9:16'], 1),
  youtube: cap(5000, ['16:9', '9:16'], 1),
  linkedin: cap(3000, ['1:1', '4:5', '16:9'], 9),
  x: cap(280, ['16:9', '1:1'], 4),
  whatsapp: cap(1024, ALL, 1),
  email: cap(null, ALL, 1),
  website: cap(null, ALL, 1),
};

export const isPlatform = (p: string): p is Platform => (platforms as readonly string[]).includes(p);
