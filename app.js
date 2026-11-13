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
// Patterns she makes live in data.patterns by id; a deleted one becomes { deleted: true } so the delete syncs.
if (!data.patterns) data.patterns = {};
function syncedEntries() {
  const out = [];
  for (const sec of ["progress", "prefs", "patterns"]) for (const k in data[sec]) out.push([sec, k, data[sec][k]]);
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

const myPatterns = () => Object.values(data.patterns).filter(p => !p.deleted && p.grid);
const allPatterns = () => [...myPatterns(), ...BUILTIN_PATTERNS];
const findPattern = id => allPatterns().find(x => x.id === id);
// Most recently worked on (or made) first.
function lastUsed(p) {
  let t = p.created || 0;
  for (const k in data.progress) if (k.split("|")[0] === p.id) t = Math.max(t, data.progress[k].t || 0);
  return t;
}
const app = document.getElementById("app");
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => n.toLocaleString();

function prefsFor(p) { return data.prefs[p.id] || (data.prefs[p.id] = { mode: "rows", hand: "right" }); }
function progKey(p) { const pr = prefsFor(p); return `${p.id}|${pr.mode}${pr.mode === "rows" ? "|" + pr.hand : ""}`; }
function progressFor(p) { return data.progress[progKey(p)] || (data.progress[progKey(p)] = { step: 0, inrow: 0 }); }
// Move her place. A move backwards remembers how far along she had been (back), so sync knows
// it was on purpose and lets it replace that place on her other devices. See newer() in sync.js.
function moveTo(pr, step, inrow) {
  const before = Math.max(pr.step * 1000 + (pr.inrow || 0), pr.back || 0);
  pr.step = step; pr.inrow = inrow;
  if (step * 1000 + inrow < before) pr.back = before; else delete pr.back;
}
const stepCache = new WeakMap();   // per pattern object, so a pattern replaced by sync gets fresh steps
function stepsFor(p) {
  const pr = prefsFor(p), key = progKey(p);
  if (!stepCache.has(p)) stepCache.set(p, new Map());
  const cache = stepCache.get(p);
  if (!cache.has(key)) {
    const steps = buildSteps(p, pr.mode, pr.hand);
    if (!verifySteps(p.grid, steps)) throw new Error("Pattern check failed");
    cache.set(key, steps);
  }
  return cache.get(key);
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
  const p = findPattern(id);
  if (view !== "work") releaseWakeLock();
  if ((view === "pattern" || view === "work") && p) lastPlace = { view, id };
  if (view === "feedback") return renderFeedback();
  if (view === "new" && draft) return renderNew();
  if (view === "pattern" && p) return renderPattern(p);
  if (view === "work" && p) return renderWork(p);
  renderHome();
}

function renderHome() {
  app.innerHTML = `
  <div class="screen stack">
    <div class="topbar"><h1>Row by Row</h1>${NOTES_BTN}<button class="iconbtn" data-act="scale" aria-label="Change text size">Aa</button></div>
    <p class="muted">Pick a pattern to keep crocheting.</p>
    ${homeMsg ? `<p class="tip" role="status" style="margin:0">${esc(homeMsg)}</p>` : ""}
    ${allPatterns().sort((a, b) => lastUsed(b) - lastUsed(a)).map(p => {
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
    <button class="btn quiet" data-act="new-picture">＋ New pattern from a picture or chart</button>
    <input type="file" id="picFile" accept="image/*" hidden>
    ${syncCardHtml()}
    <button class="card pattern-card" data-go="#feedback" style="grid-template-columns:48px minmax(0,1fr)">
      <span class="note-icon" aria-hidden="true">${BUBBLE_SVG}</span>
      <span><b>Ideas or problems?</b><span class="muted small">Write a note any time and send it when you're ready.${pendingNotes().length ? ` <b style="display:inline;font-size:1em;color:var(--accent)">${pendingNotes().length} waiting to send.</b>` : ""}</span></span>
    </button>
  </div>`;
  app.querySelectorAll("[data-thumb]").forEach(cv => {
    const p = findPattern(cv.dataset.thumb);
    drawChart(cv, p, { cell: 88 / Math.max(p.grid[0].length, p.grid.length * 0.8) });
  });
  document.getElementById("picFile").addEventListener("change", e => { if (e.target.files[0]) startDraft(e.target.files[0]); });
  homeMsg = "";
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
    ${p.builtIn ? "" : `<div class="card stack">
      <label class="field-label" for="patName" style="margin:0">Pattern name</label>
      <input id="patName" class="text-input" value="${esc(p.name)}" maxlength="60" enterkeyhint="done">
      <div class="note-actions" style="margin:0"><button class="linkbtn danger-text" data-act="delete-ask">Delete this pattern</button></div>
      <div id="deleteConfirm" class="confirm" hidden>
        <p class="small" style="margin:0">This removes ${esc(p.name)} and your place in it from all your devices.</p>
        <button class="btn danger" data-act="delete">Yes, delete it</button>
        <button class="btn quiet" data-act="delete-cancel">Cancel</button>
      </div>
    </div>`}
  </div>`;
  const nameBox = document.getElementById("patName");
  if (nameBox) {
    const rename = () => {
      const v = nameBox.value.trim();
      if (v && v !== p.name) { p.name = v; save(); document.querySelector(".topbar .title b").textContent = v; }
    };
    nameBox.addEventListener("change", rename);
    nameBox.addEventListener("keydown", e => { if (e.key === "Enter") nameBox.blur(); });
  }
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
        <span style="min-width:0"><b style="display:block">Syncing your patterns and place</b>
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
          <span class="small muted">Sign in with Google to keep your patterns and your place the same on your phone, tablet and other devices.</span></span></div>
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
  const p = findPattern(lastPlace.id); if (!p) return "";
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

const signedIn = () => !!(window.syncState && window.syncState().user && window.syncSendFeedback);

// Signed in: notes go straight to the feedback inbox. Otherwise (or if she picks Share), the phone's share menu.
async function sendNotes(viaShare) {
  saveDraftAsNote();
  const list = pendingNotes();
  if (!list.length) { feedbackMsg = "Write a note first, then tap Send."; return render(); }
  if (!viaShare && signedIn()) {
    feedbackMsg = "Sending..."; render();
    document.querySelectorAll('[data-act="send-notes"],[data-act="share-notes"]').forEach(b => b.disabled = true);
    try {
      await window.syncSendFeedback(list);
      list.forEach(n => { n.sent = true; n.sentAt = Date.now(); n.via = "inbox"; }); save();
      feedbackMsg = list.length === 1 ? "Sent. Thank you!" : `${list.length} notes sent. Thank you!`;
    } catch (e) {
      feedbackMsg = e && e.code === "timeout"
        ? "No connection right now. Your notes are saved here. Tap Send again when you're online."
        : "That didn't go through. Your notes are saved here. Try again in a bit, or tap Share instead.";
      console.warn("feedback:", e && (e.code || e.message));
    }
    return render();
  }
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
      ${signedIn()
        ? `<p class="small muted" style="margin:0">Send goes straight to the app's inbox, so you don't need to pick anyone.
            <button class="linkbtn" data-act="share-notes" style="min-height:0;padding:0">Share it yourself instead</button></p>`
        : `<p class="small muted" style="margin:0">Send opens your phone's share menu. Pick Messages, WhatsApp or email and choose who to send it to.</p>`}
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
  if (act === "send-notes") return sendNotes(false);
  if (act === "share-notes") return sendNotes(true);
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
  const p = findPattern(id);
  if (t.dataset.go) return go(t.dataset.go);
  if (t.dataset.mode) { prefsFor(p).mode = t.dataset.mode; save(); return render(); }
  if (t.dataset.hand) { prefsFor(p).hand = t.dataset.hand; save(); return render(); }
  if (t.dataset.chip !== undefined) {
    const pr = progressFor(p), i = +t.dataset.chip;
    moveTo(pr, pr.step, i < (pr.inrow || 0) ? i : i + 1); save(); return render();
  }
  const act = t.dataset.act, pr = p && progressFor(p);
  if (act === "scale") return cycleScale();
  if (act === "zoom") { zoomed = !zoomed; return render(); }
  if (act === "next") { moveTo(pr, pr.step + 1, 0); save(); render(); return scrollTo(0, 0); }
  if (act === "prev") { moveTo(pr, Math.max(0, pr.step - 1), 0); save(); render(); return scrollTo(0, 0); }
  if (act === "reset-ask") { document.getElementById("resetConfirm").hidden = false; t.hidden = true; return; }
  if (act === "reset-cancel") return render();
  if (act === "reset") { moveTo(pr, 0, 0); save(); return render(); }
  if (act === "delete-ask") { document.getElementById("deleteConfirm").hidden = false; t.hidden = true; return; }
  if (act === "delete-cancel") return render();
  if (act === "delete") { data.patterns[p.id] = { deleted: true }; save(); return go("#home"); }
  if (act === "new-picture") return document.getElementById("picFile").click();
  if (act === "jump") {
    const steps = stepsFor(p), v = parseInt(document.getElementById("jump").value, 10), msg = document.getElementById("jumpMsg");
    if (!(v >= 1 && v <= steps.length)) { msg.hidden = false; msg.textContent = `Enter a row from 1 to ${steps.length}.`; return; }
    moveTo(pr, v - 1, 0); save(); return go(`#work/${p.id}`);
  }
});

// ---------- new pattern from a picture ----------
// The picture is kept in memory only; the finished grid is what gets saved and synced.
let draft = null, homeMsg = "";
const SS = 6;   // pixels sampled across each square, each way
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };

function loadPicture(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("not a picture")); };
    img.src = url;
  });
}

async function startDraft(file) {
  app.innerHTML = `<div class="screen"><p class="muted" role="status">Reading the picture...</p></div>`;
  await new Promise(r => setTimeout(r, 30));   // let that show before the work starts
  let pic;
  try { pic = await loadPicture(file); }
  catch (e) { homeMsg = "That file couldn't be opened as a picture. Try a JPG or PNG."; go("#home"); return render(); }
  const px = pic.getContext("2d").getImageData(0, 0, pic.width, pic.height).data;
  const found = detectGrid(px, pic.width, pic.height);
  const W = 50, H = clamp(Math.round(W * pic.height / pic.width), 5, 150);
  draft = { pic, px, found, g: found && { ...found }, mode: found ? "chart" : "photo",
    name: "", W, H, k: 6, zoom: 1, cx: pic.width / 2, cy: pic.height / 2, tidy: true,
    border: 0, borderCode: "A", names: [], view: "pattern", result: null };
  go("#new");
}

// The part of the picture that fills the pattern: the pattern's shape, as big as fits, divided by zoom.
function cropRect(d) {
  const a = d.W / d.H, iw = d.pic.width, ih = d.pic.height;
  let w = iw, h = iw / a;
  if (h > ih) { h = ih; w = ih * a; }
  w /= d.zoom; h /= d.zoom;
  d.cx = clamp(d.cx, w / 2, iw - w / 2); d.cy = clamp(d.cy, h / 2, ih - h / 2);
  return { x: d.cx - w / 2, y: d.cy - h / 2, w, h };
}

function computeDraft(d) {
  let g;
  if (d.mode === "chart") {
    g = readChart(d.px, d.pic.width, d.g);
    if (d.foundColors === undefined) d.foundColors = g.colors.length;
  }
  else {
    const r = cropRect(d), c = document.createElement("canvas");
    c.width = d.W * SS; c.height = d.H * SS;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(d.pic, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    g = makeGrid(cellColors(ctx.getImageData(0, 0, c.width, c.height).data, d.W, d.H, SS), d.W, d.H, d.k, { tidy: d.tidy });
  }
  // Keep names she typed: each goes to the new color closest to the one she named, if it's still close.
  g.colors.forEach(col => {
    const lab = toLab(hexRgb(col.hex)); let best = null, bd = 0.0064;
    d.names.forEach(n => { const dd = labDist2(lab, n.lab); if (dd < bd) { bd = dd; best = n; } });
    if (best) col.name = best.name;
  });
  if (!g.colors.some(c => c.code === d.borderCode)) d.borderCode = "A";
  d.result = g;
}

function draftPattern(d) {
  return { id: "draft", name: d.name, grid: addBorder(d.result.grid, d.border, d.borderCode),
    colors: d.result.colors.map(({ code, name, hex }) => ({ code, name, hex })) };
}

// Grid fixes for a chart, each one square at a time. Returns false if it would leave the picture.
function adjustGrid(d, act) {
  const g = { ...d.g }, cw = (g.x1 - g.x0) / g.cols, ch = (g.y1 - g.y0) / g.rows;
  const ops = {
    "cols-": () => g.cols--, "cols+": () => g.cols++, "rows-": () => g.rows--, "rows+": () => g.rows++,
    "left-out": () => { g.x0 -= cw; g.cols++; }, "left-in": () => { g.x0 += cw; g.cols--; },
    "right-in": () => { g.x1 -= cw; g.cols--; }, "right-out": () => { g.x1 += cw; g.cols++; },
    "top-out": () => { g.y0 -= ch; g.rows++; }, "top-in": () => { g.y0 += ch; g.rows--; },
    "bottom-in": () => { g.y1 -= ch; g.rows--; }, "bottom-out": () => { g.y1 += ch; g.rows++; },
    reset: () => Object.assign(g, d.found)
  };
  ops[act]();
  const ok = g.cols >= 2 && g.rows >= 2 && g.cols <= 200 && g.rows <= 200 &&
    g.x0 >= -0.5 && g.y0 >= -0.5 && g.x1 <= d.pic.width + 0.5 && g.y1 <= d.pic.height + 0.5;
  if (ok) d.g = g;
  return ok;
}

function renderNew() {
  const d = draft, chart = d.mode === "chart";
  if (!d.result) computeDraft(d);
  const step = (act, label, aria) => `<button class="iconbtn" data-adj="${act}" aria-label="${aria}">${label}</button>`;
  app.innerHTML = `
  <div class="screen stack">
    <div class="topbar"><button class="iconbtn" id="dCancel" aria-label="Cancel">←</button>
      <div class="title"><b>New pattern</b><span>${chart ? "From a chart" : "From a picture"}</span></div></div>
    ${d.found ? `<div class="card stack">
      <p style="margin:0">${chart ? "This looks like a chart, so each square is read exactly." : "Reading it as a photo: the colors are simplified to fit the size you pick."}</p>
      <div class="seg" role="group" aria-label="Read the picture as">
        <button data-mode-pick="chart" aria-pressed="${chart}">Chart squares</button>
        <button data-mode-pick="photo" aria-pressed="${!chart}">Photo</button></div></div>` : ""}
    <div class="seg" role="group" aria-label="Show">
      <button data-view="pattern" aria-pressed="${d.view === "pattern"}">Pattern</button>
      <button data-view="photo" aria-pressed="${d.view === "photo"}">${chart ? "Chart" : "Picture"}</button></div>
    <div class="chart-wrap editor-preview" id="chartWrap"><canvas id="chart" aria-label="Preview"></canvas></div>
    <p class="small muted" style="margin:-6px 0 0">${chart
      ? "Tap Chart to check that the pink lines sit on the chart's lines."
      : "Drag to move the picture. Pinch or use Zoom to fill more of it."}</p>
    <div class="card stack">
      <div><label class="field-label" for="dName">Name</label>
        <input id="dName" class="text-input" value="${esc(d.name)}" placeholder="My pattern" maxlength="60" enterkeyhint="done"></div>
      ${chart ? `<p class="small muted" id="dSize" style="margin:0"></p>
      <details class="adjust"><summary><b>Grid doesn't line up?</b></summary>
        <div class="adjust-grid">
          <span>Columns</span>${step("cols-", "−", "Fewer columns")}<b id="dCols">${d.g.cols}</b>${step("cols+", "+", "More columns")}
          <span>Rows</span>${step("rows-", "−", "Fewer rows")}<b id="dRows">${d.g.rows}</b>${step("rows+", "+", "More rows")}
          <span>Left edge</span>${step("left-out", "←", "Move left edge out")}<i></i>${step("left-in", "→", "Move left edge in")}
          <span>Right edge</span>${step("right-in", "←", "Move right edge in")}<i></i>${step("right-out", "→", "Move right edge out")}
          <span>Top edge</span>${step("top-out", "↑", "Move top edge out")}<i></i>${step("top-in", "↓", "Move top edge in")}
          <span>Bottom edge</span>${step("bottom-in", "↑", "Move bottom edge in")}<i></i>${step("bottom-out", "↓", "Move bottom edge out")}
        </div>
        <p class="small muted" style="margin:8px 0 0">Columns and rows respace the whole grid. The edges add or remove one square at that side.</p>
        <button class="linkbtn" data-adj="reset">Start over with what was found</button>
      </details>` : `
      <div class="field-row">
        <div><label class="field-label" for="dW">Width</label><input id="dW" class="text-input" type="number" inputmode="numeric" min="5" max="150" value="${d.W}"></div>
        <div><label class="field-label" for="dH">Height</label><input id="dH" class="text-input" type="number" inputmode="numeric" min="5" max="150" value="${d.H}"></div>
      </div>
      <p class="small muted" id="dSize" style="margin:-4px 0 0"></p>
      <div><label class="field-label" for="dZoom">Zoom</label>
        <input id="dZoom" type="range" min="1" max="4" step="0.01" value="${d.zoom}"></div>
      <div><label class="field-label" for="dK">Colors: <span id="dKv">${d.k}</span></label>
        <input id="dK" type="range" min="2" max="12" step="1" value="${d.k}"></div>
      <label class="check"><input type="checkbox" id="dTidy" ${d.tidy ? "checked" : ""}><span>Tidy up stray single squares</span></label>`}
      <div><div class="field-label">Border</div>
        <div class="seg" role="group" aria-label="Border width">${[0, 1, 2, 3].map(n =>
          `<button data-border="${n}" aria-pressed="${d.border === n}">${n ? n + " sq" : "None"}</button>`).join("")}</div>
        <div class="swatches" id="dBorderColor" ${d.border ? "" : "hidden"}></div></div>
    </div>
    <div class="card stack"><div><h2 style="margin:0 0 4px">Yarn colors</h2>
      <p class="small muted" style="margin:0">Rename them to match your yarn.</p></div>
      <div class="key" id="dColors"></div></div>
    <button class="btn primary" id="dSave">Save pattern</button>
  </div>`;

  let queued = false;
  const update = recompute => {
    if (queued) return; queued = true;
    requestAnimationFrame(() => { queued = false; if (recompute) computeDraft(d); drawDraft(); });
  };
  const $ = id => document.getElementById(id);
  $("dCancel").onclick = () => { draft = null; go("#home"); };
  $("dName").oninput = e => d.name = e.target.value;
  $("dName").onkeydown = e => { if (e.key === "Enter") e.target.blur(); };
  app.querySelectorAll("[data-mode-pick]").forEach(b => b.onclick = () => {
    if (d.mode === b.dataset.modePick) return;
    d.mode = b.dataset.modePick; computeDraft(d); renderNew();
  });
  app.querySelectorAll("[data-view]").forEach(b => b.onclick = () => {
    d.view = b.dataset.view;
    app.querySelectorAll("[data-view]").forEach(x => x.setAttribute("aria-pressed", x === b)); drawDraft();
  });
  app.querySelectorAll("[data-border]").forEach(b => b.onclick = () => {
    d.border = +b.dataset.border; $("dBorderColor").hidden = !d.border;
    app.querySelectorAll("[data-border]").forEach(x => x.setAttribute("aria-pressed", x === b)); drawDraft();
  });
  $("dBorderColor").onclick = e => { const b = e.target.closest("[data-code]"); if (b) { d.borderCode = b.dataset.code; drawDraft(); } };
  $("dColors").oninput = e => {
    const i = +e.target.dataset.i, col = d.result.colors[i];
    if (!col) return;
    col.name = e.target.value;
    const lab = toLab(hexRgb(col.hex));
    d.names = d.names.filter(n => labDist2(n.lab, lab) >= 0.0064).concat({ lab, name: col.name });
  };

  if (chart) {
    app.querySelectorAll("[data-adj]").forEach(b => b.onclick = () => {
      if (!adjustGrid(d, b.dataset.adj)) return;
      $("dCols").textContent = d.g.cols; $("dRows").textContent = d.g.rows;
      update(true);
    });
    return drawDraft();
  }

  const sizeBox = id => {
    $(id).oninput = e => {
      const v = parseInt(e.target.value, 10);
      if (!(v >= 5 && v <= 150)) return;
      if (id === "dW") { d.H = clamp(Math.round(d.H * v / d.W), 5, 150); $("dH").value = d.H; d.W = v; }
      else d.H = v;
      update(true);
    };
    $(id).onchange = e => { e.target.value = id === "dW" ? d.W : d.H; };
  };
  sizeBox("dW"); sizeBox("dH");
  $("dZoom").oninput = e => { d.zoom = +e.target.value; update(true); };
  $("dK").oninput = e => { d.k = +e.target.value; $("dKv").textContent = d.k; update(true); };
  $("dTidy").onchange = e => { d.tidy = e.target.checked; update(true); };

  // Drag to move the picture, pinch to zoom.
  const cv = $("chart"), pts = new Map();
  cv.classList.add("draggable");
  let pinch = 0;
  cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); pinch = 0; };
  cv.onpointermove = e => {
    if (!pts.has(e.pointerId)) return;
    const [px, py] = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) {
      const per = cropRect(d).w / d.W / d.cell;   // picture pixels per screen pixel
      d.cx -= (e.clientX - px) * per; d.cy -= (e.clientY - py) * per;
    } else {
      const [a, b] = [...pts.values()], dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) { d.zoom = clamp(d.zoom * dist / pinch, 1, 4); $("dZoom").value = d.zoom; }
      pinch = dist;
    }
    update(true);
  };
  cv.onpointerup = cv.onpointercancel = e => { pts.delete(e.pointerId); pinch = 0; };
  drawDraft();
}

function sizeCanvas(cv, w, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  cv.style.width = w + "px"; cv.style.height = h + "px";
  const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
  return ctx;
}

function drawDraft() {
  const d = draft, p = draftPattern(d), W = p.grid[0].length, H = p.grid.length;
  const wrap = document.getElementById("chartWrap"), cv = document.getElementById("chart");
  if (!wrap) return;
  const fit = (w, h) => Math.min((wrap.clientWidth - 2) / w, innerHeight * 0.5 / h);
  if (d.view === "photo" && d.mode === "chart") {
    // The chart itself with the grid it was read with drawn on top, half a square of margin around it.
    const g = d.g, cw = (g.x1 - g.x0) / g.cols, ch = (g.y1 - g.y0) / g.rows, cell = fit(g.cols + 1, g.rows + 1);
    const ctx = sizeCanvas(cv, (g.cols + 1) * cell, (g.rows + 1) * cell);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, (g.cols + 1) * cell, (g.rows + 1) * cell);
    ctx.drawImage(d.pic, g.x0 - cw / 2, g.y0 - ch / 2, cw * (g.cols + 1), ch * (g.rows + 1), 0, 0, (g.cols + 1) * cell, (g.rows + 1) * cell);
    ctx.strokeStyle = "rgba(233,30,140,.9)"; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i <= g.cols; i++) { const x = Math.round((i + 0.5) * cell) + 0.5; ctx.moveTo(x, cell / 2); ctx.lineTo(x, (g.rows + 0.5) * cell); }
    for (let j = 0; j <= g.rows; j++) { const y = Math.round((j + 0.5) * cell) + 0.5; ctx.moveTo(cell / 2, y); ctx.lineTo((g.cols + 0.5) * cell, y); }
    ctx.stroke();
  } else if (d.view === "photo") {
    const cell = fit(W, H), r = cropRect(d), b = d.border * cell;
    d.cell = cell;
    const ctx = sizeCanvas(cv, W * cell, H * cell);
    ctx.fillStyle = p.colors.find(c => c.code === d.borderCode).hex; ctx.fillRect(0, 0, W * cell, H * cell);
    ctx.drawImage(d.pic, r.x, r.y, r.w, r.h, b, b, d.W * cell, d.H * cell);
  } else { d.cell = fit(W, H); drawChart(cv, p, { cell: d.cell }); }
  const counts = {}; p.grid.join("").split("").forEach(k => counts[k] = (counts[k] || 0) + 1);
  document.getElementById("dSize").textContent = d.mode === "chart"
    ? `${W} × ${H} squares${d.border ? " with the border" : ""}, ${p.colors.length} colors.` +
      (p.colors.length > d.foundColors * 1.5 + 2 ? " That's a lot more colors than before, which usually means the grid is off." : "")
    : `${W} × ${H} squares${d.border ? " with the border" : ""}. In C2C with 1 in blocks, about ${W} × ${H} in.`;
  const list = document.getElementById("dColors");
  if (!list.contains(document.activeElement)) list.innerHTML = p.colors.map((c, i) => `
    <div class="key-row"><span class="sw" style="background:${c.hex}"></span><span class="code">${c.code}</span>
      <input class="text-input slim" data-i="${i}" value="${esc(c.name)}" aria-label="Name for color ${c.code}" maxlength="40">
      <span class="num">${fmt(counts[c.code] || 0)}</span></div>`).join("");
  document.getElementById("dBorderColor").innerHTML = p.colors.map(c =>
    `<button class="swatch-btn" data-code="${c.code}" aria-pressed="${c.code === d.borderCode}" aria-label="Border color ${esc(c.name)}"
      style="background:${c.hex}"></button>`).join("");
}

function saveDraft() {
  const d = draft, p = draftPattern(d);
  const taken = new Set(allPatterns().map(x => x.name));
  let name = d.name.trim();
  if (!name) { name = "My pattern"; for (let n = 2; taken.has(name); n++) name = `My pattern ${n}`; }
  const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  data.patterns[id] = { id, name, grid: p.grid, colors: p.colors.map(c => ({ ...c, name: c.name.trim() || colorName(c.hex) })), created: Date.now() };
  draft = null; save(); go(`#pattern/${id}`);
}
app.addEventListener("click", e => { if (e.target.id === "dSave" && draft) saveDraft(); });

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
