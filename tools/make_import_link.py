"""Turn a pattern (JSON) into a Row by Row import link: a written pattern (kind "written", id "w-...")
or a chart pattern (kind "chart", id "c-...", grid = rows of color letters, colors = [{code, name, hex}], 10 at most).

The pattern travels after the "#", which browsers never send to the server, so GitHub Pages never sees it.
She opens the link on her phone and taps "Add to my patterns"; it then syncs to her other devices.
Sending an updated file's link later updates the pattern and keeps her place.

  python tools/make_import_link.py patterns-draft/very-hungry-caterpillar.json
  python tools/make_import_link.py file.json --base http://127.0.0.1:5178/     (for local testing)
"""
import base64, json, sys, zlib

args = [a for a in sys.argv[1:] if not a.startswith("--")]
base = sys.argv[sys.argv.index("--base") + 1] if "--base" in sys.argv else "https://darjjj.github.io/row-by-row/"
if "--base" in sys.argv: args.remove(base)
if not args: sys.exit(__doc__)

pattern = json.load(open(args[0], encoding="utf-8"))
kind, pid = pattern.get("kind"), pattern.get("id", "")
assert (kind == "written" and pid.startswith("w-")) or (kind == "chart" and pid.startswith("c-")), "not a written or chart pattern"
if kind == "chart":
    codes = {c["code"] for c in pattern["colors"]}
    assert len(codes) <= 10, "more than 10 colors"
    assert len({len(r) for r in pattern["grid"]}) == 1 and all(set(r) <= codes for r in pattern["grid"]), "uneven rows or unknown colors"
raw = json.dumps(pattern, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
c = zlib.compressobj(9, zlib.DEFLATED, -15)          # raw deflate, what the browser's DecompressionStream("deflate-raw") reads
code = base64.urlsafe_b64encode(c.compress(raw) + c.flush()).decode().rstrip("=")
print(f"{base}#import/{code}")
print(f"\n({len(raw):,} bytes of pattern -> {len(code):,} characters in the link)", file=sys.stderr)
