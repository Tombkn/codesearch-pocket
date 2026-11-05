// Projekt-Ansichten (js/ui/project-*.js, Paket P2a-2) in jsdom auf synthetischen Projektmodellen (js/projects/model.js).
// Belegt DOM-Aufbau, Gesten-Mathematik, Fensterung, Hervorhebung und Darstellungs-Testvektoren aus Vertrag 14 - kein
// Layout- oder Touch-Nachweis fuer echte Browser (jsdom hat kein Layout; Groessen fallen auf feste Werte zurueck).
//
// Aufruf: node tools/projects-views-tests.mjs
// Testdaten sind synthetisch oder aus dem oeffentlichen Tutorial nachgebaut (Weichzeichner); keine privaten Quellen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { JSDOM } from "jsdom";

import { canonicalize, codepointLength, lineCount } from "../js/projects/c14n.js";
import { absPath, CONTENT_FIELDS, sortPackageLists, validate } from "../js/projects/schema.js";
import { verifyPackage } from "../js/projects/verify.js";
import { createModel } from "../js/projects/model.js";
import { createAnchor, resolveAnchor, validateAnchor } from "../js/projects/anchors.js";
import { renderCode, renderDetails, renderNetwork, renderNotes, renderUnderstand } from "../js/ui/project-views.js";
import * as netmath from "../js/ui/project-netmath.js";
import { HIGHLIGHT_CAP, lineStates, splitAtMatches, tokenizeLine } from "../js/ui/project-highlight.js";
import { parameterRows, valueText } from "../js/ui/project-details.js";
import { CODE_ROW_PX, MAX_DOM_LINES } from "../js/ui/project-code.js";
import * as pdom from "../js/ui/project-dom.js";

const {
  NET_ZOOM, UNKNOWN_BOX, clampZoom, ensureVisible, fitView, inAnchor, layoutNetwork, mirrorRect, outAnchor, panBy,
  pinchView, screenToWorld, zoomAt,
} = netmath;
const { displayText, splitMarked } = pdom;
// Erst mit der Nachbesserung vorhanden; als Namensraum-Zugriff, damit die neuen Tests auch gegen einen alten Stand
// laufen (und dort scheitern) statt schon beim Import abzubrechen.
const MAX_TICKS = netmath.MAX_TICKS ?? 64;
const { tickIndices } = netmath;

const ROOT = new URL("../", import.meta.url);
const PID = "psp_0a1b2c3d4e5f60718293a4b5c6d7e8f9";
const sha = (data) => createHash("sha256").update(data).digest("hex");

// ================================================================== Paketbauer (Form des Python-Exporters)

const CAPABILITIES = {
  positions: true, annotations: true, wires: true, compConnectors: "unverified-live", docks: true, customPars: true,
  builtinPars: "nondefault+mandatory", effectiveValues: false, codeText: true, tables: "cells-capped",
  analysis: "codemodel-ast-static", references: "captured+static", storage: false, channels: false, media: false,
};

function op(rel, opType, family, extra = {}) {
  const name = rel === "" ? extra.name : rel.split("/").pop();
  const parent = rel === "" ? null : rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
  const isCOMP = family === "COMP";
  return {
    rel, path: "", name, opType, family, parent, isCOMP, role: "op",
    node: { x: 0, y: 0, w: 130, h: 90 }, color: ["0.55", "0.55", "0.55"], comment: "", tags: [],
    flags: { bypass: false }, dock: null, children: isCOMP ? 0 : null, connectors: isCOMP ? { in: [], out: [] } : null,
    extensions: [], shortcuts: { parent: null, global: null }, internalShortcuts: [],
    ...extra,
  };
}

function ext(slot, object, name) {
  return { slot, object: { value: object }, name: { value: name }, promote: { value: true } };
}

function par(opRel, name, extra = {}) {
  return {
    op: opRel, name, label: name, page: "Common", custom: false, style: "Str", tuplet: name, vecIndex: 0,
    mode: "constant", value: { t: "str", v: "" }, help: null, storedConstant: null, expr: null, bindExpr: null,
    export: null, default: null, isDefault: false, readOnly: false, password: false, menu: null, range: null,
    effective: null, ...extra,
  };
}

function source(key, datType, text, extra = {}) {
  return {
    key, op: key, datType, language: "python", languageFrom: "par", roles: [], status: "exact", text, table: null,
    truncation: null, chars: codepointLength(text), lines: lineCount(text), sha256: sha(Buffer.from(text, "utf8")),
    duplicateOf: null, file: null, ...extra,
  };
}

function omittedSource(key, status) {
  return { ...source(key, "textDAT", ""), status, text: null, chars: null, lines: null, sha256: null };
}

function tableSource(key, table) {
  let chars = 0;
  for (const row of table) for (const cell of row) chars += codepointLength(cell);
  return { ...source(key, "tableDAT", ""), language: "table", text: null, table, chars, lines: table.length, sha256: sha(canonicalize(table)) };
}

function ann(parent, name, title, body, node, enclosed) {
  return { rel: parent ? `${parent}/${name}` : name, parent, name, mode: "annotate", title, body, node, color: null, enclosed };
}

function wire(from, fromIndex, to, toIndex, kind = "wire") {
  const end = (e) => (typeof e === "string" ? { op: e } : e);
  return { kind, from: end(from), fromIndex, to: end(to), toIndex };
}

function ref(fromOp, kind, text, target, { source: src = null, line = null, par: p = null, certainty = "static", code = null } = {}) {
  return { from: { op: fromOp, source: src, line, par: p }, kind, text, target, certainty, code };
}

function emptyAtlas() {
  return { states: [], calls: [], coverage: [], symbols: [], errors: [], revision: "" };
}

function baseDoc(root, rootName, projectName = "Ansichten") {
  return {
    format: "codesearch.pocket.snapshot", schemaVersion: 1, schemaMinor: 0, projectId: PID,
    revision: { id: "", contentHash: "", analysisHash: "", basedOnSeq: 0 },
    projectName, exportedAt: "2026-11-05T10:00:00Z",
    source: { tool: "CodeSearch", toolVersion: "1.11.0", exporterVersion: 1, tdBuild: "2025.33230", tdVersion: "099",
      os: "windows", projectFile: "Synthetisch.toe" },
    exportRoot: { path: root, opType: "baseCOMP", name: rootName, explicitScopes: [] },
    context: { selection: null, frozenAt: "2026-11-05T10:00:00Z", entry: "comp-menu" },
    capture: { startedAt: "2026-11-05T10:00:00Z", finishedAt: "2026-11-05T10:00:01Z", frames: 10, slices: 2,
      longFrames: { count: 0, maxMs: 0 }, retries: 0, consistency: "stable-2pass", signature: `sha256:${"c".repeat(64)}` },
    capabilities: { ...CAPABILITIES },
    operators: [], annotations: [], connections: [], codeSources: [], parameters: [], references: [], externalDependencies: [],
    analysis: { provenance: { engine: "CodeSearch CodeModel + StateAtlas", toolVersion: "1.11.0", static: true }, code: [] },
    warnings: [],
    report: {
      counts: {}, omissions: [], limits: {}, durationMs: 5,
      secrets: { rules: "cspocket-secrets-1", omittedSources: 0, omittedValues: 0, byRule: [], confirmedFalsePositives: 0 },
    },
    integrity: { algorithm: "sha256", canonicalization: "cspocket-c14n-1", value: "" },
  };
}

function countsOf(doc) {
  const sent = doc.codeSources.filter((s) => s.status === "exact" || s.status === "truncated");
  return {
    operators: doc.operators.length, comps: doc.operators.filter((o) => o.isCOMP).length, annotations: doc.annotations.length,
    connections: doc.connections.length, codeSources: doc.codeSources.length,
    codeChars: sent.reduce((n, s) => n + (Number.isInteger(s.chars) ? s.chars : 0), 0), parameters: doc.parameters.length,
    references: doc.references.length, external: doc.externalDependencies.length,
    duplicates: doc.codeSources.filter((s) => s.duplicateOf !== null).length,
  };
}

// Hashes wie Vertrag 4.2/5, unabhaengig mit node:crypto gerechnet.
function seal(doc) {
  sortPackageLists(doc);
  for (const o of doc.operators) o.path = absPath(doc.exportRoot.path, o.rel);
  doc.report.counts = countsOf(doc);
  const content = {};
  for (const key of CONTENT_FIELDS) content[key] = doc[key];
  doc.revision.contentHash = `sha256:${sha(canonicalize(content))}`;
  doc.revision.analysisHash = `sha256:${sha(canonicalize(doc.analysis.code))}`;
  doc.revision.id = `rev_${sha(`${doc.projectId}\n${doc.revision.contentHash}`).slice(0, 32)}`;
  const { integrity, ...rest } = doc;
  integrity.value = sha(canonicalize(rest));
  return doc;
}

function modelOf(doc) {
  seal(doc);
  const check = validate(doc);
  assert.ok(check.ok, `synthetisches Paket ungueltig: ${JSON.stringify(check.errors.slice(0, 6))}`);
  return createModel(doc);
}

// Referenzexport "Weichzeichner" (Vertrag 17), nachgebaut aus dem oeffentlichen Tutorial.
function weichzeichnerDoc() {
  const doc = baseDoc("/project1/CodeSearch_Tutorial/Weichzeichner", "Weichzeichner", "Weichzeichner");
  doc.operators = [
    op("", "baseCOMP", "COMP", { name: "Weichzeichner", node: { x: 2200, y: 3400, w: 200, h: 140 }, children: 3,
      connectors: { in: [{ index: 0, inOP: "in1" }], out: [{ index: 0, outOP: "out1" }] } }),
    op("in1", "inTOP", "TOP", { node: { x: 200, y: 0, w: 130, h: 90 } }),
    op("blur", "blurTOP", "TOP", { node: { x: 600, y: 0, w: 130, h: 90 } }),
    op("out1", "outTOP", "TOP", { node: { x: 1000, y: 0, w: 130, h: 90 } }),
  ];
  doc.annotations = [ann("", "karte_grenze", "COMP-GRENZE M-7 Weichzeichner", "Innen drei Ops.\nAussen mix und bild_null.",
    { x: 0, y: -200, w: 1400, h: 700 }, ["blur", "in1", "out1"])];
  doc.connections = [
    wire("in1", 0, "blur", 0), wire("blur", 0, "out1", 0),
    wire({ external: "/project1/CodeSearch_Tutorial/mix" }, 0, "", 0),
    wire("", 0, { external: "/project1/CodeSearch_Tutorial/bild_null" }, 0),
  ];
  doc.parameters = [
    par("", "Staerke", { label: "Stärke", page: "Weichzeichner", custom: true, style: "Float", value: { t: "float", v: "4.0" },
      default: { t: "float", v: "4.0" }, isDefault: true, help: "Stärke des Weichzeichners.",
      range: { min: "0.0", max: "1.0", clampMin: true, clampMax: false, normMin: "0.0", normMax: "20.0" } }),
    par("blur", "size", { label: "Size", page: "Blur", style: "Int", mode: "bind", value: { t: "unknown", reason: "mode-bind" },
      storedConstant: { t: "int", v: "7" }, bindExpr: "parent().par.Staerke" }),
    par("in1", "label", { mode: "expression", value: { t: "unknown", reason: "mode-expression" }, expr: "me.name",
      storedConstant: { t: "str", v: "" }, isDefault: true }),
    par("out1", "label", { mode: "expression", value: { t: "unknown", reason: "mode-expression" }, expr: "me.name",
      storedConstant: { t: "str", v: "" }, isDefault: true }),
    par("blur", "bypass", { style: "Toggle", value: { t: "bool", v: "0" } }),
    par("blur", "filtersize", { style: "Float", value: { t: "float", v: "1e-05" } }),
    par("blur", "secretpar", { value: { t: "str", v: null, omitted: "secret" } }),
    par("blur", "huge", { value: { t: "unknown", reason: "size" } }),
  ];
  doc.references = [ref("blur", "par-bind", "parent().par.Staerke", { op: "" }, { par: "size" })];
  doc.externalDependencies = [
    { path: "/project1/CodeSearch_Tutorial/bild_null", opType: "nullTOP", kinds: ["wire"], count: 1, included: false },
    { path: "/project1/CodeSearch_Tutorial/mix", opType: null, kinds: ["wire"], count: 1, included: false },
  ];
  return doc;
}

// Netz mit bekannten und unbekannten Positionen, Mehrfach-Anschluessen, COMP-Stecker und einem Kind-COMP, dessen
// Kinder TD hoeher zaehlt als exportiert.
function mixedDoc() {
  const doc = baseDoc("/project1/Mixed", "Mixed", "Gemischt");
  doc.operators = [
    op("", "baseCOMP", "COMP", { name: "Mixed", children: 10 }),
    op("a", "noiseTOP", "TOP", { node: { x: 0, y: 300, w: 130, h: 90 } }),
    op("b", "levelTOP", "TOP", { node: { x: 400, y: 300, w: 130, h: 90 } }),
    op("split", "fanCHOP", "CHOP", { node: { x: 0, y: 0, w: 130, h: 120 } }),
    op("m", "compositeTOP", "TOP", { node: { x: 800, y: 200, w: 130, h: 160 } }),
    op("ghost1", "nullTOP", "TOP", { node: { unknown: "not-readable" } }),
    op("ghost2", "nullTOP", "TOP", { node: { unknown: "not-readable" } }),
    op("sub", "baseCOMP", "COMP", { node: { x: 1200, y: 200, w: 130, h: 90 }, children: 5,
      connectors: { in: [{ index: 0, inOP: "sub/in1" }, { index: 1, inOP: null }], out: [] } }),
    op("sub/in1", "inTOP", "TOP", { node: { x: 0, y: 0, w: 130, h: 90 } }),
    op("comp1", "containerCOMP", "COMP", { node: { x: 0, y: -400, w: 130, h: 90 } }),
    op("comp2", "containerCOMP", "COMP", { node: { x: 400, y: -400, w: 130, h: 90 } }),
  ];
  doc.annotations = [ann("", "gruppe", "Quellen", "a und b", { x: -40, y: 260, w: 640, h: 200 }, ["a", "b"])];
  doc.connections = [
    wire("a", 0, "m", 0), wire("b", 0, "m", 1), wire("split", 1, "m", 2), wire("split", 0, "b", 0),
    wire("a", 0, "ghost1", 0), wire("ghost1", 0, "ghost2", 0), wire("m", 0, "sub", 0), wire("comp1", 0, "comp2", 0, "comp"),
  ];
  return doc;
}

const HOST_LINES = [
  '"""Synthetisches Modul fuer die Ansichtstests (keine echte Projektquelle)."""',
  "",
  "",
  "class Mixer:",
  "    def __init__(self, ownerComp):",
  "        self.ownerComp = ownerComp",
  "        self.level = 0",
  "",
  "    def Mix(self, value):",
  "        self.level = value",
  "        self._apply()",
  "        return self.level",
  "",
  "    def _apply(self):",
  "        op('target').par.opacity = self.level",
  "",
  "",
  "class Recorder:",
  "    def __init__(self, ownerComp):",
  "        self.ownerComp = ownerComp",
  "        self.count = 0",
  "",
  "    def Record(self):",
  "        self.count += 1",
  "        self._apply()",
  "",
  "    def _apply(self):",
  "        parent.Host.Mix(self.count)",
  "",
  "",
  "def helper(x):",
  "    outside = op('/project1/outside')",
  "    return op('engine').Run(x)",
];
const HOST_TEXT = `${HOST_LINES.join("\n")}\n`;
const ENGINE_TEXT = "class Engine:\n    def Run(self, x):\n        return x * 2\n";
const GLSL_LINES = [
  "// Pixel-Shader (synthetisch)",
  "uniform float uTime;",
  "/* Block-",
  "   Kommentar */",
  "out vec4 fragColor;",
  "void main() {",
  "    vec4 color = texture(sTD2DInputs[0], vUV.st);",
  "    fragColor = TDOutputSwizzle(color * 0.5);",
  "}",
];

function facts() {
  return { params: [], returns: [], effects: [], pulls: [], parReads: [], parWrites: [] };
}

function symbol(cls, name, line, end, params = []) {
  return { symbol: cls ? `${cls}.${name}` : `<module>.${name}`, class: cls, name, kind: cls ? "method" : "function", line, end,
    doc: "", decorators: [], params, facts: facts() };
}

function site(sym, line, attr, via, extra = {}) {
  return { symbol: sym, line, attr, type: "call", via, op: null, shortcut: null, name: null, text: null, dynamic: false, ...extra };
}

function hostEntry() {
  const mix = symbol("Mixer", "Mix", 9, 12, ["value"]);
  mix.facts.returns = ["Zahl"];
  return {
    classes: [
      { name: "Mixer", line: 4, end: 15, states: [{ name: "ownerComp", line: 6 }, { name: "level", line: 7 }] },
      { name: "Recorder", line: 18, end: 28, states: [{ name: "ownerComp", line: 20 }, { name: "count", line: 21 }] },
    ],
    symbols: [symbol("Mixer", "__init__", 5, 7, ["ownerComp"]), mix, symbol("Mixer", "_apply", 14, 15),
      symbol("Recorder", "__init__", 19, 21, ["ownerComp"]), symbol("Recorder", "Record", 23, 25), symbol("Recorder", "_apply", 27, 28),
      symbol(null, "helper", 31, 33, ["x"])],
    sites: [
      site("Mixer.Mix", 11, "_apply", "self"), site("Recorder.Record", 25, "_apply", "self"),
      site("Recorder._apply", 28, "Mix", "parentshortcut", { shortcut: "Host" }),
      site("<module>.helper", 33, "Run", "opof", { op: "engine" }),
    ],
    accesses: [
      { symbol: "Mixer.__init__", name: "level", how: "init", line: 7, conf: "sicher" },
      { symbol: "Mixer.Mix", name: "level", how: "write", line: 10, conf: "sicher" },
      { symbol: "Mixer.Mix", name: "level", how: "read", line: 12, conf: "sicher" },
      { symbol: "Mixer._apply", name: "level", how: "read", line: 15, conf: "sicher" },
      { symbol: "Recorder.Record", name: "count", how: "mutate", line: 24, conf: "sicher" },
    ],
    ast: [], stateAtlas: emptyAtlas(),
  };
}

function codeDoc({ hostText = HOST_TEXT, secretHost = false } = {}) {
  const doc = baseDoc("/project1/Host", "Host", "Host");
  doc.operators = [
    op("", "baseCOMP", "COMP", { name: "Host", children: 10, shortcuts: { parent: { value: "Host" }, global: null },
      extensions: [ext(0, "op('./HostExt').module.Mixer(me)", "Mixer")] }),
    op("HostExt", "textDAT", "DAT", { node: { x: 0, y: 200, w: 130, h: 90 } }),
    op("engine", "baseCOMP", "COMP", { node: { x: 400, y: 0, w: 130, h: 90 }, children: 1,
      extensions: [ext(0, "op('./EngineExt').module.Engine(me)", "Engine")] }),
    op("engine/EngineExt", "textDAT", "DAT"),
    op("target", "levelTOP", "TOP", { node: { x: 600, y: 0, w: 130, h: 90 } }),
    op("pixel", "glslTOP", "TOP", { node: { x: 800, y: 0, w: 130, h: 90 } }),
    op("pixel_code", "textDAT", "DAT", { node: { x: 800, y: 200, w: 130, h: 90 } }),
    op("lookup", "tableDAT", "DAT", { node: { x: 1000, y: 0, w: 130, h: 90 } }),
    op("secrets_dat", "textDAT", "DAT", { node: { x: 1200, y: 0, w: 130, h: 90 } }),
    op("broken", "textDAT", "DAT", { node: { x: 1400, y: 0, w: 130, h: 90 } }),
    op("parsefail", "textDAT", "DAT", { node: { x: 1600, y: 0, w: 130, h: 90 } }),
  ];
  doc.connections = [wire("engine", 0, "target", 0), wire("target", 0, "pixel", 0)];
  const host = secretHost ? omittedSource("HostExt", "omitted-secret")
    : source("HostExt", "textDAT", hostText, { roles: [{ comp: "", kind: "extension", slot: 0 }] });
  doc.codeSources = [
    host,
    source("engine/EngineExt", "textDAT", ENGINE_TEXT, { roles: [{ comp: "engine", kind: "extension", slot: 0 }] }),
    source("pixel_code", "textDAT", `${GLSL_LINES.join("\n")}\n`, { language: "glsl", roles: [{ kind: "glsl", owner: "pixel", par: "pixeldat" }] }),
    tableSource("lookup", [["key", "value"], ["alpha", "1"], ["opacity", "0.5"]]),
    omittedSource("secrets_dat", "omitted-secret"),
    source("broken", "textDAT", "x = 1\n"),
    source("parsefail", "textDAT", "def kaputt(:\n    pass\n"),
  ];
  doc.parameters = [
    par("", "Gain", { custom: true, style: "Float", page: "Host", value: { t: "float", v: "0.5" }, default: { t: "float", v: "1.0" } }),
    par("pixel", "pixeldat", { style: "DAT", value: { t: "op", v: "pixel_code" } }),
    par("target", "opacity", { style: "Float", value: { t: "float", v: "1e-05" } }),
  ];
  const code = (line, kind, text, target, codeInfo) => ref("HostExt", kind, text, target, { source: "HostExt", line, code: codeInfo });
  doc.references = secretHost ? [] : [
    code(15, "code-op", "op('target')", { op: "target" }, { art: "call", receiver: null, name: "target" }),
    code(28, "code-shortcut", "parent.Host", { op: "" }, { art: "short", receiver: "parent", name: "Host" }),
    code(32, "code-op", "op('/project1/outside')", { external: "/project1/outside" }, { art: "call", receiver: null, name: "/project1/outside" }),
    code(33, "code-op", "op('engine')", { op: "engine" }, { art: "call", receiver: null, name: "engine" }),
  ];
  doc.references.push(
    ref("", "ext-object", "op('./HostExt').module.Mixer(me)", { op: "HostExt" }, { par: "ext0object", certainty: "captured" }),
    ref("engine", "ext-object", "op('./EngineExt').module.Engine(me)", { op: "engine/EngineExt" }, { par: "ext0object", certainty: "captured" }),
    ref("pixel", "glsl", "pixel_code", { op: "pixel_code" }, { par: "pixeldat", certainty: "captured" }),
  );
  doc.externalDependencies = secretHost ? [] : [{ path: "/project1/outside", opType: null, kinds: ["code-op"], count: 1, included: false }];
  doc.analysis.code = [
    { source: "engine/EngineExt", entry: { classes: [{ name: "Engine", line: 1, end: 3, states: [] }],
      symbols: [symbol("Engine", "Run", 2, 3, ["x"])], sites: [], accesses: [], ast: [], stateAtlas: emptyAtlas() } },
    { source: "broken", entry: { classes: "kaputt" } },
    { source: "parsefail", entry: { error: "parse", sites: [] } },
  ];
  if (!secretHost) doc.analysis.code.push({ source: "HostExt", entry: hostEntry() });
  return doc;
}

// Darstellungs-Testvektoren aus Vertrag 14 in Namen, Kommentaren, Tags, Annotationen, Werten, Code und Verweisen.
const VECTORS = ["<img src=x onerror=alert(1)>", "\"><svg onload=alert(1)>", "' onmouseover='alert(1)", "javascript:alert(1)",
  "\u202Egnp.exe", "a\u200Bb\u200Dc\uFEFFd"];
const LONG_LINE = `# ${VECTORS[0]} ${"a".repeat(1000000)}`;

function xssDoc() {
  const doc = baseDoc("/project1/Xss", "Xss", "Vektoren");
  doc.operators = [op("", "baseCOMP", "COMP", { name: "Xss", children: VECTORS.length + 2,
    extensions: [ext(0, VECTORS[1], VECTORS[2])], shortcuts: { parent: { value: VECTORS[3] }, global: null } })];
  VECTORS.forEach((v, i) => {
    doc.operators.push(op(v, "textDAT", "DAT", { node: { x: i * 200, y: 0, w: 130, h: 90 }, comment: VECTORS[(i + 1) % VECTORS.length],
      tags: [VECTORS[(i + 2) % VECTORS.length]] }));
  });
  doc.operators.push(op("long", "textDAT", "DAT", { node: { x: 0, y: -300, w: 130, h: 90 } }));
  doc.operators.push(op("sub", "baseCOMP", "COMP", { node: { unknown: VECTORS[0].length ? "not-readable" : "x" }, children: 0 }));
  doc.annotations = [ann("", "notiz", VECTORS[0], VECTORS.join("\n"), { x: -100, y: -100, w: 1500, h: 400 }, [VECTORS[0], VECTORS[1]].sort())];
  // Externe Enden und externalDependencies.path sind absolute Pfade (Vertrag 4.9/4.13): Vektor hinter "/".
  doc.connections = [wire(VECTORS[0], 0, VECTORS[1], 0), wire({ external: `/${VECTORS[2]}` }, 0, "", 0)];
  const codeText = `${VECTORS.map((v) => `x = "${v}"  # ${v}`).join("\n")}\n${LONG_LINE}\n`;
  doc.codeSources = [source(VECTORS[0], "textDAT", codeText), source("long", "textDAT", `${LONG_LINE}\n`)];
  doc.parameters = VECTORS.map((v, i) => par(VECTORS[i], "Text", { custom: true, label: v, help: v, value: { t: "str", v },
    default: { t: "str", v }, menu: { names: [v], labels: [v] } }));
  doc.parameters.push(par(VECTORS[1], "Expr", { custom: true, mode: "expression", value: { t: "unknown", reason: "mode-expression" },
    expr: VECTORS[0], storedConstant: { t: "str", v: VECTORS[2] }, default: { t: "str", v: "" } }));
  doc.references = [ref(VECTORS[0], "code-op", VECTORS[3], { op: VECTORS[1] }, { source: VECTORS[0], line: 1, code: { art: "call", receiver: null, name: VECTORS[1] } }),
    ref(VECTORS[2], "par-expr", VECTORS[0], { external: `/${VECTORS[4]}` }, { par: "Text" })];
  doc.externalDependencies = [{ path: `/${VECTORS[2]}`, opType: null, kinds: ["wire"], count: 1, included: false },
    { path: `/${VECTORS[4]}`, opType: null, kinds: ["par-expr"], count: 1, included: false }];
  doc.externalDependencies.sort((a, b) => (a.path < b.path ? -1 : 1));
  doc.analysis.code = [{ source: VECTORS[0], entry: { classes: [{ name: VECTORS[3].replace(/\W/g, "_"), line: 1, end: 2, states: [] }],
    symbols: [{ ...symbol(null, "f", 1, 2), name: VECTORS[2], symbol: `<module>.${VECTORS[2]}`, doc: VECTORS[0], decorators: [VECTORS[1]], params: [VECTORS[4]] }],
    sites: [], accesses: [], ast: [], stateAtlas: emptyAtlas() } }];
  return doc;
}

function protoDoc() {
  const doc = baseDoc("/project1/proto", "proto", "Namen");
  const text = "class toString:\n    def constructor(self):\n        return self.__proto__()\n\n    def __proto__(self):\n        return 1\n";
  doc.operators = [
    op("", "baseCOMP", "COMP", { name: "proto", children: 4 }),
    op("constructor", "baseCOMP", "COMP", { node: { x: 0, y: 0, w: 130, h: 90 }, children: 1 }),
    op("constructor/toString", "textDAT", "DAT"),
    op("hasOwnProperty", "nullTOP", "TOP", { node: { x: 200, y: 0, w: 130, h: 90 } }),
    op("__proto__", "nullTOP", "TOP", { node: { x: 400, y: 0, w: 130, h: 90 } }),
    op("toString", "nullTOP", "TOP", { node: { x: 600, y: 0, w: 130, h: 90 } }),
  ];
  doc.connections = [wire("__proto__", 0, "toString", 0), wire("hasOwnProperty", 0, "__proto__", 0)];
  doc.codeSources = [source("constructor/toString", "textDAT", text)];
  doc.parameters = [par("__proto__", "constructor", { value: { t: "str", v: "__proto__" } }), par("toString", "__proto__")];
  doc.analysis.code = [{ source: "constructor/toString", entry: {
    classes: [{ name: "toString", line: 1, end: 6, states: [] }],
    symbols: [symbol("toString", "constructor", 2, 3), symbol("toString", "__proto__", 5, 6)],
    sites: [site("toString.constructor", 3, "__proto__", "self")], accesses: [], ast: [], stateAtlas: emptyAtlas(),
  } }];
  return doc;
}

function bigDoc(lines) {
  const doc = baseDoc("/project1/Big", "Big", "Gross");
  const out = ["class Big:", "    def __init__(self):", "        self.n = 0"];
  while (out.length < lines) out.push(`        self.n += ${out.length}  # Zeile ${out.length + 1} 'q'`);
  const text = out.join("\n");
  doc.operators = [op("", "baseCOMP", "COMP", { name: "Big", children: 1 }), op("big", "textDAT", "DAT")];
  doc.codeSources = [source("big", "textDAT", text)];
  return { doc, lines: out };
}

function perfDoc(count) {
  const doc = baseDoc("/project1/Perf", "Perf", "Leistung");
  doc.operators = [op("", "baseCOMP", "COMP", { name: "Perf", children: count })];
  for (let i = 0; i < count; i += 1) {
    doc.operators.push(op(`op${String(i).padStart(3, "0")}`, "levelTOP", "TOP", { node: { x: (i % 20) * 200, y: -Math.floor(i / 20) * 160, w: 130, h: 90 } }));
  }
  for (let i = 1; i < count; i += 1) doc.connections.push(wire(`op${String(i - 1).padStart(3, "0")}`, 0, `op${String(i).padStart(3, "0")}`, 0));
  doc.annotations = [0, 1, 2, 3].map((k) => ann("", `zone${k}`, `Zone ${k}`, "Bereich", { x: k * 1000 - 50, y: -1600, w: 950, h: 1750 }, []));
  return doc;
}

// ================================================================== DOM-Helfer

function freshDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id=host></div></body></html>", { url: "https://pocket.test/" });
  const { window } = dom;
  return { window, doc: window.document, host: window.document.getElementById("host") };
}

function recorder(names = ["selectOp", "enterComp", "goParent", "openDetails", "openCode", "openSource", "setView", "addNote",
  "copyText", "openUnderstand", "deleteNote"]) {
  const calls = [];
  const actions = {};
  for (const name of names) actions[name] = (...args) => calls.push([name, ...args]);
  return { actions, calls, last: (name) => [...calls].reverse().find((c) => c[0] === name) || null, of: (name) => calls.filter((c) => c[0] === name) };
}

function pointer(window, target, type, { id = 1, x = 0, y = 0 } = {}) {
  target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, clientX: x, clientY: y,
    pointerType: "touch", isPrimary: id === 1, button: 0 }));
}

function tapOn(window, node, { id = 1 } = {}) {
  pointer(window, node, "pointerdown", { id, x: 10, y: 10 });
  pointer(window, node, "pointerup", { id, x: 10, y: 10 });
}

function opNode(host, name) {
  return [...host.querySelectorAll("g.pv-op")].find((g) => g.getAttribute("aria-label").startsWith(`${displayText(name, 160)},`)) || null;
}

function buttonByText(host, text) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === text) || null;
}

function srcLines(host) {
  return [...host.querySelectorAll(".pv-code-win .pv-ln")];
}

// ================================================================== Netz-Mathematik

test("Netz: Positionen gespiegelt (Y nach oben -> SVG nach unten), Annotation exakt", () => {
  assert.deepEqual(mirrorRect({ x: 200, y: 0, w: 130, h: 90 }), { x: 200, y: -90, w: 130, h: 90 });
  const model = modelOf(weichzeichnerDoc());
  const lay = layoutNetwork(model.network(""), { lookup: (r) => model.op(r), absOf: (r) => model.abs(r) });
  const byRel = lay.byRel;
  assert.deepEqual(["in1", "blur", "out1"].map((r) => [byRel.get(r).x, byRel.get(r).y, byRel.get(r).w, byRel.get(r).h]),
    [[200, -90, 130, 90], [600, -90, 130, 90], [1000, -90, 130, 90]]);
  assert.deepEqual([lay.annotations[0].x, lay.annotations[0].y, lay.annotations[0].w, lay.annotations[0].h], [0, -500, 1400, 700]);
  // Ein hoeher liegender Op (groesseres TD-y) landet in SVG weiter oben (kleineres y).
  const mixed = modelOf(mixedDoc());
  const lay2 = layoutNetwork(mixed.network(""), { lookup: (r) => mixed.op(r) });
  assert.ok(lay2.byRel.get("a").y < lay2.byRel.get("split").y);
  const wire0 = lay.wires.find((w) => w.fromRel === "in1");
  assert.deepEqual([wire0.x1, wire0.y1, wire0.x2, wire0.y2], [330, -45, 600, -45]);
});

test("Netz: Ops ohne Position stehen in einer beschrifteten Reihe darunter, ihre Leitungen gestrichelt", () => {
  const model = modelOf(mixedDoc());
  const lay = layoutNetwork(model.network(""), { lookup: (r) => model.op(r) });
  const ghosts = lay.ops.filter((o) => !o.known);
  assert.deepEqual(ghosts.map((o) => o.rel).sort(), ["ghost1", "ghost2"]);
  assert.ok(lay.unknownRow && lay.unknownRow.count === 2);
  for (const g of ghosts) {
    assert.equal(g.reason, "not-readable");
    assert.ok(g.y >= lay.knownBounds.maxY + UNKNOWN_BOX.rowGap - 1, "Reihe liegt unter allem Bekannten");
  }
  // Bekannte Ops behalten genau ihre exportierte Lage.
  for (const o of lay.ops.filter((x) => x.known)) assert.deepEqual([o.x, o.y, o.w, o.h], Object.values(mirrorRect(model.op(o.rel).node)));
  const dashed = lay.wires.filter((w) => w.dashed).map((w) => `${w.fromRel}>${w.toRel}`).sort();
  assert.deepEqual(dashed, ["a>ghost1", "ghost1>ghost2"]);
  assert.ok(lay.wires.filter((w) => !w.dashed).length >= 5);
});

test("Netz: Leitungsenden mit Versatz je Anschlussindex, COMP-Stecker zaehlen mit", () => {
  const model = modelOf(mixedDoc());
  const lay = layoutNetwork(model.network(""), { lookup: (r) => model.op(r) });
  const m = lay.byRel.get("m");
  assert.equal(m.nIn, 3);
  const ends = lay.wires.filter((w) => w.toRel === "m").sort((a, b) => a.toIndex - b.toIndex).map((w) => w.y2);
  assert.deepEqual(ends, [1, 2, 3].map((i) => m.y + (m.h * i) / 4));
  const split = lay.byRel.get("split");
  assert.equal(split.nOut, 2);
  const starts = lay.wires.filter((w) => w.fromRel === "split").sort((a, b) => a.fromIndex - b.fromIndex).map((w) => w.y1);
  assert.deepEqual(starts, [split.y + split.h / 3, split.y + (2 * split.h) / 3]);
  // sub hat zwei In-Stecker (connectors), aber nur Eingang 0 ist verdrahtet: trotzdem Platz fuer beide.
  const sub = lay.byRel.get("sub");
  assert.equal(sub.nIn, 2);
  assert.equal(inAnchor(sub, 0).y, sub.y + sub.h / 3);
  assert.equal(outAnchor(sub, 0).x, sub.x + sub.w);
  const comp = lay.wires.find((w) => w.kind === "comp");
  assert.ok(comp && comp.d.startsWith("M"), "kind comp wird wie eine Leitung gezeichnet");
});

test("Netz: externe Enden werden Platzhalter 'extern: <pfad>' ausserhalb des Inhalts, Kopplung an In/Out-OP", () => {
  const model = modelOf(weichzeichnerDoc());
  const lay = layoutNetwork(model.network(""), { lookup: (r) => model.op(r), absOf: (r) => model.abs(r) });
  assert.deepEqual(lay.placeholders.map((p) => [p.side, p.index, p.label]).sort(), [
    ["in", 0, "extern: /project1/CodeSearch_Tutorial/mix"], ["out", 0, "extern: /project1/CodeSearch_Tutorial/bild_null"]]);
  const inPh = lay.placeholders.find((p) => p.side === "in");
  const outPh = lay.placeholders.find((p) => p.side === "out");
  assert.ok(inPh.x + inPh.w < lay.annotations[0].x, "Eingangs-Platzhalter links vom Inhalt");
  assert.ok(outPh.x > lay.annotations[0].x + lay.annotations[0].w, "Ausgangs-Platzhalter rechts vom Inhalt");
  assert.deepEqual(lay.couplings.map((k) => [k.side, k.opRel]).sort(), [["in", "in1"], ["out", "out1"]]);
  // Ende auf der Parent-Ebene (Kind-COMP): kein "extern", aber ebenso nur Platzhalter.
  const mixed = modelOf(mixedDoc());
  const sub = layoutNetwork(mixed.network("sub"), { lookup: (r) => mixed.op(r), absOf: (r) => mixed.abs(r) });
  assert.deepEqual(sub.placeholders.map((p) => p.label), ["außerhalb: /project1/Mixed/m"]);
  assert.equal(sub.couplings[0].opRel, "sub/in1");
});

test("Netz-Mathematik: Einpassen, Zoom um einen Punkt, Pinch, Verschieben, Grenzen", () => {
  const fit = fitView({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 300, 200);
  assert.deepEqual(fit, { zoom: 1.5, panX: 75, panY: 62.5 });
  const big = fitView({ minX: -1000, minY: -500, maxX: 3000, maxY: 1500 }, 400, 300);
  assert.ok(Math.abs(big.zoom - Math.min(352 / 4000, 252 / 2000)) < 1e-9);
  const view = { zoom: 1, panX: 10, panY: 20 };
  const z = zoomAt(view, 2, 110, 220);
  assert.deepEqual(z, { zoom: 2, panX: -90, panY: -180 });
  assert.deepEqual(screenToWorld(z, 110, 220), screenToWorld(view, 110, 220), "Punkt unter dem Finger bleibt stehen");
  const p = pinchView({ zoom: 1, panX: 0, panY: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 50, y: 100 }, { x: 250, y: 100 });
  assert.deepEqual(p, { zoom: 2, panX: -150, panY: -100 });
  const moved = pinchView({ zoom: 1, panX: 0, panY: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 130, y: 140 }, { x: 230, y: 140 });
  assert.deepEqual(moved, { zoom: 1, panX: 30, panY: 40 }, "zwei Finger gleich weit verschoben = nur Verschieben");
  assert.equal(pinchView({ zoom: 7, panX: 0, panY: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }).zoom, NET_ZOOM.max);
  assert.equal(clampZoom(0), NET_ZOOM.min);
  assert.equal(clampZoom(Number.NaN), 1);
  assert.deepEqual(panBy(view, 5, -5), { zoom: 1, panX: 15, panY: 15 });
  const vis = ensureVisible({ zoom: 1, panX: 0, panY: 0 }, { x: 500, y: 10, w: 100, h: 50 }, 300, 200);
  assert.ok(vis.panX + 600 <= 300 && vis.panX + 500 >= 0, "Op nach Tastaturfokus im Bild");
});

// ================================================================== Netz-DOM

test("Netz-DOM: Weichzeichner mit Ops, Leitungen, Annotation und nicht navigierbaren Platzhaltern", async () => {
  const { window, host } = freshDom();
  const model = modelOf(weichzeichnerDoc());
  const rec = recorder();
  const view = renderNetwork(host, model, { comp: "", selected: null }, rec.actions);
  const lay = layoutNetwork(model.network(""), { lookup: (r) => model.op(r), absOf: (r) => model.abs(r) });
  assert.equal(host.querySelectorAll("g.pv-op").length, 3);
  for (const rel of ["in1", "blur", "out1"]) {
    const g = opNode(host, rel);
    assert.ok(g, rel);
    assert.equal(g.getAttribute("tabindex"), "0");
    const rect = g.querySelector("rect.pv-box");
    const o = lay.byRel.get(rel);
    assert.deepEqual(["x", "y", "width", "height"].map((a) => Number(rect.getAttribute(a))), [o.x, o.y, o.w, o.h]);
  }
  assert.equal(host.querySelectorAll("path.pv-wire").length, 2);
  assert.equal(host.querySelectorAll("path.pv-couple").length, 2);
  const phs = [...host.querySelectorAll("g.pv-ph")];
  assert.deepEqual(phs.map((g) => g.querySelector("title").textContent).sort(),
    ["extern: /project1/CodeSearch_Tutorial/bild_null", "extern: /project1/CodeSearch_Tutorial/mix"]);
  for (const g of phs) assert.equal(g.hasAttribute("tabindex"), false, "Platzhalter nicht fokussierbar");
  // Antippen eines Platzhalters waehlt nichts aus und navigiert nicht.
  tapOn(window, phs[0]);
  assert.equal(rec.calls.filter((c) => ["selectOp", "enterComp", "openDetails"].includes(c[0]) && c[1] !== null).length, 0);
  assert.equal(host.querySelector("text.pv-ann-title").textContent, "COMP-GRENZE M-7 Weichzeichner");
  assert.match(host.querySelector("g.pv-net-world").getAttribute("transform"), /^translate\(/);
  await Promise.resolve();
  const fit = rec.last("setView");
  assert.ok(fit && Number.isFinite(fit[1].zoom) && Number.isFinite(fit[1].panX), "Einpassen wird der Huelle gemeldet");
  view.destroy();
  assert.equal(host.childNodes.length, 0);
});

test("Netz-DOM: Antippen waehlt aus und hebt Verbindungen hervor, doppelt betritt COMP, Knoepfe und Tastatur", () => {
  const { window, host } = freshDom();
  const model = modelOf(mixedDoc());
  const rec = recorder();
  const view = renderNetwork(host, model, { comp: "", selected: null, zoom: 1, panX: 0, panY: 0 }, rec.actions);
  const m = opNode(host, "m");
  tapOn(window, m);
  assert.deepEqual(rec.last("selectOp"), ["selectOp", "m"]);
  assert.ok(m.classList.contains("pv-sel"));
  assert.equal(m.getAttribute("aria-pressed"), "true");
  assert.equal(host.querySelectorAll("path.pv-wire.pv-hot").length, 4, "drei Eingaenge und ein Ausgang von m");
  for (const rel of ["a", "b", "split", "sub"]) assert.ok(opNode(host, rel).classList.contains("pv-linked"), rel);
  assert.equal(buttonByText(host, "Betreten").disabled, true, "m ist kein COMP");
  buttonByText(host, "Details").click();
  assert.deepEqual(rec.last("openDetails"), ["openDetails", "m"]);
  const sub = opNode(host, "sub");
  tapOn(window, sub);
  tapOn(window, sub);
  assert.deepEqual(rec.last("enterComp"), ["enterComp", "sub"], "Doppeltippen betritt den COMP");
  assert.equal(buttonByText(host, "↑ Parent").disabled, true, "Root hat keinen Parent");
  // Tastatur: Enter waehlt, Enter auf dem Gewaehlten aktiviert (kein COMP -> Details).
  const a = opNode(host, "a");
  a.focus();
  a.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.deepEqual(rec.last("selectOp"), ["selectOp", "a"]);
  a.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.deepEqual(rec.last("openDetails"), ["openDetails", "a"]);
  // Huelle wechselt den COMP: nur dessen Kinder werden gebaut, Parent-Knopf geht.
  view.update({ comp: "sub", selected: null, zoom: null, panX: null, panY: null });
  assert.equal(host.querySelectorAll("g.pv-op").length, 1);
  assert.ok(host.textContent.includes("4 Kinder nicht exportiert"));
  buttonByText(host, "↑ Parent").click();
  assert.deepEqual(rec.last("goParent"), ["goParent"]);
  view.update({ comp: "sub", selected: "sub/in1", zoom: 1, panX: 0, panY: 0 });
  assert.ok(opNode(host, "in1").classList.contains("pv-sel"));
  view.destroy();
});

test("Netz-DOM: Pan mit einem Zeiger, Pinch mit zwei Zeigern, Meldung erst am Gestenende", () => {
  const { window, host } = freshDom();
  const model = modelOf(mixedDoc());
  const rec = recorder();
  const view = renderNetwork(host, model, { comp: "", selected: null, zoom: 1, panX: 0, panY: 0 }, rec.actions);
  const surface = host.querySelector(".pv-net-surface");
  const svg = host.querySelector("svg");
  const world = host.querySelector("g.pv-net-world");
  pointer(window, svg, "pointerdown", { id: 1, x: 100, y: 100 });
  pointer(window, svg, "pointermove", { id: 1, x: 150, y: 130 });
  assert.equal(world.getAttribute("transform"), "translate(50 30) scale(1)");
  assert.equal(rec.of("setView").length, 0, "waehrend der Geste keine Meldung");
  pointer(window, svg, "pointerup", { id: 1, x: 150, y: 130 });
  assert.deepEqual(rec.last("setView"), ["setView", { zoom: 1, panX: 50, panY: 30 }]);
  assert.equal(rec.of("selectOp").length, 0, "Verschieben ist kein Antippen");
  pointer(window, svg, "pointerdown", { id: 1, x: 100, y: 100 });
  pointer(window, svg, "pointerdown", { id: 2, x: 200, y: 100 });
  pointer(window, svg, "pointermove", { id: 1, x: 50, y: 100 });
  pointer(window, svg, "pointermove", { id: 2, x: 250, y: 100 });
  const pinched = pinchView({ zoom: 1, panX: 50, panY: 30 }, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 50, y: 100 }, { x: 250, y: 100 });
  pointer(window, svg, "pointerup", { id: 2, x: 250, y: 100 });
  assert.deepEqual(rec.last("setView"), ["setView", pinched]);
  assert.equal(pinched.zoom, 2);
  pointer(window, svg, "pointerup", { id: 1, x: 50, y: 100 });
  assert.equal(surface.style.touchAction, "", "touch-action kommt aus dem CSS-Block, nicht aus Inline-Stil");
  // Ein spaetes Echo der Huelle mit dem gemeldeten Stand aendert nichts.
  view.update({ comp: "", selected: null, ...pinched });
  assert.match(world.getAttribute("transform"), /scale\(2\)/);
  view.destroy();
});

// ================================================================== Code Reader

test("Code: 35 000 Zeilen, hoechstens 2 000 Zeilen im DOM, Fenster folgt dem Scrollen, Sprung bringt Zeile in Sicht", () => {
  const { window, host } = freshDom();
  const { doc, lines } = bigDoc(35000);
  const model = modelOf(doc);
  const rec = recorder();
  const t0 = performance.now();
  const view = renderCode(host, model, { source: "big", line: null, scrollTop: null, find: "" }, rec.actions);
  const openMs = performance.now() - t0;
  const sizer = host.querySelector(".pv-code-sizer");
  assert.equal(sizer.style.height, `${35000 * CODE_ROW_PX}px`);
  let rows = srcLines(host);
  assert.ok(rows.length > 0 && rows.length <= MAX_DOM_LINES, `${rows.length} Zeilen im DOM`);
  assert.equal(rows[0].getAttribute("data-line"), "1");
  const scroller = host.querySelector(".pv-code-scroll");
  scroller.scrollTop = 34990 * CODE_ROW_PX;
  scroller.dispatchEvent(new window.Event("scroll"));
  rows = srcLines(host);
  assert.ok(rows.length <= MAX_DOM_LINES);
  assert.ok(rows.some((r) => r.getAttribute("data-line") === "35000"), "letzte Zeile gerendert");
  assert.equal(rows.at(-1).querySelector(".pv-src").textContent, lines[34999]);
  view.update({ source: "big", line: 30000, scrollTop: null, find: "" });
  const focus = host.querySelector(".pv-ln.pv-focus");
  assert.equal(focus.getAttribute("data-line"), "30000");
  assert.equal(scroller.scrollTop, 29999 * CODE_ROW_PX - 600 / 3);
  assert.ok(srcLines(host).length <= MAX_DOM_LINES);
  // Weggescrollt, dann dieselbe Zeile erneut angesprungen (Huelle schickt scrollTop 0 mit): Zeile kommt wieder in Sicht.
  scroller.scrollTop = 0;
  scroller.dispatchEvent(new window.Event("scroll"));
  view.update({ source: "big", line: 30000, scrollTop: 0, find: "" });
  assert.equal(scroller.scrollTop, 29999 * CODE_ROW_PX - 600 / 3);
  assert.ok(srcLines(host).some((r) => r.getAttribute("data-line") === "30000" && r.classList.contains("pv-focus")));
  // Wiederherstellen einer Lesestelle ohne Sprung: Fokuszeile liegt dort im Bild.
  view.update({ source: "big", line: 30000, scrollTop: 29990 * CODE_ROW_PX, find: "" });
  assert.equal(scroller.scrollTop, 29990 * CODE_ROW_PX);
  view.destroy();
  console.log(`# Code-Reader 35 000 Zeilen geoeffnet in ${openMs.toFixed(1)} ms (jsdom, grobe Groessenordnung)`);
});

// Befund oberflaeche-f4 (Schlusspruefung 1.11.0): ab 400 000 Zeilen wird die Scrollleiste gestaucht (MAX_SCROLL_PX).
// Vorher lagen bei groesster scrollTop die letzten h/pitch - h/20 Zeilen nie im Bild (1 Mio. Zeilen: 45), und jeder
// Sprung setzte die Zielzeile um den Faktor 20/pitch zu tief. Bildhoehe und Klemmen von scrollTop bildet der Test wie
// ein Browser nach (jsdom hat kein Layout), dazu die Zeileninfo, die beim ersten Sprung erscheint und 30 px Hoehe
// nimmt (Browser-Gegenprobe: nach "Gehe" verdeckte sie sonst die letzte Zeile).
test("Code: 1 000 000 Zeilen (gestauchte Scrollleiste) - ganz unten steht die letzte Zeile im Bild, Spruenge auf ein Drittel", () => {
  const { window, host } = freshDom();
  const total = 1000000;
  const doc = baseDoc("/project1/Lang", "Lang", "Lang");
  doc.operators = [op("", "baseCOMP", "COMP", { name: "Lang", children: 1 }), op("lang", "textDAT", "DAT")];
  doc.codeSources = [source("lang", "textDAT", Array.from({ length: total }, (_, i) => String(i % 10)).join("\n"), { language: "text" })];
  const model = modelOf(doc);
  const view = renderCode(host, model, { source: "lang", line: null, scrollTop: null, find: "" }, recorder().actions);
  const scroller = host.querySelector(".pv-code-scroll");
  const sizer = host.querySelector(".pv-code-sizer");
  const info = host.querySelector(".pv-lineinfo");
  const H = 600;
  const height = () => (info.childNodes.length ? H - 30 : H);
  let top = 0;
  Object.defineProperty(scroller, "clientHeight", { configurable: true, get: height });
  Object.defineProperty(scroller, "scrollTop", { configurable: true, get: () => top,
    set: (value) => { top = Math.max(0, Math.min(Number(value), parseFloat(sizer.style.height) - height())); } });
  // Lage der Zeile n zur Oberkante des Bildes (px), null = nicht im DOM-Fenster.
  const offsetOf = (n) => {
    const rows = srcLines(host);
    const at = rows.findIndex((r) => r.getAttribute("data-line") === String(n));
    if (at < 0) return null;
    return parseFloat(host.querySelector(".pv-code-win").style.top) + at * CODE_ROW_PX - top;
  };
  const inView = (n) => {
    const y = offsetOf(n);
    return y !== null && y >= 0 && y + CODE_ROW_PX <= height();
  };
  assert.equal(sizer.style.height, "8000000px", "Scrollhoehe gedeckelt");
  scroller.scrollTop = Infinity;
  scroller.dispatchEvent(new window.Event("scroll"));
  assert.ok(inView(total), `ganz unten: Zeile ${total} bei ${offsetOf(total)} px (Bild ${height()} px)`);
  view.update({ source: "lang", line: total, scrollTop: null, find: "" });
  assert.equal(height(), H - 30, "Zeileninfo sichtbar");
  assert.ok(inView(total), `Sprung auf die letzte Zeile: ${offsetOf(total)} px (Bild ${height()} px)`);
  view.update({ source: "lang", line: 500000, scrollTop: null, find: "" });
  const middle = offsetOf(500000);
  assert.ok(middle !== null && Math.abs(middle - height() / 3) <= CODE_ROW_PX,
    `Sprung auf Zeile 500000: ${middle} px, erwartet etwa ${height() / 3}`);
  assert.ok(srcLines(host).length <= MAX_DOM_LINES);
  view.destroy();
});

test("Code: Hervorhebung exakt - Spans ergeben die Zeile; mehrzeilige Strings und GLSL-Blockkommentare tragen weiter", () => {
  const py = [
    "@decorator.attr(1)", "def f(a, b=1.5e-3):", '    """Erste Zeile', "    zweite 'Zeile' # kein Kommentar", '    letzte"""',
    "    s = f'{a!r} \\' x' + r\"\\d\" + b'\\x00'  # Kommentar mit 'quote'", "    größe = 0x1F + .5j\t# Tab", "    t = 'offen \\",
    "    weiter'", "    return None\r", "x = \"\u202E\" + 'a\u200Bb'", "",
  ];
  const states = lineStates("python", py);
  assert.deepEqual(states.slice(2, 6), ["", '"""', '"""', ""]);
  assert.equal(states[8], "'", "Backslash am Zeilenende setzt den einfachen String fort");
  for (const [i, line] of py.entries()) {
    const { tokens } = tokenizeLine("python", line, states[i]);
    assert.equal(tokens.map(([, s, e]) => line.slice(s, e)).join(""), line, `Zeile ${i + 1}`);
    assert.equal(tokens[0] ? tokens[0][1] : 0, 0);
  }
  assert.deepEqual(tokenizeLine("python", py[3], states[3]).tokens.map((t) => t[0]), ["str"], "Mitte eines \"\"\"-Strings ist nur String");
  const glsl = GLSL_LINES;
  const gs = lineStates("glsl", glsl);
  assert.equal(gs[3], "/*");
  assert.deepEqual(tokenizeLine("glsl", glsl[3], gs[3]).tokens[0][0], "cm");
  const kinds = new Set(tokenizeLine("glsl", glsl[6], gs[6]).tokens.map((t) => t[0]));
  for (const k of ["ty", "bi"]) assert.ok(kinds.has(k), k);
  // Im DOM: je Token ein Span, Text der Spans = Zeile; markierte Zeichen bleiben im Text.
  const { host } = freshDom();
  const doc = baseDoc("/project1/Hl", "Hl", "Hervorhebung");
  doc.operators = [op("", "baseCOMP", "COMP", { name: "Hl", children: 1 }), op("code", "textDAT", "DAT")];
  doc.codeSources = [source("code", "textDAT", py.join("\n"))];
  const model = modelOf(doc);
  const view = renderCode(host, model, { source: "code" }, recorder().actions);
  const rows = srcLines(host);
  assert.equal(rows.length, py.length);
  rows.forEach((row, i) => {
    const src = row.querySelector(".pv-src");
    assert.equal(src.textContent, py[i], `DOM-Zeile ${i + 1}`);
    assert.equal([...src.children].every((c) => c.tagName === "SPAN"), true);
    assert.equal([...src.childNodes].every((c) => c.nodeType === 1), true, "nur Spans, keine nackten Textknoten");
  });
  assert.ok(rows[3].querySelector(".pv-t-str"));
  assert.ok(rows[0].querySelector(".pv-t-dec"));
  const ctl = rows[10].querySelectorAll(".pv-ctl");
  assert.deepEqual([...ctl].map((s) => s.getAttribute("data-cp")), ["202E", "200B"]);
  assert.equal(rows[9].querySelectorAll(".pv-ctl").length, 0, "CR am Zeilenende (CRLF) wird nicht markiert");
  assert.ok(host.textContent.includes("CRLF"));
  view.destroy();
  // Lange Zeile: Hervorhebung begrenzt, Text bleibt exakt.
  const long = tokenizeLine("python", `x = 1 ${"y ".repeat(5000)}`);
  assert.ok(long.tokens.length < HIGHLIGHT_CAP);
  assert.equal(long.tokens.at(-1)[2], 6 + 10000);
  const pieces = splitAtMatches([["", 0, 10], ["kw", 10, 15]], [[8, 12]]);
  assert.deepEqual(pieces, [["", 0, 8, false], ["", 8, 10, true], ["kw", 10, 12, true], ["kw", 12, 15, false]]);
});

test("Code: Uebersicht aller Klassen und Modulfunktionen, Symbol-Sprung, Suche in der Datei, Falten", async () => {
  const { host } = freshDom();
  const model = modelOf(codeDoc());
  const rec = recorder();
  const view = renderCode(host, model, { source: "HostExt", line: null }, rec.actions);
  buttonByText(host, "Übersicht").click();
  const outline = host.querySelector(".pv-outline");
  assert.equal(outline.hidden, false);
  const text = outline.textContent;
  for (const name of ["Mixer", "Recorder", "Mix", "Record", "helper", "Modulfunktionen"]) assert.ok(text.includes(name), name);
  assert.equal([...outline.querySelectorAll(".pv-outline-jump")].filter((b) => b.textContent.startsWith("def _apply")).length, 2,
    "zwei _apply in zwei Klassen bleiben getrennt");
  const record = [...outline.querySelectorAll(".pv-outline-jump")].find((b) => b.textContent.startsWith("def Record("));
  record.click();
  assert.deepEqual(rec.last("setView"), ["setView", { line: 23 }]);
  assert.equal(host.querySelector(".pv-ln.pv-focus").getAttribute("data-line"), "23");
  assert.ok(host.querySelector(".pv-lineinfo").textContent.includes("Recorder.Record"));
  // Zeile 28: Aufruf parent.Host.Mix -> Mixer.Mix (Kante aus dem Modell), Verweis parent.Host -> Root.
  view.update({ source: "HostExt", line: 28 });
  const info = host.querySelector(".pv-lineinfo").textContent;
  assert.ok(info.includes("parent.Host") && info.includes("Mixer.Mix"), info);
  // Suche: Treffer zaehlen, als Span-Stuecke markieren, Sprung zum Treffer.
  const input = host.querySelector(".pv-code-find input");
  input.value = "LEVEL";
  input.dispatchEvent(new input.ownerDocument.defaultView.Event("input"));
  assert.match(host.querySelector(".pv-find-count").textContent, /^\d+\/4$/);
  const hits = [...host.querySelectorAll(".pv-hit")].map((s) => s.textContent);
  assert.ok(hits.length >= 1 && hits.every((h) => h.toLowerCase() === "level"), hits.join("|"));
  const before = host.querySelector(".pv-ln.pv-focus").getAttribute("data-line");
  buttonByText(host, "▶").click();
  assert.notEqual(host.querySelector(".pv-ln.pv-focus").getAttribute("data-line"), before);
  await delay(260);
  assert.ok(rec.of("setView").some((c) => c[1].find === "LEVEL"), "Suchtext an die Huelle gemeldet");
  // Falten der Klasse Mixer: Zeilen 5-15 verschwinden, die Kopfzeile bleibt mit Hinweis.
  const fold = [...outline.querySelectorAll(".pv-fold-btn")].find((b) => b.getAttribute("aria-label") === "Zeilen 5 bis 15 falten");
  fold.click();
  const shown = srcLines(host).map((r) => Number(r.getAttribute("data-line")));
  assert.ok(shown.includes(4) && !shown.includes(10) && shown.includes(16));
  assert.ok(host.querySelector(".pv-ln.pv-folded .pv-fold-chip").textContent.includes("11 Zeilen"));
  assert.equal(host.querySelector(".pv-ln.pv-folded .pv-src").textContent, HOST_LINES[3], "Faltmarke gehoert nicht zum Code-Text");
  view.update({ source: "HostExt", line: 13 });
  assert.ok(srcLines(host).some((r) => r.getAttribute("data-line") === "13"), "Sprung in gefalteten Bereich klappt auf");
  view.destroy();
});

test("Code: status != exact zeigt den Grund, Analysefehler lassen den Text lesbar, Tabellen und GLSL", () => {
  const { host } = freshDom();
  const model = modelOf(codeDoc());
  const rec = recorder();
  const view = renderCode(host, model, { source: "secrets_dat" }, rec.actions);
  assert.ok(host.querySelector(".pv-code-banner").textContent.includes("Geheimnis-Fund"));
  assert.equal(srcLines(host).length, 0);
  assert.equal(buttonByText(host, "Code kopieren").disabled, true);
  view.update({ source: "parsefail" });
  assert.equal(srcLines(host).length, 3, "LF-Index-Zeilen: Text mit End-LF hat eine leere letzte Zeile");
  assert.equal(srcLines(host)[0].querySelector(".pv-src").textContent, "def kaputt(:");
  assert.ok(host.querySelector(".pv-code-banner").textContent.includes("kein lesbares Python"));
  view.update({ source: "broken" });
  assert.ok(host.querySelector(".pv-code-banner").textContent.includes("Schema"));
  assert.equal(srcLines(host)[0].querySelector(".pv-src").textContent, "x = 1");
  view.update({ source: "lookup" });
  const cells = [...host.querySelectorAll(".pv-table td")].map((td) => td.textContent);
  assert.deepEqual(cells, ["key", "value", "alpha", "1", "opacity", "0.5"]);
  view.update({ source: "pixel_code" });
  assert.ok(host.querySelector(".pv-t-ty") && host.querySelector(".pv-t-cm"));
  assert.equal(srcLines(host)[3].querySelector(".pv-src").textContent, GLSL_LINES[3]);
  view.update({ source: "fehlt" });
  assert.ok(host.textContent.includes("nicht im Paket"));
  view.destroy();
});

test("Code: Notiz-Entwurf mit Anker nach anchors.js (Zeile, Bereich, Symbol), Kopieren von Code und Pfad", async () => {
  const { window, host } = freshDom();
  const model = modelOf(codeDoc());
  const rec = recorder();
  const view = renderCode(host, model, { source: "HostExt" }, rec.actions);
  const lineNode = (n) => srcLines(host).find((r) => r.getAttribute("data-line") === String(n));
  lineNode(10).querySelector(".pv-src").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.deepEqual(rec.last("setView"), ["setView", { line: 10 }]);
  buttonByText(host, "Notiz zur Auswahl").click();
  await delay(20);
  const range = rec.last("addNote")[1];
  assert.ok(validateAnchor(range).ok, JSON.stringify(validateAnchor(range).errors));
  assert.deepEqual([range.kind, range.source, range.startLine, range.endLine, range.excerpt], ["range", "HostExt", 10, 10, HOST_LINES[9]]);
  assert.deepEqual(resolveAnchor(range, model).state, "kept");
  buttonByText(host, "Notiz zum Symbol").click();
  await delay(20);
  const sym = rec.last("addNote")[1];
  assert.deepEqual([sym.kind, sym.symbol, sym.startLine, sym.endLine], ["symbol", "Mixer.Mix", 9, 12]);
  buttonByText(host, "Bereich wählen").click();
  lineNode(9).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  lineNode(12).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  buttonByText(host, "Notiz zur Auswahl").click();
  await delay(20);
  const span = rec.last("addNote")[1];
  assert.deepEqual([span.startLine, span.endLine], [9, 12]);
  assert.equal(span.excerpt, HOST_LINES.slice(8, 12).join("\n"));
  // Befund oberflaeche-f11: die Ansicht sagt der Huelle, WAS kopiert wird (Meldung "Code kopiert." statt "Kontext").
  buttonByText(host, "Code kopieren").click();
  assert.deepEqual(rec.last("copyText"), ["copyText", HOST_TEXT, "code"]);
  buttonByText(host, "Pfad kopieren").click();
  assert.deepEqual(rec.last("copyText"), ["copyText", "/project1/Host/HostExt", "path"]);
  buttonByText(host, "Auswahl kopieren").click();
  assert.deepEqual(rec.last("copyText"), ["copyText", HOST_LINES.slice(8, 12).join("\n"), "selection"]);
  view.destroy();
});

// ================================================================== Details und Verstehen

test("Details: Parameter je Modus nach Grammatik 4.11 - Floats woertlich, ruhender Constant-Wert nie als Wert", () => {
  assert.deepEqual(valueText({ t: "float", v: "1e-05" }), { kind: "value", t: "float", text: "1e-05" });
  assert.deepEqual(valueText({ t: "bool", v: "0" }), { kind: "value", t: "bool", text: "Aus", raw: "0" });
  assert.equal(valueText({ t: "unknown", reason: "mode-bind" }).kind, "unknown");
  assert.equal(valueText({ t: "str", v: null, omitted: "secret" }).kind, "omitted");
  assert.equal(valueText({ t: "unknown", reason: "size" }).text, "unbekannt – zu lang, nicht übertragen");
  const model = modelOf(weichzeichnerDoc());
  const size = parameterRows(model.parameter("blur", "size"));
  const label = (rows, l) => rows.find((r) => r.label === l) || null;
  assert.equal(label(size, "Wert").kind, "unknown");
  assert.equal(label(size, "Bind").text, "parent().par.Staerke");
  const dormant = label(size, "Ruhender Constant-Wert (nicht aktiv)");
  assert.deepEqual([dormant.text, dormant.dormant], ["7", true]);
  assert.equal(label(size, "Default, kein historischer Wert"), null, "eingebauter Par: kein Default");
  const staerke = parameterRows(model.parameter("", "Staerke"));
  assert.equal(label(staerke, "Wert").text, "4.0");
  assert.equal(label(staerke, "Default, kein historischer Wert").text, "4.0");
  const expr = parameterRows(model.parameter("in1", "label"));
  assert.equal(label(expr, "Expression").text, "me.name");
  assert.equal(label(expr, "Wert").kind, "unknown");
  const { host } = freshDom();
  const rec = recorder();
  const view = renderDetails(host, model, "blur", rec.actions);
  const kvs = [...host.querySelectorAll(".pv-par")].map((p) => [p.querySelector(".pv-par-head bdi").textContent,
    [...p.querySelectorAll(".pv-kv")].map((kv) => [kv.querySelector(".pv-k").textContent, kv.querySelector(".pv-v").textContent,
      kv.querySelector(".pv-v").classList.contains("pv-marker"), kv.querySelector(".pv-v").classList.contains("pv-dormant")])]);
  const sizePar = kvs.find(([name]) => name === "size")[1];
  assert.deepEqual(sizePar.find(([k]) => k === "Wert").slice(2), [true, false], "Wert ist Marker");
  assert.ok(!sizePar.find(([k]) => k === "Wert")[1].includes("7"), "der ruhende Wert 7 steht nie als Wert");
  assert.deepEqual(sizePar.find(([k]) => k.startsWith("Ruhender")).slice(1, 2), ["7int"]);
  assert.equal(sizePar.find(([k]) => k.startsWith("Ruhender"))[3], true);
  assert.equal(kvs.find(([name]) => name === "filtersize")[1].find(([k]) => k === "Wert")[1], "1e-05float");
  assert.equal(kvs.find(([name]) => name === "bypass")[1].find(([k]) => k === "Wert")[1], "Aus (0)bool");
  assert.equal(kvs.find(([name]) => name === "secretpar")[1].find(([k]) => k === "Wert")[2], true);
  assert.ok(host.textContent.includes("parent().par.Staerke"));
  assert.ok([...host.querySelectorAll(".pv-cert")].some((c) => c.textContent === "statisch"));
  assert.ok(host.textContent.includes("Nicht exportiert: effektive Parameterwerte, Storage, CHOP-Kanäle, Medien."), "Vertrag 4.6");
  view.destroy();
  const rootView = renderDetails(host, model, "", rec.actions);
  const wires = [...host.querySelectorAll(".pv-wire-row")].map((r) => r.textContent);
  assert.ok(wires.some((t) => t.includes("Eingang 0") && t.includes("extern: /project1/CodeSearch_Tutorial/mix")), wires.join("|"));
  assert.ok(wires.some((t) => t.includes("Ausgang 0") && t.includes("extern: /project1/CodeSearch_Tutorial/bild_null")));
  const ext = [...host.querySelectorAll(".pv-wire-row .pv-ext")];
  assert.ok(ext.length === 2 && ext.every((n) => n.tagName === "SPAN" && !n.closest("button")), "externe Enden nicht navigierbar");
  assert.ok(host.textContent.includes("Default, kein historischer Wert"));
  const staerkeBox = [...host.querySelectorAll(".pv-par")].find((p) => p.querySelector(".pv-par-head bdi").textContent === "Staerke");
  assert.ok(staerkeBox.textContent.includes("Stärke des Weichzeichners."));
  rootView.destroy();
});

test("Details: Rueckkehr erhaelt die Scrollposition je Op und Revision", () => {
  const { host } = freshDom();
  const model = modelOf(weichzeichnerDoc());
  const first = renderDetails(host, model, "blur", recorder().actions);
  host.querySelector(".pv-details").scrollTop = 321;
  first.destroy();
  const again = renderDetails(host, model, "blur", recorder().actions);
  assert.equal(host.querySelector(".pv-details").scrollTop, 321);
  again.destroy();
  const other = renderDetails(host, model, "in1", recorder().actions);
  assert.equal(host.querySelector(".pv-details").scrollTop, 0);
  other.destroy();
});

test("Verstehen: jede Aussage mit Beleg und Gewissheit, Hinweis statisch; Op- und Symbol-Ziel", () => {
  const { host } = freshDom();
  const model = modelOf(codeDoc());
  const rec = recorder();
  const checkClaims = () => {
    const claims = [...host.querySelectorAll(".pv-claim")];
    assert.ok(claims.length > 0);
    for (const c of claims) {
      const proof = c.querySelector(".pv-claim-proof");
      assert.ok(proof && proof.querySelector(".pv-cert"), c.textContent);
      assert.ok(proof.textContent.replace("Beleg", "").replace(proof.querySelector(".pv-cert").textContent, "").trim().length > 0, `Beleg fehlt: ${c.textContent}`);
    }
    assert.ok(host.querySelector(".pv-static-note").textContent.includes("keine TD-Ausführung"));
    return claims.map((c) => c.textContent);
  };
  let view = renderUnderstand(host, model, { op: "HostExt" }, rec.actions);
  let claims = checkClaims();
  assert.ok(claims.some((t) => t.includes("Extension-DAT von")), claims.join("\n"));
  assert.ok(claims.some((t) => t.includes("Zustand") && t.includes("Mixer.level")));
  assert.ok(claims.some((t) => t.includes("ruft Run()")));
  assert.ok(host.textContent.includes("Externe Abhängigkeiten"));
  assert.ok(claims.some((t) => t.includes("extern: /project1/outside")));
  view.destroy();
  view = renderUnderstand(host, model, { source: "HostExt", symbol: "Recorder._apply" }, rec.actions);
  claims = checkClaims();
  assert.ok(claims.some((t) => t.includes("ruft Mix()") && t.includes("Mixer.Mix")), claims.join("\n"));
  const proof = [...host.querySelectorAll(".pv-claim")].find((c) => c.textContent.includes("ruft Mix()")).querySelector(".pv-claim-proof");
  assert.ok(proof.textContent.includes("HostExt Z. 28"));
  view.destroy();
  view = renderUnderstand(host, model, { source: "HostExt", symbol: "Mixer.Mix" }, rec.actions);
  claims = checkClaims();
  assert.ok(claims.some((t) => t.includes("Recorder._apply") && t.includes("ruft Mix()")), "Aufrufer");
  assert.ok(claims.some((t) => t.includes("schreibt") && t.includes("self.level")));
  assert.ok(claims.some((t) => t.includes("Rückgabe") && t.includes("Zahl")));
  const link = [...host.querySelectorAll(".pv-claim button")].find((b) => b.textContent === "Recorder._apply");
  link.click();
  assert.deepEqual(rec.last("openUnderstand"), ["openUnderstand", { source: "HostExt", symbol: "Recorder._apply" }]);
  view.destroy();
  view = renderUnderstand(host, model, { op: "engine" }, rec.actions);
  claims = checkClaims();
  assert.ok(claims.some((t) => t.includes("Extension Slot 0") && t.includes("Engine")));
  view.destroy();
});

// ================================================================== Notizen

test("Notizen: Status bleibt / verschoben / Quelle nicht uebertragen / nicht zugeordnet, Sprung zum Anker", async () => {
  const modelA = modelOf(codeDoc());
  const kept = await createAnchor(modelA, { kind: "range", source: "engine/EngineExt", startLine: 2, endLine: 3 });
  const moved = await createAnchor(modelA, { kind: "range", source: "HostExt", startLine: 9, endLine: 12 });
  const gone = await createAnchor(modelA, { kind: "range", source: "HostExt", startLine: 31, endLine: 31 });
  const opNote = await createAnchor(modelA, { kind: "op", op: "target" });
  // Revision B: zwei neue Zeilen oben (Mix verschoben), helper umbenannt (Ausschnitt nicht mehr da).
  const text = `# neu\n# neu\n${HOST_TEXT.replace("def helper(x):", "def helfer(x):")}`;
  const modelB = modelOf(codeDoc({ hostText: text }));
  const modelC = modelOf(codeDoc({ secretHost: true }));
  const note = (id, anchor, body) => ({ id: `note_${id.repeat(32).slice(0, 32)}`, projectId: PID, anchor, text: body,
    createdAt: "2026-11-05T10:00:00Z", updatedAt: "2026-11-05T10:00:00Z" });
  const notes = [note("a", kept, "bleibt"), note("b", moved, "verschoben"), note("c", gone, "weg"), note("d", opNote, "Op")];
  const { host } = freshDom();
  const rec = recorder();
  let view = renderNotes(host, notes, modelB, rec.actions);
  const states = [...host.querySelectorAll(".pv-note .pv-st")].map((s) => s.textContent);
  assert.deepEqual(states, ["bleibt", "verschoben", "nicht zugeordnet", "bleibt"]);
  const movedCard = [...host.querySelectorAll(".pv-note")][1];
  assert.ok(movedCard.textContent.includes("Z. 11–14") && movedCard.textContent.includes("vorher Z. 9–12"));
  [...movedCard.querySelectorAll("button")].find((b) => b.textContent === "Zum Anker").click();
  assert.deepEqual(rec.last("openCode"), ["openCode", "HostExt", 11]);
  const goneCard = [...host.querySelectorAll(".pv-note")][2];
  assert.equal([...goneCard.querySelectorAll("button")].find((b) => b.textContent === "Zum Anker").disabled, true);
  [...host.querySelectorAll(".pv-note")][3].querySelector("button").click();
  assert.deepEqual(rec.last("openDetails"), ["openDetails", "target"]);
  assert.ok(host.querySelector(".pv-note-summary").textContent.includes("bleibt: 2"));
  view.destroy();
  view = renderNotes(host, notes, modelC, rec.actions);
  assert.equal([...host.querySelectorAll(".pv-note .pv-st")][1].textContent, "Quelle nicht übertragen");
  view.destroy();
  view = renderNotes(host, [{ note: notes[0], resolved: { state: "moved", anchor: kept, rel: "engine/EngineExt", startLine: 2, endLine: 3 } }], null, rec.actions);
  assert.equal(host.querySelector(".pv-note .pv-st").textContent, "verschoben", "mitgelieferter Status wird uebernommen");
  view.destroy();
  view = renderNotes(host, notes.slice(0, 1), null, rec.actions);
  assert.ok(host.textContent.includes("nicht geprüft"));
  view.destroy();
});

// ================================================================== Darstellungs-Testvektoren (Vertrag 14)

const ALLOWED_TAGS = new Set(["DIV", "SPAN", "BUTTON", "P", "SECTION", "ARTICLE", "H3", "H4", "UL", "LI", "BDI", "INPUT", "TABLE",
  "TBODY", "TR", "TD", "TH", "svg", "g", "rect", "path", "text", "tspan", "title"]);
const ALLOWED_ATTRS = new Set(["class", "role", "tabindex", "type", "title", "disabled", "hidden", "placeholder", "autocomplete",
  "spellcheck", "enterkeyhint", "inputmode", "scope", "x", "y", "width", "height", "rx", "d", "transform", "focusable", "style"]);

function auditDom(host) {
  const walker = host.ownerDocument.createTreeWalker(host, 1);
  let node = walker.nextNode();
  let count = 0;
  while (node) {
    count += 1;
    assert.ok(ALLOWED_TAGS.has(node.tagName), `unerwartetes Element ${node.tagName}`);
    for (const attr of node.attributes) {
      const ok = ALLOWED_ATTRS.has(attr.name) || /^aria-[a-z]+$/.test(attr.name) || /^data-(?:line|index|cp|col)$/.test(attr.name);
      assert.ok(ok, `unerwartetes Attribut ${attr.name} an ${node.tagName}`);
      if (attr.name === "style") assert.match(attr.value, /^(?:(?:height|top): -?\d+(?:\.\d+)?px;\s*)+$/, "Stil nur aus berechneten Zahlen");
      if (attr.name === "data-cp") assert.match(attr.value, /^[0-9A-F]{4,6}$/);
    }
    node = walker.nextNode();
  }
  return count;
}

test("Vektoren: Namen, Code, Kommentare, Annotationen, Werte erzeugen weder Element noch Attribut", async () => {
  const before = Object.getOwnPropertyNames(Object.prototype).length;
  const { window, host } = freshDom();
  const model = modelOf(xssDoc());
  const rec = recorder();
  const handles = [];
  handles.push(renderNetwork(host, model, { comp: "", selected: VECTORS[0] }, rec.actions));
  for (const o of model.operators()) {
    handles.push(renderDetails(host, model, o.rel, rec.actions));
    handles.push(renderUnderstand(host, model, { op: o.rel }, rec.actions));
  }
  for (const s of model.sources()) {
    handles.push(renderCode(host, model, { source: s.key, line: 1, find: VECTORS[0] }, rec.actions));
    for (const sym of model.symbols(s.key)) handles.push(renderUnderstand(host, model, { source: s.key, symbol: sym.symbol }, rec.actions));
  }
  const anchor = await createAnchor(model, { kind: "range", source: VECTORS[0], startLine: 1, endLine: 3 });
  handles.push(renderNotes(host, [{ id: `note_${"e".repeat(32)}`, projectId: PID, anchor, text: VECTORS.join("\n"),
    createdAt: VECTORS[3], updatedAt: VECTORS[0] }], model, rec.actions));
  // Annotation antippen: exakter Text im Infofeld, ebenfalls nur Text.
  const annNode = host.querySelector("g.pv-ann");
  tapOn(window, annNode);
  const elements = auditDom(host);
  assert.ok(elements > 200);
  const text = host.textContent;
  for (const v of VECTORS) assert.ok(text.includes(v), `Vektor als Text sichtbar: ${JSON.stringify(v)}`);
  assert.equal(host.querySelectorAll("img, script, iframe, object, embed, a, style, link, foreignObject").length, 0);
  assert.ok(host.querySelector('.pv-ctl[data-cp="202E"]') && host.querySelector('.pv-ctl[data-cp="200B"]'));
  // Die 1-Mio.-Zeichen-Zeile ist exakt da, aber mit wenigen Spans.
  const longRow = [...host.querySelectorAll(".pv-code-win .pv-ln")].find((r) => r.querySelector(".pv-src").textContent === LONG_LINE);
  assert.ok(longRow, "lange Zeile gerendert");
  assert.ok(longRow.querySelector(".pv-src").children.length < 50);
  for (const h of handles) h.destroy();
  assert.equal(host.childNodes.length, 0);
  assert.equal(Object.getOwnPropertyNames(Object.prototype).length, before, "Object.prototype unveraendert");
  assert.deepEqual(splitMarked("a\u202Eb").map((p) => p.marked), [false, true, false]);
  assert.equal(displayText("x\u202Ey"), "x<U+202E>y");
});

// Befund Browser-Test 1.11.0: die Fakten-Zeilen ueber dem NETZ hatten nur die Mehrzahl ("1 Leitungen", "1 Enden
// ausserhalb", "1 Kinder nicht exportiert").
test("Netz: Fakten-Zeilen mit Einzahl und Mehrzahl (Op, Leitung, Annotation, Kind, Ende)", () => {
  const hintsOf = (doc) => {
    const { host } = freshDom();
    const net = renderNetwork(host, modelOf(doc), { comp: "", selected: null, zoom: null, panX: null, panY: null }, recorder().actions);
    const texts = [...host.querySelectorAll(".pv-hint")].map((p) => p.textContent);
    net.destroy();
    return texts;
  };
  const one = baseDoc("/project1/Eins", "Eins", "Einzahl");
  one.operators = [op("", "baseCOMP", "COMP", { name: "Eins", children: 2 }), op("ghost", "nullTOP", "TOP", { node: { unknown: "not-readable" } })];
  one.annotations = [ann("", "notiz", "Eine", "Text", { x: -40, y: -40, w: 300, h: 200 }, ["ghost"])];
  one.connections = [wire({ external: "/project1/aussen" }, 0, "ghost", 0)];
  one.externalDependencies = [{ path: "/project1/aussen", opType: null, kinds: ["wire"], count: 1, included: false }];
  const single = hintsOf(one);
  for (const text of ["1 Op · 0 Leitungen · 1 Annotation", "1 Kind nicht exportiert",
    "1 Op ohne exportierte Position: Reihe unten, Leitungen gestrichelt", "1 Ende außerhalb: nur als Platzhalter"]) {
    assert.ok(single.includes(text), `${text} in ${JSON.stringify(single)}`);
  }
  const two = baseDoc("/project1/Zwei", "Zwei", "Mehrzahl");
  two.operators = [op("", "baseCOMP", "COMP", { name: "Zwei", children: 4 }),
    op("a", "noiseTOP", "TOP", { node: { x: 0, y: 0, w: 130, h: 90 } }), op("b", "levelTOP", "TOP", { node: { x: 400, y: 0, w: 130, h: 90 } })];
  two.connections = [wire("a", 0, "b", 0)];
  const plural = hintsOf(two);
  assert.ok(plural.includes("2 Ops · 1 Leitung"), JSON.stringify(plural));
  assert.ok(plural.includes("2 Kinder nicht exportiert"), JSON.stringify(plural));
  const mixed = hintsOf(mixedDoc());
  assert.ok(mixed.some((t) => /^2 Ops ohne exportierte Position/.test(t)), JSON.stringify(mixed));
});

test("Vektoren: Prototyp-Namen constructor/__proto__/toString/hasOwnProperty als Ops, Pars und Symbole", () => {
  const { window, host } = freshDom();
  const model = modelOf(protoDoc());
  const rec = recorder();
  const net = renderNetwork(host, model, { comp: "", selected: null, zoom: 1, panX: 0, panY: 0 }, rec.actions);
  for (const name of ["constructor", "hasOwnProperty", "__proto__", "toString"]) assert.ok(opNode(host, name), name);
  tapOn(window, opNode(host, "__proto__"));
  assert.deepEqual(rec.last("selectOp"), ["selectOp", "__proto__"]);
  assert.equal(host.querySelectorAll("path.pv-wire.pv-hot").length, 2);
  tapOn(window, opNode(host, "constructor"));
  tapOn(window, opNode(host, "constructor"));
  assert.deepEqual(rec.last("enterComp"), ["enterComp", "constructor"]);
  net.update({ comp: "constructor", selected: null });
  assert.ok(host.textContent.includes("1 Op ·"), "Einzahl (vorher stand hier \"1 Ops\")");
  net.destroy();
  const det = renderDetails(host, model, "__proto__", rec.actions);
  assert.ok([...host.querySelectorAll(".pv-par-head bdi")].some((b) => b.textContent === "constructor"));
  buttonByText(host, "Pfad kopieren").click();
  assert.deepEqual(rec.last("copyText"), ["copyText", "/project1/proto/__proto__", "path"], "Details: Art 'path' fuer die Meldung");
  det.destroy();
  const code = renderCode(host, model, { source: "constructor/toString" }, rec.actions);
  buttonByText(host, "Übersicht").click();
  assert.ok(host.querySelector(".pv-outline").textContent.includes("__proto__"));
  code.destroy();
  const und = renderUnderstand(host, model, { source: "constructor/toString", symbol: "toString.constructor" }, rec.actions);
  assert.ok(host.textContent.includes("ruft __proto__()"));
  und.destroy();
  assert.equal({}.constructor, Object);
});

// ================================================================== Leistung und echte Exporter-Pakete

test("Leistung: Netz-Tab eines COMP mit 200 Ops unter 200 ms (Node/jsdom, grobe Groessenordnung)", () => {
  const { host } = freshDom();
  const model = modelOf(perfDoc(200));
  const times = [];
  for (let i = 0; i < 4; i += 1) {
    const t0 = performance.now();
    const view = renderNetwork(host, model, { comp: "", selected: null }, recorder().actions);
    times.push(performance.now() - t0);
    assert.equal(host.querySelectorAll("g.pv-op").length, 200);
    view.destroy();
  }
  const best = Math.min(...times);
  console.log(`# Netz 200 Ops: ${times.map((t) => t.toFixed(1)).join(" / ")} ms (bester ${best.toFixed(1)} ms)`);
  assert.ok(best < 200, `${best} ms`);
});

test("Echte Exporter-Pakete (py-interop) und gueltige Vektoren: alle Ansichten bauen ohne Fehler", async () => {
  const dirs = ["tools/fixtures/pocket/py-interop/", "tools/fixtures/pocket/js-vectors/"];
  let packages = 0;
  for (const dir of dirs) {
    const base = new URL(dir, ROOT);
    for (const name of readdirSync(base).filter((n) => n.endsWith(".json") && n !== "vectors.lock.json" && !n.startsWith("invalid"))) {
      const result = await verifyPackage(readFileSync(new URL(name, base)), { unbound: true });
      if (!result.ok) continue;
      packages += 1;
      const model = createModel(result);
      const { host } = freshDom();
      const rec = recorder();
      for (const o of model.operators()) {
        if (o.isCOMP) renderNetwork(host, model, { comp: o.rel, selected: null }, rec.actions).destroy();
        renderDetails(host, model, o.rel, rec.actions).destroy();
        renderUnderstand(host, model, { op: o.rel }, rec.actions).destroy();
      }
      for (const s of model.sources()) {
        renderCode(host, model, { source: s.key, line: 1 }, rec.actions).destroy();
        for (const sym of model.symbols(s.key)) renderUnderstand(host, model, { source: s.key, symbol: sym.symbol }, rec.actions).destroy();
      }
      assert.equal(host.childNodes.length, 0, name);
    }
  }
  assert.ok(packages >= 8, `${packages} Pakete`);
});

test("destroy: keine Meldung nach dem Abbau, update danach wirkungslos", async () => {
  const { host } = freshDom();
  const model = modelOf(weichzeichnerDoc());
  const rec = recorder();
  const net = renderNetwork(host, model, { comp: "", selected: null }, rec.actions);
  net.destroy();
  net.update({ comp: "", selected: "blur" });
  await Promise.resolve();
  assert.equal(rec.calls.length, 0, "Einpass-Meldung nach destroy unterdrueckt");
  const code = renderCode(host, modelOf(codeDoc()), { source: "HostExt" }, rec.actions);
  host.querySelector(".pv-code-scroll").dispatchEvent(new host.ownerDocument.defaultView.Event("scroll"));
  code.destroy();
  await delay(260);
  assert.equal(rec.calls.length, 0, "Scroll-Meldung nach destroy unterdrueckt");
  assert.equal(host.childNodes.length, 0);
});

// ================================================================== Nachbesserung nach Pruefbefunden (Welle 2b)
// Jeder Test zeigt den Fehler am alten Stand (Gegenlauf im Scratch) und haelt die Behebung fest.

function viewsBlockCss() {
  const css = readFileSync(new URL("css/app.css", ROOT), "utf8");
  const begin = css.indexOf("/* projects-views:begin */");
  const end = css.indexOf("/* projects-views:end */");
  assert.ok(begin >= 0 && end > begin, "Block projects-views in css/app.css");
  return css.slice(begin, end);
}

function cssRule(block, selector) {
  const at = block.indexOf(`${selector} {`);
  assert.ok(at >= 0, `CSS-Regel ${selector}`);
  return block.slice(at, block.indexOf("}", at) + 1);
}

test("Befund Netz: Anschlussindex 1e6 im gueltigen Paket baut hoechstens MAX_TICKS Striche und bleibt schnell", () => {
  const doc = mixedDoc();
  doc.connections.push(wire("a", 0, "b", 1000000), wire("split", 2000000, "m", 3));
  const model = modelOf(doc);
  const { host } = freshDom();
  const t0 = performance.now();
  const view = renderNetwork(host, model, { comp: "", selected: null, zoom: 1, panX: 0, panY: 0 }, recorder().actions);
  const ms = performance.now() - t0;
  const tickPaths = [...host.querySelectorAll("path.pv-ticks")];
  const segments = tickPaths.reduce((n, p) => n + (p.getAttribute("d").match(/M/g) || []).length, 0);
  const chars = tickPaths.reduce((n, p) => n + p.getAttribute("d").length, 0);
  assert.ok(segments <= 2 * MAX_TICKS * tickPaths.length, `${segments} Striche`);
  assert.ok(chars < 20000, `${chars} Zeichen in d`);
  assert.ok(ms < 150, `${ms.toFixed(1)} ms`);
  assert.match(opNode(host, "b").getAttribute("aria-label"), /1000001 Eingangs-Anschlüsse/);
  assert.match(opNode(host, "split").getAttribute("aria-label"), /2000001 Ausgangs-Anschlüsse/);
  assert.ok(host.querySelector(".pv-net-hints").textContent.includes(`mehr als ${MAX_TICKS} Anschlüssen`));
  // Die Leitung selbst liegt trotzdem am exakten Index (Anker-Rechnung ohne Schleife).
  const lay = layoutNetwork(model.network(""), { lookup: (r) => model.op(r) });
  const big = lay.wires.find((w) => w.toRel === "b" && w.toIndex === 1000000);
  const b = lay.byRel.get("b");
  assert.equal(big.y2, b.y + (b.h * 1000001) / 1000002);
  view.destroy();
  // Reine Auswahl der Strich-Indizes.
  assert.deepEqual(tickIndices(1, new Set([0])), []);
  assert.deepEqual(tickIndices(3, new Set([2])), [0, 1, 2], "wenige Anschluesse: alle Striche wie bisher");
  assert.deepEqual(tickIndices(1000001, new Set([1000000, 0])), [0, 1000000]);
  const many = tickIndices(5000, new Set(Array.from({ length: 300 }, (_, i) => i * 7)));
  assert.equal(many.length, MAX_TICKS);
  assert.equal(many.at(-1), 299 * 7, "der hoechste belegte Index bleibt sichtbar");
});

test("Befund Netz: Rad-Zoom vor der verzoegerten Meldung geht bei schnellem Antippen nicht verloren", () => {
  const { window, host } = freshDom();
  const model = modelOf(mixedDoc());
  // Huelle wie P2a-1 (js/ui/projects.js): setView merkt nur, selectOp spiegelt den gespeicherten Stand zurueck.
  const views = { comp: "", selected: null, zoom: 0.5, panX: 10, panY: 20 };
  let handle = null;
  const actions = {
    selectOp: (rel) => {
      views.selected = rel;
      handle.update({ ...views });
    },
    setView: (partial) => Object.assign(views, partial),
  };
  handle = renderNetwork(host, model, { ...views }, actions);
  const world = host.querySelector("g.pv-net-world");
  const surface = host.querySelector(".pv-net-surface");
  assert.equal(world.getAttribute("transform"), "translate(10 20) scale(0.5)");
  surface.dispatchEvent(new window.WheelEvent("wheel", { deltaY: -400, bubbles: true, cancelable: true }));
  const zoomed = world.getAttribute("transform");
  assert.notEqual(zoomed, "translate(10 20) scale(0.5)");
  // Ein gespeicherter Stand der Huelle waehrend der Wartezeit ist kein neuer Wunsch: die Nutzeransicht bleibt.
  handle.update({ ...views });
  assert.equal(world.getAttribute("transform"), zoomed, "Echo vor der Meldung setzt nicht zurueck");
  tapOn(window, opNode(host, "a"));
  assert.equal(views.selected, "a");
  assert.equal(world.getAttribute("transform"), zoomed, "Antippen innerhalb von 220 ms behaelt den Zoom");
  assert.notEqual(views.zoom, 0.5, "die Huelle hat den neuen Zoom vor selectOp bekommen");
  assert.match(zoomed, new RegExp(`scale\\(${Math.round(views.zoom * 1000) / 1000}\\)`));
  // Ohne ausstehende Meldung gilt ein neuer Stand der Huelle wieder sofort.
  handle.update({ ...views, zoom: 2, panX: 0, panY: 0 });
  assert.equal(world.getAttribute("transform"), "translate(0 0) scale(2)");
  handle.destroy();
});

test("Befund Code: neue Zeile springt auch mit der zuletzt gemeldeten scrollTop; Echo derselben Zeile bleibt", async () => {
  const { window, host } = freshDom();
  const { doc } = bigDoc(5000);
  const model = modelOf(doc);
  const rec = recorder();
  const view = renderCode(host, model, { source: "big", line: 20, scrollTop: null, find: "" }, rec.actions);
  const scroller = host.querySelector(".pv-code-scroll");
  const focusLine = () => Number(host.querySelector(".pv-ln.pv-focus")?.getAttribute("data-line") ?? 0);
  const report = async (top) => {
    scroller.scrollTop = top;
    scroller.dispatchEvent(new window.Event("scroll"));
    await delay(260);
    assert.deepEqual(rec.last("setView"), ["setView", { scrollTop: top }]);
  };
  await report(40000);
  view.update({ source: "big", line: 10, scrollTop: 40000, find: "" });
  assert.equal(focusLine(), 10, "neue Zeile 10 trotz Echo-scrollTop");
  assert.equal(scroller.scrollTop, 0, "Zeile 10 im Bild (oben)");
  await report(0);
  view.update({ source: "big", line: 3000, scrollTop: 0, find: "" });
  assert.equal(focusLine(), 3000, "Huelle _openCode setzt scrollTop 0 - der Sprung darf nicht verschluckt werden");
  assert.equal(scroller.scrollTop, 2999 * CODE_ROW_PX - 600 / 3);
  // Echo: Nutzer scrollt von der Fokuszeile weg, die Huelle spiegelt {line: 3000, scrollTop: gemeldet} zurueck.
  await report(1000);
  view.update({ source: "big", line: 3000, scrollTop: 1000, find: "" });
  assert.equal(scroller.scrollTop, 1000, "Echo derselben Zeile springt nicht zurueck");
  view.destroy();
});

test("Befund Hervorhebung: lange Zahl ohne Trenner ('1e+' x 333 334 = 1 Mio. Zeichen) bleibt linear", () => {
  const mid = "1e+".repeat(40000);
  for (const lang of ["python", "glsl"]) {
    const t0 = performance.now();
    lineStates(lang, [`${mid} '`, mid]);
    tokenizeLine(lang, `${mid} '`, "");
    const ms = performance.now() - t0;
    assert.ok(ms < 150, `${lang}: 120 000 Zeichen in ${ms.toFixed(1)} ms`);
  }
  const line = `${"1e+".repeat(333334)} '`;
  assert.ok(line.length > 1000000);
  for (const lang of ["python", "glsl"]) {
    const t0 = performance.now();
    lineStates(lang, [line]);
    const { tokens } = tokenizeLine(lang, line, "");
    const ms = performance.now() - t0;
    assert.ok(ms < 500, `${lang}: 1 Mio. Zeichen in ${ms.toFixed(1)} ms`);
    assert.equal(tokens.map(([, s, e]) => line.slice(s, e)).join(""), line, "Spans ergeben die Zeile");
    assert.equal(tokens[0][0], "num");
  }
  // Hex mit e-Ziffer bleibt eine Zahl ohne Exponent: 0x1e+2 = 0x1e, +, 2.
  const { tokens } = tokenizeLine("python", "0x1e+2", "");
  assert.deepEqual(tokens.map(([cls, s, e]) => [cls, "0x1e+2".slice(s, e)]), [["num", "0x1e"], ["", "+"], ["num", "2"]]);
  assert.deepEqual(tokenizeLine("python", "1e+5", "").tokens, [["num", 0, 4]]);
  // Im Code Reader: Quelle mit dieser Zeile oeffnet und rendert ohne Einfrieren.
  const doc = bigDoc(3).doc;
  doc.codeSources = [source("big", "textDAT", `${line}\nx = 1\n`)];
  const model = modelOf(doc);
  const { host } = freshDom();
  const t0 = performance.now();
  const view = renderCode(host, model, { source: "big", line: 1, scrollTop: null, find: "" }, recorder().actions);
  view.update({ source: "big", line: 2, scrollTop: null, find: "" });
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `Reader: ${ms.toFixed(1)} ms`);
  assert.equal(srcLines(host)[0].querySelector(".pv-src").textContent, line);
  view.destroy();
});

test("Befund Notizen: Loeschen braucht zwei Schritte, ein Tipp loescht nichts, Abbrechen nimmt zurueck", () => {
  const { host } = freshDom();
  const rec = recorder();
  const note = { id: `note_${"e".repeat(32)}`, projectId: PID, text: "privat",
    anchor: { kind: "op", op: "x", origPath: "/project1/x" }, createdAt: "2026-11-05T10:00:00Z", updatedAt: "2026-11-05T10:00:00Z" };
  const view = renderNotes(host, [{ note, resolved: { state: "unmatched", anchor: note.anchor, rel: null } }], null, rec.actions);
  const card = host.querySelector(".pv-note");
  const btn = (text) => [...card.querySelectorAll("button")].find((b) => b.textContent === text) || null;
  const confirm = card.querySelector(".pv-note-confirm");
  const live = card.querySelector("[aria-live]");
  btn("Löschen").click();
  assert.equal(rec.of("deleteNote").length, 0, "ein Tipp loescht nicht");
  assert.ok(confirm, "Rueckfrage vorhanden");
  assert.equal(confirm.hidden, false);
  assert.equal(btn("Löschen").hidden, true, "an der Stelle des Knopfs steht nichts zum Doppeltippen");
  assert.ok(live.textContent.includes("nicht rückgängig"));
  assert.notEqual(btn("Wirklich löschen").parentNode, btn("Löschen").parentNode, "Bestaetigen in eigener Zeile");
  btn("Abbrechen").click();
  assert.equal(confirm.hidden, true);
  assert.equal(btn("Löschen").hidden, false);
  assert.equal(live.textContent, "");
  assert.equal(rec.of("deleteNote").length, 0);
  btn("Löschen").click();
  btn("Wirklich löschen").click();
  btn("Wirklich löschen").click();
  assert.deepEqual(rec.of("deleteNote"), [["deleteNote", note.id]], "genau einmal gemeldet");
  const block = viewsBlockCss();
  assert.match(cssRule(block, ".pv-note-confirm[hidden]"), /display: none/, ".pv-btnrow (flex) darf [hidden] nicht schlagen");
  view.destroy();
});

test("Befund Marken: Tag-Zeichen, Variation Selectors, CGJ, Fueller, U+0600-0605, U+2028/2029 werden sichtbar", () => {
  const cps = [0xe0041, 0xe007f, 0xfe00, 0xfe0f, 0xe0100, 0xe01ef, 0x034f, 0x115f, 0x1160, 0x3164, 0xffa0, 0x0600, 0x0605,
    0x2028, 0x2029, 0x202e, 0x2066, 0x200b, 0xfeff, 0x00ad, 0x0007, 0x0085];
  for (const cp of cps) {
    const ch = String.fromCodePoint(cp);
    assert.equal(pdom.hasMarked(`a${ch}b`), true, `U+${cp.toString(16)}`);
    const parts = splitMarked(`a${ch}b`);
    assert.deepEqual(parts.map((p) => [p.text, p.marked]), [["a", false], [ch, true], ["b", false]], `U+${cp.toString(16)} unzerteilt`);
    assert.equal(displayText(`a${ch}b`), `a<U+${cp.toString(16).toUpperCase().padStart(4, "0")}>b`);
  }
  for (const plain of ["a\tb", "a\nb", "größe", "é", "日本", "😀"]) assert.equal(pdom.hasMarked(plain), false, JSON.stringify(plain));
  // Code Reader: versteckter ASCII-Text aus Tag-Zeichen bekommt je Zeichen eine Marke, der Text bleibt exakt.
  const hidden = `secret = 'a${String.fromCodePoint(0xe0041)}${String.fromCodePoint(0xe0042)}'`;
  const doc = bigDoc(3).doc;
  doc.codeSources = [source("big", "textDAT", `x = 1\n${hidden}\n`)];
  const { host } = freshDom();
  const view = renderCode(host, modelOf(doc), { source: "big", line: 2, scrollTop: null, find: "" }, recorder().actions);
  const row = srcLines(host)[1];
  assert.equal(row.querySelector(".pv-src").textContent, hidden);
  assert.deepEqual([...row.querySelectorAll(".pv-ctl")].map((s) => s.getAttribute("data-cp")), ["E0041", "E0042"]);
  view.destroy();
});

test("Befund Tabelle/Zoom: Tabellenzeilen auf CODE_ROW_PX ausgelegt, Code Reader laesst Pinch-Zoom zu", () => {
  const block = viewsBlockCss();
  const table = cssRule(block, ".pv-table");
  assert.match(table, /border-collapse: separate/);
  assert.match(table, /border-spacing: 0/);
  const cell = cssRule(block, ".pv-table td, .pv-table th");
  const inner = Number(/(?:^|[ ;{])height: (\d+)px/.exec(cell)[1]);
  assert.match(cell, /border-width: 0 1px 1px 0/);
  assert.match(cell, /line-height: 19px/);
  assert.equal(inner + 1, CODE_ROW_PX, "Inhalt + unterer Rand = CODE_ROW_PX");
  assert.match(cssRule(block, ".pv-cell-in"), /height: 19px/);
  assert.match(cssRule(block, "div.pv-ln"), new RegExp(`height: ${CODE_ROW_PX}px`));
  assert.match(cssRule(block, ".pv-code-scroll"), /touch-action: pan-x pan-y pinch-zoom/);
  // DOM: jede Zelle traegt den festen Innenkasten mit dem exakten Text.
  const { host } = freshDom();
  const view = renderCode(host, modelOf(codeDoc()), { source: "lookup" }, recorder().actions);
  const tds = [...host.querySelectorAll(".pv-table td")];
  assert.ok(tds.length === 6 && tds.every((td) => td.firstElementChild && td.firstElementChild.className === "pv-cell-in"));
  assert.deepEqual(tds.map((td) => td.textContent), ["key", "value", "alpha", "1", "opacity", "0.5"]);
  view.destroy();
});
