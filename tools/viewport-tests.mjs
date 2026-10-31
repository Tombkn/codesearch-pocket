// Simulierte Viewport-Ereignisse: prüft unsere Reaktion, nicht Safari-Geometrie.
import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { JSDOM } from "jsdom";
import { bindViewport } from "../js/ui/viewport.js";

test("Viewport folgt Tastatur und Drehung, ohne Pinch-Zoom zu bekämpfen", async (t) => {
  const page = new JSDOM("<input><textarea></textarea>", { pretendToBeVisual: true });
  const win = page.window;
  const root = win.document.documentElement;
  const viewport = new win.EventTarget();
  Object.assign(viewport, { height: 740, offsetTop: 0, scale: 1 });
  Object.defineProperty(win, "visualViewport", { value: viewport });
  const unbind = bindViewport(win);
  const resize = async (changes) => {
    Object.assign(viewport, changes);
    viewport.dispatchEvent(new win.Event("resize"));
    await delay(30);
  };
  try {
    await t.test("Ausgangshöhe ist der sichtbare Bereich", () => {
      assert.equal(root.style.getPropertyValue("--viewport-height"), "740px");
      assert.equal(root.classList.contains("compact-viewport"), false);
    });
    await t.test("Tastatur verkleinert die Fläche; Texteingabe bleibt erhalten", async () => {
      const field = win.document.querySelector("textarea");
      field.value = "Ein eigener Entwurf";
      field.focus();
      await resize({ height: 330, offsetTop: 38 });
      assert.equal(root.style.getPropertyValue("--viewport-height"), "330px");
      assert.equal(root.style.getPropertyValue("--viewport-top"), "38px");
      assert.equal(root.classList.contains("keyboard-open"), true);
      assert.equal(root.classList.contains("compact-viewport"), true);
      assert.equal(field.value, "Ein eigener Entwurf");
      assert.equal(win.document.activeElement, field);
    });
    await t.test("Pinch-Zoom verändert keine Layoutgröße oder Skalierung", async () => {
      await resize({ height: 160, offsetTop: 120, scale: 2 });
      assert.equal(root.style.getPropertyValue("--viewport-height"), "330px");
      assert.equal(root.style.getPropertyValue("--viewport-top"), "38px");
      assert.equal(root.style.transform, "");
    });
    await t.test("Tastatur schließen während Pinch-Zoom gibt die Bedienleiste frei", async () => {
      win.document.activeElement.blur();
      await resize({ height: 370, offsetTop: 0, scale: 2 });
      assert.equal(root.classList.contains("keyboard-open"), false);
      assert.equal(root.style.getPropertyValue("--viewport-height"), "330px");
    });
    await t.test("Tastatur schließen gibt die volle Höhe zurück", async () => {
      win.document.activeElement.blur();
      await resize({ height: 740, offsetTop: 0, scale: 1 });
      assert.equal(root.style.getPropertyValue("--viewport-height"), "740px");
      assert.equal(root.classList.contains("keyboard-open"), false);
    });
    await t.test("Querformat wird kompakt, ohne eine Tastatur zu erfinden", async () => {
      await resize({ height: 390 });
      assert.equal(root.classList.contains("compact-viewport"), true);
      assert.equal(root.classList.contains("keyboard-open"), false);
    });
    await t.test("Ungültige Werte zerstören die letzte brauchbare Größe nicht", async () => {
      await resize({ height: -1 });
      assert.equal(root.style.getPropertyValue("--viewport-height"), "390px");
    });
    await t.test("Cleanup entfernt die Ereignisreaktion", async () => {
      unbind();
      await resize({ height: 720 });
      assert.equal(root.style.getPropertyValue("--viewport-height"), "390px");
    });
  } finally {
    unbind();
    win.close();
  }
});

test("Ohne VisualViewport bleibt die normale Fenstergröße verwendbar", () => {
  const page = new JSDOM("<p>Fallback</p>", { pretendToBeVisual: true });
  const unbind = bindViewport(page.window);
  assert.equal(page.window.document.documentElement.style.getPropertyValue("--viewport-height"), `${page.window.innerHeight}px`);
  unbind();
  page.window.close();
});
