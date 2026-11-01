// Gesamter Spec-Lernablauf über öffentliche Bedienaktionen, keine echte TD-/iPhone-Abnahme.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../js/core/boot.js';
import { evaluate } from '../js/core/tour.js';
import { guideForLesson } from '../js/core/learning.js';
import { phoneSteps } from '../js/core/phone.js';
import { SPEC_SCRIPTS } from './spec-walkthroughs.mjs';

const load = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));
const course = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : load('course');
const data = {course, net: load('net'), code: load('code'), ui: load('ui')};
const lessons = course.lessons.filter((lesson) => lesson.id.startsWith('spec_'));
function memoryStorage() {
  const memory = new Map();
  return {getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value)};
}
function start(app, id) { app.tour.goTo(app.tour.lessons.findIndex((item) => item.id === id)); }
function perform(app, id) { start(app, id); SPEC_SCRIPTS[id](app.gestures); return app.tour.check(); }
function through(app, last) {
  for (const lesson of lessons.slice(0, last)) {
    const result = perform(app, lesson.id);
    assert.equal(result.passed, true, `${lesson.id}: ${JSON.stringify(result.failures)}; ${app.cs.state.status}`);
  }
}

test('14 Stationen bestehen erst nach eigenen Aktionen', () => {
  assert.equal(lessons.length, 14);
  const app = createApp(data, memoryStorage());
  for (const lesson of lessons) {
    start(app, lesson.id);
    assert.equal(evaluate(lesson.rules, app.tour.snapshot(), app.tour.baseline).passed, false, `${lesson.id}: vorbereitet erfüllt`);
    SPEC_SCRIPTS[lesson.id](app.gestures);
    const result = app.tour.check();
    assert.equal(result.passed, true, `${lesson.id}: ${JSON.stringify(result.failures)}; ${app.cs.state.status}`);
  }
});

test('Ein alter Report ersetzt die neue Aufnahme nach Settings-Änderung nicht', () => {
  const app = createApp(data, memoryStorage()); through(app, 5);
  start(app, 'spec_06');
  app.gestures.gardenPar('sensor', 'Enter', 0.7);
  app.gestures.gardenPulse('sensor', 'Reset'); app.gestures.gardenPulse('sensor', 'Sample'); app.gestures.seen();
  const result = app.tour.check();
  assert.equal(result.passed, false);
  assert.equal(result.results.find((item) => item.key === 'investigation.spec_report_id').ok, false);
});

test('Die falsche Vorgeschichte bleibt ein mismatch und keine semantische Bugdiagnose', () => {
  const app = createApp(data, memoryStorage()); through(app, 9);
  const snapshot = app.cs.investigationSnapshot();
  assert.equal(snapshot['investigation.spec_report_result'], 'mismatch');
  const doc = app.cs.ExportSpec();
  const report = doc.reports.at(-1);
  assert.equal(report.observed.value, false);
  assert.match(report.requirement_snapshot.given, /Present=True/);
  assert.equal(Object.hasOwn(report, 'feature_passed'), false);
});

test('Specänderung erhält alte Reports und verlangt eine erneute aktuelle Aufnahme', () => {
  const app = createApp(data, memoryStorage()); through(app, 9);
  const previous = app.cs.ExportSpec();
  assert.equal(perform(app, 'spec_10').passed, true);
  const revised = app.cs.ExportSpec();
  assert.notEqual(revised.revision, previous.revision);
  assert.deepEqual(revised.reports, previous.reports);
  assert.equal(app.cs.investigationSnapshot()['investigation.spec_report_current'], false);
  assert.equal(perform(app, 'spec_11').passed, true);
});

test('Import bewahrt Belege und erzeugt keine aktuelle Ausführungsherkunft', () => {
  const app = createApp(data, memoryStorage()); through(app, 12);
  const original = app.cs.ExportSpec();
  assert.equal(perform(app, 'spec_13').passed, true);
  const imported = app.cs.ExportSpec();
  assert.deepEqual(imported, original);
  assert.equal(app.cs.investigationSnapshot()['investigation.spec_report_session'], false);
  assert.ok(Object.keys(imported.evidence).length >= 6);
});

test('Seitenneustart erhält gespeicherte Specs, setzt aber nicht die Sensor-Runtime aus Reports', () => {
  const storage = memoryStorage(), app = createApp(data, storage); through(app, 12);
  const document = app.cs.ExportSpec();
  const next = createApp(data, storage);
  next.tour.load(); next.tour.prepare();
  assert.equal(next.tour.lesson().id, 'spec_01');
  next.cs.LoadSpec(document.id);
  assert.equal(next.cs.investigationSnapshot()['investigation.spec_report_session'], false);
  assert.equal(next.lab.garden.Observe()['sensor.present'], false);
  assert.equal(next.tour.done.spec_12, app.tour.done.spec_12);
});

test('Alle Stationen erklären Laptop und iPhone mit konkreter Grenze', () => {
  for (const lesson of lessons) {
    assert.deepEqual(phoneSteps(lesson), lesson.phone_steps);
    assert.equal(guideForLesson(lesson).title, lesson.title);
    assert.ok(lesson.laptop_steps.length >= 5 && lesson.phone_steps.length >= 5);
    assert.ok(lesson.limit.length >= 70);
  }
});
