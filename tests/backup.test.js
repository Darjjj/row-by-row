// Backup and restore: a backup carries everything back, restoring never removes or rolls back anything,
// and files that aren't backups (or are tampered with) are refused or trimmed.
const fs = require("fs"), vm = require("vm"), path = require("path");
const repo = path.join(__dirname, "..");
const ctx = { module: undefined, document: { addEventListener() {} }, console };
vm.createContext(ctx);
for (const f of ["written.js", "backup.js"]) vm.runInContext(fs.readFileSync(path.join(repo, f), "utf8"), ctx);
const { makeBackup, readBackup, restoreInto, backupSummary } = vm.runInContext("({ makeBackup, readBackup, restoreInto, backupSummary })", ctx);
let fails = 0; const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fails++; };
const clone = o => JSON.parse(JSON.stringify(o));

const chart = { id: "pabc123", name: "Turtle", grid: ["AB", "BA"], colors: [{ code: "A", name: "Green", hex: "#33aa55" }, { code: "B", name: "White", hex: "#ffffff" }], created: 5, t: 9 };
const written = { id: "w-bug", kind: "written", name: "Bug", notes: "", created: 7, t: 9,
  pieces: [{ id: "body", name: "Body", count: 2, parts: [{ name: "Body", steps: [{ rd: 1, do: "6 sc in magic ring", sts: 6 }] }] }] };
const phone = {
  settings: { scale: 1, lastBackup: 1 }, syncedWith: "someone",
  patterns: { pabc123: chart, "w-bug": written, gone: { deleted: true, t: 3 } },
  progress: { "pabc123|rows|right": { step: 40, inrow: 2, t: 9 }, "w-bug|piece|body": { step: 3, inrow: 0, t: 9 } },
  prefs: { pabc123: { mode: "rows", hand: "right", t: 9 } },
  notes: [{ id: 100, text: "Bigger counts please", at: 100, where: "", sent: true, sentAt: 200, via: "inbox", from: "x", device: "y" },
    { id: 101, deleted: true, text: "", where: "" }]
};

// Round trip
const file = JSON.stringify(makeBackup(phone, 1234));
const b = readBackup(file);
ok(Object.keys(b.patterns).length === 2 && !b.patterns.gone, "deleted patterns stay out of the backup");
ok(b.patterns.pabc123.grid.join() === "AB,BA" && b.patterns["w-bug"].pieces[0].id === "body" && b.patterns["w-bug"].created === 7, "chart and written patterns come back whole");
ok(b.progress["pabc123|rows|right"].step === 40 && b.progress["pabc123|rows|right"].inrow === 2, "her place comes back");
ok(b.notes.length === 1 && b.notes[0].via === "inbox" && b.notes[0].from === undefined, "notes come back, deleted ones and extra fields left out");
ok(!file.includes("someone") && !file.includes("lastBackup"), "this device's account link and settings aren't in the file");
ok(backupSummary(b) === "2 patterns, your place in 2 patterns, 1 note", "summary: " + backupSummary(b));

// Restoring onto a wiped phone brings everything back
const empty = { settings: {}, patterns: {}, progress: {}, prefs: {}, notes: [] };
const did = restoreInto(empty, b);
ok(did.patterns === 2 && did.places === 2 && did.notes === 1 && empty.prefs.pabc123.mode === "rows", "a wiped phone gets everything back: " + JSON.stringify(did));

// Restoring an OLD backup onto a phone that has moved on changes nothing
const old = clone(phone); old.progress["pabc123|rows|right"] = { step: 10, inrow: 0 };
const ahead = clone(phone); ahead.progress["pabc123|rows|right"].step = 80;
const before = JSON.stringify(ahead);
const did2 = restoreInto(ahead, readBackup(JSON.stringify(makeBackup(old, 1))));
ok(JSON.stringify(ahead) === before && did2.patterns + did2.places + did2.notes === 0, "an old backup never moves her place back or changes anything");

// A pattern she deleted (or that sync deleted) comes back; one she edited since isn't replaced
const now = clone(phone);
now.patterns.pabc123 = { deleted: true, t: 50 };
now.patterns["w-bug"].name = "Bug (renamed)";
restoreInto(now, b);
ok(now.patterns.pabc123.grid && now.patterns["w-bug"].name === "Bug (renamed)", "deleted patterns come back, edited ones are kept as they are now");
ok(now.patterns.pabc123.t === undefined, "a restored pattern has no old timestamp, so the next save stamps it newer than the delete and it syncs back");

// Further along in the backup moves her forward
const behind = clone(phone); behind.progress["w-bug|piece|body"] = { step: 1, inrow: 0, back: 5000, t: 99 };
const did3 = restoreInto(behind, b);
ok(behind.progress["w-bug|piece|body"].step === 3 && behind.progress["w-bug|piece|body"].back === undefined && did3.places === 1, "a place further along in the backup moves her forward");

// Files that aren't backups
const refused = ["not json", "{}", JSON.stringify({ app: "other", kind: "backup", data: {} }), JSON.stringify({ app: "row-by-row", kind: "backup", version: 2, data: {} })];
ok(refused.every(t => { try { readBackup(t); return false; } catch (e) { return /Row by Row/.test(e.message); } }), "non-backups and newer-version backups are refused with a readable message");

// Tampered or broken entries are dropped, the rest still restores
const evil = JSON.parse(file);
evil.data.patterns.bad1 = { id: "bad1", name: "<img onerror=x>", grid: ["AZ"], colors: [{ code: "A", hex: "#000000" }] };   // Z isn't a color
evil.data.patterns.bad2 = { id: "../x", name: "x", grid: ["A"], colors: [{ code: "A", hex: "#000000" }] };
evil.data.patterns.mismatch = clone(chart);   // id doesn't match its key
evil.data.patterns.pabc123.extra = "<script>";
evil.data.progress["x|rows|right"] = { step: -4 };
evil.data.prefs.q = { mode: "zigzag" };
const e2 = readBackup(JSON.stringify(evil));
ok(e2.skipped === 3 && !e2.patterns.bad1 && !e2.patterns.mismatch && e2.patterns.pabc123.extra === undefined && !e2.progress["x|rows|right"] && !e2.prefs.q,
  "broken patterns, odd places and unknown fields are dropped (" + e2.skipped + " skipped)");

console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
