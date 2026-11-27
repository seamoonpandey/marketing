import { renderSlide } from './slide.ts';
import { renderVideo, RenderUnavailable } from './video.ts';

export type Ratio = '1:1' | '4:5' | '9:16' | '16:9';
export const SIZES: Record<Ratio, { width: number; height: number }> = {
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
};
export type BrandKit = {
  colours: { primary: string; text: string; background: string; accent?: string };
  logo?: Uint8Array;
};
export type Slide = {
  template: 'headline' | 'offer' | 'quote';
  headline: string;
  subline?: string;
  badge?: string;
  photo?: Uint8Array;
};
export type Renderer = { renderSlide: typeof renderSlide; renderVideo: typeof renderVideo };

export { renderSlide, renderVideo, RenderUnavailable };
