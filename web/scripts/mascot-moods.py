"""The mascot's moods: the owner's master artwork with its eyes repainted and small accents added in the
artwork's own colours and outline. Body, topi and megaphone stay untouched.
usage (from web/, needs Pillow): python3 scripts/mascot-moods.py public/brand/prachaar-mascot-master.png public/brand/mascot
Also writes the favicons (favicon-32, favicon-64, apple-touch-icon) beside the out dir."""
import math, sys
from collections import deque
from PIL import Image, ImageDraw

SRC, OUT = sys.argv[1], sys.argv[2]
TEAL, OUTLINE, CYAN, WHITE, VISOR = (6, 79, 90, 255), (2, 17, 28, 255), (62, 172, 195, 255), (255, 255, 255, 255), (11, 15, 26, 255)
S = 3  # accents are drawn at 3x and scaled down, for smooth edges

base = Image.open(SRC).convert('RGBA')
W, H = base.size
px = base.load()

# ---- the visor (flood fill from inside it) and the eyes (the bright holes it encloses)
dark = lambda x, y: px[x, y][3] > 200 and sum(px[x, y][:3]) < 140
seed = next((x, y) for y in range(560, 660, 4) for x in range(420, 560, 4) if dark(x, y))
visor = {seed}; q = deque([seed])
while q:
    x, y = q.popleft()
    for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
        if 0 <= n[0] < W and 0 <= n[1] < H and n not in visor and dark(*n):
            visor.add(n); q.append(n)
X0, Y0 = min(p[0] for p in visor), min(p[1] for p in visor)
X1, Y1 = max(p[0] for p in visor), max(p[1] for p in visor)
out = set(); q = deque()
for x in range(X0, X1 + 1):
    for y in range(Y0, Y1 + 1):
        if (x in (X0, X1) or y in (Y0, Y1)) and (x, y) not in visor: out.add((x, y)); q.append((x, y))
while q:
    x, y = q.popleft()
    for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
        if X0 <= n[0] <= X1 and Y0 <= n[1] <= Y1 and n not in visor and n not in out:
            out.add(n); q.append(n)
holes = [(x, y) for y in range(Y0, Y1 + 1) for x in range(X0, X1 + 1) if (x, y) not in visor and (x, y) not in out]
xs = sorted(set(p[0] for p in holes))
gap = max(((b - a, a, b) for a, b in zip(xs, xs[1:])))
MID = (gap[1] + gap[2]) // 2
def box(sel): return min(p[0] for p in sel), min(p[1] for p in sel), max(p[0] for p in sel), max(p[1] for p in sel)
LB, RB = box([p for p in holes if p[0] < MID]), box([p for p in holes if p[0] >= MID])
CL = ((LB[0] + LB[2]) / 2, (LB[1] + LB[3]) / 2)
CR = ((RB[0] + RB[2]) / 2, (RB[1] + RB[3]) / 2)
TILT = math.atan2(CR[1] - CL[1], CR[0] - CL[0])          # the head's tilt
R = (LB[2] - LB[0]) / 2                                 # an eye's half width
SW = 22                                                 # the eyes' stroke, as drawn in the artwork
assert 40 < R < 80 and -0.5 < TILT < 0, (R, TILT)       # the face is where the artwork has it

def erase(which):
    """paint the chosen eyes back into the visor (their antialiased rim too)"""
    m = Image.new('L', (W, H), 0); mp = m.load()
    for x, y in holes:
        if which == 'both' or (which == 'left') == (x < MID): mp[x, y] = 255
    from PIL import ImageFilter
    m = m.filter(ImageFilter.MaxFilter(7))
    fill = Image.new('RGBA', (W, H), VISOR)
    return Image.composite(fill, base, m)

# ---- drawing helpers on a 3x overlay
def canvas(): return Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
def to_img(c, u, v):
    """a point in an eye's own frame (u right, v down, tilted with the head) to overlay pixels"""
    ca, sa = math.cos(TILT), math.sin(TILT)
    return ((c[0] + u * ca - v * sa) * S, (c[1] + u * sa + v * ca) * S)
def stroke(d, pts, color, w):
    d.line(pts, fill=color, width=round(w * S), joint='curve')
    for p in (pts[0], pts[-1]):
        r = w * S / 2; d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=color)
def eye_path(d, c, pts, w=SW, color=WHITE): stroke(d, [to_img(c, u, v) for u, v in pts], color, w)
def arc(cx, cy, rx, ry, a0, a1, n=24):
    return [(cx + rx * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cy + ry * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]
def eye_fill(d, c, pts, color=WHITE): d.polygon([to_img(c, u, v) for u, v in pts], fill=color)
def heart(cx, cy, s, n=60):
    return [(cx + s * 16 * math.sin(t) ** 3 / 17, cy - s * (13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)) / 17)
            for t in [2 * math.pi * i / n for i in range(n)]]

# accents: an outlined shape in the artwork's manner (a dark outline, then the fill)
O = 9  # outline weight
def outlined_poly(d, pts, fill):
    P = [(x * S, y * S) for x, y in pts]
    d.line(P + [P[0]], fill=OUTLINE, width=round(O * 2 * S), joint='curve')
    d.polygon(P, fill=fill)
def outlined_stroke(d, pts, color, w):
    P = [(x * S, y * S) for x, y in pts]
    stroke(d, P, OUTLINE, w + 2 * O); stroke(d, P, color, w)
def dot(d, x, y, r, color):
    d.ellipse([(x - r - O) * S, (y - r - O) * S, (x + r + O) * S, (y + r + O) * S], fill=OUTLINE)
    d.ellipse([(x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S], fill=color)
def sparkle(d, x, y, s, color):
    pts = []
    for i in range(8):
        a = math.radians(i * 45 - 90); r = s if i % 2 == 0 else s * 0.32
        pts.append((x + r * math.cos(a), y + r * math.sin(a)))
    outlined_poly(d, pts, color)
def drop(d, x, y, s, color):
    pts = [(x + s * 0.62 * math.cos(math.radians(a)), y + s * 0.62 * math.sin(math.radians(a))) for a in range(-30, 211, 10)]
    pts = [(x, y - s * 1.15)] + pts
    outlined_poly(d, pts, color)
    d.ellipse([(x - s * 0.32) * S, (y - s * 0.1) * S, (x - s * 0.1) * S, (y + s * 0.2) * S], fill=WHITE)
def question(d, x, y, s, color):
    outlined_stroke(d, arc(x, y, s * 0.5, s * 0.5, 200, 400, 20) + [(x + s * 0.05, y + s * 0.55), (x + s * 0.05, y + s * 0.8)], color, s * 0.24)
    dot(d, x + s * 0.05, y + s * 1.15, s * 0.14, color)
def bang(d, x, y, s, color):
    outlined_stroke(d, [(x, y - s * 0.5), (x, y + s * 0.45)], color, s * 0.26)
    dot(d, x, y + s * 0.85, s * 0.15, color)
def puff(d, x, y, s):
    for dx, dy, r in [(-0.55, 0.1, 0.42), (0, -0.2, 0.55), (0.55, 0.1, 0.42)]:
        dot(d, x + dx * s, y + dy * s, r * s, WHITE)

def finish(img, layer):
    layer = layer.resize((W, H), Image.LANCZOS)
    return Image.alpha_composite(img, layer)

# ---- the moods
moods = {}
moods['smile'] = base.copy()

L = canvas(); d = ImageDraw.Draw(L)                                   # happy: sparkles around the head
sparkle(d, 120, 230, 58, CYAN); sparkle(d, 210, 110, 34, TEAL); sparkle(d, 60, 400, 26, TEAL)
moods['happy'] = finish(base.copy(), L)

img = erase('right'); L = canvas(); d = ImageDraw.Draw(L)             # wink: the left eye stays closed, the right opens
eye_fill(d, CR, [(R * 0.34 * math.cos(t), R * 0.5 * math.sin(t) + R * 0.1) for t in [i * math.pi / 20 for i in range(40)]])
sparkle(d, 150, 260, 44, CYAN)
moods['wink'] = finish(img, L)

img = erase('both'); L = canvas(); d = ImageDraw.Draw(L)              # love: heart eyes, hearts in the air
for c in (CL, CR): eye_fill(d, c, heart(0, R * 0.15, R * 0.95))
outlined_poly(d, heart(130, 240, 62), TEAL); outlined_poly(d, heart(230, 120, 36), CYAN)
moods['love'] = finish(img, L)

img = erase('both'); L = canvas(); d = ImageDraw.Draw(L)              # surprised: round eyes, a "!"
for c in (CL, CR): eye_path(d, c, arc(0, R * 0.15, R * 0.42, R * 0.52, 0, 360, 40), SW * 0.9)
bang(d, 150, 250, 120, TEAL)
moods['surprised'] = finish(img, L)

img = erase('both'); L = canvas(); d = ImageDraw.Draw(L)              # sad: open eyes looking down, worried brows, a tear
for c, sgn in ((CL, 1), (CR, -1)):
    eye_fill(d, c, [(R * 0.3 * math.cos(t), R * 0.4 * math.sin(t) + R * 0.3) for t in [i * math.pi / 20 for i in range(40)]])
    eye_path(d, c, [(-sgn * R * 0.6, -R * 0.35), (sgn * R * 0.45, -R * 0.78)], SW * 0.8)
tx, ty = to_img(CL, -R * 0.3, R * 0.95)
drop(d, tx / S, ty / S, 30, CYAN)
moods['sad'] = finish(img, L)

img = erase('both'); L = canvas(); d = ImageDraw.Draw(L)              # confused: a spiral eye and a dot, question marks
eye_path(d, CL, [(R * 0.06 * t * math.cos(t), R * 0.06 * t * math.sin(t) + R * 0.1) for t in [i * 0.25 for i in range(4, 42)]], SW * 0.75)
eye_fill(d, CR, [(R * 0.24 * math.cos(t), R * 0.24 * math.sin(t) + R * 0.1) for t in [i * math.pi / 16 for i in range(32)]])
question(d, 130, 210, 120, TEAL); question(d, 245, 80, 64, CYAN)
moods['confused'] = finish(img, L)

img = erase('both'); L = canvas(); d = ImageDraw.Draw(L)              # frustrated: squeezed > < eyes, sweat and steam
eye_path(d, CL, [(-R * 0.45, -R * 0.45), (R * 0.4, R * 0.1), (-R * 0.45, R * 0.6)])
eye_path(d, CR, [(R * 0.45, -R * 0.45), (-R * 0.4, R * 0.1), (R * 0.45, R * 0.6)])
drop(d, 205, 390, 40, CYAN)
puff(d, 140, 170, 70); puff(d, 260, 70, 42)
moods['frustrated'] = finish(img, L)

import os
os.makedirs(OUT, exist_ok=True)
for name, im in moods.items():
    im = im.crop(im.split()[3].getbbox())
    im.save(f'{OUT}/{name}-master.png', optimize=True)
    for w, suffix in ((560, ''), (240, '-small')):
        im.resize((w, round(im.size[1] * w / im.size[0])), Image.LANCZOS).save(f'{OUT}/{name}{suffix}.png', optimize=True)
    print(name, im.size)

# ---- the favicon: the smiling head (topi, visor, headphone), square
hb = base.crop((100, 130, 728, 720))                                # the head: topi, visor, headphone
side = max(hb.size); head = Image.new('RGBA', (side, side), (0, 0, 0, 0))
head.alpha_composite(hb, ((side - hb.size[0]) // 2, (side - hb.size[1]) // 2))
for size, name in ((64, 'favicon-64.png'), (32, 'favicon-32.png')):
    head.resize((size, size), Image.LANCZOS).save(f'{OUT}/../{name}', optimize=True)
touch = Image.new('RGBA', (180, 180), (195, 215, 229, 255))           # iOS wants an opaque tile: the mist ground
touch.alpha_composite(head.resize((156, 156), Image.LANCZOS), (12, 12))
touch.convert('RGB').save(f'{OUT}/../apple-touch-icon.png', optimize=True)
print('tilt', round(math.degrees(TILT), 1), 'eye half width', R)
