// Gegenproben für Integration und Fortsetzen, keine Touch-/TD-Laufzeitprüfung.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createApp } from "../js/core/boot.js";
import { evaluate } from "../js/core/tour.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), "utf8"));
const data = { course: load('course'), net: load('net'), code: load('code'), ui: load('ui') };
function app(storage = null) { return createApp(data, storage); }

test('iop-Aufrufe erreichen die richtigen Extensions, auch beide Request-Stellen', () => {
  const { net } = app();
  const root = 'SignalGarden/SignalGardenExt';
  for (const [from, method, target, called, count] of [
    [root, 'Submit', 'SignalGarden/Sensor/SensorExt', 'Sample', 1],
    [root, 'Submit', 'SignalGarden/Scenes/SceneControllerExt', 'Request', 2],
    [root, 'Step', 'SignalGarden/Scenes/SceneControllerExt', 'Tick', 1],
    ['SignalGarden/Scenes/SceneControllerExt', 'Request', 'SignalGarden/Palette/PaletteExt', 'Resolve', 1],
  ]) assert.equal(net.calls.filter((c) => c.from.dat === from && c.from.name === method && c.to.dat === target && c.to.name === called).length, count, `${method} -> ${called}`);
});

test('Scenes-Fall erfasst keine fremde Sensoränderung; Scopewechsel ist kein Vergleich', () => {
  const { cs, gestures: g } = app();
  cs.OpenAt('map', { target: 'SignalGarden/Scenes' });
  g.enter('>fall vorher');
  g.gardenPar('sensor', 'Value', 0.7);
  g.enter('>fall nachher'); g.enter('>vergleich');
  assert.equal(cs.state.inv.comparison.changed, 0);
  cs.OpenAt('map', { target: 'SignalGarden/Sensor' });
  g.enter('>fall sensor'); g.enter('>vergleich');
  assert.equal(cs.state.inv.comparison, null);
  assert.match(cs.state.status, /Verschiedene Analysebereiche/);
});

test('Fall-ID bleibt nach 12 gespeicherten Fällen ein frischer Aktionsbeleg', () => {
  const { cs, gestures: g } = app(); cs.OpenAt('map', { target: 'SignalGarden' });
  for (let i = 0; i < 12; i++) g.enter(`>fall ${i}`);
  const previous = cs.state.inv.caseId;
  g.enter('>fall neu');
  assert.equal(cs.state.inv.cases.length, 12);
  assert.notEqual(cs.state.inv.caseId, previous);
});

test('Eine alte RECORD-Aufnahme ersetzt die neu geforderte Aufnahme nicht', () => {
  const { tour, gestures: g } = app();
  tour.goTo(tour.lessons.findIndex((l) => l.id === 'sg_orientation_01'));
  g.record('start'); g.gardenPar('sensor', 'Value', 0.7); g.gardenPulse('root', 'Submit'); g.record('stop');
  g.gardenPulse('root', 'Prepare'); g.gardenPar('sensor', 'Value', 0.7);
  tour.goTo(tour.lessons.findIndex((l) => l.id === 'sg_orientation_10'));
  g.workspace();
  g.gardenPulse('root', 'Submit'); g.seen();
  assert.equal(tour.check().passed, false);
  assert.equal(evaluate(tour.lesson().rules, tour.snapshot(), tour.baseline).results.find((r) => r.key === 'record.session').ok, false);
  g.gardenPulse('root', 'Prepare'); g.gardenPar('sensor', 'Value', 0.7);
  g.record('start'); g.gardenPulse('root', 'Submit'); g.record('stop');
  const result = tour.check(); assert.equal(result.passed, true, JSON.stringify(result.missing));
});

test('Workflow neu öffnen setzt Versuch zurück, erhält aber bestätigte Stationen', () => {
  const { tour, gestures: g, lab } = app();
  tour.chapterStart(35); const id = tour.lesson().id;
  tour.done[id] = 'confirmed';
  g.gardenPulse('root', 'Submit'); assert.equal(lab.garden.samples, 1);
  tour.chapterStart(35);
  assert.equal(tour.lesson().id, id); assert.equal(lab.garden.samples, 0);
  assert.equal(tour.done[id], 'confirmed');
  assert.equal(tour.next(), false); assert.equal(tour.lesson().id, id);
  g.workspace(); g.enter('>system'); g.seen(); assert.equal(tour.check().passed, true);
  assert.equal(tour.next(), true);
});

test('Scope-Gegenprobe verlangt tatsächlich die flache Suche', () => {
  const { tour, gestures: g } = app();
  tour.goTo(tour.lessons.findIndex((l) => l.id === 'sg_orientation_05'));
  g.workspace(); g.scope('currentpane'); g.filter('code'); g.type('Sample'); g.seen();
  assert.equal(tour.check().passed, false);
  g.scope('currentflat'); assert.equal(tour.check().passed, true);
});

test('Seitenneustart setzt Workflow am Anfang fort und erfindet keine Runtime-Werte', () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const first = app(storage);
  first.tour.goTo(first.tour.lessons.findIndex((l) => l.id === 'sg_state_07'));
  first.tour.done.sg_state_01 = 'confirmed'; first.tour.save();
  const next = app(storage); next.tour.load(); next.tour.prepare();
  assert.equal(next.tour.lesson().id, 'sg_state_01');
  assert.equal(next.tour.done.sg_state_01, 'confirmed');
  assert.equal(next.tour.next(), false);
  assert.equal(next.lab.garden.samples, 0); assert.equal(next.lab.garden.requests, 0);
  const before = JSON.stringify(next.lab.garden.caseValues());
  next.tour.snapshot(); next.tour.check();
  assert.equal(JSON.stringify(next.lab.garden.caseValues()), before);
});
