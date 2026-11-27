// The render interface of the plan ("The render interface"), declared here so this module compiles and
// tests with a fake before server/src/render/ is merged. Keep identical to render/index.ts.
import type { Ratio } from '../../db/schema/studio.ts';

export type { Ratio };
export const SIZES: Record<Ratio, { width: number; height: number }> = {
  '1:1': { width: 1080, height: 1080 }, '4:5': { width: 1080, height: 1350 }, '9:16': { width: 1080, height: 1920 }, '16:9': { width: 1920, height: 1080 },
};
export type BrandKit = { colours: { primary: string; text: string; background: string; accent?: string }; logo?: Uint8Array };
export type Slide = { template: 'headline' | 'offer' | 'quote'; headline: string; subline?: string; badge?: string; photo?: Uint8Array };
export type Renderer = {
  renderSlide(slide: Slide, kit: BrandKit, ratio: Ratio): Promise<{ png: Uint8Array; width: number; height: number; overflow: boolean }>;
  renderVideo(i: { frames: Uint8Array[]; secondsEach: number[] }): Promise<{ mp4: Uint8Array; seconds: number }>;
};

/** The engine's RenderUnavailable is a different class from any declared here, so match it by name. */
export const isRenderUnavailable = (e: unknown): boolean => e instanceof Error && e.constructor.name === 'RenderUnavailable';

/**
 * THE LAZY RENDERER IMPORT: the real engine is loaded at call time, through a variable specifier so
 * the compiler does not need server/src/render/index.ts to exist yet.
 */
export async function defaultRenderer(): Promise<Renderer> {
  const path = '../../render/index.ts';
  return (await import(path)) as Renderer;
}
