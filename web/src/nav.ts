import { House, Megaphone, Radar, ShieldCheck, type LucideIcon } from 'lucide-react';

/** Product navigation, in order. Brand-scoped items need an active brand; without one they are disabled. */
export type NavItem = { id: string; label: string; icon: LucideIcon; href: (brandId?: string) => string | null };

export const NAV: NavItem[] = [
  { id: 'home', label: 'Home', icon: House, href: () => '/app' },
  { id: 'brand', label: 'Brand', icon: Megaphone, href: (b) => (b ? `/app/b/${b}/brand` : null) },
  { id: 'research', label: 'Research', icon: Radar, href: (b) => (b ? `/app/b/${b}/research` : null) },
  { id: 'approve', label: 'Approve', icon: ShieldCheck, href: (b) => (b ? `/app/b/${b}/approve` : null) },
];
