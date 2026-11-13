# Writes two test pictures of Monster Duo for phone-check.js into a folder:
#   transparent.png  8 px pixel art whose background squares are transparent with random colors hidden underneath
#                    (read as stored it isn't recognized; painted on white it is)
#   uneven.png       pixel art with uneven blocks (20-24 px, some 11 px), like AI-made "pixel art"
# Usage: python tests/make-test-images.py <folder>
import sys, random, json, os
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__)); out = sys.argv[1]
src = open(os.path.join(here, "..", "builtin.js"), encoding="utf-8").read()
P = json.loads(src[src.index("["):src.rindex("]") + 1])[0]
hexes = {c["code"]: tuple(int(c["hex"][i:i+2], 16) for i in (1, 3, 5)) for c in P["colors"]}
W, H = len(P["grid"][0]), len(P["grid"])

cell = 8; im = Image.new("RGBA", (W * cell, H * cell)); px = im.load(); random.seed(9)
for y in range(H * cell):
    for x in range(W * cell):
        k = P["grid"][y // cell][x // cell]
        px[x, y] = (random.randrange(256), random.randrange(256), random.randrange(256), 0) if k == "A" else hexes[k] + (255,)
im.save(os.path.join(out, "transparent.png"))

random.seed(7)
def edges(n):
    e = [0]
    for _ in range(n): e.append(e[-1] + (11 if random.random() < 0.15 else 20 + random.randrange(5)))
    return e
ex, ey = edges(W), edges(H)
im = Image.new("RGB", (ex[-1], ey[-1])); px = im.load()
for r in range(H):
    for c in range(W):
        for y in range(ey[r], ey[r + 1]):
            for x in range(ex[c], ex[c + 1]): px[x, y] = hexes[P["grid"][r][c]]
im.save(os.path.join(out, "uneven.png"))
print("wrote transparent.png and uneven.png to", out)
