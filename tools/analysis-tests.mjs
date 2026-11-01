// Echte Pocket-Zustandsmaschine, kein TD-/iPhone-Laufzeitnachweis.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApp} from '../js/core/boot.js';
import {abs} from '../js/core/util.js';
import {collectEvidence, answerRequest, checkExplanation, previewChange} from '../js/core/investigation.js';
import {stateAtlas} from '../js/core/views/miscviews.js';
import {analysisPacket, analysisState, buildAnalysisBrief, rememberPacket} from '../js/core/analysis-workbench.js';
const load = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));
function app() {const a = createApp({course: load('course'), net: load('net'), code: load('code'), ui: load('ui')}); a.cs.OpenAt('map', {target: 'StateLab'}); a.cs.analysis(); return a;}
const request = (p, questions) => ({schema: 'codesearch.request.v2', id: 'r1', evidence_id: p.id, revision: p.revision, questions});

test('Gekürzter SignalGarden-Auftrag kann alle fehlenden State- und Symbol-IDs nachfordern', () => {
  const {cs} = app(); cs.OpenAt('map', {target: 'SignalGarden'}); cs.refreshAnalysis();
  const p = analysisPacket(cs), brief = buildAnalysisBrief(p, 'understand', '', 1000);
  for (const [kind, field] of [['states', 'id'], ['symbols', 'symbol']]) {
    let next = brief.continuation_requests.find((r) => r.questions[0].kind === kind);
    assert.ok(next, `${kind}: gültige Folgeanfrage muss mitgeliefert sein`);
    const found = [];
    while (next) {const a = answerRequest(p, next).answers[0]; found.push(...a.value.map((v) => v[field])); next = a.next_request;}
    const expected = kind === 'states' ? p.states.map((s) => s.id) : Object.keys(p.symbols);
    assert.deepEqual(new Set(found), new Set(expected));
    const q = kind === 'states' ? {kind: 'state', state_id: found.at(-1)} : {kind: 'symbol', symbol: found.at(-1)};
    assert.equal(answerRequest(p, request(p, [q])).answers[0].status, 'supported');
  }
});

test('Ziel, Frage und kopierbarer Auftrag besitzen gültigen vollständigen Vertrag', () => {
  const {cs} = app(); cs.command('>analyse fehler Warum zählt Fire doppelt?');
  const p = analysisPacket(cs), brief = cs.analysisBrief();
  assert.equal(cs.state.view, 'analysis'); assert.equal(brief.goal, 'debug'); assert.equal(brief.question, 'Warum zählt Fire doppelt?');
  assert.equal(brief.evidence_id, p.id); assert.deepEqual(brief.protocol.explanation.claims.writes, ['state_id', 'symbol']);
  assert.ok(cs.investigationSnapshot()['investigation.analysis_export_id']);
  assert.equal(cs.importAnalysis(JSON.stringify(brief.request)).status, 'ok');
  assert.equal(cs.importAnalysis(JSON.stringify(brief.explanation)).claims[0].status, 'supported');
});
test('Unveränderliches Paket A behält Runtime-Wert nach B und neuer Aufnahme', () => {
  const {cs, lab} = app(); const p = analysisPacket(cs), count = p.states.find((s) => s.name === 'StateLabExt._count');
  const old = count.value.value; lab.stateLab.Fire(); cs.refreshAnalysis();
  assert.notEqual(analysisPacket(cs).id, p.id); assert.equal(p.states.find((s) => s.id === count.id).value.value, old);
  assert.throws(() => {p.states[0].value = {};}, TypeError);
  const result = cs.importAnalysis(JSON.stringify(request(p, [{kind: 'state', state_id: count.id}])));
  assert.equal(result.evidence_id, p.id); assert.equal(result.answers[0].value.value.value, old);
});
test('Acht Pakete schützen aktiven Chat; evicted Paket wird nie durch neue Aufnahme ersetzt', () => {
  const {cs} = app(); const active = analysisPacket(cs);
  const disposable = rememberPacket(cs, collectEvidence(cs, stateAtlas(cs)));
  for (let i = 0; i < 12; i++) rememberPacket(cs, collectEvidence(cs, stateAtlas(cs)));
  assert.equal(analysisState(cs).packets.length, 8); assert.equal(analysisPacket(cs).id, active.id);
  const before = analysisState(cs).packets.map((p) => p.id);
  const out = cs.importAnalysis(JSON.stringify(request(disposable, [{kind: 'overview'}])));
  assert.equal(out.reason, 'evidence_unavailable'); assert.equal(out.status, 'stale');
  assert.deepEqual(analysisState(cs).packets.map((p) => p.id), before);
});
test('Falsche Paket-ID und manipulierte Revision werden stale; v1 bleibt ungebunden', () => {
  const {cs} = app(); const p = analysisPacket(cs);
  assert.equal(answerRequest(p, {...request(p, [{kind:'overview'}]), evidence_id:'different'}).status, 'stale');
  assert.equal(answerRequest(p, {...request(p, [{kind:'overview'}]), revision:'changed'}).status, 'stale');
  const legacy = request(p, [{kind:'overview'}]); delete legacy.evidence_id; legacy.schema = 'codesearch.request.v1';
  assert.equal(answerRequest(p, legacy).binding, 'legacy_unbound');
});
test('Negierter Kommentar bleibt ungeprüft, kanonische Relation bleibt dieselbe', () => {
  const {cs} = app(); const p = analysisPacket(cs), state = p.states.find((s) => s.name === 'StateLabExt._count'), site = state.writers[0];
  const claim = {id:'c1', kind:'writes', state_id: state.id, symbol: site.method};
  const results = ['Diese Methode schreibt.', 'Diese Methode schreibt niemals.'].map((commentary) => checkExplanation(p, {schema:'codesearch.explanation.v2', evidence_id:p.id, revision:p.revision, claims:[{...claim, commentary}]}).claims[0]);
  assert.equal(results[0].checked_statement, results[1].checked_statement);
  for (const result of results) {assert.equal(result.status,'supported'); assert.equal(result.commentary_checked,false); assert.equal(result.evidence_kind,'static_access');}
});
test('Gezielte Abfragen haben echte Ausschnitte, Richtung und Fortsetzung', () => {
  const {cs} = app(); const p = analysisPacket(cs), path = Object.keys(p.sources)[0], symbol = Object.keys(p.symbols)[0];
  assert.ok(symbol, 'eingebettete native Symbole vorhanden');
  const out = answerRequest(p, request(p, [{kind:'source_range',source:path,start_line:2,end_line:4},{kind:'symbol',symbol},{kind:'coverage',offset:0,limit:1}]));
  assert.equal(out.answers[0].value.text,p.sources[path].split('\n').slice(1,4).join('\n'));
  assert.equal(out.answers[1].status,'supported');
  assert.ok(out.answers[2].next_request); assert.equal(out.answers[2].next_request.evidence_id,p.id);
  const call = p.calls.find((c) => c.caller && c.callee);
  if (call) for (const direction of ['in','out']) {
    const symbol = direction === 'in' ? call.callee : call.caller;
    const found = answerRequest(p, request(p,[{kind:'calls',symbol,direction,limit:80}])).answers[0].value;
    assert.ok(found.every((c) => c[direction === 'in' ? 'callee' : 'caller'] === symbol));
  }
  assert.throws(() => answerRequest(p,request(p,[{kind:'coverage',limit:81}])));
  assert.throws(() => answerRequest(p,request(p,[{kind:'source_range',source:path,start_line:1,end_line:121}])));
});
test('Pocket-RECORD belegt ausschließlich simulierte Events und Aufnahmeherkunft', () => {
  const {cs, lab} = app(); cs.recordStart(); lab.stateLab.Fire(); cs.recordStop(); cs.refreshAnalysis();
  const p = analysisPacket(cs), event = p.events.find((e) => e.method === 'Fire'); assert.ok(event);
  const claim = checkExplanation(p,{schema:'codesearch.explanation.v2',evidence_id:p.id,revision:p.revision,claims:[{id:'call',kind:'called',symbol:event.symbol}]}).claims[0];
  assert.equal(claim.status,'supported'); assert.equal(claim.evidence_kind,'simulated_event');
  assert.ok(event.recording_id); assert.ok(event.recorded_source_hash); assert.equal(event.code_fingerprint,undefined);
});
test('Preview liefert Text-Diff, erhält Quellen und erklärt unprüfbare Syntax', () => {
  const {cs} = app(); const p = analysisPacket(cs), path = Object.keys(p.sources)[0], original = p.sources[path];
  const preview = previewChange(p,{schema:'codesearch.preview.v2',evidence_id:p.id,revision:p.revision,changes:{[path]:'raise RuntimeError("no execute")'}});
  assert.equal(preview.status,'unknown'); assert.match(preview.diffs[0].text,/raise RuntimeError/); assert.equal(p.sources[path],original); assert.equal(preview.runtimeVerified,false);
});
test('Import lehnt fremde Schemas und Code ab; Prüfung verändert Lab nicht', () => {
  const {cs, lab} = app(); const count = lab.stateLab.count;
  for (const text of ['print(1)', '{"schema":"execute","code":"danger"}', '{"schema":"codesearch.request.v2","schema":"execute"}']) assert.equal(cs.importAnalysis(text).ok,false);
  assert.equal(lab.stateLab.count,count); assert.ok(analysisState(cs).error);
});
test('Begrenzter Brief bleibt gültiges JSON und meldet Kürzung', () => {
  const {cs} = app(); const brief = buildAnalysisBrief(analysisPacket(cs),'understand','',1000);
  assert.ok(JSON.stringify(brief.context).length <= 1000); assert.equal(brief.coverage.context_truncated,true); assert.ok(JSON.parse(JSON.stringify(brief)).request);
  for (const goal of ['toString', '__proto__']) { assert.throws(() => buildAnalysisBrief(analysisPacket(cs),goal)); assert.throws(() => cs.analysis(goal)); assert.equal(cs.command('>analyse ' + goal).ok,false); }
});
test('Alte Fundstellen zeigen bei Source-Drift gespeicherten Ausschnitt vor heutiger Quelle', () => {
  const {cs} = app(); const p = analysisPacket(cs), path = Object.keys(p.sources)[0];
  const proposal = {schema:'codesearch.explanation.v2',evidence_id:p.id,revision:p.revision,claims:[{id:'q',kind:'source',source:path,line:1,text:p.sources[path].split('\n')[0]}]};
  cs.copy(JSON.stringify(proposal)); cs.command('>antwort');
  const hit = cs.state.hits.findIndex((h) => h.evidence?.length);
  const originalLines = cs.net.lines.bind(cs.net);
  cs.net.lines = () => ['# changed source'];
  cs.activate(hit);
  assert.match(cs.state.dialog.title,/GEÄNDERT/); assert.ok(cs.state.dialog.lines.includes(p.sources[path].split('\n').slice(0,3).join('\n')));
  assert.equal(cs.state.codeView.path,''); cs.net.lines = originalLines;
});
test('Ergebnis-Kopieren in alter Erklärung zeigt deren Ergebnis statt eines früheren Analyseimports', () => {
  const {cs} = app(); const p = analysisPacket(cs);
  cs.importAnalysis(JSON.stringify(request(p,[{kind:'overview'}])));
  cs.copy(JSON.stringify(buildAnalysisBrief(p).explanation)); cs.command('>antwort'); cs.copyAnalysisResult();
  const copied = JSON.parse(cs.clipboard); assert.ok(copied.claims.length); assert.equal(copied.claims[0].commentary_checked,false);
});
