// Modelltests mit öffentlichen Bedienaktionen, keine native TD-/Browser-/iPhone-Abnahme.
// Optional: node tools/workplace-course-tests.mjs /pfad/zum/nativen/lessons.json
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApp} from '../js/core/boot.js';
import {evaluate} from '../js/core/tour.js';
import {guideForLesson} from '../js/core/learning.js';
import {phoneSteps} from '../js/core/phone.js';
import {selectedHits} from '../js/core/multi-selection.js';
import {SCRIPTS} from './walkthroughs.mjs';
import {WORKPLACE_SCRIPTS} from './workplace-walkthroughs.mjs';

const load = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));
const course = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : load('course');
const data = {course, net: load('net'), code: load('code'), ui: load('ui')};
const lessons = course.lessons.filter((lesson) => lesson.id.startsWith('workspace_'));
const create = () => createApp(data);
function start(app, id) {
  const index = app.tour.lessons.findIndex((lesson) => lesson.id === id);
  assert.notEqual(index, -1, `Station fehlt: ${id}`);
  app.tour.goTo(index);
}
function perform(app, id) {
  start(app, id); SCRIPTS[id](app.gestures);
  const result = app.tour.check();
  assert.equal(result.passed, true, `${id}: ${JSON.stringify(result.missing)}; ${app.cs.state.status}`);
  return result;
}
function through(app, last, first = 1) {
  for (const lesson of lessons.slice(first - 1, last)) perform(app, lesson.id);
}
const searchSummary = (cs) => cs.state.searchWindows.filter((item) => item.open)
  .map(({id, query, scopeRoot, regex}) => ({id, query, scopeRoot, regex}));
const mainSummary = (cs) => ({query: cs.state.query, mode: cs.state.mode, focus: cs.state.focus,
  owner: cs.state.paneOwner, scope: cs.cs.Scope, scopeComp: cs.cs.Scopecomp, filter: cs.cs.Searchfilter});
const parentControls = (app) => Object.keys(app.lab.garden.pars.root).sort();

test('22 Arbeitsplatz-Stationen bestehen in Reihenfolge erst nach Bedienaktionen', async (t) => {
  assert.equal(lessons.length, 22);
  assert.deepEqual(lessons.map(({id}) => id), Object.keys(WORKPLACE_SCRIPTS));
  const app = create();
  for (const lesson of lessons) {
    await t.test(lesson.id, () => {
      assert.equal(SCRIPTS[lesson.id], WORKPLACE_SCRIPTS[lesson.id]);
      start(app, lesson.id);
      app.gestures.seen();
      assert.equal(evaluate(lesson.rules, app.tour.snapshot(), app.tour.baseline).passed,
        false, `${lesson.id}: vor der Bedienung bereits erfüllt`);
      SCRIPTS[lesson.id](app.gestures);
      const result = app.tour.check();
      assert.equal(result.passed, true, `${lesson.id}: ${JSON.stringify(result.missing)}; ${app.cs.state.status}`);
    });
  }
});

test('TABLE-Undo/Redo erhält dieselbe LIVE-Ansicht und die richtige Zelle', () => {
  const app = create(); perform(app, 'workspace_01');
  const live = app.cs.state.floats.find((item) => item.kind === 'list' && item.live);
  assert.ok(live); assert.match(live.text, /warm\t0\.42\t/);
  perform(app, 'workspace_02'); assert.equal(app.lab.palette[1][1], '0.95');
  assert.match(live.text, /warm\t0\.95\t/);
  perform(app, 'workspace_03'); assert.equal(app.lab.palette[1][1], '0.42');
  assert.match(live.text, /warm\t0\.42\t/);
  app.gestures.key('Ctrl+Z'); app.gestures.tableEdit(1, 1, '0.6'); app.gestures.key('Ctrl+Y');
  assert.equal(app.lab.palette[1][1], '0.6', 'Neue Änderung verwirft den alten Redo-Zweig');
});

test('Einzelauswahl und Auswahlmenü kopieren genau Fire und Notify samt Source', () => {
  const app = create(); through(app, 6, 6);
  assert.deepEqual(selectedHits(app.cs).map((hit) => hit.ctx), ['Fire', 'Notify']);
  assert.equal(app.lab.stateLab.count, 0, 'Auswählen darf Fire nicht ausführen');
  perform(app, 'workspace_07');
  assert.match(app.cs.clipboard, /def Fire\(/); assert.match(app.cs.clipboard, /def Notify\(/);
  assert.doesNotMatch(app.cs.clipboard, /def Mutate\(/);
  assert.match(app.cs.clipboard, /StateLabExt/); assert.match(app.cs.clipboard, /Source-Zeilen/);
  assert.deepEqual(selectedHits(app.cs).map((hit) => hit.ctx), ['Fire', 'Notify']);
});

test('Vollcode und Code-Schrift verändern den Fensterzoom nicht', () => {
  const app = create(); through(app, 7, 6); const windowZoom = app.cs.state.zoom;
  perform(app, 'workspace_08');
  assert.equal(app.cs.state.codeFull, true); assert.equal(app.cs.state.codeZoom, 1.5);
  assert.equal(app.cs.state.zoom, windowZoom);
  assert.ok(app.cs.state.floats.some((item) => item.kind === 'details' && item.live));
  assert.equal(app.cs.state.codeView.focus, 'Fire');
});

test('Drei Zusatzsuchen behalten Fragen und Bereiche; die vierte ersetzt keine', () => {
  const app = create(); start(app, 'workspace_09');
  const main = mainSummary(app.cs);
  SCRIPTS.workspace_09(app.gestures); assert.equal(app.tour.check().passed, true);
  perform(app, 'workspace_10');
  assert.deepEqual(searchSummary(app.cs).map(({query, scopeRoot}) => ({query, scopeRoot})), [
    {query: 'Sample', scopeRoot: 'SignalGarden'}, {query: 'Fire', scopeRoot: 'StateLab'},
    {query: 'gain', scopeRoot: 'BranchLab'},
  ]);
  const searches = searchSummary(app.cs);
  // Limit ist zehn: ein viertes Fenster öffnet, ersetzt aber keines der drei; danach schließen.
  const extra = app.cs.quickOpen(true); assert.ok(extra);
  assert.deepEqual(searchSummary(app.cs).slice(0, 3), searches); app.cs.quickClose(extra.id);
  assert.deepEqual(searchSummary(app.cs), searches);
  assert.deepEqual(mainSummary(app.cs), main);
  perform(app, 'workspace_11'); perform(app, 'workspace_12');
  assert.equal(app.cs.state.searchWindows.filter((item) => item.open).length, 0);
  assert.equal(app.cs.state.mainopen, true); assert.deepEqual(mainSummary(app.cs), main);
});

test('Ungültiges Regex betrifft nur die gewählte Zusatzsuche und lässt sich korrigieren', () => {
  const app = create(); through(app, 10, 9); start(app, 'workspace_11');
  const [sample, fire] = app.cs.state.searchWindows; const fireBefore = {...fire};
  app.cs.quickActivate(sample.id); app.cs.quickOption('regex', true); app.gestures.quickType('[');
  assert.ok(sample.error); assert.equal(sample.total, 0);
  assert.deepEqual(fire, fireBefore);
  app.cs.quickActivate(fire.id); assert.equal(app.cs.state.quick.query, 'Fire');
  app.cs.quickActivate(sample.id); app.gestures.quickType('Sample|Fire');
  assert.equal(sample.error, ''); assert.equal(sample.regex, true);
  app.gestures.seen(); assert.equal(app.tour.check().passed, true);
});

test('Fixierter FLOW erhält Ziel und Hauptansicht bei Pane-Navigation und Filtern', () => {
  const app = create(); through(app, 13, 13);
  assert.equal(app.cs.flowTarget(), 'BranchLab/control');
  const anchor = app.cs.state.flow.anchor, scope = structuredClone(app.cs.state.flow.scope);
  const main = mainSummary(app.cs), generation = app.cs.state.flow.generation;
  perform(app, 'workspace_14');
  assert.equal(app.cs.state.secondaryPane.owner, 'SignalGarden/Sensor');
  assert.equal(app.cs.state.secondaryPane.target, 'SignalGarden/Sensor/SensorExt');
  assert.deepEqual(mainSummary(app.cs), main);
  perform(app, 'workspace_15');
  assert.equal(app.cs.state.flow.anchor, anchor); assert.deepEqual(app.cs.state.flow.scope, scope);
  assert.equal(app.cs.state.flow.filters.direction, 'down'); assert.equal(app.cs.state.flow.filters.family, 'all');
  assert.equal(app.cs.state.flow.generation, generation);
  perform(app, 'workspace_16'); assert.ok(app.cs.state.flow.generation > generation);
  assert.equal(app.cs.state.flow.anchor, anchor); assert.equal(app.cs.state.flow.filters.direction, 'down');
  assert.match(app.cs.clipboard, /BranchLab\/control/);
});

test('Promotion wird erst bestätigt, wirkt bidirektional und erhält Status bei Undo/Redo', () => {
  const app = create(); start(app, 'workspace_17');
  const originalControls = parentControls(app), status = app.lab.garden.pars.root.Status;
  const sensorValue = app.lab.garden.pars.sensor.Value, samples = app.lab.garden.samples;
  app.gestures.compMenu(); app.gestures.menu('Parameter nach oben');
  assert.match(app.cs.state.dialog.lines.join('\n'), /KONFLIKT · Status/);
  assert.match(app.cs.state.dialog.lines.join('\n'), /AUSGELASSEN · Present/);
  assert.deepEqual(parentControls(app), originalControls);
  app.gestures.key('Esc'); app.gestures.seen(); assert.equal(app.tour.check().passed, true);
  perform(app, 'workspace_18'); const promotedControls = parentControls(app);
  assert.equal(app.lab.garden.samples, samples, 'Promotion führt keinen Pulse aus');
  perform(app, 'workspace_19');
  assert.equal(app.lab.garden.pars.root.Value, 0.83); assert.equal(app.lab.garden.pars.sensor.Value, 0.83);
  assert.equal(app.lab.garden.samples, samples, 'Setting-Änderung führt keinen Pulse aus');
  perform(app, 'workspace_20');
  assert.deepEqual(parentControls(app), originalControls); assert.equal(app.lab.garden.pars.root.Status, status);
  assert.equal(app.lab.garden.pars.sensor.Value, sensorValue);
  perform(app, 'workspace_21');
  assert.deepEqual(parentControls(app), promotedControls); assert.equal(app.lab.garden.pars.root.Value, sensorValue);
  const history = app.lab.tableUndo.length;
  app.gestures.compMenu(); app.gestures.menu('Parameter nach oben');
  assert.match(app.cs.state.dialog.lines.join('\n'), /VERBUNDEN · Value/);
  app.gestures.key('Esc'); assert.equal(app.lab.tableUndo.length, history);
  app.gestures.gardenPar('sensor', 'Value', 0.47); assert.equal(app.lab.garden.pars.root.Value, 0.47);
  perform(app, 'workspace_22'); assert.equal(app.cs.state.focus, 'SignalGarden/Sensor');
  assert.match(app.cs.clipboard, /SignalGarden\/Sensor$/);
});

test('Ein einzelnes Undo reicht nach Value-Änderung noch nicht zum Entfernen der Promotion', () => {
  const app = create(); through(app, 19, 17); start(app, 'workspace_20');
  app.gestures.key('Ctrl+Z'); app.gestures.seen();
  const result = app.tour.check(); assert.equal(result.passed, false);
  assert.equal(result.results.find((rule) => rule.key === 'workspace.parent_value_exists').ok, false);
  app.gestures.key('Ctrl+Z'); assert.equal(app.tour.check().passed, true);
});

test('Kapitel-Neustart löscht keine Promotion und verlangt das angekündigte eigene Undo', () => {
  const app = create(); through(app, 18, 17); const controls = parentControls(app);
  app.tour.chapterStart(app.tour.lesson().chapter);
  assert.equal(app.tour.lesson().id, 'workspace_17');
  assert.deepEqual(parentControls(app), controls);
  app.gestures.seen(); assert.equal(app.tour.check().passed, false);
  app.gestures.key('Ctrl+Z'); SCRIPTS.workspace_17(app.gestures);
  assert.equal(app.tour.check().passed, true);
});

test('Alle Stationen haben getrennte Laptop-/Pocket-Schritte und eine ausdrückliche Grenze', () => {
  for (const lesson of lessons) {
    assert.ok(lesson.laptop_steps.length >= 4, lesson.id);
    assert.ok(lesson.phone_steps.length >= 4, lesson.id);
    assert.deepEqual(phoneSteps(lesson), lesson.phone_steps);
    const guide = guideForLesson(lesson);
    assert.equal(guide.title, lesson.title); assert.equal(guide.goal, lesson.question);
    assert.equal(guide.limit, lesson.limit); assert.ok(guide.limit.length > 60, lesson.id);
  }
});
