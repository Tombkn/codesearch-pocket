// Pointer-Ereignisse im DOM: prüft Auslösung/Abbruch, keine echte Wischphysik.
import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { JSDOM } from "jsdom";
import { tapper } from "../js/ui/dom.js";

function fixture() {
  const page = new JSDOM('<div id="root"><button data-key="a">A</button><button data-key="b">B</button></div>');
  const w = page.window, root = w.document.querySelector('#root'), log = [];
  tapper(root, 'button', { tap: (el) => log.push('tap:' + el.dataset.key), double: (el) => log.push('double:' + el.dataset.key), long: (el) => log.push('long:' + el.dataset.key), longMs: 15 });
  root.addEventListener('click', () => log.push('outer'));
  const button = (key = 'a') => root.querySelector(`[data-key="${key}"]`);
  const pointer = (type, key = 'a', extra = {}) => {
    const ev = new w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: 20, clientY: 20, button: 0, ...extra });
    Object.defineProperties(ev, { pointerId: { value: extra.pointerId ?? 1 }, isPrimary: { value: extra.isPrimary ?? true } });
    button(key).dispatchEvent(ev); return ev;
  };
  const click = (key = 'a', detail = 1) => button(key).dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, detail }));
  const tap = (key = 'a') => { pointer('pointerdown', key); pointer('pointerup', key); click(key); };
  return { page, w, root, log, pointer, click, tap, button };
}

test('Tap und Double-Tap unterscheiden gleiche und verschiedene Zeilen', () => {
  const f = fixture(); f.tap(); f.tap(); f.tap('b');
  assert.deepEqual(f.log.filter((x) => x !== 'outer'), ['tap:a', 'double:a', 'tap:b']); f.page.window.close();
});
test('Vertikaler und horizontaler Swipe lösen weder Tap noch Hold noch äußeren Button aus', async () => {
  for (const coordinates of [{ clientY: 80 }, { clientX: 80 }]) {
    const f = fixture(); f.pointer('pointerdown'); f.pointer('pointermove', 'a', coordinates);
    await delay(25); f.pointer('pointerup'); f.click(); assert.deepEqual(f.log, []);
    f.tap(); assert.deepEqual(f.log, ['tap:a', 'outer']); f.page.window.close();
  }
});
test('Browser-Abbruch und zweiter Finger brechen Hold ab', async () => {
  for (const cancel of [(f) => f.pointer('pointercancel'), (f) => f.pointer('pointerdown', 'a', { pointerId: 2, isPrimary: false })]) {
    const f = fixture(); f.pointer('pointerdown'); cancel(f); await delay(25); f.pointer('pointerup'); f.click();
    assert.deepEqual(f.log, []); f.page.window.close();
  }
});
test('Hold plus natives Kontextmenü und nachlaufender Click erzeugen nur eine Aktion', async () => {
  const f = fixture(); f.pointer('pointerdown'); await delay(25);
  f.button().dispatchEvent(new f.w.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  f.pointer('pointerup'); f.click(); assert.deepEqual(f.log, ['long:a']); f.page.window.close();
});
test('Tatsächliches Scroll-Event beendet einen ausstehenden Hold', async () => {
  const f = fixture(); f.pointer('pointerdown'); f.root.dispatchEvent(new f.w.Event('scroll'));
  await delay(25); f.pointer('pointerup'); f.click(); assert.deepEqual(f.log, []); f.page.window.close();
});
test('Kleine Fingerbewegung erlaubt einen normalen Tap', () => {
  const f = fixture(); f.pointer('pointerdown'); f.pointer('pointermove', 'a', { clientX: 24, clientY: 25 });
  f.pointer('pointerup'); f.click(); assert.deepEqual(f.log, ['tap:a', 'outer']); f.page.window.close();
});
test('Tastatur-Aktivierung bleibt nach einem abgebrochenen Pointer möglich', () => {
  const f = fixture(); f.pointer('pointerdown'); f.pointer('pointercancel'); f.click('a', 0);
  assert.deepEqual(f.log, ['tap:a', 'outer']); f.page.window.close();
});
test('Entfernte Zeile löst keinen alten Hold aus, gleiche neu gerenderte Zeile erlaubt Double-Tap', async () => {
  const f = fixture(); f.pointer('pointerdown'); f.button().remove(); await delay(25); assert.deepEqual(f.log, []);
  f.tap('b'); f.button('b').outerHTML = '<button data-key="b">B neu</button>'; f.tap('b');
  assert.deepEqual(f.log.filter((x) => x !== 'outer'), ['tap:b', 'double:b']); f.page.window.close();
});
