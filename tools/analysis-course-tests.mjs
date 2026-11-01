// Echte öffentliche Gesten gegen den Lernvertrag, keine Browser-/iPhone-Abnahme.
// Optionaler Kurs-Pfad erlaubt den Test vor dem gemeinsamen Daten-Build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../js/core/boot.js';
import { evaluate } from '../js/core/tour.js';
import { guideForLesson } from '../js/core/learning.js';
import { phoneSteps } from '../js/core/phone.js';
import { SCRIPTS } from './walkthroughs.mjs';

const load = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));
const course = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : load('course');
const data = { course, net: load('net'), code: load('code'), ui: load('ui') };
const lessons = course.lessons.filter((lesson) => lesson.id.startsWith('analysis_'));
function start(app, id) { app.tour.goTo(app.tour.lessons.findIndex((lesson) => lesson.id === id)); }
function perform(app, id) { start(app, id); SCRIPTS[id](app.gestures); return app.tour.check(); }

test('16 neue Analyse-Stationen verlangen eigene Aktionen und bestehen danach', () => {
  assert.equal(lessons.length, 16);
  const app = createApp(data);
  for (const lesson of lessons) {
    start(app, lesson.id);
    assert.equal(evaluate(lesson.rules, app.tour.snapshot(), app.tour.baseline).passed, false, `${lesson.id}: bereits vorbereitet erfüllt`);
    SCRIPTS[lesson.id](app.gestures);
    const result = app.tour.check();
    assert.equal(result.passed, true, `${lesson.id}: ${JSON.stringify(result.failures)}`);
  }
});

test('Paket-Gegenprobe erkennt versehentliches Aktualisieren zwischen Fire und Export', () => {
  const app = createApp(data);
  for (const lesson of lessons.slice(0, 7)) assert.equal(perform(app, lesson.id).passed, true);
  start(app, 'analysis_08');
  app.gestures.slPulse('Fire'); app.gestures.enter('>fall zwischenstand');
  app.gestures.enter('>analyse aktualisieren'); app.gestures.enter('>analyse kopieren'); app.gestures.seen();
  const result = app.tour.check();
  assert.equal(result.passed, false);
  assert.equal(result.results.find((rule) => rule.key === 'investigation.analysis_packet_unchanged').ok, false);
});

test('Alter Import kann eine neue Nachfrage-Station nicht erfüllen', () => {
  const app = createApp(data);
  for (const id of ['analysis_01', 'analysis_02', 'analysis_03']) assert.equal(perform(app, id).passed, true);
  start(app, 'analysis_04'); app.gestures.seen();
  const result = app.tour.check();
  assert.equal(result.passed, false);
  assert.equal(result.results.find((rule) => rule.key === 'investigation.analysis_import_id').ok, false);
});

test('Kapitel-Neustart erhält Häkchen, verlangt aber neue Aktionen', () => {
  const app = createApp(data);
  assert.equal(perform(app, 'analysis_09').passed, true);
  assert.equal(app.lab.stateLab.Observe().count, 2);
  const chapter = app.tour.lesson().chapter;
  app.tour.chapterStart(chapter);
  assert.equal(app.tour.lesson().id, 'analysis_09');
  assert.equal(app.lab.stateLab.Observe().count, 0);
  assert.equal(app.tour.done.analysis_09, 'verified');
  assert.equal(app.tour.next(), false);
});

test('Seitenneustart stellt weder Pakete noch simulierte Runtime aus Häkchen her', () => {
  const memory = new Map();
  const storage = {getItem: (key) => memory.get(key), setItem: (key, value) => memory.set(key, value)};
  const first = createApp(data, storage);
  assert.equal(perform(first, 'analysis_09').passed, true);
  assert.equal(perform(first, 'analysis_10').passed, true);
  const next = createApp(data, storage); next.tour.load(); next.tour.prepare();
  assert.equal(next.tour.lesson().id, 'analysis_09');
  assert.equal(next.lab.stateLab.Observe().count, 0);
  assert.equal(next.cs.investigationSnapshot()['investigation.analysis_packet_id'], '');
  assert.equal(next.tour.next(), false);
});

test('Jede Station hat eigene Laptop- und iPhone-Anleitung mit überprüfbarer Grenze', () => {
  for (const lesson of lessons) {
    assert.ok(lesson.laptop_steps.length >= 4, lesson.id);
    assert.deepEqual(phoneSteps(lesson), lesson.phone_steps);
    const guide = guideForLesson(lesson);
    assert.equal(guide.title, lesson.title);
    assert.equal(guide.goal, lesson.question);
    assert.equal(guide.limit, lesson.limit);
    assert.ok(guide.limit.length > 60, lesson.id);
  }
});
