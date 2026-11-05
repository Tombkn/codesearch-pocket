// Projektmodell (Vertrag Abschnitt 14) auf einem gepruefen Paket - statt Net/util.abs/PREFIX des Kurses.
// Pfadbasis ist exportRoot.path JE MODELL; zwei Projekte (auch Root "/") koennen gleichzeitig offen sein.
// Alle Indizes entstehen einmal beim Laden: Ops nach rel, Kinder je COMP, Leitungen ein/aus je Op, Verweise je
// Quelle/Ziel, Zeilen je Quelle (einmal zerlegt), Symbole je Quelle, Aufrufkanten, Suchindex.
// Lookups nur ueber Map: "constructor", "toString", "__proto__" sind gueltige TD-/Python-Namen.
// Rein: kein DOM. Das Modell liefert Rohtexte; die Ansichten setzen sie nur per textContent ein.

import { splitLines } from "./c14n.js";
import { absPath, relPath, validate, validateEntry } from "./schema.js";

// Grenzen wie js/core/views/search.js: Suchtext hoechstens 512 Zeichen, Treffer 300 (1..2000), je Abschnitt 60.
// Dazu zwei Schutzgrenzen gegen untraute Paketinhalte (Vertrag 14: eine Zeile mit 1 Mio. Zeichen): hoechstens
// 4 "*" je Suchbegriff, und Texte ueber 20 000 Zeichen (JS-Laenge) nur woertlich durchsucht.
export const SEARCH_LIMITS = Object.freeze({
  maxQuery: 512,
  defaultResults: 300,
  maxResults: 2000,
  sectionMax: 60,
  previewChars: 240,
  maxWildcards: 4,
  literalAbove: 20000,
});
export const SEARCH_KINDS = Object.freeze(["name", "path", "method", "code", "parameter", "table"]);
const DEFAULT_KINDS = ["name", "path", "method", "code", "parameter"];
const CERTAINTY_RANK = Object.freeze({ unknown: 0, static: 1, captured: 2 });
// Sites, deren Ziel ein Verweis derselben Zeile traegt (Analyse cs_pocket_analysis: via-Werte). "opshortcut"
// (op.Global.X()) und "parent" (parent().X()) haben keinen Namen an der Site - der code-shortcut- bzw.
// code-parent-Verweis derselben Zeile liefert das Ziel.
const REF_VIAS = new Set(["op", "opof", "iop", "parentshortcut", "ext", "modof", "opshortcut", "parent"]);

export class ModelError extends Error {
  constructor(code) {
    super(`model: ${code}`);
    this.name = "ModelError";
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function listPush(map, key, value) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function endOp(end) {
  return isRecord(end) && Object.hasOwn(end, "op") ? end.op : null;
}

function symKey(source, symbol) {
  return `${source}\n${symbol ?? ""}`;
}

function weakest(a, b) {
  return (CERTAINTY_RANK[a] ?? 0) <= (CERTAINTY_RANK[b] ?? 0) ? a : b;
}

// Klasse aus dem Extension-Ausdruck: der Name direkt vor "(me)" - op('./X').module.Cls(me), mod('X').Cls(me).
// Der Ausdruck wird nie ausgefuehrt; ohne Treffer sucht das Modell die Methode in allen Klassen des DAT.
// Von hinten gelesen, linear, mit demselben Ergebnis wie /([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*me\s*\)\s*$/: die Regex
// ohne Anfangsanker lief von jeder Startposition durch den ganzen Bezeichner (quadratisch; 65 536 Zeichen ohne
// "(me)" kosteten rund 2 s je Slot im Hauptthread, Befund kern-f2).
const SPACE = /\s/;
const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_]/;

function extensionClass(expr) {
  let at = expr.length;
  const skipSpace = () => {
    while (at > 0 && SPACE.test(expr[at - 1])) at -= 1;
  };
  const take = (text) => {
    if (at < text.length || expr.slice(at - text.length, at) !== text) return false;
    at -= text.length;
    return true;
  };
  skipSpace();
  if (!take(")")) return null;
  skipSpace();
  if (!take("me")) return null;
  skipSpace();
  if (!take("(")) return null;
  skipSpace();
  const end = at;
  while (at > 0 && IDENT_CHAR.test(expr[at - 1])) at -= 1;
  // Die Regex beginnt beim ersten Buchstaben/Unterstrich des Bezeichnerlaufs (fuehrende Ziffern gehoeren nicht dazu).
  while (at < end && !IDENT_START.test(expr[at])) at += 1;
  return at < end ? expr.slice(at, end) : null;
}

function preview(text) {
  const flat = text.length > SEARCH_LIMITS.previewChars * 4 ? text.slice(0, SEARCH_LIMITS.previewChars * 4) : text;
  const clean = flat.replace(/\t/g, "    ").trim();
  if (clean.length <= SEARCH_LIMITS.previewChars) return { text: clean, cut: flat.length < text.length };
  let cut = SEARCH_LIMITS.previewChars;
  const c = clean.charCodeAt(cut - 1);
  if (c >= 0xd800 && c <= 0xdbff) cut -= 1;
  return { text: clean.slice(0, cut), cut: true };
}

// Par-artige Felder ({value} | {unknown, expr} | {unknown:"size"} | {omitted:"secret"}) bzw. Klartext: nur echte
// Werte zurueckgeben. Platzhalter sind nie Text - sonst wuerde "[object Object]" durchsucht oder angezeigt.
export function knownValue(field) {
  if (typeof field === "string" || typeof field === "boolean") return field;
  if (isRecord(field) && Object.hasOwn(field, "value") && (typeof field.value === "string" || typeof field.value === "boolean")) {
    return field.value;
  }
  return null;
}

// Darstellung eines Parameterwerts nach Vertrag 4.11: Floats woertlich (nie Number()), Wahrheitswerte nur bei
// t:"bool", unbekannte oder ausgelassene Werte bleiben unbekannt - nie wird der Default eingesetzt.
export function describeValue(value) {
  if (!isRecord(value)) return { kind: "unknown", reason: "missing" };
  if (value.t === "unknown") return { kind: "unknown", reason: value.reason };
  if (value.omitted === "secret") return { kind: "omitted", reason: "secret", t: value.t };
  if (value.t === "bool") return { kind: "value", t: "bool", text: value.v, bool: value.v === "1" };
  return { kind: "value", t: value.t, text: value.v };
}

function parameterText(p) {
  const parts = [];
  if (isRecord(p.value) && typeof p.value.v === "string") parts.push(p.value.v);
  if (typeof p.expr === "string") parts.push(p.expr);
  if (typeof p.bindExpr === "string") parts.push(p.bindExpr);
  return parts.join(" ");
}

// Dynamische Verweise (code.dynamic, Vertrag 4.12) tragen seit Stand 09:15 ein code-Objekt, haben aber nie ein
// Ziel: sie duerfen eine Aufrufstelle nicht mitentscheiden, sonst macht parent(self.n) im Argument den festen
// parent()-Aufruf derselben Zeile "ambiguous". Dynamische Aufrufstellen (via "dynamic") enden vorher in _resolveSite.
function refMatchesSite(ref, site) {
  const code = ref.code;
  if (!isRecord(code) || code.dynamic === true || typeof ref.kind !== "string" || !ref.kind.startsWith("code-")) return false;
  switch (site.via) {
    case "op":
    case "opof":
      return code.art === "call" && (site.op === null || code.name === site.op);
    case "parentshortcut":
    case "ext":
      return code.art === "short" && code.receiver === "parent" && (site.shortcut === null || code.name === site.shortcut);
    case "iop":
      return code.art === "short" && code.receiver === "iop" && (site.shortcut === null || code.name === site.shortcut);
    case "modof":
      return ref.kind === "code-module" || (code.art === "call" && (site.op === null || code.name === site.op));
    case "opshortcut":
      return code.art === "short" && code.receiver === "op" && (site.shortcut === null || code.name === site.shortcut);
    case "parent":
      return code.art === "parent";
    default:
      return false;
  }
}

function targetKey(target) {
  if (!isRecord(target)) return "";
  if (Object.hasOwn(target, "op")) return `op\n${target.op}`;
  if (Object.hasOwn(target, "external")) return `external\n${target.external}`;
  return `unresolved\n${target.unresolved}`;
}

// ---------------------------------------------------------------- Suche ohne Rueckverfolgung
// Dieselbe Suchsprache wie compileQuery der Kurs-Suche (Woerter = UND, ^wort = ohne, a | b = ODER, "a b" = Phrase,
// * = Luecke, ohne * am Rand ganzes Wort), aber ohne RegExp: compileQuery macht aus "a*a*a*a*b" das Muster
// a.*?a.*?a.*?a.*?b, und das braucht auf 800 Zeichen "aaaa..." schon rund 15 s (gemessen, Node 22). Hier sucht
// indexOf jeden Teil der Reihe nach; jede Fundstelle wird hoechstens einmal geprueft, die Zeit waechst linear mit
// dem Text. Texte ueber literalAbove (20 000) werden nur woertlich durchsucht: die Teile der Reihe nach als
// Teilstring, ohne Wortgrenzen und ohne Zeilenschranken; wie viele das waren, steht im Ergebnis (limits).

// "." im RegExp der Kurs-Suche ueberspringt diese Zeichen nie: eine Luecke "*" reicht nicht darueber hinweg.
const LINE_BREAK = /[\n\r\u2028\u2029]/;

function isWordCode(c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

function starCount(text) {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 42) count += 1;
  return count;
}

// Erste Fundstelle von needle ab from, fuer die accept(start, end) gilt; -1 = keine.
function findWhere(hay, needle, from, accept) {
  let at = hay.indexOf(needle, from);
  while (at !== -1) {
    if (accept(at, at + needle.length)) return at;
    // Ein leerer Teil ("a**") findet indexOf am Textende immer wieder an derselben Stelle: dort aufhoeren.
    if (at >= hay.length) return -1;
    at = hay.indexOf(needle, at + 1);
  }
  return -1;
}

// Ein Suchbegriff wie termRegex: ein "*" am Anfang bzw. Ende hebt die Wortgrenze dort auf, innere "*" sind Luecken.
function compileTerm(raw, fold, whole) {
  let core = raw;
  let left = whole;
  let right = whole;
  if (core.startsWith("*")) {
    left = false;
    core = core.slice(1);
  }
  if (core.endsWith("*")) {
    right = false;
    core = core.slice(0, -1);
  }
  if (!core) return null;
  return {
    parts: core.split("*").map(fold),
    needLeft: left && isWordCode(core.charCodeAt(0)),
    needRight: right && isWordCode(core.charCodeAt(core.length - 1)),
  };
}

// Greedy reicht: die frueheste passende Stelle jedes Teils laesst den folgenden Teilen den meisten Platz.
function termInSegment(seg, term) {
  const { parts, needLeft, needRight } = term;
  const leftOk = (start) => !needLeft || start === 0 || !isWordCode(seg.charCodeAt(start - 1));
  const rightOk = (end) => !needRight || end >= seg.length || !isWordCode(seg.charCodeAt(end));
  const last = parts.length - 1;
  if (last === 0) return findWhere(seg, parts[0], 0, (start, end) => leftOk(start) && rightOk(end)) !== -1;
  const first = findWhere(seg, parts[0], 0, (start) => leftOk(start));
  if (first === -1) return false;
  let pos = first + parts[0].length;
  for (let i = 1; i < last; i += 1) {
    const at = seg.indexOf(parts[i], pos);
    if (at === -1) return false;
    pos = at + parts[i].length;
  }
  return findWhere(seg, parts[last], pos, (_start, end) => rightOk(end)) !== -1;
}

function termMatches(hay, term) {
  if (term.parts.length === 1 || !LINE_BREAK.test(hay)) return termInSegment(hay, term);
  return hay.split(LINE_BREAK).some((seg) => termInSegment(seg, term));
}

// Woertlich: Teile der Reihe nach als Teilstring, ohne Wortgrenzen - fuer Texte ueber literalAbove.
function termLiteral(hay, term) {
  let pos = 0;
  for (const part of term.parts) {
    const at = hay.indexOf(part, pos);
    if (at === -1) return false;
    pos = at + part.length;
  }
  return true;
}

// Suchtext -> {match(text) -> bool, state:{literalTexts}} | {error:"wildcards"} | null (leer). Die Zerlegung in
// Gruppen und Begriffe ist die von compileQuery (js/core/util.js), damit Kurs- und Projektsuche gleich lesen.
export function compileSearch(query, { caseSensitive = false, whole = true } = {}) {
  const text = String(query || "").trim();
  if (!text) return null;
  const fold = caseSensitive ? (value) => value : (value) => value.toLowerCase();
  const groups = [];
  for (const alt of text.split(/\s+\|\s+|\|/).map((s) => s.trim()).filter(Boolean)) {
    const tokens = [];
    const rx = /"([^"]+)"|(\S+)/g;
    let m;
    while ((m = rx.exec(alt))) {
      if (m[1] !== undefined) {
        tokens.push({ negative: false, phrase: fold(m[1]) });
        continue;
      }
      const negative = m[2].startsWith("^");
      const raw = negative ? m[2].slice(1) : m[2];
      if (starCount(raw) > SEARCH_LIMITS.maxWildcards) return { error: "wildcards" };
      const term = compileTerm(raw, fold, whole);
      if (term) tokens.push({ negative, term });
    }
    groups.push(tokens);
  }
  const state = { literalTexts: 0 };
  const match = (value) => {
    const source = typeof value === "string" ? value : "";
    const literal = source.length > SEARCH_LIMITS.literalAbove;
    if (literal) state.literalTexts += 1;
    const hay = fold(source);
    const hit = (t) => {
      if (t.phrase !== undefined) return hay.includes(t.phrase);
      return literal ? termLiteral(hay, t.term) : termMatches(hay, t.term);
    };
    return groups.some((tokens) => tokens.length > 0 && tokens.every((t) => (t.negative ? !hit(t) : hit(t))));
  };
  return { match, state };
}

// Eingang: Ergebnis von verifyPackage (ok:true) oder ein Dokument, das hier noch einmal schema-geprueft wird.
export function createModel(input) {
  if (isRecord(input) && input.ok === true && isRecord(input.doc)) return new ProjectModel(input.doc);
  const checked = validate(input);
  if (!checked.ok) throw new ModelError("invalid");
  return new ProjectModel(input);
}

export class ProjectModel {
  constructor(doc) {
    this.doc = doc;
    this.projectId = doc.projectId;
    this.revisionId = doc.revision.id;
    this.root = doc.exportRoot.path;
    this.projectName = doc.projectName;
    this.exportedAt = doc.exportedAt;
    this.capabilities = doc.capabilities;
    this.consistency = doc.capture.consistency;
    this._buildOperators();
    this._buildConnections();
    this._buildSources();
    this._buildReferences();
    this._buildSymbols();
    this._buildExtensions();
    this._buildCalls();
    this._buildSearchIndex();
  }

  // ---------------------------------------------------------------- Pfade
  abs(rel) {
    return absPath(this.root, rel);
  }

  relOf(path) {
    return relPath(this.root, path);
  }

  // ---------------------------------------------------------------- Aufbau
  _buildOperators() {
    this._ops = new Map();
    this._children = new Map();
    for (const o of this.doc.operators) {
      this._ops.set(o.rel, o);
      if (o.parent !== null) listPush(this._children, o.parent, o);
    }
    this._annotations = new Map();
    for (const a of this.doc.annotations) listPush(this._annotations, a.parent, a);
    this._parameters = new Map();
    for (const p of this.doc.parameters) listPush(this._parameters, p.op, p);
  }

  _buildConnections() {
    this._in = new Map();
    this._out = new Map();
    this._externalEnds = new Map();
    for (const c of this.doc.connections) {
      const to = endOp(c.to);
      const from = endOp(c.from);
      if (to !== null) listPush(this._in, to, c);
      if (from !== null) listPush(this._out, from, c);
      if (to === null) listPush(this._externalEnds, c.to.external, c);
      if (from === null) listPush(this._externalEnds, c.from.external, c);
    }
  }

  _buildSources() {
    this._sources = new Map();
    this._lines = new Map();
    const unsearchable = new Map();
    for (const s of this.doc.codeSources) {
      this._sources.set(s.key, s);
      // Zeilen genau einmal zerlegen (LF-Index-Zeilen wie im Paket); Ansichten und Suche teilen das Array.
      if (s.status === "exact" && typeof s.text === "string") this._lines.set(s.key, Object.freeze(splitLines(s.text)));
      if (s.status !== "exact") unsearchable.set(s.status, (unsearchable.get(s.status) || 0) + 1);
    }
    this.unsearchable = Object.freeze([...unsearchable.entries()].sort().map(([reason, count]) => ({ reason, count })));
  }

  _buildReferences() {
    this._refsFrom = new Map();
    this._refsTo = new Map();
    this._refsInSource = new Map();
    this._refsAt = new Map();
    this._refsExternal = new Map();
    for (const r of this.doc.references) {
      listPush(this._refsFrom, r.from.op, r);
      const target = endOp(r.target);
      if (target !== null) listPush(this._refsTo, target, r);
      else if (Object.hasOwn(r.target, "external")) listPush(this._refsExternal, r.target.external, r);
      if (r.from.source !== null) {
        listPush(this._refsInSource, r.from.source, r);
        if (r.from.line !== null) listPush(this._refsAt, `${r.from.source}\n${r.from.line}`, r);
      }
    }
  }

  _buildSymbols() {
    this._entries = new Map();
    this._tables = new Map();
    this.entryProblems = [];
    for (const item of this.doc.analysis.code) {
      const check = validateEntry(item.entry);
      // Kaputter Eintrag: Pocket zeigt {error:"schema"}, die Quelle bleibt lesbar (Vertrag 4.14).
      const entry = check.ok ? item.entry : { error: "schema" };
      if (!check.ok) this.entryProblems.push({ source: item.source, errors: check.errors });
      this._entries.set(item.source, entry);
      if (!check.ok || !Array.isArray(entry.symbols)) continue;
      const table = { classes: entry.classes, symbols: entry.symbols, byId: new Map(), byClass: new Map(), moduleFns: new Map() };
      for (const s of entry.symbols) {
        table.byId.set(s.symbol, s);
        if (s.class === null) {
          if (!table.moduleFns.has(s.name)) table.moduleFns.set(s.name, s);
        } else {
          let members = table.byClass.get(s.class);
          if (!members) {
            members = new Map();
            table.byClass.set(s.class, members);
          }
          if (!members.has(s.name)) members.set(s.name, s);
        }
      }
      this._tables.set(item.source, table);
    }
  }

  _buildExtensions() {
    this._ext = new Map();
    const extRefs = new Map();
    for (const r of this.doc.references) if (r.kind === "ext-object") listPush(extRefs, r.from.op, r);
    for (const o of this.doc.operators) {
      if (!o.isCOMP || !o.extensions.length) continue;
      const refs = extRefs.get(o.rel) || [];
      const list = [];
      for (const ext of o.extensions) {
        const expr = isRecord(ext.object) && typeof ext.object.value === "string" ? ext.object.value : null;
        // Ziel-DAT nur aus dem Paket (captured/static-Verweis), nie aus einem geratenen gleichnamigen DAT.
        let ref = refs.find((r) => r.from.par === `ext${ext.slot}object`) || null;
        if (!ref && refs.length === 1 && o.extensions.length === 1) ref = refs[0];
        const dat = ref ? endOp(ref.target) : null;
        // name/promote kommen wie Parameter: {value} (Exporter), sonst unbekannt/ausgelassen -> null.
        const name = knownValue(ext.name);
        const promote = knownValue(ext.promote);
        list.push({
          slot: ext.slot,
          name: typeof name === "string" ? name : null,
          promote: typeof promote === "boolean" ? promote : null,
          className: expr ? extensionClass(expr) : null,
          dat,
          certainty: ref ? ref.certainty : "unknown",
        });
      }
      this._ext.set(o.rel, list);
    }
  }

  _methodOn(opRel, attr, via) {
    const target = this._ops.get(opRel);
    if (!target) return null;
    if (via === "modof" || target.family === "DAT") {
      const table = this._tables.get(opRel);
      const fn = table ? table.moduleFns.get(attr) : null;
      return fn ? { source: opRel, symbol: fn.symbol, certainty: "static" } : null;
    }
    if (!target.isCOMP) return null;
    for (const ext of this._ext.get(opRel) || []) {
      if (ext.dat === null) continue;
      const table = this._tables.get(ext.dat);
      if (!table) continue;
      let sym = null;
      if (ext.className) {
        const members = table.byClass.get(ext.className);
        sym = members ? members.get(attr) || null : null;
      } else {
        const found = [...table.byClass.values()].map((m) => m.get(attr)).filter(Boolean);
        sym = found.length === 1 ? found[0] : null;
      }
      if (sym) return { source: ext.dat, symbol: sym.symbol, certainty: ext.certainty };
    }
    return null;
  }

  _resolveSite(key, table, site) {
    const caller = table && site.symbol !== null ? table.byId.get(site.symbol) : null;
    const callerClass = caller ? caller.class : null;
    const edge = {
      from: { source: key, symbol: site.symbol },
      line: site.line,
      attr: site.attr,
      type: site.type,
      via: site.via,
      dynamic: site.dynamic === true,
      target: null,
      certainty: "unknown",
      reason: null,
    };
    const ownClass = callerClass !== null && table ? table.byClass.get(callerClass) : null;
    if (site.type === "run") {
      // run('args[0].X()', self, ...): Ziel steht nur in einem Laufzeit-String - hoechstens vermutet.
      const m = typeof site.text === "string" ? /args\[0\]\.([A-Za-z_][A-Za-z0-9_]*)\(/.exec(site.text) : null;
      const target = m && ownClass ? ownClass.get(m[1]) : null;
      if (target) edge.target = { source: key, symbol: target.symbol };
      edge.reason = "run-string";
      return edge;
    }
    if (site.via === "dynamic") {
      // op(<Ausdruck>).X(): das Ziel entsteht erst zur Laufzeit; der Verweis traegt {unresolved:"dynamic"}.
      edge.reason = "dynamic";
      return edge;
    }
    if (site.via === "self") {
      // self-Aufrufe nur innerhalb der eigenen Klasse (zwei __init__ in zwei Klassen bleiben getrennt).
      const target = ownClass ? ownClass.get(site.attr) : null;
      if (target) {
        edge.target = { source: key, symbol: target.symbol };
        edge.certainty = "static";
      } else {
        edge.reason = callerClass === null ? "no-class" : "not-in-class";
      }
      return edge;
    }
    if (!REF_VIAS.has(site.via)) {
      edge.reason = "api";
      return edge;
    }
    let candidates = (this._refsAt.get(`${key}\n${site.line}`) || []).filter((r) => refMatchesSite(r, site));
    let sameSource = false;
    if (!candidates.length) {
      // Variable aus op('X') weiter oben: gleicher fester Verweis in derselben Quelle, sonst nichts raten.
      candidates = (this._refsInSource.get(key) || []).filter((r) => refMatchesSite(r, site));
      sameSource = candidates.length > 0;
    }
    if (!candidates.length) {
      edge.reason = "no-reference";
      return edge;
    }
    if (new Set(candidates.map((r) => targetKey(r.target))).size > 1) {
      edge.reason = "ambiguous";
      return edge;
    }
    const ref = candidates[0];
    const certainty = sameSource ? weakest(ref.certainty, "static") : ref.certainty;
    if (Object.hasOwn(ref.target, "external")) {
      edge.target = { external: ref.target.external };
      edge.certainty = certainty;
      edge.reason = "external";
      return edge;
    }
    if (Object.hasOwn(ref.target, "unresolved")) {
      edge.reason = `unresolved:${ref.target.unresolved}`;
      return edge;
    }
    const opRel = ref.target.op;
    const method = this._methodOn(opRel, site.attr, site.via);
    if (method) {
      edge.target = { source: method.source, symbol: method.symbol, op: opRel };
      edge.certainty = weakest(certainty, method.certainty);
    } else {
      edge.target = { op: opRel };
      edge.certainty = certainty;
      edge.reason = "op-only";
    }
    if (sameSource && !edge.reason) edge.reason = "same-source";
    return edge;
  }

  _buildCalls() {
    this._calls = [];
    this._callees = new Map();
    this._callers = new Map();
    for (const [key, entry] of this._entries) {
      const sites = Array.isArray(entry.sites) ? entry.sites : [];
      const table = this._tables.get(key) || null;
      for (const site of sites) {
        const edge = this._resolveSite(key, table, site);
        this._calls.push(edge);
        listPush(this._callees, symKey(key, site.symbol), edge);
        if (edge.target && typeof edge.target.symbol === "string") {
          listPush(this._callers, symKey(edge.target.source, edge.target.symbol), edge);
        }
      }
    }
  }

  _buildSearchIndex() {
    this._opRows = this.doc.operators.map((o) => ({
      o,
      // comment kann ein Platzhalter sein ({unknown:"size"} | {omitted:"secret"}): dann nicht durchsuchen.
      match: [o.name, o.opType, typeof o.comment === "string" ? o.comment : "", ...o.tags].join(" "),
      path: `${o.rel} ${this.abs(o.rel)}`,
    }));
    this._codeRows = [];
    for (const [key, lines] of this._lines) {
      for (let i = 0; i < lines.length; i += 1) {
        if (/\S/.test(lines[i])) this._codeRows.push({ key, line: i + 1, text: lines[i] });
      }
    }
    this._symbolRows = [];
    for (const [key, table] of this._tables) {
      for (const s of table.symbols) this._symbolRows.push({ key, s, match: `${s.symbol} ${s.name}` });
    }
    this._parRows = this.doc.parameters.map((p) => ({
      p,
      match: `${p.name} ${typeof p.label === "string" ? p.label : ""} ${parameterText(p)}`,
    }));
    this._tableRows = [];
    for (const s of this.doc.codeSources) {
      if (!Array.isArray(s.table)) continue;
      s.table.forEach((row, i) => this._tableRows.push({ key: s.key, line: i + 1, text: row.join("  ") }));
    }
  }

  // ---------------------------------------------------------------- Operatoren und Netz
  op(rel) {
    return this._ops.get(rel) || null;
  }

  has(rel) {
    return this._ops.has(rel);
  }

  rootOp() {
    return this._ops.get("") || null;
  }

  operators() {
    return this.doc.operators;
  }

  children(rel) {
    return this._children.get(rel) || [];
  }

  // "Kinder nicht exportiert": TD zaehlt mehr sichtbare Kinder, als das Paket enthaelt.
  hiddenChildren(rel) {
    const o = this._ops.get(rel);
    if (!o || !Number.isSafeInteger(o.children)) return 0;
    return Math.max(0, o.children - this.children(rel).length);
  }

  annotations(compRel) {
    return this._annotations.get(compRel) || [];
  }

  parameters(rel) {
    return this._parameters.get(rel) || [];
  }

  parameter(rel, name) {
    return this.parameters(rel).find((p) => p.name === name) || null;
  }

  inputs(rel) {
    return [...(this._in.get(rel) || [])].sort((a, b) => a.toIndex - b.toIndex);
  }

  outputs(rel) {
    return [...(this._out.get(rel) || [])].sort((a, b) => a.fromIndex - b.fromIndex);
  }

  // Netz eines COMP: Positionen nur, wo sie bekannt sind - unbekannte Ops stehen getrennt mit Grund, ihre Leitungen
  // sind gestrichelt; Leitungen zu externen Enden oder anderen Ebenen kommen als "outer" (nicht navigierbar).
  network(compRel) {
    const comp = this._ops.get(compRel);
    if (!comp) return null;
    const kids = this.children(compRel);
    const inside = new Set(kids.map((o) => o.rel));
    const known = [];
    const unknown = [];
    for (const o of kids) {
      const base = { rel: o.rel, name: o.name, opType: o.opType, family: o.family };
      if (Object.hasOwn(o.node, "unknown")) unknown.push({ ...base, reason: o.node.unknown });
      else known.push({ ...base, x: o.node.x, y: o.node.y, w: o.node.w, h: o.node.h });
    }
    const unknownSet = new Set(unknown.map((u) => u.rel));
    const wires = [];
    const outer = [];
    for (const o of kids) {
      for (const c of this._in.get(o.rel) || []) {
        const from = endOp(c.from);
        if (from !== null && inside.has(from)) wires.push({ ...c, dashed: unknownSet.has(from) || unknownSet.has(o.rel) });
        else outer.push(c);
      }
      for (const c of this._out.get(o.rel) || []) {
        const to = endOp(c.to);
        if (to === null || !inside.has(to)) outer.push(c);
      }
    }
    return {
      comp: compRel,
      path: this.abs(compRel),
      known,
      unknown,
      wires,
      outer,
      boundary: { in: this.inputs(compRel), out: this.outputs(compRel) },
      connectors: comp.connectors,
      annotations: this.annotations(compRel),
      hiddenChildren: this.hiddenChildren(compRel),
    };
  }

  // ---------------------------------------------------------------- Code
  source(key) {
    return this._sources.get(key) || null;
  }

  sources() {
    return this.doc.codeSources;
  }

  sourceLines(key) {
    return this._lines.get(key) || [];
  }

  entry(key) {
    return this._entries.get(key) || null;
  }

  classes(key) {
    const table = this._tables.get(key);
    return table ? table.classes : [];
  }

  symbols(key) {
    const table = this._tables.get(key);
    return table ? table.symbols : [];
  }

  symbol(key, id) {
    const table = this._tables.get(key);
    return table ? table.byId.get(id) || null : null;
  }

  // Innerstes Symbol, das die Zeile enthaelt (Methoden vor Klassenrumpf).
  symbolAt(key, line) {
    let best = null;
    for (const s of this.symbols(key)) {
      if (s.line <= line && line <= s.end && (!best || s.line >= best.line)) best = s;
    }
    return best;
  }

  extensions(compRel) {
    return this._ext.get(compRel) || [];
  }

  // ---------------------------------------------------------------- Verweise und Verstehen
  referencesFrom(rel) {
    return this._refsFrom.get(rel) || [];
  }

  referencesTo(rel) {
    return this._refsTo.get(rel) || [];
  }

  referencesInSource(key) {
    return this._refsInSource.get(key) || [];
  }

  calls() {
    return this._calls;
  }

  // Wen ruft das Symbol? (symbol null = Modulebene) - Kanten mit target, certainty und reason.
  callees(source, symbol = null) {
    return this._callees.get(symKey(source, symbol)) || [];
  }

  // Wer ruft das Symbol? Nur Kanten, deren Ziel genau dieses Symbol ist.
  callers(source, symbol) {
    return this._callers.get(symKey(source, symbol)) || [];
  }

  // Zustandsname aus der Klasse/den Zustaenden: liest/schreibt wer? accesses (CodeModel) plus stateAtlas.
  // name = "level" oder klassenqualifiziert "Mixer.level"; className filtert beide Quellen gleich.
  // StateAtlas nennt Attribute "Klasse.name" (class_name) und Methoden "pocket:<rel>:Klasse.methode" - beides wird
  // auf die accesses-Form ("Klasse.methode") gebracht, damit eine Stelle nur einmal erscheint.
  stateAccess(source, name, { className = null } = {}) {
    const entry = this._entries.get(source);
    const table = this._tables.get(source);
    const out = { readers: [], writers: [], available: Boolean(table) };
    if (!table || typeof name !== "string") return out;
    const dot = name.lastIndexOf(".");
    const bare = dot === -1 ? name : name.slice(dot + 1);
    const wantedClass = dot === -1 ? className : name.slice(0, dot);
    if (dot !== -1 && className !== null && className !== wantedClass) return out;
    const seen = new Set();
    const add = (side, item) => {
      const key = `${side}\n${item.source}\n${item.line}`;
      if (seen.has(key)) return;
      seen.add(key);
      out[side].push(item);
    };
    for (const a of entry.accesses) {
      if (a.name !== bare) continue;
      const sym = a.symbol !== null ? table.byId.get(a.symbol) : null;
      if (wantedClass !== null && (!sym || sym.class !== wantedClass)) continue;
      add(a.how === "read" ? "readers" : "writers", { source, line: a.line, symbol: a.symbol, how: a.how, conf: a.conf, origin: "accesses" });
    }
    for (const state of entry.stateAtlas.states) {
      if (!isRecord(state) || typeof state.name !== "string") continue;
      const stateClass = typeof state.class_name === "string" && state.name.startsWith(`${state.class_name}.`) ? state.class_name : null;
      const stateName = stateClass === null ? state.name : state.name.slice(stateClass.length + 1);
      if (stateName !== bare || (wantedClass !== null && stateClass !== wantedClass)) continue;
      for (const [side, list] of [["readers", state.readers], ["writers", state.writers]]) {
        if (!Array.isArray(list)) continue;
        for (const r of list) {
          if (!isRecord(r)) continue;
          const owner = typeof r.source === "string" && r.source.startsWith("pocket:") ? r.source : null;
          const method = typeof r.method === "string" ? r.method : null;
          add(side, {
            source: owner === null ? null : owner.slice(7),
            line: Number.isSafeInteger(r.line) ? r.line : null,
            symbol: method !== null && owner !== null && method.startsWith(`${owner}:`) ? method.slice(owner.length + 1) : method,
            how: typeof r.access === "string" ? r.access : side === "readers" ? "read" : "write",
            conf: typeof r.confidence === "string" ? r.confidence : null,
            origin: "stateAtlas",
          });
        }
      }
    }
    return out;
  }

  readers(source, name, options) {
    return this.stateAccess(source, name, options).readers;
  }

  writers(source, name, options) {
    return this.stateAccess(source, name, options).writers;
  }

  states(source) {
    const table = this._tables.get(source);
    if (!table) return [];
    const out = [];
    for (const cls of table.classes) for (const s of cls.states) out.push({ class: cls.name, name: s.name, line: s.line });
    return out;
  }

  externalDependencies() {
    return this.doc.externalDependencies;
  }

  // Wer im Projekt zeigt auf dieses externe Ziel (Verweise und Grenzleitungen)?
  externalUsers(path) {
    return { references: this._refsExternal.get(path) || [], connections: this._externalEnds.get(path) || [] };
  }

  // ---------------------------------------------------------------- Suche
  // Treffer {kind, rel, line, text, revisionId} (+ par/symbol/cut). kinds: name path method code parameter table.
  // limits: {maxWildcards, literalAbove, literalTexts} - literalTexts = so viele Texte ueber literalAbove wurden nur
  // woertlich durchsucht (ohne Wortgrenzen); die Ansicht nennt das neben "x Quellen nicht durchsuchbar".
  search(query, options = {}) {
    const text = typeof query === "string" ? query : "";
    const asked = Number(options.maxResults);
    const limit = Math.max(1, Math.min(SEARCH_LIMITS.maxResults, Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : SEARCH_LIMITS.defaultResults));
    const counts = { name: 0, path: 0, method: 0, code: 0, parameter: 0, table: 0 };
    const limits = { maxWildcards: SEARCH_LIMITS.maxWildcards, literalAbove: SEARCH_LIMITS.literalAbove, literalTexts: 0 };
    const base = { query: text, hits: [], counts, total: 0, limit, limits, revisionId: this.revisionId, unsearchable: this.unsearchable };
    if (!text.trim()) return { ...base, error: "empty" };
    if (text.length > SEARCH_LIMITS.maxQuery) return { ...base, error: "too-long", message: "Suchtext zu lang: höchstens 512 Zeichen." };
    const caseSensitive = Boolean(options.caseSensitive);
    const lineSearch = compileSearch(text, { caseSensitive, whole: true });
    const nameSearch = compileSearch(text, { caseSensitive, whole: false });
    if (!lineSearch || !nameSearch) return { ...base, error: "empty" };
    if (lineSearch.error || nameSearch.error) {
      return { ...base, error: "wildcards", message: `Höchstens ${SEARCH_LIMITS.maxWildcards} * je Suchbegriff.` };
    }
    const lineMatch = lineSearch.match;
    const nameMatch = nameSearch.match;
    const wanted = new Set((Array.isArray(options.kinds) ? options.kinds : DEFAULT_KINDS).filter((k) => SEARCH_KINDS.includes(k)));
    const groups = new Map(SEARCH_KINDS.map((k) => [k, []]));
    const revisionId = this.revisionId;
    if (wanted.has("name") || wanted.has("path")) {
      for (const r of this._opRows) {
        if (wanted.has("name") && nameMatch(r.match)) {
          groups.get("name").push({ kind: "name", rel: r.o.rel, line: null, text: `${r.o.name} (${r.o.opType})`, revisionId });
        } else if (wanted.has("path") && nameMatch(r.path)) {
          groups.get("path").push({ kind: "path", rel: r.o.rel, line: null, text: this.abs(r.o.rel), revisionId });
        }
      }
    }
    if (wanted.has("method")) {
      for (const r of this._symbolRows) {
        if (nameMatch(r.match)) {
          groups.get("method").push({ kind: "method", rel: r.key, line: r.s.line, text: `${r.s.symbol}(${r.s.params.join(", ")})`, symbol: r.s.symbol, revisionId });
        }
      }
    }
    if (wanted.has("code")) {
      for (const r of this._codeRows) {
        if (lineMatch(r.text)) groups.get("code").push(r);
      }
    }
    if (wanted.has("parameter")) {
      for (const r of this._parRows) {
        if (nameMatch(r.match)) {
          const shown = describeValue(r.p.value);
          const value = shown.kind === "value" ? shown.text : `(${shown.kind}: ${shown.reason})`;
          groups.get("parameter").push({ kind: "parameter", rel: r.p.op, line: null, text: `${r.p.name} = ${value}`, par: r.p.name, revisionId });
        }
      }
    }
    if (wanted.has("table")) {
      for (const r of this._tableRows) if (nameMatch(r.text)) groups.get("table").push(r);
    }
    const hits = [];
    let total = 0;
    for (const kind of SEARCH_KINDS) {
      const list = groups.get(kind);
      counts[kind] = list.length;
      total += list.length;
      const cap = kind === "code" || wanted.size === 1 ? limit : SEARCH_LIMITS.sectionMax;
      for (const item of list.slice(0, cap)) {
        if (hits.length >= limit) break;
        if (kind === "code" || kind === "table") {
          const shown = preview(item.text);
          hits.push({ kind, rel: item.key, line: item.line, text: shown.text, cut: shown.cut, revisionId });
        } else {
          hits.push(item);
        }
      }
    }
    limits.literalTexts = lineSearch.state.literalTexts + nameSearch.state.literalTexts;
    return { ...base, hits, total };
  }
}
