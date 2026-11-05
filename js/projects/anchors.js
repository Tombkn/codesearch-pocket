// Notizanker (Vertrag Abschnitt 13): eine lokale Notiz zeigt auf einen Op, einen Zeilenbereich oder ein Symbol.
// Nach einem Revisionswechsel wird der Anker neu zugeordnet - nie allein ueber die Zeilennummer:
//   gleiche sourceSha256                         -> bleibt ("kept")
//   Ausschnitt eindeutig wiedergefunden          -> verschoben ("moved", Anker wird fortgeschrieben)
//   Quelle mit status != exact                   -> Quelle nicht uebertragen ("source-not-transferred")
//   sonst                                        -> nicht zugeordnet ("unmatched", Notiz bleibt sichtbar)
// Rein: arbeitet auf einem ProjectModel (model.js) und Plain-Objekten; kein DOM, kein Speicher.

import { sha256Hex, codepointLength } from "./c14n.js";
import { PATTERNS } from "./schema.js";

export const ANCHOR_KINDS = Object.freeze(["op", "range", "symbol"]);
export const ANCHOR_STATES = Object.freeze(["kept", "moved", "source-not-transferred", "unmatched"]);
export const ANCHOR_STATE_LABELS = Object.freeze({
  kept: "bleibt",
  moved: "verschoben",
  "source-not-transferred": "Quelle nicht übertragen",
  unmatched: "nicht zugeordnet",
});
export const CONTEXT_LINES = 3;
// Ein Ausschnitt bleibt Notiz-Material, keine Kopie ganzer Quellen; Kontextzeilen werden gekappt, damit eine
// einzelne 1-Mio.-Zeichen-Zeile nicht in jede Notiz wandert. Verglichen wird dann ueber den Anfang der Zeile.
export const MAX_EXCERPT_CHARS = 65536;
export const CONTEXT_CAP = 2000;

const ANCHOR_FIELDS = ["projectId", "kind", "op", "origPath", "source", "symbol", "startLine", "endLine", "excerpt",
  "before", "after", "textHash", "sourceSha256", "revisionId"];

export class AnchorError extends Error {
  constructor(code) {
    super(`anchor: ${code}`);
    this.name = "AnchorError";
    this.code = code;
  }
}

function capLine(line) {
  if (line.length <= CONTEXT_CAP) return line;
  let cut = CONTEXT_CAP;
  const c = line.charCodeAt(cut - 1);
  if (c >= 0xd800 && c <= 0xdbff) cut -= 1;    // kein halbes Surrogat-Paar speichern
  return line.slice(0, cut);
}

function sameContextLine(stored, actual) {
  if (stored === actual) return true;
  return stored.length >= CONTEXT_CAP - 1 && actual.startsWith(stored);
}

// Neuer Anker. spec: {kind, op} | {kind:"range", source, startLine, endLine} | {kind:"symbol", source, symbol}.
export async function createAnchor(model, spec) {
  const kind = spec && spec.kind;
  if (!ANCHOR_KINDS.includes(kind)) throw new AnchorError("kind");
  if (kind === "op") {
    if (typeof spec.op !== "string" || !model.has(spec.op)) throw new AnchorError("op");
    return {
      projectId: model.projectId, kind, op: spec.op, origPath: model.abs(spec.op), source: null, symbol: null,
      startLine: null, endLine: null, excerpt: "", before: [], after: [], textHash: await sha256Hex(""),
      sourceSha256: null, revisionId: model.revisionId,
    };
  }
  const key = spec.source;
  const src = typeof key === "string" ? model.source(key) : null;
  if (!src || src.status !== "exact" || typeof src.text !== "string") throw new AnchorError("source");
  const lines = model.sourceLines(key);
  let start = spec.startLine;
  let end = spec.endLine;
  let symbol = null;
  if (kind === "symbol") {
    const sym = model.symbol(key, spec.symbol);
    if (!sym) throw new AnchorError("symbol");
    symbol = sym.symbol;
    start = sym.line;
    end = sym.end;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > lines.length) {
    throw new AnchorError("range");
  }
  const excerpt = lines.slice(start - 1, end).join("\n");
  if (codepointLength(excerpt) > MAX_EXCERPT_CHARS) throw new AnchorError("size");
  return {
    projectId: model.projectId,
    kind,
    op: src.op,
    origPath: model.abs(src.op),
    source: key,
    symbol,
    startLine: start,
    endLine: end,
    excerpt,
    before: lines.slice(Math.max(0, start - 1 - CONTEXT_LINES), start - 1).map(capLine),
    after: lines.slice(end, end + CONTEXT_LINES).map(capLine),
    textHash: await sha256Hex(excerpt),
    sourceSha256: src.sha256,
    revisionId: model.revisionId,
  };
}

const isStr = (v) => typeof v === "string";
const isLine = (v) => Number.isSafeInteger(v) && v >= 1;

// Strukturpruefung (z.B. beim Notiz-Import): {ok, errors:[code]}. Inhalte werden nie in Fehlern genannt.
export function validateAnchor(anchor) {
  const errors = [];
  const fail = (code) => errors.push(code);
  if (anchor === null || typeof anchor !== "object" || Array.isArray(anchor)) return { ok: false, errors: ["type"] };
  for (const field of ANCHOR_FIELDS) if (!Object.hasOwn(anchor, field)) fail(`missing:${field}`);
  if (errors.length) return { ok: false, errors };
  if (!PATTERNS.projectId.test(String(anchor.projectId))) fail("projectId");
  if (!PATTERNS.revisionId.test(String(anchor.revisionId))) fail("revisionId");
  if (!ANCHOR_KINDS.includes(anchor.kind)) fail("kind");
  if (!isStr(anchor.op) || !isStr(anchor.origPath) || !PATTERNS.absPath.test(anchor.origPath)) fail("op");
  if (!isStr(anchor.excerpt) || codepointLength(anchor.excerpt) > MAX_EXCERPT_CHARS) fail("excerpt");
  if (!isStr(anchor.textHash) || !PATTERNS.hex64.test(anchor.textHash)) fail("textHash");
  for (const side of ["before", "after"]) {
    const list = anchor[side];
    if (!Array.isArray(list) || list.length > CONTEXT_LINES || !list.every((l) => isStr(l) && l.length <= CONTEXT_CAP)) {
      fail(side);
    }
  }
  if (anchor.kind === "op") {
    if (anchor.source !== null || anchor.symbol !== null || anchor.startLine !== null || anchor.endLine !== null) fail("op-fields");
    if (anchor.sourceSha256 !== null) fail("sourceSha256");
  } else if (ANCHOR_KINDS.includes(anchor.kind)) {
    if (!isStr(anchor.source) || anchor.source !== anchor.op) fail("source");
    if (anchor.kind === "symbol" ? !isStr(anchor.symbol) : anchor.symbol !== null) fail("symbol");
    if (!isLine(anchor.startLine) || !isLine(anchor.endLine) || anchor.endLine < anchor.startLine) fail("lines");
    else if (isStr(anchor.excerpt) && anchor.excerpt.split("\n").length !== anchor.endLine - anchor.startLine + 1) {
      fail("excerpt-lines");
    }
    if (!(anchor.sourceSha256 === null || (isStr(anchor.sourceSha256) && PATTERNS.sourceSha.test(anchor.sourceSha256)))) {
      fail("sourceSha256");
    }
  }
  return { ok: errors.length === 0, errors };
}

// Schnelltest (Vertrag 13: textHash nur Schnelltest): passt der gespeicherte Ausschnitt noch zu seinem Hash?
export async function anchorIntact(anchor) {
  return validateAnchor(anchor).ok && (await sha256Hex(anchor.excerpt)) === anchor.textHash;
}

// Wo steht der Op im neuen Modell? Erst ueber den Originalpfad (anderer Root), dann ueber rel (umbenannter Root).
function locate(anchor, model) {
  const viaPath = model.relOf(anchor.origPath);
  if (viaPath !== null && model.has(viaPath)) return viaPath;
  if (model.has(anchor.op)) return anchor.op;
  return null;
}

// Alle zeilengenauen Fundstellen des Ausschnitts (Zeilenanfang 0-basiert).
function findExcerpt(lines, excerptLines) {
  const n = excerptLines.length;
  const first = excerptLines[0];
  const hits = [];
  for (let i = 0; i + n <= lines.length; i += 1) {
    if (lines[i] !== first) continue;
    let same = true;
    for (let k = 1; k < n; k += 1) {
      if (lines[i + k] !== excerptLines[k]) {
        same = false;
        break;
      }
    }
    if (same) hits.push(i);
  }
  return hits;
}

// Wie viele der gespeicherten Kontextzeilen stimmen an Fundstelle i noch (von innen nach aussen gezaehlt)?
function contextScore(lines, start, n, before, after) {
  let score = 0;
  for (let k = 1; k <= before.length; k += 1) {
    const line = lines[start - k];
    if (line === undefined || !sameContextLine(before[before.length - k], line)) break;
    score += 1;
  }
  for (let k = 0; k < after.length; k += 1) {
    const line = lines[start + n + k];
    if (line === undefined || !sameContextLine(after[k], line)) break;
    score += 1;
  }
  return score;
}

// Ordnet einen Anker einem (neuen) Modell zu. Ergebnis {state, label, anchor, startLine, endLine, rel};
// anchor ist bei "moved" der fortgeschriebene Anker, sonst der unveraenderte.
export function resolveAnchor(anchor, model) {
  const result = (state, next = anchor) => ({
    state, label: ANCHOR_STATE_LABELS[state], anchor: next,
    rel: next.op, startLine: next.startLine, endLine: next.endLine,
  });
  if (!validateAnchor(anchor).ok || anchor.projectId !== model.projectId) return result("unmatched");
  const rel = locate(anchor, model);
  if (rel === null) return result("unmatched");
  const origPath = model.abs(rel);
  if (anchor.kind === "op") {
    if (rel === anchor.op && origPath === anchor.origPath) return result("kept");
    return result("moved", { ...anchor, op: rel, origPath, revisionId: model.revisionId });
  }
  const src = model.source(rel);
  if (!src) return result("unmatched");
  if (src.status !== "exact" || typeof src.text !== "string") return result("source-not-transferred");
  const lines = () => model.sourceLines(rel);
  const span = anchor.endLine - anchor.startLine;
  const moved = (startLine) => ({
    ...anchor,
    op: rel,
    source: rel,
    origPath,
    startLine,
    endLine: startLine + span,
    before: lines().slice(Math.max(0, startLine - 1 - CONTEXT_LINES), startLine - 1).map(capLine),
    after: lines().slice(startLine + span, startLine + span + CONTEXT_LINES).map(capLine),
    sourceSha256: src.sha256,
    revisionId: model.revisionId,
  });
  if (anchor.sourceSha256 !== null && src.sha256 === anchor.sourceSha256) {
    // Gleicher Text: Zeilen stimmen. Hat sich nur der Ort (rel/Pfad) geaendert, wird der Anker fortgeschrieben.
    if (rel === anchor.op && origPath === anchor.origPath) return result("kept");
    return result("moved", moved(anchor.startLine));
  }
  const excerptLines = anchor.excerpt.split("\n");
  const hits = findExcerpt(lines(), excerptLines);
  if (hits.length === 1) return result("moved", moved(hits[0] + 1));
  if (hits.length > 1) {
    // Mehrdeutig: nur die eine Fundstelle mit dem besten Kontext zaehlt, und nur wenn sie allein vorne liegt.
    const scored = hits.map((i) => [i, contextScore(lines(), i, excerptLines.length, anchor.before, anchor.after)]);
    const best = Math.max(...scored.map(([, s]) => s));
    const winners = scored.filter(([, s]) => s === best);
    if (best > 0 && winners.length === 1) return result("moved", moved(winners[0][0] + 1));
  }
  return result("unmatched");
}
