// Projektansicht CODE (Vertrag 14, Auftrag Mobile Explorer): Code Reader fuer eine Quelle des Projektmodells.
// - Exakter Text: Zeilen = LF-Index-Zeilen aus model.sourceLines (einmal zerlegt), Token-Spans ergeben die Zeile.
// - Fensterweise: hoechstens MAX_DOM_LINES Zeilen gleichzeitig im DOM (virtuelles Scrollen mit fester Zeilenhoehe);
//   horizontales Scrollen bleibt im Reader (overscroll-behavior: contain).
// - Quellen mit status != exact zeigen den Grund statt Text; ein kaputter Analyse-Eintrag laesst den Text lesbar.
// - Uebersicht aller Klassen und Modulfunktionen aus der Analyse, Sprung zu Zeile/Symbol, Suche in der Datei,
//   Falten, Kopieren (Code, Pfad, Auswahl), Notiz-Entwurf ueber actions.addNote mit Anker aus js/projects/anchors.js.
// view = {source, line, scrollTop, find}. Erstes Rendern: scrollTop (Zahl) stellt die Lesestelle wieder her, sonst
// springt line in Sicht. update(): neue line springt immer (auch mit der zuletzt gemeldeten scrollTop), sonst stellt
// eine geaenderte scrollTop wieder her; ein Echo der eigenen scrollTop-Meldung aendert die Lesestelle nicht.

import {
  appendExact, button, callAction, certaintyChip, clear, displayText, el, hasAction, isRecord, labelMap, labelOf,
  markedSpan, setAttr, splitMarked,
} from "./project-dom.js";
import { lineStates, splitAtMatches, tokenizeLine } from "./project-highlight.js";
import { createAnchor } from "../projects/anchors.js";

export const CODE_ROW_PX = 20;
export const MAX_DOM_LINES = 2000;
const OVERSCAN = 120;
const FALLBACK_VIEW_PX = 600;
// Hoechste Scrollhoehe; darueber (Hunderttausende Zeilen) wird der Zeilenabstand der Scrollleiste gestaucht,
// damit Browser-Hoehengrenzen nicht greifen. Die Zeilen selbst bleiben CODE_ROW_PX hoch.
const MAX_SCROLL_PX = 8000000;
const MAX_MATCHES = 10000;
const REPORT_MS = 200;
// Tabellen: Zellen im DOM begrenzen (100 000 Zellen sind erlaubt); breite Tabellen zeigen weniger Zeilen je Fenster.
const MAX_TABLE_CELLS = 20000;
const MAX_TABLE_COLS = 400;

export const STATUS_TEXT = labelMap([
  ["exact", "vollständig übertragen"],
  ["truncated", "gekürzt übertragen"],
  ["omitted-secret", "Nicht übertragen: Geheimnis-Fund. Der Inhalt bleibt auf dem PC."],
  ["omitted-size", "Nicht übertragen: Quelle zu groß."],
  ["omitted-type", "Nicht übertragen: dieser DAT-Typ wird nicht gelesen."],
  ["derived-not-read", "Nicht gelesen: der Inhalt entsteht erst in TD (abgeleiteter DAT)."],
  ["unreadable", "Nicht lesbar beim Export."],
  ["excluded-user", "Beim Export ausgeschlossen."],
  ["invalid-unicode", "Nicht übertragen: ungültiges Unicode."],
]);
const LANGUAGE_TEXT = labelMap([
  ["python", "Python"], ["glsl", "GLSL"], ["text", "Text"], ["json", "JSON"], ["xml", "XML"], ["yaml", "YAML"],
  ["table", "Tabelle"], ["unknown", "unbekannt"],
]);
const ENTRY_TEXT = labelMap([
  ["parse", "Analyse: kein lesbares Python. Text bleibt lesbar, Übersicht fehlt."],
  ["limit", "Analyse ausgelassen: Quelle zu groß."],
  ["schema", "Analyse-Eintrag fehlerhaft (Schema). Text bleibt lesbar."],
]);
const KIND_TEXT = labelMap([
  ["code-op", "op()"], ["code-shortcut", "Shortcut"], ["code-parent", "parent()"], ["code-iop", "iop"],
  ["code-module", "mod()/module"], ["par-expr", "Expression"], ["par-bind", "Bind"], ["par-export", "Export"],
  ["par-op", "OP-Par"], ["par-watch", "Watch-Par"], ["ext-object", "Extension"], ["callbacks", "Callbacks"],
  ["glsl", "GLSL"], ["dock", "Dock"],
]);
const UNRESOLVED_TEXT = labelMap([
  ["dynamic", "dynamisches Ziel"], ["not-found", "nicht gefunden"], ["pattern", "Muster"],
  ["mode-expression", "Shortcut ist Expression"], ["error", "Fehler beim Auflösen"],
]);
export const EDGE_REASON_TEXT = labelMap([
  ["run-string", "Ziel nur in einem run()-String, vermutet"], ["dynamic", "dynamisches Ziel"],
  ["no-class", "Aufruf außerhalb einer Klasse"], ["not-in-class", "nicht in der eigenen Klasse"],
  ["api", "TD-/Python-API, nicht im Paket"], ["no-reference", "kein Verweis an dieser Stelle"],
  ["ambiguous", "mehrdeutig"], ["external", "Ziel außerhalb des Exports"], ["op-only", "Op bekannt, Methode nicht"],
  ["same-source", "über einen Verweis derselben Quelle"],
]);
const ANCHOR_ERROR_TEXT = labelMap([
  ["size", "Ausschnitt zu groß für eine Notiz (höchstens 65 536 Zeichen)."],
  ["range", "Zeilenbereich ungültig."],
  ["source", "Quelle ist nicht als Text übertragen."],
  ["symbol", "Symbol nicht gefunden."],
  ["op", "Op nicht im Paket."],
  ["integrity.unavailable", "Notizen brauchen WebCrypto (nur über https bzw. in der App)."],
]);

// Je Modell (= je Revision) einmal: Zustaende je Zeile, Aufrufkanten je Zeile. WeakMap: faellt mit dem Modell weg.
const CACHE = new WeakMap();

function cacheFor(model, key) {
  let perModel = CACHE.get(model);
  if (!perModel) {
    perModel = new Map();
    CACHE.set(model, perModel);
  }
  let entry = perModel.get(key);
  if (!entry) {
    entry = { states: null, edgesByLine: null };
    perModel.set(key, entry);
  }
  return entry;
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

export function entryProblem(entry) {
  if (!isRecord(entry)) return null;
  if (entry.skipped === "helper") return "Helper (ExtUtils): nicht analysiert.";
  if (typeof entry.error === "string") return labelOf(ENTRY_TEXT, entry.error, "Analyse nicht verfügbar.");
  return null;
}

export function unresolvedText(reason) {
  return labelOf(UNRESOLVED_TEXT, reason, "nicht aufgelöst");
}

export function referenceKindText(kind) {
  return labelOf(KIND_TEXT, kind);
}

export function edgeReasonText(reason) {
  if (typeof reason !== "string") return "";
  if (reason.startsWith("unresolved:")) return `Verweis nicht aufgelöst: ${unresolvedText(reason.slice(11))}`;
  return labelOf(EDGE_REASON_TEXT, reason);
}

class CodeView {
  constructor(container, model, view, actions) {
    this.container = container;
    this.doc = container.ownerDocument;
    this.model = model;
    this.actions = actions || {};
    this.timers = new Set();
    this.destroyed = false;
    this.key = null;
    // Zuletzt an die Huelle gemeldete Werte: ein spaetes Echo davon darf die laufende Lesestelle nicht zuruecksetzen.
    this.reported = { scrollTop: null, find: null };
    this._build();
    this._open(isRecord(view) ? view : {});
  }

  _later(fn, ms) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (!this.destroyed) fn();
    }, ms);
    this.timers.add(id);
    return id;
  }

  _cancel(id) {
    if (id) {
      clearTimeout(id);
      this.timers.delete(id);
    }
  }

  // ---------------------------------------------------------------- Grundgeruest
  _build() {
    const doc = this.doc;
    this.root = el(doc, "div", "pv-root pv-code");
    this.head = el(doc, "div", "pv-code-head");
    this.root.appendChild(this.head);
    const actions = el(doc, "div", "pv-code-actions pv-btnrow");
    this.btnCopyPath = button(doc, "Pfad kopieren", () => this._copyPath());
    this.btnCopyCode = button(doc, "Code kopieren", () => this._copyCode());
    this.btnCopySel = button(doc, "Auswahl kopieren", () => this._copySelection());
    this.btnDetails = button(doc, "Details", () => callAction(this.actions, "openDetails", this.key));
    this.btnOutline = button(doc, "Übersicht", () => this._toggleOutline(), { pressed: false });
    for (const b of [this.btnCopyPath, this.btnCopyCode, this.btnCopySel, this.btnDetails, this.btnOutline]) actions.appendChild(b);
    this.root.appendChild(actions);
    const find = el(doc, "div", "pv-code-find pv-btnrow");
    this.findInput = el(doc, "input", "pv-input");
    setAttr(this.findInput, "type", "search");
    setAttr(this.findInput, "placeholder", "In Datei suchen");
    setAttr(this.findInput, "aria-label", "In dieser Datei suchen");
    setAttr(this.findInput, "autocomplete", "off");
    setAttr(this.findInput, "spellcheck", "false");
    setAttr(this.findInput, "enterkeyhint", "search");
    this.findInput.addEventListener("input", () => this._setFind(this.findInput.value, { report: true }));
    this.findInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this._stepMatch(e.shiftKey ? -1 : 1);
      }
    });
    this.btnPrev = button(doc, "◀", () => this._stepMatch(-1), { title: "Vorheriger Treffer" });
    this.btnNext = button(doc, "▶", () => this._stepMatch(1), { title: "Nächster Treffer" });
    setAttr(this.btnPrev, "aria-label", "Vorheriger Treffer");
    setAttr(this.btnNext, "aria-label", "Nächster Treffer");
    this.findCount = el(doc, "span", "pv-hint pv-find-count");
    setAttr(this.findCount, "aria-live", "polite");
    this.gotoInput = el(doc, "input", "pv-input pv-input-line");
    setAttr(this.gotoInput, "type", "text");
    setAttr(this.gotoInput, "inputmode", "numeric");
    setAttr(this.gotoInput, "placeholder", "Zeile");
    setAttr(this.gotoInput, "aria-label", "Zu Zeile springen");
    this.gotoInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this._gotoFromInput();
      }
    });
    this.btnGoto = button(doc, "Gehe", () => this._gotoFromInput(), { title: "Zu Zeile springen" });
    for (const n of [this.findInput, this.btnPrev, this.btnNext, this.findCount, this.gotoInput, this.btnGoto]) find.appendChild(n);
    this.root.appendChild(find);
    const notes = el(doc, "div", "pv-code-notes pv-btnrow");
    this.btnRange = button(doc, "Bereich wählen", () => this._toggleRange(), { pressed: false });
    this.btnNote = button(doc, "Notiz zur Auswahl", () => this._note("range"));
    this.btnNoteSymbol = button(doc, "Notiz zum Symbol", () => this._note("symbol"));
    this.btnNoteOp = button(doc, "Notiz zum Op", () => this._note("op"));
    for (const b of [this.btnRange, this.btnNote, this.btnNoteSymbol, this.btnNoteOp]) notes.appendChild(b);
    this.root.appendChild(notes);
    this.banner = el(doc, "div", "pv-code-banner");
    setAttr(this.banner, "aria-live", "polite");
    this.root.appendChild(this.banner);
    this.outline = el(doc, "div", "pv-outline");
    this.outline.hidden = true;
    this.root.appendChild(this.outline);
    this.lineInfo = el(doc, "div", "pv-lineinfo");
    this.root.appendChild(this.lineInfo);
    this.scroller = el(doc, "div", "pv-code-scroll");
    setAttr(this.scroller, "tabindex", "0");
    setAttr(this.scroller, "role", "region");
    this.sizer = el(doc, "div", "pv-code-sizer");
    this.win = el(doc, "div", "pv-code-win");
    this.sizer.appendChild(this.win);
    this.scroller.appendChild(this.sizer);
    this.root.appendChild(this.scroller);
    this.container.appendChild(this.root);
    this.onScroll = () => this._onScroll();
    this.onClick = (e) => this._onClick(e);
    this.scroller.addEventListener("scroll", this.onScroll, { passive: true });
    this.scroller.addEventListener("click", this.onClick);
  }

  // ---------------------------------------------------------------- Quelle oeffnen
  _open(view) {
    const doc = this.doc;
    // Ausstehende Meldungen gehoeren zur alten Quelle; sie duerfen nicht mit Werten der neuen ankommen.
    this._cancel(this.reportTimer);
    this._cancel(this.findTimer);
    this.reportTimer = null;
    this.findTimer = null;
    this.key = typeof view.source === "string" ? view.source : null;
    this.src = this.key !== null ? this.model.source(this.key) : null;
    this.mode = "none";
    this.lines = [];
    this.rows = null;
    this.folded = new Set();
    this.matches = new Map();
    this.matchList = [];
    this.matchAt = -1;
    this.find = "";
    this.focus = null;
    this.sel = null;
    this.rangeMode = false;
    this.rangeStart = null;
    this.window = null;
    this.message = null;
    this.states = null;
    this.language = "text";
    this.reported = { scrollTop: null, find: null };
    setAttr(this.btnRange, "aria-pressed", "false");
    clear(this.head);
    clear(this.banner);
    clear(this.outline);
    clear(this.lineInfo);
    clear(this.win);
    const src = this.src;
    const path = this.key !== null && this.model.has(this.key) ? this.model.abs(this.key) : this.key ?? "";
    const title = el(doc, "div", "pv-code-title");
    title.appendChild(el(doc, "span", "pv-k", "CODE"));
    appendExact(doc, title, path, "pv-u pv-mono");
    this.head.appendChild(title);
    setAttr(this.scroller, "aria-label", `Code ${displayText(path, 200)}`);
    if (!src) {
      this._banner(this.key === null ? "Keine Quelle gewählt." : "Diese Quelle ist nicht im Paket.", "pv-warn");
      this._setEnabled();
      this._layoutSizer();
      return;
    }
    this._drawChips(src);
    if (src.status === "exact" && typeof src.text === "string") {
      this.mode = "text";
      this.lines = this.model.sourceLines(this.key);
      const cache = cacheFor(this.model, this.key);
      if (!cache.states) cache.states = lineStates(src.language, this.lines);
      this.states = cache.states;
      this.language = src.language;
      if (!this.lines.length) this._banner("Leerer Text (0 Zeilen).", "");
      const problem = entryProblem(this.model.entry(this.key));
      if (problem) this._banner(problem, "pv-warn");
      else if (src.language === "python" && this.model.entry(this.key) === null) this._banner("Keine Analyse im Paket für diese Quelle.", "");
      if (this.lines.some((line) => line.endsWith("\r"))) this._chip("CRLF");
    } else if (Array.isArray(src.table)) {
      this.mode = "table";
      this.lines = src.table;
      if (src.status === "truncated" && isRecord(src.truncation)) {
        const t = src.truncation;
        this._banner(`Tabelle gekürzt übertragen: ${t.keptRows} von ${t.rows} Zeilen, ${t.keptCols} von ${t.cols} Spalten.`, "pv-warn");
      }
      const cols = this.lines.reduce((max, row) => Math.max(max, row.length), 0);
      if (cols > MAX_TABLE_COLS) this._banner(`Angezeigt werden die ersten ${MAX_TABLE_COLS} von ${cols} Spalten; Zellen bleiben vollständig im Paket.`, "pv-warn");
    } else {
      this._banner(labelOf(STATUS_TEXT, src.status, "Nicht übertragen."), "pv-warn pv-reason");
    }
    this._buildOutline();
    this._setEnabled();
    this._layoutSizer();
    if (typeof view.find === "string" && view.find) {
      this.findInput.value = view.find;
      this._setFind(view.find, { report: false, jump: false });
    } else {
      this.findInput.value = "";
      this._showCount();
    }
    const line = Number.isSafeInteger(view.line) ? view.line : null;
    const validLine = line !== null && this._validLine(line);
    // Gespeicherte Lesestelle gewinnt, solange die Fokuszeile dort sichtbar ist; sonst ist es ein Sprung.
    if (Number.isFinite(view.scrollTop) && view.scrollTop >= 0 && (!validLine || this._rowVisibleAt(this._rowOfLine(line), view.scrollTop))) {
      this.scroller.scrollTop = view.scrollTop;
      if (validLine) this._setFocus(line, { report: false, scroll: false });
      else this._renderWindow(true);
    } else if (validLine) {
      this._jumpToLine(line, { report: false });
    } else {
      this.scroller.scrollTop = 0;
      this._renderWindow(true);
    }
  }

  _chip(text) {
    this.head.appendChild(el(this.doc, "span", "pv-chip", text));
  }

  _drawChips(src) {
    const doc = this.doc;
    this._chip(`${labelOf(LANGUAGE_TEXT, src.language)}${src.languageFrom === "guess" ? " (geraten)" : ""}`);
    this._chip(src.datType);
    if (src.status !== "exact") this._chip(src.status);
    if (Number.isSafeInteger(src.lines)) this._chip(`${src.lines} ${src.language === "table" ? "Zeilen (Tabelle)" : "Zeilen"}`);
    for (const role of src.roles) {
      let text = "";
      if (role.kind === "extension") text = `Extension · Slot ${role.slot}`;
      else if (role.kind === "callbacks") text = "Callbacks";
      else if (role.kind === "glsl") text = "GLSL";
      else if (role.kind === "execute") text = `Execute (${role.subtype})`;
      else if (role.kind === "module") text = "Modul";
      if (text) this._chip(text);
    }
    if (src.duplicateOf !== null) {
      const dup = button(doc, "gleicher Text wie ", () => callAction(this.actions, "openSource", src.duplicateOf, null), {
        cls: "pv-btn pv-btn-link", exact: src.duplicateOf, disabled: !hasAction(this.actions, "openSource"),
      });
      this.head.appendChild(dup);
    }
    if (isRecord(src.file) && typeof src.file.value === "string") {
      const file = el(doc, "span", "pv-chip");
      file.appendChild(doc.createTextNode(src.file.syncfile ? "Datei (sync): " : "Datei: "));
      appendExact(doc, file, src.file.value);
      this.head.appendChild(file);
    }
  }

  _banner(text, cls) {
    this.banner.appendChild(el(this.doc, "p", cls ? `pv-hint ${cls}` : "pv-hint", text));
  }

  _message(text) {
    if (this.message && this.message.parentNode) this.message.parentNode.removeChild(this.message);
    this.message = el(this.doc, "p", "pv-hint pv-note-msg", text);
    this.banner.appendChild(this.message);
  }

  _validLine(n) {
    return Number.isSafeInteger(n) && n >= 1 && n <= this.lines.length;
  }

  _setEnabled() {
    const text = this.mode === "text";
    const any = text || this.mode === "table";
    this.btnCopyPath.disabled = this.key === null || !hasAction(this.actions, "copyText");
    this.btnCopyCode.disabled = !text || !hasAction(this.actions, "copyText");
    this.btnCopySel.disabled = !text || this.sel === null || !hasAction(this.actions, "copyText");
    this.btnDetails.disabled = this.key === null || !this.model.has(this.key) || !hasAction(this.actions, "openDetails");
    this.btnOutline.disabled = !text;
    this.findInput.disabled = !any;
    this.gotoInput.disabled = !any;
    this.btnGoto.disabled = !any;
    this.btnPrev.disabled = !this.matchList.length;
    this.btnNext.disabled = !this.matchList.length;
    const canNote = hasAction(this.actions, "addNote");
    this.btnRange.disabled = !text;
    this.btnNote.disabled = !text || !canNote || (this.sel === null && this.focus === null);
    this.btnNoteSymbol.disabled = !text || !canNote || this.focus === null || this.model.symbolAt(this.key, this.focus) === null;
    this.btnNoteOp.disabled = !canNote || this.key === null || !this.model.has(this.key);
  }

  // ---------------------------------------------------------------- Uebersicht und Falten
  _buildOutline() {
    const doc = this.doc;
    clear(this.outline);
    if (this.mode !== "text") return;
    const classes = [...this.model.classes(this.key)].sort((a, b) => a.line - b.line);
    const symbols = [...this.model.symbols(this.key)].sort((a, b) => a.line - b.line);
    const problem = entryProblem(this.model.entry(this.key));
    if (problem) {
      this.outline.appendChild(el(doc, "p", "pv-hint", problem));
      return;
    }
    if (!classes.length && !symbols.length) {
      this.outline.appendChild(el(doc, "p", "pv-hint", "Keine Klassen oder Funktionen in der Analyse."));
      return;
    }
    const byClass = new Map();
    const moduleFns = [];
    for (const s of symbols) {
      if (s.class === null) moduleFns.push(s);
      else if (byClass.has(s.class)) byClass.get(s.class).push(s);
      else byClass.set(s.class, [s]);
    }
    const list = el(doc, "ul", "pv-outline-list");
    for (const cls of classes) {
      const item = this._outlineItem("class", cls.name, "", cls.line, cls.end);
      const members = byClass.get(cls.name) || [];
      if (members.length) {
        const sub = el(doc, "ul", "pv-outline-list");
        for (const s of members) sub.appendChild(this._outlineItem(s.kind === "property" ? "property" : "def", s.name, s.params.join(", "), s.line, s.end));
        item.appendChild(sub);
      }
      list.appendChild(item);
    }
    // Methoden ohne passende Klassenzeile (Analysefehler) gehen nicht verloren.
    for (const [cls, members] of byClass) {
      if (classes.some((c) => c.name === cls)) continue;
      for (const s of members) list.appendChild(this._outlineItem("def", `${cls}.${s.name}`, s.params.join(", "), s.line, s.end));
    }
    if (moduleFns.length) {
      list.appendChild(el(doc, "li", "pv-outline-group", "Modulfunktionen"));
      for (const s of moduleFns) list.appendChild(this._outlineItem("def", s.name, s.params.join(", "), s.line, s.end));
    }
    this.outline.appendChild(list);
    const all = button(doc, "Alles aufklappen", () => this._unfoldAll());
    this.outline.appendChild(all);
  }

  _outlineItem(kind, name, params, line, end) {
    const doc = this.doc;
    const li = el(doc, "li", "pv-outline-item");
    const row = el(doc, "div", "pv-outline-row");
    const jump = button(doc, `${kind} `, () => this._jumpToLine(line, { report: true }), { cls: "pv-btn pv-btn-link pv-outline-jump" });
    appendExact(doc, jump, name, "pv-u pv-mono");
    if (kind !== "class") jump.appendChild(doc.createTextNode(`(${params})`));
    jump.appendChild(el(doc, "span", "pv-dim", ` Z. ${line}`));
    row.appendChild(jump);
    if (Number.isSafeInteger(end) && end > line) {
      const key = `${line}:${end}`;
      const fold = button(doc, "falten", null, { cls: "pv-btn pv-fold-btn", pressed: false });
      setAttr(fold, "aria-label", `Zeilen ${line + 1} bis ${end} falten`);
      fold.addEventListener("click", () => this._toggleFold(key, fold));
      row.appendChild(fold);
    }
    li.appendChild(row);
    return li;
  }

  _toggleOutline() {
    this.outline.hidden = !this.outline.hidden;
    setAttr(this.btnOutline, "aria-pressed", this.outline.hidden ? "false" : "true");
  }

  _toggleFold(key, node) {
    if (this.folded.has(key)) this.folded.delete(key);
    else this.folded.add(key);
    if (node) {
      const on = this.folded.has(key);
      setAttr(node, "aria-pressed", on ? "true" : "false");
      node.textContent = on ? "aufklappen" : "falten";
    }
    this._recomputeRows();
  }

  _unfoldAll() {
    this.folded.clear();
    for (const node of this.outline.querySelectorAll(".pv-fold-btn")) {
      setAttr(node, "aria-pressed", "false");
      node.textContent = "falten";
    }
    this._recomputeRows();
  }

  // Sichtbare Zeilen nach dem Falten: null = alle (kein 35 000-Eintraege-Feld fuer den Normalfall).
  _recomputeRows() {
    const anchorLine = this.window ? this._lineAtRow(this._firstVisibleRow()) : 1;
    if (!this.folded.size) this.rows = null;
    else {
      const ends = new Map();
      for (const key of this.folded) {
        const [start, end] = key.split(":").map(Number);
        ends.set(start, Math.max(ends.get(start) || 0, end));
      }
      const out = [];
      let n = 1;
      while (n <= this.lines.length) {
        out.push(n);
        const end = ends.get(n);
        n = end !== undefined ? end + 1 : n + 1;
      }
      this.rows = Int32Array.from(out);
    }
    this._layoutSizer();
    this._scrollRowIntoView(this._rowOfLine(anchorLine), 0);
  }

  _foldEndAt(line) {
    let end = null;
    for (const key of this.folded) {
      const [start, stop] = key.split(":").map(Number);
      if (start === line) end = Math.max(end ?? 0, stop);
    }
    return end;
  }

  _unfoldAround(line) {
    let changed = false;
    for (const key of [...this.folded]) {
      const [start, end] = key.split(":").map(Number);
      if (line > start && line <= end) {
        this.folded.delete(key);
        changed = true;
      }
    }
    if (changed) {
      for (const node of this.outline.querySelectorAll(".pv-fold-btn")) {
        setAttr(node, "aria-pressed", "false");
        node.textContent = "falten";
      }
      for (const key of this.folded) this._markFoldButton(key, true);
      this._recomputeRows();
    }
  }

  _markFoldButton(key, on) {
    const [start, end] = key.split(":").map(Number);
    for (const node of this.outline.querySelectorAll(".pv-fold-btn")) {
      if (node.getAttribute("aria-label") === `Zeilen ${start + 1} bis ${end} falten`) {
        setAttr(node, "aria-pressed", on ? "true" : "false");
        node.textContent = on ? "aufklappen" : "falten";
      }
    }
  }

  // ---------------------------------------------------------------- Zeilen-Fenster
  _rowCount() {
    return this.rows ? this.rows.length : this.lines.length;
  }

  _lineAtRow(row) {
    return this.rows ? this.rows[row] : row + 1;
  }

  _rowOfLine(line) {
    if (!this.rows) return Math.max(0, line - 1);
    let lo = 0;
    let hi = this.rows.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.rows[mid] <= line) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  // Scrollweg je Zeile. Gestaucht (mehr als MAX_SCROLL_PX / CODE_ROW_PX Zeilen) so, dass bei groesster scrollTop
  // (MAX_SCROLL_PX - Bildhoehe) die letzte Zeile unten im Bild steht: (Zeilen - Bildzeilen) * pitch = MAX_SCROLL_PX - h.
  // Vorher MAX_SCROLL_PX / Zeilen - dann lagen die letzten h/pitch - h/CODE_ROW_PX Zeilen nie im Bild (Befund oberflaeche-f4).
  _pitch() {
    const total = this._rowCount();
    if (total * CODE_ROW_PX <= MAX_SCROLL_PX) return CODE_ROW_PX;
    const h = this._viewHeight();
    return (MAX_SCROLL_PX - h) / Math.max(1, total - h / CODE_ROW_PX);
  }

  _layoutSizer() {
    const total = this._rowCount();
    this.sizer.style.height = `${Math.ceil(total * CODE_ROW_PX > MAX_SCROLL_PX ? MAX_SCROLL_PX : total * CODE_ROW_PX)}px`;
  }

  _viewHeight() {
    const h = this.scroller.clientHeight;
    return h > 0 ? h : FALLBACK_VIEW_PX;
  }

  _rowVisibleAt(row, scrollTop) {
    const pitch = this._pitch();
    const first = Math.floor(scrollTop / pitch);
    return row >= first && row < first + Math.floor(this._viewHeight() / CODE_ROW_PX);
  }

  _firstVisibleRow() {
    return Math.max(0, Math.min(this._rowCount() - 1, Math.floor(this.scroller.scrollTop / this._pitch())));
  }

  // Zielzeile auf fraction der Bildhoehe. Die Zeilen stehen CODE_ROW_PX auseinander, die Scrollleiste rechnet mit
  // pitch je Zeile: der Abstand wird darum in Zeilen umgerechnet (bei normalem Abstand ist das dasselbe wie vorher).
  _scrollRowIntoView(row, fraction = 1 / 3) {
    const target = Math.max(0, (row - (this._viewHeight() * fraction) / CODE_ROW_PX) * this._pitch());
    this.scroller.scrollTop = target;
    this._renderWindow(true);
  }

  _renderWindow(force) {
    if (this.mode !== "text" && this.mode !== "table") {
      clear(this.win);
      this.window = null;
      return;
    }
    const total = this._rowCount();
    const pitch = this._pitch();
    const first = this._firstVisibleRow();
    const visible = Math.ceil(this._viewHeight() / CODE_ROW_PX) + 1;
    const w = this.window;
    const guard = OVERSCAN >> 1;
    const inside = w && first >= w.start && first + visible <= w.end
      && (first - w.start >= guard || w.start === 0) && (w.end - (first + visible) >= guard || w.end === total);
    if (!force && inside) {
      if (pitch < CODE_ROW_PX) this._placeWindow();
      return;
    }
    let budget = Math.min(MAX_DOM_LINES, visible + 2 * OVERSCAN);
    if (this.mode === "table") {
      const cols = Math.min(MAX_TABLE_COLS, this.lines.reduce((max, row) => Math.max(max, row.length), 0));
      budget = Math.min(budget, Math.max(visible + 4, Math.floor(MAX_TABLE_CELLS / Math.max(1, cols))));
    }
    const over = Math.max(0, Math.floor((budget - visible) / 2));
    const start = Math.max(0, Math.min(first - over, total - budget));
    const end = Math.min(total, start + budget);
    this.window = { start, end };
    const frag = this.doc.createDocumentFragment();
    if (this.mode === "text") {
      for (let row = start; row < end; row += 1) frag.appendChild(this._lineNode(this._lineAtRow(row)));
    } else {
      frag.appendChild(this._tableNode(start, end));
    }
    clear(this.win);
    this.win.appendChild(frag);
    this._placeWindow();
  }

  // Fensterlage: bei normalem Zeilenabstand einfach start * Zeilenhoehe; bei gestauchter Scrollleiste so, dass die
  // erste sichtbare Zeile oben steht.
  _placeWindow() {
    if (!this.window) return;
    const pitch = this._pitch();
    const top = pitch === CODE_ROW_PX
      ? this.window.start * CODE_ROW_PX
      : this.scroller.scrollTop - (this.scroller.scrollTop / pitch - this.window.start) * CODE_ROW_PX;
    this.win.style.top = `${Math.max(0, Math.round(top))}px`;
  }

  _lineNode(n) {
    const doc = this.doc;
    const text = this.lines[n - 1];
    const row = el(doc, "div", "pv-ln");
    setAttr(row, "data-line", n);
    if (n === this.focus) row.classList.add("pv-focus");
    if (this.sel && n >= this.sel[0] && n <= this.sel[1]) row.classList.add("pv-in-sel");
    const hits = this.matches.get(n);
    if (hits) row.classList.add("pv-find-line");
    if (this.matchAt >= 0 && this.matchList[this.matchAt] && this.matchList[this.matchAt].line === n) row.classList.add("pv-find-cur");
    const no = el(doc, "span", "pv-no", String(n));
    setAttr(no, "aria-hidden", "true");
    row.appendChild(no);
    const code = el(doc, "span", "pv-src");
    const { tokens } = tokenizeLine(this.language, text, this.states[n - 1]);
    for (const [cls, start, end, hit] of splitAtMatches(tokens, hits)) {
      const piece = text.slice(start, end);
      const tokenClass = cls ? `pv-t pv-t-${cls}${hit ? " pv-hit" : ""}` : `pv-t${hit ? " pv-hit" : ""}`;
      // Markierte Zeichen (Bidi, Nullbreite, Steuerzeichen) in eigene, isolierte Spans - der Text bleibt exakt.
      for (const part of splitMarked(piece, { keepTrailingCR: end === text.length })) {
        if (part.marked) code.appendChild(markedSpan(doc, part.text, `pv-t${hit ? " pv-hit" : ""}`));
        else code.appendChild(el(doc, "span", tokenClass, part.text));
      }
    }
    row.appendChild(code);
    const foldEnd = this._foldEndAt(n);
    if (foldEnd !== null) {
      row.classList.add("pv-folded");
      row.appendChild(el(doc, "span", "pv-fold-chip", `⋯ ${foldEnd - n} Zeilen gefaltet`));
    }
    return row;
  }

  _tableNode(start, end) {
    const doc = this.doc;
    const table = el(doc, "table", "pv-table");
    const body = el(doc, "tbody");
    for (let row = start; row < end; row += 1) {
      const n = row + 1;
      const tr = el(doc, "tr", "pv-ln");
      setAttr(tr, "data-line", n);
      if (n === this.focus) tr.classList.add("pv-focus");
      if (this.matches.has(n)) tr.classList.add("pv-find-line");
      const th = el(doc, "th", "pv-no", String(n));
      setAttr(th, "scope", "row");
      tr.appendChild(th);
      const cells = this.lines[row];
      const shown = Math.min(cells.length, MAX_TABLE_COLS);
      for (let col = 0; col < shown; col += 1) {
        const td = el(doc, "td", "pv-cell");
        setAttr(td, "data-col", col);
        // Fester Innenkasten (CSS .pv-cell-in): Tabellenzellen wachsen sonst mit dem Inhalt (Marken, Schriftwechsel),
        // und jede Zeile ueber CODE_ROW_PX verschiebt das virtuelle Fenster gegen die Scrollleiste.
        const box = el(doc, "div", "pv-cell-in");
        appendExact(doc, box, cells[col]);
        td.appendChild(box);
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    table.appendChild(body);
    return table;
  }

  _onScroll() {
    this._renderWindow(false);
    this._cancel(this.reportTimer);
    this.reportTimer = this._later(() => {
      this.reportTimer = null;
      this.reported.scrollTop = this.scroller.scrollTop;
      callAction(this.actions, "setView", { scrollTop: this.reported.scrollTop });
    }, REPORT_MS);
  }

  _onClick(e) {
    const target = e.target;
    if (!target || typeof target.closest !== "function") return;
    const row = target.closest(".pv-ln");
    if (!row || !this.win.contains(row)) return;
    const n = Number(row.getAttribute("data-line"));
    if (!this._validLine(n)) return;
    if (this.mode === "table") {
      const cell = target.closest(".pv-cell");
      this._setFocus(n, { report: true, scroll: false });
      if (cell) this._showCell(n, Number(cell.getAttribute("data-col")));
      return;
    }
    if (this.rangeMode && this.rangeStart !== null) {
      const a = Math.min(this.rangeStart, n);
      const b = Math.max(this.rangeStart, n);
      this.rangeStart = null;
      this.sel = [a, b];
      this._setFocus(n, { report: true, scroll: false, keepSel: true });
      return;
    }
    if (this.rangeMode) this.rangeStart = n;
    this.sel = [n, n];
    this._setFocus(n, { report: true, scroll: false, keepSel: true });
  }

  _showCell(row, col) {
    const doc = this.doc;
    clear(this.lineInfo);
    const cells = this.lines[row - 1];
    if (!Array.isArray(cells) || !Number.isSafeInteger(col) || col < 0 || col >= cells.length) return;
    const head = el(doc, "div", "pv-info-head");
    head.appendChild(el(doc, "span", "pv-chip", `Zeile ${row} · Spalte ${col + 1}`));
    this.lineInfo.appendChild(head);
    const box = el(doc, "div", "pv-pre");
    appendExact(doc, box, cells[col]);
    this.lineInfo.appendChild(box);
  }

  // ---------------------------------------------------------------- Fokus, Spruenge
  _setFocus(n, { report = true, scroll = true, keepSel = false } = {}) {
    this.focus = n;
    if (!keepSel) this.sel = [n, n];
    if (scroll) this._unfoldAround(n);
    // Zeileninfo zuerst: sie nimmt dem Leser Hoehe weg. Erst danach Sprungziel und Fenster rechnen - sonst verdeckte
    // die nachtraeglich eingeblendete Info nach "Gehe" die letzten Zeilen (Browser-Gegenprobe zu Befund oberflaeche-f4).
    if (this.mode === "text") this._drawLineInfo(n);
    if (scroll) this._scrollRowIntoView(this._rowOfLine(n));
    else this._renderWindow(true);
    this._setEnabled();
    if (report) callAction(this.actions, "setView", { line: n });
  }

  _jumpToLine(n, { report = true } = {}) {
    if (!this._validLine(n)) {
      this._message(`Zeile ${n} gibt es nicht (1–${this.lines.length}).`);
      return;
    }
    this._setFocus(n, { report, scroll: true });
  }

  _gotoFromInput() {
    const n = Number.parseInt(this.gotoInput.value.trim(), 10);
    if (!Number.isSafeInteger(n)) {
      this._message("Zeilennummer eingeben.");
      return;
    }
    this._jumpToLine(n, { report: true });
  }

  _toggleRange() {
    // Bereich = zwei Antipper (erste und letzte Zeile); die bisherige Fokuszeile zaehlt nicht als Anfang.
    this.rangeMode = !this.rangeMode;
    this.rangeStart = null;
    setAttr(this.btnRange, "aria-pressed", this.rangeMode ? "true" : "false");
    this._message(this.rangeMode ? "Bereich: erste und letzte Zeile antippen." : "Bereich beendet.");
  }

  _edgesAt(line) {
    const cache = cacheFor(this.model, this.key);
    if (!cache.edgesByLine) {
      cache.edgesByLine = new Map();
      for (const edge of this.model.calls()) {
        if (edge.from.source !== this.key) continue;
        const list = cache.edgesByLine.get(edge.line);
        if (list) list.push(edge);
        else cache.edgesByLine.set(edge.line, [edge]);
      }
    }
    return cache.edgesByLine.get(line) || [];
  }

  _targetButtons(row, target) {
    const doc = this.doc;
    if (!isRecord(target)) return;
    if (Object.hasOwn(target, "external")) {
      const ph = el(doc, "span", "pv-chip pv-ext");
      ph.appendChild(doc.createTextNode("extern: "));
      appendExact(doc, ph, target.external);
      row.appendChild(ph);
      return;
    }
    if (Object.hasOwn(target, "unresolved")) {
      row.appendChild(el(doc, "span", "pv-chip", unresolvedText(target.unresolved)));
      return;
    }
    const rel = typeof target.op === "string" ? target.op : null;
    if (rel !== null && this.model.has(rel)) {
      const op = this.model.op(rel);
      row.appendChild(button(doc, "", () => callAction(this.actions, "openDetails", rel), {
        cls: "pv-btn pv-btn-link", exact: rel === "" ? `${op.name} (Root)` : op.name, disabled: !hasAction(this.actions, "openDetails"),
      }));
      if (this.model.source(rel) && rel !== this.key) {
        row.appendChild(button(doc, "Code", () => callAction(this.actions, "openSource", rel, null), { disabled: !hasAction(this.actions, "openSource") }));
      }
    }
  }

  _drawLineInfo(n) {
    const doc = this.doc;
    clear(this.lineInfo);
    const head = el(doc, "div", "pv-info-head");
    head.appendChild(el(doc, "span", "pv-chip", this.sel && this.sel[0] !== this.sel[1] ? `Zeilen ${this.sel[0]}–${this.sel[1]}` : `Zeile ${n}`));
    const sym = this.model.symbolAt(this.key, n);
    if (sym) {
      head.appendChild(doc.createTextNode(" in "));
      appendExact(doc, head, sym.symbol, "pv-u pv-mono");
      head.appendChild(el(doc, "span", "pv-dim", ` (Z. ${sym.line}–${sym.end})`));
    }
    this.lineInfo.appendChild(head);
    const refs = this.model.referencesInSource(this.key).filter((r) => r.from.line === n);
    for (const r of refs) {
      const row = el(doc, "div", "pv-btnrow pv-ref");
      row.appendChild(el(doc, "span", "pv-chip", referenceKindText(r.kind)));
      if (typeof r.text === "string") appendExact(doc, row, r.text, "pv-u pv-mono");
      row.appendChild(el(doc, "span", "pv-dim", "→"));
      this._targetButtons(row, r.target);
      row.appendChild(certaintyChip(doc, r.certainty));
      this.lineInfo.appendChild(row);
    }
    for (const edge of this._edgesAt(n)) {
      const row = el(doc, "div", "pv-btnrow pv-edge");
      row.appendChild(el(doc, "span", "pv-chip", edge.type === "run" ? "run()" : "Aufruf"));
      appendExact(doc, row, `${edge.attr}()`, "pv-u pv-mono");
      row.appendChild(el(doc, "span", "pv-dim", "→"));
      const t = edge.target;
      if (isRecord(t) && typeof t.symbol === "string" && typeof t.source === "string") {
        const sym2 = this.model.symbol(t.source, t.symbol);
        const line = sym2 ? sym2.line : null;
        if (t.source === this.key) {
          row.appendChild(button(doc, "", () => this._jumpToLine(line ?? n, { report: true }), { cls: "pv-btn pv-btn-link", exact: t.symbol }));
        } else {
          row.appendChild(button(doc, "", () => callAction(this.actions, "openSource", t.source, line), {
            cls: "pv-btn pv-btn-link", exact: t.symbol, disabled: !hasAction(this.actions, "openSource"),
          }));
        }
      } else if (t) {
        this._targetButtons(row, t);
      } else {
        row.appendChild(el(doc, "span", "pv-chip", "kein Ziel im Paket"));
      }
      if (edge.reason) row.appendChild(el(doc, "span", "pv-dim", edgeReasonText(edge.reason)));
      row.appendChild(certaintyChip(doc, edge.certainty));
      this.lineInfo.appendChild(row);
    }
  }

  // ---------------------------------------------------------------- Suche in der Datei
  _setFind(value, { report = true, jump = true } = {}) {
    this.find = value;
    this.matches = new Map();
    this.matchList = [];
    this.matchAt = -1;
    const query = value;
    if (query && (this.mode === "text" || this.mode === "table")) {
      let rx = null;
      try {
        rx = new RegExp(escapeRegex(query), "giu");
      } catch (error) {
        // Ein einzelnes Surrogat oder Aehnliches ergibt kein gueltiges Muster: dann gibt es schlicht keine Treffer.
        if (!(error instanceof SyntaxError)) throw error;
      }
      if (rx) this._collectMatches(rx);
    }
    this._showCount();
    this._setEnabled();
    if (jump && this.matchList.length) {
      const focusRow = this.focus ?? 0;
      const next = this.matchList.findIndex((m) => m.line >= focusRow);
      this.matchAt = next === -1 ? 0 : next;
      this._showCount();
      this._scrollToMatch();
    } else {
      this._renderWindow(true);
    }
    this._cancel(this.findTimer);
    if (report) {
      this.findTimer = this._later(() => {
        this.findTimer = null;
        this.reported.find = this.find;
        callAction(this.actions, "setView", { find: this.find });
      }, REPORT_MS);
    }
  }

  _collectMatches(rx) {
    const total = this.lines.length;
    for (let i = 0; i < total && this.matchList.length < MAX_MATCHES; i += 1) {
      const line = this.mode === "text" ? this.lines[i] : this.lines[i].join("\t");
      rx.lastIndex = 0;
      if (!rx.test(line)) continue;
      rx.lastIndex = 0;
      const spans = [];
      let m;
      while ((m = rx.exec(line)) !== null && this.matchList.length < MAX_MATCHES) {
        if (m[0] === "") {
          rx.lastIndex += 1;
          continue;
        }
        spans.push([m.index, m.index + m[0].length]);
        this.matchList.push({ line: i + 1, start: m.index });
      }
      if (spans.length) this.matches.set(i + 1, this.mode === "text" ? spans : null);
    }
  }

  _showCount() {
    const n = this.matchList.length;
    if (!this.find) this.findCount.textContent = "";
    else if (!n) this.findCount.textContent = "keine Treffer";
    else {
      const more = n >= MAX_MATCHES ? "+" : "";
      this.findCount.textContent = this.matchAt >= 0 ? `${this.matchAt + 1}/${n}${more}` : `${n}${more} Treffer`;
    }
  }

  _stepMatch(dir) {
    const n = this.matchList.length;
    if (!n) return;
    this.matchAt = this.matchAt < 0 ? (dir > 0 ? 0 : n - 1) : (this.matchAt + dir + n) % n;
    this._showCount();
    this._scrollToMatch();
  }

  _scrollToMatch() {
    const m = this.matchList[this.matchAt];
    if (!m) return;
    this._setFocus(m.line, { report: true, scroll: true });
  }

  // ---------------------------------------------------------------- Kopieren und Notizen
  _copyPath() {
    if (this.key === null) return;
    callAction(this.actions, "copyText", this.model.has(this.key) ? this.model.abs(this.key) : this.key, "path");
  }

  _copyCode() {
    if (this.mode === "text" && this.src && typeof this.src.text === "string") callAction(this.actions, "copyText", this.src.text, "code");
  }

  _copySelection() {
    if (this.mode !== "text" || !this.sel) return;
    callAction(this.actions, "copyText", this.lines.slice(this.sel[0] - 1, this.sel[1]).join("\n"), "selection");
  }

  async _note(kind) {
    let spec = null;
    if (kind === "op") spec = { kind: "op", op: this.key };
    else if (kind === "symbol") {
      const sym = this.focus !== null ? this.model.symbolAt(this.key, this.focus) : null;
      if (!sym) return;
      spec = { kind: "symbol", source: this.key, symbol: sym.symbol };
    } else {
      const sel = this.sel || (this.focus !== null ? [this.focus, this.focus] : null);
      if (!sel) return;
      spec = { kind: "range", source: this.key, startLine: sel[0], endLine: sel[1] };
    }
    let anchor;
    try {
      anchor = await createAnchor(this.model, spec);
    } catch (error) {
      // AnchorError (Bereich, Groesse) und fehlendes WebCrypto sind Nutzerfaelle; alles andere ist ein Fehler im Code.
      if (!error || (error.name !== "AnchorError" && error.name !== "CanonicalError")) throw error;
      if (!this.destroyed) this._message(`Notiz nicht möglich: ${labelOf(ANCHOR_ERROR_TEXT, error.code, "Anker ungültig.")}`);
      return;
    }
    if (this.destroyed) return;
    callAction(this.actions, "addNote", anchor);
    this._message(kind === "op" ? "Notiz-Entwurf zum Op angelegt." : `Notiz-Entwurf für Zeilen ${anchor.startLine}–${anchor.endLine} angelegt.`);
  }

  // ---------------------------------------------------------------- Huelle
  update(view) {
    if (this.destroyed || !isRecord(view)) return;
    const key = typeof view.source === "string" ? view.source : null;
    if (key !== this.key) {
      this._open(view);
      return;
    }
    if (typeof view.find === "string" && view.find !== this.find && view.find !== this.reported.find) {
      this.findInput.value = view.find;
      this._setFind(view.find, { report: false, jump: false });
    }
    const line = Number.isSafeInteger(view.line) ? view.line : null;
    const validLine = line !== null && this._validLine(line);
    // Echo der eigenen Scroll-Meldung: die Lesestelle bleibt. Das Echo darf aber nur das Scrollen unterdruecken, nie
    // einen Sprung: eine Huelle, die nur die Zeile aendert und den gespeicherten Rest mitgibt ({...code, line}), traegt
    // zufaellig die zuletzt gemeldete scrollTop. Eine NEUE Zeile springt daher immer; dieselbe Zeile springt erneut,
    // wenn sie an der verlangten Stelle nicht im Bild waere (kein Echo, z.B. erneutes Oeffnen nach Wegscrollen).
    const echo = Number.isFinite(view.scrollTop) && view.scrollTop === this.reported.scrollTop;
    const at = Number.isFinite(view.scrollTop) ? view.scrollTop : this.scroller.scrollTop;
    const lineIsNew = validLine && line !== this.focus;
    const lineHidden = validLine && !this._rowVisibleAt(this._rowOfLine(line), at);
    if (lineIsNew || (!echo && lineHidden)) {
      this._jumpToLine(line, { report: false });
    } else if (!echo && Number.isFinite(view.scrollTop) && Math.abs(view.scrollTop - this.scroller.scrollTop) > 1) {
      this.scroller.scrollTop = view.scrollTop;
      this._renderWindow(true);
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.scroller.removeEventListener("scroll", this.onScroll);
    this.scroller.removeEventListener("click", this.onClick);
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
  }
}

export function renderCode(container, model, view, actions) {
  const code = new CodeView(container, model, view, actions);
  return { update: (next) => code.update(next), destroy: () => code.destroy() };
}
