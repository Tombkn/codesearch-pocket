// DOM-Integrationstest der echten App-Handler. jsdom hat kein Layout und keine
// Touch-Engine: diese Tests sind ausdrücklich kein iOS-/Android-Scrollnachweis.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { JSDOM } from "jsdom";

const root = new URL("../", import.meta.url);
const page = new JSDOM(readFileSync(new URL("index.html", root), "utf8"), { url: "https://pocket.test/" });
const { window } = page;
for (const name of ["window", "document", "navigator", "location"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? window : window[name] });
}
window.__POCKET_DATA__ = Object.fromEntries(["course.json", "net.json", "code.json", "ui.json", "features.json"]
  .map((name) => [name, JSON.parse(readFileSync(new URL(`data/${name}`, root), "utf8"))]));
if (process.env.POCKET_UI_FIXTURE) Object.assign(window.__POCKET_DATA__['ui.json'], JSON.parse(readFileSync(process.env.POCKET_UI_FIXTURE, 'utf8')));
window.localStorage.setItem("codesearch-pocket-intro", "1");
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.requestAnimationFrame = globalThis.requestAnimationFrame;
window.cancelAnimationFrame = clearTimeout;
const runtimeErrors = [];
window.addEventListener('error', (event) => runtimeErrors.push(event.message));
window.HTMLElement.prototype.scrollIntoView = function () { this.dataset.scrollRequested = "true"; };
const nativeInterval = globalThis.setInterval;
const intervals = [];
globalThis.setInterval = (...args) => { const handle = nativeInterval(...args); handle.unref(); intervals.push(handle); return handle; };
const $ = (selector) => {
  const el = document.querySelector(selector);
  assert.ok(el, `Element fehlt: ${selector}`);
  return el;
};
const click = async (selector) => { $(selector).click(); await delay(15); };
let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`OK ${name}`); };

try {
  await import("../js/app.js");
  await delay(40);
  check("Start in großer Lernansicht, Übung nicht im Tastaturfokus", () => {
    assert.ok($("#tour").classList.contains("open"));
    assert.equal($("#cs").inert, true);
    assert.equal($("#tour-grip").textContent, "Zur Übung →");
  });

  const body = $("#tour-body");
  const textNode = $("#tour-body .now");
  body.scrollTop = 231;
  $("details[data-persist=transfer]").open = true;
  await click("#tour-grip");
  // Gegenfall: ausgeblendeter Scrollcontainer verliert seine eigene Position.
  body.scrollTop = 0;
  await click("#tour-grip");
  check("Lesestelle und DOM-Knoten beim Wechsel Lesen/Üben erhalten", () => {
    assert.equal(body.scrollTop, 231);
    assert.equal($("#tour-body .now"), textNode);
    assert.equal($("details[data-persist=transfer]").open, true);
  });

  check("Lernkarte trennt Zweck, eigene Handlung und Beobachtung", () => {
    assert.match($(".lesson-purpose").textContent, /VERSTEHEN/);
    assert.match($(".now").textContent, /SELBST AUSPROBIEREN/);
    assert.match($(".expected").textContent, /DARAN ERKENNST DU ES/);
    assert.equal($("details[data-persist=tools]").open, false);
  });
  await click("[data-tour=read-size]");
  check("Große Schrift verändert weder Station noch vorhandenen Fortschritt", () => {
    assert.ok(document.documentElement.classList.contains("reader-large"));
    assert.equal($("[data-tour=read-size]").getAttribute("aria-pressed"), "true");
    assert.equal(window.localStorage.getItem("codesearch-pocket-reader-size"), "large");
    assert.equal($("#tour-body .now"), textNode);
    assert.equal(body.scrollTop, 231);
  });
  await click("#tour-actions [data-tour=next]");
  check("Gesperrtes Weiter erklärt den nächsten Schritt statt still nichts zu tun", () => {
    assert.equal($("#tour-body .now").textContent, textNode.textContent);
    assert.match($(".feedback").textContent, /Erst Prüfen/);
    assert.equal($(".feedback").dataset.scrollRequested, "true");
  });
  await click("#tour-actions [data-tour=check]");
  check("Fehlversuch hat einen verständlichen Rückweg und keine offenen Prüf-Interna", () => {
    assert.match($(".feedback").textContent, /Noch nicht erreicht/);
    assert.equal($("details[data-persist=checks]").open, false);
    assert.ok($(".feedback [data-tour=practice]"));
  });
  await click(".feedback [data-tour=show-hint]");
  await click(".feedback [data-tour=show-hint]");
  check("Ein angeforderter Hinweis wird direkt sichtbar gemacht", () => {
    assert.equal($(".lesson-hint").dataset.scrollRequested, "true");
  });

  const arrow = new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
  body.dispatchEvent(arrow);
  await delay(15);
  check("Pfeiltaste im Lesetext bleibt eine Browser-Aktion", () => assert.equal(arrow.defaultPrevented, false));

  await click("#tour-body [data-tour=workspace]");
  await click("#tour-actions [data-tour=check]");
  check("Prüfen öffnet Rückmeldung und benennt Modellstatus", () => {
    assert.ok($("#tour").classList.contains("open"));
    assert.match($("#tour-head").textContent, /Modell geprüft/);
    assert.equal($("#tour-body .feedback").dataset.scrollRequested, "true");
  });
  await click("#tour-actions [data-tour=next]");
  check("Neue Lektion beginnt oben in der großen Lernansicht", () => {
    assert.equal(body.scrollTop, 0);
    assert.ok($("#tour").classList.contains("open"));
    assert.notEqual($("#tour-body .now"), textNode);
  });

  await click("#tour-grip");
  await click("[data-act=json]");
  const textarea = $("#json-text");
  textarea.value = "ungültige Eingabe codesearch.request.v1";
  textarea.click();
  await delay(15);
  check("JSON-Entwurf überlebt Render nach Klick im Eingabefeld", () => {
    assert.equal($("#json-text"), textarea);
    assert.equal(textarea.value, "ungültige Eingabe codesearch.request.v1");
  });
  await click("[data-pop=json-apply]");
  await click("[data-act=json]");
  check("JSON-Dialog übernimmt tatsächlich die editierte Eingabe", () => assert.equal($("#json-text").value, textarea.value));
  await click("[data-pop=json-cancel]");

  await click("#btn-keys");
  await click('[data-key="Down"]');
  await click("#btn-keys");
  await click("[data-act=float-list]");
  const floatBody = $("#floats .fb");
  floatBody.scrollTop = 125;
  await click('[data-fsize]');
  check('Große Lesekopie sperrt die verdeckte Hauptansicht und erhält den Lesebereich', () => {
    assert.equal($('#app').inert, true);
    assert.equal($('#floats .fb'), floatBody);
    assert.equal($('#floats .float').getAttribute('aria-modal'), 'true');
    assert.ok(window.document.activeElement.closest('#floats'));
  });
  await click('[data-fcopy]');
  await delay(20);
  check('Fehlende Geräte-Kopie bleibt auch im großen Lesefenster sichtbar', () => {
    assert.ok($('#floats [data-fmanual]'));
  });
  await click('[data-fmanual]');
  check('Manueller Kopierweg öffnet über der großen Lesekopie', () => {
    assert.equal($('#json-text').readOnly, true);
    assert.ok($('#json-text').value.length > 0);
  });
  await click('[data-pop=json-cancel]');
  await click('[data-fsize]');
  check('Kleine Lesekopie gibt die Hauptansicht frei und behält die Scrollposition', () => {
    assert.equal($('#app').inert, false);
    assert.equal($('#floats .fb'), floatBody);
    assert.equal(floatBody.scrollTop,125);
  });
  await click("[data-act=quick]");
  $("#quick-input").value = "StateLab";
  $("#quick-input").dispatchEvent(new window.Event("input", { bubbles: true }));
  await delay(15);
  await click("#tour-grip");
  check("Lesen nimmt Such- und Lesefenster aus dem Fokus, ohne sie zu schließen", () => {
    assert.equal($("#quick").inert, true);
    assert.equal($("#floats").inert, true);
    assert.ok($("#quick").classList.contains("show"));
    assert.equal($("#floats .fb"), floatBody);
  });
  await click("#tour-grip");
  check("Zur Übung kehrt mit Suchtext und Lesefenster an die Arbeitsstelle zurück", () => {
    assert.equal($("#quick").inert, false);
    assert.equal($("#floats").inert, false);
    assert.equal($("#quick-input").value, "StateLab");
    assert.equal($("#floats .fb").scrollTop, 125);
  });
  await click("[data-q=esc]");
  await click("[data-fclose]");

  await click("#btn-atlas");
  await click("[data-atlas=laptop]");
  check("Laptop-Start und sämtliche Kapitel sind zugänglich", () => {
    assert.equal(document.querySelectorAll("[data-learn-chapter]").length, window.__POCKET_DATA__["course.json"].chapters.length);
    assert.match($("#layer-atlas").textContent, /610 Lektionen/);
  });
  const atlasBody = $("#layer-atlas .lbody");
  const stableSearchButton = $('[data-mode="search"]');
  const stableResult = $('#cs-list [data-row]');
  atlasBody.scrollTop = 340;
  await click("#layer-atlas .lbody p");
  check("Atlas-Scrollposition bei unveränderter Ansicht erhalten", () => {
    assert.equal($("#layer-atlas .lbody"), atlasBody);
    assert.equal(atlasBody.scrollTop, 340);
  });
  check('Unveränderte Tabs und Treffer bleiben bei Status-Render dieselben DOM-Knoten', () => {
    assert.equal($('[data-mode="search"]'), stableSearchButton);
    assert.equal($('#cs-list [data-row]'), stableResult);
  });
  const finalChapter = window.__POCKET_DATA__["course.json"].chapters.findIndex((ch) => /^Abschluss/.test(typeof ch === "string" ? ch : ch.title));   // Abschlusskarte per Titel, nicht per fester Nummer
  await click("[data-learn-chapter='" + finalChapter + "']");
  check("Abschlusskarte verrät keine Vorher/Aktion/Nachher-Lösung", () => {
    assert.equal(document.querySelector("#tour-body .transfer-grid"), null);
    assert.match($("#tour-body").textContent, /OHNE HILFEN/);
    assert.equal(document.querySelector("#tour-body .expected"), null);
    assert.equal(document.querySelector("#tour-body details[data-persist=meaning]"), null);
  });
  await click("#tour-body [data-tour=laptop]");
  await click("[data-learn-chapter='26']");
  await click("#tour-body [data-tour=labparams]");
  check("State-Lektion öffnet das passende StateLab-Parameterblatt", () => assert.ok(document.querySelector("[data-sl-pulse=Fire]")));
  await click("[data-act=td-close]");
  await click("#tour-body [data-tour=laptop]");
  await click("[data-learn-chapter='18']");
  await click("#tour-body [data-tour=labparams]");
  check("Farbmischer-Lektion öffnet Farbmischer statt BranchLab", () => assert.ok(document.querySelector("[data-fm-pulse=Weiter]")));
  await click('[data-act=td-close]');
  await click('#tour-body [data-tour=laptop]');
  await click('[data-learn-chapter="35"]');
  await click('#tour-body [data-tour=labparams]');
  check('SignalGarden öffnet eigenes Root-Blatt', () => assert.ok(document.querySelector('[data-garden-pulse=Submit]')));
  const gardenSheet = $('#layer-td .parsheet'); gardenSheet.scrollTop = 270;
  await click('[data-garden-pulse=Submit]');
  check('Parameter-Lesestelle bleibt nach Pulse erhalten', () => {
    assert.equal($('#layer-td .parsheet').scrollTop, 270);
    assert.match($('#layer-td').textContent, /Samples 1 · Requests 1/);
  });
  await click('[data-garden-owner=sensor]');
  const valueInput = $('[data-garden-num=Value]'); valueInput.focus(); valueInput.value = '0.7';
  valueInput.dispatchEvent(new window.Event('change', { bubbles: true })); await delay(15);
  await click('[data-garden-pulse=Sample]');
  check('Sensorblatt setzt Value und führt Sample über App-Handler aus', () => {
    assert.match($('#layer-td').textContent, /Samples 2/);
    assert.equal($('[data-garden-num=Value]').value, '0.7');
  });
  await click('[data-garden-reinit=sensor]');
  check('Lokale Re-Init erhält Setting und setzt Runtime zurück', () => {
    assert.match($('#layer-td').textContent, /Samples 0/);
    assert.equal($('[data-garden-num=Value]').value, '0.7');
  });
  await click('[data-act=td-close]');
  await click('#tour-body [data-tour=laptop]');
  await click('[data-learn-chapter="42"]');
  check('Selbständiger Workflow zeigt keine Lösung vor Hinweis', () => {
    assert.equal(document.querySelector('#tour-body .expected'), null);
    assert.equal(document.querySelector('#tour-body .phone'), null);
  });
  await click('#tour-body [data-tour=workspace]');
  const command = async (text) => {
    const field = $('#cs-input'); field.value = text;
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
    await click('#cs-enter');
  };
  await command('>karte SignalGarden/Sensor');
  check('Analyseziel, COMP und Extension haben getrennte lesbare Ziele', () => {
    assert.match($('#cs-target .target-owner').textContent, /Sensor/);
    assert.match($('#cs-target .extension-source').textContent, /SensorExt/);
    assert.match($('#cs-target .target-path').textContent, /SignalGarden\/Sensor/);
  });
  check('Kontextwahl sind zwei getrennte Buttons mit eindeutigem aktivem Zustand', () => {
    assert.equal(document.querySelectorAll('#cs-context .context-switch .context-button').length, 2);
    assert.equal($('[data-ctx=selection]').getAttribute('aria-pressed'), 'true');
    assert.equal($('[data-ctx=comp]').getAttribute('aria-pressed'), 'false');
    assert.match($('[data-ctx=selection]').textContent, /✓.*AUSWAHL/);
  });
  await click('[data-ctx=comp]');
  check('DIESE COMP wechselt über den App-Handler den aktiven Button', () => {
    assert.equal($('[data-ctx=comp]').getAttribute('aria-pressed'), 'true');
    assert.equal($('[data-ctx=selection]').getAttribute('aria-pressed'), 'false');
    assert.match($('[data-ctx=comp]').textContent, /✓.*DIESE COMP/);
  });
  await click('[data-ctx=selection]');
  check('AUSWAHL setzt den aktiven Kontext wieder zurück', () => {
    assert.equal($('[data-ctx=selection]').getAttribute('aria-pressed'), 'true');
    assert.equal($('[data-ctx=comp]').getAttribute('aria-pressed'), 'false');
  });
  await click('.extension-source');
  check('Extension-Menü benennt den Source-DAT und die beiden echten Optionen', () => {
    assert.match($('#popup .menu-description').textContent, /SignalGarden\/Sensor\/SensorExt/);
    assert.match($('#popup [data-menu="0"]').textContent, /DAT öffnen/);
    assert.match($('#popup [data-menu="1"]').textContent, /am Laptop/);
  });
  await click('#popup [data-menu="0"]');
  check('DAT öffnen zeigt über den echten App-Handler den vollständigen Source-Code', () => {
    assert.match($('#popup .t').textContent, /SensorExt/);
    assert.match($('#popup .code').textContent, /class SensorExt/);
  });
  await click('#popup [data-pop=esc]');
  await click('.extension-source');
  await click('#popup [data-menu="1"]');
  check('Externer Editor erklärt die Laptop-Preferences ohne einen iPhone-Start vorzutäuschen', () => {
    assert.match($('#popup .bb').textContent, /Preferences/);
    assert.match($('#popup .bb').textContent, /nicht starten/);
  });
  await click('#popup [data-pop=esc]');
  await click('[data-act=flowlens]');
  check('FlowLens-Klick öffnet die Analyse des ausgewählten Sensor-COMPs', () => {
    assert.ok($('#layer-flowlens').classList.contains('show'));
    assert.match($('#layer-flowlens .fl-status').textContent, /SignalGarden\/Sensor/);
    assert.match($('#layer-flowlens .fl-unconnected').textContent, /SensorExt/);
  });
  const flowMap = $('#layer-flowlens .fl-map'); flowMap.scrollTop = 130; flowMap.scrollLeft = 75;
  await click('#layer-flowlens .fl-status');
  check('FlowLens erhält die Ansicht bei unverändertem Render', () => {
    assert.equal($('#layer-flowlens .fl-map'), flowMap);
    assert.equal(flowMap.scrollTop, 130); assert.equal(flowMap.scrollLeft, 75);
  });
  await click('[data-fla=colors]');
  check('FlowLens-Farbknopf ändert die Markierung und erhält die Lesestelle', () => {
    assert.ok($('#layer-flowlens .fl-map').classList.contains('fl-colors'));
    assert.equal($('#layer-flowlens .fl-map').scrollTop, 130);
    assert.equal($('#layer-flowlens .fl-map').scrollLeft, 75);
  });
  await click('[data-fla=close]');
  await click('[data-act=look]');
  check('Look-Auswahl enthält alle 24 importierten Paletten mit Farbproben', () => {
    assert.equal(document.querySelectorAll('#popup [data-menu]').length, 24);
    assert.equal(document.querySelectorAll('#popup .look-swatches').length, 24);
    assert.deepEqual([...document.querySelectorAll('#popup .menu-group')].map((item) => item.textContent), ['Dunkel', 'Hell', 'Hoher Kontrast']);
  });
  [...document.querySelectorAll('#popup [data-menu]')].find((button) => button.textContent.includes('Mist')).click(); await delay(15);
  check('Mist wird vollständig angewendet und bleibt beim nächsten Render erhalten', () => {
    assert.equal(document.body.dataset.look, 'mist');
    assert.equal(document.body.style.colorScheme, 'light');
    assert.equal(document.body.style.getPropertyValue('--win'), 'rgb(247, 252, 255)');
  });
  $('[data-mode="map"]').dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true }));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Alt', altKey: true, bubbles: true, cancelable: true }));
  await delay(210);
  check('Maus über Tab plus Alt allein öffnet die Erklärung', () => assert.match($('#popup .t').textContent, /STRUCTURE/));
  const altD = new window.KeyboardEvent('keydown', { key: 'd', altKey: true, bubbles: true, cancelable: true });
  document.dispatchEvent(altD); await delay(20);
  check('Alt+D schließt Tab-Hilfe und führt trotzdem DETAILS aus', () => {
    assert.equal(altD.defaultPrevented, true);
    assert.equal($('#popup').classList.contains('show'), false);
    assert.ok($('[data-act=data-back]'));
  });
  document.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
  await click('[data-act=help]');
  check('Fragezeichen zeigt sämtliche nativen Keyboard Shortcuts mit Kontext', () => {
    assert.match($('#cs-list').textContent, /ALLE KEYBOARD SHORTCUTS/);
    assert.match($('#cs-list').textContent, /Ctrl\+S/);
    assert.match($('#cs-list').textContent, /F11/);
    assert.match($('#cs-list').textContent, /Alt\+D/);
  });
  await click('[data-act=analysis]');
  check('Analysebutton öffnet einen eigenen scrollbaren Bereich ohne Vollbildzwang', () => {
    assert.equal($('#cs-analysis').hidden, false);
    assert.ok($('#cs-body').classList.contains('analysis-open'));
    assert.equal(document.querySelectorAll('#analysis-goals button').length, 3);
    assert.match($('#analysis-packet').textContent, /SignalGarden/);
  });
  const analysisArea = $('#cs-analysis'), questionInput = $('#analysis-question');
  questionInput.value = 'Warum wechselt die Szene?';
  questionInput.dispatchEvent(new window.Event('input', {bubbles: true}));
  questionInput.focus(); analysisArea.scrollTop = 177;
  await click('[data-act=analysis-goal][data-goal=debug]');
  check('Zielwechsel erhält Frage, Eingabeknoten und Lesestelle', () => {
    assert.equal($('#analysis-question'), questionInput); assert.equal(questionInput.value, 'Warum wechselt die Szene?');
    assert.equal(analysisArea.scrollTop, 177);
    assert.equal($('[data-goal=debug]').getAttribute('aria-pressed'), 'true');
  });
  await click('[data-act=analysis-export]');
  await click('[data-act=json]');
  const brief = JSON.parse($('#json-text').value);
  check('Analyseauftrag enthält gebundene echte Belege und vollständigen JSON-Vertrag', () => {
    assert.equal(brief.schema, 'codesearch.analysis.v1'); assert.equal(brief.goal, 'debug');
    assert.equal(brief.question, 'Warum wechselt die Szene?');
    assert.equal(brief.request.evidence_id, brief.evidence_id);
    assert.ok(brief.protocol.preview.required.includes('changes'));
  });
  await click('[data-pop=json-cancel]');
  await click('[data-act=analysis-template][data-template=antwort]');
  const explanation = JSON.parse($('#json-text').value);
  check('Antwort-Vorlage öffnet einen Editor ohne vorweggenommenen Import', () => {
    assert.equal(explanation.schema, 'codesearch.explanation.v2');
    assert.equal(explanation.evidence_id, brief.evidence_id);
    assert.equal(document.querySelectorAll('.analysis-verdict').length, 0);
  });
  explanation.claims[0].commentary = 'Die Methode schreibt niemals; freie Behauptung.';
  $('#json-text').value = JSON.stringify(explanation);
  await click('[data-pop=json-apply]');
  check('Import trennt kanonische Prüfaussage vom ungeprüften Kommentar', () => {
    assert.match($('.checked-statement').textContent, /Prüfaussage/);
    assert.match($('.analysis-commentary').textContent, /ungeprüft/);
    assert.match($('.analysis-commentary').textContent, /niemals/);
    assert.equal($('.analysis-commentary').classList.contains('supported'), false);
    assert.match($('#analysis-results').textContent, /gespeicherter Ausschnitt\n/);
    assert.ok(!$('#analysis-results').textContent.includes('\\u00b7'));
    assert.equal($('#popup').classList.contains('show'), false);
  });
  await click('[data-act=analysis-result-copy]');
  await click('[data-act=json]');
  check('Ergebnis-Kopieren enthält tatsächlich geprüfte Claims und Bindung', () => {
    const result = JSON.parse($('#json-text').value);
    assert.equal(result.binding, 'bound'); assert.equal(result.claims[0].commentary_checked, false);
    assert.ok(result.claims[0].checked_statement);
  });
  await click('[data-pop=json-cancel]');
  await click('[data-act=analysis-import]');
  $('#json-text').value = '{ broken JSON';
  await click('[data-pop=json-apply]');
  check('Fehlerhafter Import bleibt mit Entwurf und konkreter Fehlermeldung korrigierbar', () => {
    assert.equal($('#json-text').value, '{ broken JSON');
    assert.ok($('#popup [role=alert]').textContent.length > 8);
  });
  $('#json-text').value = JSON.stringify(brief.request);
  await click('[data-pop=json-apply]');
  check('Korrigierter Request liefert nachvollziehbare Belege und schließt den Editor', () => {
    assert.equal($('#popup').classList.contains('show'), false);
    assert.match($('#analysis-results').textContent, /Antwort liegt in der Pocket-Zwischenablage/);
  });
  check('Fehlende Geräte-API wird auch bei automatisch erzeugter Request-Antwort ehrlich angezeigt', () => {
    assert.equal($('#clipboard-notice').dataset.copyStatus, 'failed');
    assert.match($('#clipboard-notice').textContent, /nicht verfügbar/);
    assert.ok($('[data-act=clipboard-manual]'));
    assert.doesNotMatch($('#cs-status .l').textContent, /In die Geräte-Zwischenablage kopiert/);
  });
  await click('[data-act=clipboard-manual]');
  const responseText = $('#json-text').value;
  check('Manueller Fallback zeigt exakt die Request-Antwort statt des früheren Auftrags', () => {
    const response = JSON.parse(responseText);
    assert.equal(response.schema, 'codesearch.response.v2'); assert.equal(response.evidence_id, brief.evidence_id);
    assert.equal($('#json-text').readOnly, true);
    assert.match($('#json-title').textContent, /MANUELL KOPIEREN/);
  });
  await click('[data-pop=clipboard-select]');
  check('Text markieren erhält den vollständigen Text und wählt ihn zum manuellen Kopieren aus', () => {
    assert.equal($('#json-text').value, responseText);
    assert.equal($('#json-text').selectionStart, 0);
    assert.equal($('#json-text').selectionEnd, responseText.length);
  });
  let deviceText = '';
  Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async (text) => {deviceText = text;}}});
  await click('[data-pop=json-apply]');
  check('Erfolgreicher Retry bestätigt erst nach Geräte-Write und importiert nichts', () => {
    assert.equal(deviceText, responseText); assert.equal($('#clipboard-notice').dataset.copyStatus, 'success');
    assert.match($('#clipboard-notice').textContent, /In die Geräte-Zwischenablage kopiert/);
    assert.match($('#json-title').textContent, /MANUELL KOPIEREN/);
    assert.match($('#analysis-results').textContent, /coverage/);
  });
  await click('[data-pop=json-cancel]');
  Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: () => Promise.reject(new window.DOMException('blocked', 'NotAllowedError'))}});
  await click('[data-act=analysis-export]');
  check('Abgewiesener Geräte-Write behauptet keinen Erfolg und öffnet keinen Dialog über fremdem Entwurf', () => {
    assert.equal($('#clipboard-notice').dataset.copyStatus, 'failed'); assert.match($('#toast').textContent, /fehlgeschlagen oder blockiert/);
    assert.doesNotMatch($('#cs-status .l').textContent, /Auftrag kopiert|In die Geräte-Zwischenablage kopiert/);
    assert.equal($('#popup').classList.contains('show'), false);
  });
  Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: () => {throw new Error('synchronous write failure');}}});
  await click('[data-act=analysis-export]');
  check('Synchroner Clipboard-Fehler bleibt abgefangen und der manuelle Weg erreichbar', () => {
    assert.equal($('#clipboard-notice').dataset.copyStatus, 'failed'); assert.ok($('[data-act=clipboard-manual]'));
  });
  let rejectOld;
  Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: () => new Promise((resolve, reject) => {rejectOld = reject;})}});
  await click('[data-act=analysis-export]');
  check('Ausstehender Geräte-Write wird nicht vorzeitig als kopiert ausgegeben', () => {
    assert.equal($('#clipboard-notice').dataset.copyStatus, 'pending');
    assert.match($('#cs-status .l').textContent, /wird geprüft/);
    assert.doesNotMatch($('#toast').textContent, /kopiert/);
  });
  Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async (text) => {deviceText = text;}}});
  await click('[data-act=analysis-result-copy]');
  const newestText = deviceText;
  rejectOld(new window.DOMException('late blocked', 'NotAllowedError')); await delay(20);
  check('Späte Ablehnung einer alten Kopie verändert weder neuen Erfolg noch neuesten Text', () => {
    assert.equal($('#clipboard-notice').dataset.copyStatus, 'success'); assert.equal(deviceText, newestText);
    assert.equal(JSON.parse(deviceText).schema, 'codesearch.response.v2');
    assert.doesNotMatch($('#toast').textContent, /fehlgeschlagen/);
  });
  // Beide Ansichten verwenden echte App-Handler und denselben TABLE-State.
  await click('#cs [data-mode="table"]');
  const originalValue=$('#cs-list [data-cell="1,1"]').textContent;
  await click('#cs [data-act="float-menu"]');
  const menuButton=[...document.querySelectorAll('[data-menu]')].find(el=>el.textContent.includes('Diese Ansicht · Fenster daneben'));
  assert.ok(menuButton);menuButton.click();await delay(25);
  const mirror=document.querySelector('#floats .cs-secondary');assert.ok(mirror);
  const mirrorCell=()=>mirror.querySelector('[data-cell="1,1"]');
  window.prompt=()=> '0.123';mirrorCell().click();mirrorCell().click();await delay(30);
  check('TABLE-Edit in Zweitansicht verändert denselben Wert in der Hauptansicht',()=>{
    assert.equal($('#cs-list [data-cell="1,1"]').textContent,'0.123');assert.equal(mirrorCell().textContent,'0.123');
  });
  mirror.querySelector('[data-act="td-undo"]').click();await delay(25);
  check('Undo in Zweitansicht aktualisiert beide Tabellen',()=>{assert.equal($('#cs-list [data-cell="1,1"]').textContent,originalValue);assert.equal(mirrorCell().textContent,originalValue);});
  await click('#cs [data-act="win-close"]');mirror.querySelector('[data-act="td-redo"]').click();await delay(25);
  check('Redo bleibt bei geschlossenem Hauptfenster bedienbar',()=>{assert.ok($('#cs').classList.contains('closed'));assert.equal(mirrorCell().textContent,'0.123');});
  mirror.querySelector('[data-act="spec"]').click();await delay(25);
  mirror.querySelector('[data-spec-act="new"]').click();await delay(25);
  const edit=mirror.querySelector('[data-spec-field="goal"]');edit.focus();edit.value='Gemeinsames Ziel';edit.dispatchEvent(new window.Event('input',{bubbles:true}));await delay(25);
  check('Spec-Entwurf wird über den Originalhandler zwischen Ansichten geteilt',()=>{
    assert.equal($('#cs [data-spec-field="goal"]').value,'Gemeinsames Ziel');assert.equal(mirror.querySelector('[data-spec-field="goal"]'),edit);
    const ids=[...document.querySelectorAll('[id]')].map(el=>el.id);assert.equal(new Set(ids).size,ids.length);
  });
  mirror.querySelector('[data-spec-act="add"]').click();await delay(25);
  const observation=mirror.querySelector('[data-role="spec-observation"]');observation.value='Selbst beobachtet';observation.dispatchEvent(new window.Event('input',{bubbles:true}));await delay(25);
  check('Noch nicht gespeicherte Beobachtungsfelder bleiben in beiden Spec-Ansichten erhalten',()=>assert.equal($('#spec-observation').value,'Selbst beobachtet'));
  await click('[data-fsize]');mirror.querySelector('[data-act="quick"]').click();await delay(25);
  check('Schnellsuche über großem Livefenster bleibt bedienbar und hat echten Eingabefokus',()=>{
    assert.equal($('#quick').inert,false);assert.ok(document.activeElement.matches('[data-qinput]'));assert.equal(document.activeElement.dataset.scrollRequested,'true');
  });
  const searchInput=()=>document.querySelector('#quick .active [data-qinput]');
  searchInput().value='Sample';searchInput().dispatchEvent(new window.Event('input',{bubbles:true}));await delay(25);
  await click('#quick .active [data-q="new"]');searchInput().value='Fire';searchInput().dispatchEvent(new window.Event('input',{bubbles:true}));await delay(25);
  await click('#quick .active [data-q="new"]');searchInput().value='gain';searchInput().dispatchEvent(new window.Event('input',{bubbles:true}));await delay(25);
  check('Drei unabhängige Suchkarten behalten Texte; vierte Zusatzsuche ist gesperrt',()=>{
    assert.deepEqual([...document.querySelectorAll('[data-qinput]')].map(el=>el.value),['Sample','Fire','gain']);
    assert.equal(document.querySelectorAll('[data-qid]').length,3);assert.ok([...document.querySelectorAll('[data-q="new"]')].every(el=>el.disabled));
    assert.equal(document.activeElement,searchInput());
  });
  while(document.querySelector('#quick [data-q="esc"]'))await click('#quick [data-q="esc"]');
  check('Nach letzter Suche kehrt Fokus in das weiterhin große Livefenster zurück',()=>{assert.equal($('#app').inert,true);assert.ok(document.activeElement.closest('[data-float]'));});
  await click('[data-fsize]');mirror.querySelector('[data-mode="chain"]').click();await delay(25);
  mirror.querySelector('[data-act="flow-pin"]').click();await delay(25);
  check('FLOW-Fixierung ist in beiden Ansichten sichtbar',()=>{assert.equal($('#cs [data-act="flow-pin"]').getAttribute('aria-pressed'),'true');assert.equal(mirror.querySelector('[data-act="flow-pin"]').getAttribute('aria-pressed'),'true');});
  mirror.querySelector('[data-act="flow-pane"]').click();await delay(25);
  check('FLOW öffnet zwei getrennte Network-Panes mit eigener Navigation',()=>{assert.equal(document.querySelectorAll('[data-network-pane]').length,2);assert.ok($('[data-network-pane="secondary"] [data-act="net-secondary-close"]'));});
  await click('[data-act="net-secondary-close"]');await click('[data-act="td-close"]');
  mirror.querySelector('[data-mode="map"]').click();await delay(25);
  const methods=[...mirror.querySelectorAll('.hit.method')];assert.ok(methods.length>=2);
  methods[0].dispatchEvent(new window.MouseEvent('click',{bubbles:true}));await delay(25);
  mirror.querySelector(`[data-row="${methods[1].dataset.row}"]`).dispatchEvent(new window.MouseEvent('click',{bubbles:true,ctrlKey:true}));await delay(25);
  check('Strg-Linksklick über den echten Handler markiert zwei Methoden',()=>assert.equal(mirror.querySelectorAll('.hit.method[aria-pressed="true"]').length,2));
  mirror.querySelector(`[data-row="${methods[0].dataset.row}"]`).dispatchEvent(new window.MouseEvent('click',{bubbles:true,ctrlKey:true}));await delay(25);
  check('Erneuter Strg-Linksklick entfernt genau die angeklickte Methode',()=>assert.equal(mirror.querySelectorAll('.hit.method[aria-pressed="true"]').length,1));
  await click('[data-flayout]');await click('[data-flayout]');
  const excerptLines=mirror.querySelectorAll('.code-viewport .ln').length;
  mirror.querySelector('[data-act="code-full"]').click();await delay(25);
  check('Vollcode hat einen eigenen Scrollbereich und enthält mindestens den Methodenausschnitt',()=>{assert.ok(mirror.querySelectorAll('.code-viewport .ln').length>=excerptLines);assert.equal(mirror.querySelector('[data-act="code-full"]').getAttribute('aria-pressed'),'true');});
  const slider=mirror.querySelector('[data-code-zoom]'),windowZoom=mirror.style.zoom;slider.value='150';slider.dispatchEvent(new window.Event('input',{bubbles:true}));await delay(25);
  check('Code-Schriftregler erhält seinen DOM-Knoten und verändert nicht den Fensterzoom',()=>{assert.equal(mirror.querySelector('[data-code-zoom]'),slider);assert.equal(mirror.style.getPropertyValue('--code-zoom'),'1.5');assert.equal(mirror.style.zoom,windowZoom);});
  slider.focus();slider.dispatchEvent(new window.Event('change',{bubbles:true}));await delay(25);
  check('Bestätigter Reglerwert erhält den Tastaturfokus',()=>{assert.equal(mirror.querySelector('[data-code-zoom]'),slider);assert.equal(document.activeElement,slider);assert.equal(slider.value,'150');});
  const codeViewport=mirror.querySelector('.code-viewport'),selectedBefore=mirror.querySelector('.hit.method[aria-pressed="true"]').dataset.row;
  codeViewport.focus();codeViewport.scrollTop=180;
  const codeArrow=new window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true});codeViewport.dispatchEvent(codeArrow);await delay(25);
  check('Pfeiltaste im Code bleibt Scrollaktion und verändert nicht die Methodenauswahl',()=>{assert.equal(codeArrow.defaultPrevented,false);assert.equal(mirror.querySelector('.hit.method[aria-pressed="true"]').dataset.row,selectedBefore);assert.equal(mirror.querySelector('.code-viewport').scrollTop,180);});
  const resize=mirror.querySelector('[data-code-resize]');resize.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));
  check('Code-Trennkante ist zusätzlich per Tastatur bedienbar',()=>{assert.equal(resize.getAttribute('aria-valuenow'),'330');assert.equal(mirror.style.getPropertyValue('--code-height'),'330px');});
  await click('[data-fclose]');
  await command('>karte SignalGarden/Sensor');
  const openCompMenu=async()=>{
    const button=$('#cs [data-ctx="comp"]');button.dispatchEvent(new window.MouseEvent('pointerdown',{bubbles:true,button:2}));
    button.dispatchEvent(new window.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));await delay(25);
  };
  const menuSelect=async(text)=>{const button=[...document.querySelectorAll('#popup [data-menu]')].find(el=>el.textContent.includes(text));assert.ok(button,`Menüeintrag fehlt: ${text}`);button.click();await delay(25);};
  await openCompMenu();
  check('Rechtsklick auf DIESE COMP öffnet echte Aktionen am geöffneten Sensor',()=>{assert.match($('#popup .t').textContent,/DIESE COMP.*Sensor/);assert.match($('#popup').textContent,/Parameter nach oben.*Parameter ansehen.*zweiten Netzwerk/s);});
  await menuSelect('Parameter nach oben');
  check('Promotion-Vorschau erklärt Konflikt und Auslassung vor der Übernahme',()=>{assert.match($('#popup .t').textContent,/Vorschau/);assert.match($('#popup').textContent,/KONFLIKT.*Status/s);assert.match($('#popup').textContent,/AUSGELASSEN.*Present/s);});
  await click('[data-pop="esc"]');
  const compButton=$('#cs [data-ctx="comp"]');compButton.dispatchEvent(new window.MouseEvent('pointerdown',{bubbles:true,button:0,clientX:30,clientY:30}));await delay(510);compButton.dispatchEvent(new window.MouseEvent('pointerup',{bubbles:true,button:0}));
  check('Langes Drücken öffnet dasselbe COMP-Menü über den Pointer-Handler',()=>assert.match($('#popup .t').textContent,/DIESE COMP.*Sensor/));
  await menuSelect('Parameter nach oben');await click('[data-pop="enter"]');
  check('Übernehmen meldet sechs verbundene Controls',()=>assert.match($('#cs-status').textContent,/6 Parameter.*Undo verfügbar/));
  await openCompMenu();await menuSelect('Parameter ansehen');await click('[data-garden-owner="root"]');
  check('Parent enthält neue bedienbare Value- und Sample-Controls',()=>{assert.ok($('[data-garden-num="Value"][data-owner="root"]'));assert.ok($('[data-garden-pulse="Sample"][data-owner="root"]'));});
  const promotedInput=$('[data-garden-num="Value"][data-owner="root"]');promotedInput.value='0.83';promotedInput.dispatchEvent(new window.Event('change',{bubbles:true}));await delay(25);
  await click('[data-garden-owner="sensor"]');
  check('Änderung am Parent erscheint am ursprünglichen Sensor',()=>assert.equal($('[data-garden-num="Value"][data-owner="sensor"]').value,'0.83'));
  await click('[data-act="td-close"]');
  const historyKey=async(key)=>{document.dispatchEvent(new window.KeyboardEvent('keydown',{key,ctrlKey:true,bubbles:true,cancelable:true}));await delay(25);};
  await historyKey('z');await historyKey('z');
  await openCompMenu();await menuSelect('Parameter ansehen');await click('[data-garden-owner="root"]');
  check('Zweimal Undo nimmt zuerst den Wert und danach die Promotion zurück',()=>assert.equal(document.querySelector('[data-garden-num="Value"][data-owner="root"]'),null));
  await click('[data-act="td-close"]');await historyKey('y');
  await openCompMenu();await menuSelect('Parameter ansehen');await click('[data-garden-owner="root"]');
  check('Redo stellt die verbundenen Parent-Controls wieder her',()=>assert.ok($('[data-garden-num="Value"][data-owner="root"]')));
  assert.deepEqual(runtimeErrors, [], 'Keine unbehandelten App-Fehler');
  console.log(JSON.stringify({ passed, engine: "jsdom", layout: "nicht geprüft", nativeTouch: "nicht geprüft" }));
} finally {
  for (const handle of intervals) clearInterval(handle);
  window.close();
}
