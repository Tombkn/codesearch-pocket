// Schema-, Grenzen- und Konsistenzpruefung fuer "codesearch.pocket.snapshot" v1 (Vertrag Abschnitte 4, 9, 14, 16).
// Regel fuer Regel portiert aus td-codesearch src/cs_pocket_export.py (_Checker, _check_*, _check_consistency,
// _counts, _entry_errors): Vertrag 16 verlangt, dass Python und JS dieselben Pakete annehmen. Eigene Lockerungen
// haben echte Exporter-Pakete abgelehnt (Extension-COMPs, dynamische Verweise, Platzhalter) - darum keine mehr.
// JS geht nur dort weiter, wo der Vertrag es woertlich verlangt: Op-Tiefe <= 64 (Vertrag 9) und ASCII-Schluessel
// (Vertrag 4). Bei Warnungen werden wie im Vertrag 16 nur Code und Schwere geprueft, nie der Meldungstext.
// Rein: bekommt ein bereits strikt geparstes Dokument (verify.js). Fehler {code, path, category}: code =
// "<kategorie>.<detail>", path = JSON Pointer (RFC 6901). Nie Werte aus dem Paket (Vertrag 4.15/8).

import { CanonicalError, canonicalize, codepointLength, lineCount } from "./c14n.js";

export const SNAPSHOT_FORMAT = "codesearch.pocket.snapshot";
export const SCHEMA_VERSION = 1;
export const KNOWN_MINOR = 0;

// Vertrag 16: jeder Fehlercode gehoert zu genau einer Kategorie; sie steht als Praefix im Code.
export const CATEGORIES = Object.freeze(["encoding", "json", "canonical", "integrity", "schema", "limit", "consistency",
  "binding"]);

export function categoryOf(code) {
  const prefix = typeof code === "string" ? code.slice(0, code.indexOf(".")) : "";
  return CATEGORIES.includes(prefix) ? prefix : null;
}

// Vertrag 9 (Zeichen = Unicode-Codepoints, nie UTF-16-Einheiten).
export const LIMITS = Object.freeze({
  operators: 20000,
  annotations: 5000,
  connections: 100000,
  parameters: 300000,
  references: 300000,
  codeSources: 10000,
  textPerSource: 4194304,
  textTotal: 25165824,
  tableCells: 100000,
  tableCellChars: 65536,
  nameChars: 1024,
  pathDepth: 64,
  valueChars: 65536,
  jsonDepth: 32,
  referenceText: 200,
  projectName: 120,
  selected: 64,
  maxErrors: 200,
  maxIgnored: 1000,
});

const NAME = LIMITS.nameChars;
const VALUE = LIMITS.valueChars;
// Vertrag 4.7 (cs_pocket_export.HELPER_TAG, ANNOTATE_OPTYPE): ein COMP mit diesem Tag und alles darin hat role
// "helper"; Annotationen (opType annotateCOMP) und ihr Innenleben sind nie Operatoren.
const HELPER_TAG = "ExtUtils";
const ANNOTATE_OPTYPE = "annotateCOMP";

export const ENUMS = Object.freeze({
  families: ["COMP", "TOP", "CHOP", "SOP", "DAT", "MAT", "POP"],
  roles: ["op", "helper"],
  entry: ["comp-menu", "row-menu", "command"],
  consistency: ["stable-2pass", "retried", "changed"],
  connectionKinds: ["wire", "comp"],
  languages: ["python", "glsl", "text", "json", "xml", "yaml", "table", "unknown"],
  languageFrom: ["par", "role", "guess"],
  sourceRoles: ["extension", "callbacks", "glsl", "execute", "module"],
  statuses: ["exact", "truncated", "omitted-secret", "omitted-size", "omitted-type", "derived-not-read",
    "unreadable", "excluded-user", "invalid-unicode"],
  modes: ["constant", "expression", "export", "bind"],
  valueTypes: ["str", "int", "float", "bool", "menu", "op", "pulse", "other"],
  unknownReasons: ["mode-expression", "mode-bind", "mode-export", "size"],
  // Par-artige Felder (Shortcuts, Ext-Objekte, Annotationen): {unknown:<Modus>, expr} bzw. {unknown:"size"}.
  modeReasons: ["mode-expression", "mode-bind", "mode-export"],
  omitted: ["secret", "size"],
  referenceKinds: ["code-op", "code-shortcut", "code-parent", "code-iop", "code-module", "par-expr", "par-bind",
    "par-export", "par-op", "par-watch", "ext-object", "callbacks", "glsl", "dock"],
  // externalDependencies.kinds: Verweisarten und Leitungsarten, sortiert (cs_pocket_export.DEPENDENCY_KINDS).
  dependencyKinds: ["callbacks", "code-iop", "code-module", "code-op", "code-parent", "code-shortcut", "comp", "dock",
    "ext-object", "glsl", "par-bind", "par-export", "par-expr", "par-op", "par-watch", "wire"],
  unresolved: ["dynamic", "not-found", "pattern", "mode-expression", "error"],
  certainty: ["captured", "static", "unknown"],
  codeArt: ["call", "short", "parent"],
  severity: ["info", "warning", "error"],
  symbolKinds: ["method", "property", "function"],
  siteTypes: ["call", "run", "dispatch"],
  accessHow: ["init", "read", "write", "mutate"],
  flags: ["bypass", "lock", "display", "render", "viewer", "expose", "allowCooking", "showDocked"],
  // Regel-IDs von cspocket-secrets-1 (cs_pocket_export.SECRET_RULE_IDS; der Vertrag nennt nur die Muster).
  secretRules: ["ghp", "github-pat", "gh-token", "sk-key", "slack-token", "aws-key", "pem-private-key", "jwt", "bearer",
    "url-credentials", "url-query", "par-password", "op-type-par", "par-name"],
});

export const SECRET_RULESET = "cspocket-secrets-1";

// Vertrag 4.15: geschlossene Liste v1.0 (Code -> Schwere). Pocket zeigt nie den Meldungstext aus dem Paket.
export const WARNING_SEVERITY = Object.freeze({
  "capture.changed": "warning",
  "capture.retried": "info",
  "capture.long-frames": "info",
  "root.slash": "warning",
  "package.large": "warning",
  "package.pocket-limit": "warning",
  "operator.name-length": "warning",
  "operator.depth": "warning",
  "operator.secret-name": "warning",
  "annotation.omitted": "warning",
  "value.size": "warning",
  "source.size": "warning",
  "source.truncated": "warning",
  "source.invalid-unicode": "warning",
  "secret.source": "warning",
  "secret.value": "warning",
  "analysis.skipped-size": "info",
  "analysis.schema": "warning",
  "analysis.parse": "info",
});
const WARNINGS = new Map(Object.entries(WARNING_SEVERITY));

const CAPABILITY_KEYS = ["positions", "annotations", "wires", "compConnectors", "docks", "customPars", "builtinPars",
  "effectiveValues", "codeText", "tables", "analysis", "references", "storage", "channels", "media"];
const CONTENT_KEYS = ["exportRoot", "capabilities", "operators", "annotations", "connections", "codeSources",
  "parameters", "references", "externalDependencies"];
const COUNT_KEYS = ["operators", "comps", "annotations", "connections", "codeSources", "codeChars", "parameters",
  "references", "external", "duplicates"];

const RE = Object.freeze({
  projectId: /^psp_[0-9a-f]{32}$/,
  revisionId: /^rev_[0-9a-f]{32}$/,
  hash: /^sha256:[0-9a-f]{64}$/,
  hex64: /^[0-9a-f]{64}$/,
  // Nur fuer Notizanker (anchors.js): dort darf ein alter Anker auch die Form mit Praefix tragen.
  sourceSha: /^(?:sha256:)?[0-9a-f]{64}$/,
  opType: /^[a-z][A-Za-z0-9]*$/,
  absPath: /^\/$|^(?:\/[^/]+)+$/,
  stamp: /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/,
  int: /^-?(?:0|[1-9][0-9]*)$/,
  // Python repr(float): 4.0, -0.0, 1e-05, 1.5e+300, inf, -inf, nan
  float: /^(?:-?(?:[0-9]+\.[0-9]+(?:e[+-][0-9]+)?|[0-9]+e[+-][0-9]+|inf)|nan)$/,
  // Zaehler- und Grundschluessel (node.unknown, omissions): nie Pfade, nie Inhalte.
  ident: /^[a-z][a-z0-9-]{0,63}$/,
  signature: /^[A-Za-z0-9:._-]{1,200}$/,
  ascii: /^[\x00-\x7f]*$/,
});

export const PATTERNS = RE;

// ------------------------------------------------------------------ Pfade (Vertrag 14, eine Formel fuer alle)

// abs(rel) = rel=="" ? Root : (Root=="/" ? "/"+rel : Root+"/"+rel)
export function absPath(root, rel) {
  if (rel === "") return root;
  return root === "/" ? `/${rel}` : `${root}/${rel}`;
}

// Umkehrung; null = liegt ausserhalb des exportierten Teilbaums.
export function relPath(root, path) {
  if (typeof path !== "string") return null;
  if (path === root) return "";
  if (root === "/") return path.startsWith("/") && path.length > 1 ? path.slice(1) : null;
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
}

export function opDepth(rel) {
  if (rel === "") return 0;
  let depth = 1;
  for (let i = 0; i < rel.length; i += 1) if (rel.charCodeAt(i) === 47) depth += 1;
  return depth;
}

// JSON Pointer wie cs_pocket_export._pointer: "~" -> "~0", "/" -> "~1".
export function pointer(path, key) {
  const text = String(key);
  if (!text.includes("~") && !text.includes("/")) return `${path}/${text}`;
  return `${path}/${text.replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

// ------------------------------------------------------------------ Sortierung (Vertrag 4.17)
// Schluessel als Tupel. Rang je Teilschluessel: null < bool < Ganzzahl < String < Objekt/Liste; Zahlen numerisch,
// Strings nach UTF-16-Codeeinheiten, Objekte (Enden {op}/{external}/{unresolved}, roles) ueber ihre c14n-Form.
// Gleiche Regel wie cs_pocket_export._part und die gemeinsamen sort-cases.json.

// Objekt-Teilschluessel: c14n-Text einmal je Eintrag berechnen, nicht bei jedem Vergleich.
class ObjectKey {
  constructor(value) {
    try {
      this.text = canonicalize(value);
    } catch (error) {
      if (!(error instanceof CanonicalError)) throw error;
      // Formfehler meldet die Schemapruefung selbst; hier nur stabil vergleichen.
      this.text = "";
      this.error = error.code;
    }
  }
}

export function objectKey(value) {
  return new ObjectKey(value);
}

function scalarRank(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "boolean") return 1;
  if (typeof value === "number") return 2;
  if (typeof value === "string") return 3;
  return 4;
}

function compareScalar(a, b) {
  if (a === b) return 0;
  const ra = scalarRank(a);
  const rb = scalarRank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 1 || ra === 2 || ra === 3) return a < b ? -1 : a > b ? 1 : 0;
  if (ra === 4) {
    const ta = a instanceof ObjectKey ? a.text : new ObjectKey(a).text;
    const tb = b instanceof ObjectKey ? b.text : new ObjectKey(b).text;
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  }
  return 0;
}

export function compareTuples(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (i >= a.length) return -1;
    if (i >= b.length) return 1;
    const r = compareScalar(a[i], b[i]);
    if (r) return r;
  }
  return 0;
}

const from = (r) => (isRecord(r.from) ? r.from : {});

export const SORT_KEYS = Object.freeze({
  operators: (o) => [opDepth(typeof o.rel === "string" ? o.rel : ""), o.rel],
  annotations: (a) => [a.parent, a.rel],
  connections: (c) => [objectKey(c.to), c.toIndex, c.kind, objectKey(c.from), c.fromIndex],
  codeSources: (s) => [s.key],
  parameters: (p) => [p.op, p.name],
  references: (r) => [from(r).op, from(r).source, from(r).line, from(r).par, r.kind, r.text ?? null, objectKey(r.target)],
  externalDependencies: (d) => [d.path],
  warnings: (w) => [w.code, w.op, w.source],
  analysisCode: (e) => [e.source],
  // innere Listen "nach ihrem Schluessel" (Vertrag 4.17)
  slot: (e) => [e.slot],
  index: (e) => [e.index],
  role: (r) => [objectKey(r)],
  omission: (o) => [o.what, o.reason],
  byRule: (b) => [b.rule],
  text: (s) => [s],
});

function sortBy(list, keyOf, tiebreak = false) {
  const keyed = list.map((item) => [keyOf(item), item, tiebreak ? objectKey(item).text : ""]);
  keyed.sort((a, b) => compareTuples(a[0], b[0]) || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));
  for (let i = 0; i < keyed.length; i += 1) list[i] = keyed[i][1];
  return list;
}

// Fuer Paketbauer (Tests, spaetere Werkzeuge): alle Listen in Vertragsreihenfolge bringen. Leitungen und Verweise
// duerfen gleiche Schluessel haben; dort entscheidet wie im Python-Paketbau die c14n-Form (Hash-Stabilitaet).
export function sortPackageLists(doc) {
  const each = (list, fn) => (Array.isArray(list) ? list.forEach(fn) : undefined);
  for (const name of ["operators", "annotations", "codeSources", "parameters", "externalDependencies", "warnings"]) {
    if (Array.isArray(doc[name])) sortBy(doc[name], SORT_KEYS[name]);
  }
  for (const name of ["connections", "references"]) if (Array.isArray(doc[name])) sortBy(doc[name], SORT_KEYS[name], true);
  if (isRecord(doc.analysis) && Array.isArray(doc.analysis.code)) sortBy(doc.analysis.code, SORT_KEYS.analysisCode);
  if (isRecord(doc.context) && isRecord(doc.context.selection) && Array.isArray(doc.context.selection.selected)) {
    sortBy(doc.context.selection.selected, SORT_KEYS.text);
  }
  each(doc.operators, (o) => {
    if (Array.isArray(o.tags)) sortBy(o.tags, SORT_KEYS.text);
    if (Array.isArray(o.extensions)) sortBy(o.extensions, SORT_KEYS.slot);
    if (Array.isArray(o.internalShortcuts)) sortBy(o.internalShortcuts, SORT_KEYS.slot);
    if (isRecord(o.connectors)) for (const side of ["in", "out"]) if (Array.isArray(o.connectors[side])) sortBy(o.connectors[side], SORT_KEYS.index);
  });
  each(doc.annotations, (a) => (Array.isArray(a.enclosed) ? sortBy(a.enclosed, SORT_KEYS.text) : undefined));
  each(doc.codeSources, (s) => (Array.isArray(s.roles) ? sortBy(s.roles, SORT_KEYS.role) : undefined));
  each(doc.externalDependencies, (d) => (Array.isArray(d.kinds) ? sortBy(d.kinds, SORT_KEYS.text) : undefined));
  if (isRecord(doc.report)) {
    if (Array.isArray(doc.report.omissions)) sortBy(doc.report.omissions, SORT_KEYS.omission);
    if (isRecord(doc.report.secrets) && Array.isArray(doc.report.secrets.byRule)) sortBy(doc.report.secrets.byRule, SORT_KEYS.byRule);
  }
  return doc;
}

// report.counts aus dem Paket (cs_pocket_export._counts). codeChars zaehlt Text- und Tabellenzeichen der
// uebertragenen Quellen (exact, truncated); duplicates = Quellen mit duplicateOf.
export function packageCounts(doc) {
  const sources = doc.codeSources;
  let codeChars = 0;
  let duplicates = 0;
  for (const s of sources) {
    if ((s.status === "exact" || s.status === "truncated") && Number.isSafeInteger(s.chars)) codeChars += s.chars;
    if (s.duplicateOf !== null) duplicates += 1;
  }
  return {
    operators: doc.operators.length,
    comps: doc.operators.filter((o) => o.isCOMP === true).length,
    annotations: doc.annotations.length,
    connections: doc.connections.length,
    codeSources: sources.length,
    codeChars,
    parameters: doc.parameters.length,
    references: doc.references.length,
    external: doc.externalDependencies.length,
    duplicates,
  };
}

// ------------------------------------------------------------------ Hilfen

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function setOf(list) {
  return new Set(list);
}

// Python "value != []": nur eine leere Liste ist leer (null, {}, "" nicht).
function isEmptyList(value) {
  return Array.isArray(value) && value.length === 0;
}

// Vertrag 4.7 (cs_pocket_export._expected_role): "helper" fuer einen COMP mit Tag ExtUtils und alles darin - rel
// selbst oder ein Vorfahr, auch der Root ("") -, sonst "op". ops: rel -> Operator (bei doppeltem rel der letzte).
function expectedRole(rel, ops) {
  const parts = rel === "" ? [] : rel.split("/");
  for (let count = 0; count <= parts.length; count += 1) {
    const holder = ops.get(parts.slice(0, count).join("/"));
    if (isRecord(holder) && holder.isCOMP === true && Array.isArray(holder.tags) && holder.tags.includes(HELPER_TAG)) return "helper";
  }
  return "op";
}

// Python datetime.strptime('%Y-%m-%dT%H:%M:%SZ'): Sekunde 60 und Kalenderfehler sind ungueltig.
export function isUtcStamp(text) {
  if (typeof text !== "string") return false;
  const m = RE.stamp.exec(text);
  if (!m) return false;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= days;
}

// Laenger als max Codepoints? length (UTF-16) >= Codepoints >= length/2: nur im Zweifel genau zaehlen.
function tooLong(text, max) {
  if (text.length <= max) return false;
  if (text.length > max * 2) return true;
  return codepointLength(text) > max;
}

// Port von cs_pocket_export._Checker: sammelt {code, path, category}; unbekannte Felder kommen nach "ignored"
// (Vertrag 4.1: gleiche Hauptversion -> ignorieren und im Importbericht nennen).
class Checker {
  constructor(maxErrors = LIMITS.maxErrors) {
    this.errors = [];
    this.ignored = [];
    this.maxErrors = maxErrors;
    this.truncated = false;
  }

  err(code, path) {
    if (this.errors.length < this.maxErrors) this.errors.push({ code, path, category: categoryOf(code) });
    else this.truncated = true;
    return false;
  }

  note(path) {
    if (this.ignored.length < LIMITS.maxIgnored) this.ignored.push(path);
  }

  // Pflichtfelder fehlen -> false. Schluessel muessen ASCII sein (Vertrag 4); der Pfad nennt dann nur das Objekt,
  // damit kein beliebig langer Fremdschluessel in Meldungen landet.
  obj(value, path, required, optional) {
    if (!isRecord(value)) return this.err("schema.type", path);
    let complete = true;
    for (const key of required) {
      if (!Object.hasOwn(value, key)) {
        this.err("schema.missing", pointer(path, key));
        complete = false;
      }
    }
    for (const key of Object.keys(value)) {
      if (required.has(key) || (optional && optional.has(key))) continue;
      if (!RE.ascii.test(key)) this.err("schema.keys", path);
      else this.note(pointer(path, key));
    }
    return complete;
  }

  text(value, path, limit = NAME, nullable = false, minimum = 0) {
    if (value === null && nullable) return true;
    if (typeof value !== "string") return this.err("schema.type", path);
    if (tooLong(value, limit)) return this.err("limit.length", path);
    if (minimum > 0 && codepointLength(value) < minimum) return this.err("schema.value", path);
    return true;
  }

  enum(value, path, allowed, nullable = false) {
    if (value === null && nullable) return true;
    if (typeof value !== "string") return this.err("schema.type", path);
    if (!allowed.includes(value)) return this.err("schema.enum", path);
    return true;
  }

  pattern(value, path, regex, nullable = false) {
    if (value === null && nullable) return true;
    if (typeof value !== "string") return this.err("schema.type", path);
    if (!regex.test(value)) return this.err("schema.pattern", path);
    return true;
  }

  integer(value, path, minimum = null, nullable = false) {
    if (value === null && nullable) return true;
    if (!Number.isSafeInteger(value)) return this.err("schema.type", path);
    if (minimum !== null && value < minimum) return this.err("schema.value", path);
    return true;
  }

  boolean(value, path, nullable = false) {
    if (value === null && nullable) return true;
    if (typeof value !== "boolean") return this.err("schema.type", path);
    return true;
  }

  array(value, path, limit = null) {
    if (!Array.isArray(value)) return this.err("schema.type", path);
    if (limit !== null && value.length > limit) return this.err("limit.count", path);
    return true;
  }

  timestamp(value, path) {
    if (!this.pattern(value, path, RE.stamp)) return false;
    if (!isUtcStamp(value)) return this.err("schema.pattern", path);
    return true;
  }

  // Par-artige Felder (cs_pocket_export._Checker.maybe): {value} | {unknown:<Modus>, expr} | {unknown:"size"} |
  // {omitted:"secret"}; plain = der Wert selbst statt {value} (Annotationstexte, Farben). known = str|bool|color.
  maybe(value, path, known, nullable = false, plain = false) {
    if (value === null && nullable) return;
    if (plain && known === "str" && typeof value === "string") {
      this.text(value, path, VALUE);
      return;
    }
    if (plain && known === "color" && Array.isArray(value)) {
      this.color(value, path, 4);
      return;
    }
    if (!isRecord(value)) {
      this.err("schema.type", path);
      return;
    }
    if (Object.hasOwn(value, "omitted")) {
      if (this.obj(value, path, F.omittedOnly)) this.enum(value.omitted, `${path}/omitted`, ["secret"]);
      return;
    }
    if (Object.hasOwn(value, "unknown")) {
      if (value.unknown === "size") {
        this.obj(value, path, F.unknownOnly);
        return;
      }
      if (this.obj(value, path, F.unknownExpr)) {
        this.enum(value.unknown, `${path}/unknown`, ENUMS.modeReasons);
        this.text(value.expr, `${path}/expr`, VALUE, true);
      }
      return;
    }
    if (plain) {
      this.err("schema.type", path);
      return;
    }
    if (!this.obj(value, path, F.valueOnly)) return;
    if (known === "bool") this.boolean(value.value, `${path}/value`);
    else this.text(value.value, `${path}/value`, VALUE);
  }

  // Farbe: genau size Gleitkomma-Texte (Vertrag 4: Floats nur als Zeichenkette, repr in Python).
  color(value, path, size) {
    if (!this.array(value, path) || value.length !== size) {
      if (Array.isArray(value)) this.err("schema.value", path);
      return;
    }
    value.forEach((part, i) => this.pattern(part, `${path}/${i}`, RE.float));
  }

  // Reihenfolge einer Liste (Vertrag 4.17); strict = keine Gleichstaende. Wie in Python: der erste Verstoss
  // genuegt, Formfehler meldet die Schemapruefung.
  order(items, keyOf, path, strict = false) {
    let previous = null;
    for (let i = 0; i < items.length; i += 1) {
      const current = keyOf(items[i]);
      if (previous !== null) {
        const r = compareTuples(current, previous);
        if (r < 0 || (strict && r === 0)) {
          this.err("consistency.sort", `${path}/${i}`);
          return;
        }
      }
      previous = current;
    }
  }
}

const strKey = (item) => [typeof item === "string" ? item : objectKey(item)];
const fieldKey = (field) => (item) => [isRecord(item) ? item[field] ?? null : null];

// ------------------------------------------------------------------ Feldlisten

const F = {
  header: setOf(["format", "schemaVersion", "schemaMinor", "projectId", "revision", "projectName", "exportedAt", "source",
    "exportRoot", "context", "capture", "capabilities", "operators", "annotations", "connections", "codeSources",
    "parameters", "references", "externalDependencies", "analysis", "warnings", "report", "integrity"]),
  revision: setOf(["id", "contentHash", "analysisHash", "basedOnSeq"]),
  integrity: setOf(["algorithm", "canonicalization", "value"]),
  source: setOf(["tool", "toolVersion", "exporterVersion", "tdBuild", "tdVersion", "os", "projectFile"]),
  exportRoot: setOf(["path", "opType", "name", "explicitScopes"]),
  context: setOf(["selection", "frozenAt", "entry"]),
  selection: setOf(["network", "selected", "selectedCount", "current"]),
  capture: setOf(["startedAt", "finishedAt", "frames", "slices", "longFrames", "retries", "consistency", "signature"]),
  longFrames: setOf(["count", "maxMs"]),
  capabilities: setOf(CAPABILITY_KEYS),
  operator: setOf(["rel", "path", "name", "opType", "family", "parent", "isCOMP", "role", "node", "color", "comment",
    "tags", "flags", "dock", "children", "connectors", "extensions", "shortcuts", "internalShortcuts"]),
  nodeKnown: setOf(["x", "y", "w", "h"]),
  nodeUnknown: setOf(["unknown"]),
  connectors: setOf(["in", "out"]),
  connIn: setOf(["index", "inOP"]),
  connOut: setOf(["index", "outOP"]),
  extension: setOf(["slot", "object", "name", "promote"]),
  shortcuts: setOf(["parent", "global"]),
  internalShortcut: setOf(["slot", "shortcut", "op"]),
  omittedOnly: setOf(["omitted"]),
  unknownOnly: setOf(["unknown"]),
  unknownExpr: setOf(["unknown", "expr"]),
  valueOnly: setOf(["value"]),
  annotation: setOf(["rel", "parent", "name", "mode", "title", "body", "node", "color", "enclosed"]),
  connection: setOf(["kind", "from", "fromIndex", "to", "toIndex"]),
  codeSource: setOf(["key", "op", "datType", "language", "languageFrom", "roles", "status", "text", "table",
    "truncation", "chars", "lines", "sha256", "duplicateOf", "file"]),
  truncation: setOf(["rows", "cols", "keptRows", "keptCols"]),
  file: setOf(["value", "syncfile"]),
  fileOptional: setOf(["omitted"]),
  roleFields: new Map([
    ["extension", setOf(["kind", "comp", "slot"])],
    ["callbacks", setOf(["kind", "owner", "par"])],
    ["glsl", setOf(["kind", "owner", "par"])],
    ["execute", setOf(["kind", "subtype"])],
    ["module", setOf(["kind"])],
  ]),
  parameter: setOf(["op", "name", "label", "page", "custom", "style", "tuplet", "vecIndex", "mode", "value", "help",
    "storedConstant", "expr", "bindExpr", "export", "default", "isDefault", "readOnly", "password", "menu", "range",
    "effective"]),
  parameterOptional: setOf(["omitted"]),
  valueUnknown: setOf(["t", "reason"]),
  valueOmitted: setOf(["t", "v", "omitted"]),
  valueKnown: setOf(["t", "v"]),
  export: setOf(["op", "source"]),
  menu: setOf(["names", "labels"]),
  range: setOf(["min", "max", "clampMin", "clampMax", "normMin", "normMax"]),
  reference: setOf(["from", "kind", "text", "target", "certainty", "code"]),
  referenceFrom: setOf(["op", "source", "line", "par"]),
  referenceCode: setOf(["art", "receiver", "name"]),
  // Vertrag 4.12: nur bei dynamischem Ziel, dann beide.
  referenceCodeDynamic: setOf(["dynamic", "reason"]),
  dependency: setOf(["path", "opType", "kinds", "count", "included"]),
  analysis: setOf(["provenance", "code"]),
  provenance: setOf(["engine", "toolVersion", "static"]),
  analysisItem: setOf(["source", "entry"]),
  warning: setOf(["code", "severity", "message", "op", "source", "count"]),
  report: setOf(["counts", "omissions", "secrets", "limits", "durationMs"]),
  counts: setOf(COUNT_KEYS),
  omission: setOf(["what", "count", "reason"]),
  secrets: setOf(["rules", "omittedSources", "omittedValues", "byRule", "confirmedFalsePositives"]),
  byRule: setOf(["rule", "count"]),
};

// ------------------------------------------------------------------ Kopf

function checkHeader(c, doc) {
  c.pattern(doc.projectId, "/projectId", RE.projectId);
  const revision = doc.revision;
  if (c.obj(revision, "/revision", F.revision)) {
    c.pattern(revision.id, "/revision/id", RE.revisionId);
    c.pattern(revision.contentHash, "/revision/contentHash", RE.hash);
    c.pattern(revision.analysisHash, "/revision/analysisHash", RE.hash);
    c.integer(revision.basedOnSeq, "/revision/basedOnSeq", 0);
  }
  c.integer(doc.schemaMinor, "/schemaMinor", 0);
  c.text(doc.projectName, "/projectName", LIMITS.projectName, false, 1);
  c.timestamp(doc.exportedAt, "/exportedAt");
  const source = doc.source;
  if (c.obj(source, "/source", F.source)) {
    if (source.tool !== "CodeSearch") c.err("schema.value", "/source/tool");
    for (const field of ["toolVersion", "tdBuild", "tdVersion", "os"]) c.text(source[field], `/source/${field}`);
    c.integer(source.exporterVersion, "/source/exporterVersion", 1);
    // Basisname der .toe, nie ein Ordnerpfad (Vertrag 4.3: Ordnernamen koennen Benutzernamen tragen).
    if (c.text(source.projectFile, "/source/projectFile") && /[\\/]/.test(source.projectFile)) {
      c.err("schema.value", "/source/projectFile");
    }
  }
  const root = doc.exportRoot;
  if (c.obj(root, "/exportRoot", F.exportRoot)) {
    if (c.text(root.path, "/exportRoot/path") && !root.path.startsWith("/")) c.err("schema.value", "/exportRoot/path");
    c.pattern(root.opType, "/exportRoot/opType", RE.opType);
    c.text(root.name, "/exportRoot/name");
    // explicitScopes bleibt in v1 leer (Vertrag 4.4).
    if (c.array(root.explicitScopes, "/exportRoot/explicitScopes") && root.explicitScopes.length) {
      c.err("schema.value", "/exportRoot/explicitScopes");
    }
  }
  const context = doc.context;
  if (c.obj(context, "/context", F.context)) {
    const selection = context.selection;
    if (selection !== null && c.obj(selection, "/context/selection", F.selection)) {
      c.text(selection.network, "/context/selection/network", NAME, true);
      if (c.array(selection.selected, "/context/selection/selected", LIMITS.selected)) {
        selection.selected.forEach((item, i) => c.text(item, `/context/selection/selected/${i}`));
        c.order(selection.selected, strKey, "/context/selection/selected");
      }
      c.integer(selection.selectedCount, "/context/selection/selectedCount", 0);
      c.text(selection.current, "/context/selection/current", NAME, true);
    }
    c.timestamp(context.frozenAt, "/context/frozenAt");
    c.enum(context.entry, "/context/entry", ENUMS.entry);
  }
  const capture = doc.capture;
  if (c.obj(capture, "/capture", F.capture)) {
    c.timestamp(capture.startedAt, "/capture/startedAt");
    c.timestamp(capture.finishedAt, "/capture/finishedAt");
    for (const field of ["frames", "slices", "retries"]) c.integer(capture[field], `/capture/${field}`, 0);
    if (c.obj(capture.longFrames, "/capture/longFrames", F.longFrames)) {
      c.integer(capture.longFrames.count, "/capture/longFrames/count", 0);
      c.integer(capture.longFrames.maxMs, "/capture/longFrames/maxMs", 0);
    }
    c.enum(capture.consistency, "/capture/consistency", ENUMS.consistency);
    c.pattern(capture.signature, "/capture/signature", RE.signature);
  }
  const capabilities = doc.capabilities;
  if (c.obj(capabilities, "/capabilities", F.capabilities)) {
    for (const key of CAPABILITY_KEYS) {
      if (typeof capabilities[key] !== "boolean" && typeof capabilities[key] !== "string") c.err("schema.type", `/capabilities/${key}`);
    }
  }
}

// ------------------------------------------------------------------ Einzelteile

// {op: rel} | {external: pfad} (Leitungsenden, Dock).
function checkEnd(c, value, path) {
  if (!isRecord(value) || Object.keys(value).length !== 1) {
    c.err("schema.type", path);
    return;
  }
  if (Object.hasOwn(value, "op")) c.text(value.op, `${path}/op`);
  else if (Object.hasOwn(value, "external")) {
    // Vertrag 4.9/4.12: ein externes Ende ist ein absoluter TD-Pfad (Leitung, Dock, Verweisziel).
    if (c.text(value.external, `${path}/external`) && !value.external.startsWith("/")) c.err("schema.pattern", `${path}/external`);
  } else c.err("schema.value", path);
}

// {unknown:"size"} | {omitted:"secret"} anstelle eines zu langen bzw. geheimen Textes (Vertrag 8/9).
function checkMarker(c, value, path) {
  if (isRecord(value) && Object.keys(value).length === 1) {
    if (value.unknown === "size" || value.omitted === "secret") return;
  }
  c.err("schema.type", path);
}

// Name eines Ops/einer Annotation unter dem Root: nicht leer, ohne "/" (TD erlaubt beides nicht; ein "/" im Namen
// machte rel mehrdeutig). Wie cs_pocket_export._valid_child_name.
function validChildName(name) {
  return name !== "" && !name.includes("/");
}

function checkOperator(c, o, path) {
  if (!c.obj(o, path, F.operator)) return;
  const [relOk, , nameOk] = ["rel", "path", "name"].map((field) => c.text(o[field], `${path}/${field}`));
  // Vertrag 9: Tiefe <= 64 (der Exporter laesst tiefere Ops aus; Pocket prueft dieselbe Grenze).
  if (relOk && opDepth(o.rel) > LIMITS.pathDepth) c.err("limit.depth", `${path}/rel`);
  if (relOk && nameOk && o.rel !== "" && !validChildName(o.name)) c.err("schema.pattern", `${path}/name`);
  c.pattern(o.opType, `${path}/opType`, RE.opType);
  // Vertrag 4.7: annotateCOMP ist nie ein Operator (die Annotation steht in annotations[]).
  if (o.opType === ANNOTATE_OPTYPE) c.err("schema.value", `${path}/opType`);
  c.enum(o.family, `${path}/family`, ENUMS.families);
  c.text(o.parent, `${path}/parent`, NAME, true);
  c.boolean(o.isCOMP, `${path}/isCOMP`);
  c.enum(o.role, `${path}/role`, ENUMS.roles);
  // Vertrag 4.7: children, connectors, extensions, internalShortcuts und flags.allowCooking gibt es nur an COMPs.
  // Wie Python ("isCOMP is False"): nur bei echtem false; ein Typfehler in isCOMP meldet nur sich selbst.
  if (o.isCOMP === false) {
    if (o.children !== null) c.err("schema.value", `${path}/children`);
    if (o.connectors !== null) c.err("schema.value", `${path}/connectors`);
    if (!isEmptyList(o.extensions)) c.err("schema.value", `${path}/extensions`);
    if (!isEmptyList(o.internalShortcuts)) c.err("schema.value", `${path}/internalShortcuts`);
    if (isRecord(o.flags) && Object.hasOwn(o.flags, "allowCooking")) c.err("schema.value", `${path}/flags/allowCooking`);
  }
  const node = o.node;
  if (isRecord(node) && Object.hasOwn(node, "unknown")) {
    if (c.obj(node, `${path}/node`, F.nodeUnknown)) c.pattern(node.unknown, `${path}/node/unknown`, RE.ident);
  } else if (c.obj(node, `${path}/node`, F.nodeKnown)) {
    for (const field of ["x", "y", "w", "h"]) c.integer(node[field], `${path}/node/${field}`);
  }
  // Vertrag 4.7: null = Farbe nicht lesbar; sonst genau drei Float-Texte (nie eine Liste mit Luecken).
  if (o.color !== null) c.color(o.color, `${path}/color`, 3);
  if (typeof o.comment === "string") c.text(o.comment, `${path}/comment`, VALUE);
  else checkMarker(c, o.comment, `${path}/comment`);
  if (c.array(o.tags, `${path}/tags`)) {
    o.tags.forEach((tag, i) => c.text(tag, `${path}/tags/${i}`));
    c.order(o.tags, strKey, `${path}/tags`);
  }
  const flags = o.flags;
  if (!isRecord(flags)) c.err("schema.type", `${path}/flags`);
  else {
    for (const key of Object.keys(flags)) {
      if (ENUMS.flags.includes(key)) c.boolean(flags[key], pointer(`${path}/flags`, key));
      else if (!RE.ascii.test(key)) c.err("schema.keys", `${path}/flags`);
      else c.note(pointer(`${path}/flags`, key));
    }
  }
  if (o.dock !== null) checkEnd(c, o.dock, `${path}/dock`);
  c.integer(o.children, `${path}/children`, 0, true);
  const connectors = o.connectors;
  if (connectors !== null && c.obj(connectors, `${path}/connectors`, F.connectors)) {
    for (const [side, field, keys] of [["in", "inOP", F.connIn], ["out", "outOP", F.connOut]]) {
      const items = connectors[side];
      const base = `${path}/connectors/${side}`;
      if (!c.array(items, base)) continue;
      items.forEach((item, i) => {
        if (!c.obj(item, `${base}/${i}`, keys)) return;
        c.integer(item.index, `${base}/${i}/index`, 0);
        c.text(item[field], `${base}/${i}/${field}`, NAME, true);
      });
      c.order(items, fieldKey("index"), base, true);
    }
  }
  if (c.array(o.extensions, `${path}/extensions`)) {
    o.extensions.forEach((item, i) => {
      const base = `${path}/extensions/${i}`;
      if (!c.obj(item, base, F.extension)) return;
      c.integer(item.slot, `${base}/slot`, 0);
      c.maybe(item.object, `${base}/object`, "str");
      c.maybe(item.name, `${base}/name`, "str");
      // promote ist ein Toggle: {value:true|false} (Exporter _known(..., 'bool')).
      c.maybe(item.promote, `${base}/promote`, "bool");
    });
    c.order(o.extensions, fieldKey("slot"), `${path}/extensions`, true);
  }
  const shortcuts = o.shortcuts;
  if (c.obj(shortcuts, `${path}/shortcuts`, F.shortcuts)) {
    c.maybe(shortcuts.parent, `${path}/shortcuts/parent`, "str", true);
    c.maybe(shortcuts.global, `${path}/shortcuts/global`, "str", true);
  }
  if (c.array(o.internalShortcuts, `${path}/internalShortcuts`)) {
    o.internalShortcuts.forEach((item, i) => {
      const base = `${path}/internalShortcuts/${i}`;
      if (!c.obj(item, base, F.internalShortcut)) return;
      c.integer(item.slot, `${base}/slot`, 0);
      c.text(item.shortcut, `${base}/shortcut`);
      c.maybe(item.op, `${base}/op`, "str");
    });
    c.order(o.internalShortcuts, fieldKey("slot"), `${path}/internalShortcuts`, true);
  }
}

function checkAnnotation(c, a, path) {
  if (!c.obj(a, path, F.annotation)) return;
  c.text(a.rel, `${path}/rel`);
  c.text(a.parent, `${path}/parent`);
  if (c.text(a.name, `${path}/name`) && !validChildName(a.name)) c.err("schema.pattern", `${path}/name`);
  // Wie Parameter gelesen (Vertrag 4.8): Text, {unknown, expr}, {unknown:"size"} oder {omitted:"secret"}.
  for (const field of ["mode", "title", "body"]) c.maybe(a[field], `${path}/${field}`, "str", false, true);
  if (c.obj(a.node, `${path}/node`, F.nodeKnown)) {
    for (const field of ["x", "y", "w", "h"]) c.integer(a.node[field], `${path}/node/${field}`);
  }
  c.maybe(a.color, `${path}/color`, "color", true, true);
  if (c.array(a.enclosed, `${path}/enclosed`)) {
    a.enclosed.forEach((rel, i) => c.text(rel, `${path}/enclosed/${i}`));
    c.order(a.enclosed, strKey, `${path}/enclosed`, true);
  }
}

function checkConnection(c, w, path) {
  if (!c.obj(w, path, F.connection)) return;
  c.enum(w.kind, `${path}/kind`, ENUMS.connectionKinds);
  checkEnd(c, w.from, `${path}/from`);
  checkEnd(c, w.to, `${path}/to`);
  c.integer(w.fromIndex, `${path}/fromIndex`, 0);
  c.integer(w.toIndex, `${path}/toIndex`, 0);
  // Vertrag 4.9: mindestens ein Ende liegt im Teilbaum - eine Leitung zwischen zwei externen Enden ist nie erfasst.
  const external = (end) => isRecord(end) && Object.hasOwn(end, "external");
  if (external(w.from) && external(w.to)) c.err("schema.value", path);
}

function checkSource(c, s, path, totals) {
  if (!c.obj(s, path, F.codeSource)) return;
  c.text(s.key, `${path}/key`);
  c.text(s.op, `${path}/op`);
  c.pattern(s.datType, `${path}/datType`, RE.opType);
  c.enum(s.language, `${path}/language`, ENUMS.languages);
  c.enum(s.languageFrom, `${path}/languageFrom`, ENUMS.languageFrom);
  if (c.array(s.roles, `${path}/roles`)) {
    let complete = true;
    s.roles.forEach((role, i) => {
      const base = `${path}/roles/${i}`;
      const kind = isRecord(role) ? role.kind : null;
      if (!c.enum(kind, `${base}/kind`, ENUMS.sourceRoles) || !c.obj(role, base, F.roleFields.get(kind))) {
        complete = false;
        return;
      }
      if (kind === "extension") {
        c.text(role.comp, `${base}/comp`);
        c.integer(role.slot, `${base}/slot`, 0);
      } else if (kind === "callbacks" || kind === "glsl") {
        c.text(role.owner, `${base}/owner`);
        c.text(role.par, `${base}/par`);
      } else if (kind === "execute") {
        c.text(role.subtype, `${base}/subtype`);
      }
    });
    if (complete) c.order(s.roles, (role) => [objectKey(role)], `${path}/roles`, true);
  }
  c.enum(s.status, `${path}/status`, ENUMS.statuses);
  c.text(s.text, `${path}/text`, LIMITS.textPerSource, true);
  if (typeof s.text === "string") totals.text += codepointLength(s.text);
  const table = s.table;
  if (table !== null && c.array(table, `${path}/table`)) {
    let cells = 0;
    table.forEach((row, r) => {
      if (!c.array(row, `${path}/table/${r}`)) return;
      row.forEach((cell, k) => {
        // Tabellenzellen zaehlen wie im Paketbau zum Gesamttext (Vertrag 9: Text gesamt).
        if (c.text(cell, `${path}/table/${r}/${k}`, LIMITS.tableCellChars)) totals.text += codepointLength(cell);
      });
      cells += row.length;
    });
    if (cells > LIMITS.tableCells) c.err("limit.count", `${path}/table`);
  }
  // Kuerzungsangabe heisst "truncation" (Exporter): Pflichtfeld, null ausser bei status "truncated".
  const truncation = s.truncation;
  if (truncation !== null && c.obj(truncation, `${path}/truncation`, F.truncation)) {
    for (const field of ["rows", "cols", "keptRows", "keptCols"]) c.integer(truncation[field], `${path}/truncation/${field}`, 0);
  }
  c.integer(s.chars, `${path}/chars`, 0, true);
  c.integer(s.lines, `${path}/lines`, 0, true);
  c.pattern(s.sha256, `${path}/sha256`, RE.hex64, true);
  c.text(s.duplicateOf, `${path}/duplicateOf`, NAME, true);
  const file = s.file;
  if (file !== null && c.obj(file, `${path}/file`, F.file, F.fileOptional)) {
    c.text(file.value, `${path}/file/value`, VALUE, true);
    c.boolean(file.syncfile, `${path}/file/syncfile`, true);
    if (Object.hasOwn(file, "omitted")) c.enum(file.omitted, `${path}/file/omitted`, ENUMS.omitted);
  }
}

// Gueltige Texte je Werttyp (Vertrag 4.11): bool "0"/"1", int dezimal, float repr, pulse "".
function valueGrammar(t, v) {
  if (t === "bool") return v === "0" || v === "1";
  if (t === "int") return RE.int.test(v);
  if (t === "float") return RE.float.test(v);
  if (t === "pulse") return v === "";
  return true;
}

// value/storedConstant/default: {t, v} | {t, v:null, omitted:"secret"} | {t:"unknown", reason}.
// allowKnown=false: bei anderem Modus traegt "value" nie einen Wert (consistency.mode).
function checkValue(c, value, path, allowKnown) {
  if (!isRecord(value)) {
    c.err("schema.type", path);
    return;
  }
  if (value.t === "unknown") {
    if (c.obj(value, path, F.valueUnknown)) c.enum(value.reason, `${path}/reason`, ENUMS.unknownReasons);
    return;
  }
  if (!allowKnown) {
    c.err("consistency.mode", path);
    return;
  }
  if (Object.hasOwn(value, "omitted")) {
    if (c.obj(value, path, F.valueOmitted)) {
      c.enum(value.t, `${path}/t`, ENUMS.valueTypes);
      if (value.v !== null) c.err("schema.value", `${path}/v`);
      c.enum(value.omitted, `${path}/omitted`, ["secret"]);
    }
    return;
  }
  if (!c.obj(value, path, F.valueKnown) || !c.enum(value.t, `${path}/t`, ENUMS.valueTypes)) return;
  if (c.text(value.v, `${path}/v`, VALUE) && !valueGrammar(value.t, value.v)) c.err("schema.value", `${path}/v`);
}

// null = kein unknown-Wert; sonst der Grund (auch undefined, wenn er fehlt - dann meldet Python zusaetzlich
// consistency.mode, und JS tut dasselbe).
const unknownReason = (value) => (isRecord(value) && value.t === "unknown" ? value.reason : null);

function checkParameter(c, p, path) {
  if (!c.obj(p, path, F.parameter, F.parameterOptional)) return;
  c.text(p.op, `${path}/op`);
  c.text(p.name, `${path}/name`);
  // Reihenfolge wie Python _check_parameter (label, page, custom, style, tuplet): bei zwei Fehlern im selben Parameter
  // entscheidet der erste ueber die Kategorie, und die muss in beiden Sprachen gleich sein (Vertrag 16, Befund kern-f3).
  for (const field of ["label", "page"]) c.text(p[field], `${path}/${field}`, NAME, true);
  c.boolean(p.custom, `${path}/custom`);
  for (const field of ["style", "tuplet"]) c.text(p[field], `${path}/${field}`, NAME, true);
  c.integer(p.vecIndex, `${path}/vecIndex`, 0);
  if (c.enum(p.mode, `${path}/mode`, ENUMS.modes)) {
    // 4.11: bei constant ist value bekannt (oder size/secret); sonst unknown mit dem Grund des Modus, und der
    // ruhende Constant-Wert steht nur in storedConstant (Pocket zeigt ihn nie als Wert).
    const constant = p.mode === "constant";
    checkValue(c, p.value, `${path}/value`, constant);
    const reason = unknownReason(p.value);
    if (reason !== null && reason !== "size" && (constant || reason !== `mode-${p.mode}`)) {
      c.err("consistency.mode", `${path}/value/reason`);
    }
    const stored = p.storedConstant;
    if (constant && stored !== null) c.err("consistency.mode", `${path}/storedConstant`);
    else if (stored !== null) {
      checkValue(c, stored, `${path}/storedConstant`, true);
      const storedReason = unknownReason(stored);
      if (storedReason !== null && storedReason !== "size") c.err("consistency.mode", `${path}/storedConstant/reason`);
    }
  }
  const custom = p.custom === true;
  c.text(p.help, `${path}/help`, VALUE, true);
  // Uebergrosse oder geheime Expressions: null plus "omitted" am Parameter (Vertrag 4.11/9).
  c.text(p.expr, `${path}/expr`, VALUE, true);
  c.text(p.bindExpr, `${path}/bindExpr`, VALUE, true);
  if (p.export !== null && c.obj(p.export, `${path}/export`, F.export)) {
    c.text(p.export.op, `${path}/export/op`, NAME, true);
    c.text(p.export.source, `${path}/export/source`, NAME, true);
  }
  if (p.default !== null) {
    // default nur bei Custom Pars (Vertrag 4.11).
    if (!custom) c.err("schema.value", `${path}/default`);
    else {
      checkValue(c, p.default, `${path}/default`, true);
      const defaultReason = unknownReason(p.default);
      if (defaultReason !== null && defaultReason !== "size") c.err("consistency.mode", `${path}/default/reason`);
    }
  }
  for (const field of ["isDefault", "readOnly", "password"]) c.boolean(p[field], `${path}/${field}`, true);
  if (p.menu !== null && c.obj(p.menu, `${path}/menu`, F.menu)) {
    for (const field of ["names", "labels"]) {
      if (c.array(p.menu[field], `${path}/menu/${field}`)) {
        p.menu[field].forEach((entry, i) => c.text(entry, `${path}/menu/${field}/${i}`, VALUE));
      }
    }
  }
  if (p.range !== null && c.obj(p.range, `${path}/range`, F.range)) {
    for (const field of ["min", "max", "normMin", "normMax"]) c.pattern(p.range[field], `${path}/range/${field}`, RE.float, true);
    for (const field of ["clampMin", "clampMax"]) c.boolean(p.range[field], `${path}/range/${field}`, true);
  }
  if (!custom) {
    for (const field of ["help", "menu", "range"]) if (p[field] !== null) c.err("schema.value", `${path}/${field}`);
  }
  // effective ist in v1 immer null (Vertrag 4.11).
  if (p.effective !== null) c.err("schema.value", `${path}/effective`);
  if (Object.hasOwn(p, "omitted")) c.enum(p.omitted, `${path}/omitted`, ENUMS.omitted);
}

function checkReference(c, r, path) {
  if (!c.obj(r, path, F.reference)) return;
  if (c.obj(r.from, `${path}/from`, F.referenceFrom)) {
    c.text(r.from.op, `${path}/from/op`);
    c.text(r.from.source, `${path}/from/source`, NAME, true);
    c.integer(r.from.line, `${path}/from/line`, 1, true);
    c.text(r.from.par, `${path}/from/par`, NAME, true);
  }
  const kindOk = c.enum(r.kind, `${path}/kind`, ENUMS.referenceKinds);
  // text "entfaellt" bei Geheimnis-Quellen (Vertrag 4.12): dann null.
  c.text(r.text, `${path}/text`, LIMITS.referenceText, true);
  const target = r.target;
  if (isRecord(target) && Object.hasOwn(target, "unresolved") && Object.keys(target).length === 1) {
    c.enum(target.unresolved, `${path}/target/unresolved`, ENUMS.unresolved);
  } else {
    checkEnd(c, target, `${path}/target`);
  }
  c.enum(r.certainty, `${path}/certainty`, ENUMS.certainty);
  // Vertrag 4.12: code bei code-* Pflicht (auch bei dynamischem Ziel: dann name "" plus dynamic/reason), bei allen
  // anderen Arten null. Wie cs_pocket_export._check_reference.
  const codeKind = kindOk && r.kind.startsWith("code-");
  if (r.code === null) {
    if (codeKind) c.err("schema.type", `${path}/code`);
  } else if (kindOk && !codeKind) {
    c.err("schema.value", `${path}/code`);
  } else if (c.obj(r.code, `${path}/code`, F.referenceCode, F.referenceCodeDynamic)) {
    c.enum(r.code.art, `${path}/code/art`, ENUMS.codeArt);
    c.text(r.code.receiver, `${path}/code/receiver`, VALUE, true);
    c.text(r.code.name, `${path}/code/name`, VALUE);
    if (Object.hasOwn(r.code, "dynamic") || Object.hasOwn(r.code, "reason")) checkDynamicCode(c, r, path);
  }
}

// Dynamisches Ziel (Vertrag 4.12): name "" plus dynamic:true und reason, beide zusammen; das Ziel ist dann nie
// aufgeloest. reason ist eine feste Vorlage der Analyse (nie Quelltext), hoechstens so lang wie ein Verweistext.
// Wie cs_pocket_export._check_dynamic_code.
function checkDynamicCode(c, r, path) {
  const base = `${path}/code`;
  for (const field of ["dynamic", "reason"]) {
    if (!Object.hasOwn(r.code, field)) {
      c.err("schema.missing", `${base}/${field}`);
      return;
    }
  }
  if (!c.boolean(r.code.dynamic, `${base}/dynamic`)) return;
  if (r.code.dynamic !== true) {
    c.err("schema.value", `${base}/dynamic`);
    return;
  }
  c.text(r.code.reason, `${base}/reason`, LIMITS.referenceText, false, 1);
  if (r.code.name !== "") c.err("schema.value", `${base}/name`);
  const target = r.target;
  const unresolvedDynamic = isRecord(target) && Object.keys(target).length === 1 && target.unresolved === "dynamic";
  if (!unresolvedDynamic || r.certainty !== "unknown") c.err("schema.value", `${base}/dynamic`);
}

function checkDependency(c, d, path) {
  if (!c.obj(d, path, F.dependency)) return;
  // Vertrag 4.13: externe Ziele sind absolute TD-Pfade.
  if (c.text(d.path, `${path}/path`) && !d.path.startsWith("/")) c.err("schema.pattern", `${path}/path`);
  c.pattern(d.opType, `${path}/opType`, RE.opType, true);
  if (c.array(d.kinds, `${path}/kinds`)) {
    d.kinds.forEach((kind, i) => c.enum(kind, `${path}/kinds/${i}`, ENUMS.dependencyKinds));
    c.order(d.kinds, strKey, `${path}/kinds`, true);
  }
  c.integer(d.count, `${path}/count`, 1);
  // Externe Ziele werden nie automatisch mitexportiert (Vertrag 4.13).
  if (d.included !== false) c.err("schema.value", `${path}/included`);
}

function checkAnalysis(c, analysis, entryErrors) {
  if (!c.obj(analysis, "/analysis", F.analysis)) return;
  const provenance = analysis.provenance;
  if (c.obj(provenance, "/analysis/provenance", F.provenance)) {
    c.text(provenance.engine, "/analysis/provenance/engine");
    c.text(provenance.toolVersion, "/analysis/provenance/toolVersion");
    if (provenance.static !== true) c.err("schema.value", "/analysis/provenance/static");
  }
  if (!c.array(analysis.code, "/analysis/code", LIMITS.codeSources)) return;
  analysis.code.forEach((item, i) => {
    const base = `/analysis/code/${i}`;
    if (!c.obj(item, base, F.analysisItem)) return;
    c.text(item.source, `${base}/source`);
    // Ein Eintrag, der sein Schema verletzt, macht das Paket NICHT ungueltig (Vertrag 4.14): Pocket zeigt ihn als
    // {error:"schema"}, die Quelle bleibt lesbar.
    const entry = validateEntry(item.entry);
    if (!entry.ok) entryErrors.push({ source: typeof item.source === "string" ? item.source : null, errors: entry.errors });
  });
}

// Vertrag 16: Code und Schwere pruefen, nicht den Meldungstext (den erzeugt nur der Exporter aus der Vorlage).
// Ein Code aus einer neueren Minor-Version ist unbekannt, aber kein Ablehnungsgrund (Vertrag 4.1).
function checkWarning(c, w, path, minor) {
  if (!c.obj(w, path, F.warning)) return;
  if (typeof w.code !== "string") {
    c.err("schema.type", `${path}/code`);
    return;
  }
  const severity = WARNINGS.get(w.code);
  if (severity === undefined) {
    if (!(Number.isSafeInteger(minor) && minor > KNOWN_MINOR)) {
      c.err("schema.enum", `${path}/code`);
      return;
    }
    c.note(`${path}/code`);
    c.enum(w.severity, `${path}/severity`, ENUMS.severity);
  } else if (w.severity !== severity) {
    c.err("consistency.warning", `${path}/severity`);
  }
  c.text(w.message, `${path}/message`, VALUE);
  c.text(w.op, `${path}/op`, NAME, true);
  c.text(w.source, `${path}/source`, NAME, true);
  c.integer(w.count, `${path}/count`, 1, true);
}

function checkReport(c, report) {
  if (!c.obj(report, "/report", F.report)) return;
  if (c.obj(report.counts, "/report/counts", F.counts)) {
    for (const field of COUNT_KEYS) c.integer(report.counts[field], `/report/counts/${field}`, 0);
  }
  if (c.array(report.omissions, "/report/omissions")) {
    let complete = true;
    report.omissions.forEach((item, i) => {
      const base = `/report/omissions/${i}`;
      if (!c.obj(item, base, F.omission)) {
        complete = false;
        return;
      }
      c.pattern(item.what, `${base}/what`, RE.ident);
      c.integer(item.count, `${base}/count`, 1);
      c.pattern(item.reason, `${base}/reason`, RE.ident);
    });
    if (complete) c.order(report.omissions, SORT_KEYS.omission, "/report/omissions", true);
  }
  const found = report.secrets;
  if (c.obj(found, "/report/secrets", F.secrets)) {
    if (found.rules !== SECRET_RULESET) c.err("schema.value", "/report/secrets/rules");
    for (const field of ["omittedSources", "omittedValues", "confirmedFalsePositives"]) {
      c.integer(found[field], `/report/secrets/${field}`, 0);
    }
    if (c.array(found.byRule, "/report/secrets/byRule")) {
      let complete = true;
      found.byRule.forEach((item, i) => {
        const base = `/report/secrets/byRule/${i}`;
        if (!c.obj(item, base, F.byRule)) {
          complete = false;
          return;
        }
        c.enum(item.rule, `${base}/rule`, ENUMS.secretRules);
        c.integer(item.count, `${base}/count`, 1);
      });
      if (complete) c.order(found.byRule, SORT_KEYS.byRule, "/report/secrets/byRule", true);
    }
  }
  const limits = report.limits;
  if (!isRecord(limits)) c.err("schema.type", "/report/limits");
  else {
    for (const key of Object.keys(limits)) {
      if (!RE.ascii.test(key)) c.err("schema.keys", "/report/limits");
      else c.integer(limits[key], pointer("/report/limits", key), 0);
    }
  }
  c.integer(report.durationMs, "/report/durationMs", 0);
}

function checkSchema(c, doc, entryErrors) {
  checkHeader(c, doc);
  const lists = [["operators", checkOperator], ["annotations", checkAnnotation], ["connections", checkConnection],
    ["parameters", checkParameter], ["references", checkReference]];
  for (const [field, checker] of lists) {
    if (c.array(doc[field], `/${field}`, LIMITS[field])) doc[field].forEach((item, i) => checker(c, item, `/${field}/${i}`));
  }
  const totals = { text: 0 };
  if (c.array(doc.codeSources, "/codeSources", LIMITS.codeSources)) {
    doc.codeSources.forEach((item, i) => checkSource(c, item, `/codeSources/${i}`, totals));
  }
  if (totals.text > LIMITS.textTotal) c.err("limit.total", "/codeSources");
  if (c.array(doc.externalDependencies, "/externalDependencies")) {
    doc.externalDependencies.forEach((item, i) => checkDependency(c, item, `/externalDependencies/${i}`));
  }
  checkAnalysis(c, doc.analysis, entryErrors);
  if (c.array(doc.warnings, "/warnings")) doc.warnings.forEach((item, i) => checkWarning(c, item, `/warnings/${i}`, doc.schemaMinor));
  checkReport(c, doc.report);
}

// ------------------------------------------------------------------ Konsistenz (nur nach fehlerfreiem Schema)

// status bestimmt, was da sein darf (Vertrag 4.10): Text/Tabelle/sha256 nur bei exact bzw. truncated. chars/lines
// werden nachgerechnet; sha256 rechnet verify.js asynchron nach (WebCrypto), Code consistency.sha256.
function checkSourceState(c, s, base) {
  const { status, text, table } = s;
  const digest = s.sha256;
  if (status === "exact") {
    if ((text === null) === (table === null) || digest === null || s.truncation !== null) {
      c.err("consistency.status", `${base}/status`);
      return;
    }
  } else if (status === "truncated") {
    if (text !== null || table === null || digest === null || s.truncation === null) {
      c.err("consistency.status", `${base}/status`);
      return;
    }
  } else {
    if (text !== null || table !== null || digest !== null || s.truncation !== null) c.err("consistency.status", `${base}/status`);
    return;
  }
  if (text !== null) {
    if (s.chars !== codepointLength(text) || s.lines !== lineCount(text)) c.err("consistency.chars", `${base}/chars`);
    return;
  }
  let chars = 0;
  for (const row of table) for (const cell of row) chars += codepointLength(cell);
  if (s.chars !== chars || s.lines !== table.length) c.err("consistency.chars", `${base}/chars`);
}

// Vertrag 16 (Root, parent, rel, path, Schluessel, Verweise auf exportierte Ops, Sortierung 4.17, report.counts).
// Verweis-Existenz auch fuer dock.op, connectors.*OP, Leitungsenden {op}, references.target.op, roles.comp/owner.
function checkConsistency(c, doc) {
  const root = doc.exportRoot;
  const ops = new Map();
  doc.operators.forEach((o, i) => {
    if (ops.has(o.rel)) c.err("consistency.duplicate", `/operators/${i}/rel`);
    ops.set(o.rel, o);
  });
  const roots = doc.operators.filter((o) => o.rel === "");
  if (roots.length !== 1 || roots[0].parent !== null || roots[0].isCOMP !== true || roots[0].path !== root.path
    || roots[0].name !== root.name || roots[0].opType !== root.opType) {
    c.err("consistency.root", "/operators");
  }
  doc.operators.forEach((o, i) => {
    const base = `/operators/${i}`;
    if (o.dock !== null && Object.hasOwn(o.dock, "op") && !ops.has(o.dock.op)) c.err("consistency.reference", `${base}/dock/op`);
    if (o.connectors !== null) {
      for (const [side, field] of [["in", "inOP"], ["out", "outOP"]]) {
        o.connectors[side].forEach((item, j) => {
          if (item[field] !== null && !ops.has(item[field])) c.err("consistency.reference", `${base}/connectors/${side}/${j}`);
        });
      }
    }
    // Vertrag 4.7: helper genau unter einem ExtUtils-COMP. Code schema.value (Kategorie schema) wie in Python, aber
    // an dieser Stelle der Konsistenzpruefung: erst die Verweise des Ops, dann role, dann parent/rel/path.
    if (o.role !== expectedRole(o.rel, ops)) c.err("schema.value", `${base}/role`);
    if (o.rel === "") return;
    const parent = o.parent === null ? undefined : ops.get(o.parent);
    if (!parent || parent.isCOMP !== true) {
      c.err("consistency.parent", `${base}/parent`);
      return;
    }
    if (o.rel !== (o.parent ? `${o.parent}/` : "") + o.name) c.err("consistency.rel", `${base}/rel`);
    if (o.path !== absPath(root.path, o.rel)) c.err("consistency.path", `${base}/path`);
  });
  c.order(doc.operators, SORT_KEYS.operators, "/operators", true);
  const annotationRels = new Set();
  doc.annotations.forEach((a, i) => {
    const base = `/annotations/${i}`;
    const parent = ops.get(a.parent);
    if (!parent || parent.isCOMP !== true) c.err("consistency.parent", `${base}/parent`);
    else if (a.rel !== (a.parent ? `${a.parent}/` : "") + a.name) c.err("consistency.rel", `${base}/rel`);
    if (annotationRels.has(a.rel) || ops.has(a.rel)) c.err("consistency.duplicate", `${base}/rel`);
    annotationRels.add(a.rel);
    a.enclosed.forEach((rel, j) => {
      if (!ops.has(rel)) c.err("consistency.reference", `${base}/enclosed/${j}`);
    });
  });
  c.order(doc.annotations, SORT_KEYS.annotations, "/annotations", true);
  doc.connections.forEach((w, i) => {
    for (const end of ["from", "to"]) {
      if (Object.hasOwn(w[end], "op") && !ops.has(w[end].op)) c.err("consistency.reference", `/connections/${i}/${end}/op`);
    }
  });
  c.order(doc.connections, SORT_KEYS.connections, "/connections");
  const sources = new Map();
  const firstBySha = new Map();
  doc.codeSources.forEach((s, i) => {
    const base = `/codeSources/${i}`;
    if (s.key !== s.op) c.err("consistency.key", `${base}/key`);
    if (!ops.has(s.op)) c.err("consistency.reference", `${base}/op`);
    if (sources.has(s.key)) c.err("consistency.duplicate", `${base}/key`);
    sources.set(s.key, s);
    checkSourceState(c, s, base);
    s.roles.forEach((role, j) => {
      for (const field of ["comp", "owner"]) {
        if (Object.hasOwn(role, field) && !ops.has(role[field])) c.err("consistency.reference", `${base}/roles/${j}/${field}`);
      }
    });
    // duplicateOf = key der ersten Quelle (nach key) mit gleichem sha256 (Vertrag 4.10).
    const digest = s.sha256;
    const expected = digest === null ? null : firstBySha.get(digest) ?? null;
    if (s.duplicateOf !== expected) c.err("consistency.duplicate-of", `${base}/duplicateOf`);
    if (digest !== null && !firstBySha.has(digest)) firstBySha.set(digest, s.key);
  });
  c.order(doc.codeSources, SORT_KEYS.codeSources, "/codeSources", true);
  doc.parameters.forEach((p, i) => {
    if (!ops.has(p.op)) c.err("consistency.reference", `/parameters/${i}/op`);
  });
  c.order(doc.parameters, SORT_KEYS.parameters, "/parameters", true);
  doc.references.forEach((r, i) => {
    const base = `/references/${i}`;
    if (!ops.has(r.from.op)) c.err("consistency.reference", `${base}/from/op`);
    if (Object.hasOwn(r.target, "op") && !ops.has(r.target.op)) c.err("consistency.reference", `${base}/target/op`);
  });
  c.order(doc.references, SORT_KEYS.references, "/references");
  c.order(doc.externalDependencies, SORT_KEYS.externalDependencies, "/externalDependencies", true);
  doc.analysis.code.forEach((item, i) => {
    if (!sources.has(item.source)) c.err("consistency.reference", `/analysis/code/${i}/source`);
  });
  c.order(doc.analysis.code, SORT_KEYS.analysisCode, "/analysis/code", true);
  c.order(doc.warnings, SORT_KEYS.warnings, "/warnings", true);
  const counts = doc.report.counts;
  const expected = packageCounts(doc);
  for (const field of COUNT_KEYS) if (counts[field] !== expected[field]) c.err("consistency.counts", `/report/counts/${field}`);
}

// ------------------------------------------------------------------ Analyse-Eintrag (Vertrag 4.14)

const E = {
  skipped: setOf(["skipped"]),
  parse: setOf(["error", "sites"]),
  error: setOf(["error"]),
  full: setOf(["classes", "symbols", "sites", "accesses", "ast", "stateAtlas"]),
  cls: setOf(["name", "line", "end", "states"]),
  state: setOf(["name", "line"]),
  symbol: setOf(["symbol", "class", "name", "kind", "line", "end", "doc", "decorators", "params", "facts"]),
  facts: setOf(["params", "returns", "effects", "pulls", "parReads", "parWrites"]),
  site: setOf(["symbol", "line", "attr", "type", "via", "op", "shortcut", "name", "text", "dynamic"]),
  access: setOf(["symbol", "name", "how", "line", "conf"]),
  ast: setOf(["symbol", "guards", "calls", "locals"]),
  call: setOf(["line", "attr", "args", "kw"]),
  kw: setOf(["name", "value"]),
  local: setOf(["line", "name", "value"]),
  atlas: setOf(["states", "calls", "coverage", "symbols", "errors", "revision"]),
  atlasId: setOf(["id"]),
};

function checkSite(c, site, path) {
  if (!c.obj(site, path, E.site)) return;
  c.text(site.symbol, `${path}/symbol`, NAME, true);
  c.integer(site.line, `${path}/line`, 1);
  c.text(site.attr, `${path}/attr`, VALUE);
  c.enum(site.type, `${path}/type`, ENUMS.siteTypes);
  for (const field of ["via", "op", "shortcut", "name", "text"]) c.text(site[field], `${path}/${field}`, VALUE, true);
  c.boolean(site.dynamic, `${path}/dynamic`);
}

// Prueft einen einzelnen analysis.code[].entry (cs_pocket_export._entry_errors). Ergebnis {ok, errors}; ein Fehler
// betrifft nur diesen Eintrag (Pfade relativ zum Eintrag).
export function validateEntry(entry) {
  const c = new Checker(50);
  const result = () => ({ ok: c.errors.length === 0, errors: c.errors });
  if (!isRecord(entry)) {
    c.err("schema.type", "");
    return result();
  }
  if (Object.hasOwn(entry, "skipped")) {
    if (c.obj(entry, "", E.skipped)) c.enum(entry.skipped, "/skipped", ["helper"]);
    return result();
  }
  if (Object.hasOwn(entry, "error")) {
    if (entry.error === "parse") {
      if (c.obj(entry, "", E.parse) && c.array(entry.sites, "/sites")) entry.sites.forEach((s, i) => checkSite(c, s, `/sites/${i}`));
    } else if (entry.error === "limit" || entry.error === "schema") {
      c.obj(entry, "", E.error);
    } else {
      c.err("schema.enum", "/error");
    }
    return result();
  }
  if (!c.obj(entry, "", E.full)) return result();
  if (c.array(entry.classes, "/classes")) {
    entry.classes.forEach((k, i) => {
      const b = `/classes/${i}`;
      if (!c.obj(k, b, E.cls)) return;
      c.text(k.name, `${b}/name`);
      c.integer(k.line, `${b}/line`, 1);
      c.integer(k.end, `${b}/end`, 1);
      if (c.array(k.states, `${b}/states`)) {
        k.states.forEach((s, j) => {
          const sb = `${b}/states/${j}`;
          if (!c.obj(s, sb, E.state)) return;
          c.text(s.name, `${sb}/name`);
          c.integer(s.line, `${sb}/line`, 1);
        });
      }
    });
  }
  // Symbol-IDs eindeutig: zwei __init__ in verschiedenen Klassen bleiben getrennt (Vertrag 4.14).
  const seen = new Set();
  if (c.array(entry.symbols, "/symbols")) {
    entry.symbols.forEach((s, i) => {
      const b = `/symbols/${i}`;
      if (!c.obj(s, b, E.symbol)) return;
      if (c.text(s.symbol, `${b}/symbol`)) {
        if (seen.has(s.symbol)) c.err("consistency.duplicate", `${b}/symbol`);
        seen.add(s.symbol);
      }
      c.text(s.class, `${b}/class`, NAME, true);
      c.text(s.name, `${b}/name`);
      c.enum(s.kind, `${b}/kind`, ENUMS.symbolKinds);
      c.integer(s.line, `${b}/line`, 1);
      c.integer(s.end, `${b}/end`, 1);
      c.text(s.doc, `${b}/doc`, VALUE);
      for (const field of ["decorators", "params"]) {
        if (c.array(s[field], `${b}/${field}`)) s[field].forEach((v, k) => c.text(v, `${b}/${field}/${k}`, VALUE));
      }
      c.obj(s.facts, `${b}/facts`, E.facts);
    });
  }
  if (c.array(entry.sites, "/sites")) entry.sites.forEach((s, i) => checkSite(c, s, `/sites/${i}`));
  if (c.array(entry.accesses, "/accesses")) {
    entry.accesses.forEach((a, i) => {
      const b = `/accesses/${i}`;
      if (!c.obj(a, b, E.access)) return;
      c.text(a.symbol, `${b}/symbol`, NAME, true);
      c.text(a.name, `${b}/name`, VALUE);
      c.enum(a.how, `${b}/how`, ENUMS.accessHow);
      c.integer(a.line, `${b}/line`, 1);
      if (!(typeof a.conf === "string" || Number.isSafeInteger(a.conf) || a.conf === null)) c.err("schema.type", `${b}/conf`);
    });
  }
  if (c.array(entry.ast, "/ast")) {
    entry.ast.forEach((a, i) => {
      const b = `/ast/${i}`;
      if (!c.obj(a, b, E.ast)) return;
      c.text(a.symbol, `${b}/symbol`);
      c.array(a.guards, `${b}/guards`);
      if (c.array(a.calls, `${b}/calls`)) {
        a.calls.forEach((call, j) => {
          const cb = `${b}/calls/${j}`;
          if (!c.obj(call, cb, E.call)) return;
          c.integer(call.line, `${cb}/line`, 1);
          c.text(call.attr, `${cb}/attr`, VALUE);
          if (c.array(call.args, `${cb}/args`)) call.args.forEach((arg, k) => c.text(arg, `${cb}/args/${k}`, VALUE));
          if (c.array(call.kw, `${cb}/kw`)) {
            call.kw.forEach((kw, k) => {
              const kb = `${cb}/kw/${k}`;
              if (!c.obj(kw, kb, E.kw)) return;
              c.text(kw.name, `${kb}/name`, VALUE);
              c.text(kw.value, `${kb}/value`, VALUE);
            });
          }
        });
      }
      if (c.array(a.locals, `${b}/locals`)) {
        a.locals.forEach((loc, j) => {
          const lb = `${b}/locals/${j}`;
          if (!c.obj(loc, lb, E.local)) return;
          c.integer(loc.line, `${lb}/line`, 1);
          c.text(loc.name, `${lb}/name`, VALUE);
          c.text(loc.value, `${lb}/value`, VALUE);
        });
      }
    });
  }
  const atlas = entry.stateAtlas;
  if (c.obj(atlas, "/stateAtlas", E.atlas)) {
    for (const field of ["states", "calls", "errors"]) c.array(atlas[field], `/stateAtlas/${field}`);
    if (c.array(atlas.coverage, "/stateAtlas/coverage")) atlas.coverage.forEach((v, i) => c.text(v, `/stateAtlas/coverage/${i}`, VALUE));
    const ids = new Set();
    if (c.array(atlas.symbols, "/stateAtlas/symbols")) {
      atlas.symbols.forEach((s, i) => {
        const b = `/stateAtlas/symbols/${i}`;
        // Eigene StateAtlas-Felder sind erlaubt; Pflicht ist nur eine eindeutige id.
        if (!c.obj(s, b, E.atlasId, isRecord(s) ? new Set(Object.keys(s)) : null) || !c.text(s.id, `${b}/id`, VALUE)) return;
        if (ids.has(s.id)) c.err("consistency.duplicate", `${b}/id`);
        ids.add(s.id);
      });
    }
  }
  return result();
}

// ------------------------------------------------------------------ Gesamtpruefung

// Ergebnis: {ok, errors:[{code, path, category}], unknownFields:[JSON Pointer], entryErrors:[{source, errors}],
// truncated}. Wie in Python: Kennung und Hauptversion brechen sofort ab ("App aktualisieren" statt hundert
// Folgefehler), danach werden je Stufe (Schema/Grenzen, dann Konsistenz) alle Fehler gesammelt.
export function validate(doc) {
  const c = new Checker();
  const entryErrors = [];
  const result = () => ({ ok: c.errors.length === 0, errors: c.errors, unknownFields: c.ignored, entryErrors, truncated: c.truncated });
  if (!isRecord(doc)) {
    c.err("schema.type", "");
    return result();
  }
  if (doc.format !== SNAPSHOT_FORMAT) {
    c.err("schema.format", "/format");
    return result();
  }
  if (!Number.isSafeInteger(doc.schemaVersion)) {
    c.err("schema.type", "/schemaVersion");
    return result();
  }
  if (doc.schemaVersion !== SCHEMA_VERSION) {
    c.err(doc.schemaVersion > SCHEMA_VERSION ? "schema.version-newer" : "schema.version-older", "/schemaVersion");
    return result();
  }
  // Vertrag 4.1: unbekannte Felder gleicher Hauptversion nennen - auch im integrity-Objekt (verify.js prueft es).
  // Dieselbe ASCII-Regel wie in Checker.obj (Vertrag 16): ein Nicht-ASCII-Schluessel ist schema.keys und landet
  // nie woertlich in unknownFields (Python: cs_pocket_export.validate, gleiche Stelle nach der Versionspruefung).
  if (isRecord(doc.integrity)) {
    for (const key of Object.keys(doc.integrity)) {
      if (F.integrity.has(key)) continue;
      if (!RE.ascii.test(key)) c.err("schema.keys", "/integrity");
      else c.note(pointer("/integrity", key));
    }
  }
  if (!c.obj(doc, "", F.header)) return result();
  checkSchema(c, doc, entryErrors);
  if (c.errors.length) return result();
  checkConsistency(c, doc);
  return result();
}

export const CONTENT_FIELDS = Object.freeze([...CONTENT_KEYS]);
