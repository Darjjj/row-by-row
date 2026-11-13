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
// Write everything to the phone. Returns false (and shows a warning that stays until a save works) if it can't,
// for example when the phone's storage is full.
function persist() {
  let ok = true;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { ok = false; }
  let warn = document.getElementById("saveWarn");
  if (!ok && !warn) {
    warn = document.createElement("div"); warn.id = "saveWarn"; warn.setAttribute("role", "alert");
    warn.textContent = "Row by Row couldn't save on this phone, so your latest changes could be lost if the app closes. " +
      "Your phone may be out of storage space.";
    document.body.prepend(warn);
  }
  if (warn) warn.hidden = ok;
  return ok;
}
function save() {
  stampChanges();
  const ok = persist();
  if (window.syncPush) window.syncPush();
  return ok;
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
  const [view, id, sub] = route();
  const p = findPattern(id);
  if (view !== "work" && view !== "piece") releaseWakeLock();
  if ((view === "pattern" || view === "work") && p) lastPlace = { view, id };
  if (view === "new" && draft) lastPlace = { view };
  if (view === "feedback") return renderFeedback();
  if (view === "backup") return renderBackup();
  if (view === "import" && id) return renderImport(id);
  const proj = (view === "project" || view === "piece") && findProject(id);
  if (proj) {
    const pc = view === "piece" && proj.pieces.find(x => x.id === sub);
    lastPlace = pc ? { view, id, sub } : { view, id };
    return pc ? renderPiece(proj, pc) : renderProject(proj);
  }
  if (view === "new" && draft) return renderNew();
  if (view === "edit" && p && !p.builtIn) return renderEdit(p);
  if (view === "pattern" && p) return renderPattern(p);
  if (view === "work" && p) return renderWork(p);
  renderHome();
}

function renderHome() {
  app.innerHTML = `
  <div class="screen stack">
    <div class="topbar"><h1 id="appTitle">Row by Row</h1>${NOTES_BTN}<button class="iconbtn" data-act="scale" aria-label="Change text size">Aa</button></div>
    <p class="muted">Pick a pattern to keep crocheting.</p>
    ${homeMsg ? `<p class="tip" role="status" style="margin:0">${esc(homeMsg)}</p>` : ""}
    ${[...allPatterns(), ...myProjects()].sort((a, b) => lastUsed(b) - lastUsed(a)).map(p => {
      if (p.kind === "written") return projectCard(p);
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
    <button class="btn quiet" data-act="new-picture">＋ New pattern from a chart or pixel art</button>
    <input type="file" id="picFile" accept="image/*" hidden>
    ${syncCardHtml()}
    ${backupCardHtml()}
    <button class="card pattern-card" data-go="#feedback" style="grid-template-columns:48px minmax(0,1fr)">
      <span class="note-icon" aria-hidden="true">${BUBBLE_SVG}</span>
      <span><b>Ideas, problems, or a pattern wish?</b><span class="muted small">Write a note any time and send it when you're ready.${pendingNotes().length ? ` <b style="display:inline;font-size:1em;color:var(--accent)">${pendingNotes().length} waiting to send.</b>` : ""}</span></span>
    </button>
    ${Math.random() < 0.1 ? loveLine() : ""}
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
      <button class="btn quiet" data-go="#edit/${p.id}">Fix squares and colors</button>
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
    nameBox.addEventListener("input", rename);   // as she types, so a redraw (rotation, sync) can't drop it
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
        ${loveLine()}
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
  if (window.syncState().status === "synced") uploadAtts();
  const v = route()[0];
  if (v === "home" || (["pattern", "work", "project", "piece"].includes(v) && remoteChanged)) render();
}
window.RBR = { getData: () => data, resnap, save, onSyncChange,
  persist };

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
let feedbackMsg = "", attNoRoom = false;
if (!data.notes) data.notes = [];
if (data.settings.includeWhere === undefined) data.settings.includeWhere = true;
const pendingNotes = () => data.notes.filter(n => !n.sent && !n.deleted);

function whereText() {
  if (!lastPlace) return "";
  if (lastPlace.view === "new") return draft ? `Making a new pattern, ${draft.g.cols} × ${draft.g.rows} ${draft.kind === "chart" ? "from a chart" : "from pixel art"}` : "";
  const proj = findProject(lastPlace.id);
  if (proj) {
    const pc = proj.pieces.find(x => x.id === lastPlace.sub);
    if (!pc) return proj.name;
    const st = pieceState(proj, pc), s = st.steps[st.i];
    return `${proj.name}, ${pc.name}${pc.count > 1 ? ` ${Math.min(st.made + 1, pc.count)} of ${pc.count}` : ""}, ` +
      (st.done ? "finished" : `${s.part}${s.label ? ", " + s.label : ""}`);
  }
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
  const note = { id: Date.now(), text, at: Date.now(), where: data.settings.includeWhere ? whereText() : "", sent: false };
  if (!attachToNote(note, data.settings.includeScreen !== false)) attNoRoom = true;
  data.notes.push(note);
  data.draft = ""; save(); return true;
}

function composeMessage(list) {
  return "Row by Row notes\n\n" + list.map((n, i) =>
    `${list.length > 1 ? `${i + 1}) ` : ""}${n.text}\n   (${when(n.at)}${n.where ? " · " + n.where : ""})`).join("\n\n");
}

const signedIn = () => !!(window.syncState && window.syncState().user && window.syncFlush);

// Signed in: Send marks the notes for the inbox; they travel with her synced data and
// tools/read_feedback.py picks them up there. Otherwise (or if she picks Share), the phone's share menu.
async function sendNotes(viaShare) {
  saveDraftAsNote();
  const list = pendingNotes();
  if (!list.length) { feedbackMsg = "Write a note first, then tap Send."; return render(); }
  if (!viaShare && signedIn()) {
    const from = window.syncState().user.email || "", device = navigator.userAgent.slice(0, 300);
    list.forEach(n => Object.assign(n, { sent: true, sentAt: Date.now(), via: "inbox", from, device }));
    save();
    feedbackMsg = "Sending..."; render();
    document.querySelectorAll('[data-act="send-notes"],[data-act="share-notes"]').forEach(b => b.disabled = true);
    try {
      await window.syncFlush();
      await Promise.race([uploadAtts(), new Promise(r => setTimeout(r, 20000))]);
      const left = list.some(n => (n.atts || []).some(a => !a.up));
      feedbackMsg = (list.length === 1 ? "Sent. Thank you!" : `${list.length} notes sent. Thank you!`) +
        (left ? " The pictures will follow on their own when the connection is better." : "");
    } catch (e) {
      feedbackMsg = "Saved. It will reach the inbox on its own as soon as you're back online.";
    }
    return render();
  }
  const text = composeMessage(list);
  if (navigator.share) {
    try {
      const files = attFiles(list), withFiles = files.length && navigator.canShare && navigator.canShare({ files, text });
      await navigator.share(withFiles ? { title: "Row by Row notes", text, files } : { title: "Row by Row notes", text });
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
  const back = lastPlace ? "#" + [lastPlace.view, lastPlace.id, lastPlace.sub].filter(Boolean).join("/") : "#home";
  const noteItem = (n, canDelete) => `
    <div class="note">
      <p style="margin:0;white-space:pre-wrap">${esc(n.text)}</p>
      ${noteAttsHtml(n)}
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
    ${attNoRoom ? `<p class="tip" role="alert" style="margin:0">Your note is saved, but its pictures didn't fit on this phone, so they were left off.</p>` : ""}
    <div class="card stack">
      <label for="noteText" class="field-label" style="margin:0">Write a note</label>
      <textarea id="noteText" rows="5" placeholder="What's on your mind? Something confusing, a wish, a problem..."
        style="width:100%;min-height:140px;border-radius:12px;border:1px solid var(--line);padding:12px;font:inherit;background:var(--surface);color:var(--ink);resize:vertical">${esc(data.draft || "")}</textarea>
      <p class="small muted" style="margin:0">Tip: tap the microphone on your keyboard to talk instead of typing.</p>
      <p class="small" style="margin:0"><button class="linkbtn" data-act="ask-pattern" style="min-height:0;padding:0">Ask for a pattern</button>:
        describe what you'd like, or add a picture of it, and send. It comes back as a link you tap to add it.</p>
      ${where ? `<label class="check"><input type="checkbox" id="includeWhere" ${data.settings.includeWhere ? "checked" : ""}>
        <span>Add where I am: <b>${esc(where)}</b></span></label>` : ""}
      ${attachHtml()}
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
  feedbackMsg = ""; attNoRoom = false;
  wireAttach();
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
    if (n) { (n.atts || []).forEach(a => attDrop(a.id)); n.deleted = true; n.text = ""; n.where = ""; delete n.atts; }
    save(); return render();
  }
  const act = t.dataset.act;
  if (act === "ask-pattern") {
    const box = document.getElementById("noteText");
    if (!/^pattern request/i.test(box.value)) box.value = "Pattern request: " + box.value;
    data.draft = box.value; save();
    box.focus(); box.setSelectionRange(box.value.length, box.value.length);
    return;
  }
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
  if (act === "next") { moveTo(pr, pr.step + 1, 0); save(); render(); if (Math.random() < 1 / 30) loveToast(); return scrollTo(0, 0); }
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
const MAX_COLORS = 10;   // the most yarn colors she wants in one project (6-10 is the sweet spot)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };

function loadPicture(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);   // transparent parts count as white everywhere
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("not a picture")); };
    img.src = url;
  });
}

// Patterns come from ready-made charts or pixel art only (real photos turn into blobs and too many colors).
// Both are read the same way: a grid over the picture, one color per square from the middle of each square.
async function startDraft(file) {
  app.innerHTML = `<div class="screen"><p class="muted" role="status">Reading the picture...</p></div>`;
  await new Promise(r => setTimeout(r, 30));   // let that show before the work starts
  let pic;
  try { pic = await loadPicture(file); }
  catch (e) { homeMsg = "That file couldn't be opened as a picture. Try a JPG or PNG."; return go("#home"); }
  const w = pic.width, h = pic.height, px = pic.getContext("2d").getImageData(0, 0, w, h).data;
  const { grid, pixel } = analyzePicture(px, w, h);
  let found = null, kind = null;
  if (grid) { found = refineGrid(px, w, h, grid); kind = "chart"; }   // and correct a near-miss
  else if (pixel && w / pixel >= 5 && h / pixel >= 5 && w / pixel <= 150 && h / pixel <= 150) {
    // Uneven pixel art: no exact reading, so a grid over the whole picture sized to its blocks.
    found = { x0: 0, x1: w, y0: 0, y1: h, cols: Math.round(w / pixel), rows: Math.round(h / pixel) };
    kind = "pixel";
  }
  if (!found) {
    homeMsg = "That picture doesn't look like a chart or pixel art, so it can't be made into a pattern. " +
      "Row by Row works with ready-made charts and blocky pixel-art pictures.";
    return go("#home");   // go() draws home once, with the message
  }
  const distinct = readChart(px, w, found).distinct;   // its own colors, with same-looking shades combined
  draft = { pic, px, kind, found, g: { ...found }, distinct, k: clamp(distinct, 2, MAX_COLORS),
    name: "", border: 0, borderCode: "A", names: [], view: "pattern", result: null };
  go("#new");
}

function computeDraft(d) {
  const g = readChart(d.px, d.pic.width, d.g, d.k);
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

function renderNew() {
  const d = draft, chart = d.kind === "chart";
  if (!d.result) computeDraft(d);
  const step = (act, label, aria) => `<button class="iconbtn" data-adj="${act}" aria-label="${aria}">${label}</button>`;
  app.innerHTML = `
  <div class="screen stack">
    <div class="topbar"><button class="iconbtn" id="dCancel" aria-label="Cancel">←</button>
      <div class="title"><b>New pattern</b><span>${chart ? "From a chart" : "From pixel art"}</span></div>${NOTES_BTN}</div>
    <p class="tip" style="margin:0">${chart
      ? "This looks like a chart, so each square is read exactly."
      : `This is pixel art with uneven squares, so it can't be read exactly. It's sized to match its squares (${d.found.cols} × ${d.found.rows}).`}</p>
    <div class="seg" role="group" aria-label="Show">
      <button data-view="pattern" aria-pressed="${d.view === "pattern"}">Pattern</button>
      <button data-view="photo" aria-pressed="${d.view === "photo"}">${chart ? "Chart" : "Picture"}</button></div>
    <div class="chart-wrap editor-preview" id="chartWrap"><canvas id="chart" aria-label="Preview"></canvas></div>
    <p class="small muted" style="margin:-6px 0 0">Tap ${chart ? "Chart" : "Picture"} to check that the pink lines sit on its squares.</p>
    <div class="card stack">
      <div><label class="field-label" for="dName">Name</label>
        <input id="dName" class="text-input" value="${esc(d.name)}" placeholder="My pattern" maxlength="60" enterkeyhint="done"></div>
      ${chart ? "" : `<div><label class="field-label" for="dW">Width in squares</label>
        <input id="dW" class="text-input" type="number" inputmode="numeric" min="5" max="150" value="${d.g.cols}"></div>`}
      <p class="small muted" id="dSize" style="margin:-4px 0 0"></p>
      ${d.distinct > 2 ? `<div><label class="field-label" for="dK">Colors: up to <span id="dKv">${d.k}</span></label>
        <input id="dK" type="range" min="2" max="${clamp(d.distinct, 2, MAX_COLORS)}" step="1" value="${d.k}"></div>` : ""}
      ${d.distinct > MAX_COLORS ? `<p class="small muted" style="margin:-6px 0 0">It has ${d.distinct} colors, so the closest ones are combined to keep it to ${MAX_COLORS}.</p>` : ""}
      ${chart ? `<details class="adjust"><summary><b>Grid doesn't line up?</b></summary>
        <div class="adjust-grid">
          <span>Columns</span>${step("cols-", "−", "Fewer columns")}<b id="dCols">${d.g.cols}</b>${step("cols+", "+", "More columns")}
          <span>Rows</span>${step("rows-", "−", "Fewer rows")}<b id="dRows">${d.g.rows}</b>${step("rows+", "+", "More rows")}
          <span>Left edge</span>${step("left-out", "←", "Move left edge out")}<i></i>${step("left-in", "→", "Move left edge in")}
          <span>Right edge</span>${step("right-in", "←", "Move right edge in")}<i></i>${step("right-out", "→", "Move right edge out")}
          <span>Top edge</span>${step("top-out", "↑", "Move top edge out")}<i></i>${step("top-in", "↓", "Move top edge in")}
          <span>Bottom edge</span>${step("bottom-in", "↑", "Move bottom edge in")}<i></i>${step("bottom-out", "↓", "Move bottom edge out")}
        </div>
        <p class="small muted" style="margin:8px 0 0">The grid was checked and lined up automatically. These are here in case it still missed.
          Columns and rows respace the whole grid; the edges add or remove one square at that side.</p>
        <button class="linkbtn" data-adj="reset">Start over with what was found</button>
      </details>` : ""}
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
  const update = () => {
    if (queued) return; queued = true;
    requestAnimationFrame(() => { queued = false; computeDraft(d); drawDraft(); });
  };
  const $ = id => document.getElementById(id);
  $("dCancel").onclick = () => { draft = null; go("#home"); };
  $("dName").oninput = e => d.name = e.target.value;
  $("dName").onkeydown = e => { if (e.key === "Enter") e.target.blur(); };
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
  if ($("dK")) $("dK").oninput = e => { d.k = +e.target.value; $("dKv").textContent = d.k; update(); };
  if ($("dW")) {   // pixel art: a smaller or bigger version, keeping the picture's shape
    $("dW").oninput = e => {
      const v = parseInt(e.target.value, 10);
      if (!(v >= 5 && v <= 150)) return;
      d.g = { ...d.g, cols: v, rows: clamp(Math.round(v * d.pic.height / d.pic.width), 5, 150) }; update();
    };
    $("dW").onchange = e => { e.target.value = d.g.cols; };
  }
  app.querySelectorAll("[data-adj]").forEach(b => b.onclick = () => {
    const g = b.dataset.adj === "reset" ? { ...d.found } : nudgeGrid(d.g, b.dataset.adj, d.pic.width, d.pic.height);
    if (!g) return;
    d.g = g; $("dCols").textContent = g.cols; $("dRows").textContent = g.rows; update();
  });
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
  if (d.view === "photo") {
    // The picture with the grid it was read with drawn on top, half a square of margin around it.
    const g = d.g, cw = (g.x1 - g.x0) / g.cols, ch = (g.y1 - g.y0) / g.rows, cell = fit(g.cols + 1, g.rows + 1);
    const ctx = sizeCanvas(cv, (g.cols + 1) * cell, (g.rows + 1) * cell);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, (g.cols + 1) * cell, (g.rows + 1) * cell);
    ctx.drawImage(d.pic, g.x0 - cw / 2, g.y0 - ch / 2, cw * (g.cols + 1), ch * (g.rows + 1), 0, 0, (g.cols + 1) * cell, (g.rows + 1) * cell);
    ctx.strokeStyle = "rgba(233,30,140,.9)"; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i <= g.cols; i++) { const x = Math.round((i + 0.5) * cell) + 0.5; ctx.moveTo(x, cell / 2); ctx.lineTo(x, (g.rows + 0.5) * cell); }
    for (let j = 0; j <= g.rows; j++) { const y = Math.round((j + 0.5) * cell) + 0.5; ctx.moveTo(cell / 2, y); ctx.lineTo((g.cols + 0.5) * cell, y); }
    ctx.stroke();
  } else drawChart(cv, p, { cell: fit(W, H) });
  const counts = {}; p.grid.join("").split("").forEach(k => counts[k] = (counts[k] || 0) + 1);
  const n = p.colors.length;
  document.getElementById("dSize").textContent =
    `${W} × ${H} squares${d.border ? " with the border" : ""}, ${n} color${n === 1 ? "" : "s"}. In C2C with 1 in blocks, about ${W} × ${H} in.` +
    (d.kind === "chart" && d.result.distinct > d.distinct * 1.5 + 2 ? " The grid is picking up a lot more colors than before, which usually means it's off." : "");
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
  // The same id on a retry, so a failed save tapped twice doesn't make two patterns.
  const id = d.savedId || (d.savedId = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  if (data.patterns[id] && !d.name.trim()) name = data.patterns[id].name;   // a retry keeps the name it was given
  data.patterns[id] = { id, name, grid: p.grid, colors: p.colors.map(c => ({ ...c, name: c.name.trim() || colorName(c.hex) })), created: Date.now() };
  if (!save()) return;   // keep the editor open; the warning at the top explains, and Save can be tapped again
  draft = null; go(`#pattern/${id}`);
}
app.addEventListener("click", e => { if (e.target.id === "dSave" && draft) saveDraft(); });

// ---------- fix squares and colors (her own patterns) ----------
// Works on a copy; Save replaces the pattern. The size never changes, so her place in it stays valid.
let editing = null;
const ZOOMS = [6, 8, 10, 14, 18, 24, 30];

function renderEdit(p) {
  if (!editing || editing.id !== p.id) {
    const fit = Math.floor((Math.min(innerWidth, 640) - 34) / p.grid[0].length);
    editing = { id: p.id, grid: p.grid.map(r => r.split("")), colors: p.colors.map(c => ({ ...c })), brush: p.colors[0].code,
      tool: "paint", cell: fit >= 12 ? Math.min(fit, 30) : 14, undo: [], dirty: false, combining: null };
  }
  const e = editing, used = {};
  e.grid.forEach(r => r.forEach(k => used[k] = (used[k] || 0) + 1));
  app.innerHTML = `
  <div class="screen stack">
    <div class="topbar"><button class="iconbtn" id="eBack" aria-label="Back">←</button>
      <div class="title"><b>Fix squares and colors</b><span>${esc(p.name)}</span></div>
      <button class="iconbtn" id="eUndo" aria-label="Undo" ${e.undo.length ? "" : "disabled"} style="padding:0 12px">Undo</button></div>
    <div id="eLeave" class="card stack" hidden>
      <p style="margin:0">Leave without saving your changes?</p>
      <button class="btn danger" id="eDiscard">Leave without saving</button>
      <button class="btn quiet" id="eStay">Keep editing</button></div>
    <div class="brushes" role="radiogroup" aria-label="Paint with">${e.colors.map(c => `
      <button class="brush" role="radio" data-brush="${c.code}" aria-checked="${c.code === e.brush}" aria-label="Paint with ${esc(c.name)}"
        style="background:${c.hex};color:${textOn(c.hex)}">${c.code}</button>`).join("")}</div>
    <div style="display:flex;gap:8px;align-items:center">
      <div class="seg" role="group" aria-label="Tool" style="flex:1">
        <button data-tool="paint" aria-pressed="${e.tool === "paint"}">Paint</button>
        <button data-tool="fill" aria-pressed="${e.tool === "fill"}">Fill</button></div>
      <button class="iconbtn" data-zoom="-1" aria-label="Zoom out">−</button>
      <button class="iconbtn" data-zoom="1" aria-label="Zoom in">+</button></div>
    <div class="chart-wrap" id="chartWrap"><canvas id="chart" class="edit-canvas" aria-label="Pattern. Tap a square to change it."></canvas></div>
    <p class="small muted" style="margin:-6px 0 0">${e.tool === "fill"
      ? "Tap a square to recolor the whole area of that color around it."
      : "Pick a color above, then tap squares to paint them."}</p>
    <div class="card stack"><div><h2 style="margin:0 0 4px">Yarn colors</h2>
      <p class="small muted" style="margin:0">Tap a swatch to change its shade. Combine turns every square of one color into another.</p></div>
      <div class="key">${e.colors.map(c => e.combining === c.code ? `
        <div class="stack" style="gap:8px"><b>Combine ${esc(c.name)} into:</b>
          <div class="brushes">${e.colors.filter(o => o.code !== c.code).map(o => `
            <button class="brush" data-into="${o.code}" aria-label="Into ${esc(o.name)}" style="background:${o.hex};color:${textOn(o.hex)}">${o.code}</button>`).join("")}</div>
          <button class="linkbtn" data-combine-cancel>Cancel</button></div>` : `
        <div class="key-row edit-row">
          <input type="color" class="sw-pick" data-shade="${c.code}" value="${c.hex}" aria-label="Shade of ${esc(c.name)}">
          <span class="code">${c.code}</span>
          <input class="text-input slim" data-rename="${c.code}" value="${esc(c.name)}" maxlength="40" aria-label="Name for color ${c.code}">
          <span class="num">${fmt(used[c.code] || 0)}</span>
          ${e.colors.length > 1 ? `<button class="linkbtn" data-combine="${c.code}">Combine</button>` : "<span></span>"}</div>`).join("")}</div>
      ${e.colors.length < MAX_COLORS
        ? `<label class="linkbtn add-color">＋ Add a color<input type="color" id="eAdd" value="#888888" class="visually-hidden"></label>`
        : `<p class="small muted" style="margin:0">That's ${MAX_COLORS} colors, the most for one project. Combine two to make room for another.</p>`}
    </div>
    <button class="btn primary" id="eSave">${e.dirty ? "Save changes" : "Done"}</button>
  </div>`;

  const $ = id => document.getElementById(id);
  const W = e.grid[0].length, H = e.grid.length;
  drawChart($("chart"), { grid: e.grid.map(r => r.join("")), colors: e.colors }, { cell: e.cell });
  const remember = () => {
    e.undo.push({ grid: e.grid.map(r => r.slice()), colors: e.colors.map(c => ({ ...c })) });
    if (e.undo.length > 50) e.undo.shift();
    e.dirty = true;
  };
  const again = () => {   // redraw, keeping the chart scrolled where she was
    const w = $("chartWrap"), t = w.scrollTop, l = w.scrollLeft, y = scrollY;
    renderEdit(p); $("chartWrap").scrollTop = t; $("chartWrap").scrollLeft = l; scrollTo(0, y);
  };

  $("chart").addEventListener("click", ev => {
    const r = $("chart").getBoundingClientRect();
    const x = Math.floor((ev.clientX - r.left) / e.cell), y = Math.floor((ev.clientY - r.top) / e.cell);
    if (x < 0 || y < 0 || x >= W || y >= H || e.grid[y][x] === e.brush) return;
    remember();
    if (e.tool === "paint") e.grid[y][x] = e.brush;
    else {                                   // fill the connected area of the tapped color
      const from = e.grid[y][x], stack = [[y, x]];
      while (stack.length) {
        const [yy, xx] = stack.pop();
        if (yy < 0 || xx < 0 || yy >= H || xx >= W || e.grid[yy][xx] !== from) continue;
        e.grid[yy][xx] = e.brush; stack.push([yy + 1, xx], [yy - 1, xx], [yy, xx + 1], [yy, xx - 1]);
      }
    }
    again();
  });
  app.querySelectorAll("[data-brush]").forEach(b => b.onclick = () => { e.brush = b.dataset.brush; again(); });
  app.querySelectorAll("[data-tool]").forEach(b => b.onclick = () => { e.tool = b.dataset.tool; again(); });
  app.querySelectorAll("[data-zoom]").forEach(b => b.onclick = () => {
    const i = ZOOMS.findIndex(v => v >= e.cell);
    e.cell = ZOOMS[clamp((i < 0 ? ZOOMS.length - 1 : i) + +b.dataset.zoom, 0, ZOOMS.length - 1)]; again();
  });
  $("eUndo").onclick = () => { const u = e.undo.pop(); if (!u) return; e.grid = u.grid; e.colors = u.colors; e.dirty = true; again(); };
  app.querySelectorAll("[data-rename]").forEach(inp => inp.oninput = () => {
    const c = e.colors.find(c => c.code === inp.dataset.rename);
    if (c) { c.name = inp.value; e.dirty = true; $("eSave").textContent = "Save changes"; }
  });
  app.querySelectorAll("[data-shade]").forEach(inp => inp.onchange = () => {
    const c = e.colors.find(c => c.code === inp.dataset.shade);
    if (c && /^#[0-9a-f]{6}$/i.test(inp.value)) { remember(); c.hex = inp.value.toLowerCase(); again(); }
  });
  app.querySelectorAll("[data-combine]").forEach(b => b.onclick = () => { e.combining = b.dataset.combine; again(); });
  app.querySelectorAll("[data-combine-cancel]").forEach(b => b.onclick = () => { e.combining = null; again(); });
  app.querySelectorAll("[data-into]").forEach(b => b.onclick = () => {
    const from = e.combining, into = b.dataset.into;
    remember();
    e.grid.forEach(r => r.forEach((k, i) => { if (k === from) r[i] = into; }));
    e.colors = e.colors.filter(c => c.code !== from);
    if (e.brush === from) e.brush = into;
    e.combining = null; again();
  });
  if ($("eAdd")) $("eAdd").onchange = ev => {
    if (!/^#[0-9a-f]{6}$/i.test(ev.target.value)) return;
    const taken = new Set(e.colors.map(c => c.code)), code = [...CODES].find(k => !taken.has(k));
    remember();
    const names = new Set(e.colors.map(c => c.name)), base = colorName(ev.target.value);
    let name = base; for (let n = 2; names.has(name); n++) name = base + " " + n;
    e.colors.push({ code, name, hex: ev.target.value.toLowerCase() });
    e.brush = code; again();
  };
  const leave = () => { editing = null; go(`#pattern/${p.id}`); };
  $("eBack").onclick = () => { if (!e.dirty) return leave(); $("eLeave").hidden = false; scrollTo(0, 0); };
  $("eStay").onclick = () => { $("eLeave").hidden = true; };
  $("eDiscard").onclick = leave;
  $("eSave").onclick = () => {
    if (!e.dirty) return leave();
    const grid = e.grid.map(r => r.join("")), present = new Set(grid.join(""));
    const colors = e.colors.filter(c => present.has(c.code)).map(c => ({ code: c.code, name: c.name.trim() || colorName(c.hex), hex: c.hex }));
    // A new object, so the crochet steps are rebuilt from the new squares.
    data.patterns[p.id] = { ...data.patterns[p.id], grid, colors };
    if (!save()) return;                     // the warning at the top explains; her edits are still here
    leave();
  };
}

// ---------- little hidden notes for her ----------
// Now and then: after a row (about 1 in 30), at the bottom of home (1 in 10), on a finished pattern (always),
// and when the title is tapped three times quickly. A different language each time.
const LOVE = [
  ["English", "I love you, Momma"], ["Spanish", "Te quiero, mamá"], ["French", "Je t'aime, maman"],
  ["Italian", "Ti voglio bene, mamma"], ["German", "Ich hab dich lieb, Mama"], ["Portuguese", "Eu te amo, mãe"],
  ["Dutch", "Ik hou van je, mama"], ["Swedish", "Jag älskar dig, mamma"], ["Norwegian", "Jeg elsker deg, mamma"],
  ["Danish", "Jeg elsker dig, mor"], ["Finnish", "Rakastan sinua, äiti"], ["Polish", "Kocham cię, mamo"],
  ["Irish", "Is breá liom thú, a Mham"], ["Welsh", "Rwy'n dy garu di, Mam"], ["Hawaiian", "Aloha au iā ʻoe, Māmā"],
  ["Tagalog", "Mahal kita, Nanay"], ["Swahili", "Nakupenda, Mama"], ["Turkish", "Seni seviyorum, anne"],
  ["Vietnamese", "Con yêu mẹ"], ["Greek", "Σ' αγαπώ, μαμά", "S' agapó, mamá"], ["Russian", "Мама, я тебя люблю", "Mama, ya tebya lyublyu"],
  ["Japanese", "お母さん、大好きだよ", "Okāsan, daisuki da yo"], ["Korean", "엄마, 사랑해요", "Eomma, saranghaeyo"],
  ["Chinese", "妈妈，我爱你", "Māma, wǒ ài nǐ"], ["Arabic", "أحبك يا أمي", "Uḥibbuki yā ummī"]
];
let lastLove = -1;
function pickLove() {
  let i; do { i = Math.floor(Math.random() * LOVE.length); } while (i === lastLove && LOVE.length > 1);
  lastLove = i;
  const [lang, text, say] = LOVE[i];
  return { text, sub: lang === "English" ? "English" : `${lang} · ${say ? say + " · " : ""}I love you, Momma` };
}
function loveLine() {
  const l = pickLove();
  return `<p class="love"><span aria-hidden="true">♥</span> <b dir="auto">${esc(l.text)}</b><br><span class="small">${esc(l.sub)}</span></p>`;
}
function loveToast() {
  document.querySelectorAll(".love-toast").forEach(t => t.remove());
  const l = pickLove(), t = document.createElement("div");
  t.className = "love-toast"; t.setAttribute("role", "status");
  t.innerHTML = `<span aria-hidden="true">♥</span> <b dir="auto">${esc(l.text)}</b><span class="small">${esc(l.sub)}</span>`;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("gone"), 4500);
  setTimeout(() => t.remove(), 5500);
}
let titleTaps = [];
document.addEventListener("click", e => {
  if (e.target.id !== "appTitle") return;
  const now = Date.now(); titleTaps = titleTaps.filter(t => now - t < 1200).concat(now);
  if (titleTaps.length >= 3) { titleTaps = []; loveToast(); }
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
