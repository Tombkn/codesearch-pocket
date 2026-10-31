import { esc } from "./dom.js";
import { guideForLesson, LAPTOP_START, SOURCE_REF } from "../core/learning.js";

function sourceLink(path, label = "Fundstelle in der Laptop-Version") {
  return `<a href="https://github.com/${esc(SOURCE_REF.repo)}/blob/${esc(SOURCE_REF.commit)}/${esc(path)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
}

export function lessonEvidence(lesson) {
  const onlyReading = lesson.rules?.length && lesson.rules.every((rule) => rule.key === "observed");
  const explanation = onlyReading
    ? "Dieser Schritt prüft deine Lesebestätigung. Er misst weder Verständnis noch eine Handlung in TouchDesigner."
    : lesson.observed
      ? "Prüfen verbindet deine Lesebestätigung mit Regeln über den aktuellen Handy-Zustand. Ob du den Zusammenhang eigenständig anwenden kannst, zeigt erst ein eigener Fall."
      : "Prüfen vergleicht den Zustand der Handy-Simulation mit den Regeln dieser Station. Eine bereits erfüllte Regel belegt keinen neuen Handgriff.";
  return `<details data-persist="evidence"><summary>Was wird hier geprüft?</summary><p>${explanation}</p><p class="evidence-note">„Modell geprüft“, „selbst bestätigt“ und „am Laptop ausgeführt“ sind verschiedene Nachweise. Pocket setzt keinen Laptop-Test automatisch auf bestanden.</p></details>`;
}

export function transferCard(lesson) {
  const guide = guideForLesson(lesson);
  if (!guide) return "";
  // Abschlussaufgaben bleiben ohne vorweggenommene Lösung.
  const trace = lesson.nohelp ? "" : `<div class="transfer-grid">
    <div><strong>Vorher</strong><p>${esc(guide.before)}</p></div>
    <div><strong>Aktion</strong><p>${esc(guide.action)}</p></div>
    <div><strong>Nachher</strong><p>${esc(guide.after)}</p></div></div>`;
  return `<details data-persist="transfer"><summary>Am Laptop anwenden · Kapitel ${lesson.chapter + 1}</summary>
    <p><strong>Ziel:</strong> ${esc(guide.goal)}</p>${trace}
    <ol>${guide.laptop.map((step) => `<li>${esc(step)}</li>`).join("")}</ol>
    <p><strong>Daran erkennst du es:</strong> ${esc(guide.proof)}</p>
    <p><strong>Grenze:</strong> ${esc(guide.limit)}</p>
    <p class="evidence-note">${sourceLink(guide.source)} · CodeSearch ${esc(SOURCE_REF.version)}. Links brauchen Internet; dieser Leitfaden ist offline enthalten.</p>
    <button data-tour="laptop" class="transfer-start">Laptop-Start und kompletter Lernplan</button></details>`;
}

export function laptopOverview(course) {
  const guides = course.chapters.map((_, index) => guideForLesson(course.lessons.find((l) => l.chapter === index)));
  return `<div class="md learning-guide"><h2>Vom Handy ins echte Projekt</h2>
    <p>Die Tour trainiert die Bedienung am nachgebildeten Übungsnetz. Am Laptop kontrollierst du zusätzlich echte Operatoren, Fensterfokus, Outputs und das Verhalten nach einem Neustart.</p>
    <p>Abgeglichen mit CodeSearch ${esc(SOURCE_REF.version)}, Stand ${esc(SOURCE_REF.checked)}. ${sourceLink("README.de.md", "Version und Installation")}</p>
    ${LAPTOP_START.map((step, index) => `<h3>${index + 1}. ${esc(step.title)}</h3><p>${esc(step.text)}</p>`).join("")}
    <h2>Alle Kapitel und ihre praktische Prüfung</h2>
    <p>Für den ersten Durchgang folgst du dem Kurs. Hier findest du später für jede Frage den passenden Abschnitt und den Übergang zur Laptop-Version. Kapitel öffnen ändert nur die aktuelle Kursstation; bestehende Häkchen bleiben erhalten.</p>
    ${guides.map((guide, index) => `<details data-persist="chapter-${index}"><summary>${index + 1}. ${esc(course.chapters[index] || guide.title)}</summary>
      <p>${esc(guide.goal)}</p><p><strong>Praktische Prüfung:</strong> ${esc(guide.proof)}</p><p><strong>Grenze:</strong> ${esc(guide.limit)}</p>
      <button class="feat" data-learn-chapter="${index}">Kapitel ${index + 1} öffnen →</button>${sourceLink(guide.source)}</details>`).join("")}
    <h2>Was „vollständig“ hier bedeutet</h2><p>Der Kurs enthält alle ${course.source?.lessons || 558} Lektionen des abgeglichenen TD-Stands, darunter 96 SignalGarden-Stationen in acht vollständigen Workflows, zusätzlich Abschluss- und Werkstattfälle. Neue spätere GitHub-Versionen sind erst nach einem erneuten Quellenabgleich abgedeckt. Die Kapitelzahl und grüne Modelltests sind kein Beweis für Lernerfolg oder vollständige TouchDesigner-Kompatibilität.</p>
    <h2>Agenda – Begriffe &amp; Methoden</h2><p>Simulation: nachgebautes Verhalten im Browser. Native Prüfung: Ausführung im echten TouchDesigner. Revision: Kennung eines Quelltextstands. Scope: untersuchter Bereich. Re-Init: eine Extension-Instanz wird neu erzeugt. Reload: Projektdatei erneut laden.</p></div>`;
}
