import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { contrast, cssColours, extractPalette, toCmyk, toRgb } from './colour.ts';

/** A PNG of colour columns (percent of the width each) under a transparent top half. */
async function stripes(cols: [string, number][], width = 100, height = 20): Promise<Uint8Array> {
  const px = Buffer.alloc(width * height * 4); // transparent
  for (let y = height / 2; y < height; y++) {
    let x = 0;
    for (const [hex, pct] of cols) {
      const { r, g, b } = toRgb(hex);
      for (const end = x + (width * pct) / 100; x < end; x++) px.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return sharp(px, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/** A photo-like JPEG: a gradient with pseudo-random noise, compressed. */
async function photo(): Promise<Uint8Array> {
  const [w, h] = [320, 240];
  const px = Buffer.alloc(w * h * 3);
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 60;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) px.set([(x * 255) / w, (y * 255) / h, 128 + rand()].map(Math.round), (y * w + x) * 3);
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 70 }).toBuffer();
}

describe('palette', () => {
  it('returns the exact colours of a logo, largest share first', async () => {
    const png = await stripes([['#0f5257', 60], ['#c3d7e5', 30], ['#141414', 10]]);
    const palette = await extractPalette(png);
    expect(palette.map((c) => c.hex)).toEqual(['#0f5257', '#c3d7e5', '#141414']);
    expect(palette.map((c) => c.share)).toEqual([0.6, 0.3, 0.1]);
  });

  it('review focus 4: a white logo on transparent gives white; a photograph gives 1 to 8 colours', async () => {
    expect((await extractPalette(await stripes([['#ffffff', 100]]))).map((c) => c.hex)).toEqual(['#ffffff']);
    const p = await extractPalette(await photo());
    expect(p.length).toBeGreaterThanOrEqual(1);
    expect(p.length).toBeLessThanOrEqual(8);
    for (const c of p) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('rasterises an SVG logo', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="30" height="20" fill="#0f5257"/><rect x="30" width="10" height="20" fill="#e85d27"/></svg>';
    expect((await extractPalette(new TextEncoder().encode(svg))).map((c) => c.hex)).toEqual(['#0f5257', '#e85d27']);
  });

  it('converts to CMYK naively and computes WCAG contrast', () => {
    expect(toCmyk('#ff0000')).toEqual({ c: 0, m: 100, y: 100, k: 0 });
    expect(toCmyk('#000000')).toEqual({ c: 0, m: 0, y: 0, k: 100 });
    expect(contrast('#000000', '#ffffff')).toBe(21);
    expect(contrast('#777777', '#777777')).toBe(1);
    expect(toRgb('#0f5257')).toEqual({ r: 15, g: 82, b: 87 });
  });

  it('reads the theme colour and CSS colour custom properties of a page', () => {
    const html = `<html><head><meta name="theme-color" content="#0F5257">
      <style>:root { --brand: #c3d7e5; --ink: rgb(20, 20, 20); --gap: 4px; --ghost: rgba(0,0,0,0.1); --short: #fff }</style>
      </head><body style="--accent: #e85d27"></body></html>`;
    expect(cssColours(html)).toEqual(['#0f5257', '#c3d7e5', '#141414', '#ffffff', '#e85d27']);
  });

  it('reads a hostile page of dashes in linear time, so a homepage cannot stall the server', () => {
    const start = performance.now();
    expect(cssColours(`<style>${'-'.repeat(100_000)}</style><style>--a:#0f5257</style>`)).toEqual(['#0f5257']);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
