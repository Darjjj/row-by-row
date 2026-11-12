// Phone-size check of Row by Row in headless Chrome: existing progress survives, the new-pattern flow works.
const puppeteer = require("puppeteer-core");
// Needs: npm i puppeteer-core (outside the repo is fine), Chrome installed, and the app served on :5178.
const OUT = __dirname + "/shots/", URL = "http://127.0.0.1:5178/";
const CHART = "C:/Projects/monster-graphghan/tools/original-chart.jpg";
require("fs").mkdirSync(OUT, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fails++; };

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
    await page.evaluate(() => {
      localStorage.setItem("rowbyrow.v1", JSON.stringify({ settings: { scale: 1 }, prefs: { "monster-duo": { mode: "rows", hand: "right", t: 5 } },
        progress: { "monster-duo|rows|right": { step: 22, inrow: 3, t: 10 } }, notes: [{ id: 1, text: "hi", at: 1, sent: false }] }));
    });
    await page.goto(URL + "#home", { waitUntil: "load" }); await page.reload({ waitUntil: "load" });
    const home = await page.evaluate(() => document.body.innerText);
    ok(/Row 23 of 60/.test(home), `${scheme}: existing progress shows Row 23 of 60`);
    await page.screenshot({ path: OUT + `home-${scheme}.png`, fullPage: true }); await new Promise(r => setTimeout(r, 400));

    // pattern.js is unchanged; still confirm the built-in checks pass in the page.
    const hashes = await page.evaluate(() => {
      const p = BUILTIN_PATTERNS[0];
      return { rows: verifySteps(p.grid, rowSteps(p.grid, "right")), c2c: verifySteps(p.grid, c2cSteps(p.grid)) };
    });
    ok(hashes.rows && hashes.c2c, `${scheme}: verifySteps passes for rows and C2C`);

    // New pattern from the original chart picture.
    const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('[data-act="new-picture"]')]);
    await chooser.accept([CHART]);
    await page.waitForSelector("#dSave");
    await new Promise(r => setTimeout(r, 300));
    const ed = await page.evaluate(() => ({ text: document.body.innerText, colors: document.querySelectorAll("#dColors .key-row").length,
      scrollW: document.documentElement.scrollWidth }));
    ok(ed.colors === 6, `${scheme}: editor opens with 6 colors (${ed.colors})`);
    ok(ed.scrollW <= 375, `${scheme}: no sideways scrolling (${ed.scrollW}px)`);
    await page.screenshot({ path: OUT + `editor-${scheme}.png`, fullPage: true }); await new Promise(r => setTimeout(r, 400));

    // 10 colors, width 49 (the chart's real size), a border, a name.
    await page.$eval("#dK", el => { el.value = 10; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.click("#dW", { clickCount: 3 }); await page.type("#dW", "49");
    await page.click('[data-border="1"]');
    await page.type("#dName", "Chart test " + scheme);
    await page.$eval('#dColors input[data-i="0"]', el => { el.value = "Gray Red Heart"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await new Promise(r => setTimeout(r, 300));
    const info = await page.evaluate(() => ({ size: document.getElementById("dSize").textContent, colors: document.querySelectorAll("#dColors .key-row").length }));
    console.log("     " + info.size);
    ok(info.colors === 10, `${scheme}: 10 colors after the slider (${info.colors})`);
    await page.click('[data-view="photo"]'); await new Promise(r => setTimeout(r, 100));
    await page.screenshot({ path: OUT + `editor-photo-${scheme}.png` });
    // drag the preview
    const box = await (await page.$("#chart")).boundingBox();
    await page.mouse.move(box.x + 100, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 60, box.y + 60, { steps: 5 }); await page.mouse.up();
    await page.click("#dSave");
    await page.waitForFunction(() => location.hash.startsWith("#pattern/p"));
    const saved = await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem("rowbyrow.v1")), p = Object.values(d.patterns)[0];
      return { name: p.name, w: p.grid[0].length, h: p.grid.length, n: p.colors.length, first: p.colors[0].name, t: !!p.t,
        oldPlace: d.progress["monster-duo|rows|right"].step, text: document.body.innerText };
    });
    ok(saved.name === "Chart test " + scheme && saved.w === 51 && saved.n === 10 && saved.t, `${scheme}: saved ${saved.name}, ${saved.w}x${saved.h}, ${saved.n} colors, stamped for sync`);
    ok(saved.first === "Gray Red Heart", `${scheme}: typed yarn name kept`);
    ok(saved.oldPlace === 22, `${scheme}: Monster Duo place untouched`);
    await page.screenshot({ path: OUT + `saved-${scheme}.png`, fullPage: true }); await new Promise(r => setTimeout(r, 400));

    // Crochet it, rename, then delete.
    await page.click('.btn.primary[data-go^="#work/"]'); await page.waitForSelector(".chips");
    await page.click('[data-chip="0"]'); await page.click('[data-act="next"]');
    const work = await page.evaluate(() => document.querySelector(".topbar .title b").textContent);
    ok(work === "Row 2 of " + saved.h, `${scheme}: crochet mode works on the new pattern (${work})`);
    await page.screenshot({ path: OUT + `work-${scheme}.png` });
    await page.goto(URL + "#home", { waitUntil: "load" }); await page.reload({ waitUntil: "load" });
    const order = await page.evaluate(() => [...document.querySelectorAll(".pattern-card b")].map(b => b.textContent));
    ok(order[0] === "Chart test " + scheme, `${scheme}: most recently used pattern is first (${order.join(" | ")})`);
    await page.screenshot({ path: OUT + `home2-${scheme}.png`, fullPage: true }); await new Promise(r => setTimeout(r, 400));
    await page.click(".pattern-card"); await page.waitForSelector("#patName");
    await page.click("#patName", { clickCount: 3 }); await page.type("#patName", "Renamed\n");
    await page.click('[data-act="delete-ask"]'); await page.click('[data-act="delete"]');
    await page.waitForFunction(() => location.hash === "#home");
    const after = await page.evaluate(() => ({ list: [...document.querySelectorAll(".pattern-card b")].map(b => b.textContent),
      stored: JSON.parse(localStorage.getItem("rowbyrow.v1")).patterns }));
    const entry = Object.values(after.stored)[0];
    ok(!after.list.includes("Renamed") && entry.deleted && entry.t && !entry.grid, `${scheme}: delete leaves a synced marker only`);
    ok(errors.length === 0, `${scheme}: no page errors ${errors.join(" | ")}`);
    await page.close();
  }
  await browser.close();
  console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
