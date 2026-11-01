// Gezielte Modell-/DOM-Gegenfälle. Kein Layout- oder echter iPhone-Test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import { JSDOM } from "jsdom";
import { createApp } from "../js/core/boot.js";
import { Net } from "../js/core/net.js";
import { buildGuide } from "../js/core/views/miscviews.js";
import { lookVariables, contrast, applyLook } from "../js/ui/looks.js";
import { bindTabHelp } from "../js/ui/tabhelp.js";
import { phoneSteps } from "../js/core/phone.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), "utf8"));
const ui = { ...load('ui'), ...(process.env.POCKET_UI_FIXTURE ? JSON.parse(readFileSync(process.env.POCKET_UI_FIXTURE, 'utf8')) : {}) };
const app = () => createApp({ course: load('course'), net: load('net'), code: load('code'), ui });

function extensionNet() {
  const comp = { path: 'Garden', family: 'COMP', ext: [
    { name: 'DifferentName', object: `op('./source_one').module.FirstExt(me)` },
    { name: 'SecondExt', object: `op("./source_two").mod.SecondExt(me)` },
    { name: 'Missing', object: `op('./missing').module.Missing(me)` },
    { name: 'Dynamic', object: `op(parent().par.Source.eval()).module.Dynamic(me)` },
    { name: '', object: `mod('./source_one').FirstExt(me)`, slot: 6 },
  ] };
  const ops = [comp, { path: 'Garden/source_one', parent: 'Garden', family: 'DAT', text: 'class FirstExt: pass' },
    { path: 'Garden/source_two', parent: 'Garden', family: 'DAT', text: 'class SecondExt: pass' },
    { path: 'Garden/Dynamic', parent: 'Garden', family: 'DAT', text: 'must not be guessed' }];
  return new Net({ root: { family: 'COMP' }, ops }, {});
}
test('Mehrere Extension-Slots bleiben korrekt mit ihrem Source-DAT verbunden', () => {
  const net = extensionNet();
  const refs = net.extensionSources('Garden');
  assert.deepEqual(refs.map((item) => [item.name, item.path, item.available]), [
    ['DifferentName', 'Garden/source_one', true], ['SecondExt', 'Garden/source_two', true],
    ['Missing', 'Garden/missing', false], ['Dynamic', null, false], ['FirstExt', 'Garden/source_one', true],
  ]);
  assert.equal(refs[4].slot, 6);
  assert.equal(net.extDat.get('Garden'), 'Garden/source_one');
});
test('Source-Menü bleibt nach Fokuswechsel auf den ursprünglich gewählten DAT gerichtet', () => {
  const { cs, gestures: g } = app();
  g.extensionMenu('SignalGarden/Sensor', 0);
  const item = cs.state.menu.items[0];
  cs.state.focus = 'StateLab'; cs.state.menu = null; item.run();
  assert.equal(cs.state.viewer.path, 'SignalGarden/Sensor/SensorExt');
  assert.equal(cs.state.focus, 'StateLab');
});
test('Veränderte Quelle öffnet über ein altes Menü keinen anderen DAT', () => {
  const { cs, gestures: g } = app();
  g.extensionMenu('SignalGarden/Sensor', 0);
  const item = cs.state.menu.items[0];
  cs.net.op('SignalGarden/Sensor').ext[0].object = `op('../../StateLab/StateLabExt').module.StateLabExt(me)`;
  cs.state.menu = null; item.run();
  assert.equal(cs.state.viewer, null);
  assert.match(cs.state.dialog.title, /geändert/);
});
test('Fehlende Quelle und Laptop-Editor haben verständliche, ehrliche Rückmeldungen', () => {
  const { cs, gestures: g } = app();
  g.extensionMenu('SignalGarden/Sensor', 0);
  cs.state.menu.items[1].run();
  assert.match(cs.state.dialog.lines.join(' '), /Preferences/);
  assert.match(cs.state.dialog.lines.join(' '), /nicht starten/);
  assert.equal(cs.state.viewer, null);
  cs.net.ops.delete('SignalGarden/Sensor/SensorExt');
  cs.state.menu = null; g.extensionMenu('SignalGarden/Sensor', 0);
  assert.equal(cs.state.menu, null);
  assert.match(cs.state.dialog.title, /nicht verfügbar/);
});
test('FlowLens öffnet das gewählte COMP und respektiert DIESE COMP sowie laufende Aufnahme', () => {
  const { cs, gestures: g } = app();
  cs.state.focus = 'SignalGarden/Sensor'; cs.state.paneOwner = 'SignalGarden';
  g.openFlowLens(); assert.ok(cs.state.flowlens.target.endsWith('/SignalGarden/Sensor'));
  cs.state.context = 'comp'; g.openFlowLens(); assert.ok(cs.state.flowlens.target.endsWith('/SignalGarden'));
  cs.state.flowlens.open = false; cs.state.record.recording = true; g.openFlowLens();
  assert.equal(cs.state.flowlens.open, false); assert.match(cs.state.status, /STOP/);
});
test('Alle 24 nativen Looks werden angeboten: acht Graphite-Varianten neben den bisherigen sechzehn', () => {
  const palettes = ui.CODESEARCH_LOOKS;
  assert.ok(palettes, 'Native Konstanten importieren oder POCKET_UI_FIXTURE setzen');
  assert.equal(Object.keys(palettes).length, 24);
  for (const key of ['classic', 'graphite', 'midnight', 'paper', 'sand', 'contrast', 'aurora', 'ember', 'lagoon', 'plum', 'slate', 'copper', 'porcelain', 'mist', 'ink', 'beacon', 'graphite_soft', 'graphite_blue', 'carbon', 'titanium', 'smoked_glass', 'frosted_glass', 'iridium', 'graphite_mint']) assert.ok(palettes[key]);
  const { cs, gestures: g } = app(); g.lookMenu();
  assert.equal(cs.state.menu.items.length, 24);
  assert.deepEqual([...new Set(cs.state.menu.items.map((item) => item.group))], ['Dunkel', 'Hell', 'Hoher Kontrast']);
  cs.state.menu.items.find((item) => item.label.includes('Mist')).run(); assert.equal(cs.cs.Look, 'mist');
  const page = new JSDOM('<body></body>'); applyLook(page.window.document.body, ui, 'mist');
  assert.equal(page.window.document.body.style.colorScheme, 'light');
  assert.equal(page.window.document.body.style.getPropertyValue('--win'), 'rgb(247, 252, 255)'); page.window.close();
});
test('Text und semantische Farben sind auf vier Hauptflächen rechnerisch lesbar', () => {
  assert.ok(ui.CODESEARCH_LOOKS && typeof ui.CODESEARCH_LOOKS === 'object', 'CODESEARCH_LOOKS fehlt: kein Kontrastnachweis ohne native Paletten');
  assert.equal(Object.keys(ui.CODESEARCH_LOOKS).length, 24, 'Kontrastprüfung braucht alle 24 nativen Looks');
  const decode = (css) => css.match(/[\d.]+/g).map((value) => Number(value) / 255);
  for (const [key, palette] of Object.entries(ui.CODESEARCH_LOOKS)) {
    const tokens = lookVariables(palette);
    for (const fg of ['text', 'muted', 'dim', 'dat-fg', 'green', 'purple', 'cyan', 'red', 'amber', 'string']) {
      for (const bg of ['bg', 'panel', 'panel2', 'sel']) {
        assert.ok(contrast(decode(tokens[`--${fg}`]), decode(tokens[`--${bg}`])) >= 4.5, `${key}: ${fg} auf ${bg}`);
      }
    }
    assert.equal(new Set(['dat-fg', 'green', 'purple'].map((role) => tokens[`--${role}`])).size, 3, `${key}: DAT/CHOP/TOP getrennt`);
    assert.ok(contrast(decode(tokens['--dat-fg']), decode(tokens['--dat-bg'])) >= 4.5, `${key}: Extension-Chip`);
    assert.equal(tokens['--code'], tokens['--bg'], 'Code-Hintergrund bleibt Fläche, keine Schriftfarbe');
  }
});
test('?-Übersicht zeigt jede importierte Shortcut-Gruppe unverändert samt Kontext', () => {
  assert.ok(ui.SHORTCUT_GUIDE?.length >= 27);
  const rows = buildGuide(app().cs).rows.filter((row) => row.shortcut);
  assert.deepEqual(rows.map((row) => row.shortcut), ui.SHORTCUT_GUIDE);
  assert.ok(rows.some((row) => row.text.includes('Alt+D')));
  assert.ok(rows.some((row) => row.text.includes('Shift+K')));
});
test('Kontext-Buttons haben in allen 24 Looks lesbare aktive und inaktive Farben', () => {
  assert.equal(Object.keys(ui.CODESEARCH_LOOKS || {}).length, 24, 'Alle nativen Looks sind für die Prüfung nötig');
  const decode = (css) => css.match(/[\d.]+/g).map((value) => Number(value) / 255);
  for (const [key, palette] of Object.entries(ui.CODESEARCH_LOOKS)) {
    const colors = lookVariables(palette);
    for (const [fg, bg] of [['on-accent', 'accent'], ['text', 'win'], ['text', 'sel']]) {
      assert.ok(contrast(decode(colors[`--${fg}`]), decode(colors[`--${bg}`])) >= 4.5, `${key}: Kontext-Button ${fg}/${bg}`);
    }
    assert.ok(contrast(decode(colors['--muted']), decode(colors['--panel2'])) >= 3, `${key}: sichtbarer inaktiver Rahmen`);
  }
});
test('Handy-Anleitung verwendet langen Druck für Tab-Hilfe und direkte Look-Auswahl', () => {
  const hints = phoneSteps({ id: 'help', action: 'Maus über FLOW, dann Alt allein drücken.' });
  assert.ok(hints.some((hint) => hint.includes('lange gedrückt')));
  assert.ok(!hints.some((hint) => hint.includes('ART-Zelle') || hint.includes('ALT in der Tastenleiste')));
  assert.ok(phoneSteps({ id: 'look', action: 'LOOK öffnen, einen anderen Look wählen.' }).some((hint) => hint.includes('Hoher Kontrast')));
});
test('Alt allein erklärt nur einen bereits mit der Maus überfahrenen Tab', async () => {
  const page = new JSDOM('<div id="tabs"><button data-mode="map">STRUCTURE</button></div><div id="list"></div>');
  const { window } = page, doc = window.document;
  const root = doc.querySelector('#tabs'), tab = root.querySelector('button');
  let help = null;
  bindTabHelp(root, { show: (mode) => { help = mode; }, hide: () => { help = null; }, delay: 5 });
  const key = (type, name, options = {}) => doc.dispatchEvent(new window.KeyboardEvent(type, { key: name, bubbles: true, ...options }));
  key('keydown', 'Alt', { altKey: true }); await wait(10); assert.equal(help, null);
  key('keyup', 'Alt');
  tab.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true }));
  key('keydown', 'Alt', { altKey: true }); await wait(10); assert.equal(help, 'map');
  key('keyup', 'Alt'); assert.equal(help, null); page.window.close();
});
test('Alt-Kombination stoppt sichtbare und verzögerte Hilfe bis Alt losgelassen wird', async () => {
  const page = new JSDOM('<div id="tabs"><button data-mode="map">STRUCTURE</button></div>');
  const { window } = page, doc = window.document, root = doc.querySelector('#tabs');
  let help = null;
  bindTabHelp(root, { show: (mode) => { help = mode; }, hide: () => { help = null; }, delay: 8 });
  const key = (type, name, options = {}) => doc.dispatchEvent(new window.KeyboardEvent(type, { key: name, bubbles: true, ...options }));
  root.querySelector('button').dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true }));
  key('keydown', 'Alt', { altKey: true }); key('keydown', 'd', { altKey: true }); await wait(15); assert.equal(help, null);
  key('keyup', 'd', { altKey: true }); await wait(15); assert.equal(help, null);
  key('keyup', 'Alt'); key('keydown', 'Alt', { altKey: true }); await wait(15); assert.equal(help, 'map');
  key('keydown', 'p', { altKey: true }); assert.equal(help, null);
  key('keyup', 'Alt'); page.window.close();
});
test('Touch-Hover, Scroll und Fensterwechsel lassen keine Alt-Hilfe hängen', async () => {
  const page = new JSDOM('<div id="tabs"><button data-mode="map">STRUCTURE</button></div>');
  const { window } = page, doc = window.document, root = doc.querySelector('#tabs'), tab = root.querySelector('button');
  let help = null;
  bindTabHelp(root, { show: (mode) => { help = mode; }, hide: () => { help = null; }, delay: 5 });
  const hover = new window.Event('pointerover', { bubbles: true }); Object.defineProperty(hover, 'pointerType', { value: 'touch' }); tab.dispatchEvent(hover);
  const alt = () => doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Alt', altKey: true, bubbles: true }));
  alt(); await wait(10); assert.equal(help, null);
  doc.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Alt' }));
  tab.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true })); alt(); root.dispatchEvent(new window.Event('scroll'));
  await wait(10); assert.equal(help, null); window.dispatchEvent(new window.Event('blur')); page.window.close();
});
