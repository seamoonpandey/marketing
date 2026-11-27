/* Which colour theme the site wears. The colours live in public/theme.css (one [data-theme] block per
   theme); this file holds what CSS cannot: the kit's lit ground for cards (an attribute) and the browser's
   theme-color. To change theme, change THEME; to add one, add its block to theme.css, an entry here and
   its hero still (public/themes/<name>/hero.jpg). */
export const THEMES = {
  pastel: { ground: 'sage', themeColor: '#c3d7e5' },
  heritage: { ground: 'sand', themeColor: '#f5efe5' },
  vermilion: { ground: 'sand', themeColor: '#fff7ed' },
} as const;

export type ThemeName = keyof typeof THEMES;

export const THEME: ThemeName = 'pastel';
