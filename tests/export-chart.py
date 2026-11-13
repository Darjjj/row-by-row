# Writes the Monster Duo chart image as raw RGBA at three sizes for chart.test.js.
# Usage: python tests/export-chart.py [path to original-chart.jpg]
import sys, os
from PIL import Image
src = sys.argv[1] if len(sys.argv) > 1 else r"C:\Projects\monster-graphghan\tools\original-chart.jpg"
im = Image.open(src).convert("RGBA")
here = os.path.dirname(os.path.abspath(__file__))
for name, scale in (("full", 1), ("half", 0.5), ("small", 0.33)):
    j = im if scale == 1 else im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    open(os.path.join(here, f"chart-{name}.rgba"), "wb").write(j.tobytes())
    print(name, j.size)
