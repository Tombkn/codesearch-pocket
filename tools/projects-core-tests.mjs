// Kernmodule der Pocket-Projekte ohne Oberflaeche: c14n, Schema, Pruefpipeline, Speicher, Modell, Notizanker.
// Belegt Node-Verhalten - kein iPhone- und kein echter Browser-Nachweis: IdbStore laeuft hier gegen FakeIDB, eine
// kleine Nachbildung der IndexedDB-Ereignisfolge. Echte Engines prueft erst der Geraetetest.
//
// Aufruf: node tools/projects-core-tests.mjs                 Tests
//         node tools/projects-core-tests.mjs --write-fixtures  tools/fixtures/pocket/js-vectors/ neu schreiben
//
// Der Paketbauer hier bildet die Paketform von cs_pocket_export.build_package nach (alle Parameterfelder,
// truncation, Extension-Felder als {value}, Warnungen aus der geschlossenen Liste mit Vorlagentext, report.counts
// unabhaengig nachgezaehlt). Zusaetzlich prueft der Test echte Exporter-Ausgabe aus tools/fixtures/pocket/py-interop
// (make_interop.py) - die erste Bauwelle war mit nachgebauten Paketen gruen und lehnte echte ab.
//
// Testdaten sind synthetisch oder aus dem oeffentlichen Tutorial nachgebaut (Weichzeichner); tools/fixtures ist
// ueber GitHub Pages oeffentlich, darum nie private Projektquellen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import {
  canonicalize, canonicalBytes, CanonicalError, codepointLength, lineCount, splitLines, sha256Hex, decodeUtf8Strict,
} from "../js/projects/c14n.js";
import {
  validate, validateEntry, sortPackageLists, absPath, relPath, CONTENT_FIELDS, LIMITS, compareTuples, SORT_KEYS, objectKey,
  categoryOf, CATEGORIES, WARNING_SEVERITY, packageCounts,
} from "../js/projects/schema.js";
import { verifyPackage, verifyStored, POCKET_MAX_BYTES, diagnoseNonCanonical } from "../js/projects/verify.js";
import {
  MemoryStore, IdbStore, ProjectFlights, StoreError, DB_NAME, STORE_NAMES, projectDisplayName, NOTES_FORMAT,
  createProjectStore, CLEAR_EPOCH_KEY,
} from "../js/projects/store.js";
import { createModel, describeValue, knownValue, SEARCH_LIMITS } from "../js/projects/model.js";
import { createAnchor, resolveAnchor, validateAnchor, anchorIntact } from "../js/projects/anchors.js";

const ROOT = new URL("../", import.meta.url);
const VECTOR_DIR = new URL("tools/fixtures/pocket/js-vectors/", ROOT);
const INTEROP_DIR = new URL("tools/fixtures/pocket/py-interop/", ROOT);
const PY_DIR = new URL("tools/fixtures/pocket/", ROOT);
const MY_MODULES = ["c14n", "schema", "verify", "store", "model", "anchors"];

const PID = "psp_0123456789abcdef0123456789abcdef";
const PID2 = "psp_fedcba9876543210fedcba9876543210";
const nodeSha = (data) => createHash("sha256").update(data).digest("hex");
const clone = (value) => structuredClone(value);

// ================================================================== Paketbauer (Paketform des Python-Exporters)

const CAPABILITIES = {
  positions: true, annotations: true, wires: true, compConnectors: "unverified-live", docks: true, customPars: true,
  builtinPars: "nondefault+mandatory", effectiveValues: false, codeText: true, tables: "cells-capped",
  analysis: "codemodel-ast-static", references: "captured+static", storage: false, channels: false, media: false,
};

// Vorlagentexte wie cs_pocket_export.WARNING_CODES. Pocket prueft sie nicht (Vertrag 16: nur Code und Schwere),
// der Python-Validator schon - mit diesen Texten nehmen beide Seiten dieselben JS-Vektoren an.
const WARNING_TEXT = {
  "root.slash": "Export ab / gewählt: der ganze Projektbaum ist im Umfang.",
  "analysis.parse": "Quelle ist kein lesbares Python; Analyse nur zeilenweise.",
  "value.size": "Wert, Expression oder Text länger als 65.536 Zeichen; nicht übertragen.",
  "secret.value": "Wert oder Text wegen eines Geheimnis-Funds nicht übertragen.",
  "secret.source": "Code-Quelle wegen eines Geheimnis-Funds nicht übertragen.",
  "source.truncated": "Tabelle gekürzt: mehr als 100.000 Zellen oder Zelle länger als 65.536 Zeichen.",
  "capture.retried": "Die Erfassung wurde wiederholt, bis zwei Durchläufe übereinstimmten.",
};

function warning(code, { op: opRel = null, source: key = null, count = null } = {}) {
  return { code, severity: WARNING_SEVERITY[code], message: WARNING_TEXT[code], op: opRel, source: key, count };
}

function op(rel, opType, family, extra = {}) {
  const name = rel === "" ? extra.name : rel.split("/").pop();
  const parent = rel === "" ? null : rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
  const isCOMP = family === "COMP";
  return {
    rel, path: "", name, opType, family, parent, isCOMP, role: "op",
    node: { x: 0, y: 0, w: 130, h: 90 }, color: ["0.55", "0.55", "0.55"], comment: "", tags: [],
    flags: isCOMP ? { bypass: false, lock: false, display: false, render: false, viewer: false, allowCooking: true }
      : { bypass: false, lock: false, display: false, render: false, viewer: false },
    dock: null, children: isCOMP ? 0 : null, connectors: isCOMP ? { in: [], out: [] } : null, extensions: [],
    shortcuts: { parent: null, global: null }, internalShortcuts: [],
    ...extra,
  };
}

// Extension wie TD sie liest: object/name/promote als Parameter -> {value} (promote ist ein Toggle).
function ext(slot, object, name, promote = true) {
  return { slot, object: { value: object }, name: { value: name }, promote: { value: promote } };
}

// Alle 22 Parameterfelder wie der Exporter (4.11); default/help/menu/range nur bei Custom Pars belegt.
function par(opRel, name, extra = {}) {
  return {
    op: opRel, name, label: name, page: "Common", custom: false, style: "Str", tuplet: name, vecIndex: 0,
    mode: "constant", value: { t: "str", v: "" }, help: null, storedConstant: null, expr: null, bindExpr: null,
    export: null, default: null, isDefault: false, readOnly: false, password: false, menu: null, range: null,
    effective: null,
    ...extra,
  };
}

function source(key, datType, text, extra = {}) {
  return {
    key, op: key, datType, language: "python", languageFrom: "role", roles: [{ kind: "module" }], status: "exact",
    text, table: null, truncation: null, chars: codepointLength(text), lines: lineCount(text),
    sha256: nodeSha(Buffer.from(text, "utf8")), duplicateOf: null, file: null,
    ...extra,
  };
}

// Tabelle: chars = Codepoints aller Zellen, lines = Zeilen, sha256 ueber die kanonische Tabelle (Exporter).
function tableSource(key, table, extra = {}) {
  let chars = 0;
  for (const row of table) for (const cell of row) chars += codepointLength(cell);
  return source(key, "tableDAT", "", {
    language: "table", languageFrom: "par", roles: [], text: null, table, chars, lines: table.length,
    sha256: nodeSha(canonicalize(table)), ...extra,
  });
}

function baseDoc({ root, rootType = "baseCOMP", rootName, projectName = "Synthetisch", projectId = PID }) {
  return {
    format: "codesearch.pocket.snapshot", schemaVersion: 1, schemaMinor: 0, projectId,
    revision: { id: "", contentHash: "", analysisHash: "", basedOnSeq: 0 },
    projectName, exportedAt: "2026-11-05T10:00:00Z",
    source: { tool: "CodeSearch", toolVersion: "1.11.0", exporterVersion: 1, tdBuild: "2025.33230", tdVersion: "099",
      os: "windows", projectFile: "CodeSearch_Tutorial.toe" },
    exportRoot: { path: root, opType: rootType, name: rootName, explicitScopes: [] },
    context: { selection: null, frozenAt: "2026-11-05T10:00:00Z", entry: "comp-menu" },
    capture: { startedAt: "2026-11-05T10:00:00Z", finishedAt: "2026-11-05T10:00:01Z", frames: 100, slices: 4,
      longFrames: { count: 0, maxMs: 0 }, retries: 0, consistency: "stable-2pass", signature: `sha256:${"a".repeat(64)}` },
    capabilities: { ...CAPABILITIES },
    operators: [], annotations: [], connections: [], codeSources: [], parameters: [], references: [], externalDependencies: [],
    analysis: { provenance: { engine: "CodeSearch CodeModel + StateAtlas", toolVersion: "1.11.0", static: true }, code: [] },
    warnings: [],
    report: {
      counts: { operators: 0, comps: 0, annotations: 0, connections: 0, codeSources: 0, codeChars: 0, parameters: 0,
        references: 0, external: 0, duplicates: 0 },
      omissions: [], secrets: { rules: "cspocket-secrets-1", omittedSources: 0, omittedValues: 0, byRule: [],
        confirmedFalsePositives: 0 },
      limits: {}, durationMs: 12,
    },
    integrity: { algorithm: "sha256", canonicalization: "cspocket-c14n-1", value: "" },
  };
}

// report.counts unabhaengig vom Modul gezaehlt (sonst pruefte schema.packageCounts sich selbst).
function countsOf(doc) {
  const transferred = doc.codeSources.filter((s) => s.status === "exact" || s.status === "truncated");
  return {
    operators: doc.operators.length,
    comps: doc.operators.filter((o) => o.isCOMP).length,
    annotations: doc.annotations.length,
    connections: doc.connections.length,
    codeSources: doc.codeSources.length,
    codeChars: transferred.reduce((sum, s) => sum + (Number.isInteger(s.chars) ? s.chars : 0), 0),
    parameters: doc.parameters.length,
    references: doc.references.length,
    external: doc.externalDependencies.length,
    duplicates: doc.codeSources.filter((s) => s.duplicateOf !== null).length,
  };
}

// Hashes wie im Vertrag 4.2/5 - unabhaengig mit node:crypto statt WebCrypto gerechnet.
function seal(doc, { sort = true } = {}) {
  if (sort) sortPackageLists(doc);
  for (const o of doc.operators) o.path = absPath(doc.exportRoot.path, o.rel);
  doc.report.counts = countsOf(doc);
  const content = {};
  for (const key of CONTENT_FIELDS) content[key] = doc[key];
  doc.revision.contentHash = `sha256:${nodeSha(canonicalize(content))}`;
  doc.revision.analysisHash = `sha256:${nodeSha(canonicalize(doc.analysis.code))}`;
  doc.revision.id = `rev_${nodeSha(`${doc.projectId}\n${doc.revision.contentHash}`).slice(0, 32)}`;
  return reseal(doc);
}

function reseal(doc) {
  const { integrity, ...rest } = doc;
  integrity.value = nodeSha(canonicalize(rest));
  const text = canonicalize(doc);
  return { doc, text, bytes: Buffer.from(text, "utf8") };
}

// Referenzexport "Weichzeichner" (Vertrag 17), nachgebaut aus dem oeffentlichen Tutorial.
function weichzeichnerDoc() {
  const doc = baseDoc({ root: "/project1/CodeSearch_Tutorial/Weichzeichner", rootName: "Weichzeichner", projectName: "Weichzeichner" });
  doc.operators = [
    op("", "baseCOMP", "COMP", {
      name: "Weichzeichner", node: { x: 2200, y: 3400, w: 200, h: 140 }, children: 3,
      connectors: { in: [{ index: 0, inOP: "in1" }], out: [{ index: 0, outOP: "out1" }] },
    }),
    op("in1", "inTOP", "TOP", { node: { x: 200, y: 0, w: 130, h: 90 } }),
    op("blur", "blurTOP", "TOP", { node: { x: 600, y: 0, w: 130, h: 90 } }),
    op("out1", "outTOP", "TOP", { node: { x: 1000, y: 0, w: 130, h: 90 } }),
  ];
  doc.annotations = [{
    rel: "karte_grenze", parent: "", name: "karte_grenze", mode: "annotate", title: "COMP-GRENZE M-7 Weichzeichner",
    body: "Innen drei Ops.\nAussen mix und bild_null.", node: { x: 0, y: -200, w: 1400, h: 700 },
    color: ["0.3", "0.3", "0.3", "1.0"], enclosed: ["in1", "blur", "out1"],
  }];
  doc.connections = [
    { kind: "wire", from: { op: "in1" }, fromIndex: 0, to: { op: "blur" }, toIndex: 0 },
    { kind: "wire", from: { op: "blur" }, fromIndex: 0, to: { op: "out1" }, toIndex: 0 },
    { kind: "wire", from: { external: "/project1/CodeSearch_Tutorial/mix" }, fromIndex: 0, to: { op: "" }, toIndex: 0 },
    { kind: "wire", from: { op: "" }, fromIndex: 0, to: { external: "/project1/CodeSearch_Tutorial/bild_null" }, toIndex: 0 },
  ];
  doc.parameters = [
    par("", "Staerke", {
      label: "Stärke", page: "Weichzeichner", custom: true, style: "Float", value: { t: "float", v: "4.0" },
      default: { t: "float", v: "4.0" }, isDefault: true, help: "Staerke des Weichzeichners.",
      range: { min: "0.0", max: "1.0", clampMin: true, clampMax: false, normMin: "0.0", normMax: "20.0" },
    }),
    par("blur", "size", {
      label: "Size", page: "Blur", style: "Int", mode: "bind", value: { t: "unknown", reason: "mode-bind" },
      storedConstant: { t: "int", v: "7" }, bindExpr: "parent().par.Staerke",
    }),
    par("in1", "label", { mode: "expression", value: { t: "unknown", reason: "mode-expression" }, expr: "me.name",
      storedConstant: { t: "str", v: "" }, isDefault: true }),
    par("out1", "label", { mode: "expression", value: { t: "unknown", reason: "mode-expression" }, expr: "me.name",
      storedConstant: { t: "str", v: "" }, isDefault: true }),
  ];
  doc.references = [{
    from: { op: "blur", source: null, line: null, par: "size" }, kind: "par-bind", text: "parent().par.Staerke",
    target: { op: "" }, certainty: "static", code: null,
  }];
  doc.externalDependencies = [
    { path: "/project1/CodeSearch_Tutorial/bild_null", opType: "nullTOP", kinds: ["wire"], count: 1, included: false },
    { path: "/project1/CodeSearch_Tutorial/mix", opType: null, kinds: ["wire"], count: 1, included: false },
  ];
  return doc;
}

const HOST_LINES = [
  '"""Synthetisches Testmodul fuer Pocket Projects (keine echte Projektquelle)."""',
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

function facts() {
  return { params: [], returns: [], effects: [], pulls: [], parReads: [], parWrites: [] };
}

function symbol(cls, name, line, end, params = []) {
  return {
    symbol: cls ? `${cls}.${name}` : `<module>.${name}`, class: cls, name, kind: cls ? "method" : "function", line, end,
    doc: "", decorators: [], params, facts: facts(),
  };
}

function site(sym, line, attr, via, extra = {}) {
  return { symbol: sym, line, attr, type: "call", via, op: null, shortcut: null, name: null, text: null, dynamic: false, ...extra };
}

// StateAtlas in der Form der echten Analyse: Attribute heissen "Klasse.name" (class_name), Methoden tragen das
// Praefix "pocket:<rel>:". Der Leser in Zeile 15 fehlt absichtlich in accesses - er kommt nur aus dem StateAtlas.
function hostEntry() {
  return {
    classes: [
      { name: "Mixer", line: 4, end: 15, states: [{ name: "ownerComp", line: 6 }, { name: "level", line: 7 }] },
      { name: "Recorder", line: 18, end: 28, states: [{ name: "ownerComp", line: 20 }, { name: "count", line: 21 }] },
    ],
    symbols: [
      symbol("Mixer", "__init__", 5, 7, ["ownerComp"]), symbol("Mixer", "Mix", 9, 12, ["value"]),
      symbol("Mixer", "_apply", 14, 15), symbol("Recorder", "__init__", 19, 21, ["ownerComp"]),
      symbol("Recorder", "Record", 23, 25), symbol("Recorder", "_apply", 27, 28), symbol(null, "helper", 31, 33, ["x"]),
    ],
    sites: [
      site("Mixer.Mix", 11, "_apply", "self"),
      site("Recorder.Record", 25, "_apply", "self"),
      site("Recorder._apply", 28, "Mix", "parentshortcut", { shortcut: "Host" }),
      site("<module>.helper", 33, "Run", "opof", { op: "engine" }),
    ],
    accesses: [
      { symbol: "Mixer.__init__", name: "level", how: "init", line: 7, conf: "sicher" },
      { symbol: "Mixer.Mix", name: "level", how: "write", line: 10, conf: "sicher" },
      { symbol: "Mixer.Mix", name: "level", how: "read", line: 12, conf: "sicher" },
      { symbol: "Recorder.__init__", name: "count", how: "init", line: 21, conf: "sicher" },
      { symbol: "Recorder.Record", name: "count", how: "mutate", line: 24, conf: "sicher" },
      { symbol: "Recorder._apply", name: "count", how: "read", line: 28, conf: "sicher" },
    ],
    ast: [{ symbol: "Mixer.Mix", guards: [], calls: [{ line: 11, attr: "_apply", args: [], kw: [] }], locals: [] }],
    stateAtlas: {
      states: [{
        id: "pocket:|attribute|Mixer.level", owner: "pocket:", kind: "attribute", name: "Mixer.level", class_name: "Mixer",
        readers: [{ source: "pocket:HostExt", line: 15, method: "pocket:HostExt:Mixer._apply", access: "read", confidence: "static" }],
        writers: [{ source: "pocket:HostExt", line: 10, method: "pocket:HostExt:Mixer.Mix", access: "write", confidence: "static" }],
        coverage: [], source: "pocket:HostExt", line: 7,
      }],
      calls: [], coverage: [], symbols: [{ id: "pocket:HostExt:Mixer.Mix" }], errors: [], revision: `sha256:${"b".repeat(64)}`,
    },
  };
}

function codeDoc({ hostText = HOST_TEXT, projectName = "Host" } = {}) {
  const doc = baseDoc({ root: "/project1/Host", rootName: "Host", projectName });
  doc.operators = [
    op("", "baseCOMP", "COMP", {
      name: "Host", children: 7, shortcuts: { parent: { value: "Host" }, global: null },
      extensions: [ext(0, "op('./HostExt').module.Mixer(me)", "Mixer")],
    }),
    op("HostExt", "textDAT", "DAT", { node: { x: 0, y: 200, w: 130, h: 90 } }),
    op("broken", "textDAT", "DAT", { node: { x: 200, y: 200, w: 130, h: 90 } }),
    op("engine", "baseCOMP", "COMP", {
      node: { x: 400, y: 0, w: 130, h: 90 }, children: 1,
      extensions: [ext(0, "op('./EngineExt').module.Engine(me)", "Engine")],
    }),
    op("engine/EngineExt", "textDAT", "DAT"),
    op("target", "levelTOP", "TOP", { node: { x: 600, y: 0, w: 130, h: 90 } }),
    op("ghost", "nullTOP", "TOP", { node: { unknown: "not-readable" } }),
    op("lookup", "tableDAT", "DAT", { node: { x: 800, y: 0, w: 130, h: 90 } }),
    op("secrets_dat", "textDAT", "DAT", { node: { x: 1000, y: 0, w: 130, h: 90 } }),
  ];
  doc.connections = [
    { kind: "wire", from: { op: "engine" }, fromIndex: 0, to: { op: "target" }, toIndex: 0 },
    { kind: "wire", from: { op: "target" }, fromIndex: 0, to: { op: "ghost" }, toIndex: 0 },
  ];
  doc.codeSources = [
    source("HostExt", "textDAT", hostText, { roles: [{ kind: "extension", comp: "", slot: 0 }] }),
    source("broken", "textDAT", "x = 1\n"),
    source("engine/EngineExt", "textDAT", ENGINE_TEXT, { roles: [{ kind: "extension", comp: "engine", slot: 0 }] }),
    tableSource("lookup", [["key", "value"], ["alpha", "1"], ["opacity", "0.5"]]),
    source("secrets_dat", "textDAT", "", { status: "omitted-secret", text: null, chars: null, lines: null, sha256: null }),
  ];
  doc.parameters = [
    par("", "Gain", { custom: true, style: "Float", page: "Host", value: { t: "float", v: "0.5" }, default: { t: "float", v: "1.0" } }),
    par("", "Apikey", { custom: true, style: "Str", page: "Host", value: { t: "str", v: null, omitted: "secret" }, password: true }),
    par("target", "opacity", { style: "Float", value: { t: "float", v: "1e-05" } }),
    par("target", "bypass", { style: "Toggle", value: { t: "bool", v: "0" } }),
  ];
  const ref = (line, kind, text, target, code) => ({
    from: { op: "HostExt", source: "HostExt", line, par: null }, kind, text, target, certainty: "static", code,
  });
  doc.references = [
    ref(15, "code-op", "op('target')", { op: "target" }, { art: "call", receiver: null, name: "target" }),
    ref(28, "code-shortcut", "parent.Host", { op: "" }, { art: "short", receiver: "parent", name: "Host" }),
    ref(32, "code-op", "op('/project1/outside')", { external: "/project1/outside" }, { art: "call", receiver: null, name: "/project1/outside" }),
    ref(33, "code-op", "op('engine')", { op: "engine" }, { art: "call", receiver: null, name: "engine" }),
    { from: { op: "", source: null, line: null, par: "ext0object" }, kind: "ext-object", text: "op('./HostExt').module.Mixer(me)",
      target: { op: "HostExt" }, certainty: "captured", code: null },
    { from: { op: "engine", source: null, line: null, par: "ext0object" }, kind: "ext-object",
      text: "op('./EngineExt').module.Engine(me)", target: { op: "engine/EngineExt" }, certainty: "captured", code: null },
  ];
  doc.externalDependencies = [{ path: "/project1/outside", opType: null, kinds: ["code-op"], count: 1, included: false }];
  doc.analysis.code = [
    { source: "HostExt", entry: hostEntry() },
    { source: "broken", entry: { classes: "kaputt" } },
    { source: "engine/EngineExt", entry: {
      classes: [{ name: "Engine", line: 1, end: 3, states: [] }], symbols: [symbol("Engine", "Run", 2, 3, ["x"])],
      sites: [], accesses: [], ast: [], stateAtlas: { states: [], calls: [], coverage: [], symbols: [], errors: [], revision: "" },
    } },
  ];
  doc.warnings = [warning("secret.source", { op: "secrets_dat", source: "secrets_dat", count: 1 })];
  doc.report.secrets = { ...doc.report.secrets, omittedSources: 1, omittedValues: 1, byRule: [{ rule: "ghp", count: 2 }] };
  return doc;
}

function rootSlashDoc() {
  const doc = baseDoc({ root: "/", rootName: "", projectName: "Ganzes Projekt", projectId: PID2 });
  doc.operators = [
    op("", "baseCOMP", "COMP", { name: "", children: 1 }),
    op("project1", "containerCOMP", "COMP", { children: 1 }),
    op("project1/noise1", "noiseTOP", "TOP"),
  ];
  doc.warnings = [warning("root.slash")];
  return doc;
}

function prototypeNamesDoc() {
  const doc = baseDoc({ root: "/project1/proto", rootName: "proto", projectName: "Namen" });
  const text = "class toString:\n    def constructor(self):\n        return self.__proto__()\n\n    def __proto__(self):\n        return 1\n";
  doc.operators = [
    op("", "baseCOMP", "COMP", { name: "proto", children: 4 }),
    op("constructor", "baseCOMP", "COMP", { children: 1 }),
    op("constructor/toString", "textDAT", "DAT"),
    op("hasOwnProperty", "nullTOP", "TOP"),
    op("__proto__", "nullTOP", "TOP"),
    op("toString", "nullTOP", "TOP"),
  ];
  doc.codeSources = [source("constructor/toString", "textDAT", text)];
  doc.parameters = [par("__proto__", "constructor"), par("toString", "__proto__")];
  doc.analysis.code = [{ source: "constructor/toString", entry: {
    classes: [{ name: "toString", line: 1, end: 6, states: [] }],
    symbols: [symbol("toString", "constructor", 2, 3), symbol("toString", "__proto__", 5, 6)],
    sites: [site("toString.constructor", 3, "__proto__", "self")],
    accesses: [], ast: [], stateAtlas: { states: [], calls: [], coverage: [], symbols: [], errors: [], revision: "" },
  } }];
  return doc;
}

// Zwei Text-DATs mit gleichem Text: die zweite (nach key) zeigt per duplicateOf auf die erste (Vertrag 4.10).
function duplicateDoc() {
  const doc = weichzeichnerDoc();
  doc.operators[0].children = 5;
  doc.operators.push(op("a_dat", "textDAT", "DAT"), op("b_dat", "textDAT", "DAT"));
  const text = "print('gleich')\n";
  doc.codeSources = [source("a_dat", "textDAT", text), source("b_dat", "textDAT", text, { duplicateOf: "a_dat" })];
  return doc;
}

// Platzhalter statt Text (Vertrag 8/9): geheime oder zu lange Kommentare, Shortcuts, Ext-Objekte und Annotationen.
// Der Rest des Pakets bleibt lesbar - Pocket darf es deshalb nicht ablehnen.
function markersDoc() {
  const doc = weichzeichnerDoc();
  const root = doc.operators[0];
  root.comment = { omitted: "secret" };
  root.shortcuts = { parent: { omitted: "secret" }, global: { unknown: "mode-expression", expr: "me.par.Name.eval()" } };
  root.extensions = [{ slot: 0, object: { unknown: "mode-expression", expr: "op('./X').module.X(me)" }, name: { value: "" }, promote: { value: false } }];
  root.internalShortcuts = [{ slot: 0, shortcut: "Store", op: { omitted: "secret" } }, { slot: 1, shortcut: "Big", op: { unknown: "size" } }];
  doc.operators[2].comment = { unknown: "size" };
  const a = doc.annotations[0];
  a.title = { omitted: "secret" };
  a.body = { unknown: "size" };
  a.mode = { unknown: "mode-expression", expr: "me.par.Mode" };
  a.color = { unknown: "mode-expression", expr: "parent().par.Farbe" };
  doc.warnings = [warning("secret.value", { op: "", count: 3 }), warning("value.size", { op: "", count: 2 })];
  doc.report.secrets = { ...doc.report.secrets, omittedValues: 3, byRule: [{ rule: "ghp", count: 3 }] };
  return doc;
}

// op(<Ausdruck>): Ziel erst zur Laufzeit (Vertrag 4.12, Stand 09:15). code bleibt bei code-* Pflicht: name "" plus
// dynamic:true und der Grund aus der Analyse; target {unresolved:"dynamic"}, certainty unknown (cs_pocket_capture).
const DYN_TEXT = "class Dyn:\n    def go(self):\n        return op(self.name).Run()\n";
const DYN_CODE = Object.freeze({ art: "call", receiver: null, name: "", dynamic: true, reason: "op(<Ausdruck>)" });

function dynamicDoc() {
  const doc = weichzeichnerDoc();
  doc.operators[0].children = 4;
  doc.operators.push(op("dyn", "textDAT", "DAT"));
  doc.codeSources = [source("dyn", "textDAT", DYN_TEXT)];
  doc.references.push({ from: { op: "dyn", source: "dyn", line: 3, par: null }, kind: "code-op", text: "op(self.name)",
    target: { unresolved: "dynamic" }, certainty: "unknown", code: { ...DYN_CODE } });
  doc.analysis.code = [{ source: "dyn", entry: {
    classes: [{ name: "Dyn", line: 1, end: 3, states: [] }], symbols: [symbol("Dyn", "go", 2, 3)],
    sites: [site("Dyn.go", 3, "Run", "dynamic")], accesses: [{ symbol: "Dyn.go", name: "name", how: "read", line: 3, conf: "sicher" }],
    ast: [], stateAtlas: { states: [], calls: [], coverage: [], symbols: [], errors: [], revision: "" },
  } }];
  return doc;
}

// Pruefbefund: fester und dynamischer Verweis auf derselben Zeile (Form wie die echte Analyse). Seit dynamische
// Verweise ein code-Objekt tragen, duerfen sie eine Aufrufstelle nie mitentscheiden - sonst wird "parent().Mix"
// mehrdeutig, nur weil im Argument parent(self.n) steht. Zeile 7 prueft den Rueckfall auf dieselbe Quelle.
const MIXED_TEXT = [
  "class Mix:", "    def go(self):", "        parent().Mix(parent(self.n))", "        op.Global.Run(getattr(op, self.name))",
  "    def later(self):", "        p = parent()", "        p.Mix()", "",
].join("\n");
const GLOBAL_PATH = "/project1/glob";

function mixedDynamicDoc() {
  const doc = weichzeichnerDoc();
  doc.operators[0].children = 4;
  doc.operators.push(op("mix", "textDAT", "DAT"));
  doc.codeSources = [source("mix", "textDAT", MIXED_TEXT)];
  const ref = (line, kind, text, target, certainty, code) => ({ from: { op: "mix", source: "mix", line, par: null }, kind, text, target, certainty, code });
  doc.references.push(
    ref(3, "code-parent", "parent()", { op: "" }, "static", { art: "parent", receiver: null, name: "1" }),
    ref(3, "code-parent", "parent(self.n)", { unresolved: "dynamic" }, "unknown", { art: "parent", receiver: null, name: "", dynamic: true, reason: "parent(<Ausdruck>)" }),
    ref(4, "code-shortcut", "op.Global", { external: GLOBAL_PATH }, "static", { art: "short", receiver: "op", name: "Global" }),
    ref(4, "code-shortcut", "getattr(op, self.name)", { unresolved: "dynamic" }, "unknown", { art: "short", receiver: "op", name: "", dynamic: true, reason: "getattr mit gebautem Namen" }),
    ref(6, "code-parent", "parent()", { op: "" }, "static", { art: "parent", receiver: null, name: "1" }),
  );
  doc.externalDependencies.push({ path: GLOBAL_PATH, opType: null, kinds: ["code-shortcut"], count: 1, included: false });
  doc.analysis.code = [{ source: "mix", entry: {
    classes: [{ name: "Mix", line: 1, end: 7, states: [] }], symbols: [symbol("Mix", "go", 2, 4), symbol("Mix", "later", 5, 7)],
    sites: [site("Mix.go", 3, "Mix", "parent"), site("Mix.go", 4, "Run", "opshortcut"), site("Mix.later", 7, "Mix", "parent")],
    accesses: [], ast: [], stateAtlas: { states: [], calls: [], coverage: [], symbols: [], errors: [], revision: "" },
  } }];
  return doc;
}

// Gekuerzte Tabelle: status truncated, Pflichtfeld truncation, sha256/chars/lines ueber die behaltenen Zellen.
function truncatedDoc() {
  const doc = weichzeichnerDoc();
  doc.operators[0].children = 4;
  doc.operators.push(op("tabelle", "tableDAT", "DAT"));
  doc.codeSources = [tableSource("tabelle", [["key", "value"], ["alpha", "1"]], {
    status: "truncated", truncation: { rows: 3, cols: 2, keptRows: 2, keptCols: 2 },
  })];
  doc.warnings = [warning("source.truncated", { op: "tabelle", source: "tabelle", count: 1 })];
  return doc;
}

// Zu lange Expression bzw. zu langer Wert: expr null + omitted "size" bzw. value {t:"unknown", reason:"size"}.
function exprSizeDoc() {
  const doc = weichzeichnerDoc();
  doc.parameters.push(
    par("", "Long", { custom: true, page: "Custom", mode: "expression", value: { t: "unknown", reason: "mode-expression" },
      expr: null, omitted: "size", default: { t: "str", v: "" } }),
    par("", "Huge", { custom: true, page: "Custom", value: { t: "unknown", reason: "size" }, default: { t: "str", v: "" } }),
  );
  doc.warnings = [warning("value.size", { op: "", count: 2 })];
  return doc;
}

// Genau 32 Ebenen, an einer Stelle, die beide Validatoren frei lassen (stateAtlas.states eines Analyse-Eintrags):
// Wurzel 1, analysis 2, code 3, Eintrag 4, entry 5, stateAtlas 6, states 7, darin 25 Listen (8..32).
// Helper-COMP wie in TD-Projekten: COMP mit Tag ExtUtils, darin ein COMP und ein DAT (alle role "helper").
// Indizes vor dem Sortieren: 4 = ExtUtils, 5 = ExtUtils/inner, 6 = ExtUtils/inner/CustomParHelper.
function helperDoc() {
  const doc = weichzeichnerDoc();
  doc.operators[0].children = 4;
  doc.operators.push(op("ExtUtils", "baseCOMP", "COMP", { tags: ["ExtUtils"], role: "helper", children: 1 }));
  doc.operators.push(op("ExtUtils/inner", "baseCOMP", "COMP", { role: "helper", children: 1 }));
  doc.operators.push(op("ExtUtils/inner/CustomParHelper", "textDAT", "DAT", { role: "helper" }));
  return doc;
}

function deepDoc(levels = 25) {
  const doc = weichzeichnerDoc();
  doc.operators[0].children = 4;
  doc.operators.push(op("tief", "textDAT", "DAT"));
  doc.codeSources = [source("tief", "textDAT", "x = 1\n")];
  let nest = [];
  for (let i = 1; i < levels; i += 1) nest = [nest];
  doc.analysis.code = [{ source: "tief", entry: {
    classes: [], symbols: [], sites: [], accesses: [], ast: [],
    stateAtlas: { states: [nest], calls: [], coverage: [], symbols: [], errors: [], revision: "" },
  } }];
  return doc;
}

const bound = (sealed, seq) => ({ index: { projectId: sealed.doc.projectId, revisionId: sealed.doc.revision.id, seq } });

// ================================================================== Testvektoren (Vertrag 16)

function replaceOnce(text, from, to) {
  const at = text.indexOf(from);
  if (at === -1 || text.indexOf(from, at + 1) !== -1) throw new Error(`Vektor-Bau: "${from}" nicht genau einmal`);
  return text.slice(0, at) + to + text.slice(at + from.length);
}

const fail = (code, extra = {}) => ({ valid: false, code, category: categoryOf(code), ...extra });

function buildVectors() {
  const w = seal(weichzeichnerDoc());
  const out = [];
  const cases = [];
  const add = (file, data, expect, note) => out.push({ file, bytes: Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8"), expect, note });
  const mutated = (make, change, note, file, code) => {
    const doc = make();
    change(doc);
    add(file, seal(doc).text, fail(code), note);
  };
  add("valid-weichzeichner.json", w.text, { valid: true, ignored: [] }, "Referenzexport Weichzeichner (Tutorial, Vertrag 17)");
  add("valid-code-model.json", seal(codeDoc()).text, { valid: true, ignored: [] }, "zwei Klassen, Modulfunktion, Extensions mit {value}, kaputter Analyse-Eintrag");
  add("valid-root-slash.json", seal(rootSlashDoc()).text, { valid: true, ignored: [] }, "Export ab Root /");
  add("valid-prototype-names.json", seal(prototypeNamesDoc()).text, { valid: true, ignored: [] }, "Ops und Symbole constructor/toString/hasOwnProperty/__proto__");
  add("valid-depth-32.json", seal(deepDoc()).text, { valid: true, ignored: [] }, "genau 32 Ebenen (in stateAtlas.states)");
  add("valid-duplicate-source.json", seal(duplicateDoc()).text, { valid: true, ignored: [] }, "zweite Quelle mit gleichem Text: duplicateOf");
  add("valid-markers.json", seal(markersDoc()).text, { valid: true, ignored: [] }, "Platzhalter {omitted:secret}/{unknown:size}/{unknown,expr} statt Text");
  add("valid-dynamic-ref.json", seal(dynamicDoc()).text, { valid: true, ignored: [] }, "op(<Ausdruck>): code mit name \"\" plus dynamic/reason, target unresolved dynamic");
  const colorNull = weichzeichnerDoc();
  colorNull.operators[2].color = null;
  add("valid-color-null.json", seal(colorNull).text, { valid: true, ignored: [] }, "operators.color null (nicht lesbar, Vertrag 4.7)");
  const newerMinor = weichzeichnerDoc();
  newerMinor.schemaMinor = 1;
  newerMinor.warnings = [{ ...warning("capture.retried"), code: "capture.zukunft" }];
  add("valid-warning-newer-minor.json", seal(newerMinor).text, { valid: true, ignored: ["/warnings/0/code"] }, "Warncode einer neueren Minor-Version: nennen statt ablehnen (4.1)");
  add("valid-table-truncated.json", seal(truncatedDoc()).text, { valid: true, ignored: [] }, "gekuerzte Tabelle mit truncation");
  add("valid-expr-size.json", seal(exprSizeDoc()).text, { valid: true, ignored: [] }, "Expression/Wert zu lang: omitted size bzw. unknown size");
  const t = w.text;
  // encoding
  add("invalid-bom.json", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), w.bytes]), fail("encoding.bom"), "UTF-8-BOM");
  add("invalid-utf16.json", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(t, "utf16le")]), fail("encoding.utf8"), "UTF-16LE-Datei");
  const raw = Buffer.from(t, "utf8");
  const at = raw.indexOf(Buffer.from("Weichzeichner"));
  add("invalid-utf8.json", Buffer.concat([raw.subarray(0, at), Buffer.from([0xc3, 0x28]), raw.subarray(at + 1)]), fail("encoding.utf8"), "ungueltiges UTF-8 (C3 28)");
  add("invalid-surrogate-utf8.json", Buffer.concat([raw.subarray(0, at), Buffer.from([0xed, 0xa0, 0x80]), raw.subarray(at + 1)]), fail("encoding.utf8"), "Surrogat roh als CESU-Bytes");
  // json
  add("invalid-truncated.json", t.slice(0, t.length - 7), fail("json.syntax"), "abgeschnitten");
  add("invalid-nan.json", replaceOnce(t, '"retries":0', '"retries":NaN'), fail("json.syntax"), "NaN ist kein JSON (Python: json.constant)");
  add("invalid-duplicate-same.json", replaceOnce(t, '"schemaMinor":0', '"schemaMinor":0,"schemaMinor":0'), fail("json.duplicate-key"), "doppelter Schluessel, gleicher Wert");
  add("invalid-duplicate-diff.json", replaceOnce(t, '"schemaMinor":0', '"schemaMinor":5,"schemaMinor":0'), fail("json.duplicate-key"), "doppelter Schluessel, anderer Wert");
  add("invalid-float-1.0.json", replaceOnce(t, '"exporterVersion":1', '"exporterVersion":1.0'), fail("json.number"), "1.0");
  add("invalid-float-1e2.json", replaceOnce(t, '"frames":100', '"frames":1e2'), fail("json.number"), "1e2");
  add("invalid-minus-zero.json", replaceOnce(t, '"retries":0', '"retries":-0'), fail("json.number"), "-0");
  add("invalid-number-float.json", replaceOnce(t, '"retries":0', '"retries":0.5'), fail("json.number"), "Gleitkommazahl");
  add("invalid-number-big.json", replaceOnce(t, '"retries":0', '"retries":9007199254740993'), fail("json.int-range"), "jenseits 2^53-1");
  add("invalid-surrogate-value.json", replaceOnce(t, '"projectName":"Weichzeichner"', '"projectName":"\\ud800"'), fail("json.surrogate"), "einzelnes Surrogat im Wert (escaped)");
  add("invalid-surrogate-key.json", `{"\\udc00x":1,${t.slice(1)}`, fail("json.surrogate"), "einzelnes Surrogat im Schluessel");
  add("invalid-proto-key.json", `{"__proto__":1,${t.slice(1)}`, fail("json.proto"), "Schluessel __proto__");
  add("invalid-depth-33.json", replaceOnce(t, '"limits":{}', `"limits":{"deep":${"[".repeat(30)}${"]".repeat(30)}}`), fail("json.depth"), "33 Ebenen");
  // canonical
  add("invalid-whitespace.json", ` ${t}`, fail("canonical.mismatch"), "Leerraum vor dem Objekt");
  add("invalid-escape.json", replaceOnce(t, '"projectName":"Weichzeichner"', '"projectName":"Weichzeichn\\u0065r"'), fail("canonical.mismatch"), "Unicode-Escape eines Nicht-Steuerzeichens");
  add("invalid-key-order.json", `{"schemaVersion":1,${replaceOnce(t, ',"schemaVersion":1', "").slice(1)}`, fail("canonical.mismatch"), "Schluessel nicht nach UTF-16 sortiert");
  // integrity
  add("invalid-corrupted.json", replaceOnce(t, '"projectName":"Weichzeichner"', '"projectName":"Weichzeichnex"'), fail("integrity.mismatch"), "ein Zeichen veraendert, Bytes weiter kanonisch");
  const noIntegrity = clone(w.doc);
  delete noIntegrity.integrity;
  add("invalid-integrity-missing.json", canonicalize(noIntegrity), fail("integrity.missing"), "integrity fehlt (sonst kanonisch)");
  const algo = clone(w.doc);
  algo.integrity.algorithm = "sha512";
  add("invalid-algorithm.json", reseal(algo).text, fail("integrity.algorithm"), "algorithm falsch");
  const content = clone(w.doc);
  content.revision.contentHash = `sha256:${"0".repeat(64)}`;
  content.revision.id = `rev_${nodeSha(`${content.projectId}\n${content.revision.contentHash}`).slice(0, 32)}`;
  add("invalid-content-hash.json", reseal(content).text, fail("integrity.content-hash"), "contentHash falsch, revision.id passend, integrity neu");
  const analysis = clone(w.doc);
  analysis.revision.analysisHash = `sha256:${"0".repeat(64)}`;
  add("invalid-analysis-hash.json", reseal(analysis).text, fail("integrity.analysis-hash"), "analysisHash falsch");
  const rev = clone(w.doc);
  rev.revision.id = `rev_${"0".repeat(32)}`;
  add("invalid-revision-id.json", reseal(rev).text, fail("integrity.revision-id"), "revision.id falsch");
  // schema und Grenzen
  const v2 = weichzeichnerDoc();
  v2.schemaVersion = 2;
  add("invalid-schema-version-2.json", seal(v2).text, fail("schema.version-newer"), "andere Hauptversion");
  mutated(weichzeichnerDoc, (d) => { d.format = "codesearch.pocket.other"; }, "falsches format", "invalid-format.json", "schema.format");
  mutated(codeDoc, (d) => { d.operators[0].extensions[0].promote = { value: "ja" }; }, "promote ist ein Toggle: {value:bool}", "invalid-promote-type.json", "schema.type");
  mutated(exprSizeDoc, (d) => { d.parameters.find((p) => p.name === "Long").omitted = "anders"; }, "omitted nur secret|size", "invalid-omitted-other.json", "schema.enum");
  mutated(weichzeichnerDoc, (d) => { d.warnings = [{ ...warning("capture.retried"), code: "capture.erfunden" }]; }, "Warncode ausserhalb der Liste v1.0", "invalid-warning-code.json", "schema.enum");
  mutated(truncatedDoc, (d) => {
    const s = d.codeSources[0];
    s.truncated = s.truncation;
    delete s.truncation;
  }, "alter Feldname truncated statt truncation", "invalid-truncation-name.json", "schema.missing");
  mutated(weichzeichnerDoc, (d) => { d.projectName = "x".repeat(121); }, "projectName laenger als 120", "invalid-project-name.json", "limit.length");
  mutated(dynamicDoc, (d) => { d.references.find((r) => r.kind === "code-op").code = null; }, "code-* ohne code-Objekt (Vertrag 4.12: Pflicht)", "invalid-code-null.json", "schema.type");
  mutated(dynamicDoc, (d) => { d.references.find((r) => r.kind === "code-op").code.name = "x"; }, "dynamic:true mit festem Namen", "invalid-dynamic-name.json", "schema.value");
  mutated(dynamicDoc, (d) => {
    const r = d.references.find((x) => x.kind === "code-op");
    r.target = { op: "blur" };
    r.certainty = "static";
  }, "dynamic:true mit aufgeloestem Ziel", "invalid-dynamic-target.json", "schema.value");
  mutated(weichzeichnerDoc, (d) => { d.operators[2].color = ["0.55", null, "0.55"]; }, "color mit Luecke statt null", "invalid-color-partial.json", "schema.type");
  mutated(weichzeichnerDoc, (d) => { d.operators[1]["größe"] = 1; }, "unbekannter Schluessel ist kein ASCII-Feldname (Vertrag 4)", "invalid-key-ascii.json", "schema.keys");
  mutated(weichzeichnerDoc, (d) => { d.integrity["ä"] = 1; }, "Nicht-ASCII-Schluessel im integrity-Objekt: keine Ausnahme (Vertrag 16)", "invalid-key-integrity.json", "schema.keys");
  // Schlusspruefung 1.11.0 (Vertrag 4.7/4.9/4.13/16): der Paketbau erzeugt nichts davon, fremde Pakete schon.
  add("valid-helper-extutils.json", seal(helperDoc()).text, { valid: true, ignored: [] }, "COMP mit Tag ExtUtils und sein Inneres als role helper");
  mutated(weichzeichnerDoc, (d) => {
    d.operators[0].children = 4;
    d.operators.push(op("anno1", "annotateCOMP", "COMP"));
  }, "Operator vom opType annotateCOMP (4.7: Annotationen sind nie Operatoren)", "invalid-annotate-operator.json", "schema.value");
  mutated(weichzeichnerDoc, (d) => { d.operators[1].children = 0; }, "children an einem TOP (nur COMP)", "invalid-children-non-comp.json", "schema.value");
  mutated(weichzeichnerDoc, (d) => { d.operators[1].connectors = { in: [], out: [] }; }, "connectors an einem TOP (nur COMP)", "invalid-connectors-non-comp.json", "schema.value");
  mutated(weichzeichnerDoc, (d) => { d.operators[1].extensions = [ext(0, "op('./x').module.X(me)", "X")]; }, "extensions an einem TOP (nur COMP)", "invalid-extensions-non-comp.json", "schema.value");
  mutated(weichzeichnerDoc, (d) => { d.operators[1].internalShortcuts = [{ slot: 0, shortcut: "Blur", op: { value: "blur" } }]; }, "internalShortcuts an einem TOP (nur COMP)", "invalid-internal-shortcuts-non-comp.json", "schema.value");
  mutated(weichzeichnerDoc, (d) => { d.operators[1].flags.allowCooking = true; }, "flags.allowCooking an einem TOP (nur COMP)", "invalid-allow-cooking-non-comp.json", "schema.value");
  mutated(helperDoc, (d) => { d.operators[1].role = "helper"; }, "role helper ausserhalb eines ExtUtils-COMP", "invalid-helper-outside.json", "schema.value");
  mutated(helperDoc, (d) => { d.operators[4].role = "op"; }, "ExtUtils-COMP ohne role helper", "invalid-helper-comp-missing.json", "schema.value");
  mutated(helperDoc, (d) => { d.operators[6].role = "op"; }, "Inneres des ExtUtils-COMP ohne role helper", "invalid-helper-inner-missing.json", "schema.value");
  mutated(weichzeichnerDoc, (d) => { d.connections[2].to = { external: "/project1/CodeSearch_Tutorial/bild_null" }; }, "Leitung mit zwei externen Enden (4.9)", "invalid-wire-both-external.json", "schema.value");
  mutated(weichzeichnerDoc, (d) => { d.connections[2].from = { external: "project1/CodeSearch_Tutorial/mix" }; }, "externes Leitungsende relativ statt absolut", "invalid-external-relative.json", "schema.pattern");
  mutated(weichzeichnerDoc, (d) => { d.operators[2].dock = { external: "mix" }; }, "externes Dock relativ statt absolut", "invalid-dock-relative.json", "schema.pattern");
  mutated(weichzeichnerDoc, (d) => { d.externalDependencies[1].path = "project1/CodeSearch_Tutorial/mix"; }, "externalDependencies.path relativ statt absolut (4.13)", "invalid-dependency-relative.json", "schema.pattern");
  // Konsistenz
  const dupWrong = duplicateDoc();
  dupWrong.codeSources[1].duplicateOf = null;
  add("invalid-duplicate-of.json", seal(dupWrong).text, fail("consistency.duplicate-of"), "duplicateOf fehlt");
  const shaWrong = duplicateDoc();
  shaWrong.codeSources[0].sha256 = nodeSha("anderer Text");
  shaWrong.codeSources[1].duplicateOf = null;
  add("invalid-source-sha.json", seal(shaWrong).text, fail("consistency.sha256"), "sha256 passt nicht zum Text");
  const inner = weichzeichnerDoc();
  inner.operators[0].extensions = [ext(0, "op('./a').module.A(me)", "A", false), ext(1, "op('./b').module.B(me)", "B", false)];
  sortPackageLists(inner);
  inner.operators[0].extensions.reverse();
  add("invalid-inner-order.json", seal(inner, { sort: false }).text, fail("consistency.sort"), "extensions nicht nach slot");
  const order = weichzeichnerDoc();
  sortPackageLists(order);
  [order.operators[1], order.operators[2]] = [order.operators[2], order.operators[1]];
  add("invalid-order.json", seal(order, { sort: false }).text, fail("consistency.sort"), "operators unsortiert");
  const counts = seal(weichzeichnerDoc()).doc;
  counts.report.counts.operators = 5;
  add("invalid-counts.json", reseal(counts).text, fail("consistency.counts"), "report.counts passt nicht");
  mutated(weichzeichnerDoc, (d) => { d.operators[2].dock = { op: "nope" }; }, "dock.op ist kein exportierter Op", "invalid-dangling-dock.json", "consistency.reference");
  mutated(weichzeichnerDoc, (d) => { d.references[0].target = { op: "nope" }; }, "references.target.op fehlt", "invalid-dangling-target.json", "consistency.reference");
  mutated(weichzeichnerDoc, (d) => { d.warnings = [{ ...warning("capture.retried"), severity: "warning" }]; }, "Schwere passt nicht zum Code", "invalid-warning-severity.json", "consistency.warning");
  mutated(truncatedDoc, (d) => { d.codeSources[0].truncation = null; }, "status truncated ohne truncation", "invalid-truncation-missing.json", "consistency.status");
  // Faelle auf vorhandenen Dateien (wie manifest.packages in td-codesearch)
  cases.push({ file: "valid-weichzeichner.json", expect: fail("binding.project", { binding: { projectId: PID2 } }), note: "projectId ist nicht der angefragte" });
  cases.push({ file: "valid-weichzeichner.json", expect: fail("binding.revision", { binding: { revisionId: `rev_${"f".repeat(32)}` } }), note: "revision.id ist nicht die angefragte" });
  cases.push({ file: "valid-weichzeichner.json", expect: fail("limit.bytes", { maxBytes: 100 }), note: "Grenze vor dem Dekodieren (hier 100 Bytes)" });
  return { vectors: out, cases };
}

function lockOf({ vectors, cases }) {
  return {
    format: "codesearch.pocket.vectors",
    version: 1,
    owner: "codesearch-pocket tools/projects-core-tests.mjs (synthetisch, Paketform von cs_pocket_export)",
    note: "Zu grosse Pakete (16 MiB + 1) entstehen im Test, nicht als Datei. Gegenprobe 2026-11-05 (einmalig, ausserhalb von npm test): cs_pocket_export.validate_bytes nahm alle gueltigen an und lehnte alle ungueltigen mit derselben Kategorie ab.",
    files: vectors.map((v) => ({ file: v.file, sha256: nodeSha(v.bytes), bytes: v.bytes.length, expect: v.expect, note: v.note })),
    cases,
  };
}

if (process.argv.includes("--write-fixtures")) {
  mkdirSync(VECTOR_DIR, { recursive: true });
  const built = buildVectors();
  for (const v of built.vectors) writeFileSync(new URL(v.file, VECTOR_DIR), v.bytes);
  writeFileSync(new URL("vectors.lock.json", VECTOR_DIR), `${JSON.stringify(lockOf(built), null, 1)}\n`);
  console.log(JSON.stringify({ written: built.vectors.length, cases: built.cases.length, dir: VECTOR_DIR.pathname }));
  process.exit(0);
}

// ================================================================== Lock-Pruefung (eigene, Interop, td-codesearch)

// Python-Code -> Kategorie (Vertrag 16, wie cs_pocket_export.VALIDATION_CATEGORIES), falls ein Vektor die Kategorie
// nicht selbst nennt. Die JS-Codes tragen ihre Kategorie als Praefix; Python weicht nur bei size/c14n/hash/input ab.
const PY_PREFIX_CATEGORY = Object.freeze({
  input: "encoding", size: "limit", c14n: "canonical", hash: "integrity",
});

function expectedCategory(code) {
  if (typeof code !== "string") return null;
  const prefix = code.slice(0, code.indexOf("."));
  return categoryOf(code) ?? (Object.hasOwn(PY_PREFIX_CATEGORY, prefix) ? PY_PREFIX_CATEGORY[prefix] : null);
}

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// Erwartung je Datei bzw. Fall: true/false, "valid"/"invalid"/Code oder {valid|ok, code|codes|errors, category,
// ignored, binding, maxBytes}. Eintraege ohne Erwartung werden nur ueber sha256 geprueft (z.B. c14n-Faelle).
function expectOf(raw) {
  const make = (valid, code, extra = {}) => ({
    valid, code, category: typeof extra.category === "string" ? extra.category : null,
    ignored: Array.isArray(extra.ignored) ? extra.ignored : null,
    binding: isPlainObject(extra.binding) ? extra.binding : null,
    maxBytes: Number.isSafeInteger(extra.maxBytes) ? extra.maxBytes : null,
  });
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "boolean") return make(raw, null);
  if (typeof raw === "string") {
    if (["valid", "ok", "accept"].includes(raw)) return make(true, null);
    if (["invalid", "reject", "error"].includes(raw)) return make(false, null);
    return make(false, raw);
  }
  if (isPlainObject(raw)) {
    const errors = Array.isArray(raw.errors) ? raw.errors : Array.isArray(raw.codes) ? raw.codes : [];
    const code = raw.code ?? raw.error ?? (errors[0] && (errors[0].code ?? errors[0])) ?? null;
    const valid = typeof raw.valid === "boolean" ? raw.valid : typeof raw.ok === "boolean" ? raw.ok : code ? false : null;
    return valid === null ? null : make(valid, typeof code === "string" ? code : null, raw);
  }
  return null;
}

// Toleranter Leser fuer vectors.lock.json: files[] mit {file|path|name, sha256, bytes, expect} oder eine Abbildung
// name -> sha256; dazu optional cases[] (weitere Faelle auf gelisteten Dateien).
function normalizeLock(lock) {
  const entries = [];
  if (Array.isArray(lock.files)) {
    for (const item of lock.files) {
      const file = item.file ?? item.path ?? item.name;
      const raw = item.expect ?? item.expected ?? item.expectation ?? (typeof item.valid === "boolean" ? { valid: item.valid, code: item.code } : undefined);
      const isPackage = item.kind === undefined || item.kind === "package" || item.kind === "snapshot";
      entries.push({ file, sha256: item.sha256 ?? item.sha, bytes: item.bytes, expect: isPackage ? expectOf(raw) : null });
    }
  } else if (isPlainObject(lock.files)) {
    const table = lock.expect ?? lock.expectations ?? {};
    for (const [file, value] of Object.entries(lock.files)) {
      const sha = typeof value === "string" ? value : value && value.sha256;
      const raw = isPlainObject(value) ? value.expect ?? value.expected : table[file];
      entries.push({ file, sha256: sha, bytes: undefined, expect: expectOf(raw) });
    }
  } else {
    throw new Error("vectors.lock.json: Format nicht erkannt (erwartet files[] oder files{})");
  }
  const safe = (file) => typeof file === "string" && !file.startsWith("/") && !file.split(/[\\/]/).includes("..");
  for (const e of entries) {
    if (!safe(e.file)) throw new Error("vectors.lock.json: unzulaessiger Dateipfad");
    if (typeof e.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(e.sha256.replace(/^sha256:/, ""))) {
      throw new Error(`vectors.lock.json: sha256 fehlt fuer ${e.file}`);
    }
  }
  const cases = (Array.isArray(lock.cases) ? lock.cases : []).map((c) => {
    if (!safe(c.file)) throw new Error("vectors.lock.json: unzulaessiger Dateipfad");
    return { file: c.file, expect: expectOf(c.expect) };
  }).filter((c) => c.expect);
  return { entries, cases };
}

// Lesefunktion relativ zu einem Ordner; Tests koennen eine Map unterschieben (keine Kopie fremder Vektoren noetig).
const folderReader = (dir) => (rel) => readFileSync(new URL(rel, dir));
const baseOf = (rel) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/") + 1) : "");

// Ein c14n-Fall wie Pocket ihn sieht: JSON.parse -> Emitter; 1.0/1e2/-0/Duplikate meldet die Diagnose.
function c14nCase(input) {
  let value;
  try {
    value = JSON.parse(input);
  } catch (error) {
    if (error instanceof SyntaxError) return { error: "json.syntax" };
    throw error;
  }
  let text;
  try {
    text = canonicalize(value);
  } catch (error) {
    if (error instanceof CanonicalError) return { error: error.code };
    throw error;
  }
  const cause = diagnoseNonCanonical(input);
  return cause ? { error: cause.code } : { output: text };
}

// Prueft einen Vektorsatz: sha256/bytes je Lock-Datei, dann jeden Paketfall gegen verifyPackage. Vertrag 16: gueltig/
// ungueltig und Kategorie muessen stimmen; bei gueltigen Paketen ausserdem die unbekannten Felder (ignored). Faelle
// kommen aus dem Lock (expect, cases) oder aus einer gelockten manifest.json (td-codesearch: packages[] mit ok,
// codes, ignored, maxBytes, expect = Bindung). Dazu die gemeinsamen c14n- und Sortierfaelle.
// requireCategory: jeder ungueltige Fall MUSS seine Kategorie nennen (Vertrag 16: der Abgleich vergleicht
// gueltig/ungueltig und Kategorie fuer jeden Fall - ein Fall ohne Kategorie waere ein stiller Teilvergleich).
async function checkVectorSet(read, { exactCodes = false, requireCategory = false } = {}) {
  const { entries, cases: extra } = normalizeLock(JSON.parse(read("vectors.lock.json").toString("utf8")));
  const listed = new Set(entries.map((e) => e.file));
  const report = { files: entries.length, cases: 0, valid: 0, invalid: 0, categoryChecked: 0, ignoredChecked: 0, c14n: 0, sorting: 0, codeMismatch: [] };
  for (const e of entries) {
    const bytes = read(e.file);
    assert.equal(nodeSha(bytes), e.sha256.replace(/^sha256:/, ""), `sha256 ${e.file}`);
    if (Number.isSafeInteger(e.bytes)) assert.equal(bytes.length, e.bytes, `bytes ${e.file}`);
  }
  const cases = entries.filter((e) => e.expect).map((e) => ({ file: e.file, ...e.expect }));
  for (const c of extra) {
    assert.ok(listed.has(c.file), `Fall auf nicht gelisteter Datei: ${c.file}`);
    cases.push({ file: c.file, ...c.expect });
  }
  const manifestFile = entries.map((e) => e.file).find((f) => f.split("/").pop() === "manifest.json");
  let manifest = null;
  if (manifestFile) {
    manifest = JSON.parse(read(manifestFile).toString("utf8"));
    const base = baseOf(manifestFile);
    for (const pkg of Array.isArray(manifest.packages) ? manifest.packages : []) {
      const file = base + pkg.file;
      assert.ok(listed.has(file), `Manifest-Datei nicht im Lock: ${file}`);
      cases.push({
        file, valid: pkg.ok === true, code: Array.isArray(pkg.codes) && pkg.codes.length ? pkg.codes[0] : null,
        category: typeof pkg.category === "string" ? pkg.category : null, ignored: Array.isArray(pkg.ignored) ? pkg.ignored : null,
        maxBytes: Number.isSafeInteger(pkg.maxBytes) ? pkg.maxBytes : null, binding: isPlainObject(pkg.expect) ? pkg.expect : null,
      });
    }
  }
  for (const c of cases) {
    const bytes = read(c.file);
    const maxBytes = c.maxBytes ?? POCKET_MAX_BYTES;
    let result = await verifyPackage(bytes, { unbound: true, maxBytes });
    if (result.ok && c.binding) {
      const index = { projectId: c.binding.projectId ?? result.projectId, revisionId: c.binding.revisionId ?? result.revisionId, seq: 1 };
      result = await verifyPackage(bytes, { index, maxBytes });
    }
    const label = `${c.file}${c.binding ? " (Bindung)" : ""}${c.maxBytes ? ` (maxBytes ${c.maxBytes})` : ""}`;
    assert.equal(result.ok, c.valid, `${label}: erwartet ${c.valid ? "gueltig" : "ungueltig"}, JS ${result.ok ? "gueltig" : result.errors.map((x) => `${x.code}@${x.path}`).join(",")}`);
    report.cases += 1;
    if (result.ok) {
      report.valid += 1;
      if (c.ignored) {
        assert.deepEqual([...result.unknownFields].sort(), [...c.ignored].sort(), `${label}: unbekannte Felder (ignored)`);
        report.ignoredChecked += 1;
      }
      continue;
    }
    report.invalid += 1;
    const want = c.category ?? expectedCategory(c.code);
    if (requireCategory) assert.ok(CATEGORIES.includes(want), `${label}: Fall ohne Kategorie`);
    if (want) {
      assert.equal(result.errors[0].category, want, `${label}: Kategorie (JS ${result.errors.map((x) => x.code).join(",")})`);
      report.categoryChecked += 1;
    }
    if (c.code && !result.errors.some((x) => x.code === c.code)) {
      if (exactCodes) assert.fail(`${label}: Code ${c.code} erwartet, bekommen ${result.errors.map((x) => x.code).join(",")}`);
      report.codeMismatch.push({ file: c.file, expected: c.code, got: [...new Set(result.errors.map((x) => x.code))] });
    }
  }
  if (manifest && typeof manifest.c14n === "string") {
    for (const item of JSON.parse(read(baseOf(manifestFile) + manifest.c14n).toString("utf8"))) {
      const got = c14nCase(item.input);
      if (typeof item.output === "string") assert.equal(got.output, item.output, `c14n ${item.name}: ${got.error ?? ""}`);
      else assert.equal(expectedCategory(got.error), expectedCategory(item.error), `c14n ${item.name}: Kategorie (JS ${got.error ?? "ok"})`);
      report.c14n += 1;
    }
  }
  if (manifest && typeof manifest.sorting === "string") {
    for (const item of JSON.parse(read(baseOf(manifestFile) + manifest.sorting).toString("utf8"))) {
      if (Array.isArray(item.items)) {
        const got = [...item.items].map((t) => [t.map((part) => (part !== null && typeof part === "object" ? objectKey(part) : part)), t])
          .sort((a, b) => compareTuples(a[0], b[0])).map(([, t]) => t);
        assert.deepEqual(got, item.sorted, `Sortierung ${item.name}`);
      } else if (item.list === "operators") {
        const got = item.rels.map((rel) => [SORT_KEYS.operators({ rel }), rel]).sort((a, b) => compareTuples(a[0], b[0])).map(([, rel]) => rel);
        assert.deepEqual(got, item.sorted, `Sortierung ${item.name}`);
      }
      report.sorting += 1;
    }
  }
  return report;
}

// ================================================================== c14n

const PY_REFERENCE = {
  hex: "7b22223a352c223130223a332c2239223a342c2241223a362c225f223a372c2261223a5b312c2d312c302c393030373139393235343734303939312c2d393030373139393235343734303939312c747275652c66616c73652c6e756c6c2c22222c7b7d2c5b5d5d2c226161223a382c2262223a225c75303030305c75303030315c75303031665c225c5c2f5c625c665c6e5c725c747fe280a8e280a9c3a9f09f9880222c226e6573746564223a7b227461625c746b6579223a2278222c227a223a7b2279223a5b7b2261223a322c2262223a317d5d7d2c22c39f223a2253747261c39f65227d2c22c3a4223a392c22f09f9880223a322c22efbda1223a317d",
  sha256: "2fb165ada48bb5d965dbee04b7fe7ea18583ec6b2d741841c9019eb1d5ea8a59",
};

test("c14n: bytegleich mit unabhaengiger Python-Referenz (Escapes, UTF-16-Schluesselordnung, Nicht-BMP)", async () => {
  const value = {
    b: "\u0000\u0001\u001f\"\\/\b\f\n\r\t\u007f\u2028\u2029\u00e9\u{1F600}",
    a: [1, -1, 0, 9007199254740991, -9007199254740991, true, false, null, "", {}, []],
    "\uff61": 1, "\u{1F600}": 2, 10: 3, 9: 4, "": 5, A: 6, _: 7, aa: 8, "\u00e4": 9,
    nested: { z: { y: [{ b: 1, a: 2 }] }, "\u00df": "Stra\u00dfe", "tab\tkey": "x" },
  };
  const bytes = canonicalBytes(value);
  assert.equal(Buffer.from(bytes).toString("hex"), PY_REFERENCE.hex);
  assert.equal(await sha256Hex(bytes), PY_REFERENCE.sha256);
  assert.equal(nodeSha(bytes), PY_REFERENCE.sha256);
});

test("c14n: nur Ganzzahlen, -0 wird 0, verbotene Werte und Schluessel mit Code und JSON Pointer", () => {
  assert.equal(canonicalize(-0), "0");
  assert.equal(canonicalize([9007199254740991, -9007199254740991]), "[9007199254740991,-9007199254740991]");
  const failure = (fn) => {
    try {
      fn();
    } catch (error) {
      assert.ok(error instanceof CanonicalError);
      return [error.code, error.path];
    }
    return null;
  };
  for (const bad of [1.5, NaN, Infinity]) assert.equal(failure(() => canonicalize({ x: bad }))[0], "json.number");
  for (const big of [2 ** 53, -(2 ** 53)]) assert.equal(failure(() => canonicalize({ x: big }))[0], "json.int-range");
  assert.deepEqual(failure(() => canonicalize({ x: "\ud800" })), ["json.surrogate", "/x"]);
  assert.equal(failure(() => canonicalize({ "\udc00": 1 }))[0], "json.surrogate");
  assert.deepEqual(failure(() => canonicalize(JSON.parse('{"a":{"__proto__":1}}'))), ["json.proto", "/a/__proto__"]);
  assert.equal(failure(() => canonicalize({ x: undefined }))[0], "json.type");
  assert.equal(failure(() => canonicalize({ x: new Date(0) }))[0], "json.type");
  assert.equal(failure(() => canonicalize(new Uint8Array(2)))[0], "json.type");
  let ok = [];
  for (let i = 0; i < 31; i += 1) ok = [ok];
  assert.equal(canonicalize(ok).length, 64, "32 verschachtelte Listen sind erlaubt");
  assert.equal(failure(() => canonicalize([ok]))[0], "json.depth");
  // Pfad nennt nur Feldnamen und Indizes, Sonderzeichen nach RFC 6901
  assert.deepEqual(failure(() => canonicalize({ "a/b": [{ "~x": 1.5 }] })), ["json.number", "/a~1b/0/~0x"]);
  for (const code of ["json.number", "json.int-range", "json.surrogate", "json.proto", "json.type", "json.depth"]) {
    assert.equal(categoryOf(code), "json");
  }
});

test("c14n: Zeilen und Codepoints nach Vertrag (LF-Index-Zeilen, for...of)", () => {
  assert.equal(lineCount(""), 0);
  assert.equal(lineCount("a"), 1);
  assert.equal(lineCount("a\nb\n"), 3);
  assert.equal(lineCount("a\rb"), 1, "einzelnes CR ist kein Zeilenende");
  assert.deepEqual(splitLines(""), []);
  assert.deepEqual(splitLines("a\n"), ["a", ""]);
  const emoji = "\u{1F600}".repeat(120);
  assert.equal(codepointLength(emoji), [...emoji].length);
  assert.equal(codepointLength("a\ud800b"), [..."a\ud800b"].length);
  assert.throws(() => decodeUtf8Strict(Uint8Array.from([0xc3, 0x28])), (e) => e.code === "encoding.utf8");
  assert.equal(decodeUtf8Strict(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61])), "\ufeffa", "BOM bleibt sichtbar (ignoreBOM)");
});

test("c14n: Diagnose nicht kanonischer Bytes - Duplikate und Zahlformen wie Python (json), Rest canonical", () => {
  assert.equal(diagnoseNonCanonical('{"a":1,"a":1}').code, "json.duplicate-key");
  assert.equal(diagnoseNonCanonical('{"o":{"k":"x","k":"y"}}').code, "json.duplicate-key");
  assert.equal(diagnoseNonCanonical('{"a":{"b":1},"b":{"b":2}}'), null, "gleicher Schluessel in verschiedenen Objekten");
  assert.equal(diagnoseNonCanonical('{"s":"\\"a\\":1,\\"a\\"","a":2}'), null, "Schluessel in Strings zaehlen nicht");
  for (const number of ["1.0", "1e2", "1E2", "-0", "-0.0", "0.5"]) assert.equal(diagnoseNonCanonical(`{"x":${number}}`).code, "json.number", number);
  assert.equal(diagnoseNonCanonical('{"x":[-12,0,9007199254740991]}'), null);
  assert.equal(diagnoseNonCanonical(' { "b" : 1 } '), null, "Leerraum ist kein JSON-Fehler");
});

// ================================================================== Pruefpipeline

test("verify: Referenzexport Weichzeichner ist gueltig und an den Index gebunden", async () => {
  const sealed = seal(weichzeichnerDoc());
  const result = await verifyPackage(sealed.bytes, bound(sealed, 3));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.seq, 3);
  assert.equal(result.revisionId, sealed.doc.revision.id);
  assert.equal(result.contentHash, sealed.doc.revision.contentHash);
  assert.equal(result.integrity, nodeSha(canonicalize((({ integrity, ...rest }) => rest)(sealed.doc))));
  assert.deepEqual(result.unknownFields, []);
  // Hashes unabhaengig nachgerechnet (WebCrypto im Modul, node:crypto im Bauer)
  const content = Object.fromEntries(CONTENT_FIELDS.map((k) => [k, sealed.doc[k]]));
  assert.equal(result.contentHash, `sha256:${nodeSha(canonicalize(content))}`);
  assert.equal(result.analysisHash, `sha256:${nodeSha("[]")}`);
});

test("verify: Bindung an projectId, revision.id und seq des angefragten Index-Eintrags", async () => {
  const sealed = seal(weichzeichnerDoc());
  const { projectId } = sealed.doc;
  const revisionId = sealed.doc.revision.id;
  const reject = async (options, code) => {
    const r = await verifyPackage(sealed.bytes, options);
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].code, code);
    assert.equal(r.errors[0].category, "binding");
  };
  await reject({}, "binding.missing");
  await reject({ index: { projectId, revisionId, seq: 0 } }, "binding.missing");
  await reject({ index: { projectId: PID2, revisionId, seq: 2 } }, "binding.project");
  await reject({ index: { projectId, revisionId: `rev_${"1".repeat(32)}`, seq: 2 } }, "binding.revision");
  await reject({ index: { projectId, revisionId, seq: 2 }, head: { seq: 3, revisionId } }, "binding.seq");
  const ok = await verifyPackage(sealed.bytes, { index: { projectId, revisionId, seq: 2 }, head: { seq: 2, revisionId } });
  assert.equal(ok.ok, true);
  const free = await verifyPackage(sealed.bytes, { unbound: true });
  assert.equal(free.ok, true);
  assert.equal(free.seq, null);
  assert.equal(free.bound, false);
});

test("verify: 16-MiB-Grenze greift vor dem Dekodieren und laesst sich nie anheben", async () => {
  const over = new Uint8Array(POCKET_MAX_BYTES + 1).fill(0xff);
  const r1 = await verifyPackage(over, { unbound: true });
  assert.deepEqual([r1.stage, r1.errors[0].code, r1.errors[0].category], ["size", "limit.bytes", "limit"]);
  // Befund P1 (low): maxBytes darf die Geraetegrenze nicht still ueberschreiben.
  const raised = await verifyPackage(over, { unbound: true, maxBytes: 32 * 1024 * 1024 });
  assert.equal(raised.errors[0].code, "limit.bytes");
  assert.equal(raised.maxBytes, POCKET_MAX_BYTES);
  const exact = new Uint8Array(POCKET_MAX_BYTES).fill(0xff);
  const r2 = await verifyPackage(exact, { unbound: true });
  assert.equal(r2.stage, "decode", "0xFF ist ungueltiges UTF-8: Dekodieren lief also");
  const spaces = new Uint8Array(POCKET_MAX_BYTES).fill(0x20);
  assert.equal((await verifyPackage(spaces, { unbound: true })).stage, "parse");
  assert.equal((await verifyPackage("text", { unbound: true })).errors[0].code, "encoding.input");
  const small = await verifyPackage(seal(weichzeichnerDoc()).bytes, { unbound: true, maxBytes: 100 });
  assert.equal(small.errors[0].code, "limit.bytes", "kleinere Grenze (Testvektoren) bleibt moeglich");
});

test("verify: Reihenfolge der Stufen bei mehreren Fehlern", async () => {
  const sealed = seal(weichzeichnerDoc());
  // BOM vor kaputtem UTF-8: BOM gewinnt
  const r1 = await verifyPackage(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf, 0xc3, 0x28])]), { unbound: true });
  assert.equal(r1.stage, "bom");
  // Leerraum UND Schemafehler: c14n-Stufe zuerst
  const broken = clone(sealed.doc);
  delete broken.capture;
  const r2 = await verifyPackage(Buffer.from(` ${reseal(broken).text}`), { unbound: true });
  assert.equal(r2.stage, "canonical");
  // falsche integrity UND Schemafehler: integrity zuerst
  const r3 = await verifyPackage(Buffer.from(reseal(broken).text.replace(/"value":"[0-9a-f]{64}"/, `"value":"${"0".repeat(64)}"`)), { unbound: true });
  assert.equal(r3.stage, "integrity");
  // Schemafehler bei richtiger integrity
  const r4 = await verifyPackage(reseal(broken).bytes, { unbound: true });
  assert.equal(r4.stage, "schema");
  assert.deepEqual(r4.errors.map((e) => [e.code, e.path]).slice(0, 1), [["schema.missing", "/capture"]]);
  // Kein Objekt auf oberster Ebene (wie Python input.type: Kategorie encoding)
  const r5 = await verifyPackage(Buffer.from("[]"), { unbound: true });
  assert.deepEqual([r5.errors[0].code, r5.errors[0].category], ["encoding.input", "encoding"]);
  // Schema-Fehler zuerst, Konsistenz erst danach (wie cs_pocket_export.validate)
  const both = weichzeichnerDoc();
  both.operators[1].family = "XYZ";
  both.parameters[0].op = "nope";
  const r6 = await verifyPackage(seal(both).bytes, { unbound: true });
  assert.deepEqual(r6.errors.map((e) => e.code), ["schema.enum"]);
  // Meldungen kommen aus Vorlagen und enthalten keine Paketinhalte
  const secret = clone(sealed.doc);
  secret.projectName = "ghp_" + "A".repeat(36);
  secret.capture.consistency = "erfunden";
  const r7 = await verifyPackage(reseal(secret).bytes, { unbound: true });
  assert.equal(r7.ok, false);
  assert.ok(!JSON.stringify(r7).includes("ghp_"), "Kanarienwert taucht in keiner Meldung auf");
  for (const e of r7.errors) assert.ok(CATEGORIES.includes(e.category) && typeof e.message === "string");
});

test("verify: Schema-, Konsistenz- und Grenzfehler mit Code, JSON Pointer und Kategorie", async () => {
  // sort:false = erst sortieren, dann veraendern (sonst saehe die Sortierpruefung den Fehler nie).
  const check = async (make, mutate, code, path, { sort = true } = {}) => {
    const doc = make();
    if (!sort) sortPackageLists(doc);
    mutate(doc);
    const r = await verifyPackage(seal(doc, { sort }).bytes, { unbound: true });
    assert.equal(r.ok, false, `${code} ${path}`);
    const hit = r.errors.find((e) => e.code === code && (path === undefined || e.path === path));
    assert.ok(hit, `${code} ${path}: ${JSON.stringify(r.errors.slice(0, 5))}`);
    assert.equal(hit.category, categoryOf(code));
  };
  // Pfade nach dem Sortieren: operators = ["", blur, in1, out1] - d.operators[1] (in1) landet auf Index 2.
  const W = weichzeichnerDoc;
  await check(W, (d) => { d.operators[1].family = "XYZ"; }, "schema.enum", "/operators/2/family");
  await check(W, (d) => { d.operators[1].opType = "In TOP"; }, "schema.pattern", "/operators/2/opType");
  await check(W, (d) => { d.operators[1].color = ["1", "2", "3"]; }, "schema.pattern", "/operators/2/color/0");
  await check(W, (d) => { d.operators[1].node = { unknown: "Nicht lesbar" }; }, "schema.pattern", "/operators/2/node/unknown");
  await check(W, (d) => { d.operators[1].parent = "missing"; d.operators[1].rel = "missing/in1"; }, "consistency.parent");
  await check(W, (d) => { d.operators[1].rel = "in1x"; }, "consistency.rel");
  await check(W, (d) => { d.operators.push(op("blur/inner", "nullTOP", "TOP")); }, "consistency.parent");
  await check(W, (d) => { d.operators[0].rel = "x"; d.operators[0].parent = ""; }, "consistency.root", "/operators");
  await check(W, (d) => { d.operators.push(clone(d.operators[1])); }, "consistency.duplicate");
  await check(W, (d) => { d.annotations[0].enclosed.push("nope"); }, "consistency.reference");
  await check(W, (d) => { d.parameters[0].op = "nope"; }, "consistency.reference");
  await check(W, (d) => { d.parameters[0].value = { t: "float", v: "4" }; }, "schema.value");
  await check(W, (d) => { d.parameters[1].value = { t: "int", v: "7" }; }, "consistency.mode");
  await check(W, (d) => { d.parameters[0].storedConstant = { t: "float", v: "4.0" }; }, "consistency.mode");
  await check(W, (d) => { d.parameters[0].effective = { v: "4.0" }; }, "schema.value");
  await check(W, (d) => { delete d.parameters[1].storedConstant; }, "schema.missing", "/parameters/1/storedConstant");
  await check(W, (d) => { d.parameters[1].default = { t: "int", v: "1" }; }, "schema.value", "/parameters/1/default");
  await check(W, (d) => { d.parameters[0].range.min = "1"; }, "schema.pattern");
  await check(W, (d) => { d.references[0].from.op = "nope"; }, "consistency.reference");
  await check(W, (d) => { d.references[0].code = { art: "call", receiver: null, name: "x" }; }, "schema.value", "/references/0/code");
  await check(W, (d) => { d.references[0].text = "x".repeat(201); }, "limit.length");
  await check(W, (d) => { delete d.references[0].text; }, "schema.missing", "/references/0/text");
  await check(W, (d) => { d.projectName = ""; }, "schema.value", "/projectName");
  await check(W, (d) => { d.projectName = "\u{1F600}".repeat(121); }, "limit.length");
  await check(W, (d) => { d.exportedAt = "2026-02-30T10:00:00Z"; }, "schema.pattern");
  await check(W, (d) => { d.context.frozenAt = "gestern"; }, "schema.pattern", "/context/frozenAt");
  await check(W, (d) => { d.capture.signature = "a b"; }, "schema.pattern", "/capture/signature");
  await check(W, (d) => { d.capture.longFrames.maxMs = "1.5"; }, "schema.type", "/capture/longFrames/maxMs");
  await check(W, (d) => { d.source.projectFile = "C:/x/y.toe"; }, "schema.value");
  await check(W, (d) => { d.exportRoot.explicitScopes = ["/x"]; }, "schema.value");
  await check(W, (d) => { d.externalDependencies[0].included = true; }, "schema.value");
  await check(W, (d) => { d.externalDependencies[0].count = 0; }, "schema.value");
  await check(W, (d) => { d.externalDependencies[0].kinds = ["kabel"]; }, "schema.enum");
  await check(W, (d) => { d.operators[1].name = "\u00fc".repeat(LIMITS.nameChars + 1); }, "limit.length");
  await check(W, (d) => { d.operators[1]["gr\u00f6\u00dfe"] = 1; }, "schema.keys", "/operators/2");
  // Pruefbefund: integrity war die einzige Stelle, die einen Nicht-ASCII-Schluessel woertlich nannte (Vertrag 16).
  await check(W, (d) => { d.integrity["\u00e4"] = 1; }, "schema.keys", "/integrity");
  await check(W, (d) => { d.report.secrets.rules = "cspocket-secrets-2"; }, "schema.value");
  await check(W, (d) => { d.report.secrets.byRule = [{ rule: "erfunden", count: 1 }]; }, "schema.enum");
  await check(W, (d) => { d.report.limits = { tiefe: [1] }; }, "schema.type", "/report/limits/tiefe");
  await check(W, (d) => { d.report.omissions = [{ what: "Annotation Innen", count: 1, reason: "x" }]; }, "schema.pattern");
  await check(W, (d) => { d.operators[1].tags = ["b", "a"]; }, "consistency.sort", "/operators/1/tags/1", { sort: false });
  // Namen unter dem Root: nicht leer, ohne "/" (rel waere sonst mehrdeutig), auch bei Annotationen
  await check(W, (d) => { d.operators[1].name = "a/b"; d.operators[1].rel = "a/b"; }, "schema.pattern", "/operators/3/name");
  await check(W, (d) => { d.annotations[0].name = ""; d.annotations[0].rel = ""; }, "schema.pattern", "/annotations/0/name");
  // Tabellenzellen zaehlen zum Gesamttext (Vertrag 9: 25 165 824 Codepoints). Ueber verifyPackage ist das nie
  // erreichbar (16 MiB < 25 Mio. Zeichen), darum direkt am Validator wie beim Exporter mit 32 MiB.
  const totalDoc = weichzeichnerDoc();
  totalDoc.operators.push(op("gross", "tableDAT", "DAT"));
  const cell = "z".repeat(LIMITS.tableCellChars);
  totalDoc.codeSources = [{ ...tableSource("gross", [["x"]]), table: Array.from({ length: 385 }, () => [cell]), chars: 385 * cell.length, lines: 385 }];
  sortPackageLists(totalDoc);
  for (const o of totalDoc.operators) o.path = absPath(totalDoc.exportRoot.path, o.rel);
  totalDoc.revision = { id: `rev_${"0".repeat(32)}`, contentHash: `sha256:${"0".repeat(64)}`, analysisHash: `sha256:${"0".repeat(64)}`, basedOnSeq: 0 };
  assert.deepEqual(validate(totalDoc).errors.map((e) => [e.code, e.path]), [["limit.total", "/codeSources"]]);
  // Tiefe <= 64 (Vertrag 9): JS prueft sie wie die Laenge; der Exporter laesst tiefere Ops aus.
  await check(W, (d) => {
    let parent = "";
    for (let i = 0; i < 65; i += 1) {
      const rel = parent ? `${parent}/c${i}` : `c${i}`;
      d.operators.push(op(rel, i === 64 ? "nullTOP" : "baseCOMP", i === 64 ? "TOP" : "COMP"));
      parent = rel;
    }
  }, "limit.depth");
  // Grenze Anzahl: 20 001 Ops
  await check(W, (d) => {
    for (let i = 0; i < LIMITS.operators; i += 1) d.operators.push(op(`n${i}`, "nullTOP", "TOP"));
  }, "limit.count", "/operators");
  // Code-Quelle: chars/lines muessen zu Text bzw. Tabelle passen, key == op
  const doc = codeDoc();
  doc.codeSources[0].lines = 3;
  doc.codeSources[3].chars = 1;
  doc.codeSources[1].op = "HostExt";
  const r = await verifyPackage(seal(doc).bytes, { unbound: true });
  assert.ok(r.errors.some((e) => e.code === "consistency.chars" && e.path === "/codeSources/0/chars"), JSON.stringify(r.errors));
  assert.ok(r.errors.some((e) => e.code === "consistency.chars" && e.path === "/codeSources/3/chars"), "Tabellen-chars werden nachgerechnet");
  assert.ok(r.errors.some((e) => e.code === "consistency.key" && e.path === "/codeSources/1/key"));
  // Nicht uebertragene Quellen tragen kein sha256 (Python _check_source_state)
  const derived = weichzeichnerDoc();
  derived.operators.push(op("script1", "scriptDAT", "DAT"));
  derived.codeSources = [source("script1", "scriptDAT", "", { status: "derived-not-read", text: null, chars: null, lines: null, sha256: "a".repeat(64) })];
  const rd = await verifyPackage(seal(derived).bytes, { unbound: true });
  assert.equal(rd.errors[0].code, "consistency.status");
});

test("verify: unbekannte Felder werden gemeldet (JSON Pointer), nicht abgelehnt; kaputter Analyse-Eintrag laesst das Paket gueltig", async () => {
  const doc = codeDoc();
  doc.futureField = { a: 1 };
  doc.operators[1].laterFlag = true;
  doc.operators[1].flags.glow = true;
  doc.integrity.note = "x";
  const r = await verifyPackage(seal(doc).bytes, { unbound: true });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.unknownFields.sort(), ["/futureField", "/integrity/note", "/operators/1/flags/glow", "/operators/1/laterFlag"]);
  assert.equal(r.entryErrors.length, 1);
  assert.equal(r.entryErrors[0].source, "broken");
  for (const entry of [{ error: "limit" }, { error: "schema" }, { skipped: "helper" }, { error: "parse", sites: [site(null, 1, "x", "modof")] }]) {
    assert.equal(validateEntry(entry).ok, true, JSON.stringify(entry));
  }
  assert.equal(validateEntry({ error: "kaputt" }).errors[0].code, "schema.enum");
  const dup = hostEntry();
  dup.symbols.push(symbol("Mixer", "Mix", 9, 12));
  assert.equal(validateEntry(dup).errors[0].code, "consistency.duplicate", "Symbol-IDs muessen eindeutig sein");
  assert.equal(validateEntry(hostEntry()).ok, true, "Mixer.__init__ und Recorder.__init__ bleiben getrennt");
  // Felder, die Python offen laesst, sind auch hier kein Eintragsfehler (sonst zeigte Pocket {error:"schema"}).
  const open = hostEntry();
  open.accesses[0].conf = 2;
  open.sites[0].via = null;
  open.symbols[0].facts.parReads = [{ par: "Gain", line: 3 }];
  open.stateAtlas.revision = 7;
  assert.equal(validateEntry(open).ok, true, JSON.stringify(validateEntry(open).errors));
});

test("verify: erneute Pruefung gespeicherter Bytes beim Oeffnen", async () => {
  const sealed = seal(codeDoc());
  const ok = await verifyStored(sealed.bytes, { projectId: PID, revisionId: sealed.doc.revision.id, seq: 4 });
  assert.equal(ok.ok, true);
  const tampered = Buffer.from(sealed.bytes);
  tampered[tampered.indexOf(Buffer.from("Mixer"))] = 0x4e;
  assert.equal((await verifyStored(tampered, { projectId: PID, revisionId: sealed.doc.revision.id, seq: 4 })).stage, "integrity");
});

// ================================================================== Befunde der Pruefrunde (jeder Test zeigte den Fehler vorher)

test("Befund high 1: Extension-COMP mit promote/name als {value} ist gueltig, das Modell liest beide", async () => {
  const sealed = seal(codeDoc());
  const result = await verifyPackage(sealed.bytes, { unbound: true });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const model = createModel(result);
  assert.deepEqual(model.extensions("").map((e) => [e.slot, e.name, e.promote, e.className, e.dat]), [[0, "Mixer", true, "Mixer", "HostExt"]]);
  assert.equal(knownValue({ value: false }), false);
  assert.equal(knownValue({ omitted: "secret" }), null);
  const wrong = codeDoc();
  wrong.operators[0].extensions[0].promote = { value: "ja" };
  const r = await verifyPackage(seal(wrong).bytes, { unbound: true });
  assert.deepEqual(r.errors.map((e) => [e.code, e.path]), [["schema.type", "/operators/0/extensions/0/promote/value"]]);
  const plain = codeDoc();
  plain.operators[0].extensions[0].promote = true;
  assert.equal((await verifyPackage(seal(plain).bytes, { unbound: true })).errors[0].code, "schema.type", "Klartext statt {value} wie in Python abgelehnt");
});

// Befund kern-f2 (Schlusspruefung 1.11.0): die Regex fuer die Extension-Klasse hatte keinen Anfangsanker und lief
// quadratisch - 65 536 Bezeichnerzeichen ohne "(me)" kosteten rund 2 s je Slot, createModel laeuft beim Oeffnen im
// Hauptthread. Die Ergebnisse muessen dieselben bleiben wie mit der Regex.
test("Befund kern-f2: Extension-Klasse linear gelesen - gleiche Namen, lange Werte ohne (me) blockieren nicht", async () => {
  const doc = codeDoc();
  const objects = ["op('./HostExt').module.Mixer(me)", " Cls ( me ) \n", "1a2b(me)", "99(me)", "Cls(xme)", "(me)(me)",
    "x".repeat(65536), `${"y".repeat(65532)}(me)`, `${"z".repeat(65535)}(`];
  doc.operators[0].extensions = objects.map((object, slot) => ext(slot, object, `E${slot}`));
  const result = await verifyPackage(seal(doc).bytes, { unbound: true });
  assert.equal(result.ok, true, JSON.stringify((result.errors || []).slice(0, 3)));
  const t0 = performance.now();
  const model = createModel(result);
  const ms = performance.now() - t0;
  assert.deepEqual(model.extensions("").map((e) => e.className),
    ["Mixer", "Cls", "a2b", null, null, null, null, "y".repeat(65532), null]);
  assert.ok(ms < 500, `createModel ${ms.toFixed(0)} ms (vorher rund 2 s je langem Slot ohne "(me)")`);
});

// Befund kern-f3: Python _check_parameter prueft label, page, custom, style, tuplet. Bei zwei Fehlern im selben
// Parameter entschied in JS bisher style/tuplet (limit) statt custom (schema) - Vertrag 16 verlangt dieselbe Kategorie.
test("Befund kern-f3: zwei Fehler in einem Parameter - erste Kategorie wie Python (custom vor style/tuplet)", async () => {
  for (const field of ["style", "tuplet"]) {
    const doc = weichzeichnerDoc();
    doc.parameters[0][field] = "s".repeat(1025);
    doc.parameters[0].custom = "yes";
    const r = await verifyPackage(seal(doc).bytes, { unbound: true });
    assert.equal(r.ok, false, field);
    assert.deepEqual([r.errors[0].code, r.errors[0].category], ["schema.type", "schema"], `${field}: ${JSON.stringify(r.errors.slice(0, 2))}`);
    assert.match(r.errors[0].path, /^\/parameters\/\d+\/custom$/);
    assert.ok(r.errors.some((e) => e.code === "limit.length" && e.path.endsWith(`/${field}`)), `${field}: zweiter Fehler bleibt gemeldet`);
  }
});

test("Vertrag 4.12: code-* verlangt ein code-Objekt; dynamisch = name \"\" plus dynamic/reason, das Modell nennt den Grund", async () => {
  const result = await verifyPackage(seal(dynamicDoc()).bytes, { unbound: true });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.unknownFields, [], "dynamic und reason sind bekannte Felder");
  const model = createModel(result);
  const [edge] = model.callees("dyn", "Dyn.go");
  assert.deepEqual([edge.target, edge.certainty, edge.reason], [null, "unknown", "dynamic"]);
  assert.deepEqual(model.referencesInSource("dyn").map((r) => [r.kind, r.code, r.target.unresolved]), [["code-op", DYN_CODE, "dynamic"]]);
  // Regeln wie cs_pocket_export._check_reference/_check_dynamic_code (je Fall genau ein Fehler)
  const expectOne = async (mutate, code, path) => {
    const doc = dynamicDoc();
    mutate(doc.references.find((r) => r.kind === "code-op"), doc);
    const r = await verifyPackage(seal(doc).bytes, { unbound: true });
    assert.deepEqual(r.errors.map((e) => [e.code, e.path]), [[code, path]], JSON.stringify(r.errors));
  };
  const at = "/references/1/code";
  await expectOne((r) => { r.code = null; }, "schema.type", at);
  await expectOne((r) => { delete r.code.reason; }, "schema.missing", `${at}/reason`);
  await expectOne((r) => { delete r.code.dynamic; }, "schema.missing", `${at}/dynamic`);
  await expectOne((r) => { r.code.dynamic = false; }, "schema.value", `${at}/dynamic`);
  await expectOne((r) => { r.code.dynamic = 1; }, "schema.type", `${at}/dynamic`);
  await expectOne((r) => { r.code.reason = ""; }, "schema.value", `${at}/reason`);
  await expectOne((r) => { r.code.reason = "r".repeat(201); }, "limit.length", `${at}/reason`);
  await expectOne((r) => { r.code.name = "ziel"; }, "schema.value", `${at}/name`);
  await expectOne((r) => { r.certainty = "static"; }, "schema.value", `${at}/dynamic`);
  await expectOne((r) => { r.target = { unresolved: "not-found" }; }, "schema.value", `${at}/dynamic`);
  // par-* traegt nie code
  await expectOne((r, d) => { d.references[0].code = { art: "call", receiver: null, name: "x" }; }, "schema.value", "/references/0/code");
});

test("Pruefbefund: dynamische Verweise entscheiden keine Aufrufstelle mit (gleiche Zeile und Rueckfall auf dieselbe Quelle)", async () => {
  const result = await verifyPackage(seal(mixedDynamicDoc()).bytes, { unbound: true });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const model = createModel(result);
  const shape = (e) => [e.line, e.via, e.target, e.certainty, e.reason];
  assert.deepEqual(model.callees("mix", "Mix.go").map(shape), [
    [3, "parent", { op: "" }, "static", "op-only"],
    [4, "opshortcut", { external: GLOBAL_PATH }, "static", "external"],
  ]);
  // Zeile 7 hat keinen eigenen Verweis: Rueckfall auf die festen parent()-Verweise der Quelle (Zeilen 3 und 6).
  assert.deepEqual(model.callees("mix", "Mix.later").map(shape), [[7, "parent", { op: "" }, "static", "op-only"]]);
  // Die dynamischen Verweise bleiben sichtbar - nur als Verweis, nie als Ziel einer Aufrufstelle.
  const dynamic = model.referencesInSource("mix").filter((r) => r.code.dynamic === true);
  assert.deepEqual(dynamic.map((r) => [r.from.line, r.kind, r.target.unresolved]), [[3, "code-parent", "dynamic"], [4, "code-shortcut", "dynamic"]]);
});

test("Befund high 3: Platzhalter statt Text (comment, Shortcuts, Ext-Objekt, iop, Annotation) sind gueltig und nie Suchtext", async () => {
  const result = await verifyPackage(seal(markersDoc()).bytes, { unbound: true });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.unknownFields, []);
  const model = createModel(result);
  assert.deepEqual(model.rootOp().comment, { omitted: "secret" });
  assert.equal(model.search("object", { kinds: ["name"] }).total, 0, "kein '[object Object]' im Suchtext");
  assert.equal(model.search("secret", { kinds: ["name"] }).total, 0);
  assert.deepEqual(model.extensions("").map((e) => [e.name, e.promote, e.className]), [["", false, null]]);
  // Platzhalter muessen genau ihre Form haben
  const bad = async (mutate, path) => {
    const doc = markersDoc();
    mutate(doc);
    const r = await verifyPackage(seal(doc).bytes, { unbound: true });
    assert.ok(r.errors.some((e) => e.path === path && e.category === "schema"), `${path}: ${JSON.stringify(r.errors)}`);
  };
  await bad((d) => { d.operators[0].comment = { omitted: "secret", text: "x" }; }, "/operators/0/comment");
  await bad((d) => { d.operators[0].comment = { omitted: "size" }; }, "/operators/0/comment");
  await bad((d) => { d.operators[0].shortcuts.parent = { omitted: "anders" }; }, "/operators/0/shortcuts/parent/omitted");
  await bad((d) => { d.annotations[0].title = { value: "x" }; }, "/annotations/0/title");
  await bad((d) => { d.operators[0].extensions[0].object = { unknown: "geraten", expr: "x" }; }, "/operators/0/extensions/0/object/unknown");
});

test("Befund medium 4: parameters[].omitted erlaubt secret und size", async () => {
  const result = await verifyPackage(seal(exprSizeDoc()).bytes, { unbound: true });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const model = createModel(result);
  assert.deepEqual([model.parameter("", "Long").omitted, model.parameter("", "Long").expr], ["size", null]);
  assert.deepEqual(describeValue(model.parameter("", "Huge").value), { kind: "unknown", reason: "size" });
  const wrong = exprSizeDoc();
  wrong.parameters.find((p) => p.name === "Long").omitted = "anders";
  const r = await verifyPackage(seal(wrong).bytes, { unbound: true });
  assert.equal(r.errors[0].code, "schema.enum");
});

test("Befund medium 5: Kuerzungsangabe heisst truncation (Pflicht, nullable) und passt zum Status", async () => {
  const result = await verifyPackage(seal(truncatedDoc()).bytes, { unbound: true });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.unknownFields, [], "truncation ist bekannt, kein unbekanntes Feld");
  const model = createModel(result);
  assert.deepEqual(model.source("tabelle").truncation, { rows: 3, cols: 2, keptRows: 2, keptCols: 2 });
  const expectCode = async (mutate, code, path) => {
    const doc = truncatedDoc();
    mutate(doc.codeSources[0], doc);
    const r = await verifyPackage(seal(doc).bytes, { unbound: true });
    assert.ok(r.errors.some((e) => e.code === code && e.path === path), `${code}: ${JSON.stringify(r.errors)}`);
  };
  await expectCode((s) => { s.truncation = null; }, "consistency.status", "/codeSources/0/status");
  await expectCode((s) => { s.status = "exact"; }, "consistency.status", "/codeSources/0/status");
  await expectCode((s) => { s.truncated = s.truncation; delete s.truncation; }, "schema.missing", "/codeSources/0/truncation");
  await expectCode((s) => { s.truncation.keptRows = -1; }, "schema.value", "/codeSources/0/truncation/keptRows");
});

test("Befund low 8: warnings.code aus der geschlossenen Liste v1.0, Schwere je Code, Text frei", async () => {
  const withWarnings = (list, minor = 0) => {
    const doc = weichzeichnerDoc();
    doc.schemaMinor = minor;
    doc.warnings = list;
    return seal(doc).bytes;
  };
  const free = await verifyPackage(withWarnings([{ ...warning("capture.retried"), message: "eigener Text" }]), { unbound: true });
  assert.equal(free.ok, true, "Meldungstext wird nicht geprueft (Vertrag 16)");
  const unknown = await verifyPackage(withWarnings([{ ...warning("capture.retried"), code: "export.root-slash" }]), { unbound: true });
  assert.deepEqual(unknown.errors.map((e) => [e.code, e.path]), [["schema.enum", "/warnings/0/code"]]);
  const severity = await verifyPackage(withWarnings([{ ...warning("root.slash"), severity: "info" }]), { unbound: true });
  assert.deepEqual(severity.errors.map((e) => [e.code, e.path]), [["consistency.warning", "/warnings/0/severity"]]);
  // Neuere Minor-Version: unbekannter Code ist kein Ablehnungsgrund, er erscheint im Importbericht.
  const newer = await verifyPackage(withWarnings([{ ...warning("capture.retried"), code: "capture.zukunft" }], 1), { unbound: true });
  assert.equal(newer.ok, true, JSON.stringify(newer.errors));
  assert.deepEqual(newer.unknownFields, ["/warnings/0/code"]);
  assert.equal(Object.keys(WARNING_SEVERITY).length, 19);
});

test("Vertrag 16: report.counts und Verweis-Existenz (dock, connectors, Leitungsenden, target, roles)", async () => {
  const sealed = seal(weichzeichnerDoc());
  const counts = clone(sealed.doc);
  counts.report.counts.codeChars = 9;
  const r = await verifyPackage(reseal(counts).bytes, { unbound: true });
  assert.deepEqual(r.errors.map((e) => [e.code, e.path]), [["consistency.counts", "/report/counts/codeChars"]]);
  assert.deepEqual(packageCounts(seal(codeDoc()).doc), countsOf(seal(codeDoc()).doc), "Modul und Testbauer zaehlen gleich");
  const dangling = async (mutate, path) => {
    const doc = weichzeichnerDoc();
    mutate(doc);
    const result = await verifyPackage(seal(doc).bytes, { unbound: true });
    assert.deepEqual(result.errors.map((e) => [e.code, e.path]), [["consistency.reference", path]]);
  };
  await dangling((d) => { d.operators[2].dock = { op: "nope" }; }, "/operators/1/dock/op");
  await dangling((d) => { d.operators[0].connectors.in[0].inOP = "nope"; }, "/operators/0/connectors/in/0");
  await dangling((d) => { d.connections[0].to = { op: "nope" }; }, "/connections/2/to/op");
  await dangling((d) => { d.references[0].target = { op: "nope" }; }, "/references/0/target/op");
  await dangling((d) => {
    d.operators.push(op("ext_dat", "textDAT", "DAT"));
    d.operators[0].children = 4;
    d.codeSources = [source("ext_dat", "textDAT", "x = 1\n", { roles: [{ kind: "extension", comp: "nope", slot: 0 }] })];
  }, "/codeSources/0/roles/0/comp");
  await dangling((d) => {
    d.operators.push(op("cb", "textDAT", "DAT"));
    d.operators[0].children = 4;
    d.codeSources = [source("cb", "textDAT", "x = 1\n", { roles: [{ kind: "callbacks", owner: "nope", par: "callbacks" }] })];
  }, "/codeSources/0/roles/0/owner");
});

// ------------------------------------------------------------------ Schlusspruefung 1.11.0 (Vertrag 16, 4.7/4.9/4.13)
// Regeln aus cs_pocket_export (_check_operator, _check_end, _check_connection, _check_dependency, _expected_role).
// Der Paketbau erzeugt nichts davon; sie treffen fremde oder manipulierte Pakete. Je Regel genaue Fehlerliste
// (Code und JSON Pointer), damit Kategorie UND Pruefreihenfolge wie in Python bleiben.

async function sealedErrors(doc) {
  const sealed = seal(doc);
  const r = await verifyPackage(sealed.bytes, { unbound: true });
  const errors = r.ok ? [] : r.errors;
  return { doc: sealed.doc, ok: r.ok, errors: errors.map((e) => [e.code, e.path]), first: errors[0] ?? null };
}
const opIndex = (doc, rel) => doc.operators.findIndex((o) => o.rel === rel);

test("Schlusspruefung 1.11.0: kein Operator vom opType annotateCOMP (Vertrag 4.7)", async () => {
  const doc = weichzeichnerDoc();
  doc.operators.push(op("anno1", "annotateCOMP", "COMP"));
  doc.operators[0].children = 4;
  const r = await sealedErrors(doc);
  assert.deepEqual(r.errors, [["schema.value", `/operators/${opIndex(r.doc, "anno1")}/opType`]]);
  assert.equal(r.first.category, "schema");
  // Nur der genaue opType: ein aehnlicher Name ist ein gewoehnlicher Operator.
  const similar = weichzeichnerDoc();
  similar.operators.push(op("anno2", "annotateCOMPx", "COMP"));
  assert.equal((await sealedErrors(similar)).ok, true);
});

test("Schlusspruefung 1.11.0: children, connectors, extensions, internalShortcuts, flags.allowCooking nur an COMPs", async () => {
  // d.operators[1] = in1 (inTOP), nach dem Sortieren Index 2.
  const cases = [
    ["children", (o) => { o.children = 0; }, "/operators/2/children"],
    ["connectors", (o) => { o.connectors = { in: [], out: [] }; }, "/operators/2/connectors"],
    ["extensions", (o) => { o.extensions = [ext(0, "op('./x').module.X(me)", "X")]; }, "/operators/2/extensions"],
    ["internalShortcuts", (o) => { o.internalShortcuts = [{ slot: 0, shortcut: "Blur", op: { value: "blur" } }]; }, "/operators/2/internalShortcuts"],
    ["allowCooking", (o) => { o.flags.allowCooking = true; }, "/operators/2/flags/allowCooking"],
  ];
  for (const [label, mutate, path] of cases) {
    const doc = weichzeichnerDoc();
    mutate(doc.operators[1]);
    const r = await sealedErrors(doc);
    assert.deepEqual(r.errors, [["schema.value", path]], label);
  }
  // Leere Liste bzw. null ist an Nicht-COMPs richtig; an COMPs bleiben alle Felder erlaubt (Root hat sie).
  assert.equal((await sealedErrors(weichzeichnerDoc())).ok, true);
  // Kein bool in isCOMP: nur der Typfehler, keine COMP-Regel (Python: "is False").
  const typed = weichzeichnerDoc();
  typed.operators[1].isCOMP = 0;
  typed.operators[1].children = 0;
  assert.deepEqual((await sealedErrors(typed)).errors, [["schema.type", "/operators/2/isCOMP"]]);
  // Mehrere Felder: Reihenfolge wie Python (children, connectors, extensions, internalShortcuts, allowCooking),
  // alle vor dem node-Fehler.
  const many = weichzeichnerDoc();
  Object.assign(many.operators[1], { children: 1, connectors: { in: [], out: [] }, extensions: "x", internalShortcuts: null,
    node: { unknown: "Nicht lesbar" } });
  many.operators[1].flags.allowCooking = false;
  assert.deepEqual((await sealedErrors(many)).errors.slice(0, 6), [
    ["schema.value", "/operators/2/children"], ["schema.value", "/operators/2/connectors"],
    ["schema.value", "/operators/2/extensions"], ["schema.value", "/operators/2/internalShortcuts"],
    ["schema.value", "/operators/2/flags/allowCooking"], ["schema.pattern", "/operators/2/node/unknown"],
  ]);
});

test("Schlusspruefung 1.11.0: role helper genau fuer einen COMP mit Tag ExtUtils und sein Inneres", async () => {
  const withHelper = helperDoc;
  assert.equal((await sealedErrors(withHelper())).ok, true, "ExtUtils-COMP und Inneres als helper");
  const expectRole = async (mutate, rel, label) => {
    const doc = withHelper();
    mutate(doc);
    const r = await sealedErrors(doc);
    assert.deepEqual(r.errors, [["schema.value", `/operators/${opIndex(r.doc, rel)}/role`]], label);
    assert.equal(r.first.category, "schema", label);
  };
  await expectRole((d) => { d.operators[1].role = "helper"; }, "in1", "helper ausserhalb");
  await expectRole((d) => { d.operators[4].role = "op"; }, "ExtUtils", "ExtUtils-COMP ohne helper");
  await expectRole((d) => { d.operators[5].role = "op"; }, "ExtUtils/inner", "Inneres ohne helper");
  await expectRole((d) => { d.operators[6].role = "op"; }, "ExtUtils/inner/CustomParHelper", "tieferes Inneres ohne helper");
  // Tag an einem Nicht-COMP macht nichts zum helper.
  await expectRole((d) => { d.operators[2].tags = ["ExtUtils"]; d.operators[2].role = "helper"; }, "blur", "Tag an einem TOP");
  const topTag = withHelper();
  topTag.operators[2].tags = ["ExtUtils"];
  assert.equal((await sealedErrors(topTag)).ok, true, "Tag an einem TOP: role op bleibt gueltig");
  // Root mit Tag: alles ist helper.
  const rootTag = weichzeichnerDoc();
  rootTag.operators[0].tags = ["ExtUtils"];
  for (const o of rootTag.operators) o.role = "helper";
  assert.equal((await sealedErrors(rootTag)).ok, true, "Root mit ExtUtils");
  // Pruefreihenfolge wie Python je Operator: dock/connectors-Verweise, dann role, dann parent/rel/path.
  const order = weichzeichnerDoc();
  order.operators[1].role = "helper";
  order.operators[1].dock = { op: "nope" };
  assert.deepEqual((await sealedErrors(order)).errors, [["consistency.reference", "/operators/2/dock/op"], ["schema.value", "/operators/2/role"]]);
  // blur (nicht in den Root-Steckern): sein Operatorfehler ist der erste im Paket.
  const parentLater = weichzeichnerDoc();
  parentLater.operators[2].role = "helper";
  parentLater.operators[2].parent = "missing";
  parentLater.operators[2].rel = "missing/blur";
  const pl = await sealedErrors(parentLater);
  const at = opIndex(pl.doc, "missing/blur");
  assert.deepEqual(pl.errors.slice(0, 2), [["schema.value", `/operators/${at}/role`], ["consistency.parent", `/operators/${at}/parent`]]);
  assert.equal(pl.first.category, "schema", "erster Fehler role vor parent");
});

test("Schlusspruefung 1.11.0: keine Leitung mit zwei externen Enden (Vertrag 4.9)", async () => {
  const doc = weichzeichnerDoc();
  doc.connections[2].to = { external: "/project1/CodeSearch_Tutorial/bild_null" };
  const r = await sealedErrors(doc);
  const at = r.doc.connections.findIndex((w) => w.from.external && w.to.external);
  assert.deepEqual(r.errors, [["schema.value", `/connections/${at}`]]);
  // Ein Ende extern, ein Ende im Teilbaum: gueltig (die beiden Grenzleitungen im Referenzexport).
  assert.equal((await sealedErrors(weichzeichnerDoc())).ok, true);
});

test("Schlusspruefung 1.11.0: externe Enden (Leitung, Dock, Verweisziel) sind absolute Pfade", async () => {
  const wire = weichzeichnerDoc();
  wire.connections[2].from = { external: "project1/CodeSearch_Tutorial/mix" };
  const rw = await sealedErrors(wire);
  const wireAt = rw.doc.connections.findIndex((w) => w.from.external === "project1/CodeSearch_Tutorial/mix");
  assert.deepEqual(rw.errors, [["schema.pattern", `/connections/${wireAt}/from/external`]]);
  const dock = weichzeichnerDoc();
  dock.operators[2].dock = { external: "mix" };
  assert.deepEqual((await sealedErrors(dock)).errors, [["schema.pattern", "/operators/1/dock/external"]]);
  const target = weichzeichnerDoc();
  target.references[0].target = { external: "" };
  assert.deepEqual((await sealedErrors(target)).errors, [["schema.pattern", "/references/0/target/external"]]);
  // "/" allein und tiefe absolute Pfade sind gueltig; ein zu langer Pfad bleibt limit.length (kein zweiter Fehler).
  const root = weichzeichnerDoc();
  root.operators[2].dock = { external: "/" };
  assert.equal((await sealedErrors(root)).ok, true);
  const long = weichzeichnerDoc();
  long.operators[2].dock = { external: "x".repeat(LIMITS.nameChars + 1) };
  assert.deepEqual((await sealedErrors(long)).errors, [["limit.length", "/operators/1/dock/external"]]);
});

test("Schlusspruefung 1.11.0: externalDependencies.path ist ein absoluter Pfad (Vertrag 4.13)", async () => {
  const doc = weichzeichnerDoc();
  doc.externalDependencies[1].path = "project1/CodeSearch_Tutorial/mix";
  const r = await sealedErrors(doc);
  const at = r.doc.externalDependencies.findIndex((d) => d.path === "project1/CodeSearch_Tutorial/mix");
  assert.deepEqual(r.errors, [["schema.pattern", `/externalDependencies/${at}/path`]]);
  const long = weichzeichnerDoc();
  long.externalDependencies[1].path = "/".repeat(LIMITS.nameChars + 1);
  const rl = await sealedErrors(long);
  assert.deepEqual(rl.errors, [["limit.length", `/externalDependencies/${rl.doc.externalDependencies.findIndex((d) => d.path.length > LIMITS.nameChars)}/path`]]);
});

test("Befund medium 7: echte Exporter-Pakete (py-interop) sind gueltig, mit denselben unbekannten Feldern", async () => {
  assert.ok(existsSync(new URL("vectors.lock.json", INTEROP_DIR)), "tools/fixtures/pocket/py-interop fehlt (make_interop.py --write)");
  const report = await checkVectorSet(folderReader(INTEROP_DIR), { exactCodes: true });
  assert.equal(report.cases, 5);
  assert.equal(report.ignoredChecked, 5);
  const lock = JSON.parse(readFileSync(new URL("vectors.lock.json", INTEROP_DIR), "utf8"));
  const read = async (file) => verifyPackage(readFileSync(new URL(file, INTEROP_DIR)), { unbound: true });
  for (const f of lock.files) assert.equal((await read(f.file)).entryErrors.length, f.expect.entryErrors, `${f.file}: Analyse-Eintraege`);
  // Extension: {value} aus dem Exporter
  const extModel = createModel(await read("extension.json"));
  assert.deepEqual(extModel.extensions("").map((e) => [e.name, e.promote, e.className, e.dat]), [["Ext1", true, "Ext1", "Ext1"]]);
  // Platzhalter: Kanarienwert ist nicht im Paket, der Rest lesbar
  const markerBytes = readFileSync(new URL("markers.json", INTEROP_DIR));
  assert.ok(!markerBytes.includes(Buffer.from("ghp_")), "Geheimnis-Kanarie ausgelassen");
  const markers = createModel(await read("markers.json"));
  assert.deepEqual(markers.rootOp().comment, { omitted: "secret" });
  assert.deepEqual(markers.op("big").comment, { unknown: "size" });
  assert.equal(markers.search("sichtbar", { kinds: ["name"] }).hits[0].rel, "plain");
  assert.equal(markers.search("object", { kinds: ["name"] }).total, 0);
  // Gekuerzte Tabelle und uebergrosse Werte
  const table = createModel(await read("table-truncated.json"));
  assert.equal(table.source("table1").status, "truncated");
  assert.deepEqual(table.source("table1").truncation, { cols: 2, keptCols: 2, keptRows: 3, rows: 3 });
  const sizes = createModel(await read("expr-size.json"));
  assert.equal(sizes.parameter("", "Long").omitted, "size");
  assert.deepEqual(describeValue(sizes.parameter("", "Huge").value), { kind: "unknown", reason: "size" });
});

test("Befund low 11/13: echte Analyse - op.Global, parent(), dynamisch, StateAtlas-Namen normalisiert", async () => {
  const model = createModel(await verifyPackage(readFileSync(new URL("real-analysis.json", INTEROP_DIR)), { unbound: true }));
  const go = model.callees("code", "Alpha.Go").map((e) => [e.via, e.target && e.target.symbol, e.target && e.target.op, e.certainty, e.reason]);
  assert.deepEqual(go, [
    ["self", "Alpha.Step", undefined, "static", null],
    ["op", "Engine.Run", "engine", "static", null],
    ["opshortcut", "Glob.Ping", "glob", "static", null],
    ["parent", "Root.Notify", "", "static", null],
  ]);
  assert.deepEqual(model.callers("glob/GlobExt", "Glob.Ping").map((e) => e.from.symbol), ["Alpha.Go"]);
  assert.deepEqual(model.callers("RootExt", "Root.Notify").map((e) => e.from.symbol), ["Alpha.Go"]);
  const [dynamic] = model.callees("code", "Alpha.Step");
  assert.deepEqual([dynamic.target, dynamic.reason], [null, "dynamic"]);
  // Zwei Klassen mit self.value: der Klassenfilter gilt fuer accesses und StateAtlas gleich.
  const alpha = model.writers("code", "value", { className: "Alpha" });
  assert.deepEqual(alpha.map((w) => [w.line, w.symbol]), [[4, "Alpha.__init__"]]);
  assert.deepEqual(model.writers("code", "Alpha.value").map((w) => w.line), [4], "klassenqualifizierter Name wie im StateAtlas");
  assert.deepEqual(model.readers("code", "Beta.value").map((r) => [r.line, r.symbol]), [[21, "Beta.Step"]]);
  assert.deepEqual(model.writers("code", "value").map((w) => w.line).sort((a, b) => a - b), [4, 18]);
  assert.deepEqual(model.writers("code", "Alpha.value", { className: "Beta" }), [], "widerspruechliche Klasse");
  // StateAtlas-Eintraege ohne accesses-Gegenstueck: Methode ohne pocket:<rel>:-Praefix
  const host = createModel(await verifyPackage(seal(codeDoc()).bytes, { unbound: true }));
  const fromAtlas = host.readers("HostExt", "level").find((r) => r.line === 15);
  assert.deepEqual([fromAtlas.symbol, fromAtlas.source, fromAtlas.origin], ["Mixer._apply", "HostExt", "stateAtlas"]);
  assert.deepEqual(host.readers("HostExt", "level", { className: "Recorder" }), []);
});

// ================================================================== Fixtures

test("Fixtures: eigene Vektoren passen zum Lock, sind aktuell und liefern Code und Kategorie", async () => {
  assert.ok(existsSync(new URL("vectors.lock.json", VECTOR_DIR)), "tools/fixtures/pocket/js-vectors/vectors.lock.json fehlt (--write-fixtures)");
  const report = await checkVectorSet(folderReader(VECTOR_DIR), { exactCodes: true });
  const fresh = buildVectors();
  assert.equal(report.files, fresh.vectors.length);
  assert.equal(report.cases, fresh.vectors.length + fresh.cases.length);
  const lock = JSON.parse(readFileSync(new URL("vectors.lock.json", VECTOR_DIR), "utf8"));
  assert.deepEqual(lock.files.map((f) => f.sha256), fresh.vectors.map((v) => nodeSha(v.bytes)), "Fixtures veraltet: --write-fixtures");
  const listed = new Set(lock.files.map((f) => f.file));
  for (const name of readdirSync(VECTOR_DIR)) {
    if (name.endsWith(".json") && name !== "vectors.lock.json") assert.ok(listed.has(name), `nicht im Lock: ${name}`);
  }
  const categories = new Set(lock.files.filter((f) => !f.expect.valid).map((f) => f.expect.category));
  for (const c of [...lock.cases.map((x) => x.expect.category), ...categories]) assert.ok(CATEGORIES.includes(c));
  assert.deepEqual([...categories, "binding"].sort(), [...CATEGORIES].sort(), "jede Kategorie hat einen Vektor");
  assert.ok(lock.files.filter((f) => f.expect.valid).length >= 10);
});

// Vertrag 16: Eigentuemer der Vektoren ist td-codesearch (tests/fixtures/pocket/); hier liegt eine Kopie, die das
// Lock prueft. Pflicht-Gate: jeder Fall aus manifest.json mit gueltig/ungueltig UND Kategorie, dazu c14n- und
// Sortierfaelle. Fehlt die Kopie, schlaegt der Test fehl (kein stilles Ueberspringen mehr).
test("Fixtures: td-codesearch-Vektoren - gueltig/ungueltig und Kategorie fuer jeden Fall (Pflicht-Gate)", async (t) => {
  assert.ok(existsSync(new URL("vectors.lock.json", PY_DIR)), "tools/fixtures/pocket/vectors.lock.json fehlt (Kopie aus td-codesearch)");
  const lock = JSON.parse(readFileSync(new URL("vectors.lock.json", PY_DIR), "utf8"));
  const listed = new Set(lock.files.map((f) => f.path));
  for (const name of readdirSync(new URL("vectors/", PY_DIR))) assert.ok(listed.has(`vectors/${name}`), `nicht im Lock: vectors/${name}`);
  const manifest = JSON.parse(readFileSync(new URL("vectors/manifest.json", PY_DIR), "utf8"));
  const report = await checkVectorSet(folderReader(PY_DIR), { requireCategory: true });
  t.diagnostic(JSON.stringify({ ...report, codeMismatch: report.codeMismatch.length }));
  assert.equal(report.cases, manifest.packages.length, "jeder Fall aus manifest.json");
  assert.equal(report.categoryChecked, report.invalid, "Kategorie fuer jeden ungueltigen Fall");
  assert.equal(report.valid + report.invalid, report.cases);
  assert.ok(report.valid >= 10 && report.invalid >= 40, JSON.stringify(report));
  assert.equal(report.c14n, JSON.parse(readFileSync(new URL("vectors/c14n-cases.json", PY_DIR), "utf8")).length);
  // Jede Kategorie aus Vertrag 16 kommt vor (binding ueber die Bindungs-Faelle).
  const categories = new Set(manifest.packages.filter((p) => !p.ok).map((p) => p.category));
  assert.deepEqual([...categories].sort(), [...CATEGORIES].sort());
});

test("Fixtures: Leser versteht das td-codesearch-Format (Lock + manifest.json, Kategorien, ignored, c14n, Sortierung)", async () => {
  const pkg = seal(weichzeichnerDoc()).bytes;
  const unknown = weichzeichnerDoc();
  unknown.futureField = 1;
  const files = new Map();
  const put = (path, data) => files.set(path, Buffer.isBuffer(data) ? data : Buffer.from(typeof data === "string" ? data : JSON.stringify(data)));
  put("vectors/ok.json", pkg);
  put("vectors/unknown.json", seal(unknown).bytes);
  put("vectors/dup.json", Buffer.from(pkg.toString("utf8").replace('"schemaMinor":0', '"schemaMinor":0,"schemaMinor":0')));
  put("vectors/c14n-cases.json", [
    { name: "key-order", input: '{"9":1,"10":2}', output: '{"10":2,"9":1}', error: null },
    { name: "float", input: '{"x":1.0}', output: null, error: "json.number" },
    { name: "dup", input: '{"a":1,"a":1}', output: null, error: "json.duplicate-key" },
    { name: "proto", input: '{"__proto__":1}', output: null, error: "json.proto" },
    { name: "nan", input: '{"x":NaN}', output: null, error: "json.constant" },
  ]);
  put("vectors/sort-cases.json", [
    { name: "rank", items: [[{ a: 1 }], ["s"], [3], [true], [null]], sorted: [[null], [true], [3], ["s"], [{ a: 1 }]] },
    { name: "objects-by-c14n", items: [[{ op: "b" }], [{ external: "/z" }], [{ op: "" }], [{ unresolved: "dynamic" }]],
      sorted: [[{ external: "/z" }], [{ op: "" }], [{ op: "b" }], [{ unresolved: "dynamic" }]] },
    { name: "operators", list: "operators", rels: ["b", "", "a/x", "a", "\u{1F600}", "\uff61"], sorted: ["", "a", "b", "\u{1F600}", "\uff61", "a/x"] },
  ]);
  put("vectors/manifest.json", {
    format: "codesearch.pocket.vectors", version: 1, c14n: "c14n-cases.json", sorting: "sort-cases.json",
    packages: [
      { file: "ok.json", ok: true, codes: [], ignored: [], maxBytes: null, expect: null },
      { file: "unknown.json", ok: true, codes: [], ignored: ["/futureField"], maxBytes: null, expect: null },
      { file: "ok.json", ok: false, codes: ["size.bytes"], ignored: [], maxBytes: 100, expect: null },
      { file: "ok.json", ok: false, codes: ["binding.project"], ignored: [], maxBytes: null, expect: { projectId: PID2 } },
      { file: "dup.json", ok: false, codes: ["json.duplicate-key"], ignored: [], maxBytes: null, expect: null },
    ],
  });
  put("vectors.lock.json", { format: "codesearch.pocket.vectors-lock", version: 1, algorithm: "sha256",
    files: [...files].map(([path, data]) => ({ path, bytes: data.length, sha256: nodeSha(data) })) });
  const read = (rel) => {
    if (!files.has(rel)) throw new Error(`fehlt: ${rel}`);
    return files.get(rel);
  };
  const report = await checkVectorSet(read);
  assert.deepEqual([report.files, report.cases, report.ignoredChecked, report.c14n, report.sorting], [6, 5, 2, 5, 3]);
  assert.deepEqual(report.codeMismatch.map((m) => m.expected), ["size.bytes"], "nur die Praefix-Namen weichen ab, die Kategorie stimmt");
  // falsche Kategorie im Manifest -> Test schlaegt fehl
  const manifest = JSON.parse(files.get("vectors/manifest.json"));
  manifest.packages[4].category = "canonical";
  put("vectors/manifest.json", manifest);
  put("vectors.lock.json", { files: [...files].filter(([p]) => p !== "vectors.lock.json").map(([path, data]) => ({ path, sha256: nodeSha(data) })) });
  await assert.rejects(checkVectorSet(read), /Kategorie/);
  // falsche ignored-Liste -> Test schlaegt fehl
  manifest.packages[4].category = "json";
  manifest.packages[1].ignored = [];
  put("vectors/manifest.json", manifest);
  put("vectors.lock.json", { files: [...files].filter(([p]) => p !== "vectors.lock.json").map(([path, data]) => ({ path, sha256: nodeSha(data) })) });
  await assert.rejects(checkVectorSet(read), /ignored/);
  files.set("vectors/ok.json", Buffer.from(pkg.toString("utf8").replace("Weichzeichner", "Weichzeichnex")));
  await assert.rejects(checkVectorSet(read), /sha256 vectors\/ok\.json/);
});

test("Fixtures: Lock-Leser versteht gaengige Formen und lehnt unsichere Pfade ab", () => {
  const sha = "a".repeat(64);
  const none = { category: null, ignored: null, binding: null, maxBytes: null };
  assert.deepEqual(normalizeLock({ files: [{ path: "x.json", sha256: sha, expect: "invalid" }] }).entries,
    [{ file: "x.json", sha256: sha, bytes: undefined, expect: { valid: false, code: null, ...none } }]);
  assert.deepEqual(normalizeLock({ files: { "y.json": sha }, expect: { "y.json": { ok: true } } }).entries,
    [{ file: "y.json", sha256: sha, bytes: undefined, expect: { valid: true, code: null, ...none } }]);
  assert.equal(normalizeLock({ files: [{ file: "c.json", sha256: sha, kind: "c14n", expect: true }] }).entries[0].expect, null);
  const withCases = normalizeLock({ files: [{ file: "a.json", sha256: sha }], cases: [{ file: "a.json", expect: { valid: false, code: "binding.project", binding: { projectId: PID2 } } }] });
  assert.deepEqual(withCases.cases[0].expect.binding, { projectId: PID2 });
  assert.throws(() => normalizeLock({ files: [{ file: "../x.json", sha256: sha }] }));
  assert.throws(() => normalizeLock({ files: [], cases: [{ file: "/x.json", expect: true }] }));
  assert.throws(() => normalizeLock({ vectors: [] }));
  assert.equal(expectedCategory("c14n.mismatch"), "canonical");
  assert.equal(expectedCategory("hash.content"), "integrity");
  assert.equal(expectedCategory("size.bytes"), "limit");
  assert.equal(expectedCategory("consistency.counts"), "consistency");
});

// ================================================================== Speicher (MemoryStore und IdbStore auf FakeIDB)

function domError(name, message = name) {
  const error = new Error(message);
  error.name = name;
  return error;
}

// Nachbildung der IndexedDB-Ereignisfolge: Transaktionen einer DB laufen nacheinander (strenger als IndexedDB, das
// nur ueberlappende readwrite-Bereiche serialisiert - fuer diese Tests gleichwertig), der Stand wird erst beim
// Start der Transaktion gelesen, Anfragen in Reihenfolge, onsuccess asynchron, Commit erst ohne offene Anfragen,
// Fehler -> onabort. Stoerungen: quotaBytes, nextTx "hang" | "unknown-error", transactionThrows (Name).
// Kein Ersatz fuer WebKit/Chromium.
class FakeIDBFactory {
  constructor() {
    this.dbs = new Map();
    this.faults = { quotaBytes: Infinity, nextTx: [], transactionThrows: null };
    this.opens = 0;
    this.connections = [];
  }

  schedule(rec, tx) {
    rec.queue.push(tx);
    this.kick(rec);
  }

  kick(rec) {
    if (rec.active || !rec.queue.length) return;
    const tx = rec.queue.shift();
    rec.active = tx;
    setTimeout(() => tx.start(), 0);
  }

  open(name, version) {
    const req = { result: undefined, error: null, transaction: { abort() {} }, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
    this.opens += 1;
    setTimeout(() => {
      let rec = this.dbs.get(name);
      const oldVersion = rec ? rec.version : 0;
      if (version < oldVersion) {
        req.error = domError("VersionError");
        if (req.onerror) req.onerror();
        return;
      }
      if (!rec) {
        rec = { version: 0, stores: new Map() };
        this.dbs.set(name, rec);
      }
      rec.queue = rec.queue || [];
      rec.active = rec.active || null;
      const db = new FakeDB(this, rec);
      this.connections.push(db);
      req.result = db;
      if (version > oldVersion) {
        rec.version = version;
        if (req.onupgradeneeded) req.onupgradeneeded({ oldVersion, newVersion: version });
      }
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }
}

class FakeDB {
  constructor(factory, rec) {
    this.factory = factory;
    this.rec = rec;
    this.closed = false;
    this.onversionchange = null;
    this.onclose = null;
  }

  get objectStoreNames() {
    return [...this.rec.stores.keys()];
  }

  createObjectStore(name, { keyPath }) {
    const store = { keyPath, indexes: new Map(), data: new Map() };
    this.rec.stores.set(name, store);
    return { createIndex: (index, path) => store.indexes.set(index, path) };
  }

  transaction(names, mode) {
    if (this.closed) throw domError("InvalidStateError");
    if (this.factory.faults.transactionThrows) {
      const n = this.factory.faults.transactionThrows;
      this.factory.faults.transactionThrows = null;
      throw domError(n);
    }
    const tx = new FakeTx(this, Array.isArray(names) ? names : [names], mode);
    this.factory.schedule(this.rec, tx);
    return tx;
  }

  close() {
    this.closed = true;
  }
}

const fakeKey = (store, value) => (Array.isArray(store.keyPath) ? store.keyPath.map((p) => value[p]) : value[store.keyPath]);
const fakeKeyString = (key) => JSON.stringify(key);

class FakeTx {
  constructor(db, names, mode) {
    for (const n of names) if (!db.rec.stores.has(n)) throw domError("NotFoundError");
    this.db = db;
    this.names = names;
    this.mode = mode;
    this.error = null;
    this.oncomplete = null;
    this.onabort = null;
    this.onerror = null;
    this.done = false;
    this.started = false;
    this.queue = [];
    this.staged = null;
    this.fault = db.factory.faults.nextTx.shift() || null;
  }

  // Erst jetzt den Stand lesen: vorher laufende Transaktionen derselben DB sind abgeschlossen.
  start() {
    if (this.done) {
      this.release();
      return;
    }
    this.started = true;
    this.staged = new Map(this.names.map((n) => [n, new Map(this.db.rec.stores.get(n).data)]));
    this.pump();
  }

  release() {
    if (this.db.rec.active === this) this.db.rec.active = null;
    this.db.factory.kick(this.db.rec);
  }

  objectStore(name) {
    if (!this.names.includes(name)) throw domError("NotFoundError");
    const store = this.db.rec.stores.get(name);
    const sorted = () => [...this.staged.get(name).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v);
    const dataOf = () => this.staged.get(name);
    const request = (fn) => {
      if (this.done) throw domError("TransactionInactiveError");
      const req = { result: undefined, error: null, onsuccess: null, onerror: null };
      this.queue.push({ req, fn });
      return req;
    };
    const writable = () => {
      if (this.mode !== "readwrite") throw domError("ReadOnlyError");
    };
    const api = {
      get: (key) => request(() => {
        const v = dataOf().get(fakeKeyString(key));
        return v === undefined ? undefined : structuredClone(v);
      }),
      getAll: () => request(() => sorted().map((v) => structuredClone(v))),
      getAllKeys: () => request(() => sorted().map((v) => fakeKey(store, v))),
      put: (value) => {
        writable();
        const copy = structuredClone(value);
        return request(() => {
          dataOf().set(fakeKeyString(fakeKey(store, copy)), copy);
          if (name === "packages") {
            let used = 0;
            for (const v of dataOf().values()) used += v.byteLength || 0;
            if (used > this.db.factory.faults.quotaBytes) throw domError("QuotaExceededError");
          }
          return fakeKey(store, copy);
        });
      },
      delete: (key) => {
        writable();
        return request(() => {
          dataOf().delete(fakeKeyString(key));
        });
      },
      index: (indexName) => {
        const path = store.indexes.get(indexName);
        if (!path) throw domError("NotFoundError");
        const rows = (query) => sorted().filter((v) => v[path] === query);
        return {
          getAll: (query) => request(() => rows(query).map((v) => structuredClone(v))),
          getAllKeys: (query) => request(() => rows(query).map((v) => fakeKey(store, v))),
        };
      },
    };
    return api;
  }

  pump() {
    if (!this.started) return;
    while (!this.done && this.queue.length) {
      const { req, fn } = this.queue.shift();
      try {
        req.result = fn();
      } catch (error) {
        req.error = error;
        if (req.onerror) req.onerror({ target: req });
        this.abortWith(error);
        return;
      }
      if (req.onsuccess) req.onsuccess({ target: req });
    }
    if (this.done) return;
    if (this.fault === "hang") return;
    if (this.fault === "unknown-error") {
      this.abortWith(domError("UnknownError", "Connection to Indexed Database server lost. Refresh the page to try again"));
      return;
    }
    if (this.queue.length) return;
    for (const [n, data] of this.staged) this.db.rec.stores.get(n).data = data;
    this.done = true;
    this.release();
    setTimeout(() => this.oncomplete && this.oncomplete(), 0);
  }

  abort() {
    if (this.done) throw domError("InvalidStateError");
    this.abortWith(domError("AbortError"));
  }

  abortWith(error) {
    if (this.done) return;
    this.done = true;
    this.error = error;
    if (this.started) this.release();
    setTimeout(() => this.onabort && this.onabort(), 0);
  }
}

const STORES = [
  ["MemoryStore", (options = {}) => new MemoryStore(options)],
  ["IdbStore/FakeIDB", (options = {}) => {
    const factory = new FakeIDBFactory();
    if (options.quotaBytes !== undefined) factory.faults.quotaBytes = options.quotaBytes;
    const store = new IdbStore({ ...options, indexedDB: factory, timeoutMs: options.timeoutMs ?? 2000 });
    store.fake = factory;
    return store;
  }],
];

// Mehrere Revisionen desselben Projekts: Inhalt unterscheidet sich im Wert eines Parameters.
function revision(n, { projectName = "Weichzeichner", projectId = PID } = {}) {
  const doc = weichzeichnerDoc();
  doc.projectId = projectId;
  doc.projectName = projectName;
  doc.parameters[0].value = { t: "float", v: `${n}.0` };
  doc.revision.basedOnSeq = Math.max(0, n - 1);
  return seal(doc);
}

async function verified(sealed, seq) {
  const result = await verifyPackage(sealed.bytes, bound(sealed, seq));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return result;
}

for (const [label, make] of STORES) {
  test(`${label}: DB-Name und Stores nach Vertrag 13`, async () => {
    assert.equal(DB_NAME, "cspp-projects-v1");
    assert.deepEqual([...STORE_NAMES], ["projects", "revisions", "packages", "notes", "uistate", "sync"]);
    const store = make();
    assert.deepEqual(await store.listProjects(), []);
    if (store.fake) assert.deepEqual([...store.fake.dbs.get("cspp-projects-v1").stores.keys()].sort(), [...STORE_NAMES].sort());
  });

  test(`${label}: vertauschte Download-Reihenfolge - die neuere Revision bleibt aktiv`, async () => {
    const r5 = revision(5);
    const r6 = revision(6);
    const v5 = await verified(r5, 5);
    const v6 = await verified(r6, 6);
    const store = make();
    assert.equal((await store.activate(v6)).status, "activated");
    const late = await store.activate(v5);
    assert.equal(late.status, "stale", "Speicher meldet aelteren Stand");
    const project = await store.getProject(PID);
    assert.equal(project.activeRevision, r6.doc.revision.id);
    assert.equal(project.activeSeq, 6);
    // gleichzeitig gestartet, beide Reihenfolgen
    for (const order of [[v5, v6], [v6, v5]]) {
      const s = make();
      const results = await Promise.all(order.map((v) => s.activate(v)));
      assert.equal((await s.getProject(PID)).activeSeq, 6, JSON.stringify(results.map((x) => x.status)));
    }
  });

  test(`${label}: gleiche seq, gleiche Revision, ABA und ausdrueckliche aeltere Wahl`, async () => {
    const a = revision(1);
    const b = revision(2);
    const store = make();
    assert.equal((await store.activate(await verified(a, 1))).status, "activated");
    assert.equal((await store.activate(await verified(a, 1))).status, "already-active");
    assert.equal((await store.activate(await verified(b, 1))).status, "seq-conflict");
    assert.equal((await store.activate(await verified(b, 2))).status, "activated");
    const again = await store.activate(await verified(a, 3));
    assert.equal(again.status, "activated", "A -> B -> A: Kopf-seq entscheidet, nicht die Revisions-ID");
    let project = await store.getProject(PID);
    assert.equal(project.activeRevision, a.doc.revision.id);
    assert.equal(project.previousRevision, b.doc.revision.id);
    const metaA = (await store.listRevisions(PID)).find((m) => m.revisionId === a.doc.revision.id);
    assert.deepEqual([metaA.firstSeq, metaA.lastSeq], [1, 3]);
    // ausdrueckliche Wahl einer aelteren Revision (z.B. nach "Speicher meldet aelteren Stand")
    const explicit = await store.activate(await verified(b, 2), { explicit: true });
    assert.equal(explicit.status, "activated");
    project = await store.getProject(PID);
    assert.deepEqual([project.activeRevision, project.activeSeq], [b.doc.revision.id, 2]);
  });

  test(`${label}: Aufbewahrung - aktives und vorheriges Paket, Metadaten bleiben`, async () => {
    const store = make();
    const revs = [revision(1), revision(2), revision(3)];
    for (let i = 0; i < revs.length; i += 1) await store.activate(await verified(revs[i], i + 1));
    assert.equal(await store.getPackage(PID, revs[0].doc.revision.id), null);
    assert.ok(await store.getPackage(PID, revs[1].doc.revision.id));
    const active = await store.getActivePackage(PID);
    assert.equal(active.revision.revisionId, revs[2].doc.revision.id);
    assert.ok(Buffer.from(active.bytes).equals(revs[2].bytes), "gespeicherte Bytes = kanonische Bytes");
    assert.equal((await verifyStored(active.bytes, { projectId: PID, revisionId: active.project.activeRevision, seq: active.project.activeSeq })).ok, true);
    assert.equal((await store.listRevisions(PID)).length, 3);
  });

  test(`${label}: Loeschen waehrend eines Abgleichs - Projekt bleibt geloescht`, async () => {
    const r6 = revision(6);
    const v6 = await verified(r6, 6);
    for (const passSignal of [true, false]) {
      const store = make();
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const run = store.syncProject(PID, async (signal) => {
        await gate;       // Download laeuft noch
        return store.activate(v6, passSignal ? { signal } : {});
      });
      await store.removeLocal(PID);
      release();
      const result = await run;
      assert.equal(result.status, passSignal ? "aborted" : "deleted");
      assert.equal(await store.getProject(PID), null);
      assert.equal(await store.isLocallyRemoved(PID), true);
      assert.equal((await store.activate(v6)).status, "deleted", "auch spaetere Ausloeser legen es nicht wieder an");
      assert.equal((await store.markServerState(PID, { status: "active" })).status, "deleted");
      await store.clearLocalRemoval(PID);
      assert.equal((await store.activate(v6)).status, "activated", "erst ausdrueckliches Wiederladen");
    }
  });

  // Befund medium 6: vorher legte ein schon laufender Abgleich die Projekte nach "lokale Projekte loeschen" wieder an.
  test(`${label}: Abmelden mit Loeschen waehrend eines Abgleichs - nichts wird wieder angelegt`, async () => {
    const v1 = await verified(revision(1), 1);
    const w1 = await verified(revision(1, { projectId: PID2 }), 1);
    for (const passSignal of [true, false]) {
      const store = make();
      await store.activate(w1);
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const run = store.syncProject(PID, async (signal) => {
        await gate;
        return store.activate(v1, passSignal ? { signal } : {});
      });
      const cleared = await store.clearProjects({ keepNotes: true });
      assert.equal(cleared.projects, 1);
      assert.equal(cleared.epoch, 1);
      release();
      const result = await run;
      assert.equal(result.status, "aborted", JSON.stringify(result));
      if (!passSignal) assert.equal(result.reason, "cleared", "ohne Signal greift die Epoche in der Transaktion");
      assert.deepEqual(await store.listProjects(), [], "Abmelden bleibt wirksam");
      assert.equal(await store.syncEpoch(), 1);
      // Ein neuer Abgleich nach dem erneuten Anmelden laedt normal.
      assert.equal((await store.syncProject(PID, () => store.activate(v1))).status, "activated");
      assert.equal(await store.isLocallyRemoved(PID), false, "kein Loeschvermerk je Projekt");
    }
    // Eine Aktivierung, die vor dem Loeschen gestartet wurde, aber erst danach in die Transaktion kommt.
    const store = make();
    const pending = store.activate(v1);
    const cleared = store.clearProjects();
    await Promise.all([pending, cleared]);
    assert.deepEqual(await store.listProjects(), [], "Aktivierung und Loeschen in beliebiger Reihenfolge: am Ende leer");
    await assert.rejects(store.putSyncValue(CLEAR_EPOCH_KEY, 0), (e) => e.code === "invalid", "Epoche ist reserviert");
    await assert.rejects(store.deleteSyncValue(CLEAR_EPOCH_KEY), (e) => e.code === "invalid");
  });

  // Befund kern-f1 (Schlusspruefung 1.11.0): die Epoche wurde je Projekt-Download gelesen, markServerState pruefte sie
  // gar nicht. Ein Abgleich in einem zweiten Tab legte nach "Abmelden + lokale Projekte loeschen" die spaeteren
  // Index-Projekte wieder an. Jetzt prueft jede Schreib-Transaktion des Laufs die Epoche vom Start des Laufs.
  test(`${label}: Schreiben unter der Epoche eines Abgleichs - nach dem Loeschen legt es nichts mehr an`, async () => {
    const store = make();
    const run = { epoch: await store.syncEpoch() };
    assert.equal((await store.markServerState(PID, { status: "active" }, run)).status, "updated", "vor dem Loeschen normal");
    await store.clearProjects({ keepNotes: true });
    const stopped = { status: "aborted", reason: "cleared" };
    const head = { seq: 2, revisionId: `rev_${"2".repeat(32)}`, projectName: "Indexname" };
    assert.deepEqual(await store.markServerState(PID2, { status: "active", head }, run), stopped);
    assert.deepEqual(await store.putSyncValue("pp-index", { etag: null, index: { projects: [] } }, run), stopped);
    assert.deepEqual(await store.putUiState(`sync-failure:${PID2}`, { code: "revision-missing" }, { projectId: PID2, ...run }), stopped);
    const v1 = await verified(revision(1), 1);
    assert.equal((await store.syncProject(PID, () => store.activate(v1), run)).reason, "cleared", "Aktivierung mit der Epoche des Laufs");
    assert.deepEqual(await store.listProjects(), [], "kein Datensatz, kein Paket");
    assert.equal(await store.getPackage(PID, v1.revisionId), null);
    assert.equal(await store.getSyncValue("pp-index"), null, "gemerkter Index nicht wieder angelegt");
    assert.equal(await store.getUiState(`sync-failure:${PID2}`), null);
    // Ein neuer Lauf liest die neue Epoche und schreibt normal; ohne Epoche bleibt alles wie vorher.
    const next = { epoch: await store.syncEpoch() };
    assert.equal(next.epoch, 1);
    assert.equal((await store.markServerState(PID2, { status: "active", head }, next)).status, "updated");
    assert.equal((await store.putSyncValue("pp-index", { etag: null }, next)).status, "saved");
    assert.equal((await store.putUiState("view:x", { a: 1 })).status, "saved");
    assert.equal((await store.syncProject(PID, () => store.activate(v1), next)).status, "activated");
  });

  test(`${label}: Quota - nichts halb geschrieben, Meldung mit estimate()`, async () => {
    const r1 = revision(1);
    const r2 = revision(2);
    const store = make({ quotaBytes: r1.bytes.length + 10 });
    assert.equal((await store.activate(await verified(r1, 1))).status, "activated");
    await assert.rejects(store.activate(await verified(r2, 2)), (error) => {
      assert.ok(error instanceof StoreError);
      assert.equal(error.code, "quota");
      assert.ok(Object.hasOwn(error.detail, "estimate"));
      assert.ok(!error.message.includes("Weichzeichner"));
      return true;
    });
    const project = await store.getProject(PID);
    assert.deepEqual([project.activeRevision, project.activeSeq], [r1.doc.revision.id, 1]);
    assert.equal((await store.listRevisions(PID)).length, 1, "keine halbe Revision");
  });

  test(`${label}: Serverzustand markiert lokal, Anzeigename-Vorrang, Aufraeumen beim Start`, async () => {
    const store = make();
    const r1 = revision(1, { projectName: "Exportname" });
    await store.activate(await verified(r1, 1), { head: { seq: 1, revisionId: r1.doc.revision.id, projectName: "Kopfname", committedAt: "2026-11-05T11:00:00Z" } });
    let project = await store.getProject(PID);
    assert.equal(projectDisplayName(project), "Kopfname");
    await store.markServerState(PID, { status: "deleted" });
    project = await store.getProject(PID);
    assert.equal(project.serverStatus, "deleted");
    assert.equal(project.activeRevision, r1.doc.revision.id, "Grabstein auf dem Speicher loescht lokal nichts still");
    await store.setLocalName(PID, "Mein Name");
    assert.equal(projectDisplayName(await store.getProject(PID)), "Mein Name");
    await store.markServerState(PID2, { status: "active", head: { seq: 4, revisionId: `rev_${"2".repeat(32)}`, projectName: "Indexname" } });
    assert.equal(projectDisplayName(await store.getProject(PID2)), "Indexname");
    await assert.rejects(store.activate(await verified(r1, 2), { head: { seq: 3, revisionId: r1.doc.revision.id } }), (e) => e.code === "invalid");
    const report = await store.cleanup();
    assert.deepEqual(report, { packages: 0, revisions: 0 });
  });

  test(`${label}: Notizen - Export/Import auf Datenebene, verwaiste Notizen haengen sich wieder an`, async () => {
    const sealed = seal(codeDoc());
    const store = make();
    await store.activate(await verified(sealed, 1));
    const model = createModel(await verified(sealed, 1));
    const anchor = await createAnchor(model, { kind: "symbol", source: "HostExt", symbol: "Recorder.Record" });
    const note = await store.createNote({ projectId: PID, anchor, text: "Zaehlt hoch." });
    assert.match(note.id, /^note_[0-9a-f]{32}$/);
    const file = await store.exportNotes();
    assert.equal(file.format, NOTES_FORMAT);
    assert.ok(file.warning.includes("privatem Code"));
    assert.equal(file.notes.length, 1);
    const other = make();
    const forged = { ...clone(file.notes[0]), id: `note_${"f".repeat(32)}`, extra: "<img src=x onerror=alert(1)>" };
    const bad = { ...clone(file.notes[0]), id: "note_kaputt" };
    const report = await other.importNotes({ ...file, notes: [...file.notes, forged, bad] });
    assert.deepEqual(report, { added: 2, replaced: 0, skipped: 0, invalid: 1 });
    assert.equal(Object.hasOwn(await other.getNote(forged.id), "extra"), false, "nur bekannte Felder");
    assert.deepEqual(await other.importNotes(file), { added: 0, replaced: 0, skipped: 1, invalid: 0 });
    await assert.rejects(other.importNotes({ format: "x", version: 1, notes: [] }), (e) => e.code === "invalid");
    await store.removeLocal(PID);
    assert.equal((await store.listOrphanNotes()).length, 1, "Notizen ohne Projekt bleiben");
    await store.clearLocalRemoval(PID);
    await store.activate(await verified(sealed, 2));
    assert.equal((await store.listOrphanNotes()).length, 0);
    assert.equal((await store.listNotes(PID)).length, 1);
  });

  // Befund low 10: vorher meldete der Bericht zwei hinzugefuegte Notizen, gespeichert war eine (die zweite).
  test(`${label}: Notiz-Import mit doppelter ID in derselben Datei - die erste gewinnt, Bericht stimmt`, async () => {
    const model = createModel(await verifyPackage(seal(weichzeichnerDoc()).bytes, { unbound: true }));
    const anchor = await createAnchor(model, { kind: "op", op: "blur" });
    const note = { id: `note_${"a".repeat(32)}`, projectId: PID, anchor, text: "erste", createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z" };
    const store = make();
    const report = await store.importNotes({ format: NOTES_FORMAT, version: 1, notes: [note, { ...note, text: "zweite" }] });
    assert.deepEqual(report, { added: 1, replaced: 0, skipped: 1, invalid: 0 });
    const stored = await store.listNotes();
    assert.deepEqual(stored.map((n) => n.text), ["erste"]);
    const again = await store.importNotes({ format: NOTES_FORMAT, version: 1, notes: [{ ...note, text: "dritte" }, { ...note, text: "vierte" }] }, { replace: true });
    assert.deepEqual(again, { added: 0, replaced: 1, skipped: 1, invalid: 0 });
    assert.equal((await store.getNote(note.id)).text, "dritte");
  });

  test(`${label}: Ansichtszustand und Abgleich-Daten, reservierter Loeschvermerk`, async () => {
    const store = make();
    await store.putUiState(`${PID}\nrev\nnet`, { zoom: 2 }, { projectId: PID });
    assert.deepEqual(await store.getUiState(`${PID}\nrev\nnet`), { zoom: 2 });
    await store.putSyncValue("etag:index", "W/\"1\"");
    assert.equal(await store.getSyncValue("etag:index"), "W/\"1\"");
    await assert.rejects(store.putSyncValue(`local-removed:${PID}`, 1), (e) => e.code === "invalid");
    await assert.rejects(store.deleteSyncValue(`local-removed:${PID}`), (e) => e.code === "invalid");
    await store.removeLocal(PID);
    assert.equal(await store.getUiState(`${PID}\nrev\nnet`), null, "Projekt-Ansichtszustand geht mit");
    assert.equal(await store.getSyncValue("etag:index"), "W/\"1\"");
  });
}

test("ProjectFlights: hoechstens ein Abgleich je Projekt, weitere Ausloeser teilen sich einen Nachlauf", async () => {
  const flights = new ProjectFlights();
  let running = 0;
  let peak = 0;
  let runs = 0;
  const task = (ms) => async () => {
    running += 1;
    runs += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, ms));
    running -= 1;
    return runs;
  };
  const first = flights.run(PID, task(30));
  const second = flights.run(PID, task(5));
  const third = flights.run(PID, task(5));
  const otherProject = flights.run(PID2, task(5));
  assert.equal(flights.isRunning(PID), true);
  const [a, b, c] = await Promise.all([first, second, third, otherProject]);
  assert.equal(peak, 2, "nur je Projekt seriell - zwei Projekte duerfen parallel");
  assert.equal(a, 2);
  assert.equal(b, c, "zweiter und dritter Ausloeser teilen sich EINEN Nachlauf");
  assert.equal(runs, 3);
  const slow = flights.run(PID, (signal) => new Promise((resolve) => {
    if (signal.aborted) resolve("abgebrochen");
    signal.addEventListener("abort", () => resolve("abgebrochen"));
  }));
  const queued = flights.run(PID, task(1));
  flights.abort(PID);
  assert.equal(await slow, "abgebrochen");
  assert.deepEqual(await queued, { status: "aborted" });
  // abortAll (Abmelden): alle Projekte zugleich
  const waitAbort = (signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve("weg")));
  const one = flights.run(PID, waitAbort);
  const two = flights.run(PID2, waitAbort);
  assert.equal(flights.abortAll(), 2);
  assert.deepEqual(await Promise.all([one, two]), ["weg", "weg"]);
});

test("IdbStore: connection lost -> einmal neu oeffnen, danach reload; Zeitlimit; versionchange; Upgrade-Fehler", async () => {
  const sealed = revision(1);
  const v1 = await verified(sealed, 1);
  const factory = new FakeIDBFactory();
  const store = new IdbStore({ indexedDB: factory, timeoutMs: 60 });
  await store.listProjects();
  // activate liest zuerst die Epoche (eigene Transaktion), dann kommt die Aktivierung selbst.
  factory.faults.nextTx.push(null, "unknown-error");
  assert.equal((await store.activate(v1)).status, "activated");
  assert.equal(store.reconnects, 1);
  factory.faults.nextTx.push("unknown-error", "unknown-error");
  await assert.rejects(store.listProjects(), (e) => e.code === "connection-lost" && e.detail.reload === true);
  factory.faults.transactionThrows = "InvalidStateError";
  assert.equal((await store.listProjects()).length, 1, "geschlossene Verbindung: neu geoeffnet");
  factory.faults.nextTx.push("hang");
  const started = performance.now();
  await assert.rejects(store.listProjects(), (e) => e.code === "timeout");
  assert.ok(performance.now() - started < 1000);
  assert.equal((await store.listProjects()).length, 1, "nach Zeitlimit frische Verbindung");
  const opensBefore = factory.opens;
  const db = factory.connections.at(-1);
  db.onversionchange();
  assert.equal(db.closed, true, "versionchange gibt die Verbindung frei");
  await store.listProjects();
  assert.equal(factory.opens, opensBefore + 1);
  // neuere DB-Version auf dem Geraet: VersionError -> "version"
  const newer = new FakeIDBFactory();
  newer.dbs.set("cspp-projects-v1", { version: 9, stores: new Map() });
  await assert.rejects(new IdbStore({ indexedDB: newer }).listProjects(), (e) => e.code === "version");
  assert.equal(createProjectStore({ indexedDB: null, location: null }), null, "ohne IndexedDB (Node) kein Projektspeicher");
  await assert.rejects(new IdbStore({ indexedDB: null }).listProjects(), (e) => e.code === "unavailable");
});

// Befund low 12: vorher entschied nur das Fehlen von IndexedDB - Chromium bietet es auch unter file:// an.
test("createProjectStore: Einzeldatei (file://) hat keine Projekte, auch wenn IndexedDB da ist", () => {
  const factory = new FakeIDBFactory();
  assert.equal(createProjectStore({ indexedDB: factory, location: { protocol: "file:" } }), null);
  assert.ok(createProjectStore({ indexedDB: factory, location: { protocol: "https:" } }) instanceof IdbStore);
  assert.ok(createProjectStore({ indexedDB: factory, location: null }) instanceof IdbStore, "ohne location (Worker, Node) entscheidet IndexedDB");
});

test("MemoryStore: Revision mit gleicher ID und anderem contentHash ist ein Integritaetsfehler", async () => {
  const store = new MemoryStore();
  const r1 = revision(1);
  const v1 = await verified(r1, 1);
  await store.activate(v1);
  const key = `${PID}\u0000${r1.doc.revision.id}`;
  store._data.get("revisions").get(key).contentHash = `sha256:${"9".repeat(64)}`;
  await assert.rejects(store.activate(await verified(r1, 2)), (e) => e.code === "integrity-conflict");
  assert.equal((await store.getProject(PID)).activeSeq, 1);
});

// ================================================================== Modell

test("Modell: Weichzeichner - Pfade, Hierarchie, Leitungen, Annotation, Parameter ohne erfundene Werte", async () => {
  const model = createModel(await verifyPackage(seal(weichzeichnerDoc()).bytes, { unbound: true }));
  assert.equal(model.abs(""), "/project1/CodeSearch_Tutorial/Weichzeichner");
  assert.equal(model.abs("blur"), "/project1/CodeSearch_Tutorial/Weichzeichner/blur");
  assert.equal(model.relOf("/project1/CodeSearch_Tutorial/Weichzeichner/blur"), "blur");
  assert.equal(model.relOf("/project1/CodeSearch_Tutorial/mix"), null);
  assert.deepEqual(model.children("").map((o) => o.rel), ["blur", "in1", "out1"]);
  const net = model.network("");
  assert.equal(net.known.length, 3);
  assert.equal(net.unknown.length, 0);
  assert.deepEqual(net.wires.map((w) => `${w.from.op}:${w.fromIndex}>${w.to.op}:${w.toIndex}`).sort(), ["blur:0>out1:0", "in1:0>blur:0"]);
  assert.deepEqual(net.boundary.in.map((w) => w.from.external), ["/project1/CodeSearch_Tutorial/mix"]);
  assert.deepEqual(net.boundary.out.map((w) => w.to.external), ["/project1/CodeSearch_Tutorial/bild_null"]);
  assert.equal(net.annotations[0].enclosed.length, 3);
  assert.equal(net.hiddenChildren, 0);
  const size = model.parameter("blur", "size");
  assert.deepEqual(describeValue(size.value), { kind: "unknown", reason: "mode-bind" });
  assert.equal(size.storedConstant.v, "7", "ruhender Constant-Wert nur als storedConstant");
  const staerke = model.parameter("", "Staerke");
  assert.deepEqual(describeValue(staerke.value), { kind: "value", t: "float", text: "4.0" }, "Float woertlich, nie Number()");
  assert.equal(staerke.default.v, "4.0");
  assert.equal(model.parameter("in1", "label").mode, "expression");
  assert.equal(model.parameter("out1", "label").expr, "me.name");
  assert.deepEqual(model.referencesTo("").map((r) => r.kind), ["par-bind"]);
  assert.deepEqual(model.externalDependencies().map((d) => d.path), ["/project1/CodeSearch_Tutorial/bild_null", "/project1/CodeSearch_Tutorial/mix"]);
  assert.equal(model.externalUsers("/project1/CodeSearch_Tutorial/mix").connections.length, 1);
});

test("Modell: zwei Klassen und eine Modulfunktion - self nur in der eigenen Klasse, Aufrufer ueber Verweise", async () => {
  const result = await verifyPackage(seal(codeDoc()).bytes, { unbound: true });
  const model = createModel(result);
  assert.deepEqual(model.classes("HostExt").map((c) => c.name), ["Mixer", "Recorder"]);
  assert.equal(model.symbols("HostExt").length, 7);
  assert.equal(model.symbol("HostExt", "<module>.helper").kind, "function");
  assert.equal(model.symbolAt("HostExt", 24).symbol, "Recorder.Record");
  const recordCalls = model.callees("HostExt", "Recorder.Record");
  assert.deepEqual(recordCalls.map((e) => e.target.symbol), ["Recorder._apply"], "nicht Mixer._apply");
  assert.equal(recordCalls[0].certainty, "static");
  assert.deepEqual(model.callers("HostExt", "Mixer._apply").map((e) => e.from.symbol), ["Mixer.Mix"]);
  const mixCallers = model.callers("HostExt", "Mixer.Mix");
  assert.deepEqual(mixCallers.map((e) => [e.from.symbol, e.via, e.certainty]), [["Recorder._apply", "parentshortcut", "static"]]);
  const run = model.callees("HostExt", "<module>.helper");
  assert.deepEqual(run.map((e) => [e.target.source, e.target.symbol, e.target.op, e.certainty]), [["engine/EngineExt", "Engine.Run", "engine", "static"]]);
  assert.deepEqual(model.callers("engine/EngineExt", "Engine.Run").map((e) => e.from.source), ["HostExt"]);
  const level = model.stateAccess("HostExt", "level");
  assert.deepEqual(level.writers.map((w) => [w.how, w.line]).sort(), [["init", 7], ["write", 10]]);
  assert.deepEqual(level.readers.map((r) => r.line).sort((a, b) => a - b), [12, 15]);
  assert.equal(model.stateAccess("HostExt", "count", { className: "Mixer" }).readers.length, 0);
  assert.deepEqual(model.readers("HostExt", "count", { className: "Recorder" }).map((r) => r.line), [28]);
  assert.deepEqual(model.writers("HostExt", "count").map((w) => w.how).sort(), ["init", "mutate"]);
  assert.deepEqual(model.states("HostExt").map((s) => `${s.class}.${s.name}`), ["Mixer.ownerComp", "Mixer.level", "Recorder.ownerComp", "Recorder.count"]);
  assert.deepEqual(model.entry("broken"), { error: "schema" });
  assert.equal(model.sourceLines("broken")[0], "x = 1", "Quelle bleibt lesbar");
  assert.equal(model.sourceLines("HostExt").length, HOST_LINES.length + 1);
  assert.deepEqual(model.extensions("").map((e) => [e.dat, e.className, e.certainty]), [["HostExt", "Mixer", "captured"]]);
  // Netz mit gemischt bekannten und unbekannten Positionen
  const net = model.network("");
  assert.deepEqual(net.unknown.map((u) => [u.rel, u.reason]), [["ghost", "not-readable"]]);
  assert.ok(!net.known.some((k) => k.rel === "ghost"), "Position wird nie geschaetzt");
  assert.deepEqual(net.wires.map((w) => [w.to.op, w.dashed]).sort(), [["ghost", true], ["target", false]]);
  assert.equal(net.hiddenChildren, 0);
  assert.equal(model.hiddenChildren("engine"), 0);
  const doc = codeDoc();
  doc.operators[0].children = 9;
  assert.equal(createModel(await verifyPackage(seal(doc).bytes, { unbound: true })).hiddenChildren(""), 2, "Kinder nicht exportiert");
});

test("Modell: Suche ueber Namen, Pfade, Code, Methoden, Parameter mit Grenzen wie search.js", async () => {
  const model = createModel(await verifyPackage(seal(codeDoc()).bytes, { unbound: true }));
  const mix = model.search("Mix");
  assert.ok(mix.hits.some((h) => h.kind === "method" && h.text.startsWith("Mixer.Mix(") && h.line === 9 && h.rel === "HostExt"));
  assert.ok(mix.hits.every((h) => h.revisionId === model.revisionId));
  const code = model.search("opacity");
  assert.deepEqual(code.hits.filter((h) => h.kind === "code").map((h) => [h.rel, h.line]), [["HostExt", 15]]);
  assert.ok(code.hits.some((h) => h.kind === "parameter" && h.rel === "target" && h.par === "opacity"));
  assert.equal(model.search("opacity", { kinds: ["table"] }).hits[0].rel, "lookup");
  assert.equal(model.search("engine*", { kinds: ["name"] }).hits[0].rel, "engine");
  // Ein Op, dessen Name trifft, erscheint nicht noch einmal als Pfad-Treffer.
  assert.deepEqual(model.search("EngineExt").hits.filter((h) => h.rel === "engine/EngineExt").map((h) => h.kind), ["name"]);
  assert.deepEqual(model.search("EngineExt", { kinds: ["path"] }).hits.map((h) => h.text), ["/project1/Host/engine/EngineExt"]);
  assert.ok(model.search("engine/Engine*", { kinds: ["path"] }).hits.some((h) => h.text === "/project1/Host/engine/EngineExt"));
  const secret = model.search("Apikey");
  assert.equal(secret.hits[0].text, "Apikey = (omitted: secret)");
  assert.deepEqual(model.search("x").unsearchable, [{ reason: "omitted-secret", count: 1 }]);
  assert.equal(model.search("a".repeat(513)).error, "too-long");
  assert.equal(model.search("a".repeat(512)).error, undefined);
  assert.equal(model.search("   ").error, "empty");
  assert.equal(model.search("self", { maxResults: 3 }).hits.length, 3);
  assert.equal(model.search("self", { maxResults: 9999 }).limit, SEARCH_LIMITS.maxResults);
  assert.equal(model.search("self", { maxResults: 0 }).limit, SEARCH_LIMITS.defaultResults);
  assert.ok(model.search("self").total >= model.search("self").hits.length);
});

// Paket mit einer Code-Zeile aus n Zeichen "a" (Vertrag 14: Pflicht-Testvektor "eine Zeile mit 1 Mio. Zeichen").
async function longLineModel(n) {
  const doc = weichzeichnerDoc();
  doc.operators[0].children = 4;
  doc.operators.push(op("lang", "textDAT", "DAT"));
  doc.codeSources = [source("lang", "textDAT", "a".repeat(n))];
  const result = await verifyPackage(seal(doc).bytes, { unbound: true });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return createModel(result);
}

test("Modell: Suche ohne Rueckverfolgung - 1 Mio. Zeichen und a*a*a*a*b unter 200 ms, Grenzen im Ergebnis", async (t) => {
  const model = await longLineModel(1_000_000);
  let started = performance.now();
  const result = model.search("a*a*a*a*b");
  const ms = performance.now() - started;
  t.diagnostic(`1 Mio. Zeichen: ${ms.toFixed(1)} ms`);
  assert.equal(result.error, undefined);
  assert.equal(result.counts.code, 0);
  assert.deepEqual(result.limits, { maxWildcards: 4, literalAbove: 20000, literalTexts: 1 }, "die Zeile lief woertlich");
  assert.ok(ms < 200, `${ms} ms`);
  // Woertlich heisst: Teile der Reihe nach als Teilstring, ohne Wortgrenzen - "aaa" trifft mitten in der Zeile.
  assert.equal(model.search("aaa", { kinds: ["code"] }).counts.code, 1);
  assert.equal(model.search("a*a*a", { kinds: ["code"] }).counts.code, 1);
  assert.equal(model.search("b", { kinds: ["code"] }).counts.code, 0);
  // Unter der Grenze laeuft die volle Suchsprache - auch dort ohne RegExp (das Kurs-Muster brauchte 15 s auf 800).
  const short = await longLineModel(SEARCH_LIMITS.literalAbove);
  started = performance.now();
  const shortResult = short.search("a*a*a*a*b");
  const shortMs = performance.now() - started;
  t.diagnostic(`20 000 Zeichen: ${shortMs.toFixed(1)} ms`);
  assert.deepEqual([shortResult.counts.code, shortResult.limits.literalTexts], [0, 0]);
  assert.ok(shortMs < 200, `${shortMs} ms`);
  assert.equal(short.search("aaa", { kinds: ["code"] }).counts.code, 0, "ganzes Wort: aaa ist nicht die Zeile");
  assert.equal(short.search("*aaa*", { kinds: ["code"] }).counts.code, 1);
  // Hoechstens 4 "*" je Suchbegriff; in einer Phrase sind "*" woertlich
  const tooMany = model.search("a*a*a*a*a*b");
  assert.deepEqual([tooMany.error, tooMany.total], ["wildcards", 0]);
  assert.equal(tooMany.message, "Höchstens 4 * je Suchbegriff.");
  assert.equal(model.search("^a*a*a*a*a*b x").error, "wildcards");
  assert.equal(model.search('"a*a*a*a*a*b"').error, undefined);
  assert.equal(model.search("a*a*a*a*b").error, undefined);
});

test("Modell: Suchsprache wie compileQuery der Kurs-Suche (Woerter, ^ohne, ODER, Phrase, *, Gross/Klein)", async () => {
  const { compileQuery } = await import("../js/core/util.js");
  const { compileSearch } = await import("../js/projects/model.js");
  const lines = ["    self.tick = 0", "ticker = tick_count + 1", "def Tick(self):", "x = op('target').par.opacity",
    "a\rb", "alpha beta gamma", "beta-gamma alpha", "", "__init__", "Grüße und tick", "tick\u2028tock", "a.b*c"];
  const queries = ["tick", "tick*", "*tick", "*tick*", "Tick", "t*k", "a*b", "alpha gamma", "alpha ^beta", "alpha | tick",
    '"beta gamma"', "op('target')", "self", "^self", "__init__", "*", "^", "a*", "*a", "t*ck*", "tick*tock", "b*c", "a.b*c",
    "gr*e", "x | ^y", "op(*)", "**", "a**", "**a", "a**b", "*_*", "tick**", "**tick", "t**k"];
  let compared = 0;
  for (const caseSensitive of [false, true]) {
    for (const whole of [true, false]) {
      for (const query of queries) {
        const expected = compileQuery(query, { caseSensitive, whole });
        const got = compileSearch(query, { caseSensitive, whole });
        assert.equal(got === null, expected === null, query);
        if (!expected) continue;
        for (const line of lines) {
          assert.equal(got.match(line), expected(line), `${JSON.stringify(query)} ${JSON.stringify(line)} cs=${caseSensitive} whole=${whole}`);
          compared += 1;
        }
      }
    }
  }
  assert.ok(compared > 1000);
});

test("Modell: Root / und zwei Projekte gleichzeitig offen", async () => {
  const slash = createModel(await verifyPackage(seal(rootSlashDoc()).bytes, { unbound: true }));
  const host = createModel(await verifyPackage(seal(codeDoc()).bytes, { unbound: true }));
  assert.equal(slash.abs(""), "/");
  assert.equal(slash.abs("project1"), "/project1");
  assert.equal(slash.abs("project1/noise1"), "/project1/noise1");
  assert.equal(slash.relOf("/project1/noise1"), "project1/noise1");
  assert.equal(slash.relOf("/"), "");
  assert.equal(host.abs("engine"), "/project1/Host/engine");
  assert.equal(host.relOf("/project1/noise1"), null);
  assert.equal(slash.op("project1/noise1").path, "/project1/noise1");
  assert.equal(absPath("/", "a"), "/a");
  assert.equal(relPath("/x", "/xy/z"), null, "Praefix ohne Trenner ist kein Kind");
});

test("Modell: Namen constructor/toString/hasOwnProperty/__proto__ ueber Map", async () => {
  const result = await verifyPackage(seal(prototypeNamesDoc()).bytes, { unbound: true });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const model = createModel(result);
  for (const rel of ["constructor", "constructor/toString", "hasOwnProperty", "__proto__", "toString"]) {
    assert.equal(model.op(rel).rel, rel);
  }
  assert.equal(model.op("valueOf"), null);
  assert.equal(model.has("isPrototypeOf"), false);
  assert.deepEqual(model.children("constructor").map((o) => o.rel), ["constructor/toString"]);
  assert.equal(model.parameter("__proto__", "constructor").op, "__proto__");
  assert.deepEqual(model.callees("constructor/toString", "toString.constructor").map((e) => e.target.symbol), ["toString.__proto__"]);
  assert.equal(Object.getPrototypeOf({}).polluted, undefined);
  assert.equal(model.search("__proto__", { kinds: ["name"] }).hits[0].rel, "__proto__");
});

// ================================================================== Notizanker

test("Anker: bleibt, verschoben, Quelle nicht uebertragen, nicht zugeordnet", async () => {
  const before = createModel(await verifyPackage(seal(codeDoc()).bytes, { unbound: true }));
  const anchor = await createAnchor(before, { kind: "range", source: "HostExt", startLine: 23, endLine: 25 });
  assert.equal(anchor.excerpt, HOST_LINES.slice(22, 25).join("\n"));
  assert.equal(anchor.textHash, nodeSha(anchor.excerpt));
  assert.deepEqual(anchor.before, HOST_LINES.slice(19, 22));
  assert.equal(anchor.origPath, "/project1/Host/HostExt");
  assert.equal(validateAnchor(anchor).ok, true);
  assert.equal(await anchorIntact(anchor), true);
  // gleiche Quelle -> bleibt
  assert.equal(resolveAnchor(anchor, before).state, "kept");
  // zwei Zeilen oben eingefuegt -> verschoben, Anker fortgeschrieben
  const shifted = createModel(await verifyPackage(seal(codeDoc({ hostText: `# neu\n# neu\n${HOST_TEXT}` })).bytes, { unbound: true }));
  const moved = resolveAnchor(anchor, shifted);
  assert.equal(moved.state, "moved");
  assert.deepEqual([moved.startLine, moved.endLine], [25, 27]);
  assert.equal(moved.anchor.revisionId, shifted.revisionId);
  assert.equal(moved.anchor.sourceSha256, shifted.source("HostExt").sha256);
  assert.equal(resolveAnchor(moved.anchor, shifted).state, "kept");
  // Quelle als Geheimnis ausgelassen -> Quelle nicht uebertragen
  const omittedDoc = codeDoc();
  omittedDoc.codeSources[0] = { ...omittedDoc.codeSources[0], status: "omitted-secret", text: null, chars: null, lines: null, sha256: null };
  omittedDoc.analysis.code = omittedDoc.analysis.code.filter((e) => e.source !== "HostExt");
  omittedDoc.references = omittedDoc.references.filter((r) => r.from.source !== "HostExt");
  const omitted = createModel(await verifyPackage(seal(omittedDoc).bytes, { unbound: true }));
  assert.equal(resolveAnchor(anchor, omitted).state, "source-not-transferred");
  // Ausschnitt geaendert -> nicht zugeordnet (nie ueber die Zeilennummer)
  const changed = createModel(await verifyPackage(seal(codeDoc({ hostText: HOST_TEXT.replace("self.count += 1", "self.count += 2") })).bytes, { unbound: true }));
  const lost = resolveAnchor(anchor, changed);
  assert.equal(lost.state, "unmatched");
  assert.equal(lost.anchor, anchor, "Notiz bleibt mit altem Anker sichtbar");
  // Op-Anker
  const opAnchor = await createAnchor(before, { kind: "op", op: "target" });
  assert.equal(resolveAnchor(opAnchor, before).state, "kept");
  const noTargetDoc = codeDoc();
  noTargetDoc.operators = noTargetDoc.operators.filter((o) => o.rel !== "target");
  noTargetDoc.connections = noTargetDoc.connections.filter((c) => c.to.op !== "target" && c.from.op !== "target");
  noTargetDoc.parameters = noTargetDoc.parameters.filter((p) => p.op !== "target");
  noTargetDoc.references = noTargetDoc.references.map((r) => (r.target.op === "target" ? { ...r, target: { unresolved: "not-found" } } : r));
  const noTarget = createModel(await verifyPackage(seal(noTargetDoc).bytes, { unbound: true }));
  assert.equal(resolveAnchor(opAnchor, noTarget).state, "unmatched");
});

test("Anker: anderer Root ueber origPath, Mehrdeutigkeit ueber Kontext, Symbol-Anker", async () => {
  const model = createModel(await verifyPackage(seal(codeDoc()).bytes, { unbound: true }));
  const anchor = await createAnchor(model, { kind: "symbol", source: "HostExt", symbol: "Mixer.Mix" });
  assert.deepEqual([anchor.startLine, anchor.endLine, anchor.symbol], [9, 12, "Mixer.Mix"]);
  // gleicher Inhalt, aber Export eine Ebene hoeher: rel "HostExt" -> "Host/HostExt"
  const wider = codeDoc();
  wider.exportRoot = { path: "/project1", opType: "containerCOMP", name: "project1", explicitScopes: [] };
  const shift = (rel) => (rel === "" ? "Host" : `Host/${rel}`);
  wider.operators = [op("", "containerCOMP", "COMP", { name: "project1", children: 1 }), ...wider.operators.map((o) => ({
    ...o, rel: shift(o.rel), parent: o.parent === null ? "" : shift(o.parent),
  }))];
  for (const s of wider.codeSources) {
    s.key = shift(s.key);
    s.op = s.key;
    for (const role of s.roles) if (typeof role.comp === "string") role.comp = shift(role.comp);
  }
  for (const c of wider.connections) for (const end of [c.from, c.to]) if (Object.hasOwn(end, "op")) end.op = shift(end.op);
  for (const p of wider.parameters) p.op = shift(p.op);
  for (const r of wider.references) {
    r.from.op = shift(r.from.op);
    if (r.from.source !== null) r.from.source = shift(r.from.source);
    if (Object.hasOwn(r.target, "op")) r.target.op = shift(r.target.op);
  }
  for (const w of wider.warnings) {
    if (w.op !== null) w.op = shift(w.op);
    if (w.source !== null) w.source = shift(w.source);
  }
  for (const item of wider.analysis.code) item.source = shift(item.source);
  const widerModel = createModel(await verifyPackage(seal(wider).bytes, { unbound: true }));
  const re = resolveAnchor(anchor, widerModel);
  assert.equal(re.state, "moved");
  assert.equal(re.rel, "Host/HostExt");
  assert.equal(re.anchor.origPath, "/project1/Host/HostExt");
  // Mehrdeutig: derselbe Ausschnitt zweimal - Kontext entscheidet; ohne eindeutigen Kontext nicht zugeordnet
  const one = await createAnchor(model, { kind: "range", source: "HostExt", startLine: 6, endLine: 6 });
  assert.equal(one.excerpt, "        self.ownerComp = ownerComp");
  const twice = createModel(await verifyPackage(seal(codeDoc({ hostText: HOST_TEXT.replace("class Mixer:", "class Mixer:\n    pass") })).bytes, { unbound: true }));
  assert.deepEqual([resolveAnchor(one, twice).state, resolveAnchor(one, twice).startLine], ["moved", 7]);
  const blind = { ...one, before: [], after: [] };
  assert.equal(resolveAnchor(blind, twice).state, "unmatched", "zwei Fundstellen ohne Kontext: nie raten");
  await assert.rejects(createAnchor(model, { kind: "range", source: "secrets_dat", startLine: 1, endLine: 1 }), (e) => e.code === "source");
  await assert.rejects(createAnchor(model, { kind: "range", source: "HostExt", startLine: 5, endLine: 99 }), (e) => e.code === "range");
});

// ================================================================== Leistungsbudget (Node, kein iPhone-Schluss)

function bigDoc() {
  const doc = baseDoc({ root: "/project1/Gross", rootName: "Gross", projectName: "Gross" });
  const lines = [];
  let length = 0;
  while (length < 1_700_000) {
    const i = lines.length;
    const head = `def f_${i}(x):  # Zeile ${i} mit etwas Text, damit sie realistisch lang ist`;
    const body = `    return op('t${i % 50}').par.v + x`;
    lines.push(head, body);
    length += head.length + body.length + 2;
  }
  const text = lines.join("\n");
  doc.operators = [op("", "baseCOMP", "COMP", { name: "Gross", children: 51 }), op("big", "textDAT", "DAT")];
  for (let i = 0; i < 50; i += 1) doc.operators.push(op(`t${i}`, "nullTOP", "TOP"));
  doc.codeSources = [source("big", "textDAT", text)];
  doc.references = [];
  for (let i = 0; i < 3000; i += 1) {
    const line = 2 * i + 2;
    doc.references.push({ from: { op: "big", source: "big", line, par: null }, kind: "code-op", text: `op('t${i % 50}')`,
      target: { op: `t${i % 50}` }, certainty: "static", code: { art: "call", receiver: null, name: `t${i % 50}` } });
  }
  return { doc, chars: codepointLength(text) };
}

test("Leistung: 1,7 Mio. Zeichen + 3 000 Verweise in < 2 s geprueft und als Modell geoeffnet", async (t) => {
  const { doc, chars } = bigDoc();
  assert.ok(chars >= 1_700_000);
  const sealed = seal(doc);
  const started = performance.now();
  const result = await verifyPackage(sealed.bytes, bound(sealed, 1));
  const model = createModel(result);
  const ms = performance.now() - started;
  t.diagnostic(`verify+model ${ms.toFixed(0)} ms, ${sealed.bytes.length} Bytes`);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(model.referencesInSource("big").length, 3000);
  assert.ok(ms < 2000, `${ms} ms`);
});

test("Leistung: Netz eines COMP mit 200 Ops < 200 ms, Suche ueber 66 000 Codezeilen < 300 ms", async (t) => {
  const doc = baseDoc({ root: "/project1/Netz", rootName: "Netz", projectName: "Netz" });
  doc.operators = [op("", "baseCOMP", "COMP", { name: "Netz", children: 233 })];
  for (let i = 0; i < 200; i += 1) {
    doc.operators.push(op(`n${i}`, "nullTOP", "TOP", { node: i % 10 === 0 ? { unknown: "not-readable" } : { x: i * 200, y: 0, w: 130, h: 90 } }));
    if (i) doc.connections.push({ kind: "wire", from: { op: `n${i - 1}` }, fromIndex: 0, to: { op: `n${i}` }, toIndex: 0 });
  }
  for (let s = 0; s < 33; s += 1) {
    const lines = Array.from({ length: 2000 }, (_, i) => `    value_${s}_${i} = compute(${i}) + offset  # Zeile`);
    doc.operators.push(op(`code${s}`, "textDAT", "DAT"));
    doc.codeSources.push(source(`code${s}`, "textDAT", lines.join("\n")));
  }
  const verifiedDoc = await verifyPackage(seal(doc).bytes, { unbound: true });
  assert.equal(verifiedDoc.ok, true, JSON.stringify(verifiedDoc.errors));
  const model = createModel(verifiedDoc);
  let started = performance.now();
  const net = model.network("");
  const netMs = performance.now() - started;
  assert.equal(net.known.length + net.unknown.length, 233);
  assert.equal(net.unknown.length, 20);
  started = performance.now();
  const found = model.search("compute");
  const searchMs = performance.now() - started;
  t.diagnostic(`network ${netMs.toFixed(1)} ms, search ${searchMs.toFixed(1)} ms ueber ${model._codeRows.length} Zeilen`);
  assert.equal(model._codeRows.length, 66000);
  assert.equal(found.counts.code, 66000);
  assert.ok(netMs < 200, `${netMs} ms`);
  assert.ok(searchMs < 300, `${searchMs} ms`);
});

// ================================================================== Bauregeln der Module

test("Module: nur benannte Importe/Exporte (Einzeldatei-Buendler), kein DOM, kein localStorage", () => {
  // Dieselben Muster wie tools/build_offline.py:38-40; was danach noch mit import/export beginnt, bricht den Build.
  const importRe = /^import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];[ \t]*$/gm;
  const exportDecl = /^export\s+(async\s+function|function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  const exportList = /^export\s*\{([^}]*)\};?[ \t]*$/gm;
  for (const name of MY_MODULES) {
    const text = readFileSync(new URL(`js/projects/${name}.js`, ROOT), "utf8");
    assert.ok(!text.includes("\r"), `${name}.js: LF`);
    const rest = text.replace(importRe, (m, names, spec) => {
      assert.ok(spec.startsWith("."), `${name}.js: nur relative Importe`);
      return "";
    }).replace(exportDecl, "$1 $2").replace(exportList, "");
    assert.ok(!/^(import|export)\b/m.test(rest), `${name}.js: unbekannte import/export-Form`);
    assert.ok(!/\bimport\s*\(/.test(text), `${name}.js: kein dynamischer Import`);
    assert.ok(!/export\s+default/.test(text), `${name}.js: kein Default-Export`);
    for (const forbidden of [/\bdocument\b/, /\bwindow\b/, /innerHTML/, /localStorage/, /\beval\s*\(/, /new Function/]) {
      assert.ok(!forbidden.test(text.replace(/\/\/.*$/gm, "")), `${name}.js: ${forbidden}`);
    }
    for (const ch of text) assert.ok(ch.codePointAt(0) <= 0xffff, `${name}.js: nur BMP-Zeichen im Quelltext`);
  }
  const pkg = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8"));
  assert.ok(pkg.scripts.test.endsWith("node tools/projects-core-tests.mjs") || pkg.scripts.test.includes("node tools/projects-core-tests.mjs"));
  assert.deepEqual(Object.keys(pkg.devDependencies), ["jsdom"], "keine neue Abhaengigkeit");
});
