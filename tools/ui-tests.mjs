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
window.localStorage.setItem("codesearch-pocket-intro", "1");
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
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
  await click("#tour-grip");
  check("Lesestelle und DOM-Knoten beim Wechsel Lesen/Üben erhalten", () => {
    assert.equal(body.scrollTop, 231);
    assert.equal($("#tour-body .now"), textNode);
    assert.equal($("details[data-persist=transfer]").open, true);
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

  await click("#btn-atlas");
  await click("[data-atlas=laptop]");
  check("Laptop-Start und sämtliche Kapitel sind zugänglich", () => {
    assert.equal(document.querySelectorAll("[data-learn-chapter]").length, window.__POCKET_DATA__["course.json"].chapters.length);
    assert.match($("#layer-atlas").textContent, /462 Lektionen/);
  });
  const atlasBody = $("#layer-atlas .lbody");
  atlasBody.scrollTop = 340;
  await click("#layer-atlas .lbody p");
  check("Atlas-Scrollposition bei unveränderter Ansicht erhalten", () => {
    assert.equal($("#layer-atlas .lbody"), atlasBody);
    assert.equal(atlasBody.scrollTop, 340);
  });
  await click("[data-learn-chapter='35']");
  check("Abschlusskarte verrät keine Vorher/Aktion/Nachher-Lösung", () => {
    assert.equal(document.querySelector("#tour-body .transfer-grid"), null);
    assert.match($("#tour-body").textContent, /OHNE HILFEN/);
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
  console.log(JSON.stringify({ passed, engine: "jsdom", layout: "nicht geprüft", nativeTouch: "nicht geprüft" }));
} finally {
  for (const handle of intervals) clearInterval(handle);
  window.close();
}
