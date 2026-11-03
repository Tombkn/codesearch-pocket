// 1.10.3: Kopfzeile wie native (AUSWAHL / DIESE COMP in SUCHEN IN, Praefix-Schilder vor den Tabs, kurze Brotkrume),
// Zonen-Zoom (Strg + Rad je Zone), Kurs-Keys cs.zone_results / cs.zone_detail / cs.detail_focus, prep zoom_reset / zone_zoom,
// Looks aus ui.json. Modelltests plus jsdom-Render ohne Layout; keine native TD- oder iPhone-Abnahme.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {createApp} from '../js/core/boot.js';
import {ZONE_LABELS} from '../js/core/cs.js';
import {wheelZone, ctrlWheelZoom} from '../js/ui/wheel.js';
import {vividRoles, glassVariant, applyLook, GLASS_LOOKS} from '../js/ui/looks.js';
import {hostTemplate} from '../js/ui/cs-host.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));
const data = {course: load('course'), net: load('net'), code: load('code'), ui: load('ui')};
const setup = () => createApp(data);

// Kopf rendern wie die App, aber in einem nackten jsdom-Fenster mit dem Host-Template der Zweitfenster.
async function renderHead(app) {
  const page = new JSDOM(`<!doctype html><body><section class="cs" id="cs">${hostTemplate()}</section></body>`);
  globalThis.window = page.window;
  globalThis.document = page.window.document;
  const {renderScopes, renderTabs, renderContext, renderCrumb} = await import('../js/ui/cswin.js');
  const ctx = {cs: app.cs, ui: data.ui, g: app.gestures, host: null};
  const render = () => { renderScopes(ctx); renderTabs(ctx); renderContext(ctx); renderCrumb(ctx); };
  render();
  const $ = (sel) => page.window.document.querySelector(sel);
  const $$ = (sel) => [...page.window.document.querySelectorAll(sel)];
  return {page, render, $, $$};
}

test('Kopf: AUSWAHL / DIESE COMP, Zieltext, FLOWLENS, LLM, SPEC und ZWEITANSICHT stehen in der SUCHEN-IN-Zeile', async () => {
  const app = setup();
  const {cs, gestures: g} = app;
  cs.OpenAt('search', {query: 'Sensor'});
  const head = await renderHead(app);
  assert.equal(head.$$('#cs-scopes .context-switch .context-button').length, 2);
  assert.equal(head.$$('#cs-context .context-switch').length, 0, 'alte Kontextzeile traegt den Umschalter nicht mehr');
  assert.equal(head.$$('#cs-scopes [data-scope]').length, 4);
  assert.equal(head.$('#cs-scopes .lbl').textContent, 'SUCHEN IN');
  for (const act of ['flowlens', 'analysis', 'spec', 'float-menu']) assert.ok(head.$(`#cs-scopes [data-act="${act}"]`), `${act} fehlt in #cs-scopes`);
  assert.match(head.$('#cs-scopes .ctxinfo').textContent, /AUSWAHL/);
  assert.equal(head.$('#cs-scopes').style.display, '');

  // DIESE COMP: Scope-Chips bleiben sichtbar, aber gedimmt und nicht klickbar; Label BEREICH wie native
  g.context('comp');
  head.render();
  assert.equal(head.$('#cs-scopes .lbl').textContent, 'BEREICH');
  for (const chip of head.$$('#cs-scopes [data-scope]')) {
    assert.ok(chip.classList.contains('dim'), 'Scope-Chip gedimmt');
    assert.equal(chip.disabled, true, 'Scope-Chip nicht klickbar');
  }
  assert.equal(head.$('#cs-scopes [data-ctx="comp"]').getAttribute('aria-pressed'), 'true');
  assert.match(head.$('#cs-scopes .ctxinfo').textContent, /DIESE COMP/);
  g.context('selection');
  head.render();
  assert.equal(head.$$('#cs-scopes [data-scope][disabled]').length, 0);

  // Code-Tab (STRUCTURE): kein Bereich, aber der Kontext-Umschalter bleibt - frueher verschwand die Zeile hier ganz
  cs.OpenAt('map', {target: 'SignalGarden/Sensor'});
  head.render();
  assert.equal(head.$('#cs-scopes').style.display, '');
  assert.equal(head.$$('#cs-scopes [data-scope]').length, 0);
  assert.equal(head.$$('#cs-scopes .context-switch .context-button').length, 2);
  assert.ok(head.$('#cs-context [data-overview="ext"]'), 'PROJEKT-Chips bleiben in der Kontextzeile der Code-Tabs');

  // TABLE: weder Bereich noch Kontext, die drei Werkzeug-Knoepfe bleiben erreichbar
  cs.SetMode('table');
  head.render();
  assert.equal(head.$$('#cs-scopes [data-scope]').length, 0);
  assert.equal(head.$$('#cs-scopes .context-switch').length, 0);
  assert.equal(head.$$('#cs-scopes [data-act]').length, 3);
});

test('Kopf: Gruppentitel stehen klein VOR den Tabs, nicht klickbar, langer Titel als Tooltip', async () => {
  const app = setup();
  const head = await renderHead(app);
  const groups = head.$$('#cs-tabs .tabgrp');
  assert.equal(groups.length, 3);
  for (const [index, grp] of ['both', 'net', 'code'].entries()) {
    const first = groups[index].firstElementChild;
    assert.ok(first.classList.contains('gt'), 'Praefix-Schild ist das erste Element der Gruppe');
    assert.equal(first.tagName, 'SPAN');
    assert.equal(first.textContent, data.ui.GROUP_LABELS[grp]);
    assert.equal(first.getAttribute('title'), data.ui.GROUP_TITLES[grp]);
    assert.ok(groups[index].querySelector('.tabs .tab'), 'Tabs folgen dem Schild');
  }
});

test('Kopf: Brotkrume ist kurz - ein FOCUS, Art, Symbol und Zeile; braucht: nur ohne markierte Zeile, sieht: nie', async () => {
  const app = setup();
  const {cs, gestures: g} = app;
  cs.cs.Scope = 'project';
  cs.OpenAt('search', {query: 'def Sample'});
  const head = await renderHead(app);
  let crumb = head.$('#cs-crumb').textContent;
  assert.equal((crumb.match(/FOCUS/g) || []).length, 1, crumb);
  assert.ok(!crumb.includes('sieht:'), crumb);
  assert.ok(crumb.includes('braucht:'), crumb);
  assert.ok(!crumb.includes('Zeile '), crumb);
  // Zeile markieren: Symbol und Zeile erscheinen, die Handlungsanweisung verschwindet
  const row = cs.state.hits.findIndex((h) => h.kind === 'code' && h.line);
  assert.ok(row >= 0, 'Code-Treffer mit Zeile fehlt');
  while (cs.state.selected !== row) { const before = cs.state.selected; g.key('Down'); if (cs.state.selected === before) break; }
  assert.equal(cs.state.selected, row);
  head.render();
  crumb = head.$('#cs-crumb').textContent;
  assert.ok(crumb.includes(`Zeile ${cs.state.hits[row].line}`), crumb);
  assert.ok(!crumb.includes('braucht:'), crumb);
  assert.equal((crumb.match(/FOCUS/g) || []).length, 1, crumb);
  // Gepinntes Analyseziel traegt 📌
  cs.cs.Analysistarget = '/project1/CodeSearch_Tutorial/SignalGarden/Sensor';
  cs.OpenAt('map', {target: 'SignalGarden/Sensor'});
  head.render();
  assert.match(head.$('#cs-crumb').textContent, /FOCUS 📌 Sensor/);
});

test('Zonen-Zoom-Modell: ZoomZone im 10-%-Raster 0.5-2.5, ZoomUi(0) setzt Gesamt-, Zonen- und CODE-Zoom zurueck', () => {
  const {cs} = setup();
  assert.deepEqual(cs.state.zoneZoom, {results: 1, detail: 1});
  assert.deepEqual(ZONE_LABELS, {results: 'LISTE', detail: 'DETAILS', code: 'CODE'});
  cs.ZoomZone('results', 1);
  assert.equal(cs.state.zoneZoom.results, 1.1);
  cs.ZoomZone('results', 1);
  assert.equal(cs.state.zoneZoom.results, 1.2);
  assert.equal(cs.state.status, 'SCHRIFT 100 % · LISTE 120 %');
  for (let i = 0; i < 20; i += 1) cs.ZoomZone('results', 1);
  assert.equal(cs.state.zoneZoom.results, 2.5);
  assert.match(cs.state.status, /LISTE 250 % \(Grenze\)/);
  cs.ZoomZone('detail', -1);
  assert.equal(cs.state.zoneZoom.detail, 0.9);
  for (let i = 0; i < 20; i += 1) cs.ZoomZone('detail', -1);
  assert.equal(cs.state.zoneZoom.detail, 0.5);
  cs.ZoomZone('code', 1);
  cs.ZoomZone('results', 1.5);
  cs.ZoomZone('nirgends', 1);
  assert.deepEqual(cs.state.zoneZoom, {results: 2.5, detail: 0.5}, 'Code, halbe Schritte und unbekannte Zonen werden ignoriert');
  cs.ZoomZone('results', 0);
  assert.equal(cs.state.zoneZoom.results, 1);
  cs.setCodeZoom(1.5);
  cs.ZoomUi(1);
  assert.equal(cs.state.zoom, 1.1);
  assert.equal(cs.state.status, 'SCHRIFT 110 % · DETAILS 50 %');
  cs.ZoomUi(0);
  assert.deepEqual([cs.state.zoom, cs.state.zoneZoom, cs.state.codeZoom], [1, {results: 1, detail: 1}, 1]);
  assert.equal(cs.state.status, 'SCHRIFT 100 %');
  cs.ZoomUi(2);
  assert.equal(cs.state.zoom, 1, 'unbekannter Schritt wird ignoriert');
});

test('Alt+0 ueber die Gesten setzt wie native alles auf 100 %', () => {
  const {cs, gestures: g} = setup();
  g.key('Ctrl+Plus');
  cs.ZoomZone('detail', 2);
  cs.setCodeZoom(2);
  assert.deepEqual([cs.state.zoom, cs.state.zoneZoom.detail, cs.state.codeZoom], [1.1, 1.2, 2]);
  g.key('Alt+0');
  assert.deepEqual([cs.state.zoom, cs.state.zoneZoom, cs.state.codeZoom], [1, {results: 1, detail: 1}, 1]);
});

test('Strg + Rad: Zone unter dem Zeiger - Code, Details, Liste, Leisten; Zweitfenster behalten ihren Zoom', () => {
  const page = new JSDOM(`<!doctype html><body><section class="cs" id="cs"><div class="cs-title" id="title"></div>
    <div class="cs-list"><div id="row"></div></div>
    <aside class="cs-detail"><div class="code-viewport"><pre id="code"></pre></div><div id="det"></div></aside></section>
    <div data-float="f1"><div class="cs-list"><div id="frow"></div></div></div></body>`);
  const el = (id) => page.window.document.getElementById(id);
  assert.equal(wheelZone(el('row')), 'results');
  assert.equal(wheelZone(el('det')), 'detail');
  assert.equal(wheelZone(el('code')), 'code');
  assert.equal(wheelZone(el('title')), 'ui');
  const calls = [];
  const zoom = (...args) => calls.push(args);
  const ev = (target, ctrlKey = true, deltaY = -100) => ({ctrlKey, deltaY, deltaX: 0, target, preventDefault() { this.prevented = true; }});
  assert.equal(ctrlWheelZoom(ev(el('row')), zoom), true);
  assert.equal(ctrlWheelZoom(ev(el('det'), true, 100), zoom), true);
  assert.equal(ctrlWheelZoom(ev(el('code')), zoom), true);
  assert.equal(ctrlWheelZoom(ev(el('title')), zoom), true);
  assert.equal(ctrlWheelZoom(ev(el('frow')), zoom), true);
  assert.equal(ctrlWheelZoom(ev(el('row'), false), zoom), false, 'ohne Strg bleibt das Rad beim Browser');
  assert.deepEqual(calls, [[null, 1, 'results'], [null, -1, 'detail'], [null, 1, 'code'], [null, 1, 'ui'], ['f1', 1, null]]);
});

test('Kurs-Keys cs.zone_results, cs.zone_detail und cs.detail_focus stehen immer im Snapshot', () => {
  const {cs, tour, gestures: g} = setup();
  let state = tour.snapshot();
  assert.equal(state['cs.zone_results'], 1);
  assert.equal(state['cs.zone_detail'], 1);
  assert.equal(state['cs.detail_focus'], false);
  cs.ZoomZone('results', 2);
  cs.ZoomZone('detail', -2);
  // Shift+F6 ohne Detailzeilen: nichts zu fokussieren (wie native 'DETAIL ist leer')
  g.key('Shift+F6');
  assert.equal(cs.state.detailFocus, false);
  assert.equal(cs.state.status, 'DETAIL ist leer');
  cs.OpenAt('map', {target: 'StateLab'});
  g.tapRow((h) => h.kind === 'method' && h.ctx === 'Fire');
  g.key('Shift+F6');
  state = tour.snapshot();
  assert.deepEqual([state['cs.zone_results'], state['cs.zone_detail'], state['cs.detail_focus']], [1.2, 0.8, true]);
  assert.match(cs.state.status, /^DETAIL · ↑↓/);
  // Pfeile wandern in der rechten Spalte, die Liste bleibt stehen; Shift+F6, Antippen der Liste und Esc holen den Fokus zurueck
  const selected = cs.state.selected;
  g.key('Down'); g.key('Down');
  assert.equal(cs.state.detailCursor, 2);
  assert.equal(cs.state.selected, selected);
  assert.equal(cs.state.detailFocus, true);
  g.key('Up'); g.key('Up'); g.key('Up');
  assert.equal(cs.state.detailCursor, 0, 'Cursor bleibt in den Detailzeilen');
  g.key('Shift+F6');
  assert.equal(tour.snapshot()['cs.detail_focus'], false);
  g.key('Shift+F6');
  g.tapRow((h) => h.kind === 'method' && h.ctx === 'Fire');
  assert.equal(cs.state.detailFocus, false, 'Antippen der Liste holt den Fokus zurueck');
  g.key('Shift+F6');
  cs.escape();
  assert.equal(cs.state.detailFocus, false, 'Esc holt den Fokus zurueck');
});

// ---------------------------------------------------------------- Strang P2: Modellaktionen fuer workspace_38 … 52
test('Strg + Rad als Geste: Zone entscheidet - Liste / Details = Zonen-Zoom, Code = CODE-Regler, Leisten = Gesamtzoom', () => {
  const {cs, gestures: g} = setup();
  g.ctrlWheel('results', 1); g.ctrlWheel('results', 1);
  g.ctrlWheel('detail', -1);
  g.ctrlWheel('code', 1); g.ctrlWheel('code', 1);
  g.ctrlWheel('ui', 1);
  assert.deepEqual([cs.state.zoneZoom, cs.state.codeZoom, cs.state.zoom], [{results: 1.2, detail: 0.9}, 1.2, 1.1]);
  g.key('Alt+0');
  assert.deepEqual([cs.state.zoneZoom, cs.state.codeZoom, cs.state.zoom], [{results: 1, detail: 1}, 1, 1]);
  cs.floatList();
  const f = cs.state.floats.at(-1);
  g.ctrlWheel('results', 1, f.id);
  assert.equal(cs.state.zoneZoom.results, 1, 'Zweitfenster unter dem Zeiger: Zonen des Hauptfensters bleiben');
  assert.ok(f.zoom > f.zoomStart);
});

test('GRUPPEN / DETAILS einklappen: Modell-Flags, Statuszeile, Kurs-Keys und Speicher (cs_split_layout)', () => {
  const memory = new Map();
  const storage = {getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value)};
  const app = createApp(data, storage);
  const {cs, tour, gestures: g} = app;
  assert.deepEqual([tour.snapshot()['workspace.left_hidden'], tour.snapshot()['workspace.right_hidden']], [false, false]);
  g.column('left');
  assert.equal(cs.state.splitLayout.leftHidden, true);
  assert.match(cs.state.status, /^GRUPPEN eingeklappt/);
  g.column('right');
  assert.equal(cs.state.splitLayout.rightHidden, true);
  assert.match(cs.state.status, /^DETAILS \+ CODE eingeklappt/);
  assert.deepEqual([tour.snapshot()['workspace.left_hidden'], tour.snapshot()['workspace.right_hidden']], [true, true]);
  // Schliessen und wieder oeffnen aendert nichts; ein neuer Start liest den Speicher
  g.key('Esc'); g.key('Shift+K');
  assert.deepEqual(cs.state.splitLayout, {leftHidden: true, rightHidden: true});
  assert.deepEqual(createApp(data, storage).cs.state.splitLayout, {leftHidden: true, rightHidden: true});
  g.column('left');
  assert.match(cs.state.status, /^GRUPPEN ausgeklappt/);
  assert.deepEqual(createApp(data, storage).cs.state.splitLayout, {leftHidden: false, rightHidden: true});
  cs.ToggleColumn('oben');
  assert.deepEqual(cs.state.splitLayout, {leftHidden: false, rightHidden: true}, 'unbekannte Seite wird ignoriert');
});

test('LETZTE FOCUS in der leeren Suche: Enter macht den Op wieder zum FOCUS, ohne das Fenster zu schliessen', () => {
  const {cs, gestures: g} = setup();
  cs.OpenAt('trace', {target: 'SignalGarden/Sensor'});
  cs.OpenAt('search', {target: 'BranchLab', query: ''});
  g.type(''); g.filter('all');
  const row = (h) => h.kind === 'opfind' && h.detail === 'FOCUS' && /\/Sensor$/.test(h.path);
  assert.ok(cs.state.hits.some(row), 'Sensor steht unter LETZTE FOCUS');
  g.tapRow(row); g.key('Enter');
  assert.equal(cs.state.focus, 'SignalGarden/Sensor');
  assert.equal(cs.state.mode, 'search');
  assert.equal(cs.state.mainopen, true);
  assert.match(cs.state.status, /FOCUS wieder/);
});

test('Schnellsuche-Zeilenmenue: → IN USED BY wechselt das Hauptfenster, die Schnellsuche bleibt offen', () => {
  const {cs, gestures: g} = setup();
  cs.OpenAt('search', {target: 'BranchLab', query: ''});
  g.key('Ctrl+P'); g.cs.quickScope('comp:BranchLab'); g.quickType('control');
  const q = cs.state.searchWindows.find((item) => item.open && item.id === cs.state.quick.id);
  g.quickRowMenu(q.id, (h) => h.kind !== 'section' && /BranchLab\/control$/.test(h.path || ''));
  const labels = cs.state.menu.items.map((item) => item.label);
  assert.deepEqual(labels.filter((label) => label.startsWith('→ IN')), ['→ IN USES', '→ IN USED BY', '→ IN FLOW']);
  assert.ok(labels.includes('IM HAUPTFENSTER ÖFFNEN'));
  g.menu('→ IN USED BY');
  assert.equal(cs.state.mode, 'refs');
  assert.equal(cs.state.focus, 'BranchLab/control');
  assert.equal(q.open, true, 'Schnellsuche bleibt offen');
  assert.equal(cs.state.quick.open, true);
});

test('Ziel aendern…: Enter uebernimmt den Pfad, Esc behaelt das Ziel; der Knopf steht in der Zielzeile', async () => {
  const app = setup();
  const {cs, gestures: g} = app;
  cs.OpenAt('map', {target: 'BranchLab'});
  g.targetEdit();
  assert.equal(cs.state.targetEdit, true);
  g.enter('StateLab');
  assert.deepEqual([cs.state.focus, cs.state.mode, cs.state.targetEdit], ['StateLab', 'map', false]);
  g.targetEdit(); g.key('Esc');
  assert.deepEqual([cs.state.focus, cs.state.targetEdit, cs.state.mainopen], ['StateLab', false, true]);
  assert.match(cs.state.status, /^Ziel bleibt/);
  const page = new JSDOM(`<!doctype html><body><section class="cs" id="cs">${hostTemplate()}</section></body>`);
  globalThis.window = page.window; globalThis.document = page.window.document;
  const {renderField} = await import('../js/ui/cswin.js');
  renderField({cs, ui: data.ui, g, host: null});
  assert.equal(page.window.document.querySelector('#cs-target [data-act="target-edit"]')?.textContent, 'Ziel ändern…');
});

test('Verlauf als Geste: Tabwechsel ist ein Schritt - zurueck, vor, zurueck', () => {
  const {cs, tour, gestures: g} = setup();
  cs.OpenAt('trace', {target: 'SignalGarden/Sensor'});
  const before = tour.snapshot()['workspace.history_back'];
  g.tab('map');
  g.historyStep(-1);
  assert.deepEqual([cs.state.mode, cs.state.focus], ['trace', 'SignalGarden/Sensor']);
  g.historyStep(1);
  assert.equal(cs.state.mode, 'map');
  g.historyStep(-1);
  assert.equal(cs.state.mode, 'trace');
  assert.equal(tour.snapshot()['workspace.history_back'], before + 2);
});

test('prep cs.context setzt die gemerkte Perspektive nach dem Oeffnen des Arbeitsplatzes', () => {
  const {cs, tour} = setup();
  const lesson = tour.lessons.find((item) => item.id === 'workspace_04');
  const original = lesson.prep;
  try {
    lesson.prep = {...(original || {}), 'cs.context': 'comp'};
    tour.goTo(tour.lessons.indexOf(lesson));
    assert.equal(cs.state.context, 'comp');
    assert.equal(tour.baseline['cs.context'], 'comp');
    assert.equal(cs.cs.context, undefined, 'kein Custom-Par namens context');
    lesson.prep = {...(original || {}), 'cs.context': 'selection'};
    tour.prepare(true);
    assert.equal(cs.state.context, 'selection');
  } finally {
    lesson.prep = original;
    tour.prepare(true);
  }
});

test('Modul-STRUCTURE zeigt AUSLÖSER → MODUL; ohne Execute-DAT bleibt der Abschnitt LEER (kein Fehler)', () => {
  const {cs} = setup();
  cs.OpenAt('map', {target: 'Farbmischer/werkzeug'});
  const titles = cs.state.hits.filter((h) => h.kind === 'section').map((h) => h.text);
  assert.ok(titles.includes('AUSLÖSER → MODUL'), titles.join(' | '));
  const at = cs.state.hits.findIndex((h) => h.kind === 'section' && h.text === 'AUSLÖSER → MODUL');
  const note = cs.state.hits[at + 1];
  assert.equal(note.art, 'LEER');
  assert.match(note.text, /kein Fehler, nur Information/);
});

test('prep zoom_reset und zone_zoom wirken wie TourExt.Prepare; cs.Look bleibt der Look-Schluessel', () => {
  const {cs, tour} = setup();
  const lesson = tour.lessons[0];
  const original = lesson.prep;
  try {
    cs.zoom(0.3);
    cs.ZoomZone('results', 4);
    cs.setCodeZoom(2);
    lesson.prep = {...(original || {}), zoom_reset: true};
    tour.step = 0;
    tour.prepare(true);
    assert.deepEqual([cs.state.zoom, cs.state.zoneZoom, cs.state.codeZoom], [1, {results: 1, detail: 1}, 1]);
    assert.equal(cs.state.status, '', 'der Zoom-Hinweis gehoert nicht zum Stationsstart');
    assert.equal(tour.snapshot()['cs.zone_results'], 1);
    cs.ZoomZone('results', 5);
    lesson.prep = {...(original || {}), zone_zoom: {results: 2, detail: -1}};
    tour.prepare(true);
    assert.deepEqual(cs.state.zoneZoom, {results: 1.2, detail: 0.9}, '2 = 120 % ab 100 %, unabhaengig vom vorherigen Faktor');
    assert.equal(tour.baseline['cs.zone_results'], 1.2, 'Baseline sieht den vorbereiteten Zonenzoom');
    lesson.prep = {...(original || {}), 'cs.Look': 'mist'};
    tour.prepare(true);
    assert.equal(cs.cs.Look, 'mist');
  } finally {
    lesson.prep = original;
    tour.prepare(true);
  }
});

test('Looks: Carbon-Rollen und Glas-Liste kommen aus ui.json, Literale bleiben Fallback', () => {
  const ui = data.ui;
  for (const key of ['LOOK_FAMILY_COLORS', 'LOOK_MEANING_COLORS', 'GLASS_LOOKS', 'GLASS_SHADOW']) assert.ok(ui[key], `${key} fehlt in ui.json (tools/uitext.py WANTED)`);
  assert.deepEqual(ui.GLASS_LOOKS, ['smoked_glass', 'glass_black', 'glass_navy', 'frosted_glass']);
  const glow = vividRoles(ui, 'carbon_glow');
  assert.deepEqual(glow.purple, ui.LOOK_FAMILY_COLORS.carbon_glow.TOP.slice(0, 3));
  assert.deepEqual(glow.magenta, ui.LOOK_FAMILY_COLORS.carbon_glow.DAT.slice(0, 3));
  assert.deepEqual(glow.amber, ui.LOOK_MEANING_COLORS.carbon_glow.write.slice(0, 3));
  assert.deepEqual(glow.red, ui.LOOK_MEANING_COLORS.carbon_glow.hot.slice(0, 3));
  assert.deepEqual(vividRoles(ui, 'carbon_led').red, ui.LOOK_MEANING_COLORS.carbon_led.trigger.slice(0, 3));
  assert.deepEqual(vividRoles(ui, 'classic'), {});
  assert.deepEqual(vividRoles({}, 'carbon_led').purple, [0.78, 0.52, 1.0], 'ohne ui-Key gilt das Literal');
  assert.deepEqual(GLASS_LOOKS, {smoked_glass: 'smoke', glass_black: 'black', glass_navy: 'navy', frosted_glass: 'frost'});
  assert.equal(glassVariant(ui, 'glass_navy'), 'navy');
  assert.equal(glassVariant(ui, 'carbon'), '');
  assert.equal(glassVariant({GLASS_LOOKS: ['glass_navy']}, 'frosted_glass'), '', 'native Liste entscheidet, was Glas ist');
  assert.equal(glassVariant({GLASS_LOOKS: ['neues_glas']}, 'neues_glas'), 'smoke', 'unbekannter Glas-Look faellt auf smoke');
  assert.equal(glassVariant({}, 'frosted_glass'), 'frost', 'ohne Key gilt die Pocket-Tabelle');
  const body = new JSDOM('<body></body>').window.document.body;
  applyLook(body, ui, 'glass_navy');
  assert.equal(body.dataset.glass, 'navy');
  assert.match(body.style.getPropertyValue('--glass-shadow-edge'), /^rgb\(/);
  applyLook(body, ui, 'carbon');
  assert.equal(body.dataset.glass, undefined);
  assert.equal(body.style.getPropertyValue('--glass-shadow-edge'), '');
});

test('Der tote Container #cs-data ist aus Seite und Host-Template verschwunden', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('cs-data'));
  assert.ok(!hostTemplate().includes('cs-data'));
  assert.ok(html.includes('id="cs-scopes"') && html.includes('id="cs-context"'));
});

// ---------------------------------------------------------------- Review 1.10.3: Shift+F6-Fokus (Esc, Enter, Tab-Wechsel, Antippen), Ziel aendern…, CSS
test('Shift+F6: Esc gibt nur die Spalte zurueck - Ansicht und Fenster bleiben (native _detail_key verbraucht Esc)', () => {
  const {cs, gestures: g} = setup();
  cs.OpenAt('map', {target: 'StateLab'});
  g.tapRow((h) => h.kind === 'method' && h.ctx === 'Fire');
  g.key('Shift+F6'); g.key('Down');
  assert.equal(cs.state.detailFocus, true);
  g.key('Esc');
  assert.deepEqual([cs.state.detailFocus, cs.state.mainopen, cs.state.mode, cs.state.status],
    [false, true, 'map', 'Liste · Shift+F6 wieder ins Detail']);
  // SEARCH ohne Ansicht: vorher schloss Esc hier das ganze Fenster
  cs.OpenAt('search', {target: 'BranchLab', query: 'Fire'});
  g.tapRow((h) => h.kind === 'code' && h.line === 83);
  g.key('Shift+F6'); g.key('Esc');
  assert.deepEqual([cs.state.detailFocus, cs.state.mainopen], [false, true]);
  g.key('Esc');
  assert.equal(cs.state.mainopen, false, 'ohne Detail-Fokus schliesst Esc wie bisher');
});

test('Shift+F6: Enter fuehrt die Detailzeile unter dem Cursor aus, nicht die Listenzeile', () => {
  const {cs, gestures: g} = setup();
  cs.OpenAt('map', {target: 'StateLab'});
  g.tapRow((h) => h.kind === 'method' && h.ctx === 'Fire');
  g.key('Shift+F6');
  const rows = cs.detailFor(cs.selectedHit).flatMap((b) => b.rows);
  const impactRow = rows.findIndex((r) => r[2] === 'impact');
  assert.ok(impactRow > 0);
  for (let i = 0; i < impactRow; i += 1) g.key('Down');
  assert.deepEqual(cs.detailCursorRow()[2], 'impact');
  g.key('Enter');
  assert.deepEqual([cs.state.mode, cs.state.mainopen], ['impact', true], 'IMPACT-Zeile laeuft wie ein Antippen');
  // SEARCH-Codetreffer: FUNDSTELLE-Zeilen tragen keine Aktion - Enter springt NICHT zur Fundstelle und schliesst nicht
  cs.OpenAt('search', {target: 'BranchLab', query: 'Fire'});
  g.tapRow((h) => h.kind === 'code' && h.line === 83);
  g.key('Shift+F6'); g.key('Down');
  assert.equal(cs.detailCursorRow()[2], undefined);
  g.key('Enter');
  assert.deepEqual([cs.state.mainopen, cs.state.viewer, cs.state.detailFocus, cs.state.status], [true, null, true, 'Zeile ohne Aktion']);
});

test('Shift+F6: Tab-Wechsel (SetMode, Strg+Rechts, OpenAt) gibt den Fokus an die Liste zurueck; Pfeile bewegen wieder die Liste', () => {
  const {cs, gestures: g} = setup();
  cs.OpenAt('map', {target: 'StateLab'});
  g.tapRow((h) => h.kind === 'method' && h.ctx === 'Fire');
  g.key('Shift+F6');
  cs.SetMode('trace');
  assert.deepEqual([cs.state.detailFocus, cs.state.detailCursor], [false, 0]);
  g.key('Down');
  assert.ok(cs.state.selected >= 0, 'Pfeil bewegt die Liste');
  g.key('Shift+F6');
  assert.equal(cs.state.detailFocus, true);
  g.key('Ctrl+Right');
  assert.equal(cs.state.detailFocus, false);
  g.key('Down');
  assert.ok(cs.state.selected >= 0);
  g.key('Shift+F6');
  cs.OpenAt('map', {target: 'BranchLab'});
  assert.equal(cs.state.detailFocus, false);
});

test('Antippen der Detail-Spalte: nur eine Detailzeile setzt den Fokus (Cursor = diese Zeile), leere Spalte nie', async () => {
  const app = setup();
  const {cs} = app;
  cs.OpenAt('search', {target: 'BranchLab', query: 'Fire'});
  assert.equal(cs.state.selected, -1);
  cs.setDetailFocus(true, false, 0);
  assert.equal(cs.state.detailFocus, false, 'ohne Detailzeilen gibt es nichts zu fokussieren');
  cs.OpenAt('map', {target: 'StateLab'});
  app.gestures.tapRow((h) => h.kind === 'method' && h.ctx === 'Fire');
  cs.setDetailFocus(true, false, 7);
  assert.deepEqual([cs.state.detailFocus, cs.state.detailCursor], [true, 7]);
  cs.setDetailFocus(true, false, 999);
  assert.equal(cs.state.detailCursor, cs._detailRowCount() - 1, 'Cursor bleibt in den Zeilen');
  // Render: jede Zeile traegt ihre Modell-Nummer, der Klick in js/app.js liest sie; die cur-Markierung sitzt auf dem Cursor
  const page = new JSDOM(`<!doctype html><body><section class="cs" id="cs">${hostTemplate()}</section></body>`);
  globalThis.window = page.window;
  globalThis.document = page.window.document;
  const {renderDetail} = await import('../js/ui/cswin.js');
  cs.setDetailFocus(true, false, 3);
  cs.state.revealed = true;   // AUFRUFE aufgedeckt, sonst steht dort eine VERDECKT-Zeile ohne Nummer fuer drei Modellzeilen
  renderDetail({cs, ui: data.ui, g: app.gestures, host: null});
  const rows = [...page.window.document.querySelectorAll('#cs-detail [data-detail-row]')];
  assert.equal(rows.length, cs._detailRowCount());
  assert.deepEqual(rows.map((el) => el.dataset.detailRow), rows.map((_, i) => String(i)));
  assert.equal(page.window.document.querySelector('#cs-detail .kv.cur').dataset.detailRow, '3');
  assert.equal(page.window.document.querySelector('#cs-detail .det-bar [data-detail-row]'), null, 'Leisten-Knoepfe tragen keine Zeilennummer');
});

test('Ziel aendern… gibt es nur in Tabs mit Pfad-Zweig (USES, USED BY, FLOW, STRUCTURE, ENTRIES)', async () => {
  const app = setup();
  const {cs, gestures: g} = app;
  const page = new JSDOM(`<!doctype html><body><section class="cs" id="cs">${hostTemplate()}</section></body>`);
  globalThis.window = page.window;
  globalThis.document = page.window.document;
  const {renderField} = await import('../js/ui/cswin.js');
  const button = () => page.window.document.querySelector('#cs-target [data-act="target-edit"]');
  for (const mode of ['impact', 'errors', 'search']) {
    cs.OpenAt(mode, {target: 'BranchLab', query: mode === 'search' ? 'Fire' : ''});
    renderField({cs, ui: data.ui, g, host: null});
    assert.ok(page.window.document.querySelector('#cs-target .target-owner'), `${mode}: FOCUS-Zeile bleibt`);
    assert.equal(button(), null, `${mode}: kein Ziel-aendern-Knopf`);
    g.targetEdit();
    assert.equal(cs.state.targetEdit, false, `${mode}: Zielwechsel wird nicht versprochen`);
    assert.match(cs.state.status, /^Ziel ändern gibt es nur/);
  }
  for (const mode of ['trace', 'refs', 'map', 'entries']) {
    cs.OpenAt(mode, {target: 'BranchLab'});
    renderField({cs, ui: data.ui, g, host: null});
    assert.ok(button(), `${mode}: Knopf da`);
    g.targetEdit(); g.enter('StateLab');
    assert.equal(cs.state.focus, 'StateLab', `${mode}: Enter uebernimmt den Pfad`);
  }
});

test('CSS: offene Tastatur versteckt nur die Scope-Chips; Zonen-Zoom DETAILS sitzt auf den Inhalten, nicht auf der Spalte', () => {
  const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.keyboard-open \.cs-scopes\s*[,{]/, 'AUSWAHL / DIESE COMP, FLOWLENS, LLM, SPEC, ZWEITANSICHT bleiben erreichbar');
  assert.match(css, /\.keyboard-open \.cs-scopes \[data-scope\]/);
  assert.match(css, /\.keyboard-open \.cs-scopes \.lbl/);
  assert.doesNotMatch(css, /^\.cs-detail \{ zoom:/m, 'zoom nicht auf dem Element mit der px-Hoehe des Trenngriffs');
  assert.match(css, /^\.cs-detail > \* \{ zoom: var\(--zone-detail, 1\); \}/m);
  assert.match(css, /^\.cs-detail > \.code-viewport \{ zoom: 1; \}/m);
});
