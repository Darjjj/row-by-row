// Written patterns: projects made of pieces (like her Very Hungry Caterpillar), each piece followed one round at a time.
// Stored with her other patterns in data.patterns as { id, kind: "written", name, notes, pieces: [...] } and synced the same way.
// Uses globals from app.js at call time (data, save, esc, go, moveTo, loveLine, loveToast...), so it loads before it.
"use strict";

// ---------- pure helpers (also used by the tests) ----------

// One entry per round to tap through: "Rd 6–9: sc around" becomes Rd 6, Rd 7, Rd 8, Rd 9.
// Each: { part, label ("Rd 7", "Row 2", or "" for a note), text, sts, range ("6–9" or "") }.
function expandSteps(piece) {
  const out = [];
  for (const part of piece.parts || []) for (const s of part.steps || []) {
    if (s.rd === undefined) { out.push({ part: part.name, label: "", text: s.note || s.do || "", sts: null, range: "" }); continue; }
    const [a, b] = Array.isArray(s.rd) ? s.rd : [s.rd, s.rd];
    for (let r = a; r <= b; r++) out.push({ part: part.name, label: `${s.pre || "Rd"} ${r}`, text: s.do || "", sts: s.sts ?? null, range: a !== b ? `${a}–${b}` : "" });
  }
  return out;
}

// What a round's instructions should leave, from the count before it, for the usual shorthand; null if it can't tell.
// Lets the tests check a transcription against the counts she wrote.
function expectedCount(text, before) {
  const t = text.replace(/^(BLO|FLO)\s+/i, "").trim();
  let m;
  if ((m = t.match(/^(\d+) sc in magic ring/))) return +m[1];
  if (/^inc around/.test(t)) return before * 2;
  if (/^dec around/.test(t)) return before / 2;
  if (/^sc around$/.test(t)) return before;
  if ((m = t.match(/^\((\d*) ?sc, (inc|dec)\) around$/))) {
    const k = m[1] ? +m[1] : 1, reps = before / (k + (m[2] === "inc" ? 1 : 2));
    return Number.isInteger(reps) ? reps * (k + (m[2] === "inc" ? 2 : 1)) : NaN;
  }
  return null;
}

// Check an imported project and keep only what the app uses. Throws a plain-language Error if it isn't one.
function cleanProject(o) {
  const str = (v, max) => typeof v === "string" && v.length <= max ? v : (() => { throw new Error("bad text"); })();
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi ? v : (() => { throw new Error("bad number"); })();
  if (!o || o.kind !== "written" || !/^w-[a-z0-9-]{1,40}$/.test(o.id || "")) throw new Error("That link isn't a Row by Row pattern.");
  if (!Array.isArray(o.pieces) || !o.pieces.length || o.pieces.length > 60) throw new Error("bad pieces");
  const ids = new Set();
  const pieces = o.pieces.map(pc => {
    if (!/^[a-z0-9-]{1,40}$/.test(pc.id || "") || ids.has(pc.id)) throw new Error("bad piece id");
    ids.add(pc.id);
    const parts = (pc.parts || []).slice(0, 12).map(pt => ({
      name: str(pt.name, 80),
      steps: (pt.steps || []).slice(0, 200).map(s => {
        if (s.rd === undefined) return { note: str(s.note, 600) };
        const rd = Array.isArray(s.rd) ? [int(s.rd[0], 1, 500), int(s.rd[1], 1, 500)] : int(s.rd, 1, 500);
        if (Array.isArray(rd) && rd[1] < rd[0]) throw new Error("bad range");
        const step = { rd, do: str(s.do, 600) };
        if (s.pre !== undefined) step.pre = s.pre === "Row" ? "Row" : "Rd";
        if (s.sts !== undefined && s.sts !== null) step.sts = int(s.sts, 1, 2000);
        return step;
      })
    }));
    const piece = { id: pc.id, name: str(pc.name, 60), count: int(pc.count, 1, 50), parts };
    if (pc.yarn !== undefined) piece.yarn = str(pc.yarn, 120);
    return piece;
  });
  return { id: o.id, kind: "written", name: str(o.name, 80), notes: o.notes === undefined ? "" : str(o.notes, 2000), pieces };
}

// Import links carry the pattern after the # (never sent to any server): base64url of raw-deflated JSON.
async function decodeImport(code) {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser is too old to open pattern links. Try updating it.");
  const b64 = code.replace(/-/g, "+").replace(/_/g, "/"), bin = atob(b64 + "=".repeat((4 - b64.length % 4) % 4));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
  return cleanProject(JSON.parse(text));
}

// ---------- her place in a piece ----------
// One progress entry per piece counts through every copy: step = copies done × rounds per copy + round,
// so the usual sync rule (the place further along wins) works unchanged.
const pieceKey = (p, pc) => `${p.id}|piece|${pc.id}`;
function pieceProgress(p, pc) { const k = pieceKey(p, pc); return data.progress[k] || (data.progress[k] = { step: 0, inrow: 0 }); }
function pieceState(p, pc) {
  const steps = expandSteps(pc), n = steps.length, pr = pieceProgress(p, pc);
  if (!n) return { steps, n, pr, made: 0, i: 0, done: false, ready: false };
  const made = Math.min(pc.count, Math.floor(pr.step / n));
  return { steps, n, pr, made, i: pr.step % n, done: pr.step >= pc.count * n, ready: true };
}
const myProjects = () => Object.values(data.patterns).filter(p => !p.deleted && p.kind === "written" && Array.isArray(p.pieces));
const findProject = id => myProjects().find(p => p.id === id);
function projectTotals(p) {
  let made = 0, total = 0;
  for (const pc of p.pieces) { total += pc.count; made += pieceState(p, pc).made; }
  return { made, total };
}
const YARN_SVG = `<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><circle cx="24" cy="24" r="17" fill="none" stroke="currentColor" stroke-width="3"/><path d="M10 18c9 2 19 9 23 19M13 32c4-8 12-16 22-17M20 8c-1 9 3 21 13 27" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;

function projectCard(p) {
  const { made, total } = projectTotals(p);
  return `<button class="card pattern-card" data-go="#project/${p.id}">
    <span class="project-icon">${YARN_SVG}</span>
    <span><b>${esc(p.name)}</b>
      <span class="muted small">Written pattern · ${p.pieces.length} pieces</span>
      <span class="bar" style="display:block;margin:8px 0 4px"><i style="width:${total ? made / total * 100 : 0}%"></i></span>
      <span class="small">${made >= total ? "All made" : `${made} of ${total} made`}</span>
    </span></button>`;
}

// ---------- screens ----------
function renderProject(p) {
  const { made, total } = projectTotals(p);
  app.innerHTML = `
  <div class="screen stack">
    <div class="topbar"><button class="iconbtn" data-go="#home" aria-label="Back to patterns">←</button>
      <div class="title"><b>${esc(p.name)}</b><span>Written pattern</span></div>
      ${NOTES_BTN}<button class="iconbtn" data-act="scale" aria-label="Change text size">Aa</button></div>
    <div class="card stack">
      <div class="row-title"><b style="font-size:1.4em">${made} of ${total}</b><span class="muted">pieces made</span></div>
      <div class="bar"><i style="width:${total ? made / total * 100 : 0}%"></i></div>
      ${made >= total ? loveLine() : ""}
    </div>
    ${p.notes ? `<details class="card"><summary><b>Materials and notes</b></summary><p style="white-space:pre-wrap;margin:10px 0 0">${esc(p.notes)}</p></details>` : ""}
    <div class="stack" style="gap:10px">${p.pieces.map(pc => {
      const st = pieceState(p, pc);
      const status = !st.ready ? "Pattern not written yet" : st.done ? (pc.count > 1 ? `All ${pc.count} made` : "Made") :
        pc.count > 1 ? `${st.made} of ${pc.count} made` : st.pr.step ? "In progress" : "Not started";
      return `<button class="card piece-card ${st.done ? "is-done" : ""}" ${st.ready ? `data-go="#piece/${p.id}/${pc.id}"` : "disabled"}>
        <span class="piece-count" aria-hidden="true">${st.done ? "✓" : "×" + pc.count}</span>
        <span><b>${esc(pc.name)}</b><span class="small muted">${status}${pc.yarn && st.ready ? " · " + esc(pc.yarn) : ""}</span></span></button>`;
    }).join("")}</div>
    <div class="card stack">
      <label class="field-label" for="projName" style="margin:0">Pattern name</label>
      <input id="projName" class="text-input" value="${esc(p.name)}" maxlength="80" enterkeyhint="done">
      <div class="note-actions" style="margin:0"><button class="linkbtn danger-text" id="projDelAsk">Delete this pattern</button></div>
      <div id="projDelConfirm" class="confirm" hidden>
        <p class="small" style="margin:0">This removes ${esc(p.name)} and your place in it from all your devices.</p>
        <button class="btn danger" id="projDel">Yes, delete it</button>
        <button class="btn quiet" id="projDelNo">Cancel</button>
      </div>
    </div>
  </div>`;
  const box = document.getElementById("projName");
  box.addEventListener("input", () => {
    const v = box.value.trim();
    if (v && v !== p.name) { p.name = v; save(); document.querySelector(".topbar .title b").textContent = v; }
  });
  box.addEventListener("keydown", e => { if (e.key === "Enter") box.blur(); });
  document.getElementById("projDelAsk").onclick = e => { e.target.hidden = true; document.getElementById("projDelConfirm").hidden = false; };
  document.getElementById("projDelNo").onclick = () => render();
  document.getElementById("projDel").onclick = () => { data.patterns[p.id] = { deleted: true }; save(); go("#home"); };
}

function renderPiece(p, pc) {
  const st = pieceState(p, pc);
  if (!st.ready) return go(`#project/${p.id}`);
  requestWakeLock();
  const back = `<button class="iconbtn" data-go="#project/${p.id}" aria-label="Back to the project">←</button>`;
  if (st.done) {
    app.innerHTML = `
    <div class="screen stack">
      <div class="topbar">${back}<div class="title"><b>${esc(pc.name)}</b><span>${esc(p.name)}</span></div></div>
      <div class="card stack"><b style="font-size:1.6em">${pc.count > 1 ? `All ${pc.count} made!` : "Made!"}</b>
        ${loveLine()}
        <button class="btn primary" data-go="#project/${p.id}">Back to ${esc(p.name)}</button>
        <button class="btn quiet" data-wact="prev">Go back one step</button>
        <button class="btn quiet" data-wact="restart">Make ${pc.count > 1 ? "them" : "it"} again from the start</button></div>
    </div>`;
    return;
  }
  const s = st.steps[st.i], nxt = st.steps[st.i + 1], lastOfCopy = st.i === st.n - 1;
  const doneLabel = lastOfCopy ? (pc.count > 1 ? `Number ${st.made + 1} finished ✓` : "Finished ✓") : s.label ? `${s.label} done ✓` : "Done ✓";
  app.innerHTML = `
  <div class="screen stack">
    <div class="topbar">${back}
      <div class="title"><b>${esc(pc.name)}${pc.count > 1 ? ` · ${st.made + 1} of ${pc.count}` : ""}</b><span>${esc(s.part)}</span></div>
      ${NOTES_BTN}<button class="iconbtn" data-act="scale" aria-label="Change text size">Aa</button></div>
    ${st.i === 0 && st.made > 0 ? `<p class="tip" role="status" style="margin:0">Number ${st.made} is done. Starting number ${st.made + 1}.</p>` : ""}
    <div class="bar"><i style="width:${st.i / st.n * 100}%"></i></div>
    <div class="card stack">
      ${s.label ? `<div class="row-title"><b>${esc(s.label)}</b>${s.sts ? `<span class="count-badge">${s.sts} stitches</span>` : ""}</div>` : ""}
      ${s.range ? `<p class="small muted" style="margin:-8px 0 0">Rounds ${s.range} are all the same.</p>` : ""}
      <p class="step-text">${esc(s.text)}</p>
    </div>
    ${nxt ? `<p class="small muted" style="margin:0">Next${nxt.part !== s.part ? ` (${esc(nxt.part)})` : ""}: ${nxt.label ? esc(nxt.label) + " · " : ""}${esc(nxt.text)}${nxt.sts ? ` (${nxt.sts})` : ""}</p>`
      : pc.count > st.made + 1 ? `<p class="small muted" style="margin:0">That's the last step. Then number ${st.made + 2} starts from the beginning.</p>` : ""}
    <details class="card"><summary><b>All steps</b></summary>
      <ol class="step-list">${st.steps.map((x, j) => `
        <li class="${j < st.i ? "past" : ""} ${j === st.i ? "now" : ""}"><button class="linkbtn" data-wjump="${j}">
          ${j < st.i ? "✓ " : ""}${x.label ? `<b>${esc(x.label)}</b> ` : ""}${esc(x.text)}${x.sts ? ` (${x.sts})` : ""}</button></li>`).join("")}</ol>
      <button class="linkbtn danger-text" data-wact="restart-ask">Start ${pc.count > 1 ? "this one" : "this piece"} over</button>
      <button class="linkbtn danger-text" data-wact="restart-copy" hidden>Yes, back to the first step</button>
    </details>
  </div>
  <div class="actionbar"><div class="inner">
    <button class="btn quiet" data-wact="prev" ${st.pr.step === 0 ? "disabled" : ""}>Back</button>
    <button class="btn primary" data-wact="next">${esc(doneLabel)}</button>
  </div></div>`;
}

async function renderImport(code) {
  app.innerHTML = `<div class="screen"><p class="muted" role="status">Opening the pattern...</p></div>`;
  let proj;
  try { proj = await decodeImport(code); }
  catch (e) {
    app.innerHTML = `<div class="screen stack"><div class="topbar"><h1>Row by Row</h1></div>
      <div class="card stack"><b>That pattern link didn't open.</b>
        <p class="small muted" style="margin:0">It may have been cut short when it was sent. Ask for the link again.</p>
        <button class="btn primary" data-go="#home">Go to my patterns</button></div></div>`;
    console.warn("import:", e && e.message);
    return;
  }
  const have = findProject(proj.id), ready = proj.pieces.filter(pc => (pc.parts || []).length).length;
  app.innerHTML = `
  <div class="screen stack">
    <div class="topbar"><h1>Add a pattern</h1></div>
    <div class="card stack">
      <span class="project-icon">${YARN_SVG}</span>
      <b style="font-size:1.3em">${esc(proj.name)}</b>
      <p class="small muted" style="margin:0">${proj.pieces.length} pieces, ${ready} with patterns so far:
        ${proj.pieces.map(pc => esc(pc.name) + (pc.count > 1 ? ` ×${pc.count}` : "")).join(", ")}.</p>
      ${have ? `<p class="tip" style="margin:0">You already have this pattern. Updating it keeps your place in every piece.</p>` : ""}
      <button class="btn primary" id="impAdd">${have ? "Update my pattern" : "Add to my patterns"}</button>
      <button class="btn quiet" data-go="#home">Not now</button>
    </div>
  </div>`;
  document.getElementById("impAdd").onclick = () => {
    data.patterns[proj.id] = { ...proj, created: have ? have.created : Date.now() };
    if (!save()) return;                      // the warning at the top explains
    history.replaceState(null, "", `#project/${proj.id}`);   // so going back doesn't import again
    render();
  };
}

// ---------- taps on the piece screen ----------
document.addEventListener("click", e => {
  const t = e.target.closest("[data-wact],[data-wjump]");
  if (!t || t.disabled || !app.contains(t)) return;
  const [view, id, pieceId] = route();
  const p = findProject(id), pc = p && p.pieces.find(x => x.id === pieceId);
  if (view !== "piece" || !pc) return;
  const st = pieceState(p, pc), pr = st.pr, start = st.made * st.n;
  const act = t.dataset.wact;
  if (t.dataset.wjump !== undefined) { moveTo(pr, start + +t.dataset.wjump, 0); save(); render(); return scrollTo(0, 0); }
  if (act === "next") {
    moveTo(pr, pr.step + 1, 0); save(); render(); scrollTo(0, 0);
    if (Math.random() < 1 / 30) loveToast();
    return;
  }
  if (act === "prev") { moveTo(pr, Math.max(0, pr.step - 1), 0); save(); render(); return scrollTo(0, 0); }
  if (act === "restart-ask") { t.hidden = true; t.nextElementSibling.hidden = false; return; }
  if (act === "restart-copy") { moveTo(pr, start, 0); save(); render(); return scrollTo(0, 0); }
  if (act === "restart") { moveTo(pr, 0, 0); save(); render(); return scrollTo(0, 0); }
});

if (typeof module !== "undefined") module.exports = { expandSteps, expectedCount, cleanProject };
