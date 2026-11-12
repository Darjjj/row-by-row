const fs = require("fs"), vm = require("vm"), path = require("path");
const dir = path.join(__dirname, ".."), ctx = { module: undefined };
vm.createContext(ctx);
for (const f of ["builtin.js", "picture.js"]) vm.runInContext(fs.readFileSync(path.join(dir, f), "utf8"), ctx);
const { cellColors, makeGrid, addBorder, colorName, tidy } = vm.runInContext("({ cellColors, makeGrid, addBorder, colorName, tidy })", ctx);
const P = vm.runInContext("BUILTIN_PATTERNS[0]", ctx);
let fails = 0; const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fails++; };

// Draw Monster Duo as an image, 6 px per square, then turn it back into a pattern.
const W = P.grid[0].length, H = P.grid.length, S = 6, hex = {};
P.colors.forEach(c => hex[c.code] = [1, 3, 5].map(i => parseInt(c.hex.slice(i, i + 2), 16)));
const px = new Uint8ClampedArray(W * S * H * S * 4);
for (let y = 0; y < H * S; y++) for (let x = 0; x < W * S; x++) {
  const [r, g, b] = hex[P.grid[Math.floor(y / S)][Math.floor(x / S)]], i = (y * W * S + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
}
const t0 = Date.now();
const out = makeGrid(cellColors(px, W, H, S), W, H, 10, { tidy: false });
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

// Fewer colors than asked for
const two = makeGrid(cellColors(px, W, H, S), W, H, 12, { tidy: false });
ok(two.colors.length === 10, "asking for 12 colors from a 10-color picture gives 10");

// Tidy removes a lone square but keeps a pair
const L = [0,0,0,0, 0,1,0,0, 0,0,0,2, 0,0,0,2];
const T = tidy(L, 4, 4);
ok(T[5] === 0 && T[11] === 2 && T[15] === 2, "tidy removes a lone square, keeps a pair");

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
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
