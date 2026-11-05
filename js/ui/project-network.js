// Projektansicht NETZ (Vertrag 14, Auftrag Mobile Explorer): SVG je aktuellem COMP aus den exportierten Positionen.
// - Nur der aktuelle COMP wird gebaut (Leistung: 200 Ops in einem Durchgang ueber ein DocumentFragment).
// - Ops ohne Position stehen in einer beschrifteten Reihe darunter, ihre Leitungen gestrichelt; externe Enden sind
//   nicht navigierbare Platzhalter "extern: <pfad>"; kind "comp" wird wie eine Leitung gezeichnet.
// - Pan per Zeiger, Pinch mit zwei Zeigern, Rad/Tasten-Zoom, Einpassen; touch-action:none nur auf der Netzflaeche.
// - Antippen = auswaehlen + Verbindungen hervorheben, doppelt/Knopf = COMP betreten, Knopf Parent.
// Zustand gehoert der Huelle (view); die Ansicht wendet Gesten sofort lokal an und meldet das Ergebnis am Gestenende
// ueber actions.setView - nie pro Zeigerbewegung, damit die Huelle nicht 60-mal je Sekunde neu rendert.
// view.zoom/panX/panY == null -> Einpassen beim Rendern bzw. beim COMP-Wechsel.

import {
  appendExact, button, callAction, clear, displayText, el, hasAction, isRecord, setAttr, svgEl,
} from "./project-dom.js";
import { familyToken } from "./dom.js";
import {
  MAX_TICKS, NET_ZOOM, ensureVisible, fitView, isViewValue, layoutNetwork, panBy, pinchView, sameView, tickIndices,
  viewTransform, zoomAt,
} from "./project-netmath.js";

const TAP_SLOP = 8;
const TAP_MS = 600;
const DOUBLE_MS = 350;
const KEY_PAN = 48;
const COMMIT_MS = 220;
const FALLBACK_SIZE = Object.freeze({ w: 360, h: 480 });
const NAME_CHAR_W = 8.2;
const TYPE_CHAR_W = 6.6;

function markerText(field) {
  if (typeof field === "string") return field;
  if (isRecord(field)) {
    if (field.omitted === "secret") return "(ausgelassen: Geheimnis)";
    if (field.unknown === "size") return "(zu lang, nicht übertragen)";
    if (typeof field.unknown === "string") return "(Expression – Wert unbekannt)";
  }
  return "";
}

// Hinweis fuer Ops mit mehr Anschluessen als Strichen: die Zahl steht im Text, gezeichnet sind nur belegte.
function manyPortsText(o) {
  const parts = [];
  if (o.nIn > MAX_TICKS) parts.push(`${o.nIn} Eingangs-Anschlüsse`);
  if (o.nOut > MAX_TICKS) parts.push(`${o.nOut} Ausgangs-Anschlüsse`);
  return parts.length ? `${parts.join(", ")} (Striche nur an belegten)` : "";
}

function fitChars(width, charW) {
  return Math.max(4, Math.floor((width - 16) / charW));
}

// Zahl mit Einzahl/Mehrzahl ("1 Leitung", "2 Leitungen") fuer die Fakten-Zeilen ueber dem Netz.
function counted(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function codeKeyFor(model, rel) {
  if (model.source(rel)) return rel;
  for (const ext of model.extensions(rel)) if (ext.dat !== null && model.source(ext.dat)) return ext.dat;
  return null;
}

class NetworkView {
  constructor(container, model, view, actions) {
    this.container = container;
    this.doc = container.ownerDocument;
    this.model = model;
    this.actions = actions || {};
    this.state = { comp: null, selected: null, view: null, autoFit: false };
    // Verzoegerte Meldung nach Rad/Tasten; solange sie aussteht, gilt die lokale Ansicht (siehe update()).
    this.commitTimer = null;
    this.pointers = new Map();
    this.gesture = null;
    this.lastTap = null;
    this.timers = new Set();
    this.destroyed = false;
    this.opNodes = new Map();
    this.wiresByRel = new Map();
    this.annNodes = new Map();
    this.layout = null;
    this.annotation = null;
    this._build();
    this._rebuild(view || {});
    this._observeSize();
  }

  // ---------------------------------------------------------------- Grundgeruest
  _build() {
    const doc = this.doc;
    this.root = el(doc, "div", "pv-root pv-net");
    const bar = el(doc, "div", "pv-net-bar");
    this.pathBox = el(doc, "div", "pv-net-path");
    bar.appendChild(this.pathBox);
    const tools = el(doc, "div", "pv-net-tools");
    this.btnParent = button(doc, "↑ Parent", () => this._goParent(), { title: "Zur Parent-Ebene" });
    this.btnFit = button(doc, "Einpassen", () => this._fit(true), { title: "Ganzes Netz zeigen" });
    this.btnOut = button(doc, "−", () => this._zoomCenter(1 / NET_ZOOM.step), { title: "Verkleinern" });
    this.btnIn = button(doc, "+", () => this._zoomCenter(NET_ZOOM.step), { title: "Vergrößern" });
    this.btnEnter = button(doc, "Betreten", () => this._enterSelected(), { title: "Ausgewählten COMP betreten" });
    this.btnDetails = button(doc, "Details", () => this._detailsSelected(), { title: "Details des ausgewählten Ops" });
    this.btnCode = button(doc, "Code", () => this._codeSelected(), { title: "Code des ausgewählten Ops" });
    setAttr(this.btnOut, "aria-label", "Verkleinern");
    setAttr(this.btnIn, "aria-label", "Vergrößern");
    for (const b of [this.btnParent, this.btnFit, this.btnOut, this.btnIn, this.btnEnter, this.btnDetails, this.btnCode]) tools.appendChild(b);
    bar.appendChild(tools);
    this.root.appendChild(bar);
    this.hints = el(doc, "div", "pv-net-hints");
    setAttr(this.hints, "aria-live", "polite");
    this.root.appendChild(this.hints);
    this.surface = el(doc, "div", "pv-net-surface");
    setAttr(this.surface, "tabindex", "0");
    setAttr(this.surface, "role", "group");
    this.svg = svgEl(doc, "svg", { class: "pv-net-svg", width: "100%", height: "100%", focusable: "false" });
    this.world = svgEl(doc, "g", { class: "pv-net-world" });
    this.svg.appendChild(this.world);
    this.surface.appendChild(this.svg);
    this.root.appendChild(this.surface);
    this.info = el(doc, "div", "pv-net-info");
    setAttr(this.info, "aria-live", "polite");
    this.root.appendChild(this.info);
    this.container.appendChild(this.root);
    this._wireEvents();
  }

  _wireEvents() {
    const s = this.surface;
    this.listeners = [
      [s, "pointerdown", (e) => this._onPointerDown(e)],
      [s, "pointermove", (e) => this._onPointerMove(e)],
      [s, "pointerup", (e) => this._onPointerUp(e, false)],
      [s, "pointercancel", (e) => this._onPointerUp(e, true)],
      [s, "lostpointercapture", (e) => this._onPointerUp(e, true)],
      [s, "wheel", (e) => this._onWheel(e), { passive: false }],
      [s, "keydown", (e) => this._onKey(e)],
      [s, "focusin", (e) => this._onFocus(e)],
    ];
    for (const [node, type, fn, opts] of this.listeners) node.addEventListener(type, fn, opts);
  }

  _observeSize() {
    const win = this.doc.defaultView;
    const RO = win && win.ResizeObserver;
    if (typeof RO !== "function") return;
    // Ebenen sind beim ersten Rendern oft noch verborgen (Groesse 0): sobald die echte Groesse da ist und der Nutzer
    // noch nichts verschoben hat, wird neu eingepasst.
    this.resize = new RO(() => {
      if (!this.destroyed && this.state.autoFit) this._fit(true);
    });
    this.resize.observe(this.surface);
  }

  _size() {
    const w = this.surface.clientWidth;
    const h = this.surface.clientHeight;
    return w > 0 && h > 0 ? { w, h } : FALLBACK_SIZE;
  }

  _later(fn, ms) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (!this.destroyed) fn();
    }, ms);
    this.timers.add(id);
    return id;
  }

  // ---------------------------------------------------------------- Aufbau je COMP
  _rebuild(view) {
    const doc = this.doc;
    const comp = typeof view.comp === "string" ? view.comp : "";
    this.state.comp = comp;
    this.state.selected = null;
    this.annotation = null;
    this.opNodes.clear();
    this.wiresByRel.clear();
    this.annNodes.clear();
    clear(this.world);
    clear(this.pathBox);
    clear(this.hints);
    clear(this.info);
    this.pathBox.appendChild(el(doc, "span", "pv-k", "COMP"));
    appendExact(doc, this.pathBox, this.model.has(comp) ? this.model.abs(comp) : comp, "pv-u pv-mono");
    const op = this.model.op(comp);
    const net = op ? this.model.network(comp) : null;
    this.btnParent.disabled = !op || op.parent === null || !hasAction(this.actions, "goParent");
    if (!net) {
      this.layout = null;
      this.hints.appendChild(el(doc, "p", "pv-hint pv-warn", "Dieser COMP ist nicht im Paket."));
      setAttr(this.surface, "aria-label", "Netz: COMP nicht im Paket");
      this._applySelection(null);
      return;
    }
    this.layout = layoutNetwork(net, { lookup: (rel) => this.model.op(rel), absOf: (rel) => this.model.abs(rel) });
    setAttr(this.surface, "aria-label", `Netz von ${displayText(net.path, 200)}`);
    this._drawHints(op, net);
    this.world.appendChild(this._drawLayout(this.layout));
    const selected = typeof view.selected === "string" ? view.selected : null;
    if (isViewValue(view)) {
      this.state.view = { zoom: view.zoom, panX: view.panX, panY: view.panY };
      this.state.autoFit = false;
      this._applyTransform();
    } else {
      this._fit(false);
      // Erst nach dem Rueckgabewert melden: die Huelle haelt den Griff dann schon (kein update() auf undefined).
      queueMicrotask(() => {
        if (!this.destroyed && this.state.autoFit) this._commit();
      });
    }
    this._applySelection(selected);
  }

  _drawHints(op, net) {
    const doc = this.doc;
    const lay = this.layout;
    const facts = [];
    facts.push(counted(lay.ops.length, "Op", "Ops"));
    facts.push(counted(lay.wires.filter((w) => !w.outer).length, "Leitung", "Leitungen"));
    if (lay.annotations.length) facts.push(counted(lay.annotations.length, "Annotation", "Annotationen"));
    this.hints.appendChild(el(doc, "p", "pv-hint", facts.join(" · ")));
    if (!op.isCOMP) this.hints.appendChild(el(doc, "p", "pv-hint", "Kein COMP: ohne eigenes Netz."));
    else if (!lay.ops.length && !net.hiddenChildren) this.hints.appendChild(el(doc, "p", "pv-hint", "Keine exportierten Kinder."));
    if (net.hiddenChildren > 0) {
      const hint = el(doc, "p", "pv-hint pv-warn", `${counted(net.hiddenChildren, "Kind", "Kinder")} nicht exportiert`);
      setAttr(hint, "title", "TD zählt mehr sichtbare Kinder, als das Paket enthält (Grenze oder Ausschluss beim Export).");
      this.hints.appendChild(hint);
    }
    if (lay.unknownRow) {
      this.hints.appendChild(el(doc, "p", "pv-hint", `${counted(lay.unknownRow.count, "Op", "Ops")} ohne exportierte Position: Reihe unten, Leitungen gestrichelt`));
    }
    if (lay.placeholders.length) {
      this.hints.appendChild(el(doc, "p", "pv-hint", `${counted(lay.placeholders.length, "Ende", "Enden")} außerhalb: nur als Platzhalter`));
    }
    const many = lay.ops.filter((o) => o.nIn > MAX_TICKS || o.nOut > MAX_TICKS).length;
    if (many) this.hints.appendChild(el(doc, "p", "pv-hint", `${counted(many, "Op", "Ops")} mit mehr als ${MAX_TICKS} Anschlüssen: Striche nur an belegten`));
  }

  _drawLayout(lay) {
    const doc = this.doc;
    const frag = doc.createDocumentFragment();
    const anns = svgEl(doc, "g", { class: "pv-net-anns" });
    for (const a of lay.annotations) anns.appendChild(this._drawAnnotation(a));
    frag.appendChild(anns);
    if (lay.unknownRow) {
      const r = lay.unknownRow;
      const g = svgEl(doc, "g", { class: "pv-net-unknown" });
      g.appendChild(svgEl(doc, "rect", { class: "pv-unknown-frame", x: r.x - 20, y: r.y - 12, width: r.w + 40, height: r.h + 32, rx: 8 }));
      const label = svgEl(doc, "text", { class: "pv-unknown-label", x: r.x, y: r.y + 10 });
      label.textContent = `Position nicht exportiert (${r.count}) – Reihe ist keine TD-Lage`;
      g.appendChild(label);
      frag.appendChild(g);
    }
    const couplings = svgEl(doc, "g", { class: "pv-net-couplings" });
    for (const k of lay.couplings) {
      if (k.d === null) continue;
      couplings.appendChild(svgEl(doc, "path", { class: "pv-couple", d: k.d }));
    }
    frag.appendChild(couplings);
    const wires = svgEl(doc, "g", { class: "pv-net-wires" });
    for (const w of lay.wires) {
      let cls = "pv-wire";
      if (w.kind === "comp") cls += " pv-wire-comp";
      if (w.dashed) cls += " pv-dashed";
      if (w.outer) cls += " pv-outer";
      const path = svgEl(doc, "path", { class: cls, d: w.d });
      wires.appendChild(path);
      for (const rel of [w.fromRel, w.toRel]) {
        if (rel === null) continue;
        const list = this.wiresByRel.get(rel);
        if (list) list.push({ node: path, wire: w });
        else this.wiresByRel.set(rel, [{ node: path, wire: w }]);
      }
    }
    frag.appendChild(wires);
    const phs = svgEl(doc, "g", { class: "pv-net-ph" });
    for (const p of lay.placeholders) phs.appendChild(this._drawPlaceholder(p));
    frag.appendChild(phs);
    const ops = svgEl(doc, "g", { class: "pv-net-ops" });
    lay.ops.forEach((o, i) => ops.appendChild(this._drawOp(o, i)));
    frag.appendChild(ops);
    return frag;
  }

  _drawOp(o, index) {
    const doc = this.doc;
    const fam = familyToken(o.family);
    let cls = "pv-op";
    if (fam) cls += ` pv-fam-${fam}`;
    if (!o.known) cls += " pv-unknown";
    if (o.isCOMP) cls += " pv-comp";
    const g = svgEl(doc, "g", { class: cls, tabindex: 0, role: "button", "aria-pressed": "false", "data-index": index });
    const where = o.known ? "" : `, Position nicht exportiert (${displayText(o.reason, 64)})`;
    const many = manyPortsText(o);
    setAttr(g, "aria-label", `${displayText(o.name, 160)}, ${displayText(o.opType, 64)}${o.isCOMP ? ", COMP" : ""}${where}${many ? `, ${many}` : ""}`);
    // Tooltip mit sichtbaren Marken statt roher Bidi-/Nullbreitenzeichen; der exakte Name steht in der Infozeile.
    const title = svgEl(doc, "title");
    title.textContent = displayText(`${o.name} (${o.opType})`, 400) + (many ? ` – ${many}` : "");
    g.appendChild(title);
    g.appendChild(svgEl(doc, "rect", { class: "pv-box", x: o.x, y: o.y, width: o.w, height: o.h, rx: 6 }));
    // Anschluss-Striche nur, wo mehr als ein Anschluss existiert: der Versatz je Index wird so sichtbar. Ueber MAX_TICKS
    // Anschluessen nur an belegten Indizes (tickIndices) - die Strichzahl haengt nie vom Indexwert des Pakets ab.
    const ticks = [];
    for (const i of tickIndices(o.nIn, o.usedIn)) ticks.push(`M${o.x} ${Math.round(o.y + (o.h * (i + 1)) / (o.nIn + 1))}h-7`);
    for (const i of tickIndices(o.nOut, o.usedOut)) ticks.push(`M${o.x + o.w} ${Math.round(o.y + (o.h * (i + 1)) / (o.nOut + 1))}h7`);
    if (ticks.length) g.appendChild(svgEl(doc, "path", { class: "pv-ticks", d: ticks.join("") }));
    const name = svgEl(doc, "text", { class: "pv-op-name", x: o.x + 8, y: o.y + Math.min(24, o.h * 0.4) });
    name.textContent = displayText(o.name, fitChars(o.w, NAME_CHAR_W));
    g.appendChild(name);
    if (o.h >= 44) {
      const type = svgEl(doc, "text", { class: "pv-op-type", x: o.x + 8, y: o.y + Math.min(44, o.h * 0.72) });
      type.textContent = displayText(o.opType, fitChars(o.w, TYPE_CHAR_W)) + (o.isCOMP ? " ▸" : "");
      g.appendChild(type);
    }
    if (!o.known) {
      const why = svgEl(doc, "text", { class: "pv-op-reason", x: o.x + 8, y: o.y + o.h - 10 });
      why.textContent = displayText(`ohne Position: ${o.reason}`, fitChars(o.w, TYPE_CHAR_W));
      g.appendChild(why);
    }
    this.opNodes.set(o.rel, g);
    return g;
  }

  _drawAnnotation(a) {
    const doc = this.doc;
    const title = markerText(a.title);
    const g = svgEl(doc, "g", { class: "pv-ann", tabindex: 0, role: "button" });
    setAttr(g, "aria-label", `Annotation ${displayText(title || a.name, 160)}`);
    g.appendChild(svgEl(doc, "rect", { class: "pv-ann-box", x: a.x, y: a.y, width: a.w, height: a.h, rx: 4 }));
    const head = svgEl(doc, "text", { class: "pv-ann-title", x: a.x + 12, y: a.y + 26 });
    head.textContent = displayText(title || a.name, fitChars(a.w, 9.5));
    g.appendChild(head);
    const body = markerText(a.body);
    if (body) {
      const text = svgEl(doc, "text", { class: "pv-ann-body", x: a.x + 12, y: a.y + 48 });
      const lines = body.split("\n");
      const room = Math.max(0, Math.floor((a.h - 56) / 18));
      lines.slice(0, Math.min(6, room)).forEach((line, i) => {
        const span = svgEl(doc, "tspan", { x: a.x + 12, y: a.y + 48 + i * 18 });
        span.textContent = displayText(line, fitChars(a.w, 7.4));
        text.appendChild(span);
      });
      if (text.firstChild) g.appendChild(text);
    }
    this.annNodes.set(a.rel, { node: g, annotation: a });
    return g;
  }

  _drawPlaceholder(p) {
    const doc = this.doc;
    // Nicht fokussierbar und ohne Aktion: ein Ende ausserhalb des Pakets ist kein Navigationsziel.
    const g = svgEl(doc, "g", { class: p.external ? "pv-ph pv-ph-external" : "pv-ph", role: "img" });
    setAttr(g, "aria-label", `${displayText(p.label, 300)}, ${p.side === "in" ? "Eingang" : "Ausgang"} ${p.index}`);
    const title = svgEl(doc, "title");
    title.textContent = displayText(p.label, 400);
    g.appendChild(title);
    g.appendChild(svgEl(doc, "rect", { class: "pv-ph-box", x: p.x, y: p.y, width: p.w, height: p.h, rx: 6 }));
    const text = svgEl(doc, "text", { class: "pv-ph-text", x: p.x + 10, y: p.y + 24 });
    text.textContent = displayText(p.label, fitChars(p.w, 7.2));
    g.appendChild(text);
    const sub = svgEl(doc, "text", { class: "pv-ph-sub", x: p.x + 10, y: p.y + 44 });
    sub.textContent = `${p.side === "in" ? "→ Eingang" : "Ausgang →"} ${p.index} · nicht navigierbar`;
    g.appendChild(sub);
    return g;
  }

  // ---------------------------------------------------------------- Auswahl
  _applySelection(rel) {
    const prev = this.state.selected;
    if (prev !== null) {
      const node = this.opNodes.get(prev);
      if (node) {
        node.classList.remove("pv-sel");
        setAttr(node, "aria-pressed", "false");
      }
      for (const { node: w, wire } of this.wiresByRel.get(prev) || []) {
        w.classList.remove("pv-hot");
        for (const other of [wire.fromRel, wire.toRel]) {
          const n = other !== null ? this.opNodes.get(other) : null;
          if (n) n.classList.remove("pv-linked");
        }
      }
    }
    const selected = rel !== null && this.opNodes.has(rel) ? rel : null;
    this.state.selected = rel;
    if (selected !== null) {
      const node = this.opNodes.get(selected);
      node.classList.add("pv-sel");
      setAttr(node, "aria-pressed", "true");
      for (const { node: w, wire } of this.wiresByRel.get(selected) || []) {
        w.classList.add("pv-hot");
        for (const other of [wire.fromRel, wire.toRel]) {
          const n = other !== null && other !== selected ? this.opNodes.get(other) : null;
          if (n) n.classList.add("pv-linked");
        }
      }
    }
    const op = selected !== null ? this.model.op(selected) : null;
    this.btnEnter.disabled = !(op && op.isCOMP && hasAction(this.actions, "enterComp"));
    this.btnDetails.disabled = !(op && hasAction(this.actions, "openDetails"));
    this.btnCode.disabled = !(op && codeKeyFor(this.model, selected) !== null && hasAction(this.actions, "openCode"));
    this._drawInfo(op);
  }

  _drawInfo(op) {
    const doc = this.doc;
    clear(this.info);
    if (this.annotation) {
      this._drawAnnotationInfo(this.annotation);
      return;
    }
    if (!op) {
      this.info.appendChild(el(doc, "p", "pv-hint", "Op antippen: auswählen · doppelt: COMP betreten · zwei Finger: zoomen"));
      return;
    }
    const head = el(doc, "div", "pv-info-head");
    appendExact(doc, head, op.name, "pv-u pv-strong");
    head.appendChild(el(doc, "span", "pv-chip", op.opType));
    head.appendChild(el(doc, "span", "pv-chip", op.family));
    this.info.appendChild(head);
    const path = el(doc, "div", "pv-info-path");
    appendExact(doc, path, op.path, "pv-u pv-mono");
    this.info.appendChild(path);
    const ins = this.model.inputs(op.rel).length;
    const outs = this.model.outputs(op.rel).length;
    const where = Object.hasOwn(op.node, "unknown") ? `Position nicht exportiert (${op.node.unknown})` : "Position exportiert";
    this.info.appendChild(el(doc, "p", "pv-hint", `${ins} Eingangsleitungen · ${outs} Ausgangsleitungen · ${where}`));
  }

  _drawAnnotationInfo(a) {
    const doc = this.doc;
    const head = el(doc, "div", "pv-info-head");
    head.appendChild(el(doc, "span", "pv-chip", "Annotation"));
    appendExact(doc, head, markerText(a.title) || a.name, "pv-u pv-strong");
    this.info.appendChild(head);
    const body = markerText(a.body);
    if (body) {
      const text = el(doc, "div", "pv-pre");
      appendExact(doc, text, body);
      this.info.appendChild(text);
    }
    if (a.enclosed.length) {
      const list = el(doc, "div", "pv-btnrow");
      list.appendChild(el(doc, "span", "pv-k", `umschließt ${a.enclosed.length}:`));
      for (const rel of a.enclosed) {
        const target = this.model.op(rel);
        list.appendChild(button(doc, "", () => this._select(rel), { exact: target ? target.name : rel, cls: "pv-btn pv-btn-link" }));
      }
      this.info.appendChild(list);
    }
  }

  _select(rel) {
    this.annotation = null;
    this._applySelection(rel);
    this._act("selectOp", rel);
  }

  // ---------------------------------------------------------------- Ansicht
  _applyTransform() {
    if (this.state.view) setAttr(this.world, "transform", viewTransform(this.state.view));
  }

  _setView(next, { commit = false, later = false } = {}) {
    this.state.view = next;
    this.state.autoFit = false;
    this._applyTransform();
    if (commit) this._commit();
    else if (later) this._commitLater();
  }

  _commit() {
    if (this.commitTimer) {
      clearTimeout(this.commitTimer);
      this.timers.delete(this.commitTimer);
      this.commitTimer = null;
    }
    if (!this.state.view) return;
    const { zoom, panX, panY } = this.state.view;
    callAction(this.actions, "setView", { zoom, panX, panY });
  }

  // Jede Aktion an die Huelle meldet zuerst eine noch ausstehende Ansicht (Rad/Tasten warten COMMIT_MS): die Huelle
  // spiegelt nach selectOp ihren gespeicherten Stand zurueck - ohne diese Meldung waere das der alte Zoom.
  _act(name, ...args) {
    if (this.commitTimer) this._commit();
    return callAction(this.actions, name, ...args);
  }

  _commitLater() {
    if (this.commitTimer) {
      clearTimeout(this.commitTimer);
      this.timers.delete(this.commitTimer);
    }
    this.commitTimer = this._later(() => {
      this.commitTimer = null;
      this._commit();
    }, COMMIT_MS);
  }

  _fit(commit) {
    if (!this.layout) return;
    const { w, h } = this._size();
    this.state.view = fitView(this.layout.bounds, w, h);
    this.state.autoFit = true;
    this._applyTransform();
    if (commit) {
      this._commit();
      // Einpassen per Knopf ist eine Nutzerentscheidung: weitere Groessenaenderungen passen trotzdem neu ein.
      this.state.autoFit = true;
    }
  }

  _zoomCenter(factor) {
    if (!this.state.view) return;
    const { w, h } = this._size();
    this._setView(zoomAt(this.state.view, factor, w / 2, h / 2), { commit: true });
  }

  // ---------------------------------------------------------------- Aktionen
  _goParent() {
    this._act("goParent");
  }

  _enterSelected() {
    const rel = this.state.selected;
    const op = rel !== null ? this.model.op(rel) : null;
    if (op && op.isCOMP) this._act("enterComp", rel);
  }

  _detailsSelected() {
    if (this.state.selected !== null && this.model.has(this.state.selected)) this._act("openDetails", this.state.selected);
  }

  _codeSelected() {
    const rel = this.state.selected;
    const key = rel !== null ? codeKeyFor(this.model, rel) : null;
    if (key !== null) this._act("openCode", key, null);
  }

  // ---------------------------------------------------------------- Zeiger und Gesten
  _point(e) {
    const rect = this.surface.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _hit(target) {
    if (!target || typeof target.closest !== "function") return null;
    const op = target.closest(".pv-op");
    if (op && this.world.contains(op)) {
      const index = Number(op.getAttribute("data-index"));
      const item = this.layout && Number.isSafeInteger(index) ? this.layout.ops[index] : null;
      return item ? { kind: "op", rel: item.rel } : null;
    }
    const ann = target.closest(".pv-ann");
    if (ann && this.world.contains(ann)) {
      for (const [rel, entry] of this.annNodes) if (entry.node === ann) return { kind: "ann", rel };
    }
    return null;
  }

  _onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
    this.pointers.set(e.pointerId, this._point(e));
    if (typeof this.surface.setPointerCapture === "function") {
      // Ein Zeiger, der waehrend der Geste die Flaeche verlaesst, soll weiter verschieben statt haengen zu bleiben.
      try {
        this.surface.setPointerCapture(e.pointerId);
      } catch (error) {
        if (!(error && error.name === "NotFoundError")) throw error;
      }
    }
    if (!this.state.view) return;
    if (this.pointers.size === 1) {
      this.gesture = { type: "pan", id: e.pointerId, start: this.pointers.get(e.pointerId), view: this.state.view, moved: false,
        target: this._hit(e.target), t0: Date.now() };
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.entries()];
      this.gesture = { type: "pinch", ids: [a[0], b[0]], a0: a[1], b0: b[1], view: this.state.view };
    }
  }

  _onPointerMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, this._point(e));
    const g = this.gesture;
    if (!g) return;
    if (g.type === "pan" && g.id === e.pointerId) {
      const p = this.pointers.get(e.pointerId);
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) > TAP_SLOP) g.moved = true;
      if (g.moved) this._setView(panBy(g.view, dx, dy));
      if (e.cancelable) e.preventDefault();
    } else if (g.type === "pinch" && g.ids.includes(e.pointerId)) {
      const a = this.pointers.get(g.ids[0]);
      const b = this.pointers.get(g.ids[1]);
      if (a && b) this._setView(pinchView(g.view, g.a0, g.b0, a, b));
      if (e.cancelable) e.preventDefault();
    }
  }

  _onPointerUp(e, cancelled) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;
    if (g.type === "pan" && g.id === e.pointerId) {
      this.gesture = null;
      if (g.moved) this._commit();
      else if (!cancelled && Date.now() - g.t0 <= TAP_MS) this._tap(g.target);
    } else if (g.type === "pinch" && g.ids.includes(e.pointerId)) {
      this._commit();
      // Ein Finger bleibt liegen: ab hier verschiebt er weiter, ohne als Antippen zu zaehlen.
      const rest = [...this.pointers.entries()][0];
      this.gesture = rest && this.state.view
        ? { type: "pan", id: rest[0], start: rest[1], view: this.state.view, moved: true, target: null, t0: 0 }
        : null;
    }
  }

  _tap(target) {
    if (!target) {
      this.annotation = null;
      if (this.state.selected !== null) {
        this._applySelection(null);
        this._act("selectOp", null);
      } else {
        this._drawInfo(null);
      }
      return;
    }
    if (target.kind === "ann") {
      const entry = this.annNodes.get(target.rel);
      this.annotation = entry ? entry.annotation : null;
      this._drawInfo(null);
      return;
    }
    const now = Date.now();
    const again = this.lastTap && this.lastTap.rel === target.rel && now - this.lastTap.t <= DOUBLE_MS;
    this.lastTap = again ? null : { rel: target.rel, t: now };
    if (again) {
      this._activate(target.rel);
      return;
    }
    this._select(target.rel);
  }

  // Doppelt / Enter auf dem ausgewaehlten Op: COMP betreten, sonst Details.
  _activate(rel) {
    const op = this.model.op(rel);
    if (!op) return;
    if (op.isCOMP && hasAction(this.actions, "enterComp")) this._act("enterComp", rel);
    else this._act("openDetails", rel);
  }

  _onWheel(e) {
    if (!this.state.view) return;
    e.preventDefault();
    const p = this._point(e);
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    this._setView(zoomAt(this.state.view, factor, p.x, p.y), { later: true });
  }

  _onKey(e) {
    if (!this.state.view) return;
    const target = this._hit(e.target);
    const key = e.key;
    let handled = true;
    if (key === "ArrowLeft") this._setView(panBy(this.state.view, KEY_PAN, 0), { later: true });
    else if (key === "ArrowRight") this._setView(panBy(this.state.view, -KEY_PAN, 0), { later: true });
    else if (key === "ArrowUp" && e.altKey) this._goParent();
    else if (key === "ArrowUp") this._setView(panBy(this.state.view, 0, KEY_PAN), { later: true });
    else if (key === "ArrowDown") this._setView(panBy(this.state.view, 0, -KEY_PAN), { later: true });
    else if (key === "+" || key === "=") this._zoomCenter(NET_ZOOM.step);
    else if (key === "-" || key === "_") this._zoomCenter(1 / NET_ZOOM.step);
    else if (key === "0") this._fit(true);
    else if (key === "Escape") this._tap(null);
    else if ((key === "Enter" || key === " ") && target && target.kind === "op") {
      if (this.state.selected === target.rel) this._activate(target.rel);
      else this._select(target.rel);
    } else if ((key === "Enter" || key === " ") && target && target.kind === "ann") this._tap(target);
    else handled = false;
    if (handled) e.preventDefault();
  }

  _onFocus(e) {
    const target = this._hit(e.target);
    if (!target || target.kind !== "op" || !this.layout || !this.state.view) return;
    const item = this.layout.byRel.get(target.rel);
    if (!item) return;
    const { w, h } = this._size();
    const next = ensureVisible(this.state.view, item, w, h);
    if (!sameView(next, this.state.view)) this._setView(next, { commit: true });
  }

  // ---------------------------------------------------------------- Huelle
  update(view) {
    if (this.destroyed || !isRecord(view)) return;
    const comp = typeof view.comp === "string" ? view.comp : "";
    if (comp !== this.state.comp) {
      this._rebuild(view);
      return;
    }
    const selected = typeof view.selected === "string" ? view.selected : null;
    if (selected !== this.state.selected) {
      this.annotation = null;
      this._applySelection(selected);
    }
    if (isViewValue(view)) {
      // Waehrend einer Geste oder vor der verzoegerten Meldung gehoert die Ansicht dem Nutzer: jeder eingehende Zoom/Pan
      // ist dann ein Stand von vorher (Echo oder gespeicherter Wert) - auch wenn noch nie gemeldet wurde.
      const pending = this.pointers.size > 0 || this.commitTimer !== null;
      const next = { zoom: view.zoom, panX: view.panX, panY: view.panY };
      if (!pending && !sameView(next, this.state.view)) this._setView(next);
    } else if (view.zoom === null && !this.state.autoFit) {
      this._fit(true);
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    if (this.resize) this.resize.disconnect();
    for (const [node, type, fn, opts] of this.listeners) node.removeEventListener(type, fn, opts);
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.opNodes.clear();
    this.wiresByRel.clear();
    this.annNodes.clear();
  }
}

export function renderNetwork(container, model, view, actions) {
  const net = new NetworkView(container, model, view, actions);
  return { update: (next) => net.update(next), destroy: () => net.destroy() };
}

