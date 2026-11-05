// Ebene PROJEKTE (Paket P2a-1, Vertrag POCKET-PROJECTS-SPEC 11-14): Knopf und Ebene, Liste und Sync-Status, Datei-
// Import, Abgleich gegen eine GitHub-Attrappe, Token-Schutz, Darstellungs-Testvektoren, Zurueck-Navigation und
// unveraenderte Kurs-Ebenen. jsdom + MemoryStore (js/projects/store.js) + Fetch-Attrappe.
//
// js/ui/project-views.js (Paket P2a-2) wird hier per Loader-Hook durch eine Attrappe ersetzt: geprueft wird der Rahmen
// und was er den Ansichten uebergibt; die echten Ansichten prueft tools/projects-views-tests.mjs.
// Belegt NICHT: echte Browser (CSP-Wirkung, IndexedDB, Service Worker, Layout, Touch, Verlauf in iOS-Apps) - das ist
// der Browser-Test (Welle 3). Testdaten sind synthetisch; Tokens sind Kanarienwerte, nie echte.
//
// Aufruf: node tools/projects-ui-tests.mjs
import { register } from "node:module";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { JSDOM, VirtualConsole } from "jsdom";

import { canonicalize, codepointLength, lineCount } from "../js/projects/c14n.js";
import { absPath, sortPackageLists, CONTENT_FIELDS, WARNING_SEVERITY } from "../js/projects/schema.js";
import { verifyPackage } from "../js/projects/verify.js";
import { MemoryStore, StoreError } from "../js/projects/store.js";
import {
  SyncController, SYNC_KEYS, STORE_API, TOKEN_PAGE_URL, checkIndex, checkTokenFormat, importPackageFile, parseStoreFile,
  saveToken, syncOnce, SyncError,
} from "../js/projects/sync.js";
// Namensraum fuer die Helfer der Nachbesserung: fehlt einer, scheitert nur sein Test (nicht die ganze Datei).
import * as syncApi from "../js/projects/sync.js";

const ROOT = new URL("../", import.meta.url);

// ================================================================== Attrappe fuer js/ui/project-views.js

const VIEW_MOCK = `
const calls = (globalThis.__ppViewCalls ??= []);
function make(kind, container, args) {
  const box = container.ownerDocument.createElement("div");
  box.className = "mock-view";
  box.dataset.kind = kind;
  box.textContent = kind;
  container.appendChild(box);
  const entry = { kind, container, ...args, updates: [], destroyed: false };
  calls.push(entry);
  return {
    update(view) { entry.updates.push(view); },
    destroy() { entry.destroyed = true; box.remove(); },
  };
}
export function renderNetwork(container, model, view, actions) { return make("network", container, { model, view, actions }); }
export function renderCode(container, model, view, actions) { return make("code", container, { model, view, actions }); }
export function renderDetails(container, model, rel, actions) { return make("details", container, { model, rel, actions }); }
export function renderUnderstand(container, model, target, actions) { return make("understand", container, { model, target, actions }); }
export function renderNotes(container, notes, model, actions) { return make("notes", container, { model, notes, actions }); }
`;
const HOOKS = `
const MOCK = ${JSON.stringify(`data:text/javascript,${encodeURIComponent(VIEW_MOCK)}`)};
export async function resolve(specifier, context, next) {
  if (specifier === "./project-views.js" && String(context.parentURL || "").endsWith("/js/ui/projects.js")) {
    return { url: MOCK, shortCircuit: true };
  }
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);
const viewCalls = () => globalThis.__ppViewCalls ?? [];
const lastView = (kind) => viewCalls().filter((c) => c.kind === kind).at(-1);

// ================================================================== Paketbauer (Paketform des Python-Exporters)
// Verkleinert aus tools/projects-core-tests.mjs; jedes Paket wird vor Gebrauch mit verifyPackage geprueft.

const sha = (data) => createHash("sha256").update(data).digest("hex");
const PID_A = `psp_${"a1".repeat(16)}`;
const PID_B = `psp_${"b2".repeat(16)}`;
const PID_C = `psp_${"c3".repeat(16)}`;
const PID_D = `psp_${"d4".repeat(16)}`;
const PID_E = `psp_${"e5".repeat(16)}`;
const PID_X = `psp_${"f6".repeat(16)}`;
const PID_F = `psp_${"07".repeat(16)}`;
// Kanarienwerte in Token-Form: duerfen nach dem Speichern nirgends ausser im Store "sync" auftauchen.
const TOKEN = `github_pat_${"Kanarie0".repeat(10)}AB`;
const TOKEN_2 = `github_pat_${"Zweites1".repeat(10)}CD`;

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
    flags: isCOMP ? { bypass: false, lock: false, display: false, render: false, viewer: false, allowCooking: true }
      : { bypass: false, lock: false, display: false, render: false, viewer: false },
    dock: null, children: isCOMP ? 0 : null, connectors: isCOMP ? { in: [], out: [] } : null, extensions: [],
    shortcuts: { parent: null, global: null }, internalShortcuts: [],
    ...extra,
  };
}

function ext(slot, object, name, promote = true) {
  return { slot, object: { value: object }, name: { value: name }, promote: { value: promote } };
}

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
    sha256: sha(Buffer.from(text, "utf8")), duplicateOf: null, file: null,
    ...extra,
  };
}

function baseDoc({ root, rootType = "baseCOMP", rootName, projectName, projectId, exportedAt = "2026-11-05T10:00:00Z" }) {
  return {
    format: "codesearch.pocket.snapshot", schemaVersion: 1, schemaMinor: 0, projectId,
    revision: { id: "", contentHash: "", analysisHash: "", basedOnSeq: 0 },
    projectName, exportedAt,
    source: { tool: "CodeSearch", toolVersion: "1.11.0", exporterVersion: 1, tdBuild: "2025.33230", tdVersion: "099",
      os: "windows", projectFile: "Synthetisch.toe" },
    exportRoot: { path: root, opType: rootType, name: rootName, explicitScopes: [] },
    context: { selection: null, frozenAt: exportedAt, entry: "comp-menu" },
    capture: { startedAt: exportedAt, finishedAt: exportedAt, frames: 10, slices: 2,
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

function countsOf(doc) {
  const sent = doc.codeSources.filter((s) => s.status === "exact" || s.status === "truncated");
  return {
    operators: doc.operators.length, comps: doc.operators.filter((o) => o.isCOMP).length,
    annotations: doc.annotations.length, connections: doc.connections.length, codeSources: doc.codeSources.length,
    codeChars: sent.reduce((sum, s) => sum + (Number.isInteger(s.chars) ? s.chars : 0), 0),
    parameters: doc.parameters.length, references: doc.references.length, external: doc.externalDependencies.length,
    duplicates: doc.codeSources.filter((s) => s.duplicateOf !== null).length,
  };
}

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
  const text = canonicalize(doc);
  return { doc, text, bytes: Buffer.from(text, "utf8") };
}

function warning(code, extra = {}) {
  return { code, severity: WARNING_SEVERITY[code], message: "Vorlagentext", op: null, source: null, count: null, ...extra };
}

// Referenzexport "Weichzeichner" (Vertrag 17), nachgebaut aus dem oeffentlichen Tutorial.
function weichzeichner(projectId, { projectName = "Weichzeichner", label = "me.name" } = {}) {
  const doc = baseDoc({ root: "/project1/CodeSearch_Tutorial/Weichzeichner", rootName: "Weichzeichner", projectName, projectId });
  doc.operators = [
    op("", "baseCOMP", "COMP", { name: "Weichzeichner", node: { x: 2200, y: 3400, w: 200, h: 140 }, children: 3,
      connectors: { in: [{ index: 0, inOP: "in1" }], out: [{ index: 0, outOP: "out1" }] } }),
    op("in1", "inTOP", "TOP", { node: { x: 200, y: 0, w: 130, h: 90 } }),
    op("blur", "blurTOP", "TOP", { node: { x: 600, y: 0, w: 130, h: 90 } }),
    op("out1", "outTOP", "TOP", { node: { x: 1000, y: 0, w: 130, h: 90 } }),
  ];
  doc.connections = [
    { kind: "wire", from: { op: "in1" }, fromIndex: 0, to: { op: "blur" }, toIndex: 0 },
    { kind: "wire", from: { op: "blur" }, fromIndex: 0, to: { op: "out1" }, toIndex: 0 },
    { kind: "wire", from: { external: "/project1/CodeSearch_Tutorial/mix" }, fromIndex: 0, to: { op: "" }, toIndex: 0 },
  ];
  doc.parameters = [
    par("blur", "size", { label: "Size", page: "Blur", style: "Int", mode: "bind", value: { t: "unknown", reason: "mode-bind" },
      storedConstant: { t: "int", v: "7" }, bindExpr: "parent().par.Staerke" }),
    par("in1", "label", { mode: "expression", value: { t: "unknown", reason: "mode-expression" }, expr: label,
      storedConstant: { t: "str", v: "" }, isDefault: true }),
  ];
  doc.references = [{ from: { op: "blur", source: null, line: null, par: "size" }, kind: "par-bind", text: "parent().par.Staerke",
    target: { op: "" }, certainty: "static", code: null }];
  doc.externalDependencies = [{ path: "/project1/CodeSearch_Tutorial/mix", opType: null, kinds: ["wire"], count: 1, included: false }];
  return seal(doc);
}

const HOST_TEXT = [
  '"""Synthetisches Testmodul (keine echte Projektquelle)."""',
  "",
  "class Mixer:",
  "    def __init__(self, ownerComp):",
  "        self.ownerComp = ownerComp",
  "        self.level = 0",
  "",
  "    def Mix(self, value):",
  "        self.level = value",
  "        return self.level",
  "",
  "",
  "def helper(x):",
  "    return op('target')",
  "",
].join("\n");

function facts() {
  return { params: [], returns: [], effects: [], pulls: [], parReads: [], parWrites: [] };
}

function symbol(cls, name, line, end, params = []) {
  return { symbol: cls ? `${cls}.${name}` : `<module>.${name}`, class: cls, name, kind: cls ? "method" : "function", line, end,
    doc: "", decorators: [], params, facts: facts() };
}

// Projekt mit Extension-COMP, zwei Codequellen und Analyse; variant aendert den Inhalt (neue Revision).
function hostProject(projectId, { projectName = "Host", variant = 0, exportedAt = "2026-11-05T10:00:00Z" } = {}) {
  const doc = baseDoc({ root: "/project1/Host", rootName: "Host", projectName, projectId, exportedAt });
  const text = variant ? `${HOST_TEXT}# Stand ${variant}\n` : HOST_TEXT;
  doc.operators = [
    op("", "baseCOMP", "COMP", { name: "Host", children: 4, extensions: [ext(0, "op('./HostExt').module.Mixer(me)", "Mixer")] }),
    op("HostExt", "textDAT", "DAT", { node: { x: 0, y: 200, w: 130, h: 90 } }),
    op("engine", "baseCOMP", "COMP", { node: { x: 400, y: 0, w: 130, h: 90 }, children: 1 }),
    op("engine/noise1", "noiseTOP", "TOP"),
    op("target", "levelTOP", "TOP", { node: { x: 600, y: 0, w: 130, h: 90 } }),
  ];
  doc.connections = [{ kind: "wire", from: { op: "engine" }, fromIndex: 0, to: { op: "target" }, toIndex: 0 }];
  doc.codeSources = [source("HostExt", "textDAT", text, { roles: [{ kind: "extension", comp: "", slot: 0 }] })];
  doc.parameters = [par("target", "opacity", { style: "Float", value: { t: "float", v: "1e-05" } })];
  doc.references = [
    { from: { op: "HostExt", source: "HostExt", line: 14, par: null }, kind: "code-op", text: "op('target')",
      target: { op: "target" }, certainty: "static", code: { art: "call", receiver: null, name: "target" } },
    { from: { op: "", source: null, line: null, par: "ext0object" }, kind: "ext-object", text: "op('./HostExt').module.Mixer(me)",
      target: { op: "HostExt" }, certainty: "captured", code: null },
  ];
  doc.analysis.code = [{ source: "HostExt", entry: {
    classes: [{ name: "Mixer", line: 3, end: 10, states: [{ name: "ownerComp", line: 5 }, { name: "level", line: 6 }] }],
    symbols: [symbol("Mixer", "__init__", 4, 6, ["ownerComp"]), symbol("Mixer", "Mix", 8, 10, ["value"]), symbol(null, "helper", 13, 14, ["x"])],
    sites: [], accesses: [], ast: [],
    stateAtlas: { states: [], calls: [], coverage: [], symbols: [], errors: [], revision: "" },
  } }];
  doc.warnings = [warning("capture.retried")];
  return seal(doc);
}

// Darstellungs-Testvektoren aus Vertrag 14 in allen Paketfeldern, die Pocket zeigt oder durchsucht.
const XSS = {
  img: "<img src=x onerror=alert(1)>",
  svg: '"><svg onload=alert(2)>',
  quote: "' onmouseover='alert(3)",
  js: "javascript:alert(4)",
  rlo: "‮gnp.exe",
  zwsp: "a​b",
  script: "<script>alert(5)</script>",
};
function xssProject() {
  const rootName = XSS.svg;
  const doc = baseDoc({ root: `/project1/${rootName}`, rootType: "containerCOMP", rootName, projectName: XSS.img, projectId: PID_X });
  const longLine = `${"x".repeat(1_000_000)}<img src=x onerror=alert(6)>`;
  const code = `# ${XSS.script}\nvalue = "${XSS.quote}"\nlink = "${XSS.js}"\n${longLine}\n`;
  doc.operators = [
    op("", "containerCOMP", "COMP", { name: rootName, children: 7, comment: XSS.img, tags: [XSS.script] }),
    op(XSS.quote, "nullTOP", "TOP", { comment: XSS.svg, tags: [XSS.js, XSS.img] }),
    op(XSS.js, "nullTOP", "TOP"),
    op(XSS.rlo, "nullTOP", "TOP"),
    op(XSS.zwsp, "nullTOP", "TOP"),
    op("constructor", "baseCOMP", "COMP", { children: 1 }),
    op("constructor/__proto__", "textDAT", "DAT"),
    op("toString", "nullTOP", "TOP", { node: { unknown: "not-readable" } }),
  ];
  doc.annotations = [{ rel: "note1", parent: "", name: "note1", mode: "annotate", title: XSS.img, body: `${XSS.svg}\n${XSS.script}`,
    node: { x: 0, y: -200, w: 600, h: 300 }, color: null, enclosed: [XSS.quote] }];
  doc.codeSources = [source("constructor/__proto__", "textDAT", code)];
  doc.parameters = [
    par(XSS.quote, "Linkpar", { custom: true, label: XSS.svg, style: "Str", value: { t: "str", v: XSS.js }, default: { t: "str", v: "" }, help: XSS.img }),
    par(XSS.js, "label", { mode: "expression", value: { t: "unknown", reason: "mode-expression" }, expr: XSS.img, storedConstant: { t: "str", v: "" } }),
  ];
  doc.references = [{ from: { op: XSS.js, source: null, line: null, par: "label" }, kind: "par-expr", text: XSS.img,
    target: { external: `/ext/${XSS.svg}` }, certainty: "static", code: null }];
  doc.externalDependencies = [{ path: `/ext/${XSS.svg}`, opType: null, kinds: ["par-expr"], count: 1, included: false }];
  // Pocket zeigt den Meldungstext einer Warnung nie (Vertrag 4.15): dieser Text darf nicht im DOM erscheinen.
  doc.warnings = [{ ...warning("value.size"), message: "<img src=x onerror=alert(99)>WARNTEXT", op: XSS.quote, count: 1 }];
  return seal(doc);
}

function headOf(sealed, seq, committedAt = "2026-11-05T11:00:00Z") {
  const { doc, bytes } = sealed;
  return { seq, revisionId: doc.revision.id, committedAt, exportedAt: doc.exportedAt, projectName: doc.projectName,
    bytes: bytes.length, counts: { operators: doc.operators.length, codeSources: doc.codeSources.length }, rootPath: doc.exportRoot.path };
}

// ================================================================== GitHub-Attrappe (Contents-API, nur Lesen)

class FakeGitHub {
  constructor() {
    this.files = new Map();
    this.tokens = new Set([TOKEN]);
    this.blocked = new Set();
    this.requests = [];
    this.gates = new Map();
    this.status = new Map();
    this.fail = new Map();
    this.fetch = (url, init) => this._fetch(url, init);
    this.json("store.json", { format: "codesearch.pocket.store", version: 1 });
    this.index = new Map();
    this.writeIndex();
  }

  json(path, value) {
    this.files.set(path, Buffer.from(JSON.stringify(value), "utf8"));
  }

  writeIndex() {
    const projects = [...this.index.values()].sort((a, b) => (a.projectId < b.projectId ? -1 : 1));
    this.json("projects/index.json", { format: "codesearch.pocket.index", version: 1, projects });
  }

  publish(sealed, seq, { store = true } = {}) {
    const { doc, bytes } = sealed;
    if (store) this.files.set(`projects/${doc.projectId}/revisions/${doc.revision.id}.json`, bytes);
    this.index.set(doc.projectId, { projectId: doc.projectId, status: "active", head: headOf(sealed, seq) });
    this.writeIndex();
  }

  tombstone(projectId) {
    this.index.set(projectId, { projectId, status: "deleted", head: null });
    this.writeIndex();
  }

  drop(projectId) {
    this.index.delete(projectId);
    this.writeIndex();
  }

  // Anfrage auf path haelt an, bis release() - oder bricht ab, wenn das Signal abbricht (wie fetch).
  gate(path) {
    let release;
    const opened = new Promise((resolve) => { release = resolve; });
    const gate = { opened, release, waiting: 0 };
    this.gates.set(path, gate);
    return gate;
  }

  revisionPath(sealed) {
    return `projects/${sealed.doc.projectId}/revisions/${sealed.doc.revision.id}.json`;
  }

  async _fetch(url, init = {}) {
    const u = new URL(url);
    const headers = new Headers(init.headers || {});
    const path = u.pathname.startsWith("/repos/Tombkn/codesearch-pocket-data/contents/")
      ? u.pathname.slice("/repos/Tombkn/codesearch-pocket-data/contents/".length) : null;
    this.requests.push({ origin: u.origin, path, search: u.search, method: init.method || "GET", cache: init.cache,
      credentials: init.credentials, redirect: init.redirect, headerNames: [...headers.keys()].sort(),
      authorization: headers.get("authorization"), ifNoneMatch: headers.get("if-none-match"), accept: headers.get("accept") });
    const abortError = () => new DOMException("Abgebrochen", "AbortError");
    if (init.signal && init.signal.aborted) throw abortError();
    if (u.origin !== "https://api.github.com" || path === null) throw new TypeError("Failed to fetch");
    const failing = this.fail.get(path);
    if (failing && failing.count > 0) {
      failing.count -= 1;
      throw new TypeError("Failed to fetch");
    }
    const gate = this.gates.get(path);
    if (gate) {
      gate.waiting += 1;
      await new Promise((resolve, reject) => {
        gate.opened.then(resolve);
        if (init.signal) init.signal.addEventListener("abort", () => reject(abortError()), { once: true });
      });
    }
    const token = (headers.get("authorization") || "").replace(/^Bearer /, "");
    if (!this.tokens.has(token)) return new Response('{"message":"Bad credentials"}', { status: 401 });
    if (this.blocked.has(token)) return new Response("{}", { status: 403 });
    const forced = this.status.get(path);
    if (forced) return new Response("{}", { status: forced.status, headers: forced.headers || {} });
    const bytes = this.files.get(path);
    if (!bytes) return new Response('{"message":"Not Found"}', { status: 404 });
    const etag = `W/"${sha(bytes).slice(0, 20)}"`;
    if (headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
    return new Response(bytes, { status: 200, headers: { ETag: etag, "Content-Type": "application/vnd.github.raw+json" } });
  }

  fileRequests(path) {
    return this.requests.filter((r) => r.path === path);
  }
}

function syncDeps(store, gh, extra = {}) {
  return { store, fetch: gh.fetch, now: () => Date.parse("2026-11-05T12:00:00Z"), sleep: async () => true, online: () => true,
    retryDelaysMs: [1, 1, 1], ...extra };
}

async function storeWithToken(token = TOKEN) {
  const store = new MemoryStore();
  await saveToken(store, token, Date.parse("2026-11-05T09:00:00Z"));
  return store;
}

const PKG = {};
test("Testpakete sind gueltig (sonst pruefte der Rest nichts)", async () => {
  PKG.a = weichzeichner(PID_A);
  PKG.b1 = hostProject(PID_B);
  PKG.b2 = hostProject(PID_B, { variant: 2 });
  PKG.c = hostProject(PID_C, { projectName: "Langsam" });
  PKG.d1 = hostProject(PID_D, { projectName: "Kaputt" });
  PKG.d2 = hostProject(PID_D, { projectName: "Kaputt", variant: 7 });
  PKG.e = weichzeichner(PID_E, { projectName: "Wird geloescht", label: "me.digits" });
  PKG.x = xssProject();
  PKG.f = hostProject(PID_F, { projectName: "Manipuliert" });
  for (const [name, sealed] of Object.entries(PKG)) {
    const result = await verifyPackage(sealed.bytes, { unbound: true });
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.errors)}`);
  }
  assert.notEqual(PKG.b1.doc.revision.id, PKG.b2.doc.revision.id);
});

// ================================================================== Abgleich (js/projects/sync.js) ohne Oberflaeche

test("Index und Speicherdateien: streng gelesen, Format/Version/Typen/Laengen geprueft", () => {
  const bytes = (value) => Buffer.from(JSON.stringify(value), "utf8");
  const head = headOf(PKG.b1, 1);
  const ok = checkIndex(parseStoreFile(bytes({ format: "codesearch.pocket.index", version: 1, projects: [{ projectId: PID_B, status: "active", head }] })));
  assert.equal(ok.projects[0].head.seq, 1);
  assert.deepEqual(Object.keys(ok.projects[0].head).sort(), Object.keys(head).sort(), "nur bekannte Felder bleiben");
  const bad = (value, code = "index-invalid") => assert.throws(() => checkIndex(parseStoreFile(bytes(value))), (e) => e instanceof SyncError && e.code === code);
  bad({ format: "codesearch.pocket.index", version: 2, projects: [] }, "index-newer");
  bad({ format: "codesearch.pocket.index", version: 1, projects: [{ projectId: PID_B, status: "active", head }, { projectId: PID_B, status: "active", head }] });
  bad({ format: "codesearch.pocket.index", version: 1, projects: [{ projectId: "psp_kurz", status: "active", head }] });
  bad({ format: "codesearch.pocket.index", version: 1, projects: [{ projectId: PID_B, status: "weg", head }] });
  bad({ format: "codesearch.pocket.index", version: 1, projects: [{ projectId: PID_B, status: "active", head: { ...head, seq: 0 } }] });
  bad({ format: "codesearch.pocket.index", version: 1, projects: [{ projectId: PID_B, status: "active", head: { ...head, projectName: "x".repeat(121) } }] });
  bad({ format: "codesearch.pocket.index", version: 1, projects: [{ projectId: PID_B, status: "active", head: { ...head, committedAt: "2026-02-30T00:00:00Z" } }] });
  bad({ format: "codesearch.pocket.index", version: 1, projects: [{ projectId: PID_B, status: "active" }] });
  bad({ format: "anders", version: 1, projects: [] });
  const raw = (text) => assert.throws(() => parseStoreFile(Buffer.from(text, "utf8")), SyncError);
  raw('﻿{"format":"codesearch.pocket.index","version":1,"projects":[]}');
  raw('{"format":"codesearch.pocket.index","version":1,"version":1,"projects":[]}');
  raw('{"format":"codesearch.pocket.index","version":1.0,"projects":[]}');
  raw('{"__proto__":{},"format":"codesearch.pocket.index","version":1,"projects":[]}');
  assert.throws(() => parseStoreFile(Uint8Array.from([0x7b, 0xc3, 0x28, 0x7d])), SyncError, "ungueltiges UTF-8");
  assert.ok(checkIndex(parseStoreFile(Buffer.from('{ "projects" : [ ], "version" : 1, "format" : "codesearch.pocket.index" }\n'))),
    "Leerraum und Reihenfolge sind frei (wie der Python-Transport)");
});

test("Abgleich laedt neuen Kopf, prueft mit Bindung und aktiviert; Anfragen nur mit erlaubten Headern", async () => {
  const gh = new FakeGitHub();
  gh.publish(PKG.b1, 1);
  const store = await storeWithToken();
  const result = await syncOnce(syncDeps(store, gh));
  assert.equal(result.state, "ok");
  assert.equal(result.projects.get(PID_B).state, "activated");
  const project = await store.getProject(PID_B);
  assert.equal(project.activeRevision, PKG.b1.doc.revision.id);
  assert.equal(project.activeSeq, 1);
  assert.equal(project.serverStatus, "active");
  for (const r of gh.requests) {
    assert.equal(r.origin, "https://api.github.com");
    assert.equal(r.method, "GET");
    assert.equal(r.cache, "no-store");
    assert.equal(r.credentials, "omit");
    assert.equal(r.redirect, "error");
    assert.equal(r.search, "", "nie ein Token oder Wert in der Query");
    assert.equal(r.accept, "application/vnd.github.raw+json");
    assert.equal(r.authorization, `Bearer ${TOKEN}`);
    for (const name of r.headerNames) assert.ok(["accept", "authorization", "if-none-match"].includes(name), name);
  }
  assert.deepEqual(gh.requests.map((r) => r.path), ["projects/index.json", gh.revisionPath(PKG.b1)]);
  assert.equal(gh.requests[0].ifNoneMatch, null, "ohne gemerkten Index kein If-None-Match");
});

test("304: Index unveraendert - kein Paket-Download, nichts geaendert", async () => {
  const gh = new FakeGitHub();
  gh.publish(PKG.b1, 1);
  const store = await storeWithToken();
  await syncOnce(syncDeps(store, gh));
  const before = gh.requests.length;
  const result = await syncOnce(syncDeps(store, gh));
  assert.equal(result.state, "not-modified");
  const later = gh.requests.slice(before);
  assert.deepEqual(later.map((r) => r.path), ["projects/index.json"]);
  assert.match(later[0].ifNoneMatch, /^W\/"/, "ETag unveraendert zurueckgeschickt");
  assert.equal((await store.getProject(PID_B)).activeSeq, 1);
});

test("Neuer Kopf (groessere seq) wird aktiviert, kleinere seq nur gemeldet (Warnung, keine Aktivierung)", async () => {
  const gh = new FakeGitHub();
  gh.publish(PKG.b1, 1);
  const store = await storeWithToken();
  await syncOnce(syncDeps(store, gh));
  gh.publish(PKG.b2, 2);
  const newer = await syncOnce(syncDeps(store, gh));
  assert.equal(newer.projects.get(PID_B).state, "activated");
  let project = await store.getProject(PID_B);
  assert.equal(project.activeRevision, PKG.b2.doc.revision.id);
  assert.equal(project.previousRevision, PKG.b1.doc.revision.id);
  gh.publish(PKG.b1, 1);
  const requestsBefore = gh.requests.length;
  const older = await syncOnce(syncDeps(store, gh));
  assert.equal(older.projects.get(PID_B).state, "older");
  assert.deepEqual(gh.requests.slice(requestsBefore).map((r) => r.path), ["projects/index.json"], "nur Koepfe mit groesserer seq werden geladen");
  project = await store.getProject(PID_B);
  assert.equal(project.activeRevision, PKG.b2.doc.revision.id, "neuere bleibt aktiv");
  assert.equal(project.activeSeq, 2);
});

test("Vertauschte Downloads: die aeltere Revision kommt zuletzt an - die neuere bleibt aktiv", async () => {
  const gh = new FakeGitHub();
  gh.publish(PKG.b1, 1);
  const store = await storeWithToken();
  const gate = gh.gate(gh.revisionPath(PKG.b1));
  const slow = syncOnce(syncDeps(store, gh));
  while (gate.waiting === 0) await delay(2);
  const newer = await verifyPackage(PKG.b2.bytes, { index: { projectId: PID_B, revisionId: PKG.b2.doc.revision.id, seq: 2 } });
  assert.equal((await store.activate(newer, { head: headOf(PKG.b2, 2) })).status, "activated");
  gate.release();
  const result = await slow;
  assert.equal(result.projects.get(PID_B).state, "older");
  assert.equal((await store.getProject(PID_B)).activeRevision, PKG.b2.doc.revision.id);
});

test("401: Zugang abgelaufen/widerrufen - Abgleich stoppt, lokale Daten bleiben", async () => {
  const gh = new FakeGitHub();
  gh.publish(PKG.b1, 1);
  const store = await storeWithToken();
  await syncOnce(syncDeps(store, gh));
  gh.tokens.delete(TOKEN);
  gh.publish(PKG.b2, 2);
  const before = gh.requests.length;
  const result = await syncOnce(syncDeps(store, gh));
  assert.equal(result.state, "auth");
  assert.deepEqual(gh.requests.slice(before).map((r) => r.path), ["projects/index.json"], "keine Wiederholung, kein Paket");
  assert.equal((await store.getProject(PID_B)).activeRevision, PKG.b1.doc.revision.id);
  gh.tokens.add(TOKEN);
  gh.blocked.add(TOKEN);
  // retryAuth = manueller Lauf: nach "auth" fragen nur noch ausdrueckliche Laeufe (siehe Test zum Halt unten).
  const manual = { retryAuth: true };
  const held = gh.requests.length;
  assert.equal((await syncOnce(syncDeps(store, gh))).state, "auth", "automatisch: angehalten");
  assert.equal(gh.requests.length, held, "angehalten heisst: keine Anfrage");
  assert.equal((await syncOnce(syncDeps(store, gh), manual)).state, "auth", "403 ohne Limit = kein Recht");
  gh.blocked.delete(TOKEN);
  gh.status.set("projects/index.json", { status: 403, headers: { "x-ratelimit-remaining": "0" } });
  assert.equal((await syncOnce(syncDeps(store, gh), manual)).state, "rate-limit", "403 bei leerem Kontingent ist ein Limit");
});

// Befund kern-f4 (low): GitHub antwortet beim Sekundaerlimit mit 403 (oder 429), oft mit retry-after und Rest-Kontingent.
// Vorher hielt Pocket das gueltige Token an ("Zugang abgelaufen") und fragte automatisch nie wieder. Wie der
// Python-Transport (cs_pocket_transport._status_stop): 403 mit retry-after ist ein Limit.
test("403 mit retry-after (Sekundaerlimit): Limit statt 'Zugang abgelaufen', kein Halt, der naechste Lauf fragt wieder", async () => {
  const gh = new FakeGitHub();
  gh.publish(PKG.b1, 1);
  const store = await storeWithToken();
  gh.status.set("projects/index.json", { status: 403, headers: { "retry-after": "60", "x-ratelimit-remaining": "4999" } });
  assert.equal((await syncOnce(syncDeps(store, gh))).state, "rate-limit");
  assert.equal((await syncApi.readTokenInfo(store)).authFailedAt, null, "gueltiges Token wird nicht angehalten");
  gh.status.delete("projects/index.json");
  const before = gh.requests.length;
  assert.equal((await syncOnce(syncDeps(store, gh))).state, "ok", "automatischer Folgelauf fragt wieder");
  assert.ok(gh.requests.length > before);
  gh.publish(PKG.b2, 2);
  gh.status.set(gh.revisionPath(PKG.b2), { status: 403, headers: { "retry-after": "60" } });
  assert.equal((await syncOnce(syncDeps(store, gh))).state, "rate-limit", "auch beim Paket-Download");
  assert.equal((await syncApi.readTokenInfo(store)).authFailedAt, null);
  // Gegenproben: 429 bleibt Limit, 403 ohne Limit-Kopf bleibt "kein Recht".
  gh.status.set("projects/index.json", { status: 429, headers: { "retry-after": "1" } });
  assert.equal((await syncOnce(syncDeps(store, gh))).state, "rate-limit");
  gh.status.set("projects/index.json", { status: 403 });
  assert.equal((await syncOnce(syncDeps(store, gh))).state, "auth");
  assert.notEqual((await syncApi.readTokenInfo(store)).authFailedAt, null);
});

test("404 auf index.json: kein Zugriff oder Repo fehlt", async () => {
  const gh = new FakeGitHub();
  gh.files.delete("projects/index.json");
  const store = await storeWithToken();
  const result = await syncOnce(syncDeps(store, gh));
  assert.equal(result.state, "not-found");
  assert.equal(gh.requests.length, 1);
});

test("Grabstein und fehlendes Projekt: lokale Kopie wird markiert, nie still geloescht; Grabstein bleibt endgueltig", async () => {
  const gh = new FakeGitHub();
  gh.publish(PKG.b1, 1);
  gh.publish(PKG.c, 1);
  const store = await storeWithToken();
  await syncOnce(syncDeps(store, gh));
  const imported = await importPackageFile({ store }, new File([PKG.a.bytes], "a.json"));
  assert.equal(imported.ok, true);
  gh.tombstone(PID_B);
  gh.drop(PID_C);
  const result = await syncOnce(syncDeps(store, gh));
  assert.equal(result.projects.get(PID_B).state, "deleted");
  assert.equal(result.projects.get(PID_C).state, "missing");
  assert.equal(result.projects.get(PID_A).state, "local-only", "nur importiert: nichts zu markieren");
  const b = await store.getProject(PID_B);
  assert.equal(b.serverStatus, "deleted");
  assert.equal(b.activeRevision, PKG.b1.doc.revision.id, "Kopie bleibt");
  assert.equal((await store.getProject(PID_C)).serverStatus, "missing");
  assert.equal((await store.getProject(PID_A)).serverStatus, null);
  gh.publish(PKG.b2, 2);
  const before = gh.requests.length;
  const again = await syncOnce(syncDeps(store, gh));
  assert.equal(again.projects.get(PID_B).state, "deleted");
  assert.equal(gh.requests.slice(before).filter((r) => r.path === gh.revisionPath(PKG.b2)).length, 0, "nach Grabstein kein Download");
});

test("Loeschen waehrend des Abgleichs: Projekt bleibt geloescht (auch beim naechsten Lauf)", async () => {
  const gh = new FakeGitHub();
  gh.publish(PKG.e, 1);
  const store = await storeWithToken();
  const gate = gh.gate(gh.revisionPath(PKG.e));
  const running = syncOnce(syncDeps(store, gh));
  while (gate.waiting === 0) await delay(2);
  await store.removeLocal(PID_E);
  gate.release();
  const result = await running;
  assert.ok(["aborted", "removed"].includes(result.projects.get(PID_E).state), result.projects.get(PID_E).state);
  assert.equal(await store.getProject(PID_E), null);
  assert.equal(await store.isLocallyRemoved(PID_E), true);
  const before = gh.requests.length;
  const next = await syncOnce(syncDeps(store, gh));
  assert.equal(next.projects.get(PID_E).state, "removed");
  assert.equal(await store.getProject(PID_E), null, "lokal entfernt: nicht automatisch laden");
  assert.equal(gh.requests.slice(before).filter((r) => r.path !== "projects/index.json").length, 0);
});

// Befund P2a-1 (medium): lokal Loeschen war eine Sackgasse. Vertrag 13 verbietet nur das AUTOMATISCHE Laden.
test("Lokal entfernt: nie automatisch, aber ausdruecklich wieder ladbar - auch nach Ab- und neu Anmelden", async () => {
  const gh = new FakeGitHub();
  gh.publish(PKG.e, 1);
  gh.publish(PKG.c, 1);
  const store = await storeWithToken();
  await syncOnce(syncDeps(store, gh));
  await store.removeLocal(PID_E);
  await store.removeLocal(PID_C);
  gh.tombstone(PID_C);
  await syncApi.removeToken(store);
  await saveToken(store, TOKEN);
  const result = await syncOnce(syncDeps(store, gh), { force: true, forceProjects: new Set([PID_E]) });
  assert.equal(result.projects.get(PID_E).state, "removed", "auch erzwungen: kein automatisches Laden");
  assert.equal(await store.getProject(PID_E), null);
  const rows = await syncApi.listLocallyRemoved(store);
  assert.deepEqual(rows.map((r) => [r.projectId, r.head.projectName, r.head.seq]), [[PID_E, "Wird geloescht", 1]],
    "Index-Kopf bleibt sichtbar; ein Grabstein (C) bietet nichts zum Laden an");
  assert.equal(await store.getProject(PID_E), null, "die Liste legt keinen Datensatz an");
  await store.clearLocalRemoval(PID_E);
  const again = await syncOnce(syncDeps(store, gh), { forceProjects: new Set([PID_E]) });
  assert.equal(again.projects.get(PID_E).state, "activated");
  assert.equal((await store.getProject(PID_E)).activeRevision, PKG.e.doc.revision.id);
  assert.deepEqual(await syncApi.listLocallyRemoved(store), []);
});

// Befund kern-f1 (Schlusspruefung 1.11.0, medium): Tab 1 gleicht ab, Tab 2 meldet sich ab und loescht die lokalen
// Projekte (wie ProjectsShell._logout: removeToken, dann clearProjects). Zwei MemoryStore auf denselben Daten = zwei
// Fenster auf einer IndexedDB. Vorher legte Tab 1 die spaeteren Index-Projekte mit dem Token im Arbeitsspeicher wieder
// an (Abmelden waehrend index.json: alle drei). Jetzt endet der Lauf, nichts entsteht neu, keine weitere Anfrage.
test("Abmelden + lokale Projekte loeschen in einem zweiten Tab waehrend eines Abgleichs: nichts wird wieder angelegt", async () => {
  for (const moment of ["index", "erster Download"]) {
    const gh = new FakeGitHub();
    for (const sealed of [PKG.a, PKG.b1, PKG.c]) gh.publish(sealed, 1);
    const tab1 = await storeWithToken();
    const tab2 = new MemoryStore();
    tab2._data = tab1._data;
    const gate = gh.gate(moment === "index" ? "projects/index.json" : gh.revisionPath(PKG.a));
    const running = syncOnce(syncDeps(tab1, gh));
    while (gate.waiting === 0) await delay(2);
    await syncApi.removeToken(tab2);
    const cleared = await tab2.clearProjects({ keepNotes: true });
    assert.equal(cleared.epoch, 1);
    const asked = gh.requests.length;
    gate.release();
    const result = await running;
    assert.equal(result.state, "aborted", `${moment}: ${JSON.stringify([...result.projects])}`);
    assert.deepEqual(await tab1.listProjects(), [], `${moment}: kein Projekt wieder angelegt`);
    assert.equal(tab1._data.get("packages").size, 0, `${moment}: kein Paket`);
    assert.equal(tab1._data.get("uistate").size, 0, `${moment}: kein Fehlervermerk`);
    assert.equal(await tab2.getSyncValue(SYNC_KEYS.index), null, `${moment}: gemerkter Index bleibt geloescht`);
    assert.equal(await tab2.getSyncValue(SYNC_KEYS.token), null);
    assert.equal(gh.requests.length, asked, `${moment}: nach dem Abmelden keine weitere Anfrage`);
  }
});

// Befund P2a-1 (medium): Konflikt nach Datei-Import hatte keinen Weg zurueck zum Speicherstand.
test("Konflikt nach Datei-Import: Speicherstand nur auf ausdrueckliche Wahl; Import bleibt vorherige Revision", async () => {
  const gh = new FakeGitHub();
  gh.publish(PKG.b1, 1);
  const store = await storeWithToken();
  await syncOnce(syncDeps(store, gh));
  const imported = await importPackageFile({ store }, new File([PKG.b2.bytes], "b2.json"));
  assert.equal(imported.status, "activated");
  assert.equal(imported.seq, 1, "andere Revision eines Serverprojekts bekommt die aktive seq");
  let result = await syncOnce(syncDeps(store, gh), { force: true, forceProjects: new Set([PID_B]) });
  assert.equal(result.projects.get(PID_B).state, "conflict", "erzwingen allein loest einen Konflikt nie still auf");
  assert.equal((await store.getProject(PID_B)).activeRevision, PKG.b2.doc.revision.id);
  result = await syncOnce(syncDeps(store, gh), { adoptProjects: new Set([PID_B]) });
  assert.equal(result.projects.get(PID_B).state, "activated");
  let project = await store.getProject(PID_B);
  assert.equal(project.activeRevision, PKG.b1.doc.revision.id, "Speicherstand ist aktiv");
  assert.equal(project.previousRevision, PKG.b2.doc.revision.id, "Import bleibt als vorherige Revision");
  assert.equal(project.activeHead.committedAt, "2026-11-05T11:00:00Z");
  assert.equal((await syncOnce(syncDeps(store, gh))).projects.get(PID_B).state, "current");
  // Aelterer Stand (kleinere seq): ebenfalls nur auf ausdrueckliche Wahl.
  gh.publish(PKG.b2, 2);
  await syncOnce(syncDeps(store, gh));
  gh.publish(PKG.b1, 1);
  assert.equal((await syncOnce(syncDeps(store, gh), { force: true })).projects.get(PID_B).state, "older");
  assert.equal((await store.getProject(PID_B)).activeSeq, 2);
  result = await syncOnce(syncDeps(store, gh), { adoptProjects: new Set([PID_B]) });
  assert.equal(result.projects.get(PID_B).state, "activated");
  project = await store.getProject(PID_B);
  assert.deepEqual([project.activeRevision, project.activeSeq], [PKG.b1.doc.revision.id, 1]);
});

// Befund P2a-1 (low): nach 401/403 fragten automatische Ausloeser weiter mit dem widerrufenen Token.
test("401/403: automatische Ausloeser fragen nicht weiter, bis neu gespeichert, geprueft oder manuell ⟳", async () => {
  const gh = new FakeGitHub();
  gh.publish(PKG.b1, 1);
  const store = await storeWithToken();
  const controller = new SyncController(syncDeps(store, gh), { debounceMs: 0, minIntervalMs: 0 });
  assert.equal((await controller.request("start")).state, "ok");
  gh.tokens.delete(TOKEN);
  const before = gh.requests.length;
  assert.equal((await controller.request("visible")).state, "auth");
  for (const trigger of ["online", "visible", "start"]) {
    const held = await controller.request(trigger);
    assert.equal(held.state, "auth", `${trigger}: Zustand bleibt sichtbar`);
  }
  assert.equal(gh.requests.length - before, 1, "nur EINE Anfrage mit dem widerrufenen Token");
  assert.match(String((await syncApi.readTokenInfo(store)).authFailedAt), /^2026-11-05T12:00:00Z$/);
  gh.tokens.add(TOKEN);
  assert.equal((await controller.request("manual")).state, "not-modified", "manuell wird erneut gefragt");
  assert.equal((await syncApi.readTokenInfo(store)).authFailedAt, null, "Erfolg hebt den Halt auf");
  gh.tokens.delete(TOKEN);
  assert.equal((await controller.request("manual")).state, "auth");
  await saveToken(store, TOKEN);
  assert.equal((await syncApi.readTokenInfo(store)).authFailedAt, null, "neu gespeichertes Token startet ohne Halt");
  gh.tokens.delete(TOKEN);
  await controller.request("manual");
  gh.tokens.add(TOKEN);
  await syncApi.clearAuthHold(store);
  const after = gh.requests.length;
  assert.notEqual((await controller.request("visible")).state, "auth", "nach erfolgreichem 'Zugang pruefen' wieder automatisch");
  assert.equal(gh.requests.length - after, 1);
});

// Befund P2a-1 (low): gleiche Revision auf dem Speicher -> nicht dauerhaft "lokal importiert".
test("Importierte Revision erscheint auf dem Speicher (gleiche seq): Status folgt dem Speicher-Kopf", async () => {
  const gh = new FakeGitHub();
  const store = await storeWithToken();
  assert.equal((await importPackageFile({ store }, new File([PKG.a.bytes], "a.json"))).seq, 1);
  gh.publish(PKG.a, 1);
  assert.equal((await syncOnce(syncDeps(store, gh))).projects.get(PID_A).state, "current");
  const record = await store.getProject(PID_A);
  assert.equal(record.activeHead.committedAt, null, "store.js behaelt den Import-Kopf (gleiche Revision, kein Download)");
  assert.deepEqual([record.indexHead.revisionId, record.indexHead.seq, record.serverStatus], [PKG.a.doc.revision.id, 1, "active"]);
  // projectStatus pruefen erst die Reinen Helfer (projects.js braucht das jsdom-Dokument): Datensatz merken.
  importedOnServer = record;
});
let importedOnServer = null;

test("Wiederholungen: hoechstens 3, mit Abstand; danach Fehlerzustand", async () => {
  const gh = new FakeGitHub();
  gh.publish(PKG.b1, 1);
  const store = await storeWithToken();
  const sleeps = [];
  const deps = syncDeps(store, gh, { sleep: async (ms) => { sleeps.push(ms); return true; }, retryDelaysMs: [10, 20, 30] });
  gh.fail.set("projects/index.json", { count: 2 });
  assert.equal((await syncOnce(deps)).state, "ok");
  assert.deepEqual(sleeps, [10, 20]);
  sleeps.length = 0;
  gh.fail.set("projects/index.json", { count: 99 });
  const before = gh.requests.length;
  assert.equal((await syncOnce(deps)).state, "network");
  assert.deepEqual(sleeps, [10, 20, 30]);
  assert.equal(gh.requests.length - before, 4, "1 Versuch + 3 Wiederholungen");
});

test("Kopf auf nicht gespeicherte Revision und kaputtes Paket: alte Revision bleibt; dauerhaft kaputt nur manuell neu", async () => {
  const gh = new FakeGitHub();
  gh.publish(PKG.d1, 1);
  const store = await storeWithToken();
  await syncOnce(syncDeps(store, gh));
  gh.publish(PKG.d2, 2, { store: false });
  let result = await syncOnce(syncDeps(store, gh));
  assert.equal(result.projects.get(PID_D).state, "failed");
  assert.equal(result.projects.get(PID_D).code, "revision-missing");
  assert.equal((await store.getProject(PID_D)).activeRevision, PKG.d1.doc.revision.id);
  // Gleiche Laenge, weiter kanonisches JSON - nur der Integritaets-Hash passt nicht mehr.
  const broken = Buffer.from(PKG.d2.text.replace('"projectName":"Kaputt"', '"projectName":"Kaputx"'), "utf8");
  assert.notDeepEqual(broken, PKG.d2.bytes);
  gh.files.set(gh.revisionPath(PKG.d2), broken);
  let before = gh.requests.length;
  result = await syncOnce(syncDeps(store, gh));
  assert.equal(result.projects.get(PID_D).skipped, true, "dauerhafter Fehler derselben Revision: automatisch nicht erneut");
  assert.equal(gh.requests.slice(before).filter((r) => r.path === gh.revisionPath(PKG.d2)).length, 0);
  result = await syncOnce(syncDeps(store, gh), { forceProjects: new Set([PID_D]) });
  assert.equal(result.projects.get(PID_D).code, "package-invalid", "manuell erneut: jetzt liegt ein kaputtes Paket da");
  assert.equal(result.projects.get(PID_D).category, "integrity");
  before = gh.requests.length;
  result = await syncOnce(syncDeps(store, gh));
  assert.equal(result.projects.get(PID_D).skipped, true, "automatisch nicht noch einmal 16 MiB laden");
  assert.equal(gh.requests.slice(before).filter((r) => r.path === gh.revisionPath(PKG.d2)).length, 0);
  result = await syncOnce(syncDeps(store, gh), { forceProjects: new Set([PID_D]) });
  assert.equal(gh.requests.slice(before).filter((r) => r.path === gh.revisionPath(PKG.d2)).length, 1, "manuell erneut");
  assert.equal((await store.getProject(PID_D)).activeRevision, PKG.d1.doc.revision.id);
});

test("Steuerung: entprellt, ein Lauf zur Zeit, genau ein Nachlauf, Abbruch; ohne Netz kein Versuch", async () => {
  const gh = new FakeGitHub();
  gh.publish(PKG.b1, 1);
  const store = await storeWithToken();
  const timers = [];
  const controller = new SyncController(syncDeps(store, gh), {
    debounceMs: 50, minIntervalMs: 0,
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (t) => { t.cleared = true; },
  });
  const p1 = controller.request("visible");
  const p2 = controller.request("online");
  const p3 = controller.request("visible");
  assert.equal(timers.filter((t) => !t.cleared).length, 1, "nur ein wartender Timer");
  assert.equal(controller.runs, 0);
  timers.filter((t) => !t.cleared)[0].fn();
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  assert.equal(controller.runs, 1);
  assert.equal(r1.state, "ok");
  assert.equal(r2, r1);
  assert.equal(r3, r1);
  const gate = gh.gate("projects/index.json");
  const run = controller.request("manual");
  const followA = controller.request("manual");
  const followB = controller.request("visible");
  assert.equal(followA, followB, "ein gemeinsamer Nachlauf");
  gate.release();
  gh.gates.clear();
  await run;
  await followA;
  assert.equal(controller.runs, 3, "Lauf + genau ein Nachlauf");
  const offline = new SyncController(syncDeps(store, gh, { online: () => false }), { debounceMs: 0, minIntervalMs: 0 });
  const before = gh.requests.length;
  assert.equal((await offline.request("manual")).state, "offline");
  assert.equal(gh.requests.length, before);
  const gate2 = gh.gate("projects/index.json");
  const aborted = controller.request("manual");
  while (gate2.waiting === 0) await delay(2);
  controller.cancel();
  assert.equal((await aborted).state, "aborted");
  gh.gates.clear();
});

test("Token: Format geprueft, nur im Store sync; Import ohne Token moeglich", async () => {
  assert.equal(checkTokenFormat("  ghp_123  ").ok, false);
  assert.equal(checkTokenFormat(`${TOKEN}\n`).ok, true, "Zeilenumbruch vom Einfuegen wird entfernt");
  assert.equal(checkTokenFormat(`${TOKEN} x`).ok, false, "Leerzeichen im Token = kein Header-Wert");
  const store = new MemoryStore();
  await saveToken(store, TOKEN);
  assert.equal((await store.getSyncValue(SYNC_KEYS.token)).token, TOKEN);
  assert.equal(await store.getUiState(SYNC_KEYS.token), null);
  const empty = new MemoryStore();
  const result = await syncOnce(syncDeps(empty, new FakeGitHub()));
  assert.equal(result.state, "no-token");
  const imported = await importPackageFile({ store: empty }, new File([PKG.a.bytes], "a.json"));
  assert.equal(imported.ok, true);
  const project = await empty.getProject(PID_A);
  assert.equal(project.activeHead.committedAt, null, "lokal importiert: kein Speicher-Zeitpunkt");
  await empty.removeLocal(PID_A);
  const again = await importPackageFile({ store: empty }, new File([PKG.a.bytes], "a.json"));
  assert.equal(again.status, "activated", "ausdruecklicher Import hebt 'lokal entfernt' auf");
  assert.equal((await empty.getProject(PID_A)).activeRevision, PKG.a.doc.revision.id);
  assert.equal(await empty.isLocallyRemoved(PID_A), false);
  const bom = await importPackageFile({ store: empty }, new File([Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), PKG.b1.bytes])], "b.json"));
  assert.equal(bom.ok, false);
  assert.equal(bom.errors[0].code, "encoding.bom");
  assert.equal(await empty.getProject(PID_B), null, "abgelehntes Paket aendert nichts");
});

// ================================================================== Oberflaeche: echte App in jsdom

const indexHtml = readFileSync(new URL("index.html", ROOT), "utf8");
const page = new JSDOM(indexHtml, { url: "https://pocket.test/", pretendToBeVisual: true });
const { window } = page;
const reloads = [];
// Plain-Objekt statt jsdom-Location: so bleibt location.reload() (Fortschritt laden) messbar statt "nicht implementiert".
const fakeLocation = { protocol: "https:", href: "https://pocket.test/", origin: "https://pocket.test", reload: () => reloads.push(1) };
for (const [name, value] of [["window", window], ["document", window.document], ["navigator", window.navigator], ["location", fakeLocation]]) {
  Object.defineProperty(globalThis, name, { configurable: true, value });
}
window.__POCKET_DATA__ = Object.fromEntries(["course.json", "net.json", "code.json", "ui.json", "features.json"]
  .map((name) => [name, JSON.parse(readFileSync(new URL(`data/${name}`, ROOT), "utf8"))]));
window.localStorage.setItem("codesearch-pocket-intro", "1");
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.requestAnimationFrame = globalThis.requestAnimationFrame;
window.cancelAnimationFrame = clearTimeout;
window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
const nativeInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => { const handle = nativeInterval(...args); handle.unref(); return handle; };
const copied = [];
Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { copied.push(String(text)); } } });
const runtimeErrors = [];
window.addEventListener("error", (event) => runtimeErrors.push(event.message));

const gh = new FakeGitHub();
const uiStore = new MemoryStore();
let createStoreCalls = 0;
const { platform, ProjectsShell, projectsAvailability, projectStatus, cleanEntry, contextText } = await import("../js/ui/projects.js");
platform.createStore = () => { createStoreCalls += 1; return uiStore; };
platform.fetch = gh.fetch;
platform.sleep = async () => true;
platform.retryDelaysMs = [1, 1, 1];
platform.debounceMs = 0;
platform.minIntervalMs = 0;
await import("../js/app.js");
await delay(60);

const $ = (selector) => {
  const el = window.document.querySelector(selector);
  assert.ok(el, `Element fehlt: ${selector}`);
  return el;
};
const layer = () => $("#layer-projects");
const click = async (target, wait = 30) => {
  (typeof target === "string" ? $(target) : target).click();
  await delay(wait);
};
const key = async (name, target = window.document.activeElement || window.document.body) => {
  target.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  await delay(30);
};
async function waitFor(condition, label, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (condition()) return;
    await delay(10);
  }
  assert.fail(`Zeitlimit: ${label}`);
}
const pp = (action, extra = "") => [...layer().querySelectorAll(`[data-pp="${action}"]${extra}`)];
const cardOf = (name) => [...layer().querySelectorAll(".pp-card")].find((c) => c.querySelector(".pp-card-title").textContent === name);
async function importFile(bytes, name = "paket.json", input = "#pp-import") {
  const el = $(input);
  Object.defineProperty(el, "files", { configurable: true, value: [new window.File([bytes], name, { type: "application/json" })] });
  el.dispatchEvent(new window.Event("change", { bubbles: true }));
  await waitFor(() => !/Prüfe/.test($("#pp-import-result").textContent) && $("#pp-import-result").textContent, "Import fertig");
  await delay(30);
}
function courseSnapshot() {
  return {
    layers: ["#layer-td", "#layer-course", "#layer-atlas", "#layer-flowlens", "#layer-offline"].map((id) => $(id).className),
    tour: $("#tour").className,
    head: $("#tour-head").textContent,
    progress: window.localStorage.getItem("codesearch-pocket-v2"),
    csTitle: $("#cs-title").textContent,
  };
}
const forbiddenIn = (root) => {
  const bad = [];
  for (const el of root.querySelectorAll("*")) {
    if (["IMG", "SVG", "SCRIPT", "IFRAME", "OBJECT", "EMBED"].includes(el.tagName.toUpperCase()) && !el.closest(".mock-view")) bad.push(el.tagName);
    for (const name of el.getAttributeNames()) {
      if (/^on/i.test(name)) bad.push(`${el.tagName}[${name}]`);
      if ((name === "href" || name === "src") && /javascript:/i.test(el.getAttribute(name))) bad.push(`${el.tagName}[${name}]`);
      if (name === "style" && !/^--pp-depth: \d+;?$/.test(el.getAttribute("style").trim())) bad.push(`${el.tagName}[style]`);
    }
  }
  return bad;
};

let courseBefore;
test("Index-Seite: Knopf PROJEKTE zwischen KURS und ATLAS, Ebene als Dialog, CSP aktiv (Vertrag 14, Browser-Test 3b)", () => {
  const btn = $("#btn-projects");
  assert.equal(btn.previousElementSibling.id, "btn-course");
  assert.equal(btn.nextElementSibling.id, "btn-atlas");
  assert.ok(btn.classList.contains("tb"), "Kopfzeilen-Knopf (44 px ueber .tb)");
  assert.equal(btn.getAttribute("aria-label"), "Projekte");
  assert.equal(btn.textContent, "PROJEKTE");
  assert.equal(layer().getAttribute("role"), "dialog");
  assert.equal(layer().getAttribute("aria-modal"), "true");
  assert.ok(layer().classList.contains("layer"));
  // Vertrag 14: CSP per <meta>, "aktiv erst nach Browser-Test". Welle 3b (Playwright WebKit 26 + Chromium 140,
  // scratchpad wave3b/e2e/csp.py): die Vertragsfassung "worker-src blob:" verbietet sw.js (Offline faellt aus);
  // mit "worker-src 'self' blob:" laufen SW-Anmeldung, Regex-Worker (Blob), Bilder (self/data:/blob:), fetch auf
  // api.github.com, Projekte und Download ohne Verstoss, und Injektion (onerror-Attribut, Inline-Script,
  // javascript:-Link) wird geblockt. Die Meta steht direkt nach charset - sie gilt erst ab ihrer Stelle.
  const csp = [...window.document.querySelectorAll("meta[http-equiv]")]
    .filter((m) => m.getAttribute("http-equiv").toLowerCase() === "content-security-policy");
  assert.equal(csp.length, 1, "genau eine CSP-Meta");
  assert.equal(csp[0].getAttribute("content"), "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    + "img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self' https://api.github.com; object-src 'none'; base-uri 'none'");
  assert.ok(window.document.head.firstElementChild.getAttribute("charset"), "charset bleibt erstes Element");
  assert.equal(window.document.head.firstElementChild.nextElementSibling, csp[0], "CSP direkt nach charset, vor allen Quellen");
  // Einzeldatei (file://): Inline-Skripte - unter script-src 'self' liefe nichts. build_single nimmt die Meta heraus.
  const single = readFileSync(new URL("CodeSearch-Pocket-offline.html", ROOT), "utf8");
  assert.doesNotMatch(single, /<meta[^>]+content-security-policy/i, "Einzeldatei ohne CSP-Meta");
  assert.match(single, /<script>\s*window\.__POCKET_DATA__/, "Einzeldatei bleibt Inline-Bundle");
  assert.equal(createStoreCalls, 1);
  courseBefore = courseSnapshot();
});

test("Ebene oeffnen: Dialog sichtbar, Fokus darin, Hintergrund inert, Verlaufseintrag; Esc schliesst, Fokus zurueck", async () => {
  $("#btn-projects").focus();
  await click("#btn-projects");
  assert.ok(layer().classList.contains("show"));
  assert.equal($("#btn-projects").getAttribute("aria-expanded"), "true");
  assert.equal(window.document.activeElement.id, "pp-title");
  assert.equal(layer().getAttribute("aria-labelledby"), "pp-title");
  assert.equal($("#app").inert, true);
  assert.equal($("#quick").inert, true);
  assert.equal(window.history.state.cspp.page, "list");
  assert.equal(window.history.state.cspp.depth, 1);
  assert.match(layer().textContent, /Noch keine Projekte/);
  await key("Escape");
  await waitFor(() => !layer().classList.contains("show"), "Ebene zu");
  assert.equal(window.history.state, null, "Verlauf zurueck auf dem Ausgangseintrag");
  assert.equal(window.document.activeElement.id, "btn-projects");
  assert.equal($("#btn-projects").getAttribute("aria-expanded"), "false");
  assert.deepEqual(courseSnapshot(), courseBefore, "Kurs-Ebenen und Lernstand unveraendert");
});

// Befund P2a-1 (low): Safari fokussiert Knoepfe beim Tippen nicht - Fokus stand beim Oeffnen auf body.
test("Fokus-Rueckgabe ohne vorher fokussierten Knopf: nach Esc steht der Fokus auf PROJEKTE, nicht auf body", async () => {
  if (window.document.activeElement && window.document.activeElement !== window.document.body) window.document.activeElement.blur();
  assert.equal(window.document.activeElement, window.document.body);
  await click("#btn-projects");
  assert.equal(window.document.activeElement.id, "pp-title");
  await key("Escape");
  await waitFor(() => !layer().classList.contains("show"), "Ebene zu");
  assert.equal(window.document.activeElement.id, "btn-projects");
});

test("Zugang: vorbefuellter Token-Link (nur feste Adresse), Hinweis Safari-Tab vs. installierte App", async () => {
  await click("#btn-projects");
  const links = [...layer().querySelectorAll("a")];
  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute("href"), TOKEN_PAGE_URL);
  assert.equal(TOKEN_PAGE_URL, "https://github.com/settings/personal-access-tokens/new?name=Pocket+iPhone&expires_in=90&contents=read");
  assert.equal(links[0].getAttribute("target"), "_blank");
  assert.match(links[0].getAttribute("rel"), /noopener/);
  assert.match(layer().textContent, /Only select repositories/);
  assert.match(layer().textContent, new RegExp(STORE_API.repo));
  assert.match(layer().textContent, /Browser-Tab, nicht in der installierten App/);
  assert.match(layer().textContent, /7 Tagen/);
  assert.equal($("#pp-token").type, "password");
  assert.equal($("#pp-import").getAttribute("accept"), "application/json,.json");
  assert.equal($("#pp-import-any").hasAttribute("accept"), false, "zweite Auswahl ohne Filter");
  assert.match(layer().textContent, /Auf meinem iPhone/);
});

test("Datei-Import gueltig: Projekt erscheint als 'lokal importiert'; ungueltig: abgelehnt, nichts geaendert", async () => {
  await importFile(PKG.a.bytes, "weichzeichner.json");
  assert.match($("#pp-import-result").textContent, /Importiert: Weichzeichner/);
  await waitFor(() => cardOf("Weichzeichner"), "Karte A");
  const card = cardOf("Weichzeichner");
  assert.match(card.querySelector(".pp-badge").textContent, /lokal importiert/);
  assert.match(card.textContent, /\/project1\/CodeSearch_Tutorial\/Weichzeichner/);
  assert.match(card.textContent, /4 Ops/);
  assert.match(card.textContent, /0 Codequellen/);
  assert.match(card.textContent, /Offline: nicht dauerhaft/);
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), PKG.b1.bytes]);
  await importFile(bom, "kaputt.json", "#pp-import-any");
  assert.match($("#pp-import-result").textContent, /Abgelehnt: Paket beginnt mit einem BOM/);
  assert.equal((await uiStore.listProjects()).length, 1);
  const broken = Buffer.from(PKG.b1.text.replace('"projectName":"Host"', '"projectName":"Hxst"'), "utf8");
  await importFile(broken, "veraendert.json");
  assert.match($("#pp-import-result").textContent, /Abgelehnt: Integritätsprüfung fehlgeschlagen/);
  assert.equal((await uiStore.listProjects()).length, 1);
});

test("Token speichern: geprueft, nur im Store sync - nie in localStorage, im DOM oder im Fortschritts-Export; Abgleich startet", async () => {
  gh.publish(PKG.b1, 1);
  gh.tokens.add(TOKEN);
  $("#pp-token").value = `  ${TOKEN_2}  `;
  // Befund P2a-1 (medium): Vertrag 12 verlangt die Eingabe in der installierten App. jsdom ist ein Browser-Tab:
  // Speichern nur nach einer zweiten, ausdruecklichen Bestaetigung, die die geteilte Origin nennt (Vertrag 15).
  const storeChecks = gh.fileRequests("store.json").length;
  await click(pp("token-save")[0]);
  const ask = layer().querySelector(".pp-dialog");
  assert.ok(ask, "Rueckfrage im Browser-Tab");
  assert.match(ask.textContent, /tombkn\.github\.io/);
  assert.match(ask.textContent, /installierte/);
  assert.equal(gh.fileRequests("store.json").length, storeChecks, "vor der Bestaetigung keine Anfrage");
  await click(pp("dialog-close")[0]);
  assert.equal(layer().querySelector(".pp-dialog"), null);
  assert.equal(await uiStore.getSyncValue(SYNC_KEYS.token), null, "abgebrochen: nichts gespeichert");
  assert.equal($("#pp-token").value, `  ${TOKEN_2}  `, "Eingabe bleibt nach dem Abbruch stehen");
  await click(pp("token-save")[0]);
  await click(pp("token-save-tab")[0]);
  await waitFor(() => /Nicht gespeichert/.test($("#pp-access-result").textContent), "falsches Token abgelehnt");
  assert.match($("#pp-access-result").textContent, /Zugang abgelaufen oder widerrufen/);
  assert.equal($("#pp-token").value, `  ${TOKEN_2}  `, "Eingabe bleibt nach Fehlschlag stehen");
  $("#pp-token").value = TOKEN;
  await click(pp("token-save")[0]);
  await click(pp("token-save-tab")[0]);
  await waitFor(() => /Zugang eingerichtet/.test(layer().textContent), "Token gespeichert");
  await waitFor(() => cardOf("Host"), "Karte B nach Abgleich");
  await waitFor(() => /lokal geladen/.test(cardOf("Host").textContent), "B lokal geladen");
  assert.equal((await uiStore.getSyncValue(SYNC_KEYS.token)).token, TOKEN);
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const k = window.localStorage.key(i);
    assert.ok(!k.includes(TOKEN) && !window.localStorage.getItem(k).includes(TOKEN), `localStorage ${k}`);
  }
  assert.ok(!window.document.documentElement.outerHTML.includes(TOKEN), "Token nicht im DOM");
  assert.ok(!window.document.documentElement.outerHTML.includes(TOKEN_2), "auch kein abgelehntes Token");
  assert.match(cardOf("Weichzeichner").textContent, /lokal importiert/);
  assert.doesNotMatch(cardOf("Weichzeichner").textContent, /Nicht mehr auf dem Speicher/, "nur importiert: nicht 'fehlt'");
  await waitFor(() => pp("sync").length === 1, "⟳ Aktualisieren erscheint mit Zugang, sobald der Lauf fertig ist");
});

test("Sync-Status unterscheidbar: wird geladen -> lokal geladen; Kopf ohne Paket -> fehlgeschlagen", async () => {
  gh.publish(PKG.c, 1);
  const gate = gh.gate(gh.revisionPath(PKG.c));
  await click(pp("sync")[0]);
  await waitFor(() => cardOf("Langsam") && /wird geladen/.test(cardOf("Langsam").textContent), "C wird geladen");
  assert.ok(pp("cancel-sync").length === 1, "Abbrechen waehrend des Laufs");
  gate.release();
  gh.gates.clear();
  await waitFor(() => /lokal geladen/.test(cardOf("Langsam").textContent), "C geladen");
  gh.publish(PKG.d1, 1, { store: false });
  await click(pp("sync")[0]);
  await waitFor(() => cardOf("Kaputt") && /fehlgeschlagen/.test(cardOf("Kaputt").textContent), "D fehlgeschlagen");
  assert.match(cardOf("Kaputt").textContent, /Kopf zeigt auf eine Revision, die auf dem Speicher fehlt/);
  assert.equal(pp("refresh-project", `[data-project="${PID_D}"]`).length, 1, "ohne Paket: Hauptaktion Laden");
});

test("Abgleich in der Oberflaeche: 304, aelterer Stand, Grabstein, 401 und 404 sichtbar; lokale Projekte bleiben", async () => {
  const before = gh.requests.length;
  await click(pp("sync")[0]);
  await waitFor(() => pp("sync").length === 1, "Lauf fertig");
  const conditional = gh.requests.slice(before).filter((r) => r.path === "projects/index.json");
  assert.equal(conditional.length, 1);
  assert.ok(conditional[0].ifNoneMatch, "bedingte Anfrage mit ETag");
  // ⟳ ist manuell: nur das fehlgeschlagene D wird erneut versucht; aktuelle Projekte laden nichts.
  assert.deepEqual(gh.requests.slice(before).filter((r) => r.path && r.path.includes("/revisions/")).map((r) => r.path), [gh.revisionPath(PKG.d1)]);
  gh.publish(PKG.b2, 2);
  await click(pp("sync")[0]);
  await waitFor(() => /lokal geladen/.test(cardOf("Host").textContent) && pp("sync").length === 1, "B rev2");
  assert.equal((await uiStore.getProject(PID_B)).activeSeq, 2);
  gh.publish(PKG.b1, 1);
  await click(pp("sync")[0]);
  await waitFor(() => /Speicher meldet älteren Stand/.test(cardOf("Host").textContent), "aelterer Stand gemeldet");
  assert.equal((await uiStore.getProject(PID_B)).activeSeq, 2);
  gh.tombstone(PID_B);
  await click(pp("sync")[0]);
  await waitFor(() => /Auf dem Speicher gelöscht/.test(cardOf("Host").textContent), "Grabstein markiert");
  assert.ok(pp("open", `[data-project="${PID_B}"]`).length, "lokale Kopie bleibt offen nutzbar");
  gh.tokens.delete(TOKEN);
  await click(pp("sync")[0]);
  await waitFor(() => /Zugang abgelaufen oder widerrufen/.test(layer().querySelector(".pp-notices").textContent), "401 sichtbar");
  assert.equal((await uiStore.listProjects()).length >= 4, true, "nichts geloescht");
  gh.tokens.add(TOKEN);
  const index = gh.files.get("projects/index.json");
  gh.files.delete("projects/index.json");
  await click(pp("sync")[0]);
  await waitFor(() => /Kein Zugriff oder Speicher-Repo fehlt/.test(layer().querySelector(".pp-notices").textContent), "404 sichtbar");
  gh.files.set("projects/index.json", index);
  await click(pp("sync")[0]);
  await waitFor(() => !layer().querySelector(".pp-notice-error"), "Fehler wieder weg");
});

test("Lokal loeschen waehrend eines Abgleichs: getrennte Frage zu Notizen, Projekt bleibt geloescht", async () => {
  gh.publish(PKG.e, 1);
  const gate = gh.gate(gh.revisionPath(PKG.e));
  await click(pp("sync")[0]);
  await waitFor(() => gate.waiting > 0 && cardOf("Wird geloescht"), "E laedt");
  await click(pp("menu", `[data-project="${PID_E}"]`)[0]);
  assert.match(layer().querySelector(".pp-dialog").textContent, /Serverprojekte löscht nur der PC/);
  assert.equal(pp("menu-delete").length, 1);
  assert.equal(layer().querySelector(".pp-dialog").textContent.includes("Server löschen"), false, "kein Server-Loeschen am iPhone");
  await click(pp("menu-delete")[0]);
  assert.equal(window.document.querySelector("#pp-del-notes-keep").checked, true, "Notizen behalten ist vorgewaehlt");
  await click(pp("delete-confirm")[0]);
  gate.release();
  gh.gates.clear();
  await waitFor(() => !cardOf("Wird geloescht") && pp("sync").length === 1, "E weg und Lauf fertig");
  assert.equal(await uiStore.getProject(PID_E), null);
  await click(pp("sync")[0]);
  await waitFor(() => pp("sync").length === 1, "naechster Lauf");
  assert.equal(cardOf("Wird geloescht"), undefined, "nicht automatisch neu geladen");
  // Befund P2a-1 (medium): keine Sackgasse - der Speicher fuehrt das Projekt noch, also eine eigene Zeile mit
  // "Wieder laden" (Name aus dem Index-Kopf, nur als Text).
  const removed = () => [...layer().querySelectorAll(".pp-removed-row")];
  await waitFor(() => removed().length === 1, "Zeile unter 'Lokal entfernt'");
  assert.match(layer().textContent, /Lokal entfernt \(nicht automatisch geladen\)/);
  assert.match(removed()[0].textContent, /Wird geloescht/);
  assert.equal(await uiStore.getProject(PID_E), null, "die Zeile legt keinen Datensatz an");
  await click(pp("restore-removed", `[data-project="${PID_E}"]`)[0]);
  await waitFor(() => cardOf("Wird geloescht") && /lokal geladen/.test(cardOf("Wird geloescht").textContent) && pp("sync").length === 1, "E wieder geladen");
  assert.equal(removed().length, 0);
  assert.equal(await uiStore.isLocallyRemoved(PID_E), false);
});

test("Projekt oeffnen: Uebersicht als statische Momentaufnahme, Tabs, NETZ/CODE ueber project-views.js", async () => {
  await click(pp("open", `[data-project="${PID_C}"]`)[0], 80);
  await waitFor(() => /Statische Momentaufnahme vom/.test(layer().textContent), "Uebersicht");
  const text = layer().textContent;
  assert.match(text, /\/project1\/Host/);
  assert.match(text, /Revision/);
  assert.match(text, /Zentrale COMPs/);
  assert.match(text, /Einstiegspunkte/);
  assert.match(text, /Extension Mixer \(Klasse Mixer\)/);
  assert.match(text, /Codequellen \(1\)/);
  assert.match(text, /Externe Abhängigkeiten/);
  assert.match(text, /Exportgrenzen/);
  assert.match(text, /Storage: nicht exportiert/);
  assert.match(text, /Projekt-Zustand/);
  assert.match(text, /Erfassung wurde wiederholt/, "eigene Vorlage je Warncode");
  assert.doesNotMatch(text, /Vorlagentext/, "nie der Meldungstext aus dem Paket");
  assert.deepEqual([...layer().querySelectorAll(".pp-tab")].map((t) => t.textContent), ["ÜBERSICHT", "HIERARCHIE", "NETZ", "CODE", "SUCHE"]);
  assert.equal(layer().querySelector('.pp-tab[aria-selected="true"]').dataset.tab, "overview");
  // Befund P2a-1 (low): Tabs mit tabpanel/aria-controls und Pfeiltasten. Manuelle Aktivierung: Pfeile bewegen nur
  // den Fokus (NETZ/CODE bauen schwere Ansichten, jeder Wechsel waere ein Verlaufseintrag); Enter/Leertaste waehlt.
  const tabs = [...layer().querySelectorAll(".pp-tab")];
  const panel = layer().querySelector(".pp-body");
  assert.equal(panel.getAttribute("role"), "tabpanel");
  assert.equal(panel.getAttribute("aria-labelledby"), "pp-tab-overview");
  for (const t of tabs) assert.equal(t.getAttribute("aria-controls"), panel.id);
  assert.deepEqual(tabs.map((t) => t.getAttribute("tabindex")), ["0", "-1", "-1", "-1", "-1"]);
  const depth = window.history.state.cspp.depth;
  tabs[0].focus();
  await key("ArrowRight");
  assert.equal(window.document.activeElement.dataset.tab, "hierarchy");
  await key("End");
  assert.equal(window.document.activeElement.dataset.tab, "search");
  await key("ArrowRight");
  assert.equal(window.document.activeElement.dataset.tab, "overview", "rundum");
  await key("ArrowLeft");
  assert.equal(window.document.activeElement.dataset.tab, "search");
  await key("Home");
  assert.equal(window.document.activeElement.dataset.tab, "overview");
  assert.equal(window.history.state.cspp.depth, depth, "Pfeile allein wechseln den Tab nicht");
  assert.equal(window.history.state.cspp.tab, "overview");
  await click(layer().querySelector('.pp-tab[data-tab="network"]'));
  assert.equal(layer().querySelector(".pp-body").getAttribute("aria-labelledby"), "pp-tab-network");
  const net = lastView("network");
  assert.ok(net, "renderNetwork gerufen");
  assert.equal(net.model.projectId, PID_C);
  assert.deepEqual(net.view, { comp: "", selected: null, zoom: null, panX: null, panY: null });
  for (const name of ["selectOp", "enterComp", "goParent", "openDetails", "openCode", "setView"]) assert.equal(typeof net.actions[name], "function", name);
  net.actions.enterComp("engine");
  assert.deepEqual(net.updates.at(-1), { comp: "engine", selected: null, zoom: null, panX: null, panY: null });
  net.actions.setView({ zoom: 2, panX: 10, panY: -5 });
  assert.equal(net.updates.length, 1, "setView spiegelt nicht zurueck");
  net.actions.goParent();
  assert.equal(net.updates.at(-1).comp, "");
  assert.equal(net.updates.at(-1).selected, "engine");
  net.actions.openCode("HostExt", 9);
  await delay(40);
  const code = lastView("code");
  assert.ok(code, "renderCode gerufen");
  assert.equal(code.view.source, "HostExt");
  assert.equal(code.view.line, 9);
  assert.equal(window.history.state.cspp.tab, "code");
  for (const name of ["openDetails", "openSource", "addNote", "copyText", "setView"]) assert.equal(typeof code.actions[name], "function", name);
  assert.equal(net.destroyed, true, "Tabwechsel raeumt die alte Ansicht ab");
});

test("SUCHE: Treffer mit Projekt/Revision, Fundort, Zeile; Grenzen sichtbar; Sprung in den Code", async () => {
  await click(layer().querySelector('.pp-tab[data-tab="search"]'));
  const input = $("#pp-query");
  input.value = "Mix";
  input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await delay(30);
  const meta = layer().querySelector(".pp-search-meta").textContent;
  assert.match(meta, /Projekt Langsam · Revision rev_/);
  assert.match(meta, /Treffer/);
  assert.match(meta, /Tabellen nur mit/);
  const hits = [...layer().querySelectorAll(".pp-hit")];
  assert.ok(hits.length >= 2);
  const codeHit = hits.find((h) => h.querySelector(".pp-hit-kind").textContent === "Code");
  assert.match(codeHit.querySelector(".pp-hit-where").textContent, /\/project1\/Host\/HostExt:\d+/);
  await click(codeHit, 40);
  assert.equal(window.history.state.cspp.tab, "code");
  assert.ok(Number.isSafeInteger(lastView("code").view.line));
});

test("HIERARCHIE: aufklappbar, Typen, Elementzahlen, Pfad, Filter; Sprung zu Netz/Code; Details als Blatt mit Esc", async () => {
  await click(layer().querySelector('.pp-tab[data-tab="hierarchy"]'));
  const rows = () => [...layer().querySelectorAll(".pp-row")];
  assert.equal(rows().length, 4, "Root aufgeklappt, Kinder sichtbar, engine zu");
  const engineRow = rows().find((r) => r.dataset.rel === "engine");
  assert.equal(engineRow.getAttribute("aria-expanded"), "false");
  assert.match(engineRow.textContent, /engine baseCOMP 1/);
  assert.match(engineRow.textContent, /\/project1\/Host\/engine/);
  await click(engineRow.querySelector('[data-pp="tree-toggle"]'));
  assert.ok(rows().some((r) => r.dataset.rel === "engine/noise1"), "bedarfsgerecht aufgeklappt");
  const filter = $("#pp-filter");
  filter.value = "noise";
  filter.dispatchEvent(new window.Event("input", { bubbles: true }));
  await delay(200);
  assert.deepEqual(rows().map((r) => r.dataset.rel), ["engine/noise1"]);
  filter.value = "";
  filter.dispatchEvent(new window.Event("input", { bubbles: true }));
  await delay(200);
  const hostRow = rows().find((r) => r.dataset.rel === "HostExt");
  assert.ok(hostRow.querySelector('[data-pp="open-code"]'), "DAT mit Code: Sprung zu Code");
  await click(hostRow.querySelector('[data-pp="details"]'));
  assert.equal(layer().querySelector(".pp-sheet-wrap").hidden, false);
  assert.equal(lastView("details").rel, "HostExt");
  assert.equal(typeof lastView("details").actions.openUnderstand, "function");
  assert.equal(window.history.state.cspp.sheet.kind, "details");
  assert.equal(window.document.activeElement.id, "pp-sheet-title");
  // Befund P2a-1 (low): das Blatt verdeckt die Kopfzeile - deren Knoepfe duerfen per Tab nicht erreichbar sein.
  assert.equal(layer().querySelector(".pp-head").inert, true, "Kopfzeile inert hinter dem Blatt");
  assert.equal(layer().querySelector(".pp-notices").inert, true);
  await key("Escape");
  await waitFor(() => layer().querySelector(".pp-sheet-wrap").hidden, "Blatt zu");
  assert.equal(layer().querySelector(".pp-head").inert, false);
  assert.ok(layer().classList.contains("show"), "Esc schliesst erst das Blatt");
  assert.equal(window.history.state.cspp.tab, "hierarchy");
  await click(rows().find((r) => r.dataset.rel === "target").querySelector('[data-pp="goto-network"]'));
  const net = lastView("network");
  assert.deepEqual([net.view.comp, net.view.selected], ["", "target"]);
});

test("Zurueck-Navigation: Tab -> Tab -> Projekt -> Liste -> zu; ‹ Liste und ✕ springen genau zurueck", async () => {
  const state = () => window.history.state && window.history.state.cspp;
  // Verlauf bis hier: Liste 1, Projekt 2, NETZ 3, CODE 4, SUCHE 5, CODE (Treffer) 6, HIERARCHIE 7, NETZ 8.
  assert.equal(state().tab, "network");
  assert.equal(state().depth, 8);
  window.history.back();
  await waitFor(() => state().tab === "hierarchy", "zurueck zu HIERARCHIE");
  window.history.back();
  await waitFor(() => state().tab === "code" && state().depth === 6, "zurueck zu CODE");
  window.history.back();
  await waitFor(() => state().tab === "search", "zurueck zu SUCHE");
  assert.equal(layer().querySelector('.pp-tab[aria-selected="true"]').dataset.tab, "search");
  await click(pp("up")[0]);
  await waitFor(() => state() && state().page === "list", "‹ Liste");
  assert.equal(state().depth, 1);
  assert.equal(layer().querySelector(".pp-body").getAttribute("role"), null, "Liste ist kein tabpanel");
  await click(pp("open", `[data-project="${PID_C}"]`)[0], 60);
  assert.equal(state().depth, 2);
  const other = state().tab === "search" ? "overview" : "search";
  await click(layer().querySelector(`.pp-tab[data-tab="${other}"]`));
  assert.equal(state().depth, 3);
  await click(pp("close")[0]);
  await waitFor(() => !layer().classList.contains("show"), "✕ schliesst");
  assert.equal(window.history.state, null);
  assert.deepEqual(courseSnapshot(), courseBefore, "Kurs-Ebenen unveraendert");
  await click("#btn-projects");
  window.history.back();
  await waitFor(() => !layer().classList.contains("show"), "Zurueck schliesst die Ebene");
});

test("Kontext kopieren: Pfad, Revision und belegte Beziehungen als Text", async () => {
  await click("#btn-projects");
  await click(pp("open", `[data-project="${PID_C}"]`)[0], 80);
  await click(layer().querySelector('.pp-tab[data-tab="network"]'));
  lastView("network").actions.selectOp("target");
  copied.length = 0;
  await click(pp("copy-context")[0]);
  const text = copied.at(-1);
  assert.match(text, /statische Momentaufnahme/);
  assert.match(text, /Revision: rev_[0-9a-f]{32}/);
  assert.match(text, /Op: \/project1\/Host\/target \(levelTOP, TOP\)/);
  assert.match(text, /Leitungen hinein:\n {2}\/project1\/Host\/engine:0 → \/project1\/Host\/target:0 \(wire\)/);
  assert.match(text, /Verweise hierher:\n {2}\/project1\/Host\/HostExt Zeile 14 code-op → \/project1\/Host\/target \[static\]/);
});

test("Notizen: addNote aus der Code-Ansicht -> Fenster -> gespeichert; Notizen-Blatt bekommt {note, resolved}", async () => {
  await click(layer().querySelector('.pp-tab[data-tab="code"]'));
  const code = lastView("code");
  assert.equal(code.view.source, "HostExt");
  code.actions.addNote({ kind: "range", source: "HostExt", startLine: 8, endLine: 10 });
  await waitFor(() => window.document.querySelector("#pp-note-text"), "Notizfenster");
  assert.equal(window.document.activeElement.id, "pp-note-text");
  $("#pp-note-text").value = "Mix setzt level";
  await click(pp("note-save")[0]);
  const notes = await uiStore.listNotes(PID_C);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].anchor.startLine, 8);
  assert.equal(notes[0].text, "Mix setzt level");
  await click(pp("notes")[0], 60);
  await waitFor(() => lastView("notes"), "Notizen-Blatt");
  const items = lastView("notes").notes;
  assert.equal(items.length, 1);
  assert.equal(items[0].note.text, "Mix setzt level");
  assert.equal(items[0].resolved.state, "kept");
  assert.equal(typeof lastView("notes").actions.deleteNote, "function");
  await key("Escape");
  await waitFor(() => layer().querySelector(".pp-sheet-wrap").hidden, "Notizen zu");
});

test("Lesepositionen je Projekt und Tab im Store uistate; Wiederoeffnen stellt Tab und Ansicht her", async () => {
  await click(layer().querySelector('.pp-tab[data-tab="hierarchy"]'));
  layer().querySelector(".pp-body").scrollTop = 0;
  await delay(650);
  const saved = await uiStore.getUiState(`view:${PID_C}`);
  assert.equal(saved.revisionId, PKG.c.doc.revision.id);
  assert.equal(saved.tab, "hierarchy");
  assert.ok(saved.hierarchy.expanded.includes("engine"));
  assert.equal(saved.code.source, "HostExt");
  assert.equal(saved.network.selected, "target");
  await click(pp("close")[0]);
  await waitFor(() => !layer().classList.contains("show"), "zu");
  await click("#btn-projects");
  await click(pp("open", `[data-project="${PID_C}"]`)[0], 80);
  await waitFor(() => window.history.state.cspp.tab === "hierarchy", "Tab wiederhergestellt");
  await waitFor(() => [...layer().querySelectorAll(".pp-row")].some((r) => r.dataset.rel === "engine/noise1"), "Aufklappung wiederhergestellt");
});

test("Darstellungs-Testvektoren (Vertrag 14) in allen Paketfeldern erzeugen weder Element noch Attribut", async () => {
  await click(pp("up")[0], 60);
  await importFile(PKG.x.bytes, "xss.json");
  await waitFor(() => cardOf(XSS.img), "XSS-Karte als Text");
  assert.deepEqual(forbiddenIn(layer()), [], "Liste");
  await click(pp("open", `[data-project="${PID_X}"]`)[0], 120);
  await waitFor(() => /Statische Momentaufnahme/.test(layer().textContent), "XSS-Uebersicht");
  assert.ok(layer().textContent.includes(XSS.img), "Projektname als Text");
  assert.ok(layer().textContent.includes(`/project1/${XSS.svg}`), "Root als Text");
  assert.doesNotMatch(layer().textContent, /WARNTEXT/, "Meldungstext aus dem Paket nie im DOM");
  assert.deepEqual(forbiddenIn(layer()), [], "Uebersicht");
  await click(layer().querySelector('.pp-tab[data-tab="hierarchy"]'));
  // Jedes Aufklappen baut den Baum neu: immer den ersten noch zugeklappten Knopf nehmen.
  for (let i = 0; i < 20; i += 1) {
    const toggle = pp("tree-toggle", '[aria-label="Aufklappen"]')[0];
    if (!toggle) break;
    await click(toggle, 10);
  }
  const names = [...layer().querySelectorAll(".pp-row-name")].map((n) => n.textContent);
  for (const name of [XSS.quote, XSS.js, XSS.rlo, XSS.zwsp, "constructor", "__proto__", "toString"]) assert.ok(names.includes(name), name);
  assert.deepEqual(forbiddenIn(layer()), [], "Hierarchie");
  await click(layer().querySelector('.pp-tab[data-tab="search"]'));
  for (const query of ["onerror", "script", "javascript", "*proto*"]) {
    $("#pp-query").value = query;
    $("#pp-query").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await delay(20);
    assert.ok(layer().querySelectorAll(".pp-hit").length > 0, query);
    assert.deepEqual(forbiddenIn(layer()), [], `Suche ${query}`);
  }
  $("#pp-query").value = "onerror";
  $("#pp-query").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await delay(20);
  const longHit = [...layer().querySelectorAll(".pp-hit-text")].find((t) => t.textContent.startsWith("xxxx"));
  assert.ok(longHit && longHit.textContent.length < 400, "1-Mio.-Zeichen-Zeile nur als gekuerzte Vorschau");
  await click(layer().querySelector('.pp-tab[data-tab="code"]'));
  const select = $("#pp-source");
  select.value = "constructor/__proto__";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  await delay(30);
  assert.equal(lastView("code").view.source, "constructor/__proto__");
  const handlers = [...window.document.querySelectorAll("*")].flatMap((el) => el.getAttributeNames().filter((n) => /^on/i.test(n)));
  assert.deepEqual(handlers, [], "keine Event-Attribute auf der ganzen Seite");
  copied.length = 0;
  await click(pp("copy-context")[0]);
  assert.ok(copied.at(-1).includes(XSS.img), "Kopie ist reiner Text");
  assert.deepEqual(runtimeErrors, []);
});

test("Fortschritt sichern/laden: nur feste Kurs-Schluessel; Projekte, Notizen und Token nie in der Datei", async () => {
  await click(pp("close")[0]);
  await waitFor(() => !layer().classList.contains("show"), "zu");
  window.localStorage.setItem("codesearch-pocket-reader-size", "large");
  window.localStorage.setItem("codesearch-pocket-fremd", `Kanarie ${TOKEN}`);
  window.localStorage.setItem("cs_split_layout", "{}");
  const blobs = [];
  const nativeCreate = URL.createObjectURL;
  URL.createObjectURL = (blob) => { blobs.push(blob); return "blob:pocket-test"; };
  const nativeClick = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function noNavigation() {};
  try {
    await click("#btn-offline");
    await click('#layer-offline [data-off="export"]');
  } finally {
    URL.createObjectURL = nativeCreate;
    window.HTMLAnchorElement.prototype.click = nativeClick;
  }
  assert.equal(blobs.length, 1);
  const text = await blobs[0].text();
  const file = JSON.parse(text);
  const allowed = ["codesearch-pocket-v2", "codesearch-pocket-v1", "codesearch-pocket-intro", "codesearch-pocket-reader-size", "codesearch-pocket-specs-v1"];
  assert.deepEqual(Object.keys(file.data).sort(), allowed.filter((k) => window.localStorage.getItem(k) !== null).sort());
  assert.ok(Object.hasOwn(file.data, "codesearch-pocket-reader-size"));
  assert.equal(Object.hasOwn(file.data, "codesearch-pocket-fremd"), false, "fremder Praefix-Schluessel bleibt draussen");
  assert.equal(Object.hasOwn(file.data, "cs_split_layout"), false);
  assert.ok(!text.includes(TOKEN), "kein Token");
  assert.doesNotMatch(text, /psp_[0-9a-f]{32}|rev_[0-9a-f]{32}/, "keine Projekt-IDs");
  const upload = $("#progress-file");
  // Als Text: ein "__proto__"-Schluessel waere im Objektliteral der Prototyp, nicht ein Feld der Datei.
  const evil = `{"app":"codesearch-pocket","saved":"x","data":{"__proto__":"x","codesearch-pocket-reader-size":"normal","codesearch-pocket-fremd":"boese","pp-token":"${TOKEN}"}}`;
  Object.defineProperty(upload, "files", { configurable: true, value: [new window.File([evil], "f.json", { type: "application/json" })] });
  upload.dispatchEvent(new window.Event("change", { bubbles: true }));
  await waitFor(() => window.localStorage.getItem("codesearch-pocket-reader-size") === "normal", "erlaubter Schluessel geladen");
  assert.equal(window.localStorage.getItem("codesearch-pocket-fremd"), `Kanarie ${TOKEN}`, "fremder Schluessel nicht ueberschrieben");
  assert.equal(window.localStorage.getItem("pp-token"), null);
  await delay(700);
  assert.equal(reloads.length, 1, "danach Neustart wie bisher");
  window.localStorage.removeItem("codesearch-pocket-fremd");
  await click('#layer-offline [data-act="offline-close"]');
});

test("Notizen: eigene Datei mit Warnung (nie im Fortschritts-Export); Laden zaehlt vorhandene", async () => {
  await click("#btn-projects");
  assert.match(layer().textContent, /Ausschnitte aus privatem Code/);
  const blobs = [];
  const nativeCreate = URL.createObjectURL;
  URL.createObjectURL = (blob) => { blobs.push(blob); return "blob:pocket-notes"; };
  const nativeClick = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function noNavigation() {};
  try {
    await click(pp("notes-export")[0], 60);
  } finally {
    URL.createObjectURL = nativeCreate;
    window.HTMLAnchorElement.prototype.click = nativeClick;
  }
  assert.equal(blobs.length, 1);
  const text = await blobs[0].text();
  const data = JSON.parse(text);
  assert.equal(data.format, "codesearch.pocket.notes");
  assert.match(data.warning, /privatem Code/);
  assert.ok(data.notes.some((n) => n.text === "Mix setzt level"));
  assert.ok(!text.includes(TOKEN));
  assert.match($("#pp-notes-result").textContent, /gesichert – die Datei enthält Ausschnitte aus privatem Code/);
  const input = $("#pp-notes-file");
  Object.defineProperty(input, "files", { configurable: true, value: [new window.File([text], "notizen.json", { type: "application/json" })] });
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
  await waitFor(() => /Notizen geladen/.test($("#pp-notes-result").textContent), "Notizen geladen");
  assert.match($("#pp-notes-result").textContent, /0 neu, 1 schon vorhanden, 0 ungültig/);
  await click(pp("close")[0]);
  await waitFor(() => !layer().classList.contains("show"), "zu");
});

test("Beim Oeffnen erneut geprueft: veraendertes Paket in IndexedDB wird erkannt und vom Speicher neu geladen", async () => {
  gh.publish(PKG.f, 1);
  await click("#btn-projects");
  await click(pp("sync")[0]);
  await waitFor(() => cardOf("Manipuliert") && /lokal geladen/.test(cardOf("Manipuliert").textContent) && pp("sync").length === 1, "F geladen");
  // Geteilte Origin (Vertrag 15): eine andere Seite koennte IndexedDB aendern - hier direkt in der Attrappe.
  const stored = [...uiStore._data.get("packages").values()].find((p) => p.projectId === PID_F);
  const at = Buffer.from(stored.bytes).indexOf("Manipuliert");
  assert.ok(at > 0);
  stored.bytes[at] = "m".charCodeAt(0);
  await click(pp("open", `[data-project="${PID_F}"]`)[0], 120);
  await waitFor(() => /Gespeichertes Paket besteht die Prüfung nicht: Integritätsprüfung fehlgeschlagen/.test(layer().textContent), "Pruefung beim Oeffnen");
  assert.equal(pp("reload-stored").length, 1, "Speicher hat das Projekt noch: neu laden angeboten");
  await click(pp("reload-stored")[0], 80);
  await waitFor(() => /Statische Momentaufnahme vom/.test(layer().textContent), "neu geladen und geoeffnet");
  assert.equal((await uiStore.getProject(PID_F)).activeRevision, PKG.f.doc.revision.id);
  await click(pp("close")[0]);
  await waitFor(() => !layer().classList.contains("show"), "zu");
});

// Befunde P2a-1 (medium/low): Konflikt nach Import hat einen sichtbaren Rueckweg; gleiche Revision auf dem Speicher
// ist nicht mehr "lokal importiert".
test("Konflikt in der Oberflaeche: Import einer anderen Revision -> Konflikt auf der Karte -> 'Speicherstand laden'", async () => {
  if (!layer().classList.contains("show")) await click("#btn-projects");
  gh.publish(PKG.a, 1);
  await click(pp("sync")[0]);
  await waitFor(() => pp("sync").length === 1 && cardOf("Weichzeichner") && /lokal geladen/.test(cardOf("Weichzeichner").textContent), "A vom Speicher bestaetigt");
  assert.doesNotMatch(cardOf("Weichzeichner").textContent, /lokal importiert/);
  const variant = weichzeichner(PID_A, { label: "me.digits" });
  assert.notEqual(variant.doc.revision.id, PKG.a.doc.revision.id);
  await importFile(variant.bytes, "weichzeichner-variante.json");
  assert.match($("#pp-import-result").textContent, /Importiert: Weichzeichner/);
  await click(pp("sync")[0]);
  await waitFor(() => pp("sync").length === 1 && /weicht von der lokalen/.test(cardOf("Weichzeichner").textContent), "Konflikt sichtbar");
  assert.equal((await uiStore.getProject(PID_A)).activeRevision, variant.doc.revision.id, "Konflikt aendert nichts von selbst");
  assert.equal(pp("adopt-head", `[data-project="${PID_A}"]`).length, 1, "ausdruecklicher Rueckweg auf der Karte");
  await click(pp("adopt-head", `[data-project="${PID_A}"]`)[0]);
  await waitFor(() => pp("sync").length === 1 && !/weicht von der lokalen/.test(cardOf("Weichzeichner").textContent), "Speicherstand aktiv");
  const project = await uiStore.getProject(PID_A);
  assert.equal(project.activeRevision, PKG.a.doc.revision.id);
  assert.equal(project.previousRevision, variant.doc.revision.id, "Import bleibt als vorherige Revision");
  assert.equal(pp("adopt-head", `[data-project="${PID_A}"]`).length, 0);
});

// Befund Welle 3b (E2E, medium): Nach "‹ Liste" blieb das Modell der alten Revision im Speicher; "Öffnen" auf der
// Karte zeigte dann die alte Revision (mit Hinweis "Neue Revision ist geladen"), obwohl die Karte schon den neuen
// Stand nannte. Vertrag 13: nur eine GEOEFFNETE Ansicht bleibt bei ihrer Revision bis "Neue Revision öffnen".
test("Neue Revision: offene Ansicht bleibt bis 'Neue Revision öffnen'; Öffnen aus der Liste zeigt die aktive Revision", async () => {
  const pid = `psp_${"0b".repeat(16)}`;
  const r1 = weichzeichner(pid, { projectName: "Revisionsprobe" });
  const r2 = weichzeichner(pid, { projectName: "Revisionsprobe", label: "me.digits" });
  const r3 = weichzeichner(pid, { projectName: "Revisionsprobe", label: "me.path" });
  const short = (sealed) => sealed.doc.revision.id.slice(0, 16);
  assert.equal(new Set([short(r1), short(r2), short(r3)]).size, 3);
  if (!layer().classList.contains("show")) await click("#btn-projects");
  if (pp("up").length) await click(pp("up")[0], 60);
  const revisionShown = () => layer().querySelector(".pp-facts")?.textContent || "";
  gh.publish(r1, 1);
  await click(pp("sync")[0]);
  await waitFor(() => pp("sync").length === 1 && cardOf("Revisionsprobe") && /lokal geladen/.test(cardOf("Revisionsprobe").textContent), "r1 geladen");
  await click(pp("open", `[data-project="${pid}"]`)[0], 80);
  await waitFor(() => revisionShown().includes(short(r1)), "r1 offen");
  // Automatischer Abgleich bei offener Ansicht: Hinweis, Ansicht bleibt bei r1.
  gh.publish(r2, 2);
  window.dispatchEvent(new window.Event("online"));
  await waitFor(() => pp("open-new-revision").length === 1, "Hinweis Neue Revision");
  assert.match(layer().textContent, /Neue Revision ist geladen/);
  assert.ok(revisionShown().includes(short(r1)), "offene Ansicht bleibt bei ihrer Revision");
  await click(pp("open-new-revision")[0], 80);
  await waitFor(() => revisionShown().includes(short(r2)), "r2 nach ausdruecklichem Wechsel");
  assert.equal(pp("open-new-revision").length, 0);
  // Zur Liste, neuer Kopf, dann ausdruecklich oeffnen: es gilt die aktive Revision, kein veralteter Hinweis.
  await click(pp("up")[0], 60);
  gh.publish(r3, 3);
  await click(pp("sync")[0]);
  await waitFor(() => pp("sync").length === 1 && (cardOf("Revisionsprobe")?.textContent || "").includes("lokal geladen"), "r3 geladen");
  assert.equal((await uiStore.getProject(pid)).activeRevision, r3.doc.revision.id);
  await click(pp("open", `[data-project="${pid}"]`)[0], 80);
  await waitFor(() => /Statische Momentaufnahme vom/.test(layer().textContent) && layer().querySelector(".pp-facts"), "geoeffnet");
  assert.ok(revisionShown().includes(short(r3)), `Öffnen aus der Liste zeigt die aktive Revision (gezeigt: ${revisionShown()})`);
  assert.doesNotMatch(layer().textContent, /Neue Revision ist geladen/);
  await click(pp("up")[0], 60);
});

// Befund P2a-1 (low): "Notizen ohne Projekt" wurden nur gezaehlt (Vertrag 13: sie bleiben dort sichtbar).
test("Notizen ohne Projekt: Liste mit Text und Ort (nur Text), einzeln loeschbar nach Rueckfrage", async () => {
  const [note] = await uiStore.listNotes(PID_C);
  const orphanProject = `psp_${"9a".repeat(16)}`;
  const orphanId = `note_${"ab".repeat(16)}`;
  await uiStore.putNote({ ...note, id: orphanId, projectId: orphanProject, anchor: { ...note.anchor, projectId: orphanProject },
    text: `Verwaist ${XSS.img}` });
  if (layer().classList.contains("show")) {
    await click(pp("close")[0]);
    await waitFor(() => !layer().classList.contains("show"), "zu");
  }
  await click("#btn-projects");
  const rows = () => [...layer().querySelectorAll(".pp-orphan")];
  await waitFor(() => rows().length === 1, "verwaiste Notiz sichtbar");
  assert.match(layer().textContent, /Notizen ohne Projekt/);
  assert.match(rows()[0].textContent, /Verwaist <img src=x onerror=alert\(1\)>/, "Notiztext als Text");
  assert.match(rows()[0].textContent, /\/project1\/Host\/HostExt/, "Ort aus dem Anker");
  assert.deepEqual(forbiddenIn(rows()[0]), []);
  await click(rows()[0].querySelector('[data-pp="orphan-delete"]'));
  assert.match(layer().querySelector(".pp-dialog").textContent, /Notiz löschen/);
  await click(pp("orphan-delete-confirm")[0]);
  await waitFor(() => rows().length === 0, "verwaiste Notiz geloescht");
  assert.equal(await uiStore.getNote(orphanId), null);
  assert.equal((await uiStore.listNotes(PID_C)).length, 1, "Notizen anderer Projekte bleiben");
  await click(pp("close")[0]);
  await waitFor(() => !layer().classList.contains("show"), "zu");
});

// ================================================================== Befunde der Schlusspruefung 1.11.0 (Oberflaeche)

async function openList() {
  if (!layer().classList.contains("show")) await click("#btn-projects");
  if (pp("up").length) {
    await click(pp("up")[0], 60);
    await waitFor(() => window.history.state && window.history.state.cspp.page === "list", "Liste");
  }
}

async function openProjectTab(projectId, tab) {
  await openList();
  await click(pp("open", `[data-project="${projectId}"]`)[0], 100);
  await waitFor(() => layer().querySelector(`.pp-tab[data-tab="${tab}"]`), "Projekt offen");
  if (window.history.state.cspp.tab !== tab) await click(layer().querySelector(`.pp-tab[data-tab="${tab}"]`), 40);
}

// Befund oberflaeche-f1 (low): ein Speicherfehler beim Import (Verbindung verloren, Speicher gesperrt) war eine
// unbehandelte Ablehnung - "Prüfe 1/2 …" blieb fuer immer stehen, die zweite Datei wurde nie geprueft.
test("Import mit Speicherfehler: jede Datei meldet ihn, keine bleibt bei 'Prüfe …'; Hinweis mit 'Seite neu laden'", async () => {
  await openList();
  const original = uiStore.getProject;
  uiStore.getProject = async () => { throw new StoreError("connection-lost", { reload: true }); };
  try {
    const input = $("#pp-import");
    Object.defineProperty(input, "files", { configurable: true, value: [
      new window.File([PKG.a.bytes], "a.json", { type: "application/json" }),
      new window.File([PKG.e.bytes], "e.json", { type: "application/json" })] });
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
    await waitFor(() => !/Prüfe/.test($("#pp-import-result").textContent) && $("#pp-import-result").textContent, "Import fertig");
  } finally {
    uiStore.getProject = original;
  }
  const text = $("#pp-import-result").textContent;
  assert.equal((text.match(/Nicht importiert: Verbindung zum Speicher verloren/g) || []).length, 2, text);
  await waitFor(() => pp("page-reload").length === 1, "Knopf 'Seite neu laden' im Hinweis");
  const before = reloads.length;
  await click(pp("page-reload")[0]);
  assert.equal(reloads.length, before + 1);
});

// Befund oberflaeche-f2 (medium): store.js meldet nach "connection lost" trotz Neuoeffnen reload:true (Vertrag 13:
// "kontrolliert neu laden"); gelesen wurde das nie. Die installierte App hat keinen Neu-laden-Knopf des Browsers, und
// "Vom Speicher neu laden" startete nur einen Abgleich, der wieder scheiterte.
test("Speicherverbindung verloren: 'Seite neu laden' im Projekt-Fehler, im Listen-Hinweis und nach dem Abgleich", async () => {
  const inBody = () => [...layer().querySelectorAll('.pp-body [data-pp="page-reload"]')];
  const inNotice = () => [...layer().querySelectorAll('.pp-notices [data-pp="page-reload"]')];
  const notices = () => layer().querySelector(".pp-notices").textContent;
  await openList();
  // Ein erfolgreicher Abgleich raeumt den Hinweis des vorigen Tests ab.
  await click(pp("sync")[0]);
  await waitFor(() => pp("sync").length === 1 && inNotice().length === 0, "Ausgangslage ohne Hinweis");
  const original = uiStore.getActivePackage;
  uiStore.getActivePackage = async () => { throw new StoreError("connection-lost", { reload: true }); };
  try {
    await click(pp("open", `[data-project="${PID_C}"]`)[0], 80);
    await waitFor(() => /Projekt lässt sich nicht öffnen/.test(layer().querySelector(".pp-body").textContent), "Fehler beim Oeffnen");
  } finally {
    uiStore.getActivePackage = original;
  }
  assert.match(layer().querySelector(".pp-body").textContent, /Verbindung zum Speicher verloren/);
  assert.equal(inBody().length, 1, "Knopf 'Seite neu laden' im Projekt-Fehler");
  assert.equal(pp("refresh-project").length, 0, "kein Abgleich-Knopf, der hier nicht hilft");
  let before = reloads.length;
  await click(inBody()[0]);
  assert.equal(reloads.length, before + 1, "location.reload()");
  // Liste: der Hinweis zum Speicherfehler bekommt denselben Knopf.
  const list = uiStore.listProjects;
  uiStore.listProjects = async () => { throw new StoreError("connection-lost", { reload: true }); };
  try {
    await click(pp("up")[0], 60);
    await waitFor(() => inNotice().length === 1 && /Verbindung zum Speicher verloren/.test(notices()), "Hinweis in der Liste");
  } finally {
    uiStore.listProjects = list;
  }
  before = reloads.length;
  await click(inNotice()[0]);
  assert.equal(reloads.length, before + 1);
  // Abgleich: Ergebnis mit reload:true (StoreError ausserhalb einer Aktivierung) zeigt den Knopf ebenso.
  const epoch = uiStore.syncEpoch;
  uiStore.syncEpoch = async () => { throw new StoreError("connection-lost", { reload: true }); };
  try {
    await click(pp("sync")[0]);
    await waitFor(() => pp("sync").length === 1 && /Lokaler Speicher meldet einen Fehler/.test(notices()), "Abgleich-Hinweis");
  } finally {
    uiStore.syncEpoch = epoch;
  }
  assert.equal(inNotice().length, 1, "Knopf nach dem Abgleich");
  await click(pp("sync")[0]);
  await waitFor(() => pp("sync").length === 1 && inNotice().length === 0, "naechster Abgleich ohne Fehler");
});

// Befund oberflaeche-f7 (low): nach dem Schliessen eines Blatts (Esc) und nach Menue -> Umbenennen -> Esc stand der
// Fokus auf body ausserhalb der Ebene; Tab sprang an den Anfang, die Stelle in der Liste war weg.
test("Fokus-Rueckgabe: Blatt zu -> Ausloeser; Menue -> Umbenennen -> Esc -> ⋯ der Karte", async () => {
  await openProjectTab(PID_C, "hierarchy");
  await waitFor(() => [...layer().querySelectorAll(".pp-row")].some((r) => r.dataset.rel === "HostExt"), "Hierarchie");
  const details = [...layer().querySelectorAll(".pp-row")].find((r) => r.dataset.rel === "HostExt").querySelector('[data-pp="details"]');
  details.focus();
  await click(details);
  assert.equal(window.document.activeElement.id, "pp-sheet-title");
  await key("Escape");
  await waitFor(() => layer().querySelector(".pp-sheet-wrap").hidden, "Blatt zu");
  const now = window.document.activeElement;
  assert.equal(now, details, `Fokus auf ${now.tagName}${now.id ? `#${now.id}` : ""}`);
  await openList();
  await waitFor(() => pp("menu", `[data-project="${PID_C}"]`).length === 1, "Karte");
  const menu = pp("menu", `[data-project="${PID_C}"]`)[0];
  menu.focus();
  await click(menu);
  assert.ok(layer().querySelector(".pp-dialog"), "Menue offen");
  await click(pp("menu-rename")[0]);
  assert.equal(window.document.activeElement.id, "pp-rename");
  await key("Escape");
  assert.equal(layer().querySelector(".pp-dialog"), null, "Fenster zu");
  assert.equal(window.document.activeElement, menu, "Fokus zurueck auf ⋯ der Karte");
});

// Befund oberflaeche-f8 (low): die Huelle setzte Paketzeichenketten ohne Marke ein - ein U+202E in Op-Namen, Pfaden
// oder Trefferzeilen vertauschte dort die Anzeige (Trojan Source), in den Ansichten nicht.
test("Bidi- und Nullbreitenzeichen in Karten-/Kopftitel, HIERARCHIE und SUCHE: isoliert und mit sichtbarer Marke", async () => {
  const shown = "bidi‮TXT.exe";
  await uiStore.setLocalName(PID_X, shown);
  try {
    if (layer().classList.contains("show")) {
      await click(pp("close")[0]);
      await waitFor(() => !layer().classList.contains("show"), "zu");
    }
    await click("#btn-projects");
    await waitFor(() => [...layer().querySelectorAll(".pp-card-title")].some((t) => t.textContent === shown), "Karte mit lokalem Namen");
    const title = [...layer().querySelectorAll(".pp-card-title")].find((t) => t.textContent === shown);
    assert.ok(title.querySelector('bdi .pv-ctl[data-cp="202E"]'), "Kartentitel mit Marke");
    await openProjectTab(PID_X, "hierarchy");
    assert.equal($("#pp-title").textContent, shown, "Text bleibt exakt");
    assert.ok($("#pp-title").querySelector('bdi .pv-ctl[data-cp="202E"]'), "Kopftitel mit Marke");
    for (let i = 0; i < 20; i += 1) {
      const toggle = pp("tree-toggle", '[aria-label="Aufklappen"]')[0];
      if (!toggle) break;
      await click(toggle, 10);
    }
    const row = (rel) => [...layer().querySelectorAll(".pp-row")].find((r) => r.dataset.rel === rel);
    assert.equal(row(XSS.rlo).querySelector(".pp-row-name").textContent, XSS.rlo);
    assert.ok(row(XSS.rlo).querySelector('.pp-row-name bdi .pv-ctl[data-cp="202E"]'), "Name in HIERARCHIE");
    assert.ok(row(XSS.rlo).querySelector('.pp-row-path bdi .pv-ctl[data-cp="202E"]'), "Pfad in HIERARCHIE");
    assert.ok(row(XSS.zwsp).querySelector('.pp-row-name .pv-ctl[data-cp="200B"]'), "Nullbreitenzeichen");
    await click(layer().querySelector('.pp-tab[data-tab="search"]'), 40);
    $("#pp-query").value = "gnp";
    $("#pp-query").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await delay(30);
    const hits = [...layer().querySelectorAll(".pp-hit")];
    const hit = hits.find((x) => x.querySelector(".pp-hit-where").textContent.includes("‮"));
    assert.ok(hit, `Treffer mit U+202E im Fundort (${hits.length} Treffer)`);
    assert.ok(hit.querySelector('.pp-hit-where bdi .pv-ctl[data-cp="202E"]'), "Fundort in SUCHE mit Marke");
    assert.ok(hit.querySelector('.pp-hit-text bdi .pv-ctl[data-cp="202E"]'), "Trefferzeile in SUCHE mit Marke");
    assert.deepEqual(forbiddenIn(layer()), []);
  } finally {
    await uiStore.setLocalName(PID_X, null);
  }
});

// Befund oberflaeche-f11 (low): nach "Code kopieren", "Pfad kopieren" und "Auswahl kopieren" meldete die Huelle
// "Kontext kopiert.", obwohl der Quelltext, der Pfad oder die Auswahl in der Zwischenablage lag.
test("Kopieren meldet, was kopiert wurde: Code, Pfad, Auswahl, Kontext", async () => {
  await openProjectTab(PID_C, "code");
  const code = lastView("code");
  for (const [kind, text] of [["code", "Code kopiert."], ["path", "Pfad kopiert."], ["selection", "Auswahl kopiert."]]) {
    code.actions.copyText(`x-${kind}`, kind);
    await waitFor(() => $("#toast").textContent === text, text);
    assert.equal(copied.at(-1), `x-${kind}`);
  }
  await click(pp("copy-context")[0]);
  await waitFor(() => $("#toast").textContent === "Kontext kopiert.", "Kontext kopiert.");
});

// Befund oberflaeche-f5 (low): mit offener Ebene PROJEKTE rief die Maus-Zurueck-Taste den Kurs-Verlauf auf (hinter der
// modalen Ebene) und hielt per preventDefault das Browser-Zurueck auf, das die Projekt-Navigation fuehrt.
test("Maus-Daumentasten bei offener Ebene PROJEKTE: kein preventDefault, Kurs hinter der Ebene bleibt unveraendert", async () => {
  const wasReading = $("#tour").classList.contains("open");
  if (layer().classList.contains("show")) {
    await click(pp("close")[0]);
    await waitFor(() => !layer().classList.contains("show"), "zu");
  }
  // Im Arbeitsplatz (Lesetext zu) wirken die Daumentasten im Kurs - genau dort lag der Fehler.
  if (wasReading) await click("#tour-grip");
  try {
    await click("#btn-projects");
    const before = courseSnapshot();
    const depth = window.history.state.cspp.depth;
    const side = (type, button) => {
      const ev = new window.MouseEvent(type, { button, bubbles: true, cancelable: true });
      $("#pp-title").dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    for (const button of [3, 4]) {
      assert.equal(side("mousedown", button), false, `mousedown Taste ${button}`);
      assert.equal(side("mouseup", button), false, `mouseup Taste ${button}`);
    }
    await delay(30);
    assert.ok(layer().classList.contains("show"));
    assert.equal(window.history.state.cspp.depth, depth, "Verlauf unveraendert");
    assert.deepEqual(courseSnapshot(), before, "Kurs unveraendert");
    await click(pp("close")[0]);
    await waitFor(() => !layer().classList.contains("show"), "zu");
    // Gegenprobe ohne Ebene: der Arbeitsplatz faengt die Tasten weiter ab (Kurs-Verhalten unveraendert).
    const ev = new window.MouseEvent("mousedown", { button: 3, bubbles: true, cancelable: true });
    window.document.body.dispatchEvent(ev);
    assert.equal(ev.defaultPrevented, true);
  } finally {
    if (wasReading && !$("#tour").classList.contains("open")) await click("#tour-grip");
  }
});

// Eigene Seite fuer eine zweite Ebene. Mit CSP-Meta wie index.html: ohne sie schaltet die Ebene die Projekte ab
// (Befund oberflaeche-f3, Test unten).
const SHELL_PAGE = "<!doctype html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'\"></head>"
  + '<body><button id="btn-projects"></button><div class="layer" id="layer-projects"></div></body>';

// Befund P2a-1 (medium): in der installierten App ohne Rueckfrage, im Browser-Tab nur nach zweiter Bestaetigung.
test("Token-Eingabe: installierte App speichert direkt; Browser-Tab erst nach ausdruecklicher Bestaetigung", async () => {
  for (const installed of [true, false]) {
    const dom = new JSDOM(SHELL_PAGE, { url: "https://pocket.test/" });
    if (installed) Object.defineProperty(dom.window.navigator, "standalone", { configurable: true, value: true });
    const saved = { window: globalThis.window, document: globalThis.document };
    Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
    const own = new FakeGitHub();
    const store = new MemoryStore();
    try {
      const host = { layers: { projects: false }, offline: {}, render: () => {} };
      const deps = { ...platform, createStore: () => store, fetch: own.fetch, debounceMs: 0, minIntervalMs: 0 };
      const shell = new ProjectsShell({ host, layer: dom.window.document.querySelector("#layer-projects"), location: { protocol: "https:" }, deps,
        nav: { push() {}, back() {}, up() {}, close() {} } });
      shell.start();
      await shell.ready();
      shell.openLayer();
      const root = dom.window.document.querySelector("#layer-projects");
      assert.equal(/Browser-Tab, nicht in der installierten App/.test(root.textContent), !installed);
      root.querySelector("#pp-token").value = TOKEN;
      root.querySelector('[data-pp="token-save"]').click();
      await delay(40);
      const dialog = root.querySelector(".pp-dialog");
      if (installed) {
        assert.equal(dialog, null, "App: keine Rueckfrage");
      } else {
        assert.ok(dialog, "Tab: Rueckfrage");
        assert.equal(await store.getSyncValue(SYNC_KEYS.token), null, "vor der Bestaetigung nichts gespeichert");
        assert.equal(own.fileRequests("store.json").length, 0);
        root.querySelector('[data-pp="token-save-tab"]').click();
        await delay(40);
      }
      await waitFor(() => /Zugang eingerichtet/.test(root.textContent), `gespeichert (installiert=${installed})`);
      assert.equal((await store.getSyncValue(SYNC_KEYS.token)).token, TOKEN);
      // Der Abgleich nach dem Speichern zeichnet in dieses Dokument: erst fertig werden lassen, dann aufraeumen.
      await waitFor(() => shell.sync.runs >= 1 && !shell.sync.running, "Abgleich nach dem Speichern fertig");
      await delay(30);
    } finally {
      Object.defineProperty(globalThis, "window", { configurable: true, value: saved.window });
      Object.defineProperty(globalThis, "document", { configurable: true, value: saved.document });
      dom.window.close();
    }
  }
});

// Befund Welle 3b (E2E, low): Nach Neustart mit 401-Halt hob "Zugang prüfen" den Halt zwar auf, aber die Statuszeile
// unter "My Pocket Projects" sagte weiter "Abgleich angehalten" - der Projektteil wurde nach _refreshToken nicht neu
// gezeichnet (er haengt an tokenInfo: Halt, Zugang vorhanden, "Speicherstand laden").
test("401-Halt nach Neustart: 'Zugang prüfen' entfernt den Halt auch aus der Statuszeile der Projektliste", async () => {
  const dom = new JSDOM(SHELL_PAGE, { url: "https://pocket.test/" });
  const saved = { window: globalThis.window, document: globalThis.document };
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  const own = new FakeGitHub();
  const store = await storeWithToken();
  await store.putSyncValue(SYNC_KEYS.token, { ...(await store.getSyncValue(SYNC_KEYS.token)), authFailedAt: "2026-11-05T10:00:00Z" });
  try {
    const host = { layers: { projects: false }, offline: {}, render: () => {} };
    const deps = { ...platform, createStore: () => store, fetch: own.fetch, debounceMs: 0, minIntervalMs: 0 };
    const shell = new ProjectsShell({ host, layer: dom.window.document.querySelector("#layer-projects"), location: { protocol: "https:" }, deps,
      nav: { push() {}, back() {}, up() {}, close() {} } });
    shell.start();
    await shell.ready();
    shell.openLayer();
    const root = dom.window.document.querySelector("#layer-projects");
    const statusLine = () => root.querySelector("#pp-h-projects").parentElement.querySelector("p.pp-muted").textContent;
    await waitFor(() => /Abgleich angehalten/.test(statusLine()), "Halt in der Statuszeile");
    assert.equal(own.requests.length, 0, "Halt: kein automatischer Abgleich");
    root.querySelector('[data-pp="token-recheck"]').click();
    await waitFor(() => /Zugang funktioniert/.test(root.querySelector("#pp-access-result").textContent), "Zugang geprueft");
    await waitFor(() => !/Abgleich angehalten/.test(root.querySelector(".pp-section").textContent), "Halt in der Statuszeile aufgehoben", 1000);
    assert.doesNotMatch(root.textContent, /Abgleich angehalten/, "nirgends mehr 'angehalten'");
    assert.equal((await syncApi.readTokenInfo(store)).authFailedAt, null);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: saved.window });
    Object.defineProperty(globalThis, "document", { configurable: true, value: saved.document });
    dom.window.close();
  }
});

test("Reine Helfer: Eintraege aus history geprueft, Status-Vorrang, Verfuegbarkeit unter file://", () => {
  assert.deepEqual(cleanEntry({ page: "project", projectId: "psp_kurz", tab: "network" }), { page: "list" });
  assert.deepEqual(cleanEntry({ page: "project", projectId: PID_B, tab: "evil", sheet: { kind: "x" } }), { page: "project", projectId: PID_B, tab: "overview", sheet: null });
  assert.equal(cleanEntry("x"), null);
  assert.deepEqual(projectsAvailability({ protocol: "file:" }, uiStore), { enabled: false, reason: "file" });
  assert.deepEqual(projectsAvailability({ protocol: "https:" }, null), { enabled: false, reason: "no-store" });
  const env = { appFilesComplete: true, installed: true, persisted: true };
  const record = { activeRevision: "rev_x", activeSeq: 2, activeHead: { committedAt: "2026-11-05T11:00:00Z" }, indexHead: { seq: 3 }, serverStatus: "active" };
  assert.deepEqual(projectStatus(record, null, env), { primary: "offline", flags: ["newer"] });
  assert.equal(projectStatus(record, null, { ...env, persisted: false }).primary, "local");
  assert.equal(projectStatus(record, { state: "loading" }, env).primary, "loading");
  assert.equal(projectStatus(record, { state: "failed" }, env).primary, "failed");
  assert.equal(projectStatus({ ...record, activeHead: { committedAt: null } }, null, env).primary, "imported");
  assert.equal(projectStatus({ activeRevision: null, activeSeq: 0, indexHead: { seq: 1 }, serverStatus: "active" }, null, env).primary, "remote");
  assert.deepEqual(projectStatus({ ...record, indexHead: { seq: 1 } }, null, env).flags, ["older"]);
  // Befund (low): gleiche Revision mit gleicher seq auf dem Speicher -> Speicher-Kopf zaehlt, nicht mehr "importiert".
  assert.ok(importedOnServer, "Datensatz aus dem Abgleich-Test");
  assert.deepEqual(projectStatus(importedOnServer, null, env), { primary: "offline", flags: [] });
  // Konflikt auch ohne laufenden Abgleich sichtbar (nach Neustart): gleiche seq, andere Revision.
  const conflicted = { ...record, activeSeq: 3, indexHead: { seq: 3, revisionId: "rev_y" } };
  assert.deepEqual(projectStatus(conflicted, null, env).flags, ["conflict"]);
  assert.equal(typeof contextText, "function");
});

test("Einzeldatei (file://): Projekte deaktiviert - kein Speicher, kein Netz, nur ein Hinweis", async () => {
  const dom = new JSDOM('<!doctype html><body><button id="btn-projects"></button><div class="layer" id="layer-projects"></div></body>', { url: "file:///CodeSearch-Pocket-offline.html" });
  const saved = { window: globalThis.window, document: globalThis.document };
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  let created = 0;
  let fetched = 0;
  const pushes = [];
  try {
    const host = { layers: { projects: false }, offline: {}, render: () => {} };
    const deps = { ...platform, createStore: () => { created += 1; return new MemoryStore(); }, fetch: async () => { fetched += 1; throw new TypeError("kein Netz"); } };
    const shell = new ProjectsShell({ host, layer: dom.window.document.querySelector("#layer-projects"), location: dom.window.location, deps,
      nav: { push: (e) => pushes.push(e), back() {}, up() {}, close() {} } });
    shell.start();
    await shell.ready();
    shell.openLayer();
    assert.equal(host.layers.projects, true);
    assert.match(dom.window.document.querySelector("#layer-projects").textContent, /Projekte sind hier deaktiviert/);
    assert.equal(await shell.requestSync("manual"), null);
    assert.equal(created, 0);
    assert.equal(fetched, 0);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: saved.window });
    Object.defineProperty(globalThis, "document", { configurable: true, value: saved.document });
    dom.window.close();
  }
});

// Zweite Ebene in eigener Seite: window/document fuer die Dauer tauschen (wie in den Tests oben), Ebene oeffnen.
async function withShell(html, url, deps, run) {
  const dom = new JSDOM(html, { url });
  const saved = { window: globalThis.window, document: globalThis.document };
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  try {
    const host = { layers: { projects: false }, offline: {}, render: () => {} };
    const shell = new ProjectsShell({ host, layer: dom.window.document.querySelector("#layer-projects"), location: dom.window.location,
      deps: { ...platform, debounceMs: 0, minIntervalMs: 0, ...deps }, nav: { push() {}, back() {}, up() {}, close() {} } });
    shell.start();
    await shell.ready();
    shell.openLayer();
    await delay(40);
    return await run({ shell, root: dom.window.document.querySelector("#layer-projects") });
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: saved.window });
    Object.defineProperty(globalThis, "document", { configurable: true, value: saved.document });
    dom.window.close();
  }
}

// Befund oberflaeche-f3 (medium): die Einzeldatei hat keine CSP-Meta (build_single) und liegt auch auf Pages
// (https://tombkn.github.io/codesearch-pocket/CodeSearch-Pocket-offline.html). Abgeschaltet wurde nur unter file://,
// ueber https liefen Token-Feld, Import und IndexedDB voll - ohne CSP. Jetzt: ohne CSP-Meta keine Projekte.
test("Ohne CSP-Meta (Einzeldatei ueber https): Projekte deaktiviert - kein Speicher, kein Token-Feld, kein Netz", async () => {
  let created = 0;
  let fetched = 0;
  const deps = { createStore: () => { created += 1; return new MemoryStore(); }, fetch: async () => { fetched += 1; throw new TypeError("kein Netz"); } };
  await withShell('<!doctype html><body><button id="btn-projects"></button><div class="layer" id="layer-projects"></div></body>',
    "https://tombkn.github.io/codesearch-pocket/CodeSearch-Pocket-offline.html", deps, async ({ shell, root }) => {
      assert.deepEqual(shell.availability, { enabled: false, reason: "no-csp" });
      assert.match(root.textContent, /Projekte sind hier deaktiviert/);
      assert.match(root.textContent, /ohne Content Security Policy/);
      assert.equal(root.querySelector("#pp-token"), null, "kein Token-Feld");
      assert.equal(root.querySelector("#pp-import"), null, "kein Import");
      assert.equal(await shell.requestSync("manual"), null);
    });
  assert.equal(created, 0, "IndexedDB wird nicht einmal geoeffnet");
  assert.equal(fetched, 0);
  // Mit der Meta (wie index.html) laeuft dieselbe Ebene normal.
  await withShell(SHELL_PAGE, "https://pocket.test/", { ...deps, fetch: new FakeGitHub().fetch }, async ({ shell }) => {
    assert.deepEqual(shell.availability, { enabled: true, reason: null });
  });
  assert.equal(created, 1);
});

// Dieselbe Pruefung auf der echten Einzeldatei (gebaut von tools/build_offline.py), geladen wie von Pages: Projekte
// bleiben aus, eine IndexedDB-Attrappe wird nie geoeffnet (der Speicher der Origin teilt sich mit anderen Seiten).
test("Einzeldatei CodeSearch-Pocket-offline.html ueber https: Projekte aus, IndexedDB unberuehrt", async () => {
  const single = readFileSync(new URL("CodeSearch-Pocket-offline.html", ROOT), "utf8");
  let opened = 0;
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error.message));
  const page = new JSDOM(single, {
    url: "https://tombkn.github.io/codesearch-pocket/CodeSearch-Pocket-offline.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(win) {
      win.TextEncoder = TextEncoder;
      win.TextDecoder = TextDecoder;
      win.fetch = async () => { throw new TypeError("kein Netz"); };
      win.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
      win.indexedDB = { open() { opened += 1; return {}; } };
    },
  });
  try {
    await delay(300);
    const doc = page.window.document;
    assert.equal(doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').length, 0, "Einzeldatei ohne CSP-Meta");
    doc.querySelector("#btn-projects").click();
    await delay(80);
    const root = doc.querySelector("#layer-projects");
    assert.ok(root.classList.contains("show"), "Ebene offen");
    assert.match(root.textContent, /Projekte sind hier deaktiviert/);
    assert.match(root.textContent, /ohne Content Security Policy/);
    assert.equal(root.querySelector("#pp-token"), null, "kein Token-Feld");
    assert.equal(opened, 0, "IndexedDB nie geoeffnet");
    assert.deepEqual(errors, []);
  } finally {
    page.window.close();
  }
});

// Befund oberflaeche-f6 (low): liess sich IndexedDB nicht oeffnen (SecurityError, gesperrter Website-Speicher), stand
// unter "My Pocket Projects" dauerhaft "Lade Projekte …" neben dem Sammelhinweis "Speicherfehler.".
test("Speicher laesst sich nicht oeffnen: 'Projektspeicher nicht verfügbar' statt dauerhaft 'Lade Projekte …'", async () => {
  const broken = new MemoryStore();
  broken._run = () => Promise.reject(new StoreError("error", { name: "SecurityError" }));
  await withShell(SHELL_PAGE, "https://pocket.test/", { createStore: () => broken, fetch: new FakeGitHub().fetch }, async ({ root }) => {
    const section = () => root.querySelector("#pp-h-projects").parentElement.textContent;
    await waitFor(() => /Projektspeicher nicht verfügbar/.test(section()), "Liste meldet den Speicher");
    assert.doesNotMatch(section(), /Lade Projekte/);
    assert.match(root.querySelector(".pp-notices").textContent, /Speicherfehler/);
  });
});

test("Code-Pruefung: keine HTML-Senken und kein localStorage in Ebene und Abgleich", () => {
  for (const file of ["js/ui/projects.js", "js/projects/sync.js"]) {
    const text = readFileSync(new URL(file, ROOT), "utf8");
    // Nur Code pruefen: die Kommentare nennen die verbotenen Senken ausdruecklich.
    const code = text.split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");
    for (const pattern of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /\bupdateHtml\b/, /\bmd\(/, /document\.write/, /\beval\(/,
      /new Function/, /localStorage/, /\.setAttribute\(\s*["'](?:href|src|style|on)/, /\.style\.(?!setProperty\("--pp-depth")/]) {
      assert.doesNotMatch(code, pattern, `${file}: ${pattern}`);
    }
    assert.doesNotMatch(text, /psp_[0-9a-f]{32}|rev_[0-9a-f]{32}|"format"\s*:\s*"codesearch\.pocket/, `${file}: keine Projektmarkierungen (package-tests)`);
  }
});

after(() => {
  window.close();
});
