// Phone-size check of Row by Row in headless Chrome, light and dark:
// existing progress survives, a chart is read square for square, a photo becomes a pattern, crochet/rename/delete work.
// Needs: puppeteer-core installed where node can find it, Chrome, and the app served on :5178
// (python -m http.server 5178). Usage: node phone-check.js <chart.jpg> <photo.jpg>
const puppeteer = require("puppeteer-core");
const OUT = __dirname + "/shots/", URL = "http://127.0.0.1:5178/";
const CHART = process.argv[2] || "C:/Projects/monster-graphghan/tools/original-chart.jpg", PHOTO = process.argv[3];
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
    await page.evaluateOnNewDocument(() => { window.SYNC_DISABLED = true; });
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
    let ed = await page.evaluate(() => ({ chart: document.querySelector('[data-mode-pick="chart"]')?.getAttribute("aria-pressed"),
      size: document.getElementById("dSize").textContent, scrollW: document.documentElement.scrollWidth }));
    ok(ed.chart === "true" && /49 × 60 squares, 10 colors/.test(ed.size), `${scheme}: chart detected: ${ed.size}`);
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

    // ---- a photo: no chart banner, photo controls, then save
    if (PHOTO) {
      await page.goto(URL + "#home", { waitUntil: "load" });
      await pick(PHOTO);
      ed = await page.evaluate(() => ({ banner: !!document.querySelector("[data-mode-pick]"), colors: document.querySelectorAll("#dColors .key-row").length }));
      ok(!ed.banner && ed.colors === 6, `${scheme}: photo opens as a photo with 6 colors (${ed.colors})`);
      await page.$eval("#dK", el => { el.value = 8; el.dispatchEvent(new Event("input", { bubbles: true })); });
      await page.click('[data-border="2"]');
      await page.$eval('#dColors input[data-i="0"]', el => { el.value = "Sky Blue Caron"; el.dispatchEvent(new Event("input", { bubbles: true })); });
      const box = await (await page.$("#chart")).boundingBox();
      await page.mouse.move(box.x + 100, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 60, box.y + 70, { steps: 5 }); await page.mouse.up();
      await wait(200);
      await page.screenshot({ path: OUT + `photo-editor-${scheme}.png`, fullPage: true }); await wait(400);
      await page.click("#dSave"); await page.waitForFunction(() => location.hash.startsWith("#pattern/p"));
      const saved = await page.evaluate(() => { const ps = Object.values(JSON.parse(localStorage.getItem("rowbyrow.v1")).patterns), p = ps.find(x => x.name === "My pattern");
        return p && { w: p.grid[0].length, n: p.colors.length, names: p.colors.map(c => c.name) }; });
      ok(saved && saved.w === 54 && saved.n === 8 && saved.names.includes("Sky Blue Caron"), `${scheme}: photo saved ${saved && saved.w + " wide, " + saved.n + " colors"}, yarn name kept`);
    }

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
    ok(errors.length === 0, `${scheme}: no page errors ${errors.join(" | ")}`);
    await page.close();
  }
  await browser.close();
  console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
