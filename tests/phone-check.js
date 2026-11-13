// Phone-size check of Row by Row in headless Chrome, light and dark:
// existing progress survives, a chart is read square for square, a photo becomes a pattern, crochet/rename/delete work.
// Needs: puppeteer-core installed where node can find it, Chrome, and the app served on :5178
// (python -m http.server 5178). Usage: node phone-check.js <chart.jpg> <photo.jpg> [transparent.png] [uneven.png] [written.json]
// (make the last two with: python tests/make-test-images.py <dir>)
const puppeteer = require("puppeteer-core");
const OUT = __dirname + "/shots/", URL = "http://127.0.0.1:5178/";
const CHART = process.argv[2] || "C:/Projects/monster-graphghan/tools/original-chart.jpg", PHOTO = process.argv[3], CLEAR = process.argv[4], UNEVEN = process.argv[5], WRITTEN = process.argv[6];
require("fs").mkdirSync(OUT, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fails++; };
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  for (const scheme of ["light", "dark"]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
    // No sync, and no share menu (headless Chrome has navigator.share but it never answers).
    await page.evaluateOnNewDocument(() => { window.SYNC_DISABLED = true; Object.defineProperty(Navigator.prototype, "share", { value: undefined }); });
    await page.goto(URL, { waitUntil: "load" });
    // Saved data in the old format: Monster Duo at row 23, a note, no patterns key.
    await page.evaluate(() => localStorage.setItem("rowbyrow.v1", JSON.stringify({ settings: { scale: 1 },
      prefs: { "monster-duo": { mode: "rows", hand: "right", t: 5 } }, progress: { "monster-duo|rows|right": { step: 22, inrow: 3, t: 10 } },
      notes: [{ id: 1, text: "hi", at: 1, sent: false }] })));
    await page.reload({ waitUntil: "load" });
    ok(/Row 23 of 60/.test(await page.evaluate(() => document.body.innerText)), `${scheme}: existing progress shows Row 23 of 60`);
    const checks = await page.evaluate(() => { const p = BUILTIN_PATTERNS[0];
      return verifySteps(p.grid, rowSteps(p.grid, "right")) && verifySteps(p.grid, c2cSteps(p.grid)); });
    ok(checks, `${scheme}: verifySteps passes for rows and C2C`);
    const pick = async file => {
      const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('[data-act="new-picture"]')]);
      await chooser.accept([file]); await page.waitForSelector("#dSave"); await wait(300);
    };

    // ---- the chart: should open in chart mode and read Monster Duo exactly
    await pick(CHART);
    let ed = await page.evaluate(() => ({ kind: draft.kind, size: document.getElementById("dSize").textContent, scrollW: document.documentElement.scrollWidth }));
    ok(ed.kind === "chart" && /49 × 60 squares, 10 colors/.test(ed.size), `${scheme}: chart detected: ${ed.size}`);
    ok(ed.scrollW <= 375, `${scheme}: no sideways scrolling (${ed.scrollW}px)`);
    await page.screenshot({ path: OUT + `chart-editor-${scheme}.png`, fullPage: true }); await wait(400);
    await page.click('[data-view="photo"]'); await wait(100);
    await page.screenshot({ path: OUT + `chart-overlay-${scheme}.png` });
    await page.click(".adjust summary"); await page.click('[data-adj="cols+"]'); await wait(100);
    const adj = await page.evaluate(() => document.getElementById("dSize").textContent);
    ok(/50 × 60/.test(adj), `${scheme}: + column respaces the grid (${adj})`);
    await page.screenshot({ path: OUT + `chart-adjust-${scheme}.png`, fullPage: true }); await wait(400);
    await page.click('[data-adj="reset"]'); await wait(100);
    await page.type("#dName", "Chart " + scheme);
    await page.click("#dSave"); await page.waitForFunction(() => location.hash.startsWith("#pattern/p"));
    const read = await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem("rowbyrow.v1")), p = Object.values(d.patterns)[0], m = BUILTIN_PATTERNS[0].grid;
      const want = m.slice(2, 57).map(r => r.slice(1, 50)).concat(Array(5).fill("A".repeat(49)));
      const f = {}, r = {}; let same = p.grid.length === 60 && p.grid[0].length === 49;
      for (let y = 0; same && y < 60; y++) for (let x = 0; x < 49; x++) {
        const a = want[y][x], b = p.grid[y][x]; if ((f[a] && f[a] !== b) || (r[b] && r[b] !== a)) { same = false; break; } f[a] = b; r[b] = a;
      }
      return { same, n: p.colors.length };
    });
    ok(read.same && read.n === 10, `${scheme}: chart saved square for square as Monster Duo (in the browser's own JPEG decode)`);
    // ---- fix squares and colors on the saved chart pattern
    {
      const pid = await page.evaluate(() => location.hash.split("/")[1]);
      await page.waitForSelector('[data-go^="#edit/"]'); await page.click('[data-go^="#edit/"]'); await page.waitForSelector("#eSave");
      const tap = async (x, y) => {
        const box = await (await page.$("#chart")).boundingBox(), cell = await page.evaluate(() => editing.cell);
        await page.evaluate((x, y, cell) => { const w = document.getElementById("chartWrap"); w.scrollLeft = x * cell - 40; w.scrollTop = y * cell - 40; }, x, y, cell);
        const b2 = await (await page.$("#chart")).boundingBox();
        await page.mouse.click(b2.x + (x + 0.5) * cell, b2.y + (y + 0.5) * cell);
      };
      const ed = () => page.evaluate(() => ({ g: editing.grid.map(r => r.join("")), colors: editing.colors.map(c => c.code + ":" + c.name), undo: editing.undo.length, dirty: editing.dirty }));
      const before = await ed();
      const bg = before.g[0][0], other = before.colors.map(c => c[0]).find(k => k !== bg);
      await page.click(`[data-brush="${other}"]`); await tap(0, 0);
      let now = await ed();
      ok(now.g[0][0] === other && now.g[0][1] === bg, `${scheme}: paint changes just the tapped square`);
      await page.click("#eUndo"); now = await ed();
      ok(now.g[0][0] === bg, `${scheme}: undo puts it back`);
      await page.click('[data-tool="fill"]'); await tap(0, 0); now = await ed();
      const filled = now.g.join("").split("").filter(k => k === other).length - before.g.join("").split("").filter(k => k === other).length;
      ok(filled > 100, `${scheme}: fill recolors the whole connected background (${filled} squares)`);
      await page.click("#eUndo");
      const victim = before.colors[before.colors.length - 1][0], into = before.colors[0][0];
      await page.click(`[data-combine="${victim}"]`); await page.click(`[data-into="${into}"]`); now = await ed();
      ok(now.colors.length === before.colors.length - 1 && !now.g.join("").includes(victim), `${scheme}: combine removes a color and repaints its squares`);
      await page.$eval(`[data-rename="${into}"]`, el => { el.value = "Red Heart Gray"; el.dispatchEvent(new Event("input", { bubbles: true })); });
      await page.$eval("#eAdd", el => { el.value = "#3366cc"; el.dispatchEvent(new Event("change", { bubbles: true })); });
      now = await ed();
      ok(now.colors.length === before.colors.length && /Blue 2/.test(now.colors[now.colors.length - 1]), `${scheme}: add a color (${now.colors[now.colors.length - 1]}) and it becomes the brush`);
      await page.click('[data-tool="paint"]'); await tap(5, 5);
      await page.screenshot({ path: OUT + `edit-${scheme}.png`, fullPage: true }); await wait(400);
      await page.click("#eBack"); await wait(100);
      ok(await page.evaluate(() => !document.getElementById("eLeave").hidden), `${scheme}: leaving with changes asks first`);
      await page.click("#eStay");
      await page.click("#eSave"); await page.waitForFunction(() => location.hash.startsWith("#pattern/"));
      const saved = await page.evaluate(pid => { const p = JSON.parse(localStorage.getItem("rowbyrow.v1")).patterns[pid];
        return { w: p.grid[0].length, h: p.grid.length, n: p.colors.length, names: p.colors.map(c => c.name), sq: p.grid[5][5], t: !!p.t,
          ok: verifySteps(p.grid, rowSteps(p.grid, "right")) && verifySteps(p.grid, c2cSteps(p.grid)) }; }, pid);
      ok(saved.w === 49 && saved.h === 60 && saved.n === 10 && saved.names.includes("Red Heart Gray") && saved.ok && saved.t,
        `${scheme}: saved: same size, ${saved.n} colors, renamed yarn kept, steps check out, stamped for sync`);
    }


    // ---- a real photo is turned away: patterns come from charts and pixel art only
    if (PHOTO) {
      await page.goto(URL + "#home", { waitUntil: "load" });
      const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('[data-act="new-picture"]')]);
      await chooser.accept([PHOTO]); await wait(1500);
      const r = await page.evaluate(() => ({ hash: location.hash, draft: !!draft, msg: (document.querySelector(".tip") || {}).textContent || "" }));
      ok(r.hash === "#home" && !r.draft && /doesn't look like a chart or pixel art/.test(r.msg), `${scheme}: a photo is turned away with an explanation`);
      await page.screenshot({ path: OUT + `photo-refused-${scheme}.png` });
    }

    // ---- uneven pixel art: sized to its blocks, width adjustable, at most 10 colors
    if (UNEVEN) {
      await page.goto(URL + "#home", { waitUntil: "load" });
      await pick(UNEVEN);
      const px0 = await page.evaluate(() => ({ kind: draft.kind, cols: draft.g.cols, rows: draft.g.rows, tip: document.querySelector(".tip").textContent }));
      ok(px0.kind === "pixel" && /uneven squares/.test(px0.tip) && px0.cols >= 40 && px0.cols <= 60, `${scheme}: uneven pixel art opens as pixel art at ${px0.cols} x ${px0.rows}`);
      await page.click("#dW", { clickCount: 3 }); await page.type("#dW", "40"); await wait(200);
      const sz = await page.evaluate(() => document.getElementById("dSize").textContent);
      ok(/^40 × \d+ squares/.test(sz), `${scheme}: width box resizes it, keeping its shape (${sz.split(".")[0]})`);
      await page.click('[data-view="photo"]'); await wait(100);
      await page.screenshot({ path: OUT + `pixel-editor-${scheme}.png`, fullPage: true }); await wait(400);
      await page.type("#dName", "Pixel " + scheme);
      await page.click("#dSave"); await page.waitForFunction(() => location.hash.startsWith("#pattern/p"));
      const pw = await page.evaluate(n => Object.values(JSON.parse(localStorage.getItem("rowbyrow.v1")).patterns).find(p => p.name === n), "Pixel " + scheme);
      ok(pw && pw.grid[0].length === 40 && pw.colors.length <= 10, `${scheme}: pixel art saved 40 wide with ${pw && pw.colors.length} colors`);
    }
    // Never more than 10 yarn colors, and no two that would look like the same yarn.
    const limits = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("rowbyrow.v1")).patterns).filter(p => p.grid)
      .every(p => p.colors.length <= 10 && p.colors.every((a, i) => p.colors.every((b, j) => j <= i || !sameYarn(toLab(hexRgb(a.hex)), toLab(hexRgb(b.hex)))))));
    ok(limits, `${scheme}: saved patterns have at most 10 colors and no same-looking pair`);

    // ---- crochet the chart pattern, check order, rename, delete
    await page.goto(URL + "#home", { waitUntil: "load" });
    const id = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("rowbyrow.v1")).patterns).find(p => p.name.startsWith("Chart")).id);
    await page.goto(URL + "#work/" + id, { waitUntil: "load" }); await page.waitForSelector(".chips");
    await page.click('[data-chip="0"]'); await page.click('[data-act="next"]');
    ok(await page.evaluate(() => document.querySelector(".topbar .title b").textContent) === "Row 2 of 60", `${scheme}: crochet mode works on the chart pattern`);
    await page.screenshot({ path: OUT + `work-${scheme}.png` });
    await page.goto(URL + "#home", { waitUntil: "load" });
    const order = await page.evaluate(() => [...document.querySelectorAll(".pattern-card b")].map(b => b.textContent));
    ok(order[0] === "Chart " + scheme, `${scheme}: most recently used first (${order.slice(0, 3).join(" | ")})`);
    await page.screenshot({ path: OUT + `home-${scheme}.png`, fullPage: true }); await wait(400);
    await page.goto(URL + "#pattern/" + id, { waitUntil: "load" }); await page.waitForSelector("#patName");
    await page.click("#patName", { clickCount: 3 }); await page.type("#patName", "Renamed\n");
    await page.click('[data-act="delete-ask"]'); await page.click('[data-act="delete"]');
    await page.waitForFunction(() => location.hash === "#home");
    const after = await page.evaluate(id => ({ list: [...document.querySelectorAll(".pattern-card b")].map(b => b.textContent),
      entry: JSON.parse(localStorage.getItem("rowbyrow.v1")).patterns[id] }), id);
    ok(!after.list.includes("Renamed") && after.entry.deleted && after.entry.t && !after.entry.grid, `${scheme}: delete leaves a synced marker only`);
    // Notes while signed out: Send falls back to copy-the-text (headless Chrome has no share menu).
    await page.goto(URL + "#feedback", { waitUntil: "load" }); await page.waitForSelector("#noteText");
    const fbText = await page.evaluate(() => document.body.innerText);
    ok(/share menu/.test(fbText) && !/app's inbox/.test(fbText), `${scheme}: signed out, notes still use the share menu`);
    await page.type("#noteText", "Test note"); await page.click('[data-act="send-notes"]'); await wait(200);
    ok(await page.evaluate(() => !document.getElementById("fallback").hidden && /Test note/.test(document.getElementById("fallbackText").value)),
      `${scheme}: no share menu, so the copy-the-text fallback appears`);
    await page.screenshot({ path: OUT + `feedback-${scheme}.png`, fullPage: true }); await wait(400);
    // Signed in (sync stood in for): Send marks notes for the inbox, with who and which device, and says Sent.
    await page.evaluate(() => { window.syncState = () => ({ user: { email: "tester@example.com" }, status: "synced" });
      window.syncFlush = () => new Promise(r => setTimeout(r, 300)); location.hash = "#home"; location.hash = "#feedback"; });
    await page.waitForSelector("#noteText");
    ok(/app's inbox/.test(await page.evaluate(() => document.body.innerText)), `${scheme}: signed in, Send says it goes to the app's inbox`);
    await page.type("#noteText", "Inbox note"); await page.click('[data-act="send-notes"]');
    await page.waitForFunction(() => /Sent\. Thank you|notes sent/.test(document.body.innerText), { timeout: 5000 });
    const sentNote = await page.evaluate(() => JSON.parse(localStorage.getItem("rowbyrow.v1")).notes.find(n => n.text === "Inbox note"));
    ok(sentNote && sentNote.via === "inbox" && sentNote.from === "tester@example.com" && sentNote.device && sentNote.sent && sentNote.t,
      `${scheme}: inbox note saved with via, from, device, and a sync stamp`);
    await page.screenshot({ path: OUT + `feedback-sent-${scheme}.png`, fullPage: true });
    await page.goto(URL + "#backup", { waitUntil: "load" }); await page.waitForSelector('[data-bact="download"]'); await wait(300);
    await page.screenshot({ path: OUT + `backup-${scheme}.png`, fullPage: true });
    ok(errors.length === 0, `${scheme}: no page errors ${errors.join(" | ")}`);
    await page.close();
  }

  // ---- reliability: failed saves, renames during redraws, transparent pictures, offline through the service worker
  {
    const page = await browser.newPage(); const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(() => { window.SYNC_DISABLED = true; });
    await page.goto(URL + "#home", { waitUntil: "load" });
    await page.evaluate(() => localStorage.removeItem("rowbyrow.v1")); await page.reload({ waitUntil: "load" });
    const breakStorage = on => page.evaluate(on => {
      if (on) { window._set = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new DOMException("full", "QuotaExceededError"); }; }
      else Storage.prototype.setItem = window._set;
    }, on);
    const warnShown = () => page.evaluate(() => { const w = document.getElementById("saveWarn"); return !!w && !w.hidden; });

    await page.goto(URL + "#work/monster-duo", { waitUntil: "load" }); await page.waitForSelector(".chips");
    await breakStorage(true); await page.click('[data-chip="0"]');
    ok(await warnShown(), "a failed save shows the warning");
    await breakStorage(false); await page.click('[data-chip="0"]');   // row 1 is one color: untap it
    ok(!(await warnShown()), "the warning goes away once a save works");

    if (CLEAR) {
      await page.goto(URL + "#home", { waitUntil: "load" });
      const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('[data-act="new-picture"]')]);
      await chooser.accept([CLEAR]); await page.waitForSelector("#dSave"); await wait(300);
      const size = await page.evaluate(() => draft.kind + " " + document.getElementById("dSize").textContent);
      ok(/^chart 51 × 60 squares/.test(size), `transparent pixel art (random colors hidden under the clear parts) reads as the chart (${size})`);
      await page.type("#dName", "Clear chart");
      await breakStorage(true); await page.click("#dSave"); await wait(200);
      ok(await page.evaluate(() => location.hash === "#new" && !!draft) && await warnShown(), "a failed pattern save keeps the editor open");
      await breakStorage(false); await page.click("#dSave");
      await page.waitForFunction(() => location.hash.startsWith("#pattern/p"));
      const n = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("rowbyrow.v1")).patterns).filter(p => p.name === "Clear chart").length);
      ok(n === 1, `saving again after a failure makes one pattern, not two (${n})`);
      // Rename without leaving the box, then redraw (as rotation or sync would): the new name must stick.
      await page.waitForSelector("#patName");
      await page.click("#patName", { clickCount: 3 }); await page.type("#patName", "Kept name");
      await page.evaluate(() => render());
      const kept = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("rowbyrow.v1")).patterns).some(p => p.name === "Kept name"));
      ok(kept, "a rename survives a redraw before the box loses focus");
    }

    // Little hidden notes: three quick taps on the title, the finished screen, and every language renders.
    await page.goto(URL + "#home", { waitUntil: "load" }); await page.waitForSelector("#appTitle");
    for (let i = 0; i < 3; i++) await page.click("#appTitle");
    await wait(300);
    const toast = await page.evaluate(() => (document.querySelector(".love-toast") || {}).textContent || "");
    ok(/♥/.test(toast) && /Momma|English/.test(toast), `three taps on the title show a note (${toast.replace(/\s+/g, " ").trim().slice(0, 60)})`);
    await page.screenshot({ path: OUT + "love-toast.png" });
    const all = await page.evaluate(() => LOVE.map(() => loveLine()).every(h => /♥/.test(h)) && LOVE.length);
    ok(all >= 20, `${all} languages render`);
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem("rowbyrow.v1")); d.progress["monster-duo|rows|right"] = { step: 60, inrow: 0, t: Date.now() };
      localStorage.setItem("rowbyrow.v1", JSON.stringify(d)); });
    await page.goto(URL + "#work/monster-duo", { waitUntil: "load" }); await page.reload({ waitUntil: "load" });
    ok(await page.evaluate(() => /Finished!/.test(document.body.innerText) && !!document.querySelector(".love")), "the finished screen has a note");
    await page.screenshot({ path: OUT + "love-finished.png", fullPage: true });

    // Pictures with notes: from the editor, the picture (with its grid) and the pattern go along; she can add her own.
    {
      await page.goto(URL + "#home", { waitUntil: "load" });
      const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('[data-act="new-picture"]')]);
      await chooser.accept([CHART]); await page.waitForSelector("#dSave"); await wait(300);
      await page.click('.topbar [data-go="#feedback"]'); await page.waitForSelector("#noteText");
      let txt = await page.evaluate(() => document.body.innerText);
      ok(/Add the picture I loaded and the pattern it made/.test(txt) && /Making a new pattern, 49 × 60 from a chart/.test(txt),
        "notes opened from the editor offer its picture and pattern, and know where she is");
      const [ac] = await Promise.all([page.waitForFileChooser(), page.click("[data-attadd]")]);
      await ac.accept([CHART]); await page.waitForSelector(".att img");
      ok(await page.$$eval(".att-row .att", e => e.length) === 1, "a picture she adds shows as a thumbnail");
      await page.screenshot({ path: OUT + "note-pictures.png", fullPage: true }); await wait(400);
      await page.click("[data-attx='0']"); await wait(100);
      ok(!(await page.$(".att-row")), "and can be taken off again");
      const [ac2] = await Promise.all([page.waitForFileChooser(), page.click("[data-attadd]")]);
      await ac2.accept([CHART]); await page.waitForSelector(".att img");
      await page.type("#noteText", "Colors look off"); await page.click('[data-act="save-note"]'); await wait(200);
      const saved = await page.evaluate(() => { const n = data.notes.find(n => n.text === "Colors look off");
        return { kinds: (n.atts || []).map(a => a.kind).join(","), local: (n.atts || []).filter(a => (localStorage.getItem("rowbyrow.att." + a.id) || "").startsWith("data:image/jpeg")).length,
          sizes: (n.atts || []).map(a => (localStorage.getItem("rowbyrow.att." + a.id) || "").length) }; });
      ok(saved.kinds === "picture,pattern,added" && saved.local === 3 && saved.sizes.every(z => z < 400000),
        `a saved note keeps its 3 pictures on the phone, each small (${saved.kinds}; ${saved.sizes.map(z => Math.round(z / 1024) + " KB").join(", ")})`);
      ok(await page.$$eval(".note .att", e => e.length) === 3, "the saved note shows its pictures");
      // Signed in (sync stood in for): Send puts the note in her data and each picture in its own cloud entry.
      await page.evaluate(() => { window._ss = window.syncState; window.uploaded = []; window.syncState = () => ({ user: { email: "tester@example.com" }, status: "synced" });
        window.syncFlush = () => new Promise(r => setTimeout(r, 100));
        window.syncUpload = (id, o) => new Promise(r => setTimeout(() => { uploaded.push({ id, kind: o.kind, note: o.note, ok: o.data.startsWith("data:image/jpeg") }); r(); }, 50)); render(); });
      await page.click('[data-act="send-notes"]');
      await page.waitForFunction(() => /Sent\. Thank you/.test(document.body.innerText), { timeout: 8000 });
      const up = await page.evaluate(() => { const n = data.notes.find(n => n.text === "Colors look off");
        return { calls: uploaded.length, all: uploaded.every(u => u.ok && u.note === n.id), marked: n.atts.every(a => a.up), left: n.atts.filter(a => localStorage.getItem("rowbyrow.att." + a.id)).length }; });
      ok(up.calls === 3 && up.all && up.marked && up.left === 0, `sending uploads each picture once and clears the phone's copies (${JSON.stringify(up)})`);
      await page.click('.topbar [aria-label="Back"]'); await wait(300);
      ok(await page.evaluate(() => location.hash === "#new" && !!document.getElementById("dSave")), "Back from notes returns to the pattern she was making");
      await page.evaluate(() => { window.syncState = window._ss; delete window.syncFlush; delete window.syncUpload; draft = null; });
    }

    // Ready-made patterns: the gallery opens from home, a design opens bigger, adding copies it into her patterns.
    {
      await page.goto(URL + "#home", { waitUntil: "load" }); await page.waitForSelector('[data-go="#library"]');
      await page.click('[data-go="#library"]'); await page.waitForSelector(".lib-card");
      const lib = await page.evaluate(() => ({ cards: document.querySelectorAll(".lib-card").length, total: LIBRARY.length,
        drawn: [...document.querySelectorAll("[data-lib]")].every(c => c.width > 0), scrollW: document.documentElement.scrollWidth,
        ok: LIBRARY.every(it => it.colors.length >= 6 && it.colors.length <= 10 && it.grid.every(r => r.length === it.grid[0].length)) }));
      ok(lib.cards === lib.total && lib.drawn && lib.scrollW <= 375, `the gallery shows all ${lib.total} designs with pictures, no sideways scrolling`);
      ok(lib.ok, "every ready-made design has 6 to 10 colors and even rows");
      await page.screenshot({ path: OUT + "library.png", fullPage: true }); await wait(400);
      const first = await page.evaluate(() => LIBRARY[0].id);
      await page.click(`[data-go="#library/${first}"]`); await page.waitForSelector("#libAdd");
      await page.screenshot({ path: OUT + "library-item.png", fullPage: true }); await wait(400);
      await page.click("#libAdd"); await page.waitForFunction(id => location.hash === "#pattern/" + id, {}, first);
      await page.waitForSelector(`[data-go="#work/${first}"]`, { timeout: 5000 }).catch(() => {});
      ok(await page.evaluate(id => !!data.patterns[id] && data.patterns[id].grid.length === LIBRARY[0].grid.length && !!document.querySelector('[data-go="#work/' + id + '"]'), first),
        "adding a design copies it into her patterns and opens it");
      await page.goto(URL + "#library/" + first, { waitUntil: "load" }); await page.waitForSelector(".tip");
      ok(/already in your patterns/.test(await page.evaluate(() => document.body.innerText)) && !!(await page.$(`[data-go="#pattern/${first}"]`)), "an added design offers Open my copy");
      await page.goto(URL + "#library", { waitUntil: "load" }); await page.waitForSelector(".lib-card");
      ok(/✓ Added/.test(await page.evaluate(() => document.querySelector(".lib-card").innerText)), "the gallery marks it as added");
      await page.goto(URL + "#home", { waitUntil: "load" });
      ok(await page.evaluate(n => [...document.querySelectorAll(".pattern-card b")].some(b => b.textContent === n), await page.evaluate(() => LIBRARY[0].name)), "it shows on the home screen with her patterns");
    }

    // Chart pattern from a link (a pattern request coming back): add it, it opens, and the link again offers to update.
    {
      const P = await page.evaluate(() => BUILTIN_PATTERNS[0]);
      const chart = { kind: "chart", id: "c-test-request", name: "Requested turtle", grid: P.grid, colors: P.colors };
      const code = c => require("zlib").deflateRawSync(Buffer.from(JSON.stringify(c)), { level: 9 }).toString("base64url");
      await page.goto(URL + "#home", { waitUntil: "load" });
      await page.goto(URL + "#import/" + code(chart), { waitUntil: "load" }); await page.waitForSelector("#impAdd");
      let txt = await page.evaluate(() => document.body.innerText);
      ok(/Requested turtle/.test(txt) && /51 × 60 squares, \d+ colors/.test(txt) && /Add to my patterns/.test(txt) && await page.$("#impChart"),
        "a chart link shows the pattern, its size and yarns, and offers to add it");
      await page.screenshot({ path: OUT + "chart-import.png", fullPage: true }); await wait(400);
      await page.click("#impAdd"); await page.waitForFunction(() => location.hash === "#pattern/c-test-request");
      ok(await page.evaluate(() => !!data.patterns["c-test-request"] && data.patterns["c-test-request"].grid.length === 60 && !data.patterns["c-test-request"].kind),
        "adding it saves it with her patterns and opens it");
      await page.goto(URL + "#import/" + code(chart), { waitUntil: "load" }); await page.waitForSelector("#impAdd");
      ok(/Update my pattern/.test(await page.evaluate(() => document.body.innerText)), "opening the same link again offers to update");
      await page.goto(URL + "#import/" + code({ ...chart, id: "../evil" }), { waitUntil: "load" }); await wait(500);
      ok(/didn't open/.test(await page.evaluate(() => document.body.innerText)), "a chart link with a bad id is refused");
      await page.goto(URL + "#import/" + code({ ...chart, id: "c-too-many", colors: [...P.colors, ...P.colors.map((c, i) => ({ ...c, code: "abcdefghijk"[i] }))] }), { waitUntil: "load" }); await wait(500);
      ok(/didn't open/.test(await page.evaluate(() => document.body.innerText)), "a chart link with more than 10 colors is refused");
      await page.goto(URL + "#feedback", { waitUntil: "load" }); await page.waitForSelector('[data-act="ask-pattern"]');
      await page.click('[data-act="ask-pattern"]');
      ok(await page.evaluate(() => document.getElementById("noteText").value.startsWith("Pattern request: ")), "Ask for a pattern starts the note for her");
      await page.evaluate(() => { document.getElementById("noteText").value = ""; data.draft = ""; save(); });
    }

    // Written pattern: open an import link, add it, follow a piece through rounds and copies, update it, delete it.
    if (WRITTEN) {
      const proj = JSON.parse(require("fs").readFileSync(WRITTEN, "utf8"));
      const link = URL + "#import/" + require("zlib").deflateRawSync(Buffer.from(JSON.stringify(proj)), { level: 9 }).toString("base64url");
      await page.goto(URL + "#home", { waitUntil: "load" });
      await page.goto(link, { waitUntil: "load" }); await page.waitForSelector("#impAdd");
      ok(/Add to my patterns/.test(await page.evaluate(() => document.body.innerText)), "an import link offers to add the pattern");
      await page.screenshot({ path: OUT + "written-import.png" });
      await page.click("#impAdd"); await page.waitForFunction(() => location.hash.startsWith("#project/"));
      let txt = await page.evaluate(() => document.body.innerText);
      ok(/0 of 28/.test(txt) && /Pattern not written yet/.test(txt) && /Strawberries/.test(txt), "the project page lists every piece, with 0 of 28 made");
      await page.screenshot({ path: OUT + "written-project.png", fullPage: true }); await wait(400);
      await page.click('[data-go$="/strawberries"]'); await page.waitForSelector('[data-wact="next"]');
      const first = await page.evaluate(() => ({ title: document.querySelector(".topbar .title").innerText, step: document.querySelector(".row-title").innerText }));
      ok(/Strawberries · 1 of 4/.test(first.title) && /Rd 1/.test(first.step) && /6 stitches/.test(first.step), `the piece opens at Rd 1 of number 1 (${first.title.split("\n").join(" / ")})`);
      await page.screenshot({ path: OUT + "written-piece.png", fullPage: true }); await wait(400);
      const n = await page.evaluate(() => expandSteps(findProject("w-hungry-caterpillar").pieces.find(p => p.id === "strawberries")).length);
      for (let i = 0; i < n; i++) await page.click('[data-wact="next"]');
      txt = await page.evaluate(() => document.body.innerText);
      ok(/2 of 4/.test(txt) && /Number 1 is done/.test(txt) && /Rd 1/.test(txt), `after all ${n} steps, number 2 starts at Rd 1`);
      await page.click("details.card summary");
      await page.$eval('[data-wjump="9"]', el => el.scrollIntoView({ block: "center" }));   // clear of the fixed button bar
      await page.click('[data-wjump="9"]');
      ok(/Stuff the strawberry/.test(await page.evaluate(() => document.querySelector(".step-text").textContent)), "tapping a step in the list jumps there");
      const where = await page.evaluate(() => { lastPlace = { view: "piece", id: "w-hungry-caterpillar", sub: "strawberries" }; return whereText(); });
      ok(/Strawberries 2 of 4, Body \(red\)/.test(where), `notes know where she is (${where})`);
      await page.evaluate(n => { const d = JSON.parse(localStorage.getItem("rowbyrow.v1")); d.progress["w-hungry-caterpillar|piece|strawberries"] = { step: 4 * n, inrow: 0, t: Date.now() };
        localStorage.setItem("rowbyrow.v1", JSON.stringify(d)); }, n);
      await page.reload({ waitUntil: "load" });
      txt = await page.evaluate(() => document.body.innerText);
      ok(/All 4 made!/.test(txt) && await page.evaluate(() => !!document.querySelector(".love")), "after all 4, it says so (with a little note)");
      await page.goto(link, { waitUntil: "load" }); await page.waitForSelector("#impAdd");
      ok(/Update my pattern/.test(await page.evaluate(() => document.body.innerText)), "opening the link again offers to update");
      await page.click("#impAdd"); await page.waitForFunction(() => location.hash.startsWith("#project/"));
      ok(/4 of 28/.test(await page.evaluate(() => document.body.innerText)), "updating keeps her progress (4 of 28)");
      await page.goto(URL + "#home", { waitUntil: "load" });
      ok(await page.evaluate(() => [...document.querySelectorAll(".pattern-card b")].some(b => /Hungry Caterpillar/.test(b.textContent))), "the project shows on the home screen");
      await page.goto(URL + "#import/notreal", { waitUntil: "load" }); await wait(500);
      ok(/didn't open/.test(await page.evaluate(() => document.body.innerText)), "a broken link explains itself");
    }

    // Backup: save a file, wipe the phone, restore it, and everything is back. Restoring again changes nothing.
    {
      const fs = require("fs"), dl = OUT + "downloads/";
      fs.rmSync(dl, { recursive: true, force: true }); fs.mkdirSync(dl, { recursive: true });
      const cdp = await browser.target().createCDPSession();
      await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dl.replace(/\//g, "\\") });
      const state = () => page.evaluate(() => { const d = JSON.parse(localStorage.getItem("rowbyrow.v1") || "{}");
        return { pats: Object.values(d.patterns || {}).filter(p => !p.deleted).length, duo: (d.progress || {})["monster-duo|rows|right"], notes: (d.notes || []).filter(n => !n.deleted).length }; });
      await page.goto(URL + "#home", { waitUntil: "load" });
      const before = await state();
      await page.goto(URL + "#backup", { waitUntil: "load" }); await page.waitForSelector('[data-bact="download"]');
      const canShare = await page.evaluate(() => canShareBackup());
      ok(!!(await page.$('[data-bact="share"]')) === canShare, `Send to Drive or email is offered only where the phone can share files (${canShare ? "can" : "can't"} here)`);
      await page.click('[data-bact="download"]');
      let file = null;
      for (let i = 0; i < 50 && !file; i++) { await wait(100); file = fs.readdirSync(dl).find(f => /^row-by-row-backup-\d{4}-\d\d-\d\d\.json$/.test(f)); }
      ok(!!file && /Backup saved/.test(await page.evaluate(() => document.body.innerText)), `a backup file is downloaded (${file})`);
      await page.goto(URL + "#home", { waitUntil: "load" });
      ok(/Last saved/.test(await page.evaluate(() => document.body.innerText)), "the home screen shows when the last backup was saved");
      await page.evaluate(() => localStorage.removeItem("rowbyrow.v1"));
      await page.goto(URL + "#backup", { waitUntil: "load" }); await page.reload({ waitUntil: "load" });
      const wiped = await state();
      const restore = async f => {
        const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('[data-bact="pick"]')]);
        await chooser.accept([f]); await wait(400);
      };
      await restore(dl + file);
      const confirm = await page.evaluate(() => (document.getElementById("restoreConfirm") || {}).innerText || "");
      ok(/Restore this backup\?/.test(confirm) && new RegExp(before.pats + " pattern").test(confirm), `restoring asks first and says what's in it (${confirm.split("\n")[1] || ""})`);
      await page.screenshot({ path: OUT + "backup-confirm.png", fullPage: true }); await wait(400);   // let the resize redraw pass
      await page.click('[data-bact="restore-yes"]'); await wait(200);
      const after = await state();
      ok(wiped.pats === 0 && after.pats === before.pats && after.notes === before.notes && after.duo && after.duo.step === before.duo.step,
        `a wiped phone gets everything back (${after.pats} patterns, ${after.notes} notes, Monster Duo step ${after.duo && after.duo.step})`);
      ok(/Restored:/.test(await page.evaluate(() => document.body.innerText)), "it says what was restored");
      await page.screenshot({ path: OUT + "backup-restored.png", fullPage: true });
      await restore(dl + file); await page.click('[data-bact="restore-yes"]'); await wait(200);
      ok(/already here/.test(await page.evaluate(() => document.body.innerText)) && JSON.stringify(await state()) === JSON.stringify(after), "restoring the same file again changes nothing");
      await restore(CHART);
      ok(/isn't a Row by Row backup/.test(await page.evaluate(() => document.body.innerText)) && !(await page.$("#restoreConfirm")), "a picture picked by mistake is turned away");
    }

    // Service worker: a full set is cached, and the app opens offline.
    await page.goto(URL + "#home", { waitUntil: "load" });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: "load" }); await wait(500);
    const cached = await page.evaluate(async () => { const k = await caches.keys(); const c = await caches.open(k.find(x => x.startsWith("rbr-")));
      return { name: k.join(","), files: (await c.keys()).length, controlled: !!navigator.serviceWorker.controller }; });
    ok(cached.controlled && cached.files >= 15, `service worker controls the page and cached ${cached.files} files (${cached.name})`);
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: "load" }); await wait(300);
    ok(/Monster Duo/.test(await page.evaluate(() => document.body.innerText)), "the app opens offline from the cache");
    await page.setOfflineMode(false);
    ok(errors.length === 0, `no page errors in the reliability checks ${errors.join(" | ")}`);
    await page.close();
  }
  await browser.close();
  console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
