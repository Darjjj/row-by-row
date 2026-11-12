// Turns a color grid into crochet steps. Pure functions, no DOM.
// grid: array of strings, grid[0] is the TOP row, each char is a color code.

function makeRuns(seq) {
  const runs = [];
  for (const k of seq) {
    const last = runs[runs.length - 1];
    if (last && last.k === k) last.n++; else runs.push({ k, n: 1 });
  }
  return runs;
}

// Single crochet worked in rows, bottom to top.
// Right-handed: odd rows (right side) read right to left. Left-handed: the reverse.
function rowSteps(grid, hand) {
  const H = grid.length, W = grid[0].length, steps = [];
  for (let n = 1; n <= H; n++) {
    const r = H - n;                                   // 0-based chart row from the top
    const odd = n % 2 === 1;
    const rightToLeft = hand === "left" ? !odd : odd;
    const cols = [...Array(W).keys()];
    if (rightToLeft) cols.reverse();
    const cells = cols.map(c => [r, c]);
    const seq = cells.map(([y, x]) => grid[y][x]);
    steps.push({
      n, count: W, cells, seq, runs: makeRuns(seq),
      side: odd ? "Right side" : "Wrong side",
      direction: rightToLeft ? "work right to left" : "work left to right",
      shaping: n === 1 ? `Chain ${W + 1}. Sc in 2nd ch from hook and across.` : `Ch 1, turn. ${W} sc across.`,
      unit: "st"
    });
  }
  return steps;
}

// Corner to corner, starting bottom right and finishing top left.
// i = rows up from the bottom, j = columns in from the right. Diagonal d holds every square with i + j = d - 1.
function c2cSteps(grid) {
  const H = grid.length, W = grid[0].length, total = W + H - 1, steps = [];
  const lower = d => (d <= W ? "bottom" : "left");
  const upper = d => (d <= H ? "right" : "top");
  const grows = (edge, d) => (edge === "bottom" && d <= W) || (edge === "right" && d <= H);
  for (let d = 1; d <= total; d++) {
    let ij = [];
    for (let i = 0; i < H; i++) { const j = d - 1 - i; if (j >= 0 && j < W) ij.push([i, j]); }   // lower end first
    const odd = d % 2 === 1;
    if (odd) ij.reverse();                               // odd rows start at the upper end
    const start = odd ? upper(d) : lower(d), end = odd ? lower(d) : upper(d);
    const cells = ij.map(([i, j]) => [H - 1 - i, W - 1 - j]);
    const seq = cells.map(([y, x]) => grid[y][x]);
    let shaping;
    if (d === 1) shaping = "Ch 6, dc in 4th ch from hook and next 2 ch.";
    else {
      const s = grows(start, d) ? "Increase" : "Decrease", e = grows(end, d) ? "increase" : "decrease";
      shaping = s.toLowerCase() === e ? `${s} at both ends.` : `${s} at start, ${e} at end.`;
    }
    steps.push({ n: d, count: cells.length, cells, seq, runs: makeRuns(seq),
      side: null, direction: `${start} edge to ${end} edge`, shaping, start, end, unit: "block" });
  }
  return steps;
}

function buildSteps(pattern, mode, hand) {
  return mode === "c2c" ? c2cSteps(pattern.grid) : rowSteps(pattern.grid, hand);
}

// Independent check: put every step's written colors back on the chart and compare.
function verifySteps(grid, steps) {
  const H = grid.length, W = grid[0].length;
  const out = grid.map(r => Array(W).fill(null));
  for (const s of steps) {
    const seq = s.runs.flatMap(r => Array(r.n).fill(r.k));
    if (seq.length !== s.cells.length) return false;
    s.cells.forEach(([y, x], i) => { if (out[y][x] !== null) throw new Error("square used twice"); out[y][x] = seq[i]; });
  }
  return out.every((row, y) => row.join("") === grid[y]);
}

if (typeof module !== "undefined") module.exports = { makeRuns, rowSteps, c2cSteps, buildSteps, verifySteps };
