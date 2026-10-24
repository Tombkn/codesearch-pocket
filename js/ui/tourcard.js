// Tour-Karte: JETZT DU, AM HANDY, DARAUF ACHTEN, Rueckmeldung, Knoepfe, Bedeutung, Grenzen, Begriffe.

import { $, esc } from "./dom.js";
import { phoneSteps } from "../core/phone.js";

const MODE_LABEL = { refs: "USED BY", trace: "USES", chain: "FLOW", map: "STRUCTURE", entries: "TRIGGERS", tour: "CALL PATH", check: "AUDIT" };
const OP_TEXT = { eq: "=", contains: "enthält", not_contains: "enthält nicht", gt: ">", near: "≈", delta: "gestiegen auf", changed: "geändert auf" };

function ruleOp(rule) { return OP_TEXT[rule.op || "eq"] || rule.op; }

// Wert so, wie Pruefen ihn liest (Python-Schreibweise)
function pyValue(value) {
  if (value === true) return "True";
  if (value === false) return "False";
  if (value === null || value === undefined) return "None";
  if (typeof value === "string") return `„${value.length > 60 ? value.slice(0, 60) + "…" : value}“`;
  return String(value);
}

export function renderTour(ctx) {
  const { tour, ui } = ctx;
  const lesson = tour.lesson();
  const index = tour.step;
  const count = tour.lessons.length;
  const p = tour.progress();
  const done = tour.done[lesson.id];
  $("#tb-prog").textContent = `${p.total - p.open}/${p.total}`;
  $("#tb-title").textContent = `${String(lesson.chapter + 1).padStart(2, "0")} · ${tour.chapters[lesson.chapter] || ""}`;
  $("#tour-head").innerHTML = `
    <div class="eyebrow"><span>MITMACH-TOUR ${String(index + 1).padStart(3, "0")} / ${count}</span><span class="sp"></span><span>${done ? (done === "confirmed" ? "✓ bestätigt" : "✓ geprüft") : (tour.skipped.has(lesson.id) ? "übersprungen" : "offen")}</span></div>
    <div class="chap">${String(lesson.chapter + 1).padStart(2, "0")}  ${esc(tour.chapters[lesson.chapter] || "")}</div>
    <h2>${esc(lesson.title)}</h2>`;
  const nohelp = Boolean(lesson.nohelp);
  const steps = nohelp ? [] : phoneSteps(lesson);
  const fb = tour.feedback || "";
  const fbClass = fb.startsWith("ZUSTAND GEPRÜFT") || fb.startsWith("VON DIR") ? "ok" : (fb.startsWith("NOCH OFFEN") ? "bad" : "");
  const checks = ctx.lastCheck && ctx.lastCheck.id === lesson.id ? ctx.lastCheck.results : null;
  const buttons = [
    ["workspace", "Arbeitsplatz"], ["labparams", "Lab-Parameter"], ["params", "Parameter"], ["csparams", "CS-Parameter"],
    ["compare", "Tabs vergleichen"], ["chapters", "Kapitel"], ["hint", nohelp ? (tour.hint ? "Lösung verbergen" : "Lösung zeigen") : (tour.hint ? "Hinweis aus" : "Hinweis")], ["skip", "Überspringen"], ["pause", "Pause / Ende"],
  ];
  if (nohelp) buttons.splice(buttons.findIndex(([k]) => k === "compare"), 1);
  if (lesson.id === "error_create") buttons.push(["error", "Fehler setzen", true]);
  if (lesson.chapter === 8) buttons.push(["restore", "Fehler zurück", true]);
  if (lesson.id === "flowlens" || lesson.chapter === 24) buttons.push(["flowlens", "FlowLens", true]);
  if (lesson.prompt) buttons.push(["prompt", "Codex-Aufgabe kopieren", true]);
  const target = `ARBEITSPLATZ  ${lesson.target}\nCODESEARCH  ${MODE_LABEL[lesson.mode] || String(lesson.mode).toUpperCase()}`;
  // Knoepfe, die der Lektionstext nennt, direkt unter JETZT DU
  const mentioned = [["Arbeitsplatz", "workspace"], ["Lab-Parameter", "labparams"], ["CS-Parameter", "csparams"], ["Codex-Aufgabe", "prompt"],
    ["Fehler setzen", "error"], ["Fehler zurück", "restore"], ["„FlowLens“", "flowlens"], ["Tabs vergleichen", "compare"], ["Kapitel", "chapters"]]
    .filter(([word, key]) => !nohelp && lesson.action.includes(word) && buttons.some(([k]) => k === key))
    .map(([, key]) => buttons.find(([k]) => k === key));
  $("#tour-head").insertAdjacentHTML("afterbegin", `<button class="mini-t" data-tour="mini" title="Karte klein / groß">${ctx.tourMini ? "▴" : "▾"}</button>`);
  $("#tour-body").innerHTML = `
    <div class="tblk now"><div class="l">JETZT DU</div><p>${esc(lesson.action)}</p></div>
    ${mentioned.length ? `<div class="tblk quickbtns">${mentioned.map(([key, label]) => `<button data-tour="${key}">${esc(label)}</button>`).join("")}</div>` : ""}
    ${steps.length ? `<div class="tblk phone"><div class="l">AM HANDY</div><ul>${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>` : ""}
    ${nohelp && !done ? `<div class="tblk muted"><div class="l">OHNE HILFEN</div><p>Welche Frage ist das – und welches Werkzeug beantwortet sie? Du entscheidest Tab und Zeile selbst. Prüfen sagt nur „noch nicht“. Hängst du fest: „Lösung zeigen“.</p></div>` : `<div class="tblk"><div class="l">DARAUF ACHTEN</div><p>${esc(lesson.expected)}</p></div>`}
    ${fb ? `<div class="tblk feedback ${fbClass}"><p>${esc(fb)}</p>${checks ? `<ul class="checks">${checks.map((r) => `<li><span class="d ${r.ok ? "ok" : ""}"></span><span>${esc(r.ok ? `${r.key} ${ruleOp(r)} ${pyValue(r.op === "delta" || r.op === "changed" ? r.actual : r.value)}` : (r.hint || r.key))}</span></li>`).join("")}</ul>` : ""}</div>` : ""}
    ${lesson.patched ? `<div class="tblk patch"><div class="l">KORRIGIERT IM HANDY-KURS</div><p>${esc(lesson.patched.join(" "))}</p></div>` : ""}
    <div class="tbtns">${buttons.map(([key, label, special]) => `<button data-tour="${key}" class="${special ? "special" : ""}">${esc(label)}</button>`).join("")}</div>
    <div class="tblk"><div class="l">DAS BEDEUTET</div><p>${esc(lesson.meaning || "")}</p></div>
    <div class="tblk"><div class="l">HIER GLÄNZT ES</div><p>${esc(lesson.why || "")}</p></div>
    <div class="tblk muted"><div class="l">DAFÜR REICHT ES NICHT</div><p>${esc(lesson.limit || "")}\nNächster Schritt: ${esc(lesson.next_step || "")}</p></div>
    <div class="tblk muted"><div class="l">ZIEL</div><p>${esc(target)}</p></div>
    ${tour.hint ? `<div class="tblk"><div class="l">${nohelp ? "LÖSUNG" : "HINWEIS"}</div><p>${esc(lesson.hint || "")}</p></div>` : ""}
    <div class="tblk muted"><div class="l">AGENDA – BEGRIFFE &amp; METHODEN</div><p>${esc(lesson.glossary || "")}</p></div>`;
  const nextLocked = !done;
  $("#tour-actions").innerHTML = `
    <button data-tour="back">‹ Zurück</button>
    ${lesson.observed ? `<button class="seen ${tour.observed ? "done" : ""}" data-tour="seen">${tour.observed ? "✓ Gesehen" : "Gesehen"}</button>` : `<button data-tour="hint">${nohelp ? "Lösung" : "Hinweis"}</button>`}
    <button class="check" data-tour="check">Prüfen</button>
    <button class="next ${nextLocked ? "locked" : ""}" data-tour="next">${index < count - 1 ? "Weiter ›" : "Am Ende"}</button>`;
  void ui;
}
