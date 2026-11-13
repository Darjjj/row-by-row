// Chart reading against the real Monster Duo chart image, plus synthetic charts and a non-chart.
const fs = require("fs"), vm = require("vm"), path = require("path");
// Needs the chart image exported as raw RGBA (see tests/export-chart.py) next to this file.
const repo = path.join(__dirname, ".."), S = __dirname, ctx = { module: undefined };
vm.createContext(ctx);
for (const f of ["builtin.js", "picture.js"]) vm.runInContext(fs.readFileSync(path.join(repo, f), "utf8"), ctx);
const { detectGrid, readChart, analyzePicture, nudgeGrid, refineGrid } = vm.runInContext("({ detectGrid, readChart, analyzePicture, nudgeGrid, refineGrid })", ctx);
const P = vm.runInContext("BUILTIN_PATTERNS[0]", ctx);
let fails = 0; const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fails++; };
const sameUpToLetters = (a, b) => {
  if (a.length !== b.length || a[0].length !== b[0].length) return false;
  const f = {}, r = {};
  for (let y = 0; y < a.length; y++) for (let x = 0; x < a[0].length; x++) {
    const p = a[y][x], q = b[y][x];
    if ((f[p] && f[p] !== q) || (r[q] && r[q] !== p)) return false; f[p] = q; r[q] = p;
  }
  return true;
};
// The chart image is 49 x 60: Monster Duo (no border) fills the top 55 rows, the last 5 are empty background.
const picture = P.grid.slice(2, 57).map(r => r.slice(1, 50)).concat(Array(5).fill("A".repeat(49)));

for (const [name, w, h] of [["full", 1497, 1567], ["half", 748, 784], ["small", 494, 517]]) {
  const px = new Uint8ClampedArray(fs.readFileSync(path.join(S, `chart-${name}.rgba`)));
  const t0 = Date.now(), g = detectGrid(px, w, h), ms = Date.now() - t0;
  ok(g && g.cols === 49 && g.rows === 60, `${name} chart image: found ${g ? g.cols + " x " + g.rows : "nothing"} (contrast ${g ? g.contrast.toFixed(1) : "-"}, ${ms} ms)`);
  if (!g) continue;
  const out = readChart(px, w, g);
  ok(sameUpToLetters(out.grid, picture), `${name}: every square matches Monster Duo (${out.colors.length} colors: ${out.colors.map(c => c.name).join(", ")})`);
  if (name === "full") {   // the self-check leaves the right grid alone and corrects broken ones back
    const same = (a, b) => a.cols === b.cols && a.rows === b.rows && Math.abs(a.x0 - b.x0) < 3 && Math.abs(a.y0 - b.y0) < 3;
    ok(same(refineGrid(px, w, h, g), g), "self-check leaves the found grid alone");
    for (const acts of [["left-out"], ["cols+"], ["rows-"], ["cols-", "rows+"]]) {
      let b = g; for (const a of acts) b = nudgeGrid(b, a, w, h);
      ok(same(refineGrid(px, w, h, b), g), `self-check corrects a grid broken by ${acts.join(" + ")}`);
    }
  }
}

// Synthetic: draw a grid as a chart image at an awkward square size, with or without grid lines, and margins.
function draw(grid, cell, opts) {
  const m = opts.margin || 0, W = grid[0].length, H = grid.length;
  const w = Math.round(W * cell + 2 * m), h = Math.round(H * cell + 2 * m), px = new Uint8ClampedArray(w * h * 4).fill(255);
  const hex = {}; P.colors.forEach(c => hex[c.code] = [1, 3, 5].map(i => parseInt(c.hex.slice(i, i + 2), 16)));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const cx = (x - m) / cell, cy = (y - m) / cell, i = (y * w + x) * 4;
    let col = [255, 255, 255];
    if (cx >= 0 && cy >= 0 && cx < W && cy < H) {
      col = hex[grid[Math.floor(cy)][Math.floor(cx)]];
      const lw = c => opts.bold && Math.floor(c) % 10 === 0 ? 3 : 1;   // thicker line every 10 squares
      if (opts.lines && (cx % 1 < lw(cx) / cell || cy % 1 < lw(cy) / cell)) col = [90, 90, 90];
    }
    if (opts.frame && (Math.abs(x - m) < 3 || Math.abs(y - m) < 3 || Math.abs(x - (m + W * cell)) < 3 || Math.abs(y - (m + H * cell)) < 3)
        && x >= m - 3 && y >= m - 3 && x <= m + W * cell + 3 && y <= m + H * cell + 3) col = [0, 0, 0];
    if (opts.noise) col = col.map(v => v + (Math.random() - 0.5) * opts.noise);
    px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = 255;
  }
  return { px, w, h };
}
for (const [label, cell, opts] of [["lines, 13.7 px squares, margins", 13.7, { lines: true, margin: 40 }],
                                   ["lines, 9.3 px squares, JPEG-like noise", 9.3, { lines: true, margin: 20, noise: 18 }],
                                   ["bold line every 10 + thick frame, 11.2 px squares", 11.2, { lines: true, bold: true, frame: true, margin: 30 }],
                                   ["no lines (pixel art), 8 px squares", 8, { margin: 0 }],
                                   ["tiny pixel art, 1 px per square", 1, { margin: 0 }]]) {
  const { px, w, h } = draw(P.grid, cell, opts), g = detectGrid(px, w, h);
  const out = g && readChart(px, w, g);
  ok(g && g.cols === 51 && g.rows === 60 && sameUpToLetters(out.grid, P.grid), `${label}: ${g ? g.cols + " x " + g.rows : "not found"}${out ? ", " + out.colors.length + " colors" : ""}`);
}

// Uneven pixel art (like AI-made images): blocks of 20-24 px, some half size. Not a chart, but sized to its blocks.
{
  const hex = {}; P.colors.forEach(c => hex[c.code] = [1, 3, 5].map(i => parseInt(c.hex.slice(i, i + 2), 16)));
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const edges = n => { const e = [0]; for (let i = 0; i < n; i++) e.push(e[e.length - 1] + (rnd() < 0.15 ? 11 : 20 + Math.floor(rnd() * 5))); return e; };
  const ex = edges(51), ey = edges(60), w = ex[51], h = ey[60], px = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < 60; r++) for (let c = 0; c < 51; c++) for (let y = ey[r]; y < ey[r + 1]; y++) for (let x = ex[c]; x < ex[c + 1]; x++) {
    const i = (y * w + x) * 4, col = hex[P.grid[r][c]]; px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = 255;
  }
  const a = analyzePicture(px, w, h);
  ok(!a.grid && a.pixel && Math.abs(w / a.pixel - 51) <= 6, `uneven pixel art: not a chart, sized ${a.pixel ? Math.round(w / a.pixel) + " x " + Math.round(h / a.pixel) : "-"} (drawn 51 x 60)`);
}

// Not a chart: smooth shapes and noise, like a photo.
{
  const w = 800, h = 600, px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, v = 128 + 80 * Math.sin(x / 47) * Math.cos(y / 31) + (Math.random() - 0.5) * 30;
    px[i] = v; px[i + 1] = 255 - v; px[i + 2] = 100 + 60 * Math.sin((x + y) / 90); px[i + 3] = 255;
  }
  const g = detectGrid(px, w, h);
  ok(!g, `photo-like picture is not mistaken for a chart${g ? " (found " + g.cols + "x" + g.rows + ")" : ""}`);
}
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
