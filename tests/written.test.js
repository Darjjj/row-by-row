// Written patterns: round expansion, stitch-count checking, import cleaning, and the import link round trip.
// If patterns-draft/very-hungry-caterpillar.json exists (it's kept out of git), every count in it is re-checked too.
const fs = require("fs"), vm = require("vm"), path = require("path"), zlib = require("zlib");
const repo = path.join(__dirname, "..");
const ctx = { module: undefined, document: { addEventListener() {} }, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(repo, "written.js"), "utf8"), ctx);
const { expandSteps, expectedCount, cleanProject } = vm.runInContext("({ expandSteps, expectedCount, cleanProject })", ctx);
let fails = 0; const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fails++; };

// Expansion
const piece = { id: "x", name: "X", count: 2, parts: [
  { name: "Body", steps: [{ rd: 1, do: "6 sc in magic ring", sts: 6 }, { rd: [2, 4], do: "sc around", sts: 6 }, { note: "Stuff it." }] },
  { name: "Leaf", steps: [{ rd: 1, pre: "Row", do: "sc, hdc, sc", sts: 3 }] }] };
const st = expandSteps(piece);
ok(st.length === 6, `a range becomes one step per round (${st.length} steps)`);
ok(st[2].label === "Rd 3" && st[2].range === "2–4" && st[4].label === "" && st[5].label === "Row 1" && st[5].part === "Leaf",
  "labels, ranges, notes and parts come through");

// Count rules
const cases = [["6 sc in magic ring", 0, 6], ["inc around", 6, 12], ["(sc, inc) around", 12, 18], ["(2 sc, inc) around", 18, 24],
  ["(3 sc, dec) around", 30, 24], ["dec around", 12, 6], ["BLO (4 sc, dec) around", 18, 15], ["(sc, dec) around", 12, 8], ["sc around", 30, 30]];
ok(cases.every(([t, b, want]) => expectedCount(t, b) === want), "stitch count rules: " + cases.map(([t, b]) => `${t} → ${expectedCount(t, b)}`).join("; "));
ok(Number.isNaN(expectedCount("(2 sc, inc) around", 10)), "a repeat that doesn't fit the stitches is flagged");

// Her pattern, if it's here: every round with a count must match what its instructions give.
const draft = path.join(repo, "patterns-draft", "very-hungry-caterpillar.json");
if (fs.existsSync(draft)) {
  const proj = JSON.parse(fs.readFileSync(draft, "utf8"));
  ok(!!cleanProject(proj), `her pattern passes the import check (${proj.pieces.length} pieces)`);
  const problems = [];
  let checked = 0;
  for (const pc of proj.pieces) for (const part of pc.parts) {
    let before = 0;
    for (const s of part.steps) {
      if (s.rd === undefined) continue;
      const rounds = Array.isArray(s.rd) ? s.rd[1] - s.rd[0] + 1 : 1;
      for (let r = 0; r < rounds; r++) {
        const want = expectedCount(s.do, before);
        if (want !== null && s.sts) { checked++; if (want !== s.sts) problems.push(`${pc.name} / ${part.name} / Rd ${Array.isArray(s.rd) ? s.rd[0] + r : s.rd}: "${s.do}" gives ${want}, written ${s.sts}`); }
        if (s.sts) before = s.sts; else if (want !== null) before = want;
      }
    }
  }
  ok(problems.length === 0, `every stitch count in her pattern adds up (${checked} rounds checked)${problems.length ? ": " + problems.join(" | ") : ""}`);
  // The import link: what the Python script makes, the browser decodes back to the same pattern.
  const raw = Buffer.from(JSON.stringify(proj));
  const code = zlib.deflateRawSync(raw, { level: 9 }).toString("base64url");
  const back = JSON.parse(zlib.inflateRawSync(Buffer.from(code, "base64url")).toString());
  ok(JSON.stringify(cleanProject(back)) === JSON.stringify(cleanProject(proj)), `the import link carries the whole pattern (${code.length} characters)`);
} else console.log("     (no patterns-draft/very-hungry-caterpillar.json here, skipping her pattern)");

// Import cleaning rejects things that aren't patterns and drops anything unexpected
const good = { id: "w-test", kind: "written", name: "Test", pieces: [piece], extra: "<script>" };
const c = cleanProject(good);
ok(c.extra === undefined && c.pieces[0].parts[1].steps[0].pre === "Row", "unknown fields are dropped, known ones kept");
const bad = [{ ...good, kind: "chart" }, { ...good, id: "../x" }, { ...good, pieces: [] },
  { ...good, pieces: [{ ...piece, count: 0 }] }, { ...good, pieces: [{ ...piece, id: "A B" }] },
  { ...good, pieces: [{ ...piece, parts: [{ name: "P", steps: [{ rd: [5, 2], do: "sc around" }] }] }] }];
ok(bad.every(b => { try { cleanProject(b); return false; } catch (e) { return true; } }), "bad imports are refused (wrong kind, odd id, no pieces, zero count, bad piece id, backwards range)");

console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
