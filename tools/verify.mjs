// Ehrliche Pruefung des Handy-Kurses: jeder Schritt der Reihe nach, wie ein Mensch.
//   1. Station vorbereiten (wie die Tour), Pruefen darf noch NICHT bestehen (sonst: "geschenkt").
//   2. Nur Handgriffe aus tools/walkthroughs.mjs (Gesten), danach muss Pruefen bestehen.
// Kein Zustand wird direkt gesetzt. Aufruf: node tools/verify.mjs [--from N] [--only id] [--verbose]

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../js/core/boot.js";
import { evaluate } from "../js/core/tour.js";
import { SCRIPTS, generic } from "./walkthroughs.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (name) => JSON.parse(readFileSync(join(root, "data", name), "utf8"));
const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

const data = { course: load("course.json"), net: load("net.json"), code: load("code.json"), ui: load("ui.json") };
const app = createApp(data);
const { tour, gestures: g } = app;

const report = { total: tour.lessons.length, passed: 0, failed: [], gifted: [], errors: [] };
for (let i = 0; i < tour.lessons.length; i += 1) {
  const lesson = tour.lessons[i];
  if (only && lesson.id !== only) {
    // Zustand trotzdem fortschreiben, damit "keep"-Stationen ihren Vorlauf haben
    tour.goTo(i);
    try { (SCRIPTS[lesson.id] || ((x) => generic(x, lesson)))(g, lesson); } catch { /* Vorlauf */ }
    continue;
  }
  tour.goTo(i);
  const before = evaluate(lesson.rules, tour.snapshot(), tour.baseline);
  if (before.passed) report.gifted.push({ i, id: lesson.id });
  try {
    const script = SCRIPTS[lesson.id];
    if (script) script(g, lesson);
    else generic(g, lesson);
  } catch (error) {
    report.errors.push({ i, id: lesson.id, error: error.message });
  }
  const result = tour.check();
  if (result.passed) {
    report.passed += 1;
  } else {
    const missing = result.results.filter((r) => !r.ok).map((r) => ({ key: r.key, op: r.op || "eq", want: r.value, got: typeof r.actual === "string" ? r.actual.slice(0, 160) : r.actual }));
    report.failed.push({ i, id: lesson.id, chapter: lesson.chapter, missing });
  }
  if (verbose) console.log(i, lesson.id, result.passed ? "ok" : "FAIL");
}

console.log(JSON.stringify({
  total: report.total, passed: report.passed, failed: report.failed.length, gifted: report.gifted.length, errors: report.errors.length,
}, null, 0));
if (report.errors.length) console.log("ERRORS", JSON.stringify(report.errors.slice(0, 40), null, 1));
if (report.failed.length) console.log("FAILED", JSON.stringify(report.failed.slice(0, 40), null, 1));
if (report.gifted.length) console.log("GESCHENKT (besteht ohne Handgriff)", report.gifted.map((x) => `#${x.i} ${x.id}`).join(", "));
process.exit(report.failed.length || report.errors.length ? 1 : 0);
