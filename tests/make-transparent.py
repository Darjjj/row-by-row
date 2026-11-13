# Writes Monster Duo as 8 px pixel art whose background squares are transparent with random colors hidden
# underneath, for phone-check.js (third argument). Read as stored it isn't recognized; painted on white it is.
# Usage: python tests/make-transparent.py <out.png>
import sys, random, json, os
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, "..", "builtin.js"), encoding="utf-8").read()
P = json.loads(src[src.index("["):src.rindex("]") + 1])[0]
hexes = {c["code"]: tuple(int(c["hex"][i:i+2], 16) for i in (1, 3, 5)) for c in P["colors"]}
cell = 8; W, H = len(P["grid"][0]), len(P["grid"])
im = Image.new("RGBA", (W * cell, H * cell)); px = im.load(); random.seed(9)
for y in range(H * cell):
    for x in range(W * cell):
        k = P["grid"][y // cell][x // cell]
        px[x, y] = (random.randrange(256), random.randrange(256), random.randrange(256), 0) if k == "A" else hexes[k] + (255,)
im.save(sys.argv[1]); print("wrote", sys.argv[1], im.size)
