// Regenerates the fixtures and the sample PNGs: node test/fixtures/studio/render/make.ts
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { renderSlide, SIZES, type BrandKit, type Ratio, type Slide } from '../../../../src/render/index.ts';

const dir = fileURLToPath(new URL('./', import.meta.url));
const svg = (w: number, h: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);

const logo = await sharp(svg(480, 140, `<rect x="4" y="20" width="100" height="100" rx="26" fill="#0f5257"/>
  <path d="M30 50h48M30 70h48M30 90h30" stroke="#f4efe6" stroke-width="10" stroke-linecap="round"/>
  <text x="128" y="94" font-family="Noto Sans" font-weight="700" font-size="70" fill="#0f5257">Himal</text>`)).png().toBuffer();
const mark = await sharp(svg(140, 480, `<rect x="10" y="10" width="120" height="120" rx="30" fill="#0f5257"/>
  <rect x="10" y="150" width="120" height="320" rx="30" fill="#c6a46a"/>`)).png().toBuffer();
const photo = await sharp(svg(1600, 1200, `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6c58b"/><stop offset=".55" stop-color="#e98a6b"/><stop offset="1" stop-color="#7b5a7a"/></linearGradient></defs>
  <rect width="1600" height="1200" fill="url(#s)"/><circle cx="1150" cy="380" r="120" fill="#fff3d6"/>
  <path d="M0 760 L260 470 L460 650 L760 330 L1060 640 L1260 500 L1600 780 V1200 H0Z" fill="#5d4a6e"/>
  <path d="M0 900 L300 700 L620 860 L980 660 L1300 850 L1600 740 V1200 H0Z" fill="#33284a"/>`))
  .blur(2).jpeg({ quality: 88 }).toBuffer();
await writeFile(`${dir}logo-wide.png`, logo);
await writeFile(`${dir}logo-tall.png`, mark);
await writeFile(`${dir}photo.jpg`, photo);

const kit: BrandKit = { colours: { primary: '#0f5257', text: '#141414', background: '#f4efe6', accent: '#c6a46a' }, logo };
const ne = { headline: 'हिमाल पश्मिना — १५% छुट', subline: 'Handwoven in Bhaktapur' };
await mkdir(`${dir}samples`, { recursive: true });
const jobs: [string, Slide, BrandKit][] = [];
for (const template of ['headline', 'offer', 'quote'] as const) {
  const base = { ...ne, template, badge: template === 'offer' ? '१५% छुट' : undefined };
  jobs.push([`${template}-ne`, base, kit]);
  jobs.push([`${template}-ne-photo`, { ...base, photo: photo }, kit]);
  jobs.push([
    `${template}-en`,
    { template, headline: template === 'quote' ? 'Every shawl carries the hands that made it' : 'Pashmina, woven the slow way', subline: template === 'quote' ? 'Maya Tamang, weaver' : 'Handwoven in Bhaktapur since 1994', badge: template === 'offer' ? '15% OFF' : undefined },
    { colours: { ...kit.colours, background: '#123f43', text: '#f4efe6', primary: '#e8c982', accent: '#e8c982' } },
  ]);
}
for (const [name, slide, k] of jobs)
  for (const ratio of Object.keys(SIZES) as Ratio[]) {
    const r = await renderSlide(slide, k, ratio);
    await writeFile(`${dir}samples/${name}-${ratio.replace(':', 'x')}.png`, r.png);
  }
