// Syntax-Hervorhebung des Code Readers (Vertrag 14): Python (mit mehrzeiligen Strings), GLSL (mit Blockkommentaren),
// sonst reiner Text. Ergebnis sind Token [klasse, start, ende] ueber der UNVERAENDERTEN Zeile - die Ansicht legt je
// Token einen Span mit textContent an, die Spans ergeben zusammen exakt die Zeile (keine Formatierung, keine Ersetzung).
// Ein Durchgang je Zeichen ohne rueckverfolgende Regex und ohne Rueckblick auf schon Gelesenes: eine Zeile mit 1 Mio.
// Zeichen bleibt linear (Testvektoren in tools/projects-views-tests.mjs: Text, Zahlen, Strings, Kommentare).
// Zustand am Zeilenende (offener String/Kommentar) wird je Quelle einmal vorab berechnet (lineStates), damit das
// Fenster an jeder Stelle der Datei richtig einsetzt.

export const HIGHLIGHT_CAP = 4000;

const PY_KEYWORDS = new Set(["False", "None", "True", "and", "as", "assert", "async", "await", "break", "class",
  "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is",
  "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield"]);
// Python-Builtins und die TD-Globals (op, me, parent, ...) - nur Darstellung, keine Bedeutungsbehauptung.
const PY_BUILTINS = new Set(["self", "cls", "print", "len", "range", "str", "int", "float", "bool", "dict", "list",
  "set", "tuple", "frozenset", "bytes", "isinstance", "issubclass", "getattr", "setattr", "hasattr", "delattr", "super",
  "type", "object", "enumerate", "zip", "map", "filter", "sorted", "reversed", "min", "max", "abs", "round", "sum",
  "any", "all", "open", "repr", "iter", "next", "callable", "vars", "dir", "id", "hash", "format", "divmod", "pow",
  "ord", "chr", "hex", "oct", "bin", "property", "staticmethod", "classmethod", "Exception", "ValueError",
  "TypeError", "KeyError", "IndexError", "AttributeError", "RuntimeError", "NotImplementedError", "StopIteration",
  "op", "ops", "opex", "me", "parent", "root", "mod", "iop", "ipar", "ext", "run", "debug", "absTime", "project",
  "app", "ui", "tdu", "td"]);
const PY_STRING_PREFIX = new Set(["r", "u", "b", "f", "br", "rb", "fr", "rf"]);

const GLSL_KEYWORDS = new Set(["attribute", "const", "uniform", "varying", "buffer", "shared", "coherent", "volatile",
  "restrict", "readonly", "writeonly", "layout", "centroid", "flat", "smooth", "noperspective", "patch", "sample",
  "break", "continue", "do", "for", "while", "switch", "case", "default", "if", "else", "subroutine", "in", "out",
  "inout", "invariant", "precise", "discard", "return", "struct", "precision", "highp", "mediump", "lowp", "true",
  "false"]);
const GLSL_TYPES = new Set(["void", "bool", "int", "uint", "float", "double", "vec2", "vec3", "vec4", "dvec2", "dvec3",
  "dvec4", "bvec2", "bvec3", "bvec4", "ivec2", "ivec3", "ivec4", "uvec2", "uvec3", "uvec4", "mat2", "mat3", "mat4",
  "mat2x2", "mat2x3", "mat2x4", "mat3x2", "mat3x3", "mat3x4", "mat4x2", "mat4x3", "mat4x4", "dmat2", "dmat3", "dmat4",
  "sampler1D", "sampler2D", "sampler3D", "samplerCube", "sampler2DArray", "sampler2DShadow", "samplerBuffer",
  "isampler2D", "usampler2D", "isampler3D", "usampler3D", "image2D", "image3D", "iimage2D", "uimage2D", "imageBuffer",
  "atomic_uint"]);
const GLSL_BUILTINS = new Set(["radians", "degrees", "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh",
  "tanh", "pow", "exp", "log", "exp2", "log2", "sqrt", "inversesqrt", "abs", "sign", "floor", "ceil", "trunc", "round",
  "fract", "mod", "modf", "min", "max", "clamp", "mix", "step", "smoothstep", "length", "distance", "dot", "cross",
  "normalize", "reflect", "refract", "faceforward", "matrixCompMult", "transpose", "inverse", "determinant",
  "lessThan", "greaterThan", "equal", "notEqual", "any", "all", "not", "texture", "textureLod", "texelFetch",
  "textureSize", "imageLoad", "imageStore", "imageSize", "dFdx", "dFdy", "fwidth", "barrier", "memoryBarrier",
  "floatBitsToInt", "intBitsToFloat", "gl_FragCoord", "gl_Position", "gl_FragDepth", "gl_GlobalInvocationID",
  "gl_LocalInvocationID", "gl_WorkGroupID", "gl_VertexID", "gl_InstanceID", "main"]);

// Bezeichner: ASCII schnell, sonst Unicode-Kategorien wie Python (Buchstaben, Ziffern, Verbinder).
const ID_START = /[\p{L}\p{Nl}_]/u;
const ID_PART = /[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}]/u;

function isAsciiIdStart(c) {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

function isAsciiIdPart(c) {
  return isAsciiIdStart(c) || (c >= 48 && c <= 57);
}

function isDigit(c) {
  return c >= 48 && c <= 57;
}

function isSpace(c) {
  return c === 32 || c === 9 || c === 12 || c === 11;
}

// Laenge des Zeichens an i in UTF-16-Einheiten (Surrogatpaare nie zerteilen).
function charLen(line, i) {
  const c = line.charCodeAt(i);
  if (c >= 0xd800 && c <= 0xdbff && i + 1 < line.length) {
    const d = line.charCodeAt(i + 1);
    if (d >= 0xdc00 && d <= 0xdfff) return 2;
  }
  return 1;
}

function idStartAt(line, i) {
  const c = line.charCodeAt(i);
  if (c < 128) return isAsciiIdStart(c);
  const n = charLen(line, i);
  return ID_START.test(line.slice(i, i + n));
}

function idEnd(line, i) {
  const n = line.length;
  let j = i;
  while (j < n) {
    const c = line.charCodeAt(j);
    if (c < 128) {
      if (!isAsciiIdPart(c)) break;
      j += 1;
      continue;
    }
    const len = charLen(line, j);
    if (!ID_PART.test(line.slice(j, j + len))) break;
    j += len;
  }
  return j;
}

function numberEnd(line, i) {
  const n = line.length;
  let j = i;
  // "Schon ein x/X in dieser Zahl" wird beim Lesen mitgefuehrt statt je Vorzeichen den bisherigen Zahltext neu zu
  // pruefen: sonst waere eine lange Zahl ohne Trenner ("1e+1e+...", 1 Mio. Zeichen) quadratisch teuer.
  let sawX = false;
  while (j < n) {
    const c = line.charCodeAt(j);
    if (isAsciiIdPart(c) || c === 46) {
      if (c === 120 || c === 88) sawX = true;
      j += 1;
      continue;
    }
    // Exponent mit Vorzeichen (1e-5), nur nach e/E einer Dezimalzahl (nicht in Hex wie 0x1e+2).
    if ((c === 43 || c === 45) && j > i) {
      const prev = line.charCodeAt(j - 1);
      if ((prev === 101 || prev === 69) && !sawX && j + 1 < n && isDigit(line.charCodeAt(j + 1))) {
        j += 1;
        continue;
      }
    }
    break;
  }
  return j;
}

// Ende eines Strings ab from (Index nach dem schliessenden Anfuehrungszeichen) oder -1. Backslash schuetzt das
// naechste Zeichen auch in Raw-Strings (r"\"" endet nicht am zweiten Anfuehrungszeichen).
function stringEnd(line, from, quote) {
  const n = line.length;
  const q = quote.charCodeAt(0);
  const triple = quote.length === 3;
  for (let k = from; k < n; k += 1) {
    const c = line.charCodeAt(k);
    if (c === 92) {
      k += 1;
      continue;
    }
    if (c === q && (!triple || (line.charCodeAt(k + 1) === q && line.charCodeAt(k + 2) === q))) return k + quote.length;
  }
  return -1;
}

// Einzeilig begonnener String laeuft nur bei Backslash am Zeilenende (Fortsetzung) in die naechste Zeile.
function continues(line) {
  let end = line.length;
  if (end > 0 && line.charCodeAt(end - 1) === 13) end -= 1;
  let count = 0;
  while (end - count - 1 >= 0 && line.charCodeAt(end - count - 1) === 92) count += 1;
  return count % 2 === 1;
}

// Punktation/sonstige Zeichen bis zum naechsten bedeutungstragenden Zeichen zusammenfassen (weniger Spans).
function plainEnd(line, i, stops) {
  const n = line.length;
  let j = i + charLen(line, i);
  while (j < n) {
    const c = line.charCodeAt(j);
    if (isSpace(c) || stops(c) || isDigit(c) || idStartAt(line, j)) break;
    j += charLen(line, j);
  }
  return j;
}

const PY_STOP = (c) => c === 35 || c === 39 || c === 34;

// Python: Zustand "" (normal) oder das offene Anfuehrungszeichen (''' """ ' ").
export function scanPython(line, state, emit) {
  const n = line.length;
  let i = 0;
  if (state) {
    const end = stringEnd(line, 0, state);
    if (end === -1) {
      if (n) emit("str", 0, n);
      return state.length === 3 || continues(line) ? state : "";
    }
    emit("str", 0, end);
    i = end;
  }
  let expect = "";
  let atStart = i === 0;
  while (i < n) {
    const c = line.charCodeAt(i);
    if (isSpace(c) || c === 13) {
      let j = i + 1;
      while (j < n && (isSpace(line.charCodeAt(j)) || line.charCodeAt(j) === 13)) j += 1;
      emit("", i, j);
      i = j;
      continue;
    }
    if (c === 35) {
      emit("cm", i, n);
      return "";
    }
    let quoteAt = -1;
    let wordEnd = -1;
    if (c === 39 || c === 34) quoteAt = i;
    else if (idStartAt(line, i)) {
      wordEnd = idEnd(line, i);
      const next = line.charCodeAt(wordEnd);
      if ((next === 39 || next === 34) && wordEnd - i <= 2 && PY_STRING_PREFIX.has(line.slice(i, wordEnd).toLowerCase())) quoteAt = wordEnd;
    }
    if (quoteAt !== -1) {
      const q = line[quoteAt];
      const quote = line.startsWith(q + q + q, quoteAt) ? q + q + q : q;
      const end = stringEnd(line, quoteAt + quote.length, quote);
      atStart = false;
      expect = "";
      if (end === -1) {
        emit("str", i, n);
        return quote.length === 3 || continues(line) ? quote : "";
      }
      emit("str", i, end);
      i = end;
      continue;
    }
    if (wordEnd !== -1) {
      const word = line.slice(i, wordEnd);
      let cls = "";
      if (expect === "def") cls = "fn";
      else if (expect === "class") cls = "ty";
      else if (PY_KEYWORDS.has(word)) cls = "kw";
      else if (PY_BUILTINS.has(word)) cls = "bi";
      expect = word === "def" || word === "class" ? word : "";
      emit(cls, i, wordEnd);
      i = wordEnd;
      atStart = false;
      continue;
    }
    if (isDigit(c) || (c === 46 && isDigit(line.charCodeAt(i + 1)))) {
      const j = numberEnd(line, i);
      emit("num", i, j);
      i = j;
      atStart = false;
      expect = "";
      continue;
    }
    if (c === 64 && atStart) {
      // Dekorator am Zeilenanfang: @name.attr (auch @name(...)) - nur der Name ist Dekorator-Token.
      let j = i + 1;
      while (j < n && (idStartAt(line, j) || line.charCodeAt(j) === 46)) j = line.charCodeAt(j) === 46 ? j + 1 : idEnd(line, j);
      emit("dec", i, j);
      i = j;
      atStart = false;
      continue;
    }
    const j = plainEnd(line, i, PY_STOP);
    emit("", i, j);
    i = j;
    atStart = false;
    expect = "";
  }
  return "";
}

const GLSL_STOP = (c) => c === 47 || c === 34 || c === 35;

// GLSL: Zustand "" oder "/*" (offener Blockkommentar).
export function scanGlsl(line, state, emit) {
  const n = line.length;
  let i = 0;
  if (state === "/*") {
    const close = line.indexOf("*/");
    if (close === -1) {
      if (n) emit("cm", 0, n);
      return "/*";
    }
    emit("cm", 0, close + 2);
    i = close + 2;
  }
  let atStart = true;
  for (let k = 0; k < i; k += 1) if (!isSpace(line.charCodeAt(k))) atStart = false;
  while (i < n) {
    const c = line.charCodeAt(i);
    if (isSpace(c) || c === 13) {
      let j = i + 1;
      while (j < n && (isSpace(line.charCodeAt(j)) || line.charCodeAt(j) === 13)) j += 1;
      emit("", i, j);
      i = j;
      continue;
    }
    if (c === 47 && line.charCodeAt(i + 1) === 47) {
      emit("cm", i, n);
      return "";
    }
    if (c === 47 && line.charCodeAt(i + 1) === 42) {
      const close = line.indexOf("*/", i + 2);
      if (close === -1) {
        emit("cm", i, n);
        return "/*";
      }
      emit("cm", i, close + 2);
      i = close + 2;
      atStart = false;
      continue;
    }
    if (c === 35 && atStart) {
      // Praeprozessor bis Zeilenende oder bis zu einem Kommentar (der danach normal weiterlaeuft).
      let j = i + 1;
      while (j < n && !(line.charCodeAt(j) === 47 && (line.charCodeAt(j + 1) === 47 || line.charCodeAt(j + 1) === 42))) j += 1;
      emit("pp", i, j);
      i = j;
      atStart = false;
      continue;
    }
    if (c === 34) {
      const end = stringEnd(line, i + 1, '"');
      const stop = end === -1 ? n : end;
      emit("str", i, stop);
      i = stop;
      atStart = false;
      continue;
    }
    if (idStartAt(line, i)) {
      const j = idEnd(line, i);
      const word = line.slice(i, j);
      let cls = "";
      if (GLSL_KEYWORDS.has(word)) cls = "kw";
      else if (GLSL_TYPES.has(word)) cls = "ty";
      else if (GLSL_BUILTINS.has(word) || /^[suv]?TD[A-Z0-9]/.test(word)) cls = "bi";
      emit(cls, i, j);
      i = j;
      atStart = false;
      continue;
    }
    if (isDigit(c) || (c === 46 && isDigit(line.charCodeAt(i + 1)))) {
      const j = numberEnd(line, i);
      emit("num", i, j);
      i = j;
      atStart = false;
      continue;
    }
    const j = plainEnd(line, i, GLSL_STOP);
    emit("", i, j);
    i = j;
    atStart = false;
  }
  return "";
}

export function scanText(line, state, emit) {
  if (line.length) emit("", 0, line.length);
  return "";
}

export function scannerFor(language) {
  if (language === "python") return scanPython;
  if (language === "glsl") return scanGlsl;
  return scanText;
}

const NOOP = () => {};

// Zustand am Anfang jeder Zeile (Index = Zeile - 1). Schnellweg: Zeilen ohne Anfuehrungszeichen bzw. ohne "/*"
// koennen keinen neuen Zustand oeffnen und muessen im Normalzustand nicht gescannt werden.
export function lineStates(language, lines) {
  const scan = scannerFor(language);
  const states = new Array(lines.length);
  let state = "";
  for (let i = 0; i < lines.length; i += 1) {
    states[i] = state;
    const line = lines[i];
    if (scan === scanText) continue;
    if (state === "") {
      if (scan === scanPython && line.indexOf("'") === -1 && line.indexOf('"') === -1) continue;
      if (scan === scanGlsl && line.indexOf("/*") === -1) continue;
    }
    state = scan(line, state, NOOP);
  }
  return states;
}

// Token einer Zeile: [[klasse, start, ende], ...] lueckenlos ueber die ganze Zeile. Ab cap Zeichen wird nur noch der
// Zustand weitergerechnet; der Rest ist ein einzelnes Text-Token (Zeilen mit 1 Mio. Zeichen bleiben bedienbar).
export function tokenizeLine(language, line, state = "", cap = HIGHLIGHT_CAP) {
  const tokens = [];
  let kept = 0;
  // Ein Token, das die Grenze ueberschreitet, bleibt ganz (ein Span); erst danach beginnende Token entfallen.
  const emit = (cls, start, end) => {
    if (start >= cap || end <= start) return;
    const last = tokens.length ? tokens[tokens.length - 1] : null;
    if (last && last[0] === cls && last[2] === start) last[2] = end;
    else tokens.push([cls, start, end]);
    kept = end;
  };
  const next = scannerFor(language)(line, state, emit);
  if (kept < line.length) {
    const last = tokens.length ? tokens[tokens.length - 1] : null;
    if (last && last[0] === "" && last[2] === kept) last[2] = line.length;
    else tokens.push(["", kept, line.length]);
  }
  return { tokens, state: next };
}

// Teilt Token an Trefferraendern (Suche in der Datei): Stuecke [klasse, start, ende, treffer].
export function splitAtMatches(tokens, matches) {
  if (!matches || !matches.length) return tokens.map(([cls, s, e]) => [cls, s, e, false]);
  const out = [];
  let m = 0;
  for (const [cls, start, end] of tokens) {
    let pos = start;
    while (pos < end) {
      while (m < matches.length && matches[m][1] <= pos) m += 1;
      const hit = m < matches.length ? matches[m] : null;
      if (!hit || hit[0] >= end) {
        out.push([cls, pos, end, false]);
        pos = end;
      } else if (hit[0] > pos) {
        out.push([cls, pos, hit[0], false]);
        pos = hit[0];
      } else {
        const stop = Math.min(end, hit[1]);
        out.push([cls, pos, stop, true]);
        pos = stop;
      }
    }
  }
  return out;
}
