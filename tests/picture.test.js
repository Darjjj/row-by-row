const fs = require("fs"), vm = require("vm"), path = require("path");
const dir = path.join(__dirname, ".."), ctx = { module: undefined };
vm.createContext(ctx);
for (const f of ["builtin.js", "picture.js"]) vm.runInContext(fs.readFileSync(path.join(dir, f), "utf8"), ctx);
const { readChart, addBorder, colorName, mergeDown, misfit, nudgeGrid, refineGrid } =
  vm.runInContext("({ readChart, addBorder, colorName, mergeDown, misfit, nudgeGrid, refineGrid })", ctx);
const P = vm.runInContext("BUILTIN_PATTERNS[0]", ctx);
let fails = 0; const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fails++; };

// Draw Monster Duo as pixel art, 6 px per square, then read it back with a grid over the whole picture.
const W = P.grid[0].length, H = P.grid.length, S = 6, hex = {};
P.colors.forEach(c => hex[c.code] = [1, 3, 5].map(i => parseInt(c.hex.slice(i, i + 2), 16)));
const px = new Uint8ClampedArray(W * S * H * S * 4);
for (let y = 0; y < H * S; y++) for (let x = 0; x < W * S; x++) {
  const [r, g, b] = hex[P.grid[Math.floor(y / S)][Math.floor(x / S)]], i = (y * W * S + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
}
const t0 = Date.now();
const whole = { x0: 0, x1: W * S, y0: 0, y1: H * S, cols: W, rows: H };
const out = readChart(px, W * S, whole, 10);
console.log(`     (${W}x${H}, 10 colors in ${Date.now() - t0} ms)`);
// Same picture up to letter names: every original color maps to exactly one new letter.
const map = {}, back = {}; let same = true;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const a = P.grid[y][x], b = out.grid[y][x];
  if ((map[a] && map[a] !== b) || (back[b] && back[b] !== a)) same = false;
  map[a] = b; back[b] = a;
}
ok(same && out.colors.length === 10, "Monster Duo picture comes back square for square with 10 colors");
ok(out.colors[0].code === "A" && out.colors.every((c, i) => !i || c.count <= out.colors[i - 1].count), "most-used color is A, then by count");
const names = out.colors.map(c => c.name);
ok(new Set(names).size === names.length, "color names are unique: " + names.join(", "));

// Fewer colors than asked for, and a limit below its own count
ok(readChart(px, W * S, whole, 12).colors.length === 10, "allowing 12 colors from a 10-color picture gives 10");
ok(readChart(px, W * S, whole, 6).colors.length === 6, "a 6-color limit gives 6");

// Grid self-check: the right grid has solid squares; a broken one gets corrected back.
ok(misfit(px, W * S, whole) === 0, "the right grid scores 0 (every square solid)");
const shifted = nudgeGrid(nudgeGrid(whole, "cols+", W * S, H * S), "rows-", W * S, H * S);
const fixed = refineGrid(px, W * S, H * S, shifted);
ok(fixed.cols === W && fixed.rows === H, `a grid with one column too many and one row too few is corrected (${fixed.cols} x ${fixed.rows})`);

// Border
const g = addBorder(["BC", "DE"], 1, "A");
ok(g.join("/") === "AAAA/ABCA/ADEA/AAAA", "1-square border goes all the way around");
ok(addBorder(["BC"], 0, "A").join("") === "BC", "no border leaves it alone");

ok(colorName("#2d2d2d") === "Charcoal" || colorName("#2d2d2d") === "Black", "dark gray reads as black/charcoal: " + colorName("#2d2d2d"));
ok(colorName("#4f8ccd") === "Blue", "blue: " + colorName("#4f8ccd"));
ok(colorName("#fafafa") === "White", "white");
ok(/green/i.test(colorName("#6cb616")), "lime: " + colorName("#6cb616"));
ok(/purple/i.test(colorName("#76509e")), "purple: " + colorName("#76509e"));
ok(/brown/i.test(colorName("#7a4a22")), "brown: " + colorName("#7a4a22"));
// Blocky pictures: a small, clearly different color (12 blue squares) survives; k-means tends to lose it.
{
  const rg = [], add = (c, n) => { for (let i = 0; i < n; i++) rg.push(c.map(v => v + (i % 7) - 3)); };
  add([110, 110, 110], 1300); add([110, 180, 60], 600); add([20, 20, 20], 400); add([230, 40, 40], 270);
  add([140, 25, 25], 130); add([130, 70, 20], 150); add([250, 190, 40], 120); add([45, 30, 20], 80); add([40, 120, 220], 12);
  const blueIn = r => r.palette.some(c => c && c[2] > 180 && c[0] < 90);
  ok(blueIn(mergeDown(rg, 8)), "mergeDown keeps 12 blue squares at 8 colors");
  const r6 = mergeDown(rg, 6);
  ok(r6.palette.filter(Boolean).length === 6, "mergeDown gives exactly the colors asked for");
}
ok(colorName("#8b1a1a") === "Dark red", "dark red is not brown: " + colorName("#8b1a1a"));
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
