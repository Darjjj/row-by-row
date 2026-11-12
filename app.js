// Row by Row: follow a pixel crochet pattern one row at a time.
"use strict";

// ---------- saved data (on this device; sync.js copies it to the cloud when signed in) ----------
const STORE_KEY = "rowbyrow.v1";
let data = { settings: { scale: 1 }, prefs: {}, progress: {} };
try { Object.assign(data, JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); } catch (e) {}

// Every synced entry (a place in a pattern, a style choice, a note) carries t = when it last changed,
// so devices can tell whose copy is newest. Changes are detected in save(), so callers just call save().
const DEFAULTS = { progress: '{"step":0,"inrow":0}', prefs: '{"mode":"rows","hand":"right"}' };
const strip = o => { const { t, ...rest } = o; return JSON.stringify(rest); };
function syncedEntries() {
  const out = [];
  for (const sec of ["progress", "prefs"]) for (const k in data[sec]) out.push([sec, k, data[sec][k]]);
  (data.notes || []).forEach(n => out.push(["notes", String(n.id), n]));
  return out;
}
let snap = {};
function resnap() { snap = {}; syncedEntries().forEach(([s, k, o]) => snap[s + "/" + k] = strip(o)); }
resnap();
function stampChanges() {
  const now = Date.now();
  for (const [s, k, o] of syncedEntries()) {
    const id = s + "/" + k, cur = strip(o);
    if (snap[id] === cur) continue;
    const brandNewDefault = snap[id] === undefined && DEFAULTS[s] === cur;   // just created, nothing done yet
    if (!brandNewDefault) o.t = now;
    snap[id] = cur;
  }
}
function save() {
  stampChanges();
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) {}
  if (window.syncPush) window.syncPush();
}

const patterns = BUILTIN_PATTERNS;
const app = document.getElementById("app");
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => n.toLocaleString();

function prefsFor(p) { return data.prefs[p.id] || (data.prefs[p.id] = { mode: "rows", hand: "right" }); }
function progKey(p) { const pr = prefsFor(p); return `${p.id}|${pr.mode}${pr.mode === "rows" ? "|" + pr.hand : ""}`; }
function progressFor(p) { return data.progress[progKey(p)] || (data.progress[progKey(p)] = { step: 0, inrow: 0 }); }
const stepCache = new Map();
function stepsFor(p) {
  const pr = prefsFor(p), key = progKey(p);
  if (!stepCache.has(key)) {
    const steps = buildSteps(p, pr.mode, pr.hand);
    if (!verifySteps(p.grid, steps)) throw new Error("Pattern check failed");
    stepCache.set(key, steps);
  }
  return stepCache.get(key);
}
function colorMap(p) { const m = {}; p.colors.forEach(c => m[c.code] = c); return m; }
function textOn(hex) {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#1d2433" : "#ffffff";
}
function mix(hex, toHex, t) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(toHex.slice(1), 16);
  const ch = s => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;
function unitWord(p, n) { const u = prefsFor(p).mode === "c2c" ? "block" : "stitch"; return n === 1 ? u : (u === "stitch" ? "stitches" : "blocks"); }

document.documentElement.style.setProperty("--scale", data.settings.scale || 1);
function cycleScale() {
  const opts = [1, 1.15, 1.3];
  data.settings.scale = opts[(opts.indexOf(data.settings.scale || 1) + 1) % opts.length];
  document.documentElement.style.setProperty("--scale", data.settings.scale); save(); render();
}

// ---------- chart drawing ----------
function drawChart(canvas, p, opts = {}) {
  const H = p.grid.length, W = p.grid[0].length, cm = colorMap(p);
  const cell = opts.cell, dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(W * cell * dpr); canvas.height = Math.round(H * cell * dpr);
  canvas.style.width = W * cell + "px"; canvas.style.height = H * cell + "px";
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
  const steps = opts.steps, cur = opts.step ?? -1;
  let owner = null;
  if (steps) { owner = p.grid.map(r => Array(W).fill(0)); steps.forEach((s, i) => s.cells.forEach(([y, x]) => owner[y][x] = i)); }
  const fadeTo = dark() ? "#1b212d" : "#ffffff";
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const hex = cm[p.grid[y][x]].hex;
    ctx.fillStyle = opts.fade !== false && owner && owner[y][x] > cur ? mix(hex, fadeTo, dark() ? 0.55 : 0.68) : hex;
    ctx.fillRect(x * cell, y * cell, cell, cell);
  }
  if (cell >= 5) {
    ctx.strokeStyle = "rgba(0,0,0,0.15)"; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 0; x <= W; x++) { ctx.moveTo(x * cell + .5, 0); ctx.lineTo(x * cell + .5, H * cell); }
    for (let y = 0; y <= H; y++) { ctx.moveTo(0, y * cell + .5); ctx.lineTo(W * cell, y * cell + .5); }
    ctx.stroke();
  }
  if (steps && cur >= 0 && cur < steps.length) {
    const s = steps[cur], inset = Math.max(1.5, cell * 0.2);
    let doneCells = 0; for (let i = 0; i < (opts.inrow || 0); i++) doneCells += s.runs[i].n;
    s.cells.forEach(([y, x], i) => {
      ctx.fillStyle = "#f2b705"; ctx.fillRect(x * cell, y * cell, cell, cell);
      ctx.fillStyle = cm[p.grid[y][x]].hex; ctx.fillRect(x * cell + inset, y * cell + inset, cell - 2 * inset, cell - 2 * inset);
      if (i < doneCells && cell >= 6) {
        ctx.fillStyle = "rgba(61,138,31,0.9)"; ctx.beginPath();
        ctx.arc(x * cell + cell / 2, y * cell + cell / 2, cell * 0.18, 0, 7); ctx.fill();
      }
    });
    const [sy, sx] = s.cells[0];
    ctx.fillStyle = "#e0245e"; ctx.beginPath();
    ctx.arc(sx * cell + cell / 2, sy * cell + cell / 2, Math.max(2.5, cell * 0.32), 0, 7); ctx.fill();
  }
}

// ---------- screens ----------
function route() { return (location.hash || "#home").slice(1).split("/"); }
function go(hash) { if (location.hash !== hash) location.hash = hash; else render(); }
window.addEventListener("hashchange", render);
// Redraw on rotation, but not when the phone keyboard opens (that only changes the height).
let lastWidth = innerWidth;
window.addEventListener("resize", () => {
  if (innerWidth === lastWidth) return;
  lastWidth = innerWidth; clearTimeout(window._rz); window._rz = setTimeout(render, 150);
});

function render() {
  const [view, id] = route();
  const p = patterns.find(x => x.id === id);
  if (view !== "work") releaseWakeLock();
  if ((view === "pattern" || view === "work") && p) lastPlace = { view, id };
  if (view === "feedback") return renderFeedback();
  if (view === "pattern" && p) return renderPattern(p);
  if (view === "work" && p) return renderWork(p);
  renderHome();
}

function renderHome() {
  app.innerHTML = `
  <div class="screen stack">
    <div class="topbar"><h1>Row by Row</h1>${NOTES_BTN}<button class="iconbtn" data-act="scale" aria-label="Change text size">Aa</button></div>
    <p class="muted">Pick a pattern to keep crocheting.</p>
    ${patterns.map(p => {
      const steps = stepsFor(p), pr = progressFor(p), pf = prefsFor(p);
      const done = Math.min(pr.step, steps.length);
      return `<button class="card pattern-card" data-go="#pattern/${p.id}">
        <canvas data-thumb="${p.id}" aria-hidden="true"></canvas>
        <span><b>${esc(p.name)}</b>
          <span class="muted small">${p.grid[0].length} × ${p.grid.length} · ${pf.mode === "c2c" ? "C2C" : "Single crochet rows"}</span>
          <span class="bar" style="display:block;margin:8px 0 4px"><i style="width:${done / steps.length * 100}%"></i></span>
          <span class="small">${done >= steps.length ? "Finished" : `Row ${done + 1} of ${steps.length}`}</span>
        </span></button>`;
    }).join("")}
    ${syncCardHtml()}
    <button class="card pattern-card" data-go="#feedback" style="grid-template-columns:48px minmax(0,1fr)">
      <span class="note-icon" aria-hidden="true">${BUBBLE_SVG}</span>
      <span><b>Ideas or problems?</b><span class="muted small">Write a note any time and send it when you're ready.${pendingNotes().length ? ` <b style="display:inline;font-size:1em;color:var(--accent)">${pendingNotes().length} waiting to send.</b>` : ""}</span></span>
    </button>
  </div>`;
  app.querySelectorAll("[data-thumb]").forEach(cv => {
    const p = patterns.find(x => x.id === cv.dataset.thumb);
    drawChart(cv, p, { cell: 88 / p.grid[0].length });
  });
}

function yardage(p, count) {
  const c2c = prefsFor(p).mode === "c2c";
  return Math.max(5, Math.ceil(count * (c2c ? 0.8 * 1.15 : 0.11 * 1.3) / 5) * 5);
}

function renderPattern(p) {
  const steps = stepsFor(p), pr = progressFor(p), pf = prefsFor(p);
  const W = p.grid[0].length, H = p.grid.length, cm = colorMap(p);
  const counts = {}; p.grid.join("").split("").forEach(k => counts[k] = (counts[k] || 0) + 1);
  const finished = pr.step >= steps.length;
  const c2c = pf.mode === "c2c";
  app.innerHTML = `
  <div class="screen stack">
    <div class="topbar">
      <button class="iconbtn" data-go="#home" aria-label="Back to patterns">←</button>
      <div class="title"><b>${esc(p.name)}</b><span>${W} × ${H} squares</span></div>
      ${NOTES_BTN}<button class="iconbtn" data-act="scale" aria-label="Change text size">Aa</button>
    </div>
    <div class="chart-wrap" id="chartWrap"><canvas id="chart" aria-label="Pattern chart"></canvas></div>
    <div class="card stack">
      <div><div class="field-label">Style</div>
        <div class="seg" role="group" aria-label="Crochet style">
          <button data-mode="rows" aria-pressed="${!c2c}">Rows (sc)</button>
          <button data-mode="c2c" aria-pressed="${c2c}">Corner to corner</button>
        </div></div>
      ${c2c ? "" : `<div><div class="field-label">I crochet</div>
        <div class="seg" role="group" aria-label="Handedness">
          <button data-hand="right" aria-pressed="${pf.hand === "right"}">Right-handed</button>
          <button data-hand="left" aria-pressed="${pf.hand === "left"}">Left-handed</button>
        </div></div>`}
      <p class="small muted">${c2c
        ? `${steps.length} diagonal rows, ${fmt(W * H)} blocks. Starts in the bottom right corner and ends in the top left.`
        : `${H} rows of ${W} single crochet, ${fmt(W * H)} stitches. Starts at the bottom of the chart.`}
        Each style keeps its own place.</p>
      <div class="bar"><i style="width:${Math.min(pr.step, steps.length) / steps.length * 100}%"></i></div>
      <button class="btn primary" data-go="#work/${p.id}">${finished ? "Finished! View last row" : pr.step === 0 ? "Start Row 1" : `Continue: Row ${pr.step + 1} of ${steps.length}`}</button>
      <div style="display:flex;gap:8px;align-items:center">
        <label for="jump" class="small muted" style="white-space:nowrap">Go to row</label>
        <input id="jump" type="number" inputmode="numeric" min="1" max="${steps.length}" placeholder="1–${steps.length}"
          style="flex:1;min-width:0;min-height:48px;border-radius:12px;border:1px solid var(--line);padding:0 12px;font:inherit;background:var(--surface);color:var(--ink)">
        <button class="iconbtn" data-act="jump" style="padding:0 14px">Go</button>
      </div>
      <p class="small" id="jumpMsg" hidden></p>
    </div>
    <div class="card">
      <h2>Yarn</h2>
      <div class="key">${p.colors.filter(c => counts[c.code]).map(c => `
        <div class="key-row"><span class="sw" style="background:${c.hex}"></span><span class="code">${esc(c.code)}</span>
        <span>${esc(c.name)}</span><span class="num">${fmt(counts[c.code])} · ~${yardage(p, counts[c.code])} yd</span></div>`).join("")}
      </div>
      <p class="small muted" style="margin:10px 0 0">Yards are a rough guide for worsted yarn${c2c ? " with 1 in blocks" : ""}. Buy a little extra. You can use any yarn colors you like: each letter just has to stay the same yarn all the way through.</p>
    </div>
    <div class="card">
      <h2>How it works</h2>
      ${c2c ? `<ul style="margin:0;padding-left:20px;display:grid;gap:6px">
        <li>A block is ch 3 + 3 dc. Turn at the end of every row.</li>
        <li><b>Increase at start:</b> ch 6, dc in 4th ch from hook and next 2 ch.</li>
        <li><b>Work across:</b> sl st into the next ch-3 space, ch 3, 3 dc in the same space.</li>
        <li><b>Decrease at start:</b> sl st in the next 3 dc and into the ch-3 space, ch 3, 3 dc there.</li>
        <li><b>Decrease at end:</b> sl st into the last ch-3 space and turn without making a block.</li>
        <li>Before Row 2, hold the first block in the bottom right corner so Row 2's new block goes along the <b>bottom edge</b>. Keep that side as the front.</li></ul>`
      : `<ul style="margin:0;padding-left:20px;display:grid;gap:6px">
        <li>Row 1 is the bottom row of the chart. Each square is one single crochet.</li>
        <li>The colors on each row are listed in the order you stitch them.</li>
        <li>Change color on the last yarn over of the stitch before. Carry long colors inside your stitches and use bobbins for small areas.</li></ul>`}
    </div>
    <div class="card confirm">
      <button class="btn quiet" data-act="reset-ask">Start this pattern over</button>
      <div id="resetConfirm" class="confirm" hidden>
        <p class="small" style="margin:0">This clears your place for the ${c2c ? "corner to corner" : "rows"} version. Your other style keeps its place.</p>
        <button class="btn danger" data-act="reset">Yes, start over</button>
        <button class="btn quiet" data-act="reset-cancel">Cancel</button>
      </div>
    </div>
  </div>`;
  const wrap = document.getElementById("chartWrap");
  drawChart(document.getElementById("chart"), p, { cell: (wrap.clientWidth - 2) / W, steps, step: pr.step, fade: false });
}

let zoomed = false;
function renderWork(p) {
  const steps = stepsFor(p), pr = progressFor(p), pf = prefsFor(p), cm = colorMap(p);
  const W = p.grid[0].length;
  requestWakeLock();
  if (pr.step >= steps.length) {
    app.innerHTML = `
    <div class="screen stack">
      <div class="topbar"><button class="iconbtn" data-go="#pattern/${p.id}" aria-label="Back">←</button>
        <div class="title"><b>All ${steps.length} rows done</b><span>${esc(p.name)}</span></div></div>
      <div class="card stack"><b style="font-size:1.6em">Finished!</b>
        <p style="margin:0">Weave in your ends, add a border if you like, and block it flat.</p>
        <div class="chart-wrap" id="chartWrap"><canvas id="chart"></canvas></div>
        <button class="btn quiet" data-act="prev">Go back to Row ${steps.length}</button>
        <button class="btn primary" data-go="#pattern/${p.id}">Done</button></div>
    </div>`;
    const wrap = document.getElementById("chartWrap");
    drawChart(document.getElementById("chart"), p, { cell: (wrap.clientWidth - 2) / W, steps, step: steps.length });
    return;
  }
  const s = steps[pr.step];
  const inrow = Math.min(pr.inrow || 0, s.runs.length);
  let doneCount = 0; for (let i = 0; i < inrow; i++) doneCount += s.runs[i].n;
  const c2c = pf.mode === "c2c";
  const tip = c2c && s.n === 2
    ? `<p class="tip" style="margin:0"><b>Before this row:</b> hold the first block in the bottom right corner so this row's new block goes along the <b>bottom edge</b>. Keep that side facing you as the front from now on.</p>`
    : c2c && s.n === W + 1 ? `<p class="tip" style="margin:0">The bottom has reached the left edge. From here, decrease on the left edge and keep increasing on the right edge.</p>`
    : c2c && s.n === p.grid.length + 1 ? `<p class="tip" style="margin:0">The right side has reached the top. From here, decrease at both ends.</p>` : "";
  app.innerHTML = `
  <div class="screen stack">
    <div class="topbar">
      <button class="iconbtn" data-go="#pattern/${p.id}" aria-label="Back to pattern">←</button>
      <div class="title"><b>Row ${s.n} of ${steps.length}</b><span>${esc(p.name)} · ${c2c ? "C2C" : "Rows"}</span></div>
      ${NOTES_BTN}<button class="iconbtn" data-act="scale" aria-label="Change text size">Aa</button>
    </div>
    <div class="bar"><i style="width:${pr.step / steps.length * 100}%"></i></div>
    <div class="card stack">
      <div class="row-title"><b>Row ${s.n}</b><span class="count-badge">${s.count} ${unitWord(p, s.count)}</span></div>
      <div class="dir">${s.side ? s.side + " · " : ""}${s.direction.replace(/^./, c => c.toUpperCase())}</div>
      <div class="shaping">${s.shaping}</div>
      ${tip}
      <div class="chips" role="list">${s.runs.map((r, i) => {
        const c = cm[r.k];
        return `<button class="chip ${i < inrow ? "done" : ""} ${i === inrow ? "next" : ""}" data-chip="${i}" role="listitem"
          style="background:${c.hex};color:${textOn(c.hex)}" aria-label="${r.n} ${esc(c.name)}${i < inrow ? ", done" : ""}">${r.n} ${esc(r.k)}</button>`;
      }).join("")}</div>
      <p class="small muted" style="margin:0">${doneCount} of ${s.count} done. Tap each color when you finish it.</p>
    </div>
    <div class="card stack">
      <div style="display:flex;align-items:center;gap:10px"><h2 style="margin:0;flex:1">Where you are</h2>
        <button class="iconbtn" data-act="zoom" style="padding:0 14px">${zoomed ? "Fit" : "Zoom"}</button></div>
      <div class="chart-wrap" id="chartWrap"><canvas id="chart" aria-label="Chart with this row highlighted"></canvas></div>
      <p class="small muted" style="margin:0">This row is outlined in yellow. The pink dot is where it starts.</p>
    </div>
    <div class="card"><div class="key">${[...new Set(s.runs.map(r => r.k))].map(k => `
      <div class="key-row"><span class="sw" style="background:${cm[k].hex}"></span><span class="code">${esc(k)}</span><span>${esc(cm[k].name)}</span><span></span></div>`).join("")}</div></div>
  </div>
  <div class="actionbar"><div class="inner">
    <button class="btn quiet" data-act="prev" ${pr.step === 0 ? "disabled" : ""}>Back</button>
    <button class="btn primary" data-act="next">Row ${s.n} done ✓</button>
  </div></div>`;
  const wrap = document.getElementById("chartWrap");
  const cell = zoomed ? 16 : (wrap.clientWidth - 2) / W;
  drawChart(document.getElementById("chart"), p, { cell, steps, step: pr.step, inrow });
  if (zoomed) {   // scroll the current row into the middle of the zoomed chart
    const ys = s.cells.map(c => c[0]), xs = s.cells.map(c => c[1]);
    const cy = (Math.min(...ys) + Math.max(...ys) + 1) / 2 * cell, cx = (Math.min(...xs) + Math.max(...xs) + 1) / 2 * cell;
    wrap.scrollTop = cy - wrap.clientHeight / 2; wrap.scrollLeft = cx - wrap.clientWidth / 2;
  }
}

// ---------- sync card + hooks used by sync.js ----------
function syncCardHtml() {
  const s = window.syncState ? window.syncState() : { status: "loading" };
  const msg = s.message ? `<p class="small" role="status" style="margin:0;color:${s.status === "error" ? "#c62f2f" : "var(--muted)"}">${esc(s.message)}</p>` : "";
  if (s.user) {
    const label = { synced: "Up to date on all your devices", saving: "Saving...", offline: "Offline. Your changes will sync when you're back online.",
      connecting: "Connecting...", error: "" }[s.status] || "";
    return `<div class="card stack">
      <div style="display:flex;gap:12px;align-items:center">
        <span class="note-icon" aria-hidden="true">${CLOUD_SVG}</span>
        <span style="min-width:0"><b style="display:block">Syncing your place</b>
          <span class="small muted" style="overflow-wrap:anywhere">${esc(s.user.email || "")}</span></span></div>
      ${label ? `<p class="small" style="margin:0">${s.status === "synced" ? "✓ " : ""}${label}</p>` : ""}${msg}
      <div class="note-actions"><button class="linkbtn" data-act="signout-ask">Sign out on this device</button>
        <button class="linkbtn danger-text" data-act="signout" hidden>Yes, sign out</button></div>
      <p class="small muted" id="signoutNote" hidden style="margin:0">Your place stays on this device, but it stops syncing.</p>
    </div>`;
  }
  if (s.status === "unavailable") return `<div class="card"><b>Use on all your devices</b>
      <p class="small muted" style="margin:6px 0 0">Syncing needs internet the first time. Connect and reopen the app.</p></div>`;
  return `<div class="card stack">
      <div style="display:flex;gap:12px;align-items:center">
        <span class="note-icon" aria-hidden="true">${CLOUD_SVG}</span>
        <span><b style="display:block">Use on all your devices</b>
          <span class="small muted">Sign in with Google to keep your place the same on your phone, tablet and other devices.</span></span></div>
      ${msg}
      <button class="btn quiet" data-act="signin" ${s.status === "loading" || s.status === "connecting" ? "disabled" : ""}>Sign in with Google</button>
    </div>`;
}
const CLOUD_SVG = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 9.5 4.25 4.25 0 0 0 7 18z"/></svg>`;

// Called by sync.js. Redraw unless she's typing a note.
function onSyncChange(remoteChanged) {
  const v = route()[0];
  if (v === "home" || ((v === "pattern" || v === "work") && remoteChanged)) render();
}
window.RBR = { getData: () => data, resnap, save, onSyncChange,
  persist: () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) {} } };

app.addEventListener("click", e => {
  const t = e.target.closest("[data-act]"); if (!t) return;
  if (t.dataset.act === "signin" && window.syncSignIn) window.syncSignIn();
  if (t.dataset.act === "signout-ask") { t.hidden = true; t.nextElementSibling.hidden = false; document.getElementById("signoutNote").hidden = false; }
  if (t.dataset.act === "signout" && window.syncSignOut) window.syncSignOut();
});

// ---------- notes / feedback ----------
// Notes stay on the phone until she sends them through Android's share menu (Messages, WhatsApp, email...).
const BUBBLE_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5" stroke-linecap="round"/></svg>`;
const NOTES_BTN = `<button class="iconbtn" data-go="#feedback" aria-label="Write a note or idea">${BUBBLE_SVG}</button>`;
let lastPlace = null;
let feedbackMsg = "";
if (!data.notes) data.notes = [];
if (data.settings.includeWhere === undefined) data.settings.includeWhere = true;
const pendingNotes = () => data.notes.filter(n => !n.sent && !n.deleted);

function whereText() {
  if (!lastPlace) return "";
  const p = patterns.find(x => x.id === lastPlace.id); if (!p) return "";
  const pf = prefsFor(p), steps = stepsFor(p), pr = progressFor(p);
  const style = pf.mode === "c2c" ? "C2C" : `rows, ${pf.hand}-handed`;
  return `${p.name}, ${style}, ${pr.step >= steps.length ? "finished" : `Row ${pr.step + 1} of ${steps.length}`}`;
}
const when = ts => new Date(ts).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function saveDraftAsNote() {
  const box = document.getElementById("noteText");
  const text = (box ? box.value : data.draft || "").trim();
  if (!text) return false;
  data.notes.push({ id: Date.now(), text, at: Date.now(), where: data.settings.includeWhere ? whereText() : "", sent: false });
  data.draft = ""; save(); return true;
}

function composeMessage(list) {
  return "Row by Row notes\n\n" + list.map((n, i) =>
    `${list.length > 1 ? `${i + 1}) ` : ""}${n.text}\n   (${when(n.at)}${n.where ? " · " + n.where : ""})`).join("\n\n");
}

async function sendNotes() {
  saveDraftAsNote();
  const list = pendingNotes();
  if (!list.length) { feedbackMsg = "Write a note first, then tap Send."; return render(); }
  const text = composeMessage(list);
  if (navigator.share) {
    try {
      await navigator.share({ title: "Row by Row notes", text });
      list.forEach(n => { n.sent = true; n.sentAt = Date.now(); }); save();
      feedbackMsg = list.length === 1 ? "Sent. Thank you!" : `${list.length} notes sent. Thank you!`;
      return render();
    } catch (e) {
      if (e && e.name === "AbortError") { feedbackMsg = "Not sent. Your notes are still saved here."; return render(); }
    }
  }
  // No share menu (e.g. a computer): show the text so it can be copied.
  feedbackMsg = "";
  render();
  const fb = document.getElementById("fallback");
  fb.hidden = false; document.getElementById("fallbackText").value = text;
}

function renderFeedback() {
  const pending = pendingNotes(), sent = data.notes.filter(n => n.sent && !n.deleted);
  const where = whereText();
  const back = lastPlace ? `#${lastPlace.view}/${lastPlace.id}` : "#home";
  const noteItem = (n, canDelete) => `
    <div class="note">
      <p style="margin:0;white-space:pre-wrap">${esc(n.text)}</p>
      <p class="small muted" style="margin:4px 0 0">${when(n.at)}${n.where ? " · " + esc(n.where) : ""}${n.sent ? ` · sent ${when(n.sentAt)}` : ""}</p>
      ${canDelete ? `<div class="note-actions"><button class="linkbtn" data-note-del="${n.id}">Delete</button>
        <button class="linkbtn danger-text" data-note-del-yes="${n.id}" hidden>Yes, delete this note</button></div>` : ""}
    </div>`;
  app.innerHTML = `
  <div class="screen stack">
    <div class="topbar">
      <button class="iconbtn" data-go="${back}" aria-label="Back">←</button>
      <div class="title"><b>Notes and ideas</b><span>Thoughts, problems, wishes</span></div>
      <button class="iconbtn" data-act="scale" aria-label="Change text size">Aa</button>
    </div>
    ${feedbackMsg ? `<p class="tip" role="status" style="margin:0">${esc(feedbackMsg)}</p>` : ""}
    <div class="card stack">
      <label for="noteText" class="field-label" style="margin:0">Write a note</label>
      <textarea id="noteText" rows="5" placeholder="What's on your mind? Something confusing, a wish, a problem..."
        style="width:100%;min-height:140px;border-radius:12px;border:1px solid var(--line);padding:12px;font:inherit;background:var(--surface);color:var(--ink);resize:vertical">${esc(data.draft || "")}</textarea>
      <p class="small muted" style="margin:0">Tip: tap the microphone on your keyboard to talk instead of typing.</p>
      ${where ? `<label class="check"><input type="checkbox" id="includeWhere" ${data.settings.includeWhere ? "checked" : ""}>
        <span>Add where I am: <b>${esc(where)}</b></span></label>` : ""}
      <button class="btn primary" data-act="send-notes">${pending.length ? `Send, with ${pending.length} saved note${pending.length > 1 ? "s" : ""}` : "Send"}</button>
      <button class="btn quiet" data-act="save-note">Save for later</button>
      <p class="small muted" style="margin:0">Send opens your phone's share menu. Pick Messages, WhatsApp or email and choose who to send it to.</p>
      <div id="fallback" class="stack" hidden>
        <p class="small" style="margin:0">This device can't open a share menu. Copy the text below and paste it into a message.</p>
        <textarea id="fallbackText" rows="6" readonly style="width:100%;border-radius:12px;border:1px solid var(--line);padding:10px;font:inherit;background:var(--bg);color:var(--ink)"></textarea>
        <button class="btn quiet" data-act="copy-notes">Copy text</button>
        <button class="btn quiet" data-act="mark-sent">I've sent it</button>
      </div>
    </div>
    ${pending.length ? `<div class="card stack"><h2 style="margin:0">Saved, not sent yet (${pending.length})</h2>${pending.map(n => noteItem(n, true)).join("")}</div>` : ""}
    ${sent.length ? `<details class="card"><summary><b>Sent notes (${sent.length})</b></summary>
      <div class="stack" style="margin-top:12px">${sent.slice().reverse().map(n => noteItem(n, true)).join("")}</div></details>` : ""}
  </div>`;
  feedbackMsg = "";
  const box = document.getElementById("noteText");
  box.addEventListener("input", () => { data.draft = box.value; save(); });
  const inc = document.getElementById("includeWhere");
  if (inc) inc.addEventListener("change", () => { data.settings.includeWhere = inc.checked; save(); });
}

app.addEventListener("click", async e => {
  const t = e.target.closest("[data-note-del],[data-note-del-yes],[data-act]");
  if (!t) return;
  if (t.dataset.noteDel) { t.hidden = true; t.nextElementSibling.hidden = false; return; }
  if (t.dataset.noteDelYes) {   // keep a blank marker so other devices delete it too
    const n = data.notes.find(n => String(n.id) === t.dataset.noteDelYes);
    if (n) { n.deleted = true; n.text = ""; n.where = ""; }
    save(); return render();
  }
  const act = t.dataset.act;
  if (act === "save-note") { feedbackMsg = saveDraftAsNote() ? "Saved. Send it whenever you like." : "Write a note first."; return render(); }
  if (act === "send-notes") return sendNotes();
  if (act === "copy-notes") {
    const ta = document.getElementById("fallbackText");
    try { await navigator.clipboard.writeText(ta.value); t.textContent = "Copied"; } catch (err) { ta.select(); }
    return;
  }
  if (act === "mark-sent") { pendingNotes().forEach(n => { n.sent = true; n.sentAt = Date.now(); }); save(); feedbackMsg = "Marked as sent. Thank you!"; return render(); }
});

// ---------- actions ----------
app.addEventListener("click", e => {
  const t = e.target.closest("[data-go],[data-act],[data-mode],[data-hand],[data-chip]");
  if (!t || t.disabled) return;
  const [view, id] = route();
  const p = patterns.find(x => x.id === id);
  if (t.dataset.go) return go(t.dataset.go);
  if (t.dataset.mode) { prefsFor(p).mode = t.dataset.mode; save(); return render(); }
  if (t.dataset.hand) { prefsFor(p).hand = t.dataset.hand; save(); return render(); }
  if (t.dataset.chip !== undefined) {
    const pr = progressFor(p), i = +t.dataset.chip;
    pr.inrow = i < (pr.inrow || 0) ? i : i + 1; save(); return render();
  }
  const act = t.dataset.act, pr = p && progressFor(p);
  if (act === "scale") return cycleScale();
  if (act === "zoom") { zoomed = !zoomed; return render(); }
  if (act === "next") { pr.step++; pr.inrow = 0; save(); render(); return scrollTo(0, 0); }
  if (act === "prev") { pr.step = Math.max(0, pr.step - 1); pr.inrow = 0; save(); render(); return scrollTo(0, 0); }
  if (act === "reset-ask") { document.getElementById("resetConfirm").hidden = false; t.hidden = true; return; }
  if (act === "reset-cancel") return render();
  if (act === "reset") { pr.step = 0; pr.inrow = 0; save(); return render(); }
  if (act === "jump") {
    const steps = stepsFor(p), v = parseInt(document.getElementById("jump").value, 10), msg = document.getElementById("jumpMsg");
    if (!(v >= 1 && v <= steps.length)) { msg.hidden = false; msg.textContent = `Enter a row from 1 to ${steps.length}.`; return; }
    pr.step = v - 1; pr.inrow = 0; save(); return go(`#work/${p.id}`);
  }
});

// ---------- keep the screen on while crocheting ----------
let wakeLock = null;
async function requestWakeLock() {
  try { if ("wakeLock" in navigator && !wakeLock && document.visibilityState === "visible") {
    wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } } catch (e) {}
}
function releaseWakeLock() { try { wakeLock && wakeLock.release(); } catch (e) {} wakeLock = null; }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && route()[0] === "work") requestWakeLock(); });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
render();
