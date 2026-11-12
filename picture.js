// Turns a picture into a color grid. Pure functions on pixel data (no DOM), so they can be tested.

// Average color of each square. px: RGBA bytes of the cropped picture drawn at W*S x H*S pixels.
// Transparent pixels count as white.
function cellColors(px, W, H, S) {
  const out = [], rowLen = W * S * 4;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < S; dy++) {
      let i = (y * S + dy) * rowLen + x * S * 4;
      for (let dx = 0; dx < S; dx++, i += 4) {
        const a = px[i + 3] / 255, w = 255 * (1 - a);
        r += px[i] * a + w; g += px[i + 1] * a + w; b += px[i + 2] * a + w;
      }
    }
    const n = S * S; out.push([r / n, g / n, b / n]);
  }
  return out;
}

// OKLab: distances in it match how different two colors look.
function toLab([r, g, b]) {
  const lin = c => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
          1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
          0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
const labDist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const toHex = ([r, g, b]) => "#" + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

// Group the squares' colors into k yarn colors (k-means in OKLab, same answer every time).
// Returns { labels: color index per square, palette: [[r,g,b]] }.
function quantize(rgbs, k) {
  const pts = rgbs.map(toLab), n = pts.length;
  let seed = 12345; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const cents = [pts[Math.floor(rnd() * n)]];
  const near = pts.map(p => labDist2(p, cents[0]));
  while (cents.length < k) {            // k-means++: spread the starting colors out
    const sum = near.reduce((a, b) => a + b, 0);
    if (sum < 1e-9) break;              // fewer distinct colors than asked for
    let r = rnd() * sum, i = 0;
    while (i < n - 1 && (r -= near[i]) > 0) i++;
    cents.push(pts[i]);
    for (let j = 0; j < n; j++) near[j] = Math.min(near[j], labDist2(pts[j], pts[i]));
  }
  const labels = new Array(n).fill(-1);
  for (let iter = 0; iter < 30; iter++) {
    let moved = 0;
    for (let j = 0; j < n; j++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < cents.length; c++) { const d = labDist2(pts[j], cents[c]); if (d < bd) { bd = d; best = c; } }
      if (labels[j] !== best) { labels[j] = best; moved++; }
    }
    if (!moved) break;
    const sums = cents.map(() => [0, 0, 0, 0]);
    for (let j = 0; j < n; j++) { const s = sums[labels[j]]; s[0] += pts[j][0]; s[1] += pts[j][1]; s[2] += pts[j][2]; s[3]++; }
    sums.forEach((s, c) => { if (s[3]) cents[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const sums = cents.map(() => [0, 0, 0, 0]);
  for (let j = 0; j < n; j++) { const s = sums[labels[j]]; s[0] += rgbs[j][0]; s[1] += rgbs[j][1]; s[2] += rgbs[j][2]; s[3]++; }
  return { labels, palette: sums.map(s => s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : null) };
}

// A square whose 8 neighbors are all other colors becomes the most common neighbor color.
function tidy(labels, W, H) {
  const out = labels.slice();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const me = labels[y * W + x], count = {};
    let same = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const yy = y + dy, xx = x + dx;
      if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
      const l = labels[yy * W + xx];
      if (l === me) { same = true; break; }
      count[l] = (count[l] || 0) + 1;
    }
    if (!same) out[y * W + x] = +Object.keys(count).sort((a, b) => count[b] - count[a])[0];
  }
  return out;
}

// Rough everyday name for a yarn color, e.g. "Dark blue", "Pale pink", "Light gray".
function colorName(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  if (l < 0.12) return "Black";
  if (l > 0.92 && s < 0.5) return "White";
  if (s < 0.12) return l < 0.3 ? "Charcoal" : l < 0.62 ? "Gray" : "Light gray";
  let base = h < 15 || h >= 340 ? "red" : h < 40 ? "orange" : h < 65 ? "yellow" : h < 90 ? "lime green"
    : h < 160 ? "green" : h < 195 ? "teal" : h < 255 ? "blue" : h < 290 ? "purple" : "pink";
  if ((base === "orange" || base === "red" || base === "yellow") && l < 0.42 && s < 0.75) base = "brown";
  else if ((base === "orange" || base === "yellow") && l > 0.6 && s < 0.5) base = "tan";
  else if ((base === "yellow" || base === "lime green") && l < 0.42 && s < 0.6) return "Olive green";
  const prefix = l < 0.3 ? "dark " : l > 0.78 && s < 0.6 ? "pale " : l > 0.62 ? "light " : "";
  const name = prefix + base;
  return name[0].toUpperCase() + name.slice(1);
}

// Everything together: square colors -> a pattern grid with lettered colors, most-used color first.
// Returns { grid: [strings, top row first], colors: [{code, name, hex, count}] }.
function makeGrid(rgbs, W, H, k, opts = {}) {
  let { labels, palette } = quantize(rgbs, k);
  if (opts.tidy) labels = tidy(labels, W, H);
  const counts = palette.map(() => 0);
  labels.forEach(l => counts[l]++);
  const order = palette.map((_, i) => i).filter(i => counts[i] > 0).sort((a, b) => counts[b] - counts[a]);
  const CODES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const code = {}; order.forEach((i, n) => code[i] = CODES[n]);
  const grid = [];
  for (let y = 0; y < H; y++) { let row = ""; for (let x = 0; x < W; x++) row += code[labels[y * W + x]]; grid.push(row); }
  const used = {};
  const colors = order.map(i => {
    const hex = toHex(palette[i]);
    let name = colorName(hex);
    used[name] = (used[name] || 0) + 1;
    if (used[name] > 1) name += " " + used[name];
    return { code: code[i], name, hex, count: counts[i] };
  });
  return { grid, colors };
}

// Put a border of one color around a grid.
function addBorder(grid, size, code) {
  if (!size) return grid.slice();
  const W = grid[0].length + 2 * size, edge = code.repeat(size), full = code.repeat(W);
  return [...Array(size).fill(full), ...grid.map(r => edge + r + edge), ...Array(size).fill(full)];
}

if (typeof module !== "undefined") module.exports = { cellColors, toLab, labDist2, toHex, quantize, tidy, colorName, makeGrid, addBorder };
