// Pictures with notes: the picture she was making a pattern from (with the grid the app found drawn on it) and
// the pattern it made, a picture of the pattern she's on, or any picture she adds. Kept small (600 px JPEG).
// Until a note is sent they stay on this phone (localStorage, one key each, outside the synced data). Sent to the
// inbox, each goes to the cloud as its own small entry, users/{uid}/attachments/{id}, which her own-data rules
// already allow; tools/read_feedback.py saves them. Sent through the share menu, they go along as files.
"use strict";

const ATT_KEY = "rowbyrow.att.", ATT_MAX = 3;
let noteAtts = [];   // pictures she has added to the note she's writing: { id, kind, data }

function shrinkToJpeg(src, max = 600) {
  const k = Math.min(1, max / Math.max(src.width, src.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  let q = 0.8, url = c.toDataURL("image/jpeg", q);
  while (url.length > 350000 && q > 0.35) { q -= 0.15; url = c.toDataURL("image/jpeg", q); }   // well under Firestore's 1 MB
  return url;
}

// What she's looking at, as pictures: [{ kind, label, make }], made only if she keeps the box ticked.
function screenShots() {
  const v = lastPlace && lastPlace.view;
  if (v === "new" && draft && draft.pic) return [{ kind: "picture", label: "the picture I loaded", make: () => {
      const d = draft, c = document.createElement("canvas"), w = d.pic.width, h = d.pic.height;
      c.width = w; c.height = h;
      const ctx = c.getContext("2d"), g = d.g, cw = (g.x1 - g.x0) / g.cols, ch = (g.y1 - g.y0) / g.rows;
      ctx.drawImage(d.pic, 0, 0);
      ctx.strokeStyle = "rgba(230,0,120,0.85)"; ctx.lineWidth = Math.max(1, w / 600); ctx.beginPath();   // the grid the app found
      for (let i = 0; i <= g.cols; i++) { ctx.moveTo(g.x0 + i * cw, g.y0); ctx.lineTo(g.x0 + i * cw, g.y1); }
      for (let i = 0; i <= g.rows; i++) { ctx.moveTo(g.x0, g.y0 + i * ch); ctx.lineTo(g.x1, g.y0 + i * ch); }
      ctx.stroke();
      return shrinkToJpeg(c, 900);
    } }, { kind: "pattern", label: "the pattern it made", make: () => patternShot(draftPattern(draft)) }];
  const p = lastPlace && (v === "pattern" || v === "work") && findPattern(lastPlace.id);
  if (p) return [{ kind: "pattern", label: "a picture of this pattern", make: () => patternShot(p) }];
  return [];
}
function patternShot(p) {
  const c = document.createElement("canvas"), W = p.grid[0].length, H = p.grid.length, cell = Math.max(2, Math.floor(600 / Math.max(W, H)));
  c.width = W * cell; c.height = H * cell;
  const ctx = c.getContext("2d"), cm = colorMap(p);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { ctx.fillStyle = cm[p.grid[y][x]].hex; ctx.fillRect(x * cell, y * cell, cell, cell); }
  if (cell >= 5) {
    ctx.strokeStyle = "rgba(0,0,0,0.15)"; ctx.beginPath();
    for (let x = 0; x <= W; x++) { ctx.moveTo(x * cell + .5, 0); ctx.lineTo(x * cell + .5, H * cell); }
    for (let y = 0; y <= H; y++) { ctx.moveTo(0, y * cell + .5); ctx.lineTo(W * cell, y * cell + .5); }
    ctx.stroke();
  }
  return shrinkToJpeg(c);
}

const attId = () => "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const attData = id => { try { return localStorage.getItem(ATT_KEY + id); } catch (e) { return null; } };
function attDrop(id) { try { localStorage.removeItem(ATT_KEY + id); } catch (e) {} }

// When a note is saved: keep its pictures on this phone and list them on the note. Returns false if they don't fit.
function attachToNote(note, withScreen) {
  const list = [];
  if (withScreen) for (const s of screenShots()) { try { list.push({ id: attId(), kind: s.kind, data: s.make() }); } catch (e) {} }
  list.push(...noteAtts);
  if (!list.length) return true;
  try { for (const a of list) localStorage.setItem(ATT_KEY + a.id, a.data); }
  catch (e) { list.forEach(a => attDrop(a.id)); return false; }
  note.atts = list.map(a => ({ id: a.id, kind: a.kind }));
  noteAtts = [];
  return true;
}

// Send the pictures of inbox notes that haven't gone up yet. Safe to call any time; does nothing signed out.
let attBusy = false;
async function uploadAtts() {
  if (attBusy || !window.syncUpload || !(window.syncState && window.syncState().user)) return;
  attBusy = true;
  let any = false;
  try {
    for (const n of data.notes || []) {
      if (n.via !== "inbox" || n.deleted || !n.atts) continue;
      for (const a of n.atts) {
        if (a.up) continue;
        const d = attData(a.id);
        if (!d) continue;
        await window.syncUpload(a.id, { data: d, kind: a.kind, note: n.id, at: n.at || Date.now() });
        a.up = true; attDrop(a.id); any = true;
      }
    }
  } catch (e) { /* offline or not ready: tried again next time */ }
  finally { attBusy = false; if (any) save(); }
}

// Files for the share menu (signed out).
function attFiles(notes) {
  const files = [];
  for (const n of notes) for (const a of n.atts || []) {
    const d = attData(a.id); if (!d) continue;
    try {
      const bin = atob(d.split(",")[1]), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      files.push(new File([u8], `row-by-row-${a.kind}-${files.length + 1}.jpg`, { type: "image/jpeg" }));
    } catch (e) {}
  }
  return files;
}

// ----- on the notes screen -----
function attachHtml() {
  const shots = screenShots();
  const thumbs = noteAtts.map((a, i) => `<span class="att"><img src="${a.data}" alt="Added picture ${i + 1}">
      <button class="att-x" data-attx="${i}" aria-label="Remove picture ${i + 1}">✕</button></span>`).join("");
  return `
    ${shots.length ? `<label class="check"><input type="checkbox" id="includeScreen" ${data.settings.includeScreen !== false ? "checked" : ""}>
      <span>Add ${shots.map(s => s.label).join(" and ")}</span></label>` : ""}
    ${noteAtts.length ? `<div class="att-row">${thumbs}</div>` : ""}
    ${noteAtts.length < ATT_MAX ? `<button class="linkbtn" data-attadd style="justify-self:start;align-self:flex-start">＋ Add a picture</button>` : ""}
    <input type="file" id="attFile" accept="image/*" hidden>`;
}
function noteAttsHtml(n) {
  if (!n.atts || !n.atts.length) return "";
  const local = n.atts.map(a => attData(a.id)).filter(Boolean);
  return local.length ? `<div class="att-row">${local.map((d, i) => `<span class="att"><img src="${d}" alt="Picture ${i + 1}"></span>`).join("")}</div>`
    : `<p class="small muted" style="margin:4px 0 0">${n.atts.length} picture${n.atts.length > 1 ? "s" : ""}</p>`;
}
function wireAttach() {
  const inc = document.getElementById("includeScreen");
  if (inc) inc.addEventListener("change", () => { data.settings.includeScreen = inc.checked; persist(); });
  const f = document.getElementById("attFile");
  if (f) f.addEventListener("change", async () => {
    const file = f.files[0]; f.value = "";
    if (!file) return;
    try {
      const img = await loadPicture(file);
      noteAtts.push({ id: attId(), kind: "added", data: shrinkToJpeg(img) });
    } catch (e) { feedbackMsg = "That file couldn't be opened as a picture."; }
    render();
  });
}
document.addEventListener("click", e => {
  const t = e.target.closest("[data-attx],[data-attadd]");
  if (!t || !app.contains(t) || route()[0] !== "feedback") return;
  if (t.dataset.attx !== undefined) { noteAtts.splice(+t.dataset.attx, 1); return render(); }
  document.getElementById("attFile").click();
});
