// Turns a picture into a color grid. Pure functions on pixel data (no DOM), so they can be tested.

// Average color of each square. px: RGBA bytes of the cropped picture drawn at W*S x H*S pixels.
// Transparent pixels count as white. median: use each square's middle color instead, which keeps
// blocky pictures from turning their blurry edges into extra in-between shades.
function cellColors(px, W, H, S, median) {
  const out = [], rowLen = W * S * 4;
  if (median) {
    const g = { x0: 0, x1: W * S, y0: 0, y1: H * S, cols: W, rows: H };
    return chartCells(px, W * S, g);
  }
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
  if ((base === "orange" || base === "yellow") && l < 0.42 && s < 0.75) base = "brown";
  else if ((base === "orange" || base === "yellow") && l > 0.6 && s < 0.5) base = "tan";
  else if ((base === "yellow" || base === "lime green") && l < 0.42 && s < 0.6) return "Olive green";
  const prefix = l < 0.35 ? "dark " : l > 0.78 && s < 0.6 ? "pale " : l > 0.62 ? "light " : "";
  const name = prefix + base;
  return name[0].toUpperCase() + name.slice(1);
}

// Two colors that would look like the same yarn: very close, or both dark and fairly close
// (dark shades are hard to tell apart). Monster Duo's closest real pair is 0.088 apart, so 0.075 keeps it intact.
const CLOSE = 0.075, CLOSE_DARK = 0.11;
function sameYarn(a, b) { const d = Math.sqrt(labDist2(a, b)); return d < CLOSE || (a[0] < 0.4 && b[0] < 0.4 && d < CLOSE_DARK); }

// Turn starting color groups into the final yarns: first combine every pair that would look like the same yarn,
// then, if there are still more than k, keep merging the cheapest pair by Ward's rule (closeness weighted by size),
// so specks of a few squares are absorbed first and a small but clearly different color (an eye, a badge) survives.
// init: { labels, palette } to start from; default: the picture's own distinct colors.
// Returns { labels, palette, distinct: how many yarns before the k limit }.
function mergeDown(rgbs, k, init) {
  const g = init || groupColors(rgbs, 0.05);
  const slot = {};
  let groups = [];
  g.palette.forEach((c, i) => { if (c) { slot[i] = groups.length; groups.push({ lab: toLab(c), n: 0, ids: [i] }); } });
  g.labels.forEach(l => groups[slot[l]].n++);
  groups = groups.filter(x => x.n);
  const join = (a, b) => {
    const A = groups[a], B = groups[b], n = A.n + B.n;
    A.lab = A.lab.map((v, t) => (v * A.n + B.lab[t] * B.n) / n); A.n = n; A.ids.push(...B.ids);
    groups.splice(b, 1);
  };
  const cheapest = cost => {
    let a = -1, b = -1, best = Infinity;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const c = cost(groups[i], groups[j]); if (c < best) { best = c; a = i; b = j; }
    }
    return [a, b, best];
  };
  for (;;) {                                   // 1. same-looking yarns become one, closest first
    const [a, b, d] = cheapest((A, B) => sameYarn(A.lab, B.lab) ? labDist2(A.lab, B.lab) : Infinity);
    if (d === Infinity) break;
    join(a, b);
  }
  const distinct = groups.length;
  while (groups.length > k) {                  // 2. down to k by Ward's rule
    const [a, b] = cheapest((A, B) => labDist2(A.lab, B.lab) * A.n * B.n / (A.n + B.n));
    join(a, b);
  }
  const of = {}; groups.forEach((x, gi) => x.ids.forEach(i => of[i] = gi));
  const labels = g.labels.map(l => of[l]);
  const sums = groups.map(() => [0, 0, 0, 0]);
  rgbs.forEach((c, j) => { const s = sums[labels[j]]; s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; s[3]++; });
  return { labels, palette: sums.map(s => s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : null), distinct };
}

// Everything together: square colors -> a pattern grid with lettered colors, most-used color first.
// Returns { grid: [strings, top row first], colors: [{code, name, hex, count}] }.
function makeGrid(rgbs, W, H, k, opts = {}) {
  let { labels, palette, distinct } = mergeDown(rgbs, k, opts.blocky ? undefined : quantize(rgbs, k));
  if (opts.tidy) labels = tidy(labels, W, H);
  return { ...letterGrid(labels, palette, W, H), distinct };
}

// Color index per square + palette -> lettered grid and named colors, most-used color first.
const CODES = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function letterGrid(labels, palette, W, H) {
  const counts = palette.map(() => 0);
  labels.forEach(l => counts[l]++);
  const order = palette.map((_, i) => i).filter(i => counts[i] > 0).sort((a, b) => counts[b] - counts[a]);
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

// ---------- reading a ready-made chart ----------
// A chart gives itself away by repeating: grid lines and color changes fall every square, evenly spaced.

// Total color change between each column and the next (gx), and each row and the next (gy).
function edgeProfiles(px, w, h) {
  const gx = new Float64Array(w), gy = new Float64Array(h), row = w * 4;
  for (let y = 0; y < h; y++) for (let x = 0, i = y * row; x < w; x++, i += 4) {
    if (x + 1 < w) gx[x] += Math.abs(px[i] - px[i + 4]) + Math.abs(px[i + 1] - px[i + 5]) + Math.abs(px[i + 2] - px[i + 6]);
    if (y + 1 < h) gy[y] += Math.abs(px[i] - px[i + row]) + Math.abs(px[i + 1] - px[i + row + 1]) + Math.abs(px[i + 2] - px[i + row + 2]);
  }
  return { gx, gy };
}

// The evenly spaced comb along one direction: spacing p and offset ph of its teeth, or null.
function lineComb(prof) {
  const n = prof.length;
  const s = Float64Array.from(prof, (v, i) => 0.5 * (prof[i - 1] || 0) + v + 0.5 * (prof[i + 1] || 0));
  const at = x => { const i = Math.round(x); return Math.max(s[i - 1] || 0, s[i] || 0, s[i + 1] || 0); };
  let mean = 0; s.forEach(v => mean += v); mean /= n;
  // Rough spacing: the strongest repeat (autocorrelation peak), preferring the smallest one
  // that repeats about as strongly, since twice the spacing also repeats.
  const maxLag = Math.floor(n / 6), ac = new Float64Array(maxLag + 2);
  for (let lag = 4; lag <= maxLag + 1; lag++) {
    let t = 0; for (let i = 0; i + lag < n; i++) t += (s[i] - mean) * (s[i + lag] - mean);
    ac[lag] = t / (n - lag);
  }
  const peaks = [];
  for (let lag = 5; lag <= maxLag; lag++) if (ac[lag] > 0 && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) peaks.push(lag);
  if (!peaks.length) return null;
  const top = peaks.reduce((a, b) => ac[b] > ac[a] ? b : a);
  const p0 = peaks.find(l => ac[l] >= 0.6 * ac[top] && Math.abs(top / l - Math.round(top / l)) < 0.12) || top;
  // Exact spacing and offset: the comb that lands on the most change.
  let best = { score: -1 };
  for (let p = p0 - 1; p <= p0 + 1; p += 0.02) for (let ph = 0; ph < p; ph += 0.5) {
    let t = 0, k = 0; for (let x = ph; x < n; x += p, k++) t += at(x);
    if (t / k > best.score) best = { score: t / k, p, ph };
  }
  const { p, ph } = best, pos = [], T = [], M = [];
  for (let x = ph; x < n; x += p) { pos.push(x); T.push(at(x)); M.push(at(x + p / 2)); }
  // Each tooth: 2 = a line (stands out from the middles of the squares beside it),
  // 1 = nothing there, 0 = something else (numbers in the margin, a photo...).
  const sorted = T.slice().sort((a, b) => a - b), floor = 0.12 * sorted[Math.floor(sorted.length * 0.75)];
  const state = T.map((t, k) => {
    const mid = Math.min(M[k] ?? Infinity, M[k - 1] ?? Infinity);   // the quieter side: the inside of the grid
    return t > 1.8 * mid && t > floor ? 2 : t <= floor && mid <= floor ? 1 : 0;
  });
  // The grid: the longest run of lines, allowing short stretches of nothing (or one odd tooth) inside.
  let span = null, first = -1, last = -1, empty = 0, odd = 0;
  const close = () => { if (first >= 0 && (!span || last - first > span[1] - span[0])) span = [first, last]; first = -1; };
  state.forEach((v, k) => {
    if (v === 2) { if (first < 0) first = k; last = k; empty = odd = 0; }
    else if (first >= 0 && (v === 1 ? ++empty > 8 : ++odd > 1)) { close(); empty = odd = 0; }
  });
  close();
  if (!span || span[1] - span[0] < 4) return null;
  return { s, at, p, pos, state, span };
}

// Exact line positions: a straight-line fit through the real peak of each line in the span.
function fitLines(c) {
  let sk = 0, sx = 0, skk = 0, skx = 0, m = 0;
  const r = Math.max(1, Math.round(c.p * 0.25));
  for (let k = c.span[0]; k <= c.span[1]; k++) {
    if (c.state[k] !== 2) continue;
    let wsum = 0, xsum = 0;
    for (let x = Math.round(c.pos[k]) - r; x <= Math.round(c.pos[k]) + r; x++) if (x >= 0 && x < c.s.length) { wsum += c.s[x]; xsum += c.s[x] * x; }
    if (!wsum) continue;
    const xc = xsum / wsum; sk += k; sx += xc; skk += k * k; skx += k * xc; m++;
  }
  const size = (m * skx - sk * sx) / (m * skk - sk * sk), a = (sx - size * sk) / m;
  let on = 0, mid = 0;
  for (let k = c.span[0]; k <= c.span[1]; k++) { on += c.at(a + k * size); if (k < c.span[1]) mid += c.at(a + (k + 0.5) * size); }
  const count = c.span[1] - c.span[0];
  return { start: a + c.span[0] * size, size, count, contrast: (on / (count + 1)) / (mid / count + 1e-9) };
}

// The chart's grid in picture pixels, or null if this doesn't look like a chart.
function detectGrid(px, w, h) { return analyzePicture(px, w, h).grid; }

// { grid: the chart's grid or null, pixel: the size of its blocks if it looks like (uneven) pixel art, else null }.
function analyzePicture(px, w, h) {
  const res = analyze(px, w, h);
  return res && res.x0 !== undefined ? { grid: res, pixel: null } : { grid: null, pixel: res ? res.pixel : null };
}

function analyze(px, w, h) {
  // A small file with few colors is pixel art at one pixel per square.
  if (w <= 200 && h <= 200 && w >= 8 && h >= 8) {
    const seen = new Set();
    for (let i = 0; i < w * h * 4 && seen.size <= 40; i += 4) seen.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
    if (seen.size <= 40) return { x0: 0, x1: w, y0: 0, y1: h, cols: w, rows: h, contrast: Infinity };
  }
  const { gx, gy } = edgeProfiles(px, w, h);
  const X = lineComb(gx), Y = lineComb(gy);
  if (!X || !Y) return null;
  // A real column has the grid's horizontal lines running through it (and a real row, the vertical lines).
  // That trims a frame or a margin of numbers that happens to line up with the grid.
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2];
  const g = (x, y) => gray[clampI(y, h) * w + clampI(x, w)];
  // A thin drawn line: darker (or lighter) than the picture on BOTH sides of it. A plain color change
  // between two squares is only different on one side, so it doesn't count.
  const thin = (c, a, b) => Math.max(0, Math.min(c - a, c - b)) + Math.max(0, Math.min(a - c, b - c));
  const ridge = (x, y, across) => {   // strongest thin line within a pixel of (x, y), running across or along
    let best = 0;
    for (let d = -1; d <= 1; d++) for (const o of [2, 3]) best = Math.max(best, across
      ? thin(g(x, y + d), g(x, y + d - o), g(x, y + d + o))
      : thin(g(x + d, y), g(x + d - o, y), g(x + d + o, y)));
    return best;
  };
  const linesOf = c => c.pos.filter((_, k) => k >= c.span[0] && k <= c.span[1] && c.state[k] === 2);
  function trim(c, other, across) {
    const lines = linesOf(other), half = other.p / 2;
    const strip = k => {             // line vs. square-middle strength of the other lines inside strip k
      let on = 0, mid = 0;
      for (let t = c.pos[k] + c.p / 4; t < c.pos[k + 1] - c.p / 4; t++) for (const L of lines) {
        const x = Math.round(t);
        on += across ? ridge(x, Math.round(L), true) : ridge(Math.round(L), x, false);
        mid += across ? ridge(x, Math.round(L + half), true) : ridge(Math.round(L + half), x, false);
      }
      return { on, mid };
    };
    const inner = [];
    for (let k = c.span[0]; k < c.span[1]; k++) inner.push(strip(k));
    const ratio = inner.map(s => s.on / (s.mid + 1)).sort((a, b) => a - b)[inner.length >> 1];
    if (ratio < 3) return false;     // no drawn grid lines (pixel art): nothing to check against
    const typical = inner.map(s => s.on).sort((a, b) => a - b)[inner.length >> 1];
    const real = k => { const s = strip(k); return s.on > 0.3 * typical && s.on > 1.5 * s.mid; };
    while (c.span[1] - c.span[0] > 8 && !real(c.span[0])) c.span[0]++;
    while (c.span[1] - c.span[0] > 8 && !real(c.span[1] - 1)) c.span[1]--;
    return true;
  }
  // Pixel art without grid lines: a plain background at the edges looks like nothing, so if the
  // squares divide the whole picture evenly, the whole picture is the grid.
  const fill = (f, n) => {
    const kL = Math.round(f.start / f.size), end = f.start + f.size * f.count, kR = Math.round((n - end) / f.size);
    if (kL > 0 && Math.abs(f.start - kL * f.size) < 0.3 * f.size) { f.start -= kL * f.size; f.count += kL; }
    if (kR > 0 && Math.abs(n - end - kR * f.size) < 0.3 * f.size) f.count += kR;
  };
  const Xspan = X.span.slice(), Yspan = Y.span.slice();
  const drawn = trim(X, { ...Y, span: Yspan }, true) & trim(Y, { ...X, span: Xspan }, false);
  const fx = fitLines(X), fy = fitLines(Y);
  if (!drawn) {
    // Without drawn lines, the even squares have to cover most of the picture. If they don't, the blocks
    // are uneven (AI-made "pixel art" often is): no exact reading, but their size is a good pattern size.
    const pixel = (X.p + Y.p) / 2, even = X.p / Y.p > 0.85 && X.p / Y.p < 1.18 && pixel >= 4;
    if (fx.count < 0.8 * w / fx.size || fy.count < 0.8 * h / fy.size) return { pixel: even ? pixel : null };
    fill(fx, w); fill(fy, h);
  }
  if (fx.count < 8 || fy.count < 8 || fx.count > 200 || fy.count > 200) return null;
  if (fx.size / fy.size < 0.7 || fx.size / fy.size > 1.43) return null;   // squares, roughly
  const contrast = Math.min(fx.contrast, fy.contrast);
  if (contrast < 2) return null;
  return { x0: fx.start, x1: fx.start + fx.size * fx.count, y0: fy.start, y1: fy.start + fy.size * fy.count, cols: fx.count, rows: fy.count, contrast };
}
const clampI = (v, n) => v < 0 ? 0 : v >= n ? n - 1 : v;

// The color of each square: the middle color of the inside of the square, away from the grid lines.
function chartCells(px, w, g) {
  const cw = (g.x1 - g.x0) / g.cols, ch = (g.y1 - g.y0) / g.rows, out = [];
  const mx = cw >= 4 ? Math.max(1, cw * 0.25) : 0, my = ch >= 4 ? Math.max(1, ch * 0.25) : 0, med = a => a.sort((p, q) => p - q)[a.length >> 1];
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const xa = Math.round(g.x0 + c * cw + mx), xb = Math.max(xa + 1, Math.round(g.x0 + (c + 1) * cw - mx));
    const ya = Math.round(g.y0 + r * ch + my), yb = Math.max(ya + 1, Math.round(g.y0 + (r + 1) * ch - my));
    const R = [], G = [], B = [];
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
      const i = (y * w + x) * 4, a = px[i + 3] / 255, wh = 255 * (1 - a);
      R.push(px[i] * a + wh); G.push(px[i + 1] * a + wh); B.push(px[i + 2] * a + wh);
    }
    out.push([med(R), med(G), med(B)]);
  }
  return out;
}

// Group square colors that are really the same yarn (JPEG noise, slight shading). No color count needed.
function groupColors(rgbs, T = 0.05) {
  const labs = rgbs.map(toLab);
  let cents = [];
  for (const l of labs) if (!cents.some(c => labDist2(l, c) < T * T)) cents.push(l);
  if (cents.length > CODES.length) cents = quantize(rgbs, CODES.length).palette.filter(Boolean).map(toLab);
  const labels = new Array(labs.length).fill(0);
  for (let iter = 0; iter < 6; iter++) {
    labs.forEach((l, j) => { let bd = Infinity; cents.forEach((c, i) => { const d = labDist2(l, c); if (d < bd) { bd = d; labels[j] = i; } }); });
    const sums = cents.map(() => [0, 0, 0, 0]);
    labs.forEach((l, j) => { const s = sums[labels[j]]; s[0] += l[0]; s[1] += l[1]; s[2] += l[2]; s[3]++; });
    cents = cents.map((c, i) => sums[i][3] ? [sums[i][0] / sums[i][3], sums[i][1] / sums[i][3], sums[i][2] / sums[i][3]] : c);
  }
  const sums = cents.map(() => [0, 0, 0, 0]);
  rgbs.forEach((c, j) => { const s = sums[labels[j]]; s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; s[3]++; });
  return { labels, palette: sums.map(s => s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : null) };
}

// A chart picture + its grid -> pattern grid and named colors.
// k: at most this many yarns (the closest are combined); same-looking shades are always combined.
function readChart(px, w, g, k = Infinity) {
  const { labels, palette, distinct } = mergeDown(chartCells(px, w, g), k);
  return { ...letterGrid(labels, palette, g.cols, g.rows), distinct };
}

// Put a border of one color around a grid.
function addBorder(grid, size, code) {
  if (!size) return grid.slice();
  const W = grid[0].length + 2 * size, edge = code.repeat(size), full = code.repeat(W);
  return [...Array(size).fill(full), ...grid.map(r => edge + r + edge), ...Array(size).fill(full)];
}

if (typeof module !== "undefined") module.exports = { cellColors, toLab, labDist2, toHex, quantize, mergeDown, sameYarn, tidy, colorName, makeGrid, letterGrid,
  edgeProfiles, lineComb, fitLines, detectGrid, analyzePicture, chartCells, groupColors, readChart, addBorder };
