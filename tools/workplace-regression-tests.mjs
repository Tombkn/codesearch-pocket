// Regressionsfälle aus dem vollständigen Kurslauf; keine native TD-/Browser-Abnahme.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApp} from '../js/core/boot.js';
import {evaluate} from '../js/core/tour.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));
const data = {course: load('course'), net: load('net'), code: load('code'), ui: load('ui')};
const create = () => createApp(data);
const start = (app, id) => {
  const index = app.tour.lessons.findIndex((lesson) => lesson.id === id);
  assert.notEqual(index, -1, `Station fehlt: ${id}`);
  app.tour.goTo(index);
};
const clipboard = (cs) => ({text: cs.clipboard, serial: cs.clipboardSerial, origin: cs.clipboardOrigin});
const method = (name) => (hit) => hit.kind === 'method' && hit.ctx === name;
function floatMethods(app) {
  app.cs.OpenAt('map', {target: 'StateLab', scope: 'StateLab'});
  app.gestures.floatList();
  app.gestures.floatTapRow('"ctx":"Fire"');
}

for (const pinned of [false, true]) {
  test(`FOCUS HIERHER markiert den neuen Bezugspunkt bei Pin=${pinned}`, () => {
    const app = create(); start(app, 'new_focus_here');
    if (pinned) app.cs.flowPin(true);
    assert.equal(evaluate(app.tour.lesson().rules, app.tour.snapshot(), app.tour.baseline).passed, false);
    app.gestures.rowMenu((hit) => hit.kind === 'chain' && hit.path.endsWith('/switch_route'));
    app.gestures.menu('FOCUS HIERHER');
    assert.equal(app.cs.flowTarget(), 'BranchLab/switch_route');
    assert.equal(app.cs.state.flow.pinned, pinned);
    assert.equal(app.cs.selectedHit.anchor, true);
    assert.equal(app.cs.selectedHit.path, '/project1/CodeSearch_Tutorial/BranchLab/switch_route');
    assert.equal(app.tour.check().passed, true);
  });
}

test('LIVE-Strg+C ändert die Herkunft erst zusammen mit der gewählten Kopie', () => {
  const app = create(), {cs, gestures: g} = app;
  floatMethods(app); cs.copy('ältere Kopie', '', 'vorher');
  const before = clipboard(cs), notifications = [];
  cs.onChange(() => notifications.push(clipboard(cs)));
  g.key('Ctrl+C');
  assert.ok(cs.state.menu.items.some((item) => item.label.startsWith('Methodenaufruf')));
  assert.deepEqual(clipboard(cs), before, 'Menüöffnen ist keine Kopieraktion');
  assert.ok(notifications.every((snapshot) => snapshot.serial === before.serial && snapshot.origin === 'vorher'));
  // Der Callback ist derselbe wie beim echten Menübutton, ohne Test-Sonderpfad.
  cs.state.menu.items.find((item) => item.label.startsWith('Methodenaufruf')).run();
  assert.match(cs.clipboard, /\.Fire\(\)$/);
  assert.equal(cs.clipboardSerial, before.serial + 1);
  assert.equal(cs.clipboardOrigin, 'float');
  cs.emit();
  assert.ok(notifications.filter((snapshot) => snapshot.serial > before.serial).every((snapshot) => snapshot.origin === 'float'));
});

test('Abgebrochenes LIVE-Kopiermenü und Kopieren ohne Auswahl erhalten die letzte Herkunft', () => {
  const app = create(), {cs, gestures: g} = app;
  floatMethods(app); cs.copy('vorhanden', '', 'landkarte');
  const before = clipboard(cs);
  g.key('Ctrl+C'); g.key('Esc');
  assert.equal(cs.state.menu, null);
  assert.deepEqual(clipboard(cs), before);
  cs.selectionClear(); cs.ctrlC('float');
  assert.match(cs.state.status, /nichts markiert/);
  assert.deepEqual(clipboard(cs), before);
});

test('Direktes Kopieren einer LIVE-Mehrfachauswahl veröffentlicht sofort die richtige Herkunft', () => {
  const app = create(), {cs, gestures: g} = app;
  floatMethods(app); g.tapRow(method('Notify'), {ctrl: true});
  cs.copy('vorher', '', 'landkarte'); const before = clipboard(cs), notifications = [];
  cs.onChange(() => notifications.push(clipboard(cs)));
  g.key('Ctrl+C');
  assert.match(cs.clipboard, /Fire/); assert.match(cs.clipboard, /Notify/);
  assert.equal(cs.clipboardSerial, before.serial + 1);
  assert.equal(cs.clipboardOrigin, 'float');
  assert.ok(notifications.length > 0);
  assert.ok(notifications.every((snapshot) => snapshot.origin === 'float'));
});

test('Deferred TABLE-Kopien und direkte RECORD-Kopien behalten die angegebene Herkunft', () => {
  const {cs} = create();
  cs.OpenAt('table', {target: 'BranchLab/ColorEngine/palette'}); cs.tableSelect(1, 1);
  cs.copy('vorher', '', 'landkarte'); const before = clipboard(cs);
  cs.ctrlC('float'); assert.deepEqual(clipboard(cs), before);
  cs.state.menu.items.find((item) => item.label.startsWith('Wert:')).run();
  assert.equal(cs.clipboard, cs.tableData()[1][1]); assert.equal(cs.clipboardOrigin, 'float');
  cs.OpenAt('record', {target: 'BranchLab'}); cs.ctrlC('float');
  assert.equal(cs.clipboardOrigin, 'float');
  cs.copy('normale Hauptfensterkopie'); assert.equal(cs.clipboardOrigin, '');
});

test('keep erhält FLOW; eine neue Station erhält ihr eigenes Ziel, Scope und ungefilterte Strecke', () => {
  const app = create(), {cs, gestures: g, tour} = app;
  cs.OpenAt('chain', {target: 'BranchLab/control', scope: 'BranchLab'});
  cs.setScope('currentflat'); cs.flowPin(true); cs.flowFilter('direction', 'down');
  cs.flowFilter('family', 'chop'); cs.flowFilter('links', 'refs'); cs.flowFilter('depth', 1);
  const pinned = structuredClone(cs.state.flow);
  start(app, 'n_float_keys');
  assert.deepEqual(cs.state.flow, pinned, 'keep-Station darf eine laufende Untersuchung nicht löschen');
  start(app, 'abschluss_strecke');
  assert.equal(cs.state.flow.pinned, false); assert.equal(cs.state.flow.raw, null);
  assert.equal(cs.flowTarget(), 'BranchLab/merge_image');
  assert.equal(cs.cs.Scope, 'comp'); assert.equal(cs.scopeRoot(), 'BranchLab');
  assert.deepEqual(cs.state.flow.filters, {direction: 'both', family: 'all', links: 'all', depth: 64});
  assert.equal(evaluate(tour.lesson().rules, tour.snapshot(), tour.baseline).passed, false);
  g.tab('chain');
  g.tapRow((hit) => hit.art === 'OPPAR' && hit.path.endsWith('/ColorEngine/out1'));
  assert.equal(cs.selectedHit.dist, -3);
  assert.equal(tour.check().passed, true);
});

test('Dialog-Callbacks sehen den aktuellen Dialog und laufen pro bestätigter Aktion einmal', () => {
  const {cs, gestures: g} = create(); let cancelled = 0, confirmed = 0;
  const cancelDialog = {cancel: () => {assert.equal(cs.state.dialog, cancelDialog); cancelled++;}};
  cs.state.dialog = cancelDialog; g.key('Esc');
  assert.equal(cancelled, 1); assert.equal(cs.state.dialog, null);
  g.key('Esc'); assert.equal(cancelled, 1);
  const confirmDialog = {confirm: () => {assert.equal(cs.state.dialog, confirmDialog); confirmed++;}};
  cs.state.dialog = confirmDialog; g.enter();
  assert.equal(confirmed, 1); assert.equal(cs.state.dialog, null);
});

test('Code-Schriftzoom reicht von 25 bis 250 Prozent und verändert keinen Fensterzoom', () => {
  const {cs} = create(), windowZoom = cs.state.zoom;
  cs.setCodeZoom(.4); assert.equal(cs.state.codeZoom, .4);
  cs.setCodeZoom(.1); assert.equal(cs.state.codeZoom, .25);
  cs.setCodeZoom(3); assert.equal(cs.state.codeZoom, 2.5);
  assert.equal(cs.state.zoom, windowZoom);
  assert.throws(() => cs.setCodeZoom(NaN), /endliche Zahl/);
  assert.equal(cs.state.codeZoom, 2.5);
});
