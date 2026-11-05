// Projektansichten DETAILS und VERSTEHEN (Vertrag 4.11/4.12/14, Auftrag Mobile Explorer).
// DETAILS: Name, Typ, Original- und relativer Pfad, Parent, Leitungen mit Indizes, Parameter nach Grammatik 4.11
// (ruhender Constant-Wert gekennzeichnet, unknown/omitted als eigener Marker, Default nur bei Custom und als
// "Default, kein historischer Wert"), Codequellen, belegte Verweise mit Gewissheit.
// VERSTEHEN: Zusammengehoerigkeit, Codequellen, Aufrufkandidaten, Leser/Schreiber, Ein-/Ausgaben, externe
// Abhaengigkeiten - jede Aussage mit Beleg (Quelle+Zeile bzw. Verweis) und Gewissheit; statisch, ohne TD-Ausfuehrung.
// Rueckkehr erhaelt Kontext: die Scrollposition je (Modell, Ziel) bleibt fuer die Lebensdauer des Modells gemerkt.

import {
  appendExact, button, callAction, certaintyChip, displayText, el, hasAction, isRecord, labelMap, labelOf, setAttr,
} from "./project-dom.js";
import { edgeReasonText, entryProblem, referenceKindText, STATUS_TEXT, unresolvedText } from "./project-code.js";

const LIST_CAP = 40;
const SCROLL = new WeakMap();

const MODE_TEXT = labelMap([["constant", "Constant"], ["expression", "Expression"], ["export", "Export"], ["bind", "Bind"]]);
const UNKNOWN_TEXT = labelMap([
  ["mode-expression", "unbekannt – Expression, ohne TD-Ausführung nicht auswertbar"],
  ["mode-bind", "unbekannt – Bind, ohne TD-Ausführung nicht auswertbar"],
  ["mode-export", "unbekannt – Export, ohne TD-Ausführung nicht auswertbar"],
  ["size", "unbekannt – zu lang, nicht übertragen"],
]);
const OMITTED_TEXT = labelMap([["secret", "ausgelassen: Geheimnis-Fund"], ["size", "ausgelassen: zu lang"]]);
const FLAG_TEXT = labelMap([
  ["bypass", "Bypass"], ["lock", "Lock"], ["display", "Display"], ["render", "Render"], ["viewer", "Viewer"],
  ["expose", "Expose"], ["allowCooking", "Cooking erlaubt"], ["showDocked", "Docks sichtbar"],
]);
const ACCESS_TEXT = labelMap([["init", "initialisiert"], ["read", "liest"], ["write", "schreibt"], ["mutate", "ändert"]]);
// Vertrag 4.6: Faehigkeiten, die v1 nicht erfasst, werden als "nicht exportiert" eingeblendet.
const MISSING_CAPABILITIES = labelMap([
  ["effectiveValues", "effektive Parameterwerte"], ["storage", "Storage"], ["channels", "CHOP-Kanäle"], ["media", "Medien"],
]);
const ROLE_TEXT = labelMap([["extension", "Extension"], ["callbacks", "Callbacks"], ["glsl", "GLSL"], ["execute", "Execute"], ["module", "Modul"]]);
export const STATIC_NOTE = "Statisch aus der Momentaufnahme abgeleitet – keine TD-Ausführung, keine Vollständigkeit.";

// ------------------------------------------------------------------ Parameter (Vertrag 4.11), rein

// Darstellung eines {t, v}-Werts: Floats und Zahlen woertlich (nie Number()), Wahrheitswerte nur bei t:"bool",
// unbekannt/ausgelassen bleiben Marker - nie wird ein Default eingesetzt.
export function valueText(value) {
  if (!isRecord(value)) return { kind: "unknown", text: "unbekannt" };
  if (value.t === "unknown") return { kind: "unknown", text: labelOf(UNKNOWN_TEXT, value.reason, "unbekannt") };
  if (value.omitted === "secret") return { kind: "omitted", text: labelOf(OMITTED_TEXT, "secret") };
  if (typeof value.v !== "string") return { kind: "unknown", text: "unbekannt" };
  if (value.t === "bool") return { kind: "value", t: "bool", text: value.v === "1" ? "An" : "Aus", raw: value.v };
  if (value.t === "pulse") return { kind: "value", t: "pulse", text: "Pulse – kein gespeicherter Wert", raw: "" };
  if (value.t === "str" && value.v === "") return { kind: "value", t: "str", text: "", empty: true };
  return { kind: "value", t: value.t, text: value.v };
}

function menuLabel(p, name) {
  if (!isRecord(p.menu) || !Array.isArray(p.menu.names) || !Array.isArray(p.menu.labels)) return null;
  const i = p.menu.names.indexOf(name);
  return i >= 0 && typeof p.menu.labels[i] === "string" ? p.menu.labels[i] : null;
}

function exprRow(label, text, omitted) {
  if (typeof text === "string") return { label, kind: "expr", text };
  if (typeof omitted === "string") return { label, kind: "omitted", text: labelOf(OMITTED_TEXT, omitted, "ausgelassen") };
  return { label, kind: "unknown", text: "nicht übertragen" };
}

// Zeilen [{label, kind: value|unknown|omitted|expr|meta, text, dormant?, t?, raw?, empty?}] eines Parameters.
export function parameterRows(p) {
  const rows = [];
  rows.push({ label: "Modus", kind: "meta", text: labelOf(MODE_TEXT, p.mode) });
  const shown = valueText(p.value);
  if (shown.kind === "value" && shown.t === "menu") {
    const label = menuLabel(p, shown.text);
    rows.push({ label: "Wert", ...shown, note: label !== null ? `Menüeintrag: ${label}` : null });
  } else {
    rows.push({ label: "Wert", ...shown });
  }
  if (p.mode === "expression") rows.push(exprRow("Expression", p.expr, p.omitted));
  else if (typeof p.expr === "string") rows.push({ label: "Expression (inaktiv)", kind: "expr", text: p.expr });
  if (p.mode === "bind") rows.push(exprRow("Bind", p.bindExpr, p.omitted));
  else if (typeof p.bindExpr === "string") rows.push({ label: "Bind (inaktiv)", kind: "expr", text: p.bindExpr });
  if (p.mode === "export") {
    const ex = isRecord(p.export) ? p.export : null;
    rows.push({ label: "Export von", kind: ex ? "expr" : "unknown", text: ex ? `${ex.op ?? "?"} · ${ex.source ?? "?"}` : "unbekannt" });
  }
  if (p.mode !== "constant" && isRecord(p.storedConstant)) {
    // Vertrag 4.11: der ruhende Constant-Wert ist NIE der Wert - darum eigene Zeile mit eigenem Marker.
    rows.push({ label: "Ruhender Constant-Wert (nicht aktiv)", ...valueText(p.storedConstant), dormant: true });
  }
  if (p.custom === true && p.default !== null && p.default !== undefined) {
    rows.push({ label: "Default, kein historischer Wert", ...valueText(p.default), isDefault: true });
  }
  if (p.custom === true && typeof p.help === "string" && p.help) rows.push({ label: "Hilfe", kind: "meta", text: p.help });
  if (p.custom === true && isRecord(p.menu) && Array.isArray(p.menu.names)) {
    const labels = Array.isArray(p.menu.labels) ? p.menu.labels : [];
    rows.push({ label: "Menü", kind: "meta", text: p.menu.names.map((n, i) => (labels[i] !== undefined ? `${n} = ${labels[i]}` : n)).join("\n") });
  }
  if (p.custom === true && isRecord(p.range)) {
    const r = p.range;
    const part = (v) => (typeof v === "string" ? v : "–");
    rows.push({
      label: "Bereich", kind: "meta",
      text: `${part(r.min)} … ${part(r.max)}${r.clampMin ? " (unten fest)" : ""}${r.clampMax ? " (oben fest)" : ""} · Regler ${part(r.normMin)} … ${part(r.normMax)}`,
    });
  }
  return rows;
}

export function parameterChips(p) {
  const chips = [labelOf(MODE_TEXT, p.mode)];
  if (p.custom === true) chips.push("Custom");
  if (typeof p.style === "string" && p.style) chips.push(p.style);
  if (p.readOnly === true) chips.push("schreibgeschützt");
  if (p.password === true) chips.push("Passwortfeld");
  if (p.custom !== true && p.isDefault === false) chips.push("geändert gegenüber TD-Default");
  return chips;
}

// ------------------------------------------------------------------ Bausteine

function section(doc, parent, title, count = null) {
  const sec = el(doc, "section", "pv-sec");
  const head = el(doc, "h3", "pv-sec-h", title);
  if (count !== null) head.appendChild(el(doc, "span", "pv-dim", ` ${count}`));
  sec.appendChild(head);
  parent.appendChild(sec);
  return sec;
}

function kv(doc, parent, label, value, { kind = "meta", mono = false } = {}) {
  const row = el(doc, "div", "pv-kv");
  row.appendChild(el(doc, "span", "pv-k", label));
  const v = el(doc, "span", `pv-v${mono ? " pv-mono" : ""}${kind === "unknown" || kind === "omitted" ? " pv-marker" : ""}`);
  // Knoten (Knopf, Chip) direkt, alles andere als exakter Text - Duck-Typing statt instanceof: Dokumente ohne
  // defaultView (z. B. createHTMLDocument) haben keinen Node-Konstruktor.
  if (value !== null && typeof value === "object" && typeof value.nodeType === "number") v.appendChild(value);
  else appendExact(doc, v, value);
  row.appendChild(v);
  parent.appendChild(row);
  return v;
}

function opLink(doc, model, actions, rel, { action = "openDetails" } = {}) {
  const op = model.op(rel);
  const label = op ? (rel === "" ? `${op.name || "/"} (Root)` : op.name) : rel;
  return button(doc, "", () => callAction(actions, action, rel), {
    cls: "pv-btn pv-btn-link", exact: label, disabled: !op || !hasAction(actions, action), title: op ? displayText(op.path, 400) : null,
  });
}

function externalChip(doc, path) {
  const chip = el(doc, "span", "pv-chip pv-ext");
  chip.appendChild(doc.createTextNode("extern: "));
  appendExact(doc, chip, path);
  setAttr(chip, "title", "Ende außerhalb des Exports – nicht navigierbar");
  return chip;
}

function openCodeAction(actions) {
  if (hasAction(actions, "openCode")) return "openCode";
  if (hasAction(actions, "openSource")) return "openSource";
  return null;
}

function codeLink(doc, model, actions, source, line, label = null) {
  const action = openCodeAction(actions);
  const text = label ?? (line !== null && line !== undefined ? `${source} Z. ${line}` : source);
  return button(doc, "", () => callAction(actions, action, source, line ?? null), {
    cls: "pv-btn pv-btn-link", exact: text, disabled: action === null || !model.source(source),
  });
}

function endNode(doc, model, actions, end, index) {
  const box = el(doc, "span", "pv-end");
  if (isRecord(end) && Object.hasOwn(end, "external")) box.appendChild(externalChip(doc, end.external));
  else if (isRecord(end) && typeof end.op === "string") box.appendChild(opLink(doc, model, actions, end.op));
  else box.appendChild(el(doc, "span", "pv-chip", "unbekannt"));
  box.appendChild(el(doc, "span", "pv-dim", `:${index}`));
  return box;
}

function targetNode(doc, model, actions, target) {
  if (isRecord(target) && Object.hasOwn(target, "external")) return externalChip(doc, target.external);
  if (isRecord(target) && Object.hasOwn(target, "unresolved")) return el(doc, "span", "pv-chip pv-marker", unresolvedText(target.unresolved));
  if (isRecord(target) && typeof target.op === "string") return opLink(doc, model, actions, target.op);
  return el(doc, "span", "pv-chip", "unbekannt");
}

function fromNode(doc, model, actions, from) {
  const box = el(doc, "span", "pv-from");
  if (typeof from.source === "string") box.appendChild(codeLink(doc, model, actions, from.source, from.line));
  else box.appendChild(opLink(doc, model, actions, from.op));
  if (typeof from.par === "string") {
    box.appendChild(el(doc, "span", "pv-dim", " Par "));
    appendExact(doc, box, from.par, "pv-u pv-mono");
  }
  return box;
}

function referenceRow(doc, model, actions, r, { showFrom = true, showTarget = true } = {}) {
  const row = el(doc, "div", "pv-ref pv-btnrow");
  row.appendChild(el(doc, "span", "pv-chip", referenceKindText(r.kind)));
  if (showFrom) row.appendChild(fromNode(doc, model, actions, r.from));
  if (typeof r.text === "string") appendExact(doc, row, r.text, "pv-u pv-mono pv-reftext");
  else row.appendChild(el(doc, "span", "pv-chip pv-marker", "Text ausgelassen"));
  if (showTarget) {
    row.appendChild(el(doc, "span", "pv-dim", "→"));
    row.appendChild(targetNode(doc, model, actions, r.target));
  }
  row.appendChild(certaintyChip(doc, r.certainty));
  return row;
}

function capped(doc, parent, list, draw) {
  list.slice(0, LIST_CAP).forEach(draw);
  if (list.length > LIST_CAP) parent.appendChild(el(doc, "p", "pv-hint", `+ ${list.length - LIST_CAP} weitere (Liste gekürzt)`));
}

function scrollRoot(doc, cls) {
  const root = el(doc, "div", `pv-root pv-scroll ${cls}`);
  setAttr(root, "tabindex", "-1");
  return root;
}

function rememberScroll(model, key, root) {
  let map = SCROLL.get(model);
  if (!map) {
    map = new Map();
    SCROLL.set(model, map);
  }
  return {
    restore() {
      if (map.has(key)) root.scrollTop = map.get(key);
    },
    save() {
      map.set(key, root.scrollTop);
    },
  };
}

function sourcesOf(model, rel) {
  const keys = [];
  const add = (key) => {
    if (key !== null && model.source(key) && !keys.includes(key)) keys.push(key);
  };
  add(rel);
  for (const ext of model.extensions(rel)) add(ext.dat);
  for (const s of model.sources()) {
    if (s.roles.some((role) => role.comp === rel || role.owner === rel)) add(s.key);
  }
  return keys;
}

function sourceRow(doc, model, actions, key) {
  const src = model.source(key);
  const row = el(doc, "div", "pv-btnrow");
  row.appendChild(codeLink(doc, model, actions, key, null));
  row.appendChild(el(doc, "span", "pv-chip", src.language));
  if (src.status !== "exact") row.appendChild(el(doc, "span", "pv-chip pv-marker", labelOf(STATUS_TEXT, src.status)));
  else if (Number.isSafeInteger(src.lines)) row.appendChild(el(doc, "span", "pv-dim", `${src.lines} Zeilen`));
  for (const role of src.roles) {
    const chip = el(doc, "span", "pv-chip", labelOf(ROLE_TEXT, role.kind));
    if (role.kind === "extension") chip.textContent += ` Slot ${role.slot}`;
    row.appendChild(chip);
  }
  return row;
}

// ------------------------------------------------------------------ DETAILS

function drawDetails(doc, root, model, rel, actions) {
  const op = model.op(rel);
  if (!op) {
    root.appendChild(el(doc, "p", "pv-hint pv-warn", "Dieser Op ist nicht im Paket."));
    return;
  }
  const head = el(doc, "div", "pv-det-head");
  appendExact(doc, head, rel === "" && !op.name ? "/" : op.name, "pv-u pv-title");
  const chips = el(doc, "div", "pv-btnrow");
  for (const text of [op.opType, op.family, op.isCOMP ? "COMP" : null, op.role === "helper" ? "Helper" : null, rel === "" ? "Root" : null]) {
    if (text) chips.appendChild(el(doc, "span", "pv-chip", text));
  }
  head.appendChild(chips);
  root.appendChild(head);
  const tools = el(doc, "div", "pv-btnrow");
  if (hasAction(actions, "openUnderstand")) tools.appendChild(button(doc, "Verstehen", () => callAction(actions, "openUnderstand", { op: rel })));
  if (op.isCOMP && hasAction(actions, "enterComp")) tools.appendChild(button(doc, "Netz öffnen", () => callAction(actions, "enterComp", rel)));
  if (hasAction(actions, "copyText")) tools.appendChild(button(doc, "Pfad kopieren", () => callAction(actions, "copyText", op.path, "path")));
  if (tools.firstChild) root.appendChild(tools);

  const where = section(doc, root, "Ort");
  kv(doc, where, "Originalpfad", op.path, { mono: true });
  kv(doc, where, "Relativ", rel === "" ? "(Root)" : rel, { mono: true });
  if (op.parent === null) kv(doc, where, "Parent", "– (Export-Root)");
  else kv(doc, where, "Parent", opLink(doc, model, actions, op.parent));
  if (Object.hasOwn(op.node, "unknown")) kv(doc, where, "Position", `nicht exportiert (${op.node.unknown})`, { kind: "unknown" });
  else kv(doc, where, "Position", `x ${op.node.x} · y ${op.node.y} · ${op.node.w}×${op.node.h}`, { mono: true });
  if (Array.isArray(op.color)) kv(doc, where, "Farbe", op.color.join(" "), { mono: true });
  if (op.isCOMP) {
    const hidden = model.hiddenChildren(rel);
    const exported = model.children(rel).length;
    kv(doc, where, "Kinder", `${exported} exportiert${Number.isSafeInteger(op.children) ? ` von ${op.children}` : ""}`);
    if (hidden > 0) where.appendChild(el(doc, "p", "pv-hint pv-warn", `${hidden} Kinder nicht exportiert`));
  }
  if (isRecord(op.dock)) {
    if (Object.hasOwn(op.dock, "external")) kv(doc, where, "Angedockt an", externalChip(doc, op.dock.external));
    else kv(doc, where, "Angedockt an", opLink(doc, model, actions, op.dock.op));
  }
  if (typeof op.comment === "string" ? op.comment !== "" : isRecord(op.comment)) {
    if (typeof op.comment === "string") kv(doc, where, "Kommentar", op.comment);
    else kv(doc, where, "Kommentar", op.comment.omitted === "secret" ? "ausgelassen: Geheimnis-Fund" : "zu lang, nicht übertragen", { kind: "omitted" });
  }
  if (op.tags.length) kv(doc, where, "Tags", op.tags.join("\n"), { mono: true });
  const flags = Object.keys(op.flags).filter((k) => FLAG_TEXT.has(k));
  if (flags.length) kv(doc, where, "Flags", flags.map((k) => `${labelOf(FLAG_TEXT, k)}: ${op.flags[k] ? "an" : "aus"}`).join(" · "));

  const ins = model.inputs(rel);
  const outs = model.outputs(rel);
  const wires = section(doc, root, "Leitungen", `${ins.length} ein · ${outs.length} aus`);
  for (const c of ins) {
    const row = el(doc, "div", "pv-btnrow pv-wire-row");
    row.appendChild(el(doc, "span", "pv-chip", `${c.kind === "comp" ? "COMP-Eingang" : "Eingang"} ${c.toIndex}`));
    row.appendChild(el(doc, "span", "pv-dim", "←"));
    row.appendChild(endNode(doc, model, actions, c.from, c.fromIndex));
    wires.appendChild(row);
  }
  for (const c of outs) {
    const row = el(doc, "div", "pv-btnrow pv-wire-row");
    row.appendChild(el(doc, "span", "pv-chip", `${c.kind === "comp" ? "COMP-Ausgang" : "Ausgang"} ${c.fromIndex}`));
    row.appendChild(el(doc, "span", "pv-dim", "→"));
    row.appendChild(endNode(doc, model, actions, c.to, c.toIndex));
    wires.appendChild(row);
  }
  if (!ins.length && !outs.length) wires.appendChild(el(doc, "p", "pv-hint", "Keine Leitungen."));
  if (isRecord(op.connectors)) {
    for (const [side, field, label] of [["in", "inOP", "In-Stecker"], ["out", "outOP", "Out-Stecker"]]) {
      for (const c of op.connectors[side]) {
        const row = el(doc, "div", "pv-btnrow");
        row.appendChild(el(doc, "span", "pv-chip", `${label} ${c.index}`));
        row.appendChild(el(doc, "span", "pv-dim", "↔"));
        row.appendChild(c[field] === null ? el(doc, "span", "pv-chip pv-marker", "kein Op") : opLink(doc, model, actions, c[field]));
        wires.appendChild(row);
      }
    }
  }

  const exts = model.extensions(rel);
  if (op.isCOMP && (exts.length || isRecord(op.shortcuts))) {
    const sec = section(doc, root, "Extensions und Shortcuts");
    op.extensions.forEach((raw, i) => {
      const ext = exts[i];
      const row = el(doc, "div", "pv-ext-row");
      const top = el(doc, "div", "pv-btnrow");
      top.appendChild(el(doc, "span", "pv-chip", `Slot ${raw.slot}`));
      if (ext && ext.name !== null) appendExact(doc, top, ext.name, "pv-u pv-strong");
      if (ext && ext.className !== null) {
        top.appendChild(el(doc, "span", "pv-dim", "Klasse"));
        appendExact(doc, top, ext.className, "pv-u pv-mono");
      }
      if (ext && ext.promote !== null) top.appendChild(el(doc, "span", "pv-chip", ext.promote ? "promoted" : "nicht promoted"));
      if (ext && ext.dat !== null) top.appendChild(codeLink(doc, model, actions, ext.dat, null));
      if (ext) top.appendChild(certaintyChip(doc, ext.certainty));
      row.appendChild(top);
      if (isRecord(raw.object) && typeof raw.object.value === "string") kv(doc, row, "Objekt", raw.object.value, { mono: true, kind: "expr" });
      else if (isRecord(raw.object) && typeof raw.object.expr === "string") kv(doc, row, "Objekt (Expression)", raw.object.expr, { mono: true });
      else kv(doc, row, "Objekt", "nicht übertragen", { kind: "omitted" });
      sec.appendChild(row);
    });
    for (const [kind, label] of [["parent", "Parent-Shortcut"], ["global", "Global-Shortcut"]]) {
      const value = isRecord(op.shortcuts) ? op.shortcuts[kind] : null;
      if (value === null || value === undefined) continue;
      if (typeof value.value === "string") kv(doc, sec, label, value.value, { mono: true });
      else if (typeof value.expr === "string") kv(doc, sec, `${label} (Expression)`, value.expr, { mono: true });
      else kv(doc, sec, label, value.omitted === "secret" ? "ausgelassen: Geheimnis-Fund" : "nicht übertragen", { kind: "omitted" });
    }
    for (const s of op.internalShortcuts) {
      const value = isRecord(s.op) && typeof s.op.value === "string" ? s.op.value : null;
      kv(doc, sec, `iop ${s.slot}`, value !== null ? `${s.shortcut} → ${value}` : `${s.shortcut} → nicht übertragen`, { mono: true, kind: value !== null ? "meta" : "omitted" });
    }
  }

  const pars = model.parameters(rel);
  const parSec = section(doc, root, "Parameter", pars.length);
  if (!pars.length) parSec.appendChild(el(doc, "p", "pv-hint", "Keine Parameter im Paket (eingebaute Pars nur bei Abweichung oder Pflichtliste)."));
  const pages = new Map();
  for (const p of pars) {
    const page = typeof p.page === "string" && p.page ? p.page : "–";
    if (pages.has(page)) pages.get(page).push(p);
    else pages.set(page, [p]);
  }
  for (const [page, list] of pages) {
    const pageBox = el(doc, "div", "pv-page");
    const pageHead = el(doc, "h4", "pv-page-h");
    appendExact(doc, pageHead, page);
    pageBox.appendChild(pageHead);
    for (const p of list) pageBox.appendChild(drawParameter(doc, p));
    parSec.appendChild(pageBox);
  }

  const keys = sourcesOf(model, rel);
  if (keys.length) {
    const sec = section(doc, root, "Codequellen", keys.length);
    for (const key of keys) sec.appendChild(sourceRow(doc, model, actions, key));
  }

  const from = model.referencesFrom(rel);
  const to = model.referencesTo(rel);
  const refSec = section(doc, root, "Verweise", `${from.length} von hier · ${to.length} hierher`);
  if (from.length) refSec.appendChild(el(doc, "h4", "pv-page-h", "Von diesem Op"));
  capped(doc, refSec, from, (r) => refSec.appendChild(referenceRow(doc, model, actions, r)));
  if (to.length) refSec.appendChild(el(doc, "h4", "pv-page-h", "Auf diesen Op"));
  capped(doc, refSec, to, (r) => refSec.appendChild(referenceRow(doc, model, actions, r, { showTarget: false })));
  if (!from.length && !to.length) refSec.appendChild(el(doc, "p", "pv-hint", "Keine belegten Verweise."));
  const caps = isRecord(model.capabilities) ? model.capabilities : {};
  const missing = [...MISSING_CAPABILITIES.keys()].filter((key) => caps[key] === false).map((key) => labelOf(MISSING_CAPABILITIES, key));
  if (missing.length) root.appendChild(el(doc, "p", "pv-hint", `Nicht exportiert: ${missing.join(", ")}.`));
}

function drawParameter(doc, p) {
  const box = el(doc, "div", "pv-par");
  const head = el(doc, "div", "pv-par-head");
  appendExact(doc, head, p.name, "pv-u pv-mono pv-strong");
  if (typeof p.label === "string" && p.label && p.label !== p.name) {
    head.appendChild(el(doc, "span", "pv-dim", " "));
    appendExact(doc, head, p.label, "pv-u pv-dim");
  }
  for (const chip of parameterChips(p)) head.appendChild(el(doc, "span", "pv-chip", chip));
  box.appendChild(head);
  for (const row of parameterRows(p)) {
    if (row.label === "Modus") continue;
    const v = kv(doc, box, row.label, row.empty ? "(leer)" : row.text, { kind: row.kind, mono: row.kind === "value" || row.kind === "expr" });
    if (row.empty) v.classList.add("pv-marker");
    if (row.dormant) {
      v.classList.add("pv-dormant");
      v.parentNode.classList.add("pv-dormant-row");
    }
    if (row.kind === "value" && row.t === "bool") v.appendChild(el(doc, "span", "pv-dim", ` (${row.raw})`));
    if (row.kind === "value" && row.t) v.appendChild(el(doc, "span", "pv-chip pv-t-chip", row.t));
    if (row.note) v.appendChild(el(doc, "span", "pv-dim", ` ${row.note}`));
  }
  return box;
}

export function renderDetails(container, model, rel, actions) {
  const doc = container.ownerDocument;
  const root = scrollRoot(doc, "pv-details");
  drawDetails(doc, root, model, typeof rel === "string" ? rel : "", actions || {});
  container.appendChild(root);
  const memory = rememberScroll(model, `details\n${rel}`, root);
  memory.restore();
  let destroyed = false;
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      memory.save();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

// ------------------------------------------------------------------ VERSTEHEN

// Aussage mit Beleg und Gewissheit. parts: Strings (UI-Text) oder {exact} (Paketinhalt) oder DOM-Knoten.
function claim(doc, parent, parts, evidence, certainty) {
  const row = el(doc, "div", "pv-claim");
  const text = el(doc, "div", "pv-claim-text");
  for (const part of parts) {
    if (typeof part === "string") text.appendChild(doc.createTextNode(part));
    else if (isRecord(part) && typeof part.exact === "string") appendExact(doc, text, part.exact, part.mono ? "pv-u pv-mono" : "pv-u");
    else if (part) text.appendChild(part);
  }
  row.appendChild(text);
  const proof = el(doc, "div", "pv-claim-proof");
  proof.appendChild(el(doc, "span", "pv-k", "Beleg"));
  if (evidence) proof.appendChild(evidence);
  proof.appendChild(certaintyChip(doc, certainty));
  row.appendChild(proof);
  parent.appendChild(row);
  return row;
}

function packageEvidence(doc, what) {
  return el(doc, "span", "pv-ev", `Paket: ${what}`);
}

function refEvidence(doc, model, actions, r) {
  const box = el(doc, "span", "pv-ev");
  box.appendChild(doc.createTextNode(`Verweis ${referenceKindText(r.kind)} · `));
  box.appendChild(fromNode(doc, model, actions, r.from));
  return box;
}

function lineEvidence(doc, model, actions, source, line) {
  return codeLink(doc, model, actions, source, line);
}

function understandLink(doc, model, actions, target, label) {
  if (hasAction(actions, "openUnderstand")) {
    return button(doc, "", () => callAction(actions, "openUnderstand", target), { cls: "pv-btn pv-btn-link", exact: label });
  }
  const span = el(doc, "span");
  appendExact(doc, span, label);
  return span;
}

function edgeTargetNode(doc, model, actions, edge) {
  const t = edge.target;
  if (isRecord(t) && typeof t.symbol === "string" && typeof t.source === "string") {
    return understandLink(doc, model, actions, { source: t.source, symbol: t.symbol }, t.symbol);
  }
  if (t) return targetNode(doc, model, actions, t);
  return el(doc, "span", "pv-chip pv-marker", "kein Ziel im Paket");
}

function drawEdges(doc, sec, model, actions, edges, direction) {
  capped(doc, sec, edges, (edge) => {
    const parts = [];
    if (direction === "out") {
      parts.push(`ruft ${edge.attr}() → `);
      parts.push(edgeTargetNode(doc, model, actions, edge));
    } else {
      if (edge.from.symbol !== null) parts.push(understandLink(doc, model, actions, { source: edge.from.source, symbol: edge.from.symbol }, edge.from.symbol));
      else parts.push(codeLink(doc, model, actions, edge.from.source, edge.line, `${edge.from.source} (Modulebene)`));
      parts.push(` ruft ${edge.attr}()`);
    }
    if (edge.reason) parts.push(el(doc, "span", "pv-dim", ` · ${edgeReasonText(edge.reason)}`));
    claim(doc, sec, parts, lineEvidence(doc, model, actions, edge.from.source, edge.line), edge.certainty);
  });
}

function opSubtree(rel) {
  if (rel === "") return () => true;
  return (other) => other === rel || other.startsWith(`${rel}/`);
}

function drawUnderstandOp(doc, root, model, rel, actions) {
  const op = model.op(rel);
  if (!op) {
    root.appendChild(el(doc, "p", "pv-hint pv-warn", "Dieser Op ist nicht im Paket."));
    return;
  }
  const head = el(doc, "div", "pv-det-head");
  head.appendChild(el(doc, "span", "pv-k", "VERSTEHEN"));
  appendExact(doc, head, rel === "" && !op.name ? "/" : op.name, "pv-u pv-title");
  head.appendChild(el(doc, "span", "pv-chip", op.opType));
  root.appendChild(head);

  const together = section(doc, root, "Zusammengehörigkeit");
  if (op.parent !== null) claim(doc, together, ["liegt in ", opLink(doc, model, actions, op.parent)], packageEvidence(doc, "Hierarchie"), "captured");
  else claim(doc, together, ["ist der Export-Root"], packageEvidence(doc, "exportRoot"), "captured");
  if (op.isCOMP) {
    const hidden = model.hiddenChildren(rel);
    claim(doc, together, [`hat ${model.children(rel).length} exportierte Kinder${hidden ? `, ${hidden} nicht exportiert` : ""}`], packageEvidence(doc, "children"), "captured");
  }
  if (op.parent !== null) {
    for (const a of model.annotations(op.parent)) {
      if (!a.enclosed.includes(rel)) continue;
      claim(doc, together, ["umschlossen von Annotation ", { exact: typeof a.title === "string" && a.title ? a.title : a.name }],
        packageEvidence(doc, "annotations.enclosed"), "captured");
    }
  }
  if (isRecord(op.dock)) {
    claim(doc, together, ["angedockt an ", Object.hasOwn(op.dock, "external") ? externalChip(doc, op.dock.external) : opLink(doc, model, actions, op.dock.op)],
      packageEvidence(doc, "dock"), "captured");
  }
  for (const other of model.operators()) {
    if (isRecord(other.dock) && other.dock.op === rel) claim(doc, together, [opLink(doc, model, actions, other.rel), " ist hier angedockt"], packageEvidence(doc, "dock"), "captured");
  }
  for (const r of model.referencesTo(rel)) {
    if (r.kind !== "ext-object") continue;
    claim(doc, together, ["Extension-DAT von ", opLink(doc, model, actions, r.from.op)], refEvidence(doc, model, actions, r), r.certainty);
  }
  const own = model.source(rel);
  if (own) {
    for (const role of own.roles) {
      const parts = [`Rolle ${labelOf(ROLE_TEXT, role.kind)}`];
      if (typeof role.comp === "string") parts.push(" für ", opLink(doc, model, actions, role.comp));
      if (typeof role.owner === "string") parts.push(" für ", opLink(doc, model, actions, role.owner));
      claim(doc, together, parts, packageEvidence(doc, "codeSources.roles"), "captured");
    }
  }
  for (const ext of model.extensions(rel)) {
    const parts = [`Extension Slot ${ext.slot}`];
    if (ext.className !== null) parts.push(": Klasse ", { exact: ext.className, mono: true });
    if (ext.dat !== null) parts.push(" in ", codeLink(doc, model, actions, ext.dat, null));
    else parts.push(" – DAT nicht belegt");
    claim(doc, together, parts, packageEvidence(doc, `extensions[${ext.slot}]`), ext.certainty);
  }

  const keys = sourcesOf(model, rel);
  const srcSec = section(doc, root, "Codequellen", keys.length);
  if (!keys.length) srcSec.appendChild(el(doc, "p", "pv-hint", "Keine Codequellen zu diesem Op im Paket."));
  for (const key of keys) {
    const row = sourceRow(doc, model, actions, key);
    const problem = entryProblem(model.entry(key));
    if (problem) row.appendChild(el(doc, "span", "pv-dim", problem));
    srcSec.appendChild(row);
  }

  const callSec = section(doc, root, "Aufrufkandidaten");
  const outEdges = [];
  const inEdges = [];
  for (const key of keys) {
    outEdges.push(...model.callees(key, null));
    for (const sym of model.symbols(key)) {
      outEdges.push(...model.callees(key, sym.symbol));
      for (const e of model.callers(key, sym.symbol)) if (e.from.source !== key) inEdges.push(e);
    }
  }
  if (outEdges.length) callSec.appendChild(el(doc, "h4", "pv-page-h", `Ruft (${outEdges.length})`));
  drawEdges(doc, callSec, model, actions, outEdges, "out");
  if (inEdges.length) callSec.appendChild(el(doc, "h4", "pv-page-h", `Wird aufgerufen von (${inEdges.length})`));
  drawEdges(doc, callSec, model, actions, inEdges, "in");
  if (!outEdges.length && !inEdges.length) callSec.appendChild(el(doc, "p", "pv-hint", "Keine Aufrufkandidaten in der Analyse."));

  const rw = section(doc, root, "Leser und Schreiber");
  const refsTo = model.referencesTo(rel).filter((r) => r.kind !== "ext-object");
  if (refsTo.length) rw.appendChild(el(doc, "h4", "pv-page-h", `Verweise auf diesen Op (${refsTo.length})`));
  capped(doc, rw, refsTo, (r) => claim(doc, rw, [opLink(doc, model, actions, r.from.op), ` verweist per ${referenceKindText(r.kind)}`],
    refEvidence(doc, model, actions, r), r.certainty));
  let states = 0;
  for (const key of keys) {
    for (const s of model.states(key)) {
      const access = model.stateAccess(key, `${s.class}.${s.name}`);
      states += 1;
      const parts = ["Zustand ", { exact: `${s.class}.${s.name}`, mono: true }, `: ${access.readers.length} lesend, ${access.writers.length} schreibend`];
      claim(doc, rw, parts, lineEvidence(doc, model, actions, key, s.line), "static");
    }
  }
  if (!refsTo.length && !states) rw.appendChild(el(doc, "p", "pv-hint", "Keine Leser oder Schreiber belegt."));

  const io = section(doc, root, "Ein- und Ausgaben");
  for (const c of model.inputs(rel)) claim(doc, io, [`Eingang ${c.toIndex} ← `, endNode(doc, model, actions, c.from, c.fromIndex)], packageEvidence(doc, "connections"), "captured");
  for (const c of model.outputs(rel)) claim(doc, io, [`Ausgang ${c.fromIndex} → `, endNode(doc, model, actions, c.to, c.toIndex)], packageEvidence(doc, "connections"), "captured");
  if (!model.inputs(rel).length && !model.outputs(rel).length) io.appendChild(el(doc, "p", "pv-hint", "Keine Leitungen."));

  const inside = opSubtree(rel);
  const ext = section(doc, root, "Externe Abhängigkeiten");
  let count = 0;
  for (const dep of model.externalDependencies()) {
    const users = model.externalUsers(dep.path);
    const refs = users.references.filter((r) => inside(r.from.op));
    const wires = users.connections.filter((c) => (isRecord(c.from) && typeof c.from.op === "string" && inside(c.from.op))
      || (isRecord(c.to) && typeof c.to.op === "string" && inside(c.to.op)));
    for (const r of refs) {
      count += 1;
      claim(doc, ext, [externalChip(doc, dep.path), ` per ${referenceKindText(r.kind)}`], refEvidence(doc, model, actions, r), r.certainty);
    }
    for (const c of wires) {
      count += 1;
      claim(doc, ext, [externalChip(doc, dep.path), ` über Leitung (${c.kind})`], packageEvidence(doc, "connections"), "captured");
    }
  }
  if (!count) ext.appendChild(el(doc, "p", "pv-hint", "Keine externen Ziele aus diesem Teilbaum belegt."));
}

function factText(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function drawUnderstandSymbol(doc, root, model, source, symbolId, actions) {
  const sym = model.symbol(source, symbolId);
  const src = model.source(source);
  if (!src) {
    root.appendChild(el(doc, "p", "pv-hint pv-warn", "Diese Quelle ist nicht im Paket."));
    return;
  }
  if (!sym) {
    root.appendChild(el(doc, "p", "pv-hint pv-warn", "Dieses Symbol steht nicht in der Analyse der Quelle."));
    const problem = entryProblem(model.entry(source));
    if (problem) root.appendChild(el(doc, "p", "pv-hint", problem));
    return;
  }
  const head = el(doc, "div", "pv-det-head");
  head.appendChild(el(doc, "span", "pv-k", "VERSTEHEN"));
  appendExact(doc, head, sym.symbol, "pv-u pv-title pv-mono");
  head.appendChild(el(doc, "span", "pv-chip", sym.kind));
  root.appendChild(head);

  const together = section(doc, root, "Zusammengehörigkeit");
  claim(doc, together, [`${sym.kind === "function" ? "Funktion" : sym.kind === "property" ? "Property" : "Methode"} `, { exact: sym.name, mono: true },
    `(${sym.params.join(", ")}) in `, codeLink(doc, model, actions, source, null)], lineEvidence(doc, model, actions, source, sym.line), "static");
  if (sym.class !== null) {
    const cls = model.classes(source).find((c) => c.name === sym.class);
    claim(doc, together, ["gehört zu Klasse ", { exact: sym.class, mono: true }], lineEvidence(doc, model, actions, source, cls ? cls.line : sym.line), "static");
  }
  for (const r of model.referencesTo(source)) {
    if (r.kind === "ext-object") claim(doc, together, ["Quelle ist Extension-DAT von ", opLink(doc, model, actions, r.from.op)], refEvidence(doc, model, actions, r), r.certainty);
  }
  if (sym.decorators.length) claim(doc, together, ["Dekoratoren: ", { exact: sym.decorators.join(", "), mono: true }], lineEvidence(doc, model, actions, source, sym.line), "static");
  if (sym.doc) claim(doc, together, ["Docstring: ", { exact: sym.doc }], lineEvidence(doc, model, actions, source, sym.line), "static");

  const calls = section(doc, root, "Aufrufkandidaten");
  const out = model.callees(source, sym.symbol);
  const inn = model.callers(source, sym.symbol);
  if (out.length) calls.appendChild(el(doc, "h4", "pv-page-h", `Ruft (${out.length})`));
  drawEdges(doc, calls, model, actions, out, "out");
  if (inn.length) calls.appendChild(el(doc, "h4", "pv-page-h", `Wird aufgerufen von (${inn.length})`));
  drawEdges(doc, calls, model, actions, inn, "in");
  if (!out.length && !inn.length) calls.appendChild(el(doc, "p", "pv-hint", "Keine Aufrufkandidaten in der Analyse."));

  const rw = section(doc, root, "Leser und Schreiber");
  const entry = model.entry(source);
  const accesses = isRecord(entry) && Array.isArray(entry.accesses) ? entry.accesses.filter((a) => a.symbol === sym.symbol) : [];
  capped(doc, rw, accesses, (a) => {
    const parts = [`${labelOf(ACCESS_TEXT, a.how)} `, { exact: `self.${a.name}`, mono: true }];
    if (typeof a.conf === "string") parts.push(el(doc, "span", "pv-dim", ` · ${a.conf}`));
    claim(doc, rw, parts, lineEvidence(doc, model, actions, source, a.line), "static");
  });
  if (sym.class !== null) {
    const names = [...new Set(accesses.map((a) => a.name))];
    for (const name of names) {
      const access = model.stateAccess(source, `${sym.class}.${name}`);
      for (const side of ["readers", "writers"]) {
        for (const item of access[side]) {
          if (item.symbol === sym.symbol || item.source === null) continue;
          claim(doc, rw, [{ exact: item.symbol ?? "Modulebene", mono: true }, ` ${side === "readers" ? "liest" : "schreibt"} auch `, { exact: `${sym.class}.${name}`, mono: true }],
            lineEvidence(doc, model, actions, item.source, item.line), "static");
        }
      }
    }
  }
  if (!accesses.length) rw.appendChild(el(doc, "p", "pv-hint", "Keine Zustandszugriffe in der Analyse."));

  const io = section(doc, root, "Ein- und Ausgaben");
  const facts = isRecord(sym.facts) ? sym.facts : {};
  const FACTS = [["params", "Parameter"], ["returns", "Rückgabe"], ["effects", "Wirkung"], ["pulls", "liest"], ["parReads", "liest Par"], ["parWrites", "schreibt Par"]];
  let factCount = 0;
  for (const [field, label] of FACTS) {
    const list = Array.isArray(facts[field]) ? facts[field] : [];
    for (const value of list) {
      factCount += 1;
      claim(doc, io, [`${label}: `, { exact: factText(value), mono: true }], lineEvidence(doc, model, actions, source, sym.line), "static");
    }
  }
  if (!factCount) io.appendChild(el(doc, "p", "pv-hint", "Keine Fakten zu Ein- und Ausgaben in der Analyse."));

  const refs = model.referencesInSource(source).filter((r) => r.from.line !== null && r.from.line >= sym.line && r.from.line <= sym.end);
  const refSec = section(doc, root, "Verweise im Symbol", refs.length);
  capped(doc, refSec, refs, (r) => refSec.appendChild(referenceRow(doc, model, actions, r)));
  const external = refs.filter((r) => isRecord(r.target) && Object.hasOwn(r.target, "external"));
  const ext = section(doc, root, "Externe Abhängigkeiten", external.length);
  for (const r of external) claim(doc, ext, [externalChip(doc, r.target.external), ` per ${referenceKindText(r.kind)}`], refEvidence(doc, model, actions, r), r.certainty);
  if (!external.length) ext.appendChild(el(doc, "p", "pv-hint", "Keine externen Ziele im Symbol belegt."));
}

export function renderUnderstand(container, model, target, actions) {
  const doc = container.ownerDocument;
  const root = scrollRoot(doc, "pv-understand");
  const note = el(doc, "p", "pv-hint pv-static-note", STATIC_NOTE);
  setAttr(note, "role", "note");
  root.appendChild(note);
  let key = "understand\n";
  if (isRecord(target) && typeof target.op === "string") {
    key += `op\n${target.op}`;
    drawUnderstandOp(doc, root, model, target.op, actions || {});
  } else if (isRecord(target) && typeof target.source === "string") {
    const symbol = typeof target.symbol === "string" ? target.symbol : "";
    key += `symbol\n${target.source}\n${symbol}`;
    drawUnderstandSymbol(doc, root, model, target.source, symbol, actions || {});
  } else {
    root.appendChild(el(doc, "p", "pv-hint pv-warn", "Kein Ziel zum Verstehen gewählt."));
  }
  container.appendChild(root);
  const memory = rememberScroll(model, key, root);
  memory.restore();
  let destroyed = false;
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      memory.save();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

