// Lesekarte: Zweck verstehen, selbst handeln, Ergebnis prüfen. Zusatzwerkzeuge bleiben aufklappbar.
import { $, esc, updateHtml } from "./dom.js";
import { phoneSteps } from "../core/phone.js";
import { transferCard, lessonEvidence } from "./learningview.js";

const MODE_LABEL = { refs: "USED BY", trace: "USES", chain: "FLOW", map: "STRUCTURE", entries: "TRIGGERS", tour: "CALL PATH", check: "AUDIT" };
const OP_TEXT = { eq: "=", contains: "enthält", not_contains: "enthält nicht", gt: ">", near: "≈", delta: "gestiegen auf", changed: "geändert auf" };

function pyValue(value) {
  if (value === true) return "True";
  if (value === false) return "False";
  if (value === null || value === undefined) return "None";
  if (typeof value === "string") return `„${value.length > 60 ? value.slice(0, 60) + "…" : value}“`;
  return String(value);
}

function button([key, label, special]) {
  return `<button data-tour="${key}" class="${special ? "special" : ""}">${esc(label)}</button>`;
}

export function renderTour(ctx) {
  const { tour } = ctx;
  const lesson = tour.lesson();
  const index = tour.step;
  const count = tour.lessons.length;
  const progress = tour.progress();
  const done = tour.done[lesson.id];
  const canAdvance = Boolean(done) && (!lesson.workflow_id || tour.currentPassed);
  const changed = ctx.renderedLessonId !== lesson.id;
  const chapterLessons = tour.lessons.filter((item) => item.chapter === lesson.chapter);
  const chapterStep = chapterLessons.findIndex((item) => item.id === lesson.id) + 1;
  const nohelp = Boolean(lesson.nohelp);
  const reveal = !nohelp || tour.hint || (lesson.workflow_id ? tour.currentPassed : done);
  const result = ctx.lastCheck?.id === lesson.id ? ctx.lastCheck : null;
  const steps = nohelp ? [] : phoneSteps(lesson);
  $("#tb-prog").textContent = `${progress.total - progress.open}/${progress.total}`;
  $("#tb-title").textContent = "CodeSearch Pocket";
  updateHtml($("#tour-head"), `
    <div class="eyebrow"><span>MITMACH-TOUR ${index + 1} / ${count}</span><span class="sp"></span><span>${done ? (done === "confirmed" ? "✓ selbst bestätigt" : "✓ Modell geprüft") : (tour.skipped.has(lesson.id) ? "übersprungen" : "offen")}</span></div>
    <div class="chap">${lesson.chapter + 1} · ${esc(tour.chapters[lesson.chapter] || "")}</div>
    <h2>${esc(lesson.title)}</h2>
    <div class="reader-options"><span>Schritt ${chapterStep} von ${chapterLessons.length} im Kapitel</span>
      <button data-tour="read-size" aria-pressed="${Boolean(ctx.readerLarge)}" aria-label="${ctx.readerLarge ? "Leseschrift auf normale Größe stellen" : "Leseschrift vergrößern"}">${ctx.readerLarge ? "Aa Normal" : "Aa Größer"}</button></div>`);

  const tools = [
    ["workspace", "Arbeitsplatz"], ["labparams", "Lab-Parameter"], ["params", "Parameter"], ["csparams", "CS-Parameter"],
    ...(!nohelp ? [["compare", "Tabs vergleichen"]] : []), ["chapters", "Kapitel"],
    ["hint", nohelp ? (tour.hint ? "Lösung verbergen" : "Lösung zeigen") : (tour.hint ? "Hinweis verbergen" : "Hinweis")],
    ["skip", "Überspringen"], ["pause", "Pause / Ende"],
  ];
  if (lesson.id === "error_create") tools.push(["error", "Fehler setzen", true]);
  if (lesson.chapter === 8) tools.push(["restore", "Fehler zurück", true]);
  if (lesson.id === "flowlens" || lesson.chapter === 24) tools.push(["flowlens", "FlowLens", true]);
  if (lesson.prompt) tools.push(["prompt", "Codex-Aufgabe kopieren", true]);
  if (lesson.capabilities?.includes("json") || (!lesson.workflow_id && lesson.chapter >= 25 && !lesson.id.startsWith("abschluss_"))) tools.push(["json", "JSON bearbeiten", true]);
  const directions = [lesson.action, ...steps].join("\n");
  const matches = [["Arbeitsplatz", "workspace"], ["Lab-Parameter", "labparams"], ["CS-Parameter", "csparams"],
    ["CodeSearch-Parameter", "csparams"], ["Codex-Aufgabe", "prompt"], ["Fehler setzen", "error"],
    ["Fehler zurück", "restore"], ["FlowLens", "flowlens"], ["Tabs vergleichen", "compare"], ["JSON", "json"]];
  const relevant = new Set(matches.filter(([word]) => !nohelp && directions.includes(word)).map(([, key]) => key));
  const quick = tools.filter(([key]) => relevant.has(key));
  const technicalChecks = result && reveal ? `<details data-persist="checks" class="check-details"><summary>Welche Bedingungen wurden geprüft?</summary>
    <ul class="checks">${result.results.map((rule) => `<li><span class="d ${rule.ok ? "ok" : ""}"></span><span>${esc(rule.ok
      ? `${rule.key} ${OP_TEXT[rule.op || "eq"] || rule.op} ${pyValue(rule.op === "delta" || rule.op === "changed" ? rule.actual : rule.value)}`
      : (rule.hint || rule.key))}</span></li>`).join("")}</ul></details>` : "";
  let feedback = "";
  if (result) {
    const title = result.passed ? (lesson.observed ? "Beobachtung selbst bestätigt" : "Der Modellzustand passt") : "Noch nicht erreicht";
    const explanation = result.passed
      ? (lesson.observed ? "Du hast die geforderte Beobachtung bestätigt. Das ist kein automatischer Verständnistest." : "Die Bedingungen dieser Aufgabe sind erfüllt. Vergleiche deine Beobachtung mit dem erwarteten Ergebnis.")
      : (nohelp && !tour.hint ? "Dein Versuch erfüllt die Aufgabe noch nicht. Du kannst weiter untersuchen oder bewusst die Lösung öffnen." : `Vergleiche deinen Versuch damit: ${lesson.expected}`);
    feedback = `<section class="tblk feedback ${result.passed ? "ok" : "bad"}" aria-label="Rückmeldung">
      <div role="status" aria-live="polite"><h3>${title}</h3><p>${esc(explanation)}</p></div>${technicalChecks}
      <p class="next-guidance">${result.passed ? "Wenn du die Beobachtung nachvollziehen kannst, geht es mit Weiter zur nächsten Station." : "Prüfen verändert deinen Versuch nicht. Du kannst mit einem Hinweis oder selbstständig weiterarbeiten."}</p>
      ${!result.passed ? `<div class="quickbtns">${button(["show-hint", nohelp ? "Lösung öffnen" : "Hinweis öffnen"])}${button(["practice", "Weiter ausprobieren"])}</div>` : ""}</section>`;
  } else if (ctx.showFeedback || tour.observed) {
    feedback = `<section class="tblk feedback" role="status"><p>${esc(tour.feedback)}</p></section>`;
  }
  updateHtml($("#tour-body"), `
    ${reveal ? `<section class="lesson-purpose"><div class="l">1 · VERSTEHEN</div><p>${esc(lesson.why || lesson.meaning || "")}</p>
      ${lesson.meaning && lesson.meaning !== lesson.why ? `<details data-persist="meaning"><summary>Den Zusammenhang verstehen</summary><p>${esc(lesson.meaning)}</p></details>` : ""}</section>` : `<section class="lesson-purpose"><div class="l">OHNE HILFEN</div><p>Du wählst Werkzeug und Vorgehen selbst. Eine Lösung erscheint erst, wenn du sie bewusst öffnest.</p></section>`}
    ${lesson.before ? `<div class="tblk before"><div class="l">VORHER</div><p>${esc(lesson.before)}</p></div>` : ""}
    <section class="tblk now"><div class="l">${nohelp ? "DEIN AUFTRAG" : "2 · SELBST AUSPROBIEREN"}</div><p>${esc(lesson.action)}</p></section>
    ${steps.length ? `<div class="tblk phone"><div class="l">SO GEHT ES AM HANDY</div><ul>${steps.map((step) => `<li>${esc(step)}</li>`).join("")}</ul></div>` : ""}
    ${quick.length ? `<div class="quickbtns">${quick.map(button).join("")}</div>` : ""}
    <button class="practice-start" data-tour="practice">Jetzt selbst ausprobieren →</button>
    ${reveal ? `<section class="tblk expected"><div class="l">3 · DARAN ERKENNST DU ES</div><p>${esc(lesson.expected)}</p><p class="next-guidance">Nach deinem Versuch unten Prüfen drücken.${lesson.observed ? " Gesehen ist deine eigene Bestätigung nach dem Lesen." : ""}</p></section>` : ""}
    ${tour.hint ? `<section class="tblk lesson-hint"><div class="l">${nohelp ? "LÖSUNG" : "HINWEIS"}</div><p>${esc(lesson.hint || "")}</p></section>` : ""}
    ${feedback}
    <details data-persist="tools" class="lesson-tools"><summary>Arbeitsplatz und weitere Werkzeuge</summary><div class="tbtns">${tools.map(button).join("")}</div></details>
    <details data-persist="limits"><summary>Grenzen und nächster Schritt</summary><p>${esc(lesson.limit || "")}</p><p>${esc(lesson.next_step || "")}</p>
      <p class="evidence-note">Arbeitsplatz: ${esc(lesson.target)} · CodeSearch: ${esc(MODE_LABEL[lesson.mode] || String(lesson.mode).toUpperCase())}</p></details>
    ${lessonEvidence(lesson)}${transferCard(lesson)}
    <details data-persist="glossary"><summary>Agenda – Begriffe &amp; Methoden</summary><p>${esc(lesson.glossary || "")}</p></details>
    ${lesson.patched ? `<details data-persist="patch" class="patch"><summary>Korrektur gegenüber der Laptop-Lektion</summary><p>${esc(lesson.patched.join(" "))}</p></details>` : ""}`, changed);

  updateHtml($("#tour-actions"), `
    <button data-tour="back" ${index === 0 ? "disabled" : ""}>‹ Zurück</button>
    ${lesson.observed ? `<button class="seen ${tour.observed ? "done" : ""}" aria-pressed="${tour.observed}" data-tour="seen">${tour.observed ? "✓ Gesehen" : "Gesehen"}</button>` : `<button data-tour="hint">${nohelp ? "Lösung" : "Hinweis"}</button>`}
    <button class="check" data-tour="check">Prüfen</button>
    <button class="next ${canAdvance ? "" : "locked"}" data-tour="next" aria-disabled="${!canAdvance}">${index < count - 1 ? "Weiter ›" : "Am Ende"}</button>`);
  ctx.renderedLessonId = lesson.id;
  if (ctx.showFeedback) {
    $("#tour-body .feedback")?.scrollIntoView({ block: "nearest" });
    ctx.showFeedback = false;
  }
  if (ctx.showHint) {
    $("#tour-body .lesson-hint")?.scrollIntoView({ block: "nearest" });
    ctx.showHint = false;
  }
}
