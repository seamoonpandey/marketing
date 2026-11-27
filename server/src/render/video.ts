import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class RenderUnavailable extends Error {}

const FPS = 30;

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
    p.on('error', (e: NodeJS.ErrnoException) =>
      reject(e.code === 'ENOENT' ? new RenderUnavailable('ffmpeg is not on the PATH') : e),
    );
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err}`))));
  });
}

/** Joins PNG frames into an H.264 yuv420p 30 fps MP4, each frame held for its seconds. */
export async function renderVideo(i: {
  frames: Uint8Array[];
  secondsEach: number[];
}): Promise<{ mp4: Uint8Array; seconds: number }> {
  if (!i.frames.length || i.frames.length !== i.secondsEach.length) throw new Error('frames and secondsEach must match');
  const dir = await mkdtemp(join(tmpdir(), 'render-'));
  try {
    const lines: string[] = [];
    for (const [n, f] of i.frames.entries()) {
      await writeFile(join(dir, `f${n}.png`), f);
      lines.push(`file 'f${n}.png'`, `duration ${i.secondsEach[n]}`);
    }
    lines.push(`file 'f${i.frames.length - 1}.png'`); // the concat demuxer ignores the last duration unless the file repeats; -t trims the extra hold
    await writeFile(join(dir, 'list.txt'), lines.join('\n'));
    const seconds = i.secondsEach.reduce((a, b) => a + b, 0);
    // even dimensions are required by yuv420p
    await run([
      '-y', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'),
      '-vf', `fps=${FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
      '-t', String(seconds), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart',
      join(dir, 'out.mp4'),
    ]);
    return { mp4: await readFile(join(dir, 'out.mp4')), seconds };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
