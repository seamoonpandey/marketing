"""Web copies of the mascot artwork. For every public/brand/mascot/<name>-master.(jpg|png): cut the white
background away (a flood fill from the edges; the dark outline stops it, so the robot's own white stays),
trim, and write <name>.webp (640 wide) and <name>-small.webp (280 wide) with transparency. From head-master
it also writes the favicons (public/brand/favicon-32.png, favicon-64.png, apple-touch-icon.png). FLIPS below
derives mirrored art (the chest P put back the right way round).

usage (from web/, needs Pillow): python3 scripts/mascot-assets.py
"""
import glob, os
from collections import deque
from PIL import Image, ImageChops, ImageFilter, ImageMath

HERE = os.path.dirname(os.path.abspath(__file__))
BRAND = os.path.join(HERE, '..', 'public', 'brand')
WORK = 1024  # the cut-out is found at this size, then applied to the full-size picture

def cutout(src):
    im = src.convert('RGB')
    small = im.resize((WORK, round(im.size[1] * WORK / im.size[0])), Image.LANCZOS)
    w, h = small.size
    px = small.load()
    # background: light, colourless pixels reachable from the edge (the paper and the soft floor shadow)
    bg = lambda c: min(c) >= 200 and max(c) - min(c) < 22
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if bg(px[x, y]) and not seen[y * w + x]: seen[y * w + x] = 1; q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if bg(px[x, y]) and not seen[y * w + x]: seen[y * w + x] = 1; q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and bg(px[nx, ny]):
                seen[ny * w + nx] = 1; q.append((nx, ny))
    mask = Image.frombytes('L', (w, h), bytes(0 if s else 255 for s in seen))
    mask = mask.resize(im.size, Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))   # a soft, antialiased edge
    out = im.convert('RGBA'); out.putalpha(mask)
    return out.crop(out.split()[3].point(lambda a: 255 if a > 24 else 0).getbbox())

def badge_mask(im, box):
    """the chest P inside box: its dark ink and everything that ink encloses"""
    x0, y0, x1, y1 = box
    crop = im.crop(box); w, h = crop.size; px = crop.load()
    dark = lambda c: sum(c[:3]) < 330
    out = bytearray(w * h); q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not dark(px[x, y]): out[y * w + x] = 1; q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not dark(px[x, y]) and not out[y * w + x]: out[y * w + x] = 1; q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not out[ny * w + nx] and not dark(px[nx, ny]):
                out[ny * w + nx] = 1; q.append((nx, ny))
    m = Image.frombytes('L', (w, h), bytes(0 if o else 255 for o in out)).filter(ImageFilter.MaxFilter(7))
    full = Image.new('L', im.size, 0); full.paste(m, (x0, y0))
    return full

def flipped(im, box):
    """the art mirrored, with the chest P put back the right way round"""
    im = im.convert('RGB'); W = im.size[0]
    keep = badge_mask(im, box)
    fl = im.transpose(Image.FLIP_LEFT_RIGHT); hole = keep.transpose(Image.FLIP_LEFT_RIGHT)
    # paint the mirrored P out: each channel blurred from the chest around it (a normalised blur)
    known = ImageChops.invert(hole)
    den = known.filter(ImageFilter.GaussianBlur(24)).convert('F')
    bands = []
    for b in fl.split():
        num = ImageChops.multiply(b, known).filter(ImageFilter.GaussianBlur(24)).convert('F')
        bands.append(ImageMath.unsafe_eval('a * 255.0 / (b + 0.01)', a=num, b=den).convert('L'))
    fl = Image.composite(Image.merge('RGB', bands), fl, hole)
    # the original P, unmirrored, at the mirrored place
    x0, y0, x1, y1 = box; nx0 = W - x1
    fl.paste(im.crop(box), (nx0, y0), keep.crop(box).filter(ImageFilter.GaussianBlur(1)))
    return fl

# derived art: <new name> = (<master name>, the chest badge's box in the master)
FLIPS = {'wave-left': ('wave', (815, 1190, 1085, 1500))}

def save(im, width, path):
    im.resize((width, round(im.size[1] * width / im.size[0])), Image.LANCZOS).save(path, quality=86, method=6)

for master in sorted(glob.glob(os.path.join(BRAND, 'mascot', '*-master.*'))):
    name = os.path.basename(master).split('-master.')[0]
    art = cutout(Image.open(master))
    save(art, 640, os.path.join(BRAND, 'mascot', f'{name}.webp'))
    save(art, 280, os.path.join(BRAND, 'mascot', f'{name}-small.webp'))
    print(name, art.size)
    if name == 'head':
        side = max(art.size) + max(art.size) // 16
        sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        sq.alpha_composite(art, ((side - art.size[0]) // 2, (side - art.size[1]) // 2))
        for s in (32, 64):
            sq.resize((s, s), Image.LANCZOS).save(os.path.join(BRAND, f'favicon-{s}.png'), optimize=True)
        tile = Image.new('RGBA', (180, 180), (255, 255, 255, 255))   # iOS wants an opaque icon
        tile.alpha_composite(sq.resize((156, 156), Image.LANCZOS), (12, 12))
        tile.convert('RGB').save(os.path.join(BRAND, 'apple-touch-icon.png'), optimize=True)

for name, (base, box) in FLIPS.items():
    master = next(iter(glob.glob(os.path.join(BRAND, 'mascot', f'{base}-master.*'))))
    art = cutout(flipped(Image.open(master), box))
    save(art, 640, os.path.join(BRAND, 'mascot', f'{name}.webp'))
    save(art, 280, os.path.join(BRAND, 'mascot', f'{name}-small.webp'))
    print(name, art.size)
