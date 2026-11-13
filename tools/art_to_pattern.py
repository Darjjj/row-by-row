"""Turn a generated pixel-art picture into a Row by Row chart pattern (JSON for tools/make_import_link.py).

Crops to the subject (anything not near-white), fits it into the grid with a margin of background, then reads
each square with the app's own reader (picture.js: each square's main color, same-looking shades combined,
6 to 10 colors, her range) by running tools/read_grid.js with Bun. Also writes a preview PNG next to the JSON.

  python tools/art_to_pattern.py option-4.png --grid 50x60 --name "Monkey with a banana" --id c-monkey-banana --out monkey.json
      [--margin 2] [--colors 10] [--drop-shadow] [--fit]
  --drop-shadow: pale gray-blue ground shadows become background
  --fit: keep the width and size the height to the design (less plain background to crochet); a design taller
         than --max-rows (70) gets a narrower grid instead
  Near-black shades always become one black yarn, and a square at least --line (0.35) covered by near-black outline
  is black, so outlines thinner than a square stay closed instead of breaking where they run along a square edge.
"""
import argparse, json, os, shutil, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

HERE = Path(__file__).resolve().parent
BUN = shutil.which("bun") or str(Path.home() / ".bun" / "bin" / "bun.exe")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("picture"); ap.add_argument("--grid", default="50x60"); ap.add_argument("--name", required=True)
    ap.add_argument("--id", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--margin", type=int, default=2); ap.add_argument("--colors", type=int, default=10)
    ap.add_argument("--drop-shadow", action="store_true"); ap.add_argument("--fit", action="store_true")
    ap.add_argument("--max-rows", type=int, default=70)
    ap.add_argument("--line", type=float, default=0.35)  # outline share that makes a square black (0 = off)
    a = ap.parse_args()
    assert a.id.startswith("c-"), "chart pattern ids start with c-"
    cols, rows = map(int, a.grid.lower().split("x"))
    im = Image.open(a.picture).convert("RGB")
    px = im.load(); W, H = im.size
    def bg(c):
        r, g, b = c
        if min(c) > 235: return True
        # a soft ground shadow: pale, a little blue-gray, low saturation
        return a.drop_shadow and min(c) > 140 and max(c) - min(c) < 45 and b >= r
    if a.drop_shadow:
        for y in range(H):
            for x in range(W):
                if bg(px[x, y]): px[x, y] = (255, 255, 255)
    xs = [x for x in range(W) if any(not bg(px[x, y]) for y in range(0, H, 2))]
    ys = [y for y in range(H) if any(not bg(px[x, y]) for x in range(0, W, 2))]
    box = (min(xs), min(ys), max(xs) + 1, max(ys) + 1)
    sub = im.crop(box)
    if a.fit:   # keep the width, unless a tall design would run past --max-rows: then narrow it
        rows = max(8, round(sub.height / sub.width * (cols - 2 * a.margin)) + 2 * a.margin)
        if rows > a.max_rows:
            cols = max(16, round((a.max_rows - 2 * a.margin) * sub.width / sub.height) + 2 * a.margin)
            rows = max(8, round(sub.height / sub.width * (cols - 2 * a.margin)) + 2 * a.margin)
    # fit inside (cols - 2*margin) x (rows - 2*margin) squares, centered, on white
    inner_c, inner_r = cols - 2 * a.margin, rows - 2 * a.margin
    cell = max(sub.width / inner_c, sub.height / inner_r)
    canvas = Image.new("RGB", (round(cols * cell), round(rows * cell)), (255, 255, 255))
    canvas.paste(sub, (round((canvas.width - sub.width) / 2), round((canvas.height - sub.height) / 2)))
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "pic.rgba"; raw.write_bytes(canvas.convert("RGBA").tobytes())
        res = subprocess.run([BUN, str(HERE / "read_grid.js"), str(raw), str(canvas.width), str(canvas.height), str(cols), str(rows), str(a.colors)],
                             capture_output=True, text=True)
        if res.returncode: sys.exit(res.stderr)
        read = json.loads(res.stdout)
    # near-black shades (outline anti-aliasing) are all the same black yarn: fold them into the darkest one
    rgb = lambda c: [int(c["hex"][i:i + 2], 16) for i in (1, 3, 5)]
    darks = sorted((c for c in read["colors"] if max(rgb(c)) < 64), key=lambda c: sum(rgb(c)))
    if len(darks) > 1:
        keep, drop = darks[0]["code"], {c["code"] for c in darks[1:]}
        read["grid"] = ["".join(keep if ch in drop else ch for ch in r) for r in read["grid"]]
        read["colors"] = [c for c in read["colors"] if c["code"] not in drop]
    # outlines a bit thinner than a square lose to the fill when they run along a square's edge, leaving gaps:
    # a square at least --line covered by dark outline is black, so the outline stays closed
    blacks = sorted((c for c in read["colors"] if max(rgb(c)) < 64), key=lambda c: sum(rgb(c)))
    if blacks and a.line > 0:
        k = blacks[0]["code"]
        r_, g_, b_ = canvas.split()   # near-black only (every channel dark), so dark greens and purples stay
        cover = ImageChops.lighter(ImageChops.lighter(r_, g_), b_).point(lambda v: 255 if v < 70 else 0).resize((cols, rows), Image.BOX).load()
        read["grid"] = ["".join(k if cover[x, y] >= a.line * 255 else ch for x, ch in enumerate(r)) for y, r in enumerate(read["grid"])]
    colors = sorted(read["colors"], key=lambda c: -sum(r.count(c["code"]) for r in read["grid"]))
    pattern = {"kind": "chart", "id": a.id, "name": a.name, "grid": read["grid"],
               "colors": [{"code": c["code"], "name": c["name"], "hex": c["hex"]} for c in colors]}
    if not 6 <= len(colors) <= 10:   # she likes 6 to 10 yarns per chart, background included
        sys.exit(f"{len(colors)} colors: her charts use 6 to 10. Try --colors (fewer) or another picture with more colors.")
    Path(a.out).write_text(json.dumps(pattern, indent=0), encoding="utf-8")
    cm = {c["code"]: c["hex"] for c in pattern["colors"]}; s = 14
    prev = Image.new("RGB", (cols * s, rows * s)); d = ImageDraw.Draw(prev)
    for y, r in enumerate(pattern["grid"]):
        for x, ch in enumerate(r): d.rectangle([x * s, y * s, x * s + s - 1, y * s + s - 1], fill=cm[ch], outline="#cccccc")
    prev.save(Path(a.out).with_suffix(".png"))
    print(f"{cols} x {rows}, {len(colors)} colors: " + ", ".join(f"{c['name']} {c['hex']}" for c in pattern["colors"]))


if __name__ == "__main__":
    main()
