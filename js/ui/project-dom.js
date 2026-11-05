// DOM-Bausteine der Projektansichten (Vertrag Abschnitt 14). Paketinhalte gelangen nur als Textknoten ins DOM.
// Attribute setzt nur setAttr() mit einer festen Namensliste: nie href/src/style/on*, nie innerHTML - so kann ein
// manipuliertes Paket weder ein Element noch ein Attribut erzeugen, egal was in Namen, Code oder Kommentaren steht.
// Rein bis auf das uebergebene document: kein globales document, damit zwei Projekte (und jsdom-Tests) getrennt laufen.

export const SVG_NS = "http://www.w3.org/2000/svg";

// Attributnamen, die Werte tragen duerfen (auch Paketwerte wie aria-label/title). Alles andere ist ein Programmierfehler.
const ATTR_OK = new Set(["class", "role", "tabindex", "type", "title", "hidden", "disabled", "dir", "lang", "for", "id",
  "inputmode", "autocomplete", "autocapitalize", "spellcheck", "placeholder", "enterkeyhint", "value", "min", "max",
  "step", "colspan", "rowspan", "scope", "viewBox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "rx", "ry", "d",
  "transform", "focusable", "preserveAspectRatio", "text-anchor", "dominant-baseline"]);
const DATA_ATTR = /^data-[a-z][a-z0-9-]*$/;
const ARIA_ATTR = /^aria-[a-z]+$/;

export function setAttr(node, name, value) {
  if (!ATTR_OK.has(name) && !DATA_ATTR.test(name) && !ARIA_ATTR.test(name)) {
    throw new TypeError(`project-dom: Attribut nicht erlaubt: ${name}`);
  }
  node.setAttribute(name, String(value));
}

export function el(doc, tag, cls = "", text = null) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text !== null && text !== undefined) node.textContent = String(text);
  return node;
}

// SVG-Element mit Attributen aus eigenem Code (Schluessel sind Konstanten, Werte meist berechnete Zahlen).
export function svgEl(doc, tag, attrs = null) {
  const node = doc.createElementNS(SVG_NS, tag);
  if (attrs) for (const key of Object.keys(attrs)) setAttr(node, key, attrs[key]);
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Unsichtbare oder richtungsumkehrende Zeichen (Trojan-Source, Nullbreite, Steuerzeichen). Sie bleiben im Text
// (textContent ist exakt), bekommen aber einen eigenen, isolierten Span mit sichtbarer Marke "U+202E" per CSS.
// Ueber Unicode-Eigenschaften statt einer Handliste, damit auch Tag-Zeichen (U+E0000-E007F, versteckter ASCII-Text),
// Variation Selectors, CGJ, Hangul-Fueller und U+2028/2029 sichtbar werden:
// Cc ohne Tab/LF (als Bereiche), Cf (Bidi, Nullbreite, U+0600-0605, BOM ...), Zl/Zp, Default_Ignorable_Code_Point.
// Folge: auch ZWJ und VS16 in Emoji-Folgen tragen eine Marke. CR wird im Code am Zeilenende nicht markiert (CRLF).
const MARKED = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
const MARKED_ALL = new RegExp(MARKED.source, "gu");

export function hasMarked(text) {
  return typeof text === "string" && MARKED.test(text);
}

export function markedCode(char) {
  return char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
}

// Zerlegt text in Stuecke [{text, marked}] - marked = genau ein markiertes Zeichen (Codepoint; Tag-Zeichen sind zwei
// UTF-16-Einheiten und duerfen nie zerteilt werden).
export function splitMarked(text, { keepTrailingCR = false } = {}) {
  if (!MARKED.test(text)) return [{ text, marked: false }];
  const parts = [];
  let last = 0;
  MARKED_ALL.lastIndex = 0;
  let m;
  while ((m = MARKED_ALL.exec(text)) !== null) {
    const at = m.index;
    if (keepTrailingCR && m[0] === "\r" && at === text.length - 1) continue;
    if (at > last) parts.push({ text: text.slice(last, at), marked: false });
    parts.push({ text: m[0], marked: true });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), marked: false });
  return parts;
}

export function markedSpan(doc, char, extraClass = "") {
  const span = el(doc, "span", extraClass ? `pv-ctl ${extraClass}` : "pv-ctl", char);
  setAttr(span, "data-cp", markedCode(char));
  return span;
}

// Paketzeichenkette exakt und richtungsisoliert (<bdi>) anhaengen; markierte Zeichen sichtbar machen.
export function appendExact(doc, parent, text, cls = "pv-u") {
  const value = typeof text === "string" ? text : String(text ?? "");
  const box = el(doc, "bdi", cls);
  for (const part of splitMarked(value)) {
    if (part.marked) box.appendChild(markedSpan(doc, part.text));
    else box.appendChild(doc.createTextNode(part.text));
  }
  parent.appendChild(box);
  return box;
}

export function exactNode(doc, text, cls = "pv-u") {
  const holder = doc.createDocumentFragment();
  return appendExact(doc, holder, text, cls);
}

// Anzeige-Fassung fuer Stellen ohne Unterelemente (SVG-Beschriftung, aria-label): markierte Zeichen als "<U+202E>",
// Laenge begrenzt. Die exakte Fassung steht immer in Details oder Infozeile.
export function displayText(text, max = 0) {
  let out = String(text ?? "").replace(MARKED_ALL, (c) => `<U+${markedCode(c)}>`);
  if (max > 0 && out.length > max) {
    let cut = Math.max(1, max - 1);
    const code = out.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    out = `${out.slice(0, cut)}…`;
  }
  return out;
}

// Knopf mit festem Text (UI-Konstante) und optionalem exaktem Paketteil dahinter.
export function button(doc, label, onClick, { cls = "pv-btn", title = null, disabled = false, exact = null, pressed = null } = {}) {
  const node = el(doc, "button", cls);
  setAttr(node, "type", "button");
  if (label) node.appendChild(doc.createTextNode(label));
  if (exact !== null) appendExact(doc, node, exact);
  if (title) setAttr(node, "title", title);
  if (pressed !== null) setAttr(node, "aria-pressed", pressed ? "true" : "false");
  node.disabled = Boolean(disabled);
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

// Feste Beschriftungen ueber Map: Paketwerte (kind, status, reason) sind gueltige Schluessel wie "constructor".
export function labelMap(entries) {
  return new Map(entries);
}

export function labelOf(map, key, fallback = null) {
  if (map.has(key)) return map.get(key);
  return fallback === null ? String(key ?? "") : fallback;
}

export function hasAction(actions, name) {
  return isRecord(actions) && typeof actions[name] === "function";
}

// Aktion aufrufen, wenn die Huelle sie anbietet; fehlt sie, bleibt der Knopf aus (siehe hasAction).
export function callAction(actions, name, ...args) {
  if (!hasAction(actions, name)) return undefined;
  return actions[name](...args);
}

export const CERTAINTY_LABELS = labelMap([
  ["captured", "erfasst"],
  ["static", "statisch"],
  ["unknown", "unbekannt"],
]);
export const CERTAINTY_HINTS = labelMap([
  ["captured", "von TD beim Export ohne Codeausführung aufgelöst"],
  ["static", "fester Verweis, ohne Ausführung nachgeschlagen; belegt keine Ausführung"],
  ["unknown", "Ziel erst zur Laufzeit bekannt"],
]);
const CERTAINTY_CLASS = labelMap([["captured", "pv-cert-captured"], ["static", "pv-cert-static"], ["unknown", "pv-cert-unknown"]]);

export function certaintyChip(doc, certainty) {
  const label = labelOf(CERTAINTY_LABELS, certainty, "unbekannt");
  const chip = el(doc, "span", `pv-cert ${labelOf(CERTAINTY_CLASS, certainty, "pv-cert-unknown")}`, label);
  setAttr(chip, "title", labelOf(CERTAINTY_HINTS, certainty, ""));
  return chip;
}
