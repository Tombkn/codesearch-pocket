// Pruefpipeline fuer ein geladenes Paket (Vertrag Abschnitt 5, Reihenfolge verbindlich):
//   Bytelaenge <= 16 MiB -> kein BOM -> UTF-8 strikt -> JSON.parse -> Tiefe/Typen/Surrogate/__proto__
//   -> c14n und Bytevergleich -> integrity -> algorithm/canonicalization -> Schema und Grenzen -> Konsistenz
//   (inkl. sha256 je Quelle) -> contentHash, analysisHash, revision.id -> Bindung an den angefragten Index-Eintrag.
// Rein (kein DOM, kein Speicher): laeuft im Fenster oder in einem Worker. Erst ein Ergebnis mit ok:true darf in
// den Projektspeicher (store.js); jede Ablehnung laesst alles Vorhandene unveraendert (Vertrag 16).
// Fehler: {code, path, category, message}; code = "<kategorie>.<detail>" (Vertrag 16: genau eine Kategorie je
// Code), path = JSON Pointer, message = feste Vorlage ohne Paketinhalt.

import {
  CanonicalError, C14N_NAME, canonicalize, canonicalMembers, joinMembers, utf8Bytes, bytesEqual, decodeUtf8Strict,
  hasUtf8Bom, sha256Hex, toUint8,
} from "./c14n.js";
import { validate, categoryOf, CONTENT_FIELDS, PATTERNS } from "./schema.js";

// Pocket v1 nimmt hoechstens 16 MiB an, bis ein Geraetetest auf dem aeltesten Ziel-iPhone mehr erlaubt (Vertrag 9).
// maxBytes kann die Grenze nur senken (Tests, Testvektoren), nie heben: ein falscher Aufruf soll die Geraetegrenze
// nicht still aushebeln.
export const POCKET_MAX_BYTES = 16 * 1024 * 1024;
export const EXPORTER_MAX_BYTES = 32 * 1024 * 1024;

export const STAGES = Object.freeze(["input", "size", "bom", "decode", "parse", "structure", "canonical", "integrity",
  "algorithm", "schema", "consistency", "hashes", "binding"]);

// Feste Vorlagen je Code: Meldungen enthalten nie Inhalte aus dem Paket, nur Ort, Regel und Zahlen.
const MESSAGES = Object.freeze({
  "encoding.input": "Eingabe ist keine Bytefolge bzw. kein JSON-Objekt.",
  "encoding.bom": "Paket beginnt mit einem BOM (EF BB BF).",
  "encoding.utf8": "Paket ist kein gültiges UTF-8.",
  "limit.bytes": "Paket ist zu groß für Pocket (höchstens 16 MiB).",
  "json.syntax": "Paket ist kein gültiges JSON.",
  "json.duplicate-key": "Paket enthält einen doppelten Schlüssel in einem Objekt.",
  "json.number": "Paket enthält eine Zahl, die keine kanonische Ganzzahl ist (1.0, 1e2, -0, 1.5).",
  "json.int-range": "Paket enthält eine Ganzzahl außerhalb von ±(2^53−1).",
  "json.depth": "Paket ist tiefer als 32 Ebenen verschachtelt.",
  "json.surrogate": "Paket enthält ein einzelnes Surrogat-Zeichen.",
  "json.proto": "Paket enthält den verbotenen Schlüssel __proto__.",
  "json.type": "Paket enthält einen unzulässigen Werttyp.",
  "canonical.mismatch": "Paketbytes sind nicht kanonisch (cspocket-c14n-1).",
  "integrity.missing": "Paket hat keinen gültigen integrity-Block.",
  "integrity.mismatch": "Integritätsprüfung fehlgeschlagen: SHA-256 passt nicht.",
  "integrity.algorithm": "Unbekanntes Prüfverfahren oder unbekannte Kanonisierung.",
  "integrity.content-hash": "contentHash passt nicht zum Inhalt.",
  "integrity.analysis-hash": "analysisHash passt nicht zur Analyse.",
  "integrity.revision-id": "revision.id passt nicht zu projectId und contentHash.",
  "integrity.unavailable": "SHA-256 ist hier nicht verfügbar (kein sicherer Kontext).",
  "schema.format": "Datei ist kein CodeSearch-Pocket-Paket.",
  "schema.version-newer": "Paket hat eine neuere Hauptversion: App aktualisieren.",
  "schema.version-older": "Paket ist zu alt für diese App.",
  "schema.missing": "Paket verletzt das Schema: Pflichtfeld fehlt.",
  "schema.type": "Paket verletzt das Schema: falscher Typ.",
  "schema.enum": "Paket verletzt das Schema: Wert nicht in der Aufzählung.",
  "schema.pattern": "Paket verletzt das Schema: Wert passt nicht zum Muster.",
  "schema.value": "Paket verletzt das Schema: Wert verletzt eine Feldregel.",
  "schema.keys": "Paket verletzt das Schema: Schlüssel ist kein ASCII-Feldname.",
  "limit.count": "Paket überschreitet eine Grenze: zu viele Einträge.",
  "limit.length": "Paket überschreitet eine Grenze: Text zu lang.",
  "limit.total": "Paket überschreitet eine Grenze: Gesamttext zu lang.",
  "limit.depth": "Paket überschreitet eine Grenze: Operator tiefer als 64 Ebenen.",
  "consistency.root": "Paket ist widersprüchlich: Root nicht genau einmal oder passt nicht zu exportRoot.",
  "consistency.parent": "Paket ist widersprüchlich: parent fehlt oder ist kein COMP.",
  "consistency.rel": "Paket ist widersprüchlich: rel ist nicht parent/name.",
  "consistency.path": "Paket ist widersprüchlich: path ist nicht abs(rel).",
  "consistency.duplicate": "Paket ist widersprüchlich: Schlüssel doppelt.",
  "consistency.key": "Paket ist widersprüchlich: codeSources.key ist nicht op.",
  "consistency.reference": "Paket ist widersprüchlich: Verweis auf einen nicht exportierten Operator.",
  "consistency.sort": "Paket ist widersprüchlich: Sortierung nach Vertrag 4.17 verletzt.",
  "consistency.status": "Paket ist widersprüchlich: Text/Tabelle/sha256 passen nicht zum Status.",
  "consistency.sha256": "sha256 einer Code-Quelle passt nicht zu ihrem Text bzw. ihrer Tabelle.",
  "consistency.chars": "Paket ist widersprüchlich: chars/lines passen nicht zum Text.",
  "consistency.duplicate-of": "duplicateOf zeigt nicht auf die erste Quelle mit gleichem sha256.",
  "consistency.counts": "Paket ist widersprüchlich: report.counts passen nicht zum Paket.",
  "consistency.warning": "Paket ist widersprüchlich: Schwere einer Warnung passt nicht zu ihrem Code.",
  "consistency.mode": "Paket ist widersprüchlich: Wert passt nicht zum Parametermodus.",
  "binding.missing": "Prüfung ohne Index-Eintrag ist nur ausdrücklich erlaubt.",
  "binding.project": "Paket gehört zu einem anderen Projekt als angefragt.",
  "binding.revision": "Paket ist nicht die angefragte Revision.",
  "binding.seq": "Kopf-Nummer passt nicht zum angefragten Index-Eintrag.",
});

// Object.hasOwn: "constructor" & Co. sind keine Codes (Vertrag 14, Lookups nie ueber den Prototyp).
export function messageFor(code) {
  return typeof code === "string" && Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : "Paket abgelehnt.";
}

function issue(code, path = "") {
  return { code, path, category: categoryOf(code), message: messageFor(code) };
}

function reject(stage, code, path = "", extra = {}) {
  return { ok: false, stage, errors: [issue(code, path)], ...extra };
}

function rejectMany(stage, errors, extra = {}) {
  return { ok: false, stage, errors: errors.map((e) => issue(e.code, e.path)), ...extra };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Nur im Fehlerfall: warum sind die Bytes nicht kanonisch? JSON.parse verschluckt doppelte Schluessel und 1.0/1e2/-0;
// Python lehnt beides schon beim Parsen ab (json.duplicate-key, json.number). Damit beide Seiten dieselbe Kategorie
// melden (Vertrag 16), sucht ein kleiner Tokenizer die erste solche Stelle; sonst bleibt es canonical.mismatch
// (Leerraum, Schluesselordnung, \u-Escapes). Der Text ist schon als JSON gueltig (JSON.parse lief).
const CANONICAL_INT = /^-?(?:0|[1-9][0-9]*)$/;

export function diagnoseNonCanonical(text) {
  const stack = [];
  let expectKey = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 0x22) {
      let j = i + 1;
      while (j < text.length) {
        const d = text.charCodeAt(j);
        if (d === 0x5c) j += 2;
        else if (d === 0x22) break;
        else j += 1;
      }
      const top = stack[stack.length - 1];
      if (top && top.keys && expectKey) {
        const key = JSON.parse(text.slice(i, j + 1));
        if (top.keys.has(key)) return { code: "json.duplicate-key", at: i };
        top.keys.add(key);
        expectKey = false;
      }
      i = j;
    } else if (c === 0x7b) {
      stack.push({ keys: new Set() });
      expectKey = true;
    } else if (c === 0x5b) {
      stack.push({ keys: null });
      expectKey = false;
    } else if (c === 0x7d || c === 0x5d) {
      stack.pop();
      expectKey = false;
    } else if (c === 0x2c) {
      const top = stack[stack.length - 1];
      expectKey = Boolean(top && top.keys);
    } else if (c === 0x2d || (c >= 0x30 && c <= 0x39)) {
      let j = i + 1;
      while (j < text.length && /[0-9eE+\-.]/.test(text[j])) j += 1;
      const token = text.slice(i, j);
      if (token === "-0" || !CANONICAL_INT.test(token)) return { code: "json.number", at: i };
      i = j - 1;
    }
  }
  return null;
}

// Je Quelle (exact/truncated): sha256 ueber UTF-8 von text bzw. die kanonische table nachrechnen (Vertrag 4.10).
// Notizanker vertrauen auf "gleiche sourceSha256 -> bleibt", darum zaehlt nur der nachgerechnete Wert. Bis zu 32
// Hashes gleichzeitig: weniger Wartezeit, begrenzter Zusatzspeicher.
async function checkSourceHashes(sources) {
  const errors = [];
  for (let start = 0; start < sources.length; start += 32) {
    const batch = sources.slice(start, start + 32);
    const digests = await Promise.all(batch.map((s) => {
      if (s.status !== "exact" && s.status !== "truncated") return Promise.resolve(null);
      return sha256Hex(typeof s.text === "string" ? s.text : canonicalize(s.table));
    }));
    digests.forEach((digest, k) => {
      if (digest !== null && digest !== batch[k].sha256) errors.push({ code: "consistency.sha256", path: `/codeSources/${start + k}/sha256` });
    });
  }
  return errors;
}

// Binding-Erwartung pruefen, bevor irgendetwas gelesen wird: wer bindet, muss alle drei Werte nennen.
function readBinding(options) {
  if (options.unbound === true) return { unbound: true };
  const index = options.index;
  const ok = isRecord(index) && PATTERNS.projectId.test(String(index.projectId))
    && PATTERNS.revisionId.test(String(index.revisionId)) && Number.isSafeInteger(index.seq) && index.seq >= 1;
  return ok ? { unbound: false, index } : null;
}

// Paketbytes pruefen. options:
//   index    {projectId, revisionId, seq} - der angefragte Eintrag aus projects/index.json (Pflicht)
//   head     optional {seq, revisionId} aus project.json; muss zum Index-Eintrag passen
//   unbound  true nur fuer Testvektoren und den Import ohne Speicher (keine Bindung, seq = null)
//   maxBytes kleinere Grenze vor dem Dekodieren (hoechstens 16 MiB)
// Ergebnis ok:true -> {doc, bytes, projectId, revisionId, seq, contentHash, analysisHash, integrity, ...}
//          ok:false -> {stage, errors:[{code, path, category, message}]}
export async function verifyPackage(input, options = {}) {
  const binding = readBinding(options);
  if (!binding) return reject("input", "binding.missing");
  let bytes;
  try {
    bytes = toUint8(input);
  } catch (error) {
    if (error instanceof CanonicalError) return reject("input", "encoding.input");
    throw error;
  }
  const maxBytes = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0
    ? Math.min(options.maxBytes, POCKET_MAX_BYTES) : POCKET_MAX_BYTES;
  // 1 Groesse vor jedem Dekodieren: ein riesiges Paket soll weder Speicher noch Zeit kosten.
  if (bytes.length > maxBytes) return reject("size", "limit.bytes", "", { byteLength: bytes.length, maxBytes });
  // 2 BOM: TextDecoder und Response.json() wuerden es still entfernen.
  if (hasUtf8Bom(bytes)) return reject("bom", "encoding.bom");
  // 3 UTF-8 strikt (fatal): kein stilles U+FFFD.
  let text;
  try {
    text = decodeUtf8Strict(bytes);
  } catch (error) {
    if (error instanceof CanonicalError) return reject("decode", "encoding.utf8");
    throw error;
  }
  // 4 JSON-Syntax (NaN/Infinity sind kein JSON und landen auch hier).
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return reject("parse", "json.syntax");
    throw error;
  }
  text = null;
  // 5+6 Tiefe <= 32, nur sichere Ganzzahlen, isWellFormed je String und Schluessel, kein __proto__ - das prueft der
  // Emitter beim Kanonisieren, bevor irgendein Byte verglichen wird. Danach der Bytevergleich: nur so fallen
  // doppelte Schluessel, 1.0, 1e2, -0, Leerraum und \u-Escapes von Nicht-Steuerzeichen auf (JSON.parse verschluckt sie).
  let members = null;
  let canonicalText;
  try {
    if (isRecord(doc)) {
      members = canonicalMembers(doc);
      canonicalText = joinMembers(members);
    } else {
      canonicalText = canonicalize(doc);
    }
  } catch (error) {
    if (error instanceof CanonicalError) return reject("structure", error.code, error.path);
    throw error;
  }
  const same = bytesEqual(utf8Bytes(canonicalText), bytes);
  canonicalText = null;
  if (!same) {
    const cause = diagnoseNonCanonical(decodeUtf8Strict(bytes));
    return reject(cause ? "parse" : "canonical", cause ? cause.code : "canonical.mismatch");
  }
  // Wie Python (validate: input.type, Kategorie encoding): ein kanonisches JSON, das kein Objekt ist, ist kein Paket.
  if (!members) return reject("input", "encoding.input");
  // 7 integrity = SHA-256 ueber UTF-8 der kanonischen Form ohne "integrity".
  const integrity = doc.integrity;
  if (!isRecord(integrity) || typeof integrity.value !== "string") return reject("integrity", "integrity.missing", "/integrity");
  let digest;
  try {
    digest = await sha256Hex(utf8Bytes(joinMembers(members.filter(([key]) => key !== "integrity"))));
  } catch (error) {
    if (error instanceof CanonicalError) return reject("integrity", error.code);
    throw error;
  }
  if (digest !== integrity.value) return reject("integrity", "integrity.mismatch", "/integrity/value");
  // 8 Verfahren exakt.
  if (integrity.algorithm !== "sha256" || integrity.canonicalization !== C14N_NAME) {
    return reject("algorithm", "integrity.algorithm", "/integrity");
  }
  // 9 Schema und Grenzen, danach Konsistenz (validate trennt die Stufen wie cs_pocket_export.validate).
  const checked = validate(doc);
  if (!checked.ok) {
    const stage = checked.errors.some((e) => e.category === "schema" || e.category === "limit") ? "schema" : "consistency";
    return rejectMany(stage, checked.errors, { truncated: checked.truncated });
  }
  // 10 sha256 je Quelle (Teil der Konsistenz; asynchron, weil WebCrypto).
  const sourceErrors = await checkSourceHashes(doc.codeSources);
  if (sourceErrors.length) return rejectMany("consistency", sourceErrors);
  // 11 Hashes und Revision nachrechnen (Vertrag 4.2). Der contentHash-Umfang entsteht aus denselben Mitgliedstexten.
  const byKey = new Map(members);
  members = null;
  const contentText = `{${[...CONTENT_FIELDS].sort().map((key) => byKey.get(key)).join(",")}}`;
  byKey.clear();
  const contentHash = `sha256:${await sha256Hex(utf8Bytes(contentText))}`;
  const analysisHash = `sha256:${await sha256Hex(utf8Bytes(canonicalize(doc.analysis.code)))}`;
  const revisionId = `rev_${(await sha256Hex(`${doc.projectId}\n${doc.revision.contentHash}`)).slice(0, 32)}`;
  const hashErrors = [];
  if (contentHash !== doc.revision.contentHash) hashErrors.push({ code: "integrity.content-hash", path: "/revision/contentHash" });
  if (analysisHash !== doc.revision.analysisHash) hashErrors.push({ code: "integrity.analysis-hash", path: "/revision/analysisHash" });
  if (revisionId !== doc.revision.id) hashErrors.push({ code: "integrity.revision-id", path: "/revision/id" });
  if (hashErrors.length) return rejectMany("hashes", hashErrors);
  // 12 Bindung: projectId, revision.id und seq gleich dem angefragten Index-Eintrag.
  let seq = null;
  if (!binding.unbound) {
    const { index } = binding;
    const bindingErrors = [];
    if (doc.projectId !== index.projectId) bindingErrors.push({ code: "binding.project", path: "/projectId" });
    if (doc.revision.id !== index.revisionId) bindingErrors.push({ code: "binding.revision", path: "/revision/id" });
    const head = options.head;
    if (head !== undefined && head !== null) {
      if (!isRecord(head) || head.seq !== index.seq || head.revisionId !== index.revisionId) {
        bindingErrors.push({ code: "binding.seq", path: "" });
      }
    }
    if (bindingErrors.length) return rejectMany("binding", bindingErrors);
    seq = index.seq;
  }
  return {
    ok: true,
    doc,
    bytes,
    byteLength: bytes.length,
    projectId: doc.projectId,
    revisionId: doc.revision.id,
    seq,
    bound: !binding.unbound,
    contentHash,
    analysisHash,
    integrity: integrity.value,
    unknownFields: checked.unknownFields,
    entryErrors: checked.entryErrors,
    schemaMinor: doc.schemaMinor,
  };
}

// Erneute Pruefung beim Oeffnen aus IndexedDB (Vertrag 5 letzter Punkt, 13): geteilte Origin, also nie blind
// vertrauen. Bindet an den gespeicherten Projektzustand statt an den Index.
export async function verifyStored(bytes, { projectId, revisionId, seq }) {
  return verifyPackage(bytes, { index: { projectId, revisionId, seq } });
}
