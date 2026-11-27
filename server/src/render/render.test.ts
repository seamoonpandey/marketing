import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { RenderUnavailable, renderSlide, renderVideo, SIZES, type BrandKit, type Ratio, type Slide } from './index.ts';

const colours = { primary: '#0f5257', text: '#141414', background: '#f4efe6', accent: '#c6a46a' };
const solid = (w: number, h: number, c: string) =>
  sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();
const ratios = Object.keys(SIZES) as Ratio[];
const templates = ['headline', 'offer', 'quote'] as const;
const slide = (template: Slide['template'], headline = 'हिमाल पश्मिना — १५% छुट'): Slide => ({ template, headline, subline: 'Handwoven in Bhaktapur', badge: '१५% छुट' });
const px = async (png: Uint8Array) => sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });

describe('renderSlide', () => {
  for (const t of templates)
    it(`${t}: exact size at every ratio`, async () => {
      for (const r of ratios) {
        const out = await renderSlide(slide(t), { colours }, r);
        const meta = await sharp(out.png).metadata();
        expect([meta.width, meta.height, out.width, out.height]).toEqual([SIZES[r].width, SIZES[r].height, SIZES[r].width, SIZES[r].height]);
      }
    });

  it('corner is the background and text pixels are present', async () => {
    const { png } = await renderSlide(slide('headline'), { colours }, '1:1');
    const { data, info } = await px(png);
    expect([...data.subarray(0, 3)]).toEqual([0xf4, 0xef, 0xe6]);
    let dark = 0;
    for (let i = 0; i < data.length; i += info.channels) if (data[i]! < 40 && data[i + 1]! < 40 && data[i + 2]! < 40) dark++;
    expect(dark).toBeGreaterThan(1000);
  });

  it('long text reports overflow without throwing', { timeout: 120000 }, async () => {
    for (const t of templates) {
      expect((await renderSlide(slide(t, 'शब्द '.repeat(60).slice(0, 300)), { colours }, '1:1')).overflow).toBe(true);
      expect((await renderSlide(slide(t, 'x'.repeat(80)), { colours }, '9:16')).overflow).toBe(true);
      expect((await renderSlide(slide(t, 'Twenty characters ok'), { colours }, '16:9')).overflow).toBe(false);
    }
  });

  it('wide, tall and absent logos stay inside the box and absence leaves no mark', async () => {
    for (const [w, h] of [[600, 100], [100, 600]] as const) {
      const kit: BrandKit = { colours, logo: await solid(w, h, '#ff0000') };
      const { data, info } = await px((await renderSlide(slide('headline'), kit, '1:1')).png);
      let [x0, y0, x1, y1] = [info.width, info.height, 0, 0];
      for (let i = 0; i < data.length; i += 3) {
        if (!(data[i]! > 200 && data[i + 1]! < 60 && data[i + 2]! < 60)) continue; // the logo's red
        const [x, y] = [(i / 3) % info.width, Math.floor(i / 3 / info.width)];
        [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      }
      expect(x1).toBeGreaterThan(x0);
      expect(x0).toBeGreaterThanOrEqual(86);
      expect(y0).toBeGreaterThanOrEqual(86);
      expect(x1).toBeLessThanOrEqual(86 + 324);
      expect(y1).toBeLessThanOrEqual(86 + 98);
      expect((x1 - x0 + 1) / (y1 - y0 + 1)).toBeCloseTo(w / h, 0); // not stretched
    }
    expect((await renderSlide(slide('quote'), { colours }, '4:5')).width).toBe(1080);
  });

  it('a photo renders for every template', async () => {
    const photo = await solid(400, 300, '#336699');
    for (const t of templates) expect((await renderSlide({ ...slide(t), photo }, { colours }, '16:9')).width).toBe(1920);
  });
});

const ffmpegHere = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

describe('renderVideo', () => {
  it.skipIf(!ffmpegHere)('joins frames into an H.264 MP4 of the right length', async () => {
    const frames = await Promise.all(['#ff0000', '#00ff00', '#0000ff'].map((c) => solid(320, 180, c)));
    // Its own temp root: the shared one also holds other renders running at the same time, so counting it races.
    const root = mkdtempSync(join(tmpdir(), 'video-test-'));
    const saved = process.env.TMPDIR;
    process.env.TMPDIR = root;
    let out: Awaited<ReturnType<typeof renderVideo>>;
    try {
      expect(tmpdir()).toBe(root);
      out = await renderVideo({ frames, secondsEach: [2, 2, 2] });
    } finally {
      if (saved === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = saved;
    }
    const { mp4, seconds } = out;
    expect(seconds).toBe(6);
    expect(readdirSync(root)).toEqual([]); // the render's working folder is gone
    const f = join(mkdtempSync(join(tmpdir(), 'probe-')), 'v.mp4');
    writeFileSync(f, mp4);
    const p = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,pix_fmt,r_frame_rate:format=duration', '-of', 'json', f]).toString());
    expect(p.streams[0]).toMatchObject({ codec_name: 'h264', width: 320, height: 180, pix_fmt: 'yuv420p', r_frame_rate: '30/1' });
    expect(Math.abs(Number(p.format.duration) - 6)).toBeLessThan(0.2);
  });

  it('throws RenderUnavailable when ffmpeg is not on the PATH', async () => {
    const saved = process.env.PATH;
    process.env.PATH = '';
    try {
      await expect(renderVideo({ frames: [await solid(64, 64, '#fff')], secondsEach: [1] })).rejects.toBeInstanceOf(RenderUnavailable);
    } finally {
      process.env.PATH = saved;
    }
  });
});
