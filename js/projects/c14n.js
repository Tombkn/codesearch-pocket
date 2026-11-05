// Kanonisierung "cspocket-c14n-1" (Vertrag POCKET-PROJECTS-SPEC, Abschnitt 5) und kleine Byte-Helfer.
// Rein: kein DOM, kein Speicher, keine Abhaengigkeit. Python (cs_pocket_export) setzt dieselben Regeln um;
// beide Seiten muessen fuer dieselben Testvektoren bytegleich sein. Deshalb eigener Emitter statt
// JSON.stringify ueber Objekte: JSON.stringify sortiert keine Schluessel und laesst 1.5, -0 und Surrogate durch.

export const C14N_NAME = "cspocket-c14n-1";
// "JSON-Verschachtelung <= 32": gezaehlt werden Container (Objekt/Liste); das Wurzelobjekt ist Ebene 1.
export const MAX_DEPTH = 32;

// Fehler mit festem Code und Feldpfad - nie mit Inhalt aus dem Paket (Vertrag 4.15/8: Meldungen ohne Werte).
// Codes tragen ihre Kategorie als Praefix (Vertrag 16: json.*, encoding.*, integrity.*), Pfade sind JSON Pointer.
export class CanonicalError extends Error {
  constructor(code, path = "") {
    super(`cspocket-c14n-1: ${code}`);
    this.name = "CanonicalError";
    this.code = code;
    this.path = path;
  }
}

const encoder = new TextEncoder();
const HAS_WELL_FORMED = typeof String.prototype.isWellFormed === "function";
const HAS_SURROGATE = /[\uD800-\uDFFF]/;
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

// Pfad erst im Fehlerfall bauen (RFC 6901: "~" -> "~0", "/" -> "~1"); der Erfolgsweg kostet nichts.
function pointerOf(stack) {
  let out = "";
  for (const part of stack) out += `/${String(part).replace(/~/g, "~0").replace(/\//g, "~1")}`;
  return out;
}

// Einzelnes Surrogat = kein gueltiges Unicode; UTF-8 kann es nicht tragen (Python bricht beim Kodieren ab).
// Fallback ohne Lookbehind-Regex, weil ein solches Regex-Literal aeltere Engines schon beim Laden stoppt.
export function isWellFormedString(text) {
  if (HAS_WELL_FORMED) return text.isWellFormed();
  if (!HAS_SURROGATE.test(text)) return true;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (d < 0xdc00 || d > 0xdfff) return false;
      i += 1;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

// Ein String nach Vertrag: nur " \ und U+0000-U+001F escapen (\b \f \n \r \t, sonst \u00xx klein), Rest roh.
// JSON.stringify auf EINEN String tut genau das (ECMA-262 QuoteJSONString, Hex klein) - sobald einzelne
// Surrogate vorher abgewiesen sind. Python json.dumps(s, ensure_ascii=False) schreibt dieselben Bytes.
function quote(text, stack) {
  if (!isWellFormedString(text)) throw new CanonicalError("json.surrogate", pointerOf(stack));
  return JSON.stringify(text);
}

function isPlainRecord(value) {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Rekursion mit harter Tiefengrenze: tiefer als 32 bricht ab, bevor der Aufrufstapel wachsen kann.
// Der Text waechst ueber += (Rope in V8/JSC): ein Durchgang, kein Zwischen-Array mit Millionen Teilen.
function emit(value, depth, stack, state) {
  if (value === null) {
    state.out += "null";
    return;
  }
  switch (typeof value) {
    case "string":
      state.out += quote(value, stack);
      return;
    case "boolean":
      state.out += value ? "true" : "false";
      return;
    case "number":
      // Nur Ganzzahlen |n| <= 2^53-1. -0 wird "0" (String(-0) === "0"); 1.5, NaN, 2^53 sind verboten.
      // Wie Python: ganzzahlig, aber zu gross -> json.int-range; sonst (1.5, 1e400) json.number.
      if (!Number.isSafeInteger(value)) {
        throw new CanonicalError(Number.isInteger(value) ? "json.int-range" : "json.number", pointerOf(stack));
      }
      state.out += String(value);
      return;
    case "object":
      break;
    default:
      throw new CanonicalError("json.type", pointerOf(stack));
  }
  if (depth >= MAX_DEPTH) throw new CanonicalError("json.depth", pointerOf(stack));
  if (Array.isArray(value)) {
    state.out += "[";
    for (let i = 0; i < value.length; i += 1) {
      if (i) state.out += ",";
      stack.push(String(i));
      emit(value[i], depth + 1, stack, state);
      stack.pop();
    }
    state.out += "]";
    return;
  }
  if (!isPlainRecord(value)) throw new CanonicalError("json.type", pointerOf(stack));
  // Standard-sort() vergleicht UTF-16-Codeeinheiten - genau die Vertragsregel (Python: key.encode("utf-16-be")).
  const keys = Object.keys(value).sort();
  state.out += "{";
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    // JSON.parse legt "__proto__" als eigenen Schluessel an; Zuweisungen damit aendern Prototypen -> verboten.
    if (key === "__proto__") throw new CanonicalError("json.proto", pointerOf([...stack, key]));
    if (i) state.out += ",";
    state.out += quote(key, stack);
    state.out += ":";
    stack.push(key);
    emit(value[key], depth + 1, stack, state);
    stack.pop();
  }
  state.out += "}";
}

// Kanonischer Text eines JSON-Werts. Wirft CanonicalError(code, pfad) bei allem, was c14n nicht darstellen darf.
export function canonicalize(value) {
  const state = { out: "" };
  emit(value, 0, [], state);
  return state.out;
}

// Mitglieder eines Objekts einzeln kanonisch, sortiert: [[schluessel, '"schluessel":wert'], ...].
// verify.js setzt daraus das ganze Dokument, das Dokument ohne "integrity" und den contentHash-Umfang zusammen,
// ohne das grosse Paket mehrfach zu kanonisieren.
export function canonicalMembers(record) {
  if (record === null || typeof record !== "object" || Array.isArray(record) || !isPlainRecord(record)) {
    throw new CanonicalError("json.type", "");
  }
  const keys = Object.keys(record).sort();
  const members = [];
  for (const key of keys) {
    if (key === "__proto__") throw new CanonicalError("json.proto", "/__proto__");
    const state = { out: quote(key, []) + ":" };
    emit(record[key], 1, [key], state);
    members.push([key, state.out]);
  }
  return members;
}

export function joinMembers(members) {
  let out = "{";
  for (let i = 0; i < members.length; i += 1) {
    if (i) out += ",";
    out += members[i][1];
  }
  return out + "}";
}

export function utf8Bytes(text) {
  return encoder.encode(text);
}

export function canonicalBytes(value) {
  return encoder.encode(canonicalize(value));
}

// Bytes aus ArrayBuffer oder einer Ansicht darauf; Strings sind keine Bytes (BOM/UTF-8 waeren nicht pruefbar).
export function toUint8(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new CanonicalError("encoding.input", "");
}

export function hasUtf8Bom(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

// Strikt: fatal = ungueltiges UTF-8 wirft statt U+FFFD; ignoreBOM = ein BOM bliebe sichtbar statt still zu
// verschwinden (Pocket lehnt es vorher ohnehin ab).
export function decodeUtf8Strict(input) {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const bytes = toUint8(input);
  try {
    return decoder.decode(bytes);
  } catch (error) {
    // fatal:true meldet ungueltiges UTF-8 als TypeError (WHATWG Encoding); alles andere ist kein Kodierfehler.
    if (error instanceof TypeError) throw new CanonicalError("encoding.utf8", "");
    throw error;
  }
}

export function bytesEqual(left, right) {
  const a = toUint8(left);
  const b = toUint8(right);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function toHex(bytes) {
  const view = toUint8(bytes);
  let out = "";
  for (let i = 0; i < view.length; i += 1) out += HEX[view[i]];
  return out;
}

// SHA-256 ueber Bytes bzw. UTF-8 eines Strings. crypto.subtle gibt es nur im sicheren Kontext (https, localhost,
// Node 22): ohne ihn bleibt Pruefen unmoeglich - darum ein klarer Fehler statt eines selbstgebauten Ersatzes.
export async function sha256Hex(data) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle || typeof subtle.digest !== "function") throw new CanonicalError("integrity.unavailable", "");
  const bytes = typeof data === "string" ? encoder.encode(data) : toUint8(data);
  const digest = await subtle.digest("SHA-256", bytes);
  return toHex(new Uint8Array(digest));
}

// Vergleich nach UTF-16-Codeeinheiten (Vertrag 4.17/5); in JS ist das der normale String-Vergleich.
export function compareUtf16(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

// Unicode-Codepoints wie for...of (einzelne Surrogate zaehlen je 1). Schneller Weg ohne Surrogate: length.
export function codepointLength(text) {
  if (!HAS_SURROGATE.test(text)) return text.length;
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i += 1;
    }
    count += 1;
  }
  return count;
}

// LF-Index-Zeilen (Vertrag 4.10): Zeile = Abschnitt zwischen \n; leerer Text = 0 Zeilen; kein splitlines().
export function lineCount(text) {
  if (text === "") return 0;
  let count = 1;
  let at = text.indexOf("\n");
  while (at !== -1) {
    count += 1;
    at = text.indexOf("\n", at + 1);
  }
  return count;
}

export function splitLines(text) {
  return text === "" ? [] : text.split("\n");
}
