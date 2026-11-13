// Backup and restore: one file with her patterns, her place in each, her style choices and her notes.
// Restoring only adds: it brings back what's missing here and moves her place forward where the backup is
// further along. It never removes or rolls back anything, so restoring an old file can't undo her work.
"use strict";

const BACKUP_APP = "row-by-row";

// ----- pure parts (also used by tests/backup.test.js) -----
function makeBackup(d, now) {
  const patterns = {};
  for (const k in d.patterns || {}) if (!d.patterns[k].deleted) patterns[k] = d.patterns[k];
  return { app: BACKUP_APP, kind: "backup", version: 1, savedAt: now, data: {
    patterns, progress: d.progress || {}, prefs: d.prefs || {}, notes: (d.notes || []).filter(n => !n.deleted) } };
}

// A saved chart pattern, checked the same strict way imports are: anything odd is refused, unknown fields dropped.
function cleanChart(o) {
  const bad = m => { throw new Error(m); };
  if (!o || typeof o.id !== "string" || !/^[A-Za-z0-9_-]{1,60}$/.test(o.id)) bad("bad id");
  if (typeof o.name !== "string" || o.name.length > 80) bad("bad name");
  if (!Array.isArray(o.colors) || !o.colors.length || o.colors.length > 36) bad("bad colors");
  const colors = o.colors.map(c => {
    if (!c || typeof c.code !== "string" || c.code.length !== 1 || !/^#[0-9a-fA-F]{6}$/.test(c.hex || "")) bad("bad color");
    return { code: c.code, name: typeof c.name === "string" ? c.name.slice(0, 60) : "", hex: c.hex };
  });
  const codes = new Set(colors.map(c => c.code));
  const g = o.grid;
  if (!Array.isArray(g) || !g.length || g.length > 400) bad("bad grid");
  const w = typeof g[0] === "string" ? g[0].length : 0;
  if (!w || w > 400 || !g.every(r => typeof r === "string" && r.length === w && [...r].every(ch => codes.has(ch)))) bad("bad grid");
  const out = { id: o.id, name: o.name, grid: g.slice(), colors };
  if (Number.isFinite(o.created)) out.created = o.created;
  return out;
}

// Reads a backup file's text. Throws (with a message she can read) if it isn't one.
function readBackup(text) {
  let b;
  try { b = JSON.parse(text); } catch (e) { throw new Error("That file isn't a Row by Row backup."); }
  if (!b || b.app !== BACKUP_APP || b.kind !== "backup" || !b.data || typeof b.data !== "object") throw new Error("That file isn't a Row by Row backup.");
  if (b.version > 1) throw new Error("That backup was made by a newer version of Row by Row. Close the app, open it again, and try once more.");
  const src = b.data, out = { savedAt: Number.isFinite(b.savedAt) ? b.savedAt : 0, patterns: {}, progress: {}, prefs: {}, notes: [], skipped: 0 };
  for (const k in src.patterns || {}) {
    try {
      const p = src.patterns[k];
      const c = p && p.kind === "written" ? { ...cleanProject(p), ...(Number.isFinite(p.created) ? { created: p.created } : {}) } : cleanChart(p);
      if (c.id !== k) throw new Error("id mismatch");
      out.patterns[k] = c;
    } catch (e) { out.skipped++; }
  }
  const nat = v => Number.isInteger(v) && v >= 0 && v < 1e7;
  for (const k in src.progress || {}) {
    const r = src.progress[k];
    if (k.length <= 200 && r && nat(r.step) && (r.inrow === undefined || nat(r.inrow))) out.progress[k] = { step: r.step, inrow: r.inrow || 0 };
  }
  for (const k in src.prefs || {}) {
    const r = src.prefs[k];
    if (k.length <= 100 && r && (r.mode === "rows" || r.mode === "c2c")) out.prefs[k] = { mode: r.mode, hand: r.hand === "left" ? "left" : "right" };
  }
  for (const n of Array.isArray(src.notes) ? src.notes : []) {
    if (!n || !Number.isFinite(n.id) || typeof n.text !== "string" || !n.text || n.text.length > 10000) continue;
    const note = { id: n.id, text: n.text, at: Number.isFinite(n.at) ? n.at : n.id, where: typeof n.where === "string" ? n.where.slice(0, 200) : "", sent: !!n.sent };
    if (Number.isFinite(n.sentAt)) note.sentAt = n.sentAt;
    if (n.via === "inbox") note.via = "inbox";
    out.notes.push(note);
  }
  return out;
}

// Adds what's in the backup to d (in place). Returns what changed, for the message she sees.
function restoreInto(d, b) {
  const at = o => (o.step || 0) * 1000 + (o.inrow || 0);
  const did = { patterns: 0, places: 0, notes: 0 };
  d.patterns = d.patterns || {}; d.progress = d.progress || {}; d.prefs = d.prefs || {}; d.notes = d.notes || [];
  for (const k in b.patterns) {
    const cur = d.patterns[k];
    if (!cur || cur.deleted) { d.patterns[k] = b.patterns[k]; did.patterns++; }   // missing or deleted here: bring it back
  }
  for (const k in b.progress) {
    const cur = d.progress[k], r = b.progress[k];
    if (at(r) > (cur ? at(cur) : 0)) { d.progress[k] = { step: r.step, inrow: r.inrow }; did.places++; }   // only ever forward
  }
  for (const k in b.prefs) if (!d.prefs[k]) d.prefs[k] = b.prefs[k];
  const have = new Set(d.notes.map(n => String(n.id)));
  for (const n of b.notes) if (!have.has(String(n.id))) { d.notes.push(n); did.notes++; }
  if (did.notes) d.notes.sort((a, c) => a.id - c.id);
  return did;
}

// What a backup holds, in words: "3 patterns, your place in 5 of them, 2 notes".
function backupSummary(b) {
  const pats = Object.keys(b.patterns).length, places = Object.values(b.progress).filter(r => r.step || r.inrow).length, notes = b.notes.length;
  const n = (v, one, many) => `${v} ${v === 1 ? one : many}`;
  return [pats ? n(pats, "pattern", "patterns") : "", places ? `your place in ${n(places, "pattern", "patterns")}` : "", notes ? n(notes, "note", "notes") : ""]
    .filter(Boolean).join(", ");
}

// ----- the screen (#backup) -----
const BOX_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M3 4h18v4H3zM10 12h4"/></svg>`;
let backupMsg = "", pendingRestore = null;
const backupDay = t => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function backupCardHtml() {
  const last = data.settings.lastBackup;
  return `<button class="card pattern-card" data-go="#backup" style="grid-template-columns:48px minmax(0,1fr)">
      <span class="note-icon" aria-hidden="true">${BOX_SVG}</span>
      <span><b>Backup</b><span class="muted small">${last ? `Last saved ${backupDay(last)}` : "Keep a copy of your patterns and your place, just in case."}</span></span>
    </button>`;
}

function backupFile() {
  const now = Date.now(), text = JSON.stringify(makeBackup(data, now));
  const t = new Date(now), day = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  return { now, text, name: `row-by-row-backup-${day}` };
}
// Sharing a .txt is allowed on Android and iPhone (a .json isn't everywhere); restore reads either.
function shareFileFor(f) { try { return new File([f.text], f.name + ".txt", { type: "text/plain" }); } catch (e) { return null; } }
function canShareBackup() {
  if (!navigator.canShare) return false;
  const file = shareFileFor({ text: "{}", name: "test" });
  try { return !!file && navigator.canShare({ files: [file] }); } catch (e) { return false; }
}

function renderBackup() {
  const share = canShareBackup(), last = data.settings.lastBackup, p = pendingRestore;
  app.innerHTML = `
  <div class="screen stack">
    <div class="topbar">
      <button class="iconbtn" data-go="#more" aria-label="Back to More">←</button>
      <div class="title"><b>Backup</b><span>${last ? `Last saved ${backupDay(last)} on this device` : "No backup saved on this device yet"}</span></div>
      <button class="iconbtn" data-act="scale" aria-label="Change text size">Aa</button>
    </div>
    ${backupMsg ? `<p class="tip" role="status" style="margin:0">${esc(backupMsg)}</p>` : ""}
    ${p ? `<div class="card stack" id="restoreConfirm">
      <b>Restore this backup?</b>
      <p style="margin:0">From ${p.savedAt ? backupDay(p.savedAt) : "an unknown date"}: ${esc(backupSummary(p))}.</p>
      <p class="small muted" style="margin:0">This brings back anything missing here and moves your place forward where the backup is further along.
        Nothing on this device gets removed or moved back.</p>
      <button class="btn primary" data-bact="restore-yes">Restore</button>
      <button class="btn quiet" data-bact="restore-no">Cancel</button>
    </div>` : ""}
    <div class="card stack">
      <b>Save a backup</b>
      <p class="small muted" style="margin:0">One small file with all your patterns, your place in each, and your notes.
        ${share ? "Sending it to Google Drive or your email keeps it safe even if something happens to this phone." : ""}</p>
      ${share ? `<button class="btn primary" data-bact="share">Send a backup to Drive or email</button>` : ""}
      <button class="btn ${share ? "quiet" : "primary"}" data-bact="download">Save a backup on this ${share ? "phone" : "device"}</button>
    </div>
    <div class="card stack">
      <b>Restore from a backup</b>
      <p class="small muted" style="margin:0">Pick a backup file you saved before. You'll see what's in it before anything changes.</p>
      <button class="btn quiet" data-bact="pick">Choose a backup file</button>
      <input type="file" id="backupFile" hidden>
    </div>
  </div>`;
  backupMsg = "";
  document.getElementById("backupFile").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    try {
      if (f.size > 20e6) throw new Error("That file is too big to be a Row by Row backup.");
      pendingRestore = readBackup(await f.text());
      if (!Object.keys(pendingRestore.patterns).length && !Object.keys(pendingRestore.progress).length && !pendingRestore.notes.length)
        throw new Error("That backup is empty.");
    } catch (err) { pendingRestore = null; backupMsg = err.message; }
    render(); scrollTo(0, 0);
  });
}

function markBackedUp(now) { data.settings.lastBackup = now; persist(); }

document.addEventListener("click", async e => {
  const t = e.target.closest("[data-bact]");
  if (!t || t.disabled || !app.contains(t) || route()[0] !== "backup") return;
  const act = t.dataset.bact;
  if (act === "pick") return document.getElementById("backupFile").click();
  if (act === "download") {
    const f = backupFile(), url = URL.createObjectURL(new Blob([f.text], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = f.name + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    markBackedUp(f.now);
    backupMsg = "Backup saved. You'll find it in your Downloads.";
    return render();
  }
  if (act === "share") {
    const f = backupFile();
    try {
      await navigator.share({ files: [shareFileFor(f)], title: "Row by Row backup" });
      markBackedUp(f.now); backupMsg = "Backup sent. Keep it somewhere you can find it, like Google Drive.";
    } catch (err) {
      backupMsg = err && err.name === "AbortError" ? "Not sent. Nothing has changed." : "That didn't work. Try Save a backup on this phone instead.";
    }
    return render();
  }
  if (act === "restore-no") { pendingRestore = null; return render(); }
  if (act === "restore-yes" && pendingRestore) {
    const did = restoreInto(data, pendingRestore), skipped = pendingRestore.skipped;
    pendingRestore = null;
    const parts = [did.patterns && `${did.patterns} pattern${did.patterns > 1 ? "s" : ""} brought back`,
      did.places && `your place moved forward in ${did.places} pattern${did.places > 1 ? "s" : ""}`, did.notes && `${did.notes} note${did.notes > 1 ? "s" : ""} added`].filter(Boolean);
    if (parts.length && !save()) return render();   // the warning at the top explains
    backupMsg = (parts.length ? "Restored: " + parts.join(", ") + "." : "Everything in that backup is already here, so nothing needed to change.") +
      (skipped ? ` ${skipped} pattern${skipped > 1 ? "s" : ""} in the file couldn't be read and ${skipped > 1 ? "were" : "was"} left out.` : "");
    return render();
  }
});

if (typeof module !== "undefined") module.exports = { makeBackup, readBackup, restoreInto, backupSummary, cleanChart };
