"""Write library-data.js (the ready-made patterns) from chart pattern JSON files.

Each entry in the list file is: <group> | <name> | <path to chart JSON from tools/art_to_pattern.py>
Lines starting with # are skipped. Every design must have even rows and 6 to 10 colors (what she likes to work with).

  python tools/build_library.py library.txt
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if len(sys.argv) < 2: sys.exit(__doc__)
def nice(c):   # a background that is a hair off white still reads as white yarn
    rgb = [int(c["hex"][i:i + 2], 16) for i in (1, 3, 5)]
    return "White" if min(rgb) >= 240 else c["name"]


items = []
for line in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    if not line.strip() or line.lstrip().startswith("#"): continue
    group, name, path = [s.strip() for s in line.split("|")]
    p = json.loads(Path(path).read_text(encoding="utf-8"))
    codes = {c["code"] for c in p["colors"]}
    assert 6 <= len(codes) <= 10, f"{name}: {len(codes)} colors"
    assert len({len(r) for r in p["grid"]}) == 1 and all(set(r) <= codes for r in p["grid"]), f"{name}: uneven rows or unknown colors"
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    items.append({"id": f"lib-{slug}", "name": name, "group": group, "grid": p["grid"],
                  "colors": [{"code": c["code"], "name": nice(c), "hex": c["hex"]} for c in p["colors"]]})
ids = [it["id"] for it in items]
assert len(ids) == len(set(ids)), "two designs with the same name"
body = ",\n".join(json.dumps(it, ensure_ascii=False, separators=(",", ":")) for it in items)
(ROOT / "library-data.js").write_text("// Ready-made patterns (written by tools/build_library.py; don't edit by hand).\n"
                                      f"const LIBRARY = [\n{body}\n];\n", encoding="utf-8", newline="\n")
print(f"{len(items)} designs, {(ROOT / 'library-data.js').stat().st_size // 1024} KB")
