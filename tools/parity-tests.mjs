// Gegenfälle zur Übungssimulation: JSON-Inhalt, Revision, Herkunft und isolierte Repro.
// Keine UI-/TouchDesigner-Prüfung. Aufruf: node --test tools/parity-tests.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createApp } from "../js/core/boot.js";
import { abs } from "../js/core/util.js";
import { revisionFor, parseProtocol, collectEvidence } from "../js/core/investigation.js";
import { stateAtlas } from "../js/core/views/miscviews.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), "utf8"));
function app() { const a = createApp({ course: load("course"), net: load("net"), code: load("code"), ui: load("ui") }); a.cs.OpenAt("map", { target: "StateLab" }); return a; }
function packet(cs) { return collectEvidence(cs, stateAtlas(cs)); }
function input(cs, obj, command) { cs.copy(typeof obj === "string" ? obj : JSON.stringify(obj)); return cs.command(command); }

test("Revision entspricht SHA256-Framing der nativen Implementation, auch Unicode", () => {
  for (const sources of [{}, { "/ä": "Hallo\n😀" }, { b: "zweite Quelle", a: "erste Quelle" }]) {
    const h = createHash("sha256");
    for (const path of Object.keys(sources).sort()) for (const part of [path, sources[path]]) {
      const bytes = Buffer.from(part, "utf8"), size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(bytes.length)); h.update(size).update(bytes);
    }
    assert.equal(revisionFor(sources), "sha256:" + h.digest("hex"));
  }
  assert.equal(revisionFor({ b: "B", a: "A" }), revisionFor({ a: "A", b: "B" }));
  assert.notEqual(revisionFor({ a: "A" }), revisionFor({ a: "a" }));
});

test("Parser lehnt doppelte, defekte, nicht endliche und übergroße Daten ab", () => {
  for (const bad of ['{"a":1,"a":2}', '{"a":{"x":1,"x":2}}', '{"n":1e999}', '[1,]', 'null trailing', '"codesearch.request.v1" garbage']) assert.throws(() => parseProtocol(bad));
  assert.throws(() => parseProtocol('"' + "ä".repeat(50000) + '"'));
  assert.equal(parseProtocol('{"quoted":"a, \\"not a key\\": 2"}').quoted, 'a, "not a key": 2');
});

test("USES zeigt keine Empfänger; USED BY zeigt sie und explizites Ziel wirkt", () => {
  const { cs } = app(); cs.OpenAt("trace", { target: "BranchLab/control" });
  assert(!cs.state.hits.some((h) => h.kind === "watcher" || h.detail === "OUT" || h.text === "ZIEL"));
  assert(!cs.state.hits.some((h) => h.kind === "flow" && h.text.includes("watch_control")));
  cs.command(">refs BranchLab/control"); assert.equal(cs.state.mode, "refs"); assert.equal(cs.state.focus, "BranchLab/control");
  assert(cs.state.hits.some((h) => h.path.endsWith("watch_control")));
  cs.command(">karte Farbmischer"); assert.equal(cs.state.focus, "Farbmischer"); assert.equal(cs.state.mode, "map");
  assert.equal(cs.command(">refs fehlt_sicher").ok, false); assert.equal(cs.state.focus, "Farbmischer");
});

test("Symbol-Referenzen bleiben in USED BY; tour/live/why sind erreichbar", () => {
  const { cs } = app(); cs.command(">refs ._count");
  assert.equal(cs.state.mode, "refs"); assert(cs.state.hits.some((h) => h.text.includes("Fire")));
  cs.command(">tour"); assert.equal(cs.state.mode, "tour");
  cs.command(">live"); assert.equal(cs.state.mode, "record");
  cs.command(">why"); assert.equal(cs.state.view, "why");
});

test("StateLab-Paket hat eindeutige IDs, aktuelle Werte und echte statische Stellen", () => {
  const { cs, lab } = app(); lab.stateLab.Fire(); const p = packet(cs);
  assert.equal(new Set(p.states.map((s) => s.id)).size, p.states.length);
  const count = p.states.find((s) => s.name === "StateLabExt._count"); assert.equal(count.value.value, 1);
  const fire = count.writers.find((s) => s.method.endsWith("StateLabExt.Fire"));
  assert(fire); assert(p.sources[fire.source].split("\n")[fire.line - 1].includes("self._count"));
  assert.equal(p.captured.origin, "pocket-simulation");
  const child = p.states.find((s) => s.owner.endsWith("/state_child")); assert(child.id.startsWith(child.owner + "|"));
  cs.OpenAt("map", { target: "Farbmischer" }); assert.equal(packet(cs).states.length, 0); assert(Object.keys(packet(cs).sources).length > 0);
});

test("Anfrage beantwortet die tatsächlichen Fragen und behält ihre ID", () => {
  const { cs } = app(); const p = packet(cs); const source = Object.keys(p.sources)[0];
  const req = { schema: "codesearch.request.v1", id: "meine-17", revision: p.revision, questions: [{ kind: "source", source }, { kind: "state", state_id: "fehlt" }] };
  assert.equal(input(cs, req, ">nachfrage").ok, true);
  assert.equal(cs.state.inv.request.id, "meine-17"); assert.equal(cs.state.inv.request.answers.length, 2);
  assert.equal(cs.state.inv.request.answers[0].value.text, p.sources[source]); assert.equal(cs.state.inv.request.answers[1].status, "unknown");
});

test("Ungültige Requests löschen alte Ergebnisse und behaupten keinen Erfolg", () => {
  const { cs } = app(); cs.command(">beispiel anfrage"); const valid = JSON.parse(cs.clipboard); cs.command(">nachfrage");
  for (const change of [{ ...valid, extra: true }, { ...valid, questions: [] }, { ...valid, questions: [{ kind: "state" }] }, { ...valid, questions: [{ kind: "overview", source: "x" }] }, { ...valid, schema: "wrong" }, '"codesearch.request.v1"']) {
    assert.equal(input(cs, change, ">nachfrage").ok, false); assert.equal(cs.state.inv.request, null); assert(cs.state.inv.error);
  }
});

test("Veraltete Revision gibt keine aktuelle Antwort aus", () => {
  const { cs } = app(); cs.command(">beispiel anfrage"); const req = JSON.parse(cs.clipboard); req.revision = "sha256:alt";
  input(cs, req, ">nachfrage"); assert.equal(cs.state.inv.request.status, "stale"); assert.deepEqual(cs.state.inv.request.answers, []);
});

test("Claims unterscheiden Beleg, Gegenbeleg, fehlenden Beleg und alte Revision", () => {
  const { cs } = app(); const p = packet(cs); const count = p.states.find((s) => s.name === "StateLabExt._count"); const fire = count.writers.find((s) => s.method.endsWith(".Fire"));
  const claims = [
    { id: "write", text: "Counter wird geschrieben", kind: "writes", state_id: count.id, symbol: fire.method },
    { id: "wrong-line", text: "def NichtDieZeile():", kind: "source", source: fire.source, line: fire.line },
    { id: "missing-call", text: "Fire wurde aufgenommen", kind: "called", symbol: fire.method },
  ];
  const explanation = { schema: "codesearch.explanation.v1", revision: p.revision, claims };
  input(cs, explanation, ">antwort"); assert.deepEqual(cs.state.inv.explanation.claims.map((c) => c.status), ["supported", "contradicted", "unknown"]);
  assert(cs.state.hits.some((h) => h.art === "WIDERSPROCHEN"));
  const index = cs.state.hits.findIndex((h) => h.evidence?.[0]?.line === fire.line); cs.activate(index); assert.equal(cs.state.viewer.line, fire.line);
  input(cs, { ...explanation, revision: "alt" }, ">antwort"); assert(cs.state.inv.explanation.claims.every((c) => c.status === "stale"));
  input(cs, { ...explanation, claims: [claims[0], claims[0]] }, ">antwort"); assert.equal(cs.state.inv.explanation, null);
});

test("called wird erst nach Pocket-RECORD supported, nicht durch statische Calls", () => {
  const { cs, lab } = app(); cs.recordStart(); lab.stateLab.Fire(); cs.recordStop(); const p = packet(cs);
  const event = p.events.find((e) => e.method === "Fire"); assert(event);
  input(cs, { schema: "codesearch.explanation.v1", revision: p.revision, claims: [{ id: "x", text: "Fire lief", kind: "called", symbol: event.symbol }] }, ">antwort");
  assert.equal(cs.state.inv.explanation.claims[0].status, "supported"); assert.match(cs.state.inv.explanation.claims[0].reason, /Pocket/);
});

test("Unvollständige Read-Funde widerlegen keine verschachtelten Writes oder Alias-Mutationen", () => {
  const { cs } = app(); delete cs.net.code["StateLab/StateLabExt"].state_atlas;
  const p = packet(cs); const source = abs("StateLab/StateLabExt");
  const cases = [
    ["StateLabExt._dependent", "Mutate", "self._dependent.val[0] += 1"],
    ["Gain", "UseExpression", "self.parGain.expr ="],
    ["StateLabExt._dependent", "Notify", "self._dependent.modified()"],
  ];
  for (const [name, method, needle] of cases) {
    const state = p.states.find((s) => s.name === name); assert(state);
    const line = p.sources[source].split("\n").findIndex((text) => text.includes(needle)) + 1; assert(line > 0);
    input(cs, { schema: "codesearch.explanation.v1", revision: p.revision, claims: [{ id: method, kind: "writes", text: `${method} verändert ${name}`, state_id: state.id, symbol: `${source}:StateLabExt.${method}`, source, line }] }, ">antwort");
    const claim = cs.state.inv.explanation.claims[0];
    assert.equal(claim.status, "unknown", `${name} / ${method}: fehlender Write ist kein Gegenbeleg`);
    assert.match(claim.reason, /begrenzten Modell|begrenzte Paket/);
  }
  // Aliase werden nicht einfach als Writer der Zielvariable erfunden: _shared und _alias
  // teilen aktuell ein Objekt, aber das CodeModel enthält keinen Write auf _alias in Mutate.
  const alias = p.states.find((s) => s.name === "StateLabExt._alias");
  const line = p.sources[source].split("\n").findIndex((text) => text.includes("self._shared[0] += 1")) + 1;
  input(cs, { schema: "codesearch.explanation.v1", revision: p.revision, claims: [{ id: "alias", kind: "writes", text: "Mutation über gemeinsam genutztes Objekt", state_id: alias.id, symbol: `${source}:StateLabExt.Mutate`, source, line }] }, ">antwort");
  assert.equal(cs.state.inv.explanation.claims[0].status, "unknown");
  assert(p.coverage.some((text) => /verschachtelte Mutationen/.test(text)));
});

test("Native StateAtlas-Fakten belegen Mutate und Par-Writes mit ihren tatsächlichen Einschränkungen", () => {
  const { cs } = app(); const source = abs("StateLab/StateLabExt"); const p = packet(cs);
  const native = cs.net.code["StateLab/StateLabExt"].state_atlas;
  assert(native, "Der reproduzierbare Build muss native StateAtlas-Fakten liefern");
  assert.equal(native.revision, revisionFor({ [source]: p.sources[source] }));
  for (const [name, method, needle, access] of [
    ["StateLabExt._dependent", "Mutate", "self._dependent.val[0] += 1", "mutate"],
    ["Gain", "UseExpression", "self.parGain.expr =", "write"],
    ["StateLabExt._dependent", "Notify", "self._dependent.modified()", "mutate"],
  ]) {
    const state = p.states.find((s) => s.name === name);
    const line = p.sources[source].split("\n").findIndex((text) => text.includes(needle)) + 1;
    input(cs, { schema: "codesearch.explanation.v1", revision: p.revision, claims: [{ id: method, kind: "writes", text: "Strukturierter Zugriff", state_id: state.id, symbol: `${source}:StateLabExt.${method}`, source, line }] }, ">antwort");
    const claim = cs.state.inv.explanation.claims[0]; assert.equal(claim.status, "supported"); assert.equal(claim.evidence[0].access, access);
    if (method === "Notify") assert.match(claim.reason, /Benachrichtigung; Wertwechsel nicht bewiesen/);
    if (method === "UseExpression") assert.equal(claim.evidence[0].confidence, "inferred");
  }
  const childStorage = p.states.find((s) => s.owner.endsWith("/state_child"));
  assert(childStorage.writers.some((site) => site.method.endsWith(".Prepare")), "Native Child-Storage-Zugriffe nicht durch Parent-Filter verlieren");
  const alias = p.states.find((s) => s.name === "StateLabExt._alias");
  input(cs, { schema: "codesearch.explanation.v1", revision: p.revision, claims: [{ id: "alias", kind: "writes", text: "Indirekte Aliaswirkung", state_id: alias.id, symbol: `${source}:StateLabExt.Mutate` }] }, ">antwort");
  assert.equal(cs.state.inv.explanation.claims[0].status, "unknown", "Nicht erfasste Aliaswirkung nicht als supported erfinden");
});

test("Native Fakten mit falscher Revision werden nicht als aktuelle Belege übernommen", () => {
  const { cs } = app(); const source = abs("StateLab/StateLabExt");
  cs.net.code["StateLab/StateLabExt"].state_atlas.revision = "sha256:veraltet";
  const p = packet(cs); const state = p.states.find((s) => s.name === "StateLabExt._dependent");
  const line = p.sources[source].split("\n").findIndex((text) => text.includes("self._dependent.val[0] += 1")) + 1;
  input(cs, { schema: "codesearch.explanation.v1", revision: p.revision, claims: [{ id: "mutate", kind: "writes", text: "Mutation", state_id: state.id, symbol: `${source}:StateLabExt.Mutate`, source, line }] }, ">antwort");
  assert.equal(cs.state.inv.explanation.claims[0].status, "unknown");
  assert(p.coverage.some((text) => /Fakten passen nicht zur Quelle/.test(text)));
  const count = p.states.find((s) => s.name === "StateLabExt._count");
  assert.deepEqual(count.writers, [], "Auch scheinbar einfache alte CodeModel-Writes bei Revisionsfehler nicht übernehmen");
  assert(!p.calls.some((call) => call.source === source), "Veraltete statische Calls nicht als aktuelle Fakten ausgeben");
});

test("Vorschau folgt Inhalt und Regel; unbekannte Syntax erhält keinen Erfolgsnachweis", () => {
  const { cs } = app(); cs.command(">beispiel vorschau"); const proposal = JSON.parse(cs.clipboard); const source = Object.keys(proposal.changes)[0]; const original = cs.net.op("StateLab/StateLabExt").text;
  input(cs, proposal, ">vorschau"); assert.equal(cs.state.inv.preview.violations.length, 1); assert.equal(cs.state.inv.preview.items[0].name, "self._count");
  assert.equal(cs.net.op("StateLab/StateLabExt").text, original);
  const other = { ...proposal, changes: { [source]: original + "\n    def Another(self):\n        self._different = 5\n" }, rules: {} };
  input(cs, other, ">vorschau"); assert.equal(cs.state.inv.preview.items[0].name, "self._different"); assert.equal(cs.state.inv.preview.violations.length, 0);
  input(cs, { ...proposal, changes: { [source]: "def broken(" } }, ">vorschau"); assert.equal(cs.state.inv.preview.status, "unknown"); assert.equal(cs.state.inv.preview.runtimeVerified, false);
  input(cs, { ...proposal, changes: { "foreign.py": "pass" } }, ">vorschau"); assert.equal(cs.state.inv.preview, null);
  input(cs, { ...proposal, revision: "alt" }, ">vorschau"); assert.equal(cs.state.inv.preview.status, "stale");
});

test("State-Beobachtung erfasst echte Zeitstichprobe, stoppt und begrenzt auf30", async () => {
  const { cs, lab } = app(); cs.command(">states beobachten");
  try {
    assert.equal(cs.state.inv.watchHistory.length, 1); lab.stateLab.Fire();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(cs.state.inv.watchHistory.length, 2);
    assert.equal(cs.state.inv.watchHistory[1].states.find((s) => s.name === "StateLabExt._count").value.value, 1);
    cs.command(">states stoppen"); cs.sampleStates(); assert.equal(cs.state.inv.watchHistory.length, 2);
    cs.command(">states verlauf"); assert(cs.state.hits.some((h) => h.text.includes("StateLabExt._count")));
    cs.command(">states beobachten"); for (let i = 0; i < 40; i++) cs.sampleStates(); assert.equal(cs.state.inv.watchHistory.length, 30); assert.equal(cs.state.inv.watching, false);
  } finally { cs.stopStateWatch(); }
});

test("Minimalfall verlangt eine Kopie, prüft deren eingefrorene Parameter und schont Original", () => {
  const { cs, lab } = app(); assert.equal(cs.command(">minimalfall prüfen").ok, false); assert.equal(cs.state.inv.repro, null);
  lab.stateLab.pars.Doublefire = true; lab.stateLab.Fire(); cs.command(">minimalfall");
  assert.equal(cs.state.inv.repro.verified, false); lab.stateLab.pars.Doublefire = false;
  cs.command(">minimalfall prüfen"); assert.equal(cs.state.inv.repro.verified, true); assert.equal(cs.state.inv.repro.observed.count, 2); assert.equal(lab.stateLab.count, 2);
  cs.command(">minimalfall"); lab.stateLab.pars.Doublefire = true; cs.command(">minimalfall prüfen"); assert.equal(cs.state.inv.repro.verified, false); assert.equal(cs.state.inv.repro.observed.count, 1);
  cs.OpenAt("map", { target: "Farbmischer" }); assert.equal(cs.command(">minimalfall").ok, false);
});
