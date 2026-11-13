// Ready-made patterns: a gallery she can pick from (#library), each shown bigger before adding (#library/<id>).
// Adding copies the pattern into her own patterns, so it syncs, keeps her place, and can be fixed, renamed or deleted
// like any pattern she made; her home list only shows what she has picked. The designs are in library-data.js
// (written by tools/build_library.py), all 6 to 10 yarn colors.
"use strict";

const libHave = it => { const p = data.patterns[it.id]; return !!(p && !p.deleted && p.grid); };
const libFind = id => (typeof LIBRARY !== "undefined" ? LIBRARY : []).find(it => it.id === id);
const GRID_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>`;

function libraryCardHtml() {
  if (typeof LIBRARY === "undefined" || !LIBRARY.length) return "";
  return `<button class="card pattern-card" data-go="#library" style="grid-template-columns:48px minmax(0,1fr)">
      <span class="note-icon" aria-hidden="true">${GRID_SVG}</span>
      <span><b>Ready-made patterns</b><span class="muted small">${LIBRARY.length} designs to pick from: animals, flowers, treats and more.</span></span>
    </button>`;
}

function renderLibrary() {
  const groups = [];
  for (const it of LIBRARY) { let g = groups.find(g => g.name === it.group); if (!g) groups.push(g = { name: it.group, items: [] }); g.items.push(it); }
  app.innerHTML = `
  <div class="screen stack">
    <div class="topbar">
      <div class="title"><b>Ready-made patterns</b><span>Tap one to see it bigger</span></div>
      <button class="iconbtn" data-act="scale" aria-label="Change text size">Aa</button>
    </div>
    ${groups.map(g => `<h2 class="sec">${esc(g.name)}</h2>
      <div class="lib-grid">${g.items.map(it => `
        <button class="card lib-card" data-go="#library/${it.id}">
          <canvas data-lib="${it.id}" aria-hidden="true"></canvas>
          <b>${esc(it.name)}</b>
          <span class="small muted">${it.grid[0].length} × ${it.grid.length} · ${it.colors.length} colors${libHave(it) ? ` · <span style="color:var(--done);font-weight:700">✓ Added</span>` : ""}</span>
        </button>`).join("")}</div>`).join("")}
  </div>${tabsHtml("#library")}`;
  app.querySelectorAll("[data-lib]").forEach(cv => {
    const it = libFind(cv.dataset.lib), W = it.grid[0].length, H = it.grid.length;
    const box = Math.max(60, (Math.min(innerWidth, 640) - 80) / 2 - 24);
    drawChart(cv, it, { cell: Math.max(1, box / Math.max(W, H)) });
  });
}

function renderLibraryItem(it) {
  const W = it.grid[0].length, H = it.grid.length, have = libHave(it), counts = {};
  it.grid.join("").split("").forEach(k => counts[k] = (counts[k] || 0) + 1);
  app.innerHTML = `
  <div class="screen stack">
    <div class="topbar">
      <button class="iconbtn" data-go="#library" aria-label="Back to ready-made patterns">←</button>
      <div class="title"><b>${esc(it.name)}</b><span>${W} × ${H} squares, ${fmt(W * H)} stitches</span></div>
      <button class="iconbtn" data-act="scale" aria-label="Change text size">Aa</button>
    </div>
    <div class="card stack taped tape-lav">
      <canvas id="libChart" aria-label="${esc(it.name)} pattern" style="justify-self:center;align-self:center;border-radius:8px"></canvas>
      ${have
        ? `<p class="tip" style="margin:0">This one is already in your patterns.</p>
           <button class="btn primary" data-go="#pattern/${it.id}">Open my copy</button>`
        : `<button class="btn primary" id="libAdd">Add to my patterns</button>`}
      <p class="small muted" style="margin:0">After adding it you can change any colors or squares with Fix squares and colors.</p>
    </div>
    <div class="card">
      <h2>Yarn colors (${it.colors.length})</h2>
      <div class="key">${it.colors.map(c => `
        <div class="key-row"><span class="sw" style="background:${c.hex}"></span><span class="code">${esc(c.code)}</span>
        <span>${esc(c.name)}</span><span class="num">${fmt(counts[c.code] || 0)}</span></div>`).join("")}</div>
    </div>
  </div>`;
  const cell = Math.max(2, Math.floor((Math.min(innerWidth, 640) - 70) / Math.max(W, H * 0.8)));
  drawChart(document.getElementById("libChart"), it, { cell });
  const add = document.getElementById("libAdd");
  if (add) add.onclick = () => {
    data.patterns[it.id] = { id: it.id, name: it.name, grid: it.grid.slice(), colors: it.colors.map(c => ({ ...c })), created: Date.now() };
    if (!save()) return;   // the warning at the top explains
    go(`#pattern/${it.id}`);
  };
}
