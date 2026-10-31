// Jede Geste = ein Handgriff am Handy (Tippen, Halten, Taste, Feld). Die App ruft NUR diese Funktionen auf,
// verify.mjs ebenfalls - so beweist ein gruener Lauf, dass jeder Schritt mit echten Handgriffen loesbar ist.

import { rel, abs } from "./util.js";
import { entryChain } from "./views/codeviews.js";

export class Gestures {
  constructor(tour) {
    this.tour = tour;
    this.cs = tour.cs;
    this.lab = tour.lab;
    this.mods = { ctrl: false, alt: false, shift: false };
  }

  // ------------------------------------------------------------------ Tour-Karte
  workspace() { this.tour.showWorkplace(); }
  seen() { this.tour.seen(); this.cs.emit(); }
  setClipboard(text) { this.cs.copy(text); this.cs.emit(); }
  check() { const r = this.tour.check(); this.cs.emit(); return r; }
  next() { const ok = this.tour.next(); this.cs.emit(); return ok; }
  back() { this.tour.back(); this.cs.emit(); }
  skip() { this.tour.skip(); this.cs.emit(); }
  hint() { this.tour.toggleHint(); this.cs.emit(); }
  setError() { this.lab.setError(); this.tour.feedback = "Fehler nur in BranchLab/error_probe gesetzt. ERRORS aktualisieren."; this.cs.rebuild(); }
  restoreError() { this.lab.restoreError(); this.tour.feedback = "error_probe liest wieder control/gain."; this.cs.rebuild(); }
  copyPrompt() {
    const prompt = this.tour.lesson().prompt || "";
    if (prompt) {
      this.cs.copy(prompt.replace("{ROOT}", abs("")));
      this.tour.feedback = "Codex-Aufgabe kopiert. In Codex einfügen und absenden; die Tour startet keinen Chat im Hintergrund.";
    }
    this.cs.emit();
  }
  openFlowLens(target = null) {
    const cs = this.cs, s = cs.state;
    if (s.record.recording) { s.status = "FlowLens nach der Aufnahme öffnen · zuerst STOP."; return cs.emit(); }
    const focus = cs.net.op(s.focus);
    const owner = s.context === 'comp' ? s.paneOwner : (focus?.family === 'COMP' ? s.focus : focus?.parent);
    const path = target == null ? owner : rel(target);
    if (!path || !cs.net.isComp(path)) { s.status = "FlowLens braucht einen Inhalts-COMP als Ziel."; return cs.emit(); }
    const fl = s.flowlens;
    fl.open = true;
    fl.target = abs(path);
    fl.selected = s.focus;
    cs.emit();
  }

  // ------------------------------------------------------------------ TD-Seite (Netz, Parameter, Timeline)
  play(on = true) { this.tour.playing = on; this.cs.emit(); }
  netSelect(path) { this.cs.networkSelect(path); }
  netEnter(comp) { this.cs.state.paneOwner = comp; this.cs.state.networkSelected = []; this.cs.emit(); }
  netUp() { const p = this.cs.state.paneOwner; this.cs.state.paneOwner = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ""; this.cs.emit(); }

  // BranchLab-Parameter (Lab-Parameter)
  blPar(name, value) {
    if (name === "Softness") value = Math.max(0, Math.min(64, Number(value)));
    if (name === "Intensity") value = Math.max(0, Math.min(1, Number(value)));
    this.lab.blPars[name] = value;
    this.cs.rebuild();
  }
  blPulse(name) {
    if (name === "Fire") this.lab.onParFire();
    if (name === "Reset") this.lab.onParReset();
    this.cs.rebuild();
  }
  // StateLab-Parameter
  slPulse(name) {
    const map = { Prepare: "Prepare", Fire: "Fire", Mutate: "Mutate", Notify: "Notify", Replacesamevalue: "ReplaceSameValue",
      Runtimereset: "RuntimeReset", Storagereset: "StorageReset", Clearchild: "ClearChild", Useexpression: "UseExpression",
      Useconstant: "UseConstant", Reinit: "Reinit", Startup: "StartupExperiment" };
    const sl = this.lab.stateLab;
    this.lab.call("StateLab/StateLabExt", `onPar${name}`, () => sl[map[name]]());
    this.cs.rebuild();
  }
  slPar(name, value) { this.lab.stateLab.pars[name] = value; this.cs.rebuild(); }
  gardenPar(owner, name, value) {
    if (!(name in this.lab.garden.pars[owner])) throw new Error(`Unbekannter Parameter ${owner}.${name}`);
    this.lab.garden.pars[owner][name] = value; this.cs.rebuild();
  }
  gardenPulse(owner, name) { this.lab.garden.pulse(owner, name); this.cs.rebuild(); }
  gardenReinit(owner) { this.lab.garden.reinit(owner); this.cs.rebuild(); }
  // Farbmischer-Parameter
  fmPulse(name) {
    const fm = this.lab.farbmischer;
    if (name === "Weiter") this.lab.call("Farbmischer/FarbmischerExt", "onParWeiter", () => fm.Weiter());
    if (name === "Zuruecksetzen") this.lab.call("Farbmischer/FarbmischerExt", "onParZuruecksetzen", () => fm.Zuruecksetzen());
    this.cs.rebuild();
  }
  fmPar(name, value) { this.lab.farbmischer.pars[name] = value; this.cs.rebuild(); }
  frames(n = 30) { this.lab.step(n); this.cs.rebuild(); }

  // CodeSearch-Parameter (CS-Parameter)
  csPar(name, value) {
    this.cs.cs[name] = value;
    this.cs.rebuild();
  }

  tdUndo() { this.cs.undoTD(); }

  // ------------------------------------------------------------------ CodeSearch-Fenster
  openCodeSearch() { this.cs.state.mainopen = true; this.cs.emit(); }
  tab(mode) { this.cs.state.view = ""; this.cs.SetMode(mode); }
  type(text) { this.cs.typeQuery(text); }
  enter(text = null) {
    const s = this.cs.state;
    if (text !== null) return this.cs.fieldEnter(text);
    if (s.dialog) { const d = s.dialog; s.dialog = null; if (d.confirm) d.confirm(); return this.cs.rebuild(); }
    if (s.selected >= 0) return this.cs.activate();
    return this.cs.fieldEnter(s.mode === "search" ? s.query : s.fieldDraft);
  }
  filter(key) { this.cs.cs.Searchfilter = key; this.cs.state.selected = -1; this.cs.rebuild(); }
  family(key) { this.cs.cs.Opfamily = key; this.cs.cs.Searchfilter = "op"; this.cs.rebuild(); }
  address(key) { this.cs.state.opAddress = key; this.cs.rebuild(); }
  scope(kind) { this.cs.setScope(kind); }
  readOrder() {
    const s = this.cs.state;
    if (s.view === "path") s.view = ""; else { s.view = "path"; if (s.mode !== "search" && s.mode !== "chain") s.mode = "search"; }
    s.selected = -1;
    this.cs.rebuild();
  }
  readOrderMarks() { this.cs.state.readMarks = !this.cs.state.readMarks; this.cs.emit(); }
  help() { this.cs.state.view = this.cs.state.view === "guide" ? "" : "guide"; this.cs.state.selected = -1; this.cs.rebuild(); }
  altHelp(mode) {
    const ui = this.cs.ui;
    const group = (ui.GROUP_OF_MODE || {})[mode];
    this.cs.state.help = { title: (ui.TAB_LABELS || {})[mode] || mode, text: (ui.MODE_HELP || {})[mode] || (ui.GROUP_HELP || {})[group] || "" };
    this.cs.emit();
  }
  look() { this.cs.toggleLook(); }
  lookMenu() {
    const cs = this.cs;
    const looks = Object.entries(cs.ui.CODESEARCH_LOOKS || {});
    if (!looks.length) return this.look();
    const groupOf = (palette) => /contrast|kontrast/i.test(palette[0]) ? 'Hoher Kontrast' : (palette[8] ? 'Hell' : 'Dunkel');
    const groups = ['Dunkel', 'Hell', 'Hoher Kontrast'];
    looks.sort((a, b) => groups.indexOf(groupOf(a[1])) - groups.indexOf(groupOf(b[1])));
    cs.state.menu = { title: "Look wählen · Farben und Lesbarkeit", items: looks.map(([key, palette]) => ({
      label: `${cs.cs.Look === key ? "●" : "○"} ${palette[0]}`, group: groupOf(palette),
      swatches: [palette[1], palette[2], palette[7]],
      run: () => { cs.cs.Look = key; cs.emit(); },
    })) };
    cs.emit();
  }
  extensionMenu(comp, slot) {
    const cs = this.cs;
    cs.state.menu = null;
    const source = cs.net.extensionSources(comp).find((item) => item.slot === Number(slot));
    if (!source) { cs.state.status = "Die Extension ist an diesem COMP nicht mehr vorhanden."; return cs.emit(); }
    const validSource = () => {
      const current = cs.net.extensionSources(comp).find((item) => item.slot === source.slot);
      if (!current?.available || current.path !== source.path) {
        cs.state.dialog = { title: "Extension-Quelle hat sich geändert", lines: ["Öffne das Extension-Menü erneut. Der alte Menüeintrag öffnet keinen anderen DAT."] };
        cs.emit(); return false;
      }
      return true;
    };
    if (!source.available) {
      cs.state.dialog = { title: `${source.name} · Quelle nicht verfügbar`, lines: [abs(comp), source.reason, "Prüfe am Laptop im COMP die Seite Extensions und dort den Object-Ausdruck dieses Slots."] };
      return cs.emit();
    }
    cs.state.menu = { title: `${source.name} · Code öffnen`, description: `Source-DAT: ${abs(source.path)}`, items: [
      { label: "DAT öffnen · Code hier lesen", run: () => {
        if (validSource()) { cs.state.viewer = { path: source.path, line: null }; cs.emit(); }
      } },
      { label: "Externer Editor · am Laptop", run: () => {
        if (!validSource()) return;
        cs.state.dialog = { title: "Externer Editor · TouchDesigner am Laptop", lines: [
          `Source-DAT: ${abs(source.path)}`,
          "Am Laptop öffnet diese Auswahl den Text-Editor, den du in TouchDesigner unter Preferences für DATs eingestellt hast.",
          "Pocket läuft eigenständig im iPhone-Browser und kann diesen Laptop-Editor nicht starten. Mit „DAT öffnen“ liest du hier denselben Übungscode.",
        ] }; cs.emit();
      } },
    ] };
    cs.emit();
  }
  overview(kind) { this.cs.state.overview = this.cs.state.overview === kind ? "" : kind; this.cs.state.selected = -1; this.cs.rebuild(); }
  context(kind) { this.cs.state.context = kind; this.cs.state.selected = -1; this.cs.rebuild(); }
  window(action) { this.cs.state.window = action; this.cs.emit(); }

  // Text im Suchfeld markieren und kopieren (normales Text-Kopieren im Feld)
  copyFieldText() {
    const s = this.cs.state;
    this.cs.copy(s.mode === "search" ? s.query : s.fieldDraft);
    this.cs.emit();
  }

  // Zeilen: Index oder Suchfunktion
  _find(match) {
    const hits = this.cs.state.hits;
    if (typeof match === "number") return match;
    if (typeof match === "function") return hits.findIndex(match);
    return hits.findIndex((h) => h.kind !== "section" && h.kind !== "notice" && JSON.stringify(h).includes(match));
  }
  tapRow(match) {
    const i = this._find(match);
    if (i < 0) throw new Error(`Zeile nicht gefunden: ${match}`);
    this.cs.select(i, { ctrl: this.mods.ctrl });
    if (this.mods.alt && this.cs.state.mode === "errors") this.altClickError();
    this.mods = { ctrl: false, alt: false, shift: false };
    return i;
  }
  doubleTapRow(match) {
    const i = this.tapRow(match);
    this.cs.activate(i);
  }
  rowMenu(match) {
    const i = this._find(match);
    if (i < 0) throw new Error(`Zeile nicht gefunden: ${match}`);
    this.cs.select(i);
    this.cs.state.menu = { title: "ZEILE", items: this.rowMenuItems(this.cs.state.hits[i]) };
    this.cs.emit();
  }
  rowMenuItems(h) {
    const cs = this.cs;
    const items = [];
    if (cs.state.mode === "chain" && h.path) items.push({ label: `FOCUS HIERHER · ${h.ctx || ""}`, run: () => { cs.state.focus = rel(h.path); cs.state.targets = [h.path]; cs.rebuild(); const idx = cs.state.hits.findIndex((x) => x.anchor); cs.state.selected = idx; cs.emit(); } });
    if (h.path) items.push({ label: "VIEWER ÖFFNEN", run: () => { cs.state.viewer = { path: rel(h.path), line: h.line || null }; } });
    if (h.kind === "state" || h.cat === "state") items.push({ label: "URSACHE", run: () => cs.cause() });
    if (h.ctx && cs.net.member(rel(h.path), h.ctx)) {
      items.push({ label: "IMPACT (Strg+I)", run: () => cs.impact() });
      items.push({ label: "ROUTE (Strg+Umschalt+I)", run: () => cs.routeFromSelection() });
    }
    if (h.line) items.push({ label: "IM EDITOR ÖFFNEN", run: () => { cs.state.viewer = { path: rel(h.path), line: h.line }; } });
    for (const [label, value] of cs.copyOptions(h)) items.push({ label: `KOPIEREN · ${label}`, run: () => cs.copy(value) });
    return items;
  }
  menu(label) {
    const m = this.cs.state.menu;
    if (!m) throw new Error("kein Menü offen");
    const item = m.items.find((x) => x.label.startsWith(label) || x.label.includes(label));
    if (!item) throw new Error(`Menüpunkt fehlt: ${label}`);
    this.cs.state.menu = null;
    item.run();
    this.cs.rebuild();
  }
  altClickError() {
    const h = this.cs.selectedHit;
    if (h && h.kind === "error") {
      this.lab.errorProbe.mode = "CONSTANT";
      this.cs.state.status = "error_probe.par.opacity steht jetzt auf CONSTANT";
      this.cs.rebuild();
    }
  }
  modifier(name) { this.mods[name] = !this.mods[name]; this.cs.emit(); }

  // Tastenleiste
  key(name) {
    const cs = this.cs;
    const s = cs.state;
    this.mods = { ctrl: false, alt: false, shift: false };
    if (s.help?.source === 'tab-hover') s.help = null;
    switch (name) {
      case "Esc": return cs.escape();
      case "Enter": return this.enter();
      case "Ctrl+Enter": return cs.ctrlEnter();
      case "Ctrl+I": return cs.impact();
      case "Ctrl+Shift+I": return cs.routeFromSelection();
      case "Ctrl+C": return this._floatFocused() ? this._floatCopy() : cs.ctrlC();
      case "Alt+P": return cs.altP();
      case "Alt+F": return cs.altF();
      case "Ctrl+R": return cs.ctrlR();
      case "F6": return cs.dataCycle();
      case "Alt+D": return cs.dataDetails(!s.display.details);
      case "Ctrl+G": return cs.routeToggleStep();
      case "Left": if (!cs.routeStep(-1)) this._move(-1); return undefined;
      case "Right": if (!cs.routeStep(1)) this._move(1); return undefined;
      case "Up": return this._floatFocused() ? this._floatMove(-1) : this._move(-1);
      case "Down": return this._floatFocused() ? this._floatMove(1) : this._move(1);
      case "Ctrl+Right": return cs.nextTab(1);
      case "Ctrl+Left": return cs.nextTab(-1);
      case "Alt+Left": return cs.definitionBack();
      case "Alt+Right": return cs.definitionForward();
      case "Ctrl+Alt+Left": return cs.historyBack();
      case "Ctrl+Alt+Right": return cs.historyForward();
      case "Ctrl+Plus": return this._floatFocused() ? this._floatZoom(0.1) : cs.zoom(0.1);
      case "Alt+0": return this._floatFocused() ? this._floatZoom(0) : cs.zoom(0);
      case "Alt+Shift+A": return this.recordAnywhere();
      case "Ctrl+P": return cs.quickOpen();
      case "Alt+Shift+K": return cs.OpenAt("trace", { target: s.networkSelected[0] ?? s.focus });
      case "Ctrl+Shift+K": return cs.OpenAt("refs", { target: s.networkSelected[0] ?? s.focus });
      case "Shift+K": return cs.OpenAt("search", { target: s.paneOwner, query: s.query });
      case "Ctrl+Z": return this.tdUndo();
      default: throw new Error(`unbekannte Taste ${name}`);
    }
  }

  _move(delta) {
    const s = this.cs.state;
    let i = s.selected;
    for (let n = 0; n < s.hits.length; n += 1) {
      i += delta;
      if (i < 0 || i >= s.hits.length) return;
      if (s.hits[i].kind !== "section") break;
    }
    this.cs.select(i);
    if (this.cs.cs.Followsearch && s.mode === "search") this.cs.jumpTo(s.hits[i]);
  }

  recordAnywhere() {
    const cs = this.cs;
    if (!cs.state.record.recording) cs.state.record.target = cs.state.record.target || "BranchLab";
    cs.recordToggle();
  }

  // ------------------------------------------------------------------ DATEN-Leiste
  data(format) { this.cs.setDataFormat(format); }
  dataDetails() { this.cs.dataDetails(true); }
  dataBack() { this.cs.dataDetails(false); }
  dataCopy() { this.cs.dataCopy(); }
  dataTakeNetwork() { this.cs.dataTakeNetwork(); }

  // ------------------------------------------------------------------ RECORD-Knoepfe
  record(button) {
    const cs = this.cs;
    const map = { start: () => cs.recordStart(), stop: () => cs.recordStop(), hold: () => cs.recordHold(), mini: () => cs.recordMini(true),
      full: () => cs.recordMini(false), duration: () => cs.recordDuration(), prev: () => cs.recordPrev(), next: () => cs.recordNext(),
      copy: () => cs.copyChain(), why: () => cs.openWhy() };
    map[button]();
  }

  // ------------------------------------------------------------------ Detail-Aktionen (rechte Spalte)
  detail(actionName, arg = null) {
    const cs = this.cs;
    switch (actionName) {
      case "lever": return cs.whyLever();
      case "retrigger": return cs.whyRetrigger();
      case "question": return cs.whyQuestion();
      case "ampel": { const h = cs.selectedHit; cs.state.viewer = { path: rel(h.path), line: h.guard_line }; return cs.emit(); }
      case "impact": return cs.impact();
      case "route": return cs.routeFromSelection();
      case "copy": return cs.ctrlC();
      case "editor": { const h = cs.selectedHit; cs.state.viewer = { path: rel(h.path), line: h.line }; return cs.emit(); }
      case "block": {
        const set = cs.state.collapsedBlocks;
        if (set.has(arg)) set.delete(arg); else set.add(arg);
        return cs.emit();
      }
      case "chain": {
        const h = cs.selectedHit;
        const entry = (cs.state.meta.entries || []).find((e) => e.method === h.ctx && abs(e.source) === h.path);
        return cs.chainReaderStep(arg, entry ? entryChain(cs, entry) : []);
      }
      case "expr": {
        const h = cs.selectedHit;
        const e = cs.net.edgesTo(rel(h.path)).find((x) => x.kind === "expr" && x.par === arg);
        cs.state.dialog = { title: `EXPR ← Par ${arg}`, lines: [`${rel(h.path)}.par.${arg}`, `Ausdruck: ${e ? e.text : "?"}`, "Der Wert wird bei jedem Cook neu berechnet; ändert sich control, ändert sich der Par."] };
        return cs.emit();
      }
      case "reveal": cs.state.revealed = true; return cs.emit();
      default: throw new Error(`unbekannte Detail-Aktion ${actionName}`);
    }
  }

  // Code-Ansicht im Detail: Strg+Klick = Definition, Strg+Alt+Klick = Definition als Lesekopie
  codeClick(name) {
    const cs = this.cs;
    const { ctrl, alt } = this.mods;
    this.mods = { ctrl: false, alt: false, shift: false };
    if (ctrl && alt) return cs.floatDefinition(rel(cs.state.codeView.path), name);
    if (ctrl) return cs.definitionJump(name);
    cs.state.status = `${name}: Strg+Klick springt zur Definition`;
    return cs.emit();
  }

  // Code-Editor (BEARBEITEN)
  editOpen() {
    const h = this.cs.selectedHit;
    const path = rel(h.path);
    const text = path === "BranchLab/experiment_script" ? this.lab.script : (this.cs.net.op(path) || {}).text || "";
    this.cs.state.editor = { path, text, line: h.line, error: "" };
    this.cs.emit();
  }
  editSet(text) { this.cs.state.editor.text = text; this.cs.emit(); }
  editApply() {
    const ed = this.cs.state.editor;
    const error = pythonSyntaxError(ed.text);
    if (error) {
      ed.error = error;
      this.cs.state.status = `ÜBERNEHMEN abgelehnt: ${error}`;
      return this.cs.emit();
    }
    if (ed.path === "BranchLab/experiment_script") this.lab.script = ed.text;
    this.cs.state.editor = null;
    this.cs.state.status = "Code übernommen";
    this.cs.rebuild();
  }
  editCancel() { this.cs.state.editor = null; this.cs.emit(); }

  // ------------------------------------------------------------------ TABLE
  tableSort(col) { this.cs.tableSort(col); }
  tableTap(row, col) { this.cs.tableSelect(row, col); }
  tableEdit(row, col, value) { this.cs.tableEdit(row, col, value); }
  tableMenu(row, col) { this.cs.tableMenu(row, col); }

  // ------------------------------------------------------------------ Schnellsuche
  quickType(text) { this.cs.quickSearch(text); }
  quickEnter() { this.cs.quickSearch(this.cs.state.quick.query); }
  quickFilter(f) { this.cs.quickFilter(f); }
  quickTap(match) {
    const q = this.cs.state.quick;
    const i = typeof match === "number" ? match
      : q.hits.findIndex((h) => h.kind !== "section" && (typeof match === "function" ? match(h) : JSON.stringify(h).includes(match)));
    if (i < 0) throw new Error(`Quick-Zeile fehlt: ${match}`);
    this.cs.quickSelect(i);
    return i;
  }
  quickDoubleTap(match) { const i = this.quickTap(match); this.cs.quickJump(i); }
  quickMenuMain(match) { const i = this.quickTap(match); this.cs.quickToMain(i); }
  quickEsc() { this.cs.state.quick.open = false; this.cs.emit(); }

  // ------------------------------------------------------------------ Lesekopien
  floatList() { this.cs.floatList(); this.focusFloat(this.cs.state.floats[this.cs.state.floats.length - 1].id); }
  focusFloat(id) { this.cs.state.floatFocus = id; this.cs.emit(); }
  _floatFocused() { return this.cs.state.floats.find((f) => f.id === this.cs.state.floatFocus) || null; }
  _floatMove(delta) {
    const f = this._floatFocused();
    if (!f || !f.rows) return;
    let i = f.selected;
    do { i += delta; } while (f.rows[i] && f.rows[i].kind === "section");
    if (f.rows[i]) f.selected = i;
    this.cs.emit();
  }
  floatTapRow(match) {
    const f = this._floatFocused();
    const i = f.rows.findIndex((h) => h.kind !== "section" && JSON.stringify(h).includes(match));
    if (i >= 0) f.selected = i;
    this.cs.emit();
  }
  _floatCopy() {
    const f = this._floatFocused();
    const h = f && f.rows ? f.rows[f.selected] : null;
    if (h) { this.cs.copy(h.ctx ? `${h.ctx}` : h.text); this.cs.clipboardOrigin = "float"; }
    this.cs.emit();
  }
  _floatZoom(delta) {
    const f = this._floatFocused();
    if (!f) return;
    f.zoom = delta === 0 ? 1 : Math.round((f.zoom + delta) * 10) / 10;
    this.cs.emit();
  }
  floatEsc() {
    const f = this._floatFocused();
    if (f) this.cs.floatClose(f.id);
    this.cs.state.floatFocus = null;
    this.cs.emit();
  }

  // ------------------------------------------------------------------ FlowLens
  flowlens(action, arg = null) {
    const fl = this.cs.state.flowlens;
    if (action === "story") fl.story = !fl.story;
    if (action === "colors") fl.colors = !fl.colors;
    if (action === "hidden") fl.hidden = !fl.hidden;
    if (action === "select") { fl.selected = arg; fl.selectionSerial = (fl.selectionSerial || 0) + 1; }
    if (action === "close") fl.open = false;
    if (action === "codesearch" && fl.selected) {
      this.cs.OpenAt("chain", { target: fl.selected });
    }
    this.cs.emit();
  }
}

// Kleine Syntaxpruefung fuer den Editor: Doppelpunkt nach def/if/…, Klammern ausgeglichen
export function pythonSyntaxError(text) {
  const lines = String(text).split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const code = lines[i].replace(/#.*$/, "").trimEnd();
    if (/^\s*(def|class|if|elif|else|for|while|try|except|finally|with)\b/.test(code) && !code.endsWith(":")) {
      return `SyntaxError: expected ':' (Zeile ${i + 1})`;
    }
  }
  let depth = 0;
  for (const ch of String(text)) {
    if ("([{".includes(ch)) depth += 1;
    if (")]}".includes(ch)) depth -= 1;
    if (depth < 0) return "SyntaxError: unmatched ')'";
  }
  return depth ? "SyntaxError: '(' was never closed" : "";
}
