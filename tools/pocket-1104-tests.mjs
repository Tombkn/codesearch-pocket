// 1.10.4: Station 40 (LETZTE FOCUS) mit dem Hilfsschritt ueber USES auf einer frischen App, in der Sensor noch nicht in
// der Liste steht - getippter Pfad + Enter muss wie Enter auf einer Zeile in LETZTE FOCUS landen (wie nativ 1.10.4).
// Modelltest ohne Layout; keine native TD- oder iPhone-Abnahme.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApp} from '../js/core/boot.js';
import {WORKPLACE_SCRIPTS} from './workplace-walkthroughs.mjs';

const load = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));
const data = {course: load('course'), net: load('net'), code: load('code'), ui: load('ui')};
const focusRow = (h) => h.kind === 'opfind' && h.detail === 'FOCUS' && /\/Sensor$/.test(h.path || '');

function freshAtStation40() {
  const app = createApp(data);
  const index = app.tour.lessons.findIndex((lesson) => lesson.id === 'workspace_40');
  assert.ok(index >= 0, 'workspace_40 fehlt im Kurs');
  app.tour.goTo(index);
  return app;
}

test('Getippter Pfad in USES + Enter landet in LETZTE FOCUS', () => {
  const app = freshAtStation40();
  const g = app.gestures;
  assert.ok(!(app.cs.state.focusRecent || []).some((path) => /Sensor$/.test(path)), 'Ausgangslage: Sensor noch nicht gemerkt');
  g.tab('trace');
  g.enter('SignalGarden/Sensor');
  assert.match(String(app.cs.state.focus), /Sensor$/);
  g.enter('BranchLab');
  g.tab('search'); g.type(''); g.filter('all');
  assert.ok(app.cs.state.hits.some(focusRow), 'leere Suche zeigt Sensor unter LETZTE FOCUS');
});

test('Station 40 besteht auf frischer App mit dem Hilfsschritt aus dem Stationstext', () => {
  const app = freshAtStation40();
  WORKPLACE_SCRIPTS.workspace_40(app.gestures);
  const result = app.tour.check();
  assert.equal(result.passed, true, JSON.stringify(result.missing || result));
});
