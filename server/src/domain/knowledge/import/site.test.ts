import { describe, expect, it } from 'vitest';
import { fontFamilies, logoCandidates, stylesheetLinks } from './site.ts';

const BASE = 'https://ilamleaf.example/shop/';

describe('reading a homepage for the brand look', () => {
  it('ranks the JSON-LD logo, then header images marked logo, then the touch icon and a non-ico icon', () => {
    const html = `<html><head>
      <link rel="icon" href="/favicon.ico"><link rel="icon" type="image/png" sizes="32x32" href="/icon-32.png">
      <link rel="apple-touch-icon" href="/touch.png">
      <script type="application/ld+json">{"@graph":[{"@type":"Organization","logo":{"@type":"ImageObject","url":"/brand/logo.svg"}}]}</script>
      <script type="application/ld+json">{ broken</script>
      </head><body>
      <main><img src="/partners/logo-acme.png" alt="Acme"></main>
      <header><a class="site-logo" href="/"><img src="mark.png" alt=""></a><img src="/hero.jpg" alt="Tea"></header>
      <img src="data:image/png;base64,AAAA" class="logo">
      </body></html>`;
    expect(logoCandidates(html, BASE)).toEqual([
      'https://ilamleaf.example/brand/logo.svg', 'https://ilamleaf.example/shop/mark.png', 'https://ilamleaf.example/partners/logo-acme.png',
    ]);
    expect(logoCandidates('<link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/t.png"><link rel="icon" href="/i.svg">', BASE))
      .toEqual(['https://ilamleaf.example/t.png', 'https://ilamleaf.example/i.svg']);
    expect(logoCandidates('<p>No logo here</p><a href="javascript:x"><img class="logo" src="javascript:alert(1)"></a>', BASE)).toEqual([]);
  });

  it('lists linked stylesheets in page order, http(s) only, at most 4', () => {
    const html = ['a', 'b', 'c', 'd', 'e'].map((n) => `<link rel="stylesheet" href="/${n}.css">`).join('')
      + '<link rel="preload" href="/f.css"><link rel="alternate stylesheet" href="ftp://x/g.css">';
    expect(stylesheetLinks(html, BASE)).toEqual(['a', 'b', 'c', 'd'].map((n) => `https://ilamleaf.example/${n}.css`));
  });

  it('names Google Fonts first, then the most declared first families, without generic, system, icon or fallback fonts', () => {
    const html = `<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;700&family=Mukta&display=swap" rel="stylesheet">
      <link href="/local.css?family=Fake" rel="stylesheet">
      <style>h1 { font-family: "Playfair Display", serif } .x { font-family: var(--font) }</style>`;
    const sheet = `body{font-family:'__Inter_d65c78','__Inter_Fallback_d65c78'} p{font-family:__Inter_d65c78}
      .i{font-family:"Font Awesome 6 Free"} code{font-family:ui-monospace,monospace} .s{font-family:-apple-system,sans-serif}
      @font-face{font-family:"mukta";src:url(m.woff2)}`;
    expect(fontFamilies(html, [sheet])).toEqual(['Noto Sans Devanagari', 'Mukta', 'Inter', 'Playfair Display']);
  });
});
