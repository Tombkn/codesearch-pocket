// 1.10.1: Halte-Menue der Suchfenster, Verlauf Zurueck/Vor, LETZTE FOCUS, Modul-STRUCTURE.
// Modelltests mit oeffentlichen Aktionen; keine native TD- oder iPhone-Abnahme.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApp} from '../js/core/boot.js';
import {buildStructure} from '../js/core/views/codeviews.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));
const setup = () => createApp({course: load('course'), net: load('net'), code: load('code'), ui: load('ui')});

test('Suchfenster: langes Druecken bietet Springen, Viewer, Editor, Parameter und Pfad kopieren', () => {
  const {cs} = setup();
  cs.cs.Scope = 'project';
  const q = cs.quickOpen();
  cs.quickSearch('Sensor');
  const opRow = q.hits.findIndex((h) => h.kind === 'opfind' && /SignalGarden\/Sensor$/.test(h.path));
  assert.ok(opRow >= 0, 'Op-Zeile Sensor fehlt');
  const labels = cs.quickRowMenuItems(q.id, opRow).map((item) => item.label);
  for (const wanted of ['IM HAUPTFENSTER ÖFFNEN', 'HINSPRINGEN (Doppelklick)', 'VIEWER ÖFFNEN', 'PARAMETER ZEIGEN', 'PFAD KOPIEREN']) {
    assert.ok(labels.includes(wanted), `${wanted} fehlt: ${labels}`);
  }
  cs.quickSearch('def Sample');
  const codeRow = q.hits.findIndex((h) => h.kind === 'code' && h.line);
  assert.ok(codeRow >= 0, 'Codezeile fehlt');
  const codeLabels = cs.quickRowMenuItems(q.id, codeRow).map((item) => item.label);
  assert.ok(codeLabels.includes('IM DAT / EDITOR ÖFFNEN'), codeLabels.join(' | '));
  const editor = cs.quickRowMenuItems(q.id, codeRow).find((item) => item.label === 'IM DAT / EDITOR ÖFFNEN');
  editor.run();
  assert.equal(cs.state.viewer.line, q.hits[codeRow].line);
});

test('PFAD KOPIEREN legt den vollen Pfad in die Zwischenablage', () => {
  const {cs} = setup();
  cs.cs.Scope = 'project';
  const q = cs.quickOpen();
  cs.quickSearch('Sensor');
  const row = q.hits.findIndex((h) => h.kind === 'opfind' && /SignalGarden\/Sensor$/.test(h.path));
  cs.quickRowMenuItems(q.id, row).find((item) => item.label === 'PFAD KOPIEREN').run();
  assert.match(cs.clipboard, /\/project1\/CodeSearch_Tutorial\/SignalGarden\/Sensor$/);
});

test('Zurueck / Vor fuehren durch den Verlauf und stehen danach am richtigen Ende', () => {
  const {cs} = setup();
  cs.OpenAt('trace', {target: 'SignalGarden/Sensor'});
  cs.OpenAt('trace', {target: 'BranchLab'});
  assert.equal(cs.state.focus, 'BranchLab');
  cs.historyBack();
  assert.equal(cs.state.focus, 'SignalGarden/Sensor');
  assert.ok(cs.state.future.length > 0, 'Vor muss moeglich sein');
  cs.historyForward();
  assert.equal(cs.state.focus, 'BranchLab');
  assert.equal(cs.state.future.length, 0);
});

test('LETZTE FOCUS erscheint bei leerer Suche, neueste zuerst', () => {
  const {cs} = setup();
  cs.OpenAt('trace', {target: 'SignalGarden/Sensor'});
  cs.OpenAt('trace', {target: 'BranchLab'});
  cs.OpenAt('search', {query: ''});
  const titles = cs.state.hits.map((h) => h.text);
  assert.ok(titles.includes('LETZTE FOCUS'), titles.slice(0, 5).join(' | '));
  const focus = cs.state.hits.filter((h) => h.art === 'FOCUS').map((h) => h.path);
  assert.match(focus[0], /BranchLab$/);
  assert.ok(focus.some((path) => /SignalGarden\/Sensor$/.test(path)));
});

test('Maus-Daumentasten: 3 = zurueck, 4 = vor, alle anderen Tasten 0 (1.10.2)', async () => {
  const {sideButtonStep} = await import('../js/ui/wheel.js');
  assert.equal(sideButtonStep({button: 3}), -1);
  assert.equal(sideButtonStep({button: 4}), 1);
  for (const button of [0, 1, 2, undefined]) assert.equal(sideButtonStep({button}), 0);
});

test('Modul-DAT werkzeug zeigt AUSSEN und den Aufrufer aus text1', () => {
  const {cs} = setup();
  const view = buildStructure(cs, 'Farbmischer/werkzeug');
  const fn = view.rows.find((h) => h.kind === 'method' && h.ctx === 'FarbeErzwingen');
  assert.ok(fn, 'FarbeErzwingen fehlt');
  assert.match(fn.text, /◄ AUSSEN [1-9]/);
  assert.ok(view.rows.some((h) => h.art === 'AUFRUFER' && /text1/.test(h.path)), 'Aufrufer text1 fehlt');
});

test('1.10.2: Glas-Looks sind echtes Glas im CSS - Blur, Spiegelung, Lichtkante, runde Ecken, Rueckfall ohne Transparenz', async () => {
  const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
  for (const needle of ['body[data-glass] .float', 'backdrop-filter: var(--glass-blur)', '--glass-edge', '--glass-sheen', 'border-radius: 16px',
    '@media (prefers-reduced-transparency: reduce)', 'body[data-glass="smoke"]', 'body[data-glass="black"]', 'body[data-glass="navy"]', 'body[data-glass="frost"]']) {
    assert.ok(css.includes(needle), `${needle} fehlt im Glas-CSS`);
  }
  assert.ok(!/Acht Graphite-Varianten: ruhige Fl/.test(css), 'alter Glas-Block (nur Kopfzeilen-Schimmer) ist ersetzt');
  const {applyLook, GLASS_LOOKS} = await import('../js/ui/looks.js');
  assert.deepEqual(GLASS_LOOKS, {smoked_glass: 'smoke', glass_black: 'black', glass_navy: 'navy', frosted_glass: 'frost'});
  const body = {dataset: {}, style: {setProperty() {}}};
  applyLook(body, {CODESEARCH_LOOKS: {}}, 'glass_navy');
  assert.equal(body.dataset.glass, 'navy');
  applyLook(body, {CODESEARCH_LOOKS: {}}, 'carbon');
  assert.equal(body.dataset.glass, undefined, 'ohne Glas-Look kein data-glass');
});

test('1.10.2: Carbon LED / Glow faerben die vorhandenen Rollen kraeftiger - DAT orange statt pink, lesbar auf Carbon', async () => {
  const {lookVariables, contrast} = await import('../js/ui/looks.js');
  const carbon = ['Carbon LED', [0.012, 0.014, 0.018], [0.034, 0.038, 0.046], [0.070, 0.078, 0.092], [0.24, 0.27, 0.32], [0.96, 0.97, 0.99], [0.70, 0.74, 0.80], [0.86, 0.90, 0.97], false];
  const plain = lookVariables(carbon);
  const led = lookVariables(carbon, 'carbon_led');
  assert.notEqual(led['--magenta'], plain['--magenta'], 'DAT-Rolle wechselt die Farbe');
  const [r, g, b] = led['--dat-fg'].match(/\d+/g).map(Number);
  assert.ok(r > b + 100, `DAT ist orange, nicht pink: ${led['--dat-fg']}`);
  for (const role of ['--purple', '--green', '--blue', '--cyan', '--magenta', '--yellow']) {
    const rgb = led[role].match(/\d+/g).map((v) => Number(v) / 255);
    assert.ok(contrast(rgb, carbon[2]) >= 7, `${role} lesbar auf Carbon: ${led[role]}`);
  }
  assert.deepEqual(lookVariables(carbon, 'classic'), plain, 'andere Looks unveraendert');
});
