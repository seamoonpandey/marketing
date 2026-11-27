// Names for the API's codes: one spelling of a channel, a kind or a language on every screen.

const LABELS: Record<string, string> = {
  x: 'X', linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube', whatsapp: 'WhatsApp', gif: 'GIF',
  goal_kpi: 'Goal and KPI', offer_message: 'Offer and message', channel_mix: 'Channel mix', founder_team: 'Founder and team',
  faq: 'FAQ', cta: 'Call to action', capture_lead: 'Capture a lead',
  post: 'Text post', static: 'Single image', carousel: 'Carousel', video: 'Video',
};

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replaceAll('_', ' ');

/** A code as the owner reads it: "linkedin" is LinkedIn, "founder_team" is Founder and team. */
export const label = (s: string | null | undefined, fallback = 'Not set') => (s ? (LABELS[s] ?? title(s)) : fallback);

/** A language's English name ("Nepali"), from its code. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
