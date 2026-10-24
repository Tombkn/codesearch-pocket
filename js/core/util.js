// Kleine Helfer ohne DOM: Python-Darstellung, Wortsuche, Pfade. Von Engine, App und verify.mjs genutzt.

export const PREFIX = "/project1/CodeSearch_Tutorial";

export function abs(rel) {
  if (rel == null) return "";
  if (rel === "") return PREFIX;
  return rel.startsWith("/") ? rel : `${PREFIX}/${rel}`;
}

export function rel(path) {
  if (!path) return "";
  if (path === PREFIX) return "";
  return path.startsWith(PREFIX + "/") ? path.slice(PREFIX.length + 1) : path;
}

export function baseName(path) {
  const text = String(path || "");
  return text.includes("/") ? text.slice(text.lastIndexOf("/") + 1) : text;
}

export function parentOf(path) {
  const text = String(path || "");
  return text.includes("/") ? text.slice(0, text.lastIndexOf("/")) : "";
}

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

// str(dict) wie in Python: die Tour vergleicht 'selected' mit dieser Darstellung (z. B. "'anchor': True").
export function pyStr(value) {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return String(value);
  }
  if (typeof value === "string") {
    const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
    let body = value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
    if (quote === "'") body = body.replace(/'/g, "\\'");
    return quote + body + quote;
  }
  if (Array.isArray(value)) return "[" + value.map(pyStr).join(", ") + "]";
  if (value instanceof Set) return value.size ? "{" + [...value].map(pyStr).join(", ") + "}" : "set()";
  if (typeof value === "object") {
    return "{" + Object.entries(value).map(([k, v]) => pyStr(k) + ": " + pyStr(v)).join(", ") + "}";
  }
  return String(value);
}

export function casefold(text) {
  return String(text ?? "").toLowerCase();
}

// Wortsuche wie CodeSearch: 'tick' = ganzes Wort, 'tick*' Anfang, '*tick' Ende, '*tick*' irgendwo.
const WORD = /[A-Za-z0-9_]/;

function escapeRx(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function termRegex(term, { caseSensitive = false, whole = true } = {}) {
  let core = term;
  let left = whole;
  let right = whole;
  if (core.startsWith("*")) { left = false; core = core.slice(1); }
  if (core.endsWith("*")) { right = false; core = core.slice(0, -1); }
  if (!core) return null;
  const parts = core.split("*").map(escapeRx).join(".*?");
  const needLeft = left && WORD.test(core[0]);
  const needRight = right && WORD.test(core[core.length - 1]);
  const pattern = (needLeft ? "(?<![A-Za-z0-9_])" : "") + parts + (needRight ? "(?![A-Za-z0-9_])" : "");
  return new RegExp(pattern, caseSensitive ? "" : "i");
}

// Suchtext -> Pruef-Funktion. Woerter = UND, ^wort = ohne, a | b = ODER, "a b" = Phrase.
export function compileQuery(query, { caseSensitive = false, regex = false, whole = true } = {}) {
  const text = String(query || "").trim();
  if (!text) return null;
  if (regex) {
    try {
      const rx = new RegExp(text, caseSensitive ? "" : "i");
      return (line) => rx.test(line);
    } catch {
      return () => false;
    }
  }
  const alternatives = text.split(/\s+\|\s+|\|/).map((s) => s.trim()).filter(Boolean);
  const groups = alternatives.map((alt) => {
    const tokens = [];
    const rx = /"([^"]+)"|(\S+)/g;
    let m;
    while ((m = rx.exec(alt))) {
      if (m[1] !== undefined) tokens.push({ phrase: true, text: m[1] });
      else tokens.push({ phrase: false, text: m[2] });
    }
    return tokens.map((tok) => {
      const negative = !tok.phrase && tok.text.startsWith("^");
      const raw = negative ? tok.text.slice(1) : tok.text;
      const re = tok.phrase
        ? new RegExp(escapeRx(raw), caseSensitive ? "" : "i")
        : termRegex(raw, { caseSensitive, whole });
      return { negative, re };
    }).filter((t) => t.re);
  });
  return (line) => groups.some((tokens) => tokens.length && tokens.every((t) => (t.negative ? !t.re.test(line) : t.re.test(line))));
}

export function short(text, max = 60) {
  const value = String(text ?? "");
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
}

export function fmtNum(value) {
  if (typeof value === "boolean") return value ? "An" : "Aus";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") || "0";
  }
  return String(value ?? "");
}

let serial = 0;
export function uid(prefix) {
  serial += 1;
  return `${prefix}-${Date.now().toString(36)}${serial.toString(36)}`;
}
