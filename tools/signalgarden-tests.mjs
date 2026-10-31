import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignalGarden } from '../js/core/signalgarden.js';
const fixture = JSON.parse(readFileSync(new URL('../data/signalgarden-scenarios.json', import.meta.url), 'utf8'));
const trace = [];
const model = () => new SignalGarden({ call(dat, name, fn) { trace.push({dat, name}); return fn(); } });
function same(actual, expected, path) {
  if (typeof expected === 'number') assert.ok(Math.abs(actual - expected) < 1e-7, `${path}: ${actual} != ${expected}`);
  else if (Array.isArray(expected)) { assert.equal(actual.length, expected.length); expected.forEach((v, i) => same(actual[i], v, `${path}[${i}]`)); }
  else assert.deepEqual(actual, expected, path);
}
for (const scenario of fixture.scenarios) {
  const g = model(); g.Prepare();
  for (const a of scenario.actions) {
    if (a.kind === 'set') g.pars[a.owner][a.name] = a.value;
    else if (a.kind === 'pulse') g.pulse(a.owner, a.name);
    else if (a.kind === 'cell') g.table.find((row) => row[0] === a.row)[g.table[0].indexOf(a.column)] = a.value;
    else if (a.kind === 'clear_palette') g.table = [];
    else throw new Error(`Unbekannte Aktion ${a.kind}`);
  }
  for (const [key, value] of Object.entries(scenario.expect)) same(g.Observe()[key], value, `${scenario.id}.${key}`);
}
const g = model(); g.Prepare(); g.pars.sensor.Value = 0.7; g.Submit(); g.Step();
const before = JSON.stringify(g.caseValues()), traceCount = trace.length;
g.Observe(); g.Observe(); assert.equal(JSON.stringify(g.caseValues()), before); assert.equal(trace.length, traceCount);
g.reinit('sensor'); assert.equal(g.pars.sensor.Value, 0.7); assert.equal(g.samples, 0); assert.equal(g.present, false);
g.reinit('scenes'); assert.deepEqual(g.rgb, [0, 0, 0]); assert.equal(g.pars.scenes.Brightness, 0.8);
g.resetScenes(); assert.deepEqual(g.rgb, [0.016, 0.032, 0.064]);
g.Submit(); g.FrameTick(1); assert.equal(g.mix, 0); g.pars.root.Auto = true; g.FrameTick(1); assert.equal(g.mix, 0.1);
g.pars.root.Enabled = false; g.FrameTick(1); assert.equal(g.mix, 0.1);
console.log(JSON.stringify({ scenarios: fixture.scenarios.length, observe: 'read-only', reinit: 'settings retained', auto: 'guards and dt cap passed' }));
