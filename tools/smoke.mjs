// Absturztest: jede Station vorbereiten, jeden Tab bauen, fuer jede Zeile DETAIL, Kopier-Menue und Adresse rechnen.
// Findet Fehler, die am Handy erst beim Antippen auftauchen wuerden. Aufruf: node tools/smoke.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../js/core/boot.js";
import { TAB_ORDER } from "../js/core/cs.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (name) => JSON.parse(readFileSync(join(root, "data", name), "utf8"));
const app = createApp({ course: load("course.json"), net: load("net.json"), code: load("code.json"), ui: load("ui.json") });
const { tour, cs, gestures: g } = app;
const problems = [];
let views = 0;
let rows = 0;
const seen = new Set();
const origError = console.error;
console.error = (...a) => problems.push({ where: "console.error", msg: a.map(String).join(" ").slice(0, 200) });

for (let i = 0; i < tour.lessons.length; i += 1) {
  tour.goTo(i);
  const key = `${cs.state.focus}|${cs.codeTargetPath()}`;
  if (seen.has(key)) continue;
  seen.add(key);
  for (const mode of TAB_ORDER) {
    for (const view of ["", ...(mode === "map" ? ["landkarte", "system"] : []), ...(mode === "search" ? ["path", "guide"] : [])]) {
      try {
        cs.state.view = "";
        cs.SetMode(mode);
        if (view) { cs.state.view = view; cs.rebuild(); }
        views += 1;
        const notice = cs.state.hits.find((h) => h.kind === "notice" && /nicht verfügbar/.test(h.text));
        if (notice) problems.push({ i, mode, view, msg: notice.text });
        cs.state.hits.forEach((h, idx) => {
          if (h.kind === "section") return;
          rows += 1;
          cs.state.selected = idx;
          cs.detailFor(h);
          cs.copyOptions(h);
          cs.dataAddress(h);
          cs.explain(h);
        });
        cs.columns();
        cs.statusLine();
      } catch (error) {
        problems.push({ i, id: tour.lessons[i].id, mode, view, msg: error.stack.split("\n").slice(0, 3).join(" | ") });
      }
    }
  }
}
// Overview-Ansichten und Untersuchungs-Ansichten
for (const kind of ["ext", "atlas", "short", "health"]) {
  try { g.overview(kind); views += 1; cs.state.hits.forEach((h) => cs.detailFor(h)); g.overview(kind); } catch (error) { problems.push({ overview: kind, msg: error.message }); }
}
for (const cmd of [">states", ">fall a", ">fall b", ">vergleich", ">beispiel anfrage", ">nachfrage", ">beispiel antwort", ">antwort", ">beispiel vorschau", ">vorschau", ">bildfall", ">untersuchung", ">hilfe", ">review", ">story", ">export", ">ziel", ">lernen an"]) {
  try { cs.command(cmd); views += 1; cs.state.hits.forEach((h) => cs.detailFor(h)); } catch (error) { problems.push({ cmd, msg: error.message }); }
}
console.error = origError;
console.log(JSON.stringify({ targets: seen.size, views, rows, problems: problems.length }));
if (problems.length) console.log(JSON.stringify(problems.slice(0, 30), null, 1));
process.exit(problems.length ? 1 : 0);
