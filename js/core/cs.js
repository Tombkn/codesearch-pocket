import {newFlowState,flowAnchor,presentFlow,pinFlow,refreshFlow,flowStoryText} from './flow-session.js';
import {selectableHit,selectionIdentity,selectedHits,copySelection} from './multi-selection.js';
import {newSearchSession,openSearch,searchSession,scopeSession,transferSearch} from './search-sessions.js';
import {buildCompCode} from './views/comp-context.js';
// CodeSearch-Fenster als Zustandsmaschine: Tabs, Feld, Liste, Detail, Tasten, Befehle, RECORD, TABLE,
// Schnellsuche, DATEN-Leiste, Lesekopien. Kein DOM - die App zeichnet, verify.mjs bedient es direkt.

import { abs, rel, baseName, parentOf, pyStr, fmtNum, uid, clone } from "./util.js";
import { buildSearch, buildReadOrder } from "./views/search.js";
import { buildUses, buildUsedBy, buildSymbolRefs, buildFlow, flowStory, opForm, cookText } from "./views/netviews.js";
import {
  buildStructure, buildLandkarte, buildImpact, buildTriggers, buildCallPath, buildRoute, buildOverview, buildSystem,
  reviewTable, landkarteText, symbolDetail, addressOfSymbol, entryChain, codeTarget, entriesFor, routeFor,
} from "./views/codeviews.js";
import {
  buildRecord, chainsOf, chainText, whyCase, buildWhy, whyPacket, auditFindings, buildAudit, auditQuestion,
  buildErrors, errorReport, buildGuide, buildInvestigation, stateAtlas,
} from "./views/miscviews.js";
import { headers, groupsOf, countRows } from "./views/common.js";
import { collectEvidence, parseProtocol, answerRequest, checkExplanation, previewChange, makeSample, revisionFor } from "./investigation.js";
import { Lab } from "./lab.js";
import { rememberPacket, openAnalysis, exportAnalysis, importAnalysis, refreshAnalysis, analysisSnapshot, analysisTemplate, copyAnalysisResult, runProtocol } from "./analysis-workbench.js";
import { SpecWorkbench } from './spec-workbench.js';
import {captureCode, openCopy, copyMenu, sizeCopy} from './float-copies.js';

export const TAB_ORDER = ["search", "trace", "refs", "impact", "errors", "chain", "table", "map", "entries", "tour", "record", "check"];
const CODE_MODES = new Set(["map", "entries", "tour", "record", "check"]);
export const CONTEXT_CONTENT_MODES = new Set(['search', 'errors', 'map', 'entries', 'check']);
export const CONTEXT_OP_MODES = new Set(['trace', 'refs', 'chain']);
export const CONTEXT_MODES = new Set([...CONTEXT_CONTENT_MODES, ...CONTEXT_OP_MODES]);
const DATA_FORMATS = ["name", "relative", "full", "op_relative", "op_full"];
export const DATA_LABELS = { name: "NAME", relative: "RELATIV", full: "FULL PATH", op_relative: "op(RELATIV)", op_full: "op(FULL)" };

export const CS_DEFAULTS = {
  Scope: "comp", Scopecomp: "", Searchfilter: "all", Opfamily: "all", Includeui: false, Includesys: false, Includetables: true,
  Regex: false, Casesensitive: false, Maxresults: 300, Maxindexage: 120, Followsearch: true, Followrefs: false,
  Followselection: true, Recordseconds: 15, Recordframenoise: false, Analysistarget: "", Mapfolder: "codemaps",
  Recordstate: false, Showcallgraph: false, Look: "classic",
};

export class CodeSearch {
  constructor({ net, lab, ui, storage = null }) {
    this.spec = new SpecWorkbench(this, storage);
    this.net = net;
    this.lab = lab;
    this.ui = ui;
    this.cs = { ...CS_DEFAULTS };
    this.parDefs = Object.fromEntries((ui.CS_PARS || []).map((p) => [p.name, p]));
    this.clipboard = "";
    this.clipboardSerial = 0;
    this.clipboardOrigin = "";
    this.state = this._freshState();
    this.lab.tracer = this._makeTracer();
    this.listeners = new Set();
    this.rebuild();
  }

  _freshState() {
    const quick=newSearchSession(2);
    return {
      mainopen: true, mode: "search", view: "", query: "", targets: [abs("BranchLab")], focus: "BranchLab", paneOwner: "BranchLab",
      networkSelected: [], hits: [], selected: -1, multi: new Set(), overview: "", impact: "", impactSymbol: null,
      tourEntry: "", tourDat: "", tourClosed: new Set(), symbol: "",
      route: { anchor: "", dat: "", name: "", hop: 0, mode: "ganz", thread: "" },
      record: { recording: false, records: [], chainIndex: 0, liveHold: null, liveMini: false, liveContinuous: false, target: "BranchLab" },
      why: { cases: [], index: -1, compare: null },
      table: { path: "BranchLab/ColorEngine/palette", query: "", sort: [-1, false], sel: null, dups: -1 },
      quick, searchWindows:[quick], flow:newFlowState(), secondaryPane:{open:false,owner:'',target:null},
      display: { format: "name", base: abs("BranchLab"), details: false, prevFormat: "name" },
      learning: false, collapsedBlocks: new Set(), savedMaps: [], changeFeed: [], expandedStates: new Set(),
      codeView: { path: "", focus: "", definition: false, back: [], forward: [] }, chainReader: { index: -1, reader: false },
      floats: [], history: [], future: [], status: "", lastSnapshot: "", opAddress: "all", help: null, dialog: null, menu: null,
      inv: { cases: [], visuals: [], request: null, comparison: null, explanation: null, preview: null, repro: null, sample: "", watching: false, watchTarget: "", watchHistory: [], watchView: false, error: "" },
      flowlens: { open: false, target: "", story: true, colors: false, hidden: true, selected: "" },
      zoom: 1, look: "classic", window: "normal", editor: null, viewer: null, intent: "", context: "selection", fieldDraft: "",
    };
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(); }

  // ------------------------------------------------------------------ RECORD-Haken in der Lab-Simulation
  _makeTracer() {
    const cs = this;
    return {
      get wantsState() { return cs.cs.Recordstate; },
      enter(dat, name, depth) {
        const rec = cs.state.record;
        const capture = cs._captureChain;
        const inScope = cs.net.isInside(dat, rec.target) || cs.net.isInside(cs.net.datComp.get(dat) || "", rec.target);
        const frameNoise = /onFrameStart|^Tick$|_zwischenfarbe|_anwenden/.test(name) && !cs.cs.Recordframenoise;
        if (!(rec.recording && inScope && !frameNoise) && !capture) return null;
        const member = cs.net.member(dat, name);
        const entry = { t: performanceNow(), frame: cs.lab.frame, name, dat, line: member ? member.line : null, depth, dur: 0, state: "" };
        if (rec.recording && inScope && !frameNoise) {
          entry.recording_id = rec.provenance?.recording_id || '';
          entry.symbol = `${abs(dat)}:${cs.net.extClass(dat)?.cls.name ? cs.net.extClass(dat).cls.name + '.' : ''}${name}`;
          const sourceText = cs.net.lines(dat).join('\n');
          const cached = rec.sourceHashes[dat];
          if (!cached || cached.text !== sourceText) rec.sourceHashes[dat] = {text: sourceText, hash: revisionFor({[abs(dat)]: sourceText})};
          entry.recorded_source_hash = rec.sourceHashes[dat].hash;
          rec.records.push(entry);
        }
        if (capture) capture.push(entry);
        return entry;
      },
      leave(entry, stateChange) {
        entry.dur = Math.max(0.01, performanceNow() - entry.t);
        entry.state = stateChange || "";
      },
    };
  }

  // ------------------------------------------------------------------ Oeffnen, Modus, Ziel
  OpenAt(mode, { target = null, query = "", symbol = "", scope = null } = {}) {
    const t = target != null ? rel(target) : this.state.focus;
    this.state.mainopen = true;
    this.state.focus = t;
    this.state.targets = [abs(t)];
    this.state.paneOwner = this.net.isComp(t) ? t : (this.net.op(t)?.parent || "");
    this.state.query = query || "";
    this.state.symbol = symbol || "";
    this.state.view = "";
    this.state.overview = "";
    this.state.selected = -1;
    this.state.multi = new Set();
    if (scope != null) {
      this.cs.Scope = "comp";
      this.cs.Scopecomp = abs(rel(scope));
    }
    if (mode === "table") this.state.table.path = t;
    if (mode === "record") this.state.record.target = this.net.isComp(t) ? t : this.net.compOf(t);
    if (mode === "tour" && symbol) {
      const comp = codeTarget(this, t);
      const ext = this.net.extClass(comp);
      if (ext) {
        this.state.tourDat = ext.dat;
        this.state.tourEntry = symbol;
      }
    }
    this.state.mode = mode;
    if(mode==='chain' && target!==null)this.state.context='selection';
    this._remember();
    if(mode==='chain' && target!==null && this.state.flow.pinned)return refreshFlow(this,t);
    this.rebuild();
  }

  // DARIN: direkte Kinder eines COMPs als Trefferliste - ueber die Suche ohne Suchtext (Bereich = dieser COMP).
  showCompContents(path, family = 'all') {
    const target = rel(path);
    if (!this.net.isComp(target)) { this.state.status = 'DARIN: kein COMP unter ' + abs(path); return this.emit(); }
    this.cs.Searchfilter = 'op';
    this.cs.Opfamily = family === 'all' ? 'all' : family.toLowerCase();
    this.cs.Scope = 'comp';
    this.cs.Scopecomp = abs(target);
    this.state.opAddress = 'all';
    this.OpenAt('search', { target, query: '' });
    this.state.status = `DARIN · ${abs(target)} · ${family === 'all' ? 'alle Operatoren' : family}`;
    this.rebuild();
  }

  SetMode(mode) {
    if (!TAB_ORDER.includes(mode)) return;
    if (mode === "table" && !this._isTable(this.state.focus) && !this._isTable(this.state.table.path)) {
      this.state.status = "TABLE braucht einen Table DAT (markiert / → TABLE / Pfad im Feld)";
    }
    if (mode === "table" && this._isTable(this.state.focus)) this.state.table.path = this.state.focus;
    this.state.mode = mode;
    this.state.view = mode === this.state.mode && this.state.view === "path" ? "" : "";
    this.state.overview = "";
    this.state.selected = -1;
    this.state.multi = new Set();
    if (mode === "tour" && !this.state.tourEntry) this.state.tourDat = "";
    this._remember();
    this.rebuild();
  }

  _isTable(path) {
    const o = this.net.op(path);
    return Boolean(o && o.type === "tableDAT");
  }

  _remember() {
    const entry = { mode: this.state.mode, focus: this.state.focus, view: this.state.view };
    const last = this.state.history[this.state.history.length - 1];
    if (!last || last.mode !== entry.mode || last.focus !== entry.focus || last.view !== entry.view) {
      this.state.history.push(entry);
      this.state.future = [];
      if (this.state.history.length > 50) this.state.history.shift();
    }
  }

  historyBack() {
    if (this.state.history.length < 2) return;
    this.state.future.push(this.state.history.pop());
    const prev = this.state.history[this.state.history.length - 1];
    this._restore(prev);
  }

  historyForward() {
    const next = this.state.future.pop();
    if (!next) return;
    this.state.history.push(next);
    this._restore(next);
  }

  _restore(entry) {
    this.state.mode = entry.mode;
    this.state.focus = entry.focus;
    this.state.targets = [abs(entry.focus)];
    this.state.view = entry.view;
    this.state.selected = -1;
    this.rebuild();
  }

  scopeRoot() {
    if (this.contextActive() && CONTEXT_CONTENT_MODES.has(this.state.mode)) return this.state.paneOwner;
    const scope = this.cs.Scope;
    if (scope === "project") return "";
    if (scope === "comp") return rel(this.cs.Scopecomp || abs(this.state.paneOwner));
    return this.state.paneOwner;
  }

  setScope(kind) {
    this.cs.Scope = kind;
    if (kind === "comp" && !this.cs.Scopecomp) this.cs.Scopecomp = abs(this.state.paneOwner);
    this.rebuild();
  }

  codeTargetPath() {
    const pin = this.cs.Analysistarget ? rel(this.cs.Analysistarget) : "";
    return pin || codeTarget(this, this.state.focus);
  }

  contextActive() {
    return this.state.context === 'comp' && CONTEXT_MODES.has(this.state.mode)
      && !this.state.overview && !['states', 'untersuchung', 'request', 'compare', 'explanation', 'preview', 'visual', 'analysis', 'spec', 'guide', 'path'].includes(this.state.view);
  }

  contextDescription() {
    if(this.state.mode==='chain' && this.state.flow.pinned)return `FLOW fixiert · ${abs(this.state.flow.anchor)}`;
    if (!this.contextActive()) return 'AUSWAHL · ausgewählter Operator';
    return `DIESE COMP · ${abs(this.state.paneOwner)} · ${CONTEXT_OP_MODES.has(this.state.mode) ? 'COMP selbst' : 'Inhalt inkl. Unter-COMPs'}`;
  }

  // ------------------------------------------------------------------ Ansicht bauen
  rebuild() {
    const s = this.state;
    const selectedKey=selectionIdentity(s.hits[s.selected]),multiKeys=new Set([...s.multi].map(index=>selectionIdentity(s.hits[index])).filter(Boolean));
    let result = { rows: [] };
    try {
      result = this._build();
    } catch (error) {
      result = { rows: [{ kind: "notice", path: "", text: `Ansicht nicht verfügbar: ${error.message}`, text_full: "", line: null, par: null, ctx: "", detail: "", conf: "" }] };
      if (typeof console !== "undefined") console.error(error);
    }
    s.hits = result.rows;
    s.meta = result;
    s.multi=new Set(s.hits.flatMap((hit,index)=>multiKeys.has(selectionIdentity(hit))?[index]:[]));
    if(selectedKey)s.selected=s.hits.findIndex(hit=>selectionIdentity(hit)===selectedKey);
    if (s.selected >= s.hits.length) s.selected = -1;
    this.emit();
  }

  _build() {
    const s = this.state;
    const t = this.contextActive() && CONTEXT_OP_MODES.has(s.mode) ? s.paneOwner : s.focus;
    if (s.overview) return buildOverview(this, s.overview);
    if (["states", "untersuchung", "request", "compare", "explanation", "preview", "visual", "analysis"].includes(s.view)) return buildInvestigation(this);
    if (s.view === "guide") return buildGuide(this);
    if (s.view === "path") return buildReadOrder(this);
    if(s.mode==='chain' && s.flow.pinned)return presentFlow(this);
    if (this.contextActive() && !this.net.isComp(s.paneOwner)) return {rows:[emptyRow('Der geöffnete Netzwerk-COMP ist nicht mehr vorhanden.')]};
    switch (s.mode) {
      case "search": return buildSearch(this);
      case "trace": return buildUses(this, t);
      case "refs": return s.view === "symbolrefs" && !this.contextActive() ? buildSymbolRefs(this, s.symbolRefs.dat, s.symbolRefs.name) : buildUsedBy(this, t);
      case "chain": return presentFlow(this);
      case "map":
        if(this.contextActive()) return buildCompCode(this,s.paneOwner);
        if (s.view === "landkarte") return buildLandkarte(this, this.codeTargetPath());
        if (s.view === "system") return buildSystem(this, this.codeTargetPath());
        return buildStructure(this, this.codeTargetPath());
      case "impact": {
        if (!s.impactSymbol) return { rows: [{ ...emptyRow("Strg+I auf einer Zeile mit Methode oder Attribut") }] };
        return buildImpact(this, s.impactSymbol.dat, s.impactSymbol.name);
      }
      case "entries": return buildTriggers(this, this.codeTargetPath());
      case "tour":
        if (s.view === "route" && s.route.dat) return buildRoute(this, s.route.dat, s.route.name);
        return buildCallPath(this, s.tourDat, s.tourEntry);
      case "record":
        if (s.view === "why") return buildWhy(this);
        return buildRecord(this);
      case "check": return this.contextActive() ? buildCompCode(this,s.paneOwner,true) : buildAudit(this, this.codeTargetPath());
      case "errors": return buildErrors(this);
      case "table": return { rows: [], table: this.tableView() };
      default: return { rows: [] };
    }
  }

  get selectedHit() {
    const h = this.state.hits[this.state.selected];
    return h && h.kind !== "section" ? h : null;
  }

  // ------------------------------------------------------------------ Liste: waehlen, Enter, Strg+Enter
  select(index, { ctrl = false } = {}) {
    const s = this.state;
    const h = s.hits[index];
    if (!h) return;
    if (h.kind === "section") {
      s.selected = index;
      this.emit();
      return;
    }
    if (ctrl) {
      if (s.multi.has(index)) s.multi.delete(index); else s.multi.add(index);
      if(!selectableHit(h))s.multi.delete(index);
      if(!s.multi.has(index)){
        s.selected=[...s.multi].at(-1) ?? -1;const remaining=s.hits[s.selected];
        if(remaining?.line&&remaining.path)this._showCode(rel(remaining.path),remaining.line,remaining.ctx || '');
        this.emit();return;
      }
    } else {
      s.multi = new Set(selectableHit(h)?[index]:[]);
    }
    // LANDKARTE: ein Klick auf einen State klappt seine Stellen auf (zweiter Klick zu)
    if (s.mode === "map" && s.view === "landkarte" && h.cat === "state" && h.kind === "symbol" && !ctrl) {
      const key = `${rel(h.path)}:${h.ctx}`;
      const already = s.selected === index;
      if (s.expandedStates.has(key) && already) s.expandedStates.delete(key); else s.expandedStates.add(key);
      this.rebuild();
      s.selected = s.hits.findIndex((x) => x.kind === "symbol" && x.ctx === h.ctx && x.cat === "state");
      this.emit();
      return;
    }
    s.selected = index;
    s.chainReader = { index: -1, reader: false };
    // Code-Ansicht folgt der Zeile
    if (h.line && h.path) this._showCode(rel(h.path), h.line, h.ctx || "");
    else if (h.kind === "entry") this._showCode(rel(h.entry_dat), h.line, h.ctx);
    this.emit();
  }

  _showCode(path, line, name) {
    const cv = this.state.codeView;
    cv.path = abs(path);
    cv.focus = name || String(line || "");
    cv.line = line;
    cv.definition = false;
  }

  // Enter: springen (Netz) oder Knopf ausloesen / Zweig klappen
  activate(index = this.state.selected) {
    const s = this.state;
    const h = s.hits[index];
    if (!h) return;
    s.selected = index;
    if (h.kind === "button") return this.runAction(h.action_key, h);
    if (h.evidence?.length) {
      const site = h.evidence.find((e) => e.source && e.line);
      const stored = h.captured_sources?.find((entry) => entry.source === site?.source);
      if (stored && stored.hash !== revisionFor({[stored.source]: this.net.lines(rel(stored.source)).join('\n')})) {
        s.dialog = {title: 'GESPEICHERTER BELEG · QUELLE INZWISCHEN GEÄNDERT', lines: [stored.source, `Gespeicherter Ausschnitt ab Zeile ${stored.excerpt.start_line}:`, stored.excerpt.text, 'Enter: heutige Quelle bewusst öffnen, ohne die alte Zeilennummer zu übernehmen. Esc: zurück.'], confirm: () => { this._showCode(rel(stored.source), 1, ''); this.jumpTo({path: stored.source}); }};
        return this.emit();
      }
      if (site && this.net.op(rel(site.source))) { this._showCode(rel(site.source), site.line, site.method || ""); this.jumpTo({ path: site.source, line: site.line }); }
      return this.emit();
    }
    if (h.kind === "tourbranch") {
      if (s.tourClosed.has(h.branch_id)) s.tourClosed.delete(h.branch_id); else s.tourClosed.add(h.branch_id);
      return this.rebuild();
    }
    if (h.kind === "routearg") {
      const param = h.param || (h.params || [])[0] || "";
      s.route.thread = param;
      return this.rebuild();
    }
    if (h.kind === "routehop") {
      s.route.hop = h.hop;
      return this.rebuild();
    }
    if (h.kind === "whyhistory") {
      s.why.index = h.case_index;
      s.why.compare = null;
      return this.rebuild();
    }
    if (h.kind === "mapfile" && h.map_index !== undefined) return this._pickMap(h.map_index);
    if (h.kind === "guide") {
      if (h.guide_mode) { s.view = ""; return this.SetMode(h.guide_mode); }
      if (h.guide_command) return this.command(`>${h.guide_command}`);
      return;
    }
    if (h.kind === "record" && h.chain_index !== undefined) {
      s.record.chainIndex = h.chain_index;
      return this.rebuild();
    }
    if (s.mode === "search" && !s.view) {
      // Enter in SEARCH springt zur Fundstelle und schliesst CodeSearch
      this.jumpTo(h);
      s.mainopen = false;
      s.status = "Enter: zur Fundstelle gesprungen, CodeSearch geschlossen (Arbeitsplatz oder Shift+K öffnet wieder)";
      return this.emit();
    }
    this.jumpTo(h);
    this.emit();
  }

  flowPin(on) {return pinFlow(this,on);}
  flowRefresh(anchor=null) {return refreshFlow(this,anchor);}
  flowTarget() {return flowAnchor(this);}
  setCodeFull(enabled=!this.state.codeFull) {
    this.state.codeFull=Boolean(enabled);this.emit();
  }
  setCodeZoom(multiplier,notify=true) {
    if(!Number.isFinite(multiplier))throw new Error('Code-Schriftgröße muss eine endliche Zahl sein.');
    this.state.codeZoom=Math.max(.25,Math.min(2.5,Math.round(multiplier*20)/20));
    if(notify)this.emit();
  }
  flowSetTarget(path) {
    path=rel(path);if(!this.net.op(path))return;
    Object.assign(this.state,{focus:path,targets:[abs(path)],context:'selection',selected:-1});this._remember();
    if(this.state.flow.pinned)refreshFlow(this,path);
    else this.rebuild();
    // Der neue Bezugspunkt muss auch als Auswahl die folgenden Aktionen bestimmen.
    const anchor=this.state.hits.findIndex(hit=>hit.anchor && rel(hit.path)===path);
    if(anchor>=0)this.select(anchor);
  }
  flowFilter(name,value) {
    const allowed={direction:['both','up','down'],family:['all','top','chop','sop','dat','comp','mat','pop'],links:['all','wire','refs'],depth:[1,2,4,8,16,64]};
    if(name==='depth')value=Number(value);
    if(!allowed[name]?.includes(value))return;
    this.state.flow.filters[name]=value;this.rebuild();
  }
  openNetworkPane(path) {
    path=rel(path);const target=this.net.op(path);
    if(!target){this.state.status='Operator nicht mehr vorhanden; keine andere Pane geöffnet.';return this.emit();}
    Object.assign(this.state.secondaryPane,{open:true,owner:target.parent || '',target:path});
    this.state.networkViewRequested=true;this.emit();
  }
  secondaryNetwork(action,path=null) {
    const pane=this.state.secondaryPane;
    if(action==='close')pane.open=false;
    else if(action==='up'){pane.owner=this.net.op(pane.owner)?.parent || '';pane.target=null;}
    else if(action==='enter' && this.net.isComp(rel(path))){pane.owner=rel(path);pane.target=null;}
    else if(action==='select' && this.net.op(rel(path)))pane.target=rel(path);
    else if(action==='zoom')pane.zoom=Math.min(4,Math.max(.4,(pane.zoom || 1)*Number(path)));
    this.emit();
  }

  // Zur Fundstelle im TD-Netz: Pane auf den Parent, Op markieren (ohne den FOCUS zu aendern)
  jumpTo(h) {
    const path = rel(h.path);
    if (!path && path !== "") return;
    const o = this.net.op(path);
    if (!o) return;
    this.state.paneOwner = o.parent || "";
    this.state.networkSelected = [path];
    if (h.line && this.net.code[path]) this.state.viewer = { path, line: h.line };
  }

  ctrlEnter(index = this.state.selected) {
    const s = this.state;
    const h = s.hits[index];
    if (!h) return;
    if (["chain", "trace", "refs"].includes(s.mode) && h.path) {
      const t = rel(h.path);
      if (this.net.op(t)) {
        if(s.mode==='chain')return this.flowSetTarget(t);
        s.focus = t;
        s.targets = [abs(t)];
        s.selected = -1;
        this._remember();
        return this.rebuild();
      }
    }
    if (s.mode === "entries" && h.kind === "entry") {
      s.tourDat = rel(h.entry_dat);
      s.tourEntry = h.ctx;
      s.tourClosed = new Set();
      s.mode = "tour";
      s.view = "";
      this._remember();
      return this.rebuild();
    }
    if (s.mode === "tour" && h.ctx && h.path) {
      s.tourDat = rel(h.path);
      s.tourEntry = h.ctx;
      return this.rebuild();
    }
    if (s.mode === "impact" && h.ctx) return this.openRoute(rel(h.path), h.ctx);
  }

  // Strg+I: IMPACT des markierten Symbols
  impact() {
    const h = this.selectedHit;
    if (!h || !h.ctx || !h.path) { this.state.status = "IMPACT braucht eine Zeile mit Methode oder Attribut (Strg+I)"; return this.emit(); }
    const dat = rel(h.path);
    this.state.impactSymbol = { dat, name: h.ctx };
    this.state.impact = `${abs(dat)}:${h.ctx}`;
    this.state.mode = "impact";
    this.state.view = "";
    this.state.selected = -1;
    this._remember();
    this.rebuild();
  }

  // Strg+Umschalt+I: ROUTE der markierten Methode
  routeFromSelection() {
    const h = this.selectedHit;
    if (!h || !h.ctx || !h.path || !this.net.member(rel(h.path), h.ctx)) {
      this.state.status = "ROUTE braucht eine markierte Methode (Strg+Umschalt+I)";
      return this.emit();
    }
    this.openRoute(rel(h.path), h.ctx);
  }

  openRoute(dat, name) {
    const s = this.state;
    s.route = { anchor: `${abs(dat)}:${name}`, dat, name, hop: 0, mode: "ganz", thread: "" };
    const route = routeFor(this, dat, name);
    s.route.hop = route.hops.length - 1;
    s.mode = "tour";
    s.view = "route";
    s.selected = -1;
    this._remember();
    this.rebuild();
  }

  routeStep(delta) {
    const s = this.state;
    if (s.view !== "route") return false;
    const route = routeFor(this, s.route.dat, s.route.name);
    s.route.hop = Math.max(0, Math.min(route.hops.length - 1, s.route.hop + delta));
    this.rebuild();
    return true;
  }

  routeToggleStep() {
    const s = this.state;
    if (s.view !== "route") return;
    s.route.mode = s.route.mode === "schritt" ? "ganz" : "schritt";
    this.rebuild();
  }

  // ------------------------------------------------------------------ Esc
  escape() {
    const s = this.state;
    if (s.dialog) { const d = s.dialog; d.cancel?.(); if (s.dialog === d) s.dialog = null; return this.emit(); }
    if (s.menu) { s.menu = null; return this.emit(); }
    if (s.viewer) { s.viewer = null; return this.emit(); }
    if (s.editor) { s.editor = null; return this.emit(); }
    // Esc wirkt im Fenster mit dem Fokus: zweites Fenster (Schnellsuche) oder Hauptfenster
    if (s.quick.open && s.focusWin === "quick") return this.quickClose(s.quick.id);
    if (s.help) { s.help = null; return this.emit(); }
    if (s.view === "route") {
      if (s.route.thread) { s.route.thread = ""; return this.rebuild(); }
      if (s.route.mode !== "ganz") { s.route.mode = "ganz"; return this.rebuild(); }
      s.view = "";
      return this.rebuild();
    }
    if (s.overview) { s.overview = ""; return this.rebuild(); }
    if (s.view) { s.view = ""; return this.rebuild(); }
    if (s.mainopen) { s.mainopen = false; s.status = "CodeSearch geschlossen"; return this.emit(); }
  }

  // ------------------------------------------------------------------ Feld: Suche, Befehle, TABLE-Feld
  typeQuery(text) {
    const s = this.state;
    if (s.mode === "table") {
      s.table.query = text;
      return this.rebuild();
    }
    if (String(text).startsWith(">") || s.mode !== "search") { s.fieldDraft = text; return this.emit(); }
    s.fieldDraft = "";
    if (s.view === "path") s.view = "";
    s.query = text;
    s.selected = -1;
    this.rebuild();
    if (this.cs.Followsearch && countRows(s.hits)) {
      const first = s.hits.findIndex((h) => h.kind !== "section" && h.kind !== "notice");
      if (first >= 0) s.selected = -1;
    }
  }

  fieldEnter(text) {
    const s = this.state;
    const value = String(text || "").trim();
    if (value.startsWith(">")) return this.command(value);
    if (s.mode === "table") {
      const m = /^\[\s*(\d+)\s*,\s*(\d+)\s*\]$/.exec(value);
      if (m) {
        s.table.sel = { row: Number(m[1]), col: Number(m[2]) };
        s.table.query = "";
        s.status = `TABLE: Zelle [${m[1]}, ${m[2]}] gewählt`;
        return this.rebuild();
      }
      s.table.query = value;
      return this.rebuild();
    }
    if (s.mode === "search" && !s.view) {
      s.query = value;
      this.rebuild();
      const first = s.hits.findIndex((h) => h.kind !== "section" && h.kind !== "notice");
      if (first >= 0) return this.activate(s.selected >= 0 ? s.selected : first);
      return;
    }
    if (["trace", "refs", "chain"].includes(s.mode) && value) {
      const t = rel(value.replace(/^op\(['"]|['"]\)$/g, ""));
      const found = this.net.op(t) ? t : [...this.net.ops.keys()].find((p) => baseName(p) === value);
      if (found != null) { if(s.mode==='chain')return this.flowSetTarget(found); s.focus = found; s.targets = [abs(found)]; return this.rebuild(); }
    }
  }

  // >befehl
  command(raw) {
    const s = this.state;
    const text = String(raw || "").trim().replace(/^>\s*/, "");
    const [head, ...rest] = text.split(/\s+/);
    const arg = rest.join(" ").trim();
    s.lastCommand = `>${text}`;
    s.fieldDraft = "";
    const lab = this.lab.stateLab;
    const inv = s.inv;
    inv.error = "";
    const done = (msg, ok = true) => { s.status = msg; if (!ok) inv.error = msg; this.rebuild(); return { ok }; };
    const target = (value = arg) => {
      if (!value) return s.focus;
      const path = rel(value.replace(/^op\(['"]|['"]\)$/g, ""));
      if (this.net.op(path)) return path;
      const matches = [...this.net.ops.keys()].filter((p) => baseName(p) === value);
      if (matches.length === 1) return matches[0];
      throw new Error(matches.length > 1 ? `Ziel mehrdeutig: ${value}; vollständigen Pfad verwenden` : `Ziel nicht vorhanden: ${value}`);
    };
    const openTarget = (mode) => { const path = target(); this.OpenAt(mode, { target: path }); return done(`${mode.toUpperCase()} · ${abs(path)}`); };
    const packet = () => { const p = rememberPacket(this, collectEvidence(this, stateAtlas(this))); inv.packet = p; return p; };
    try {
    switch ((head || "").toLowerCase()) {
      case "spec": {
        const [action, ...parts] = arg.split(/\s+/), value=parts.join(' ');
        if (!action) return this.SpecView();
        if (action==='neu') return this.NewSpec(value);
        if (action==='anforderung') return this.AddSpecRequirement(value);
        if (action==='waehlen') return this.SelectSpecRequirement(value);
        if (action==='setzen') {
          const [field,...words]=parts;
          return this.SetSpecField(field,words.join(' '),['title','given','when','then','counterexample','state_id','expected_json'].includes(field) ? this.spec.selected : '');
        }
        if (action==='zustand') return this.SetSpecField('state_id',value,this.spec.selected);
        if (action==='erwartet') return this.SetSpecField('expected_json',value,this.spec.selected);
        if (action==='pruefen') return this.CheckSpecRequirement();
        if (action==='auftrag') return this.SpecBrief();
        if (action==='speichern') return this.SaveSpec();
        if (action==='laden') return this.LoadSpec(value);
        if (action==='importieren') return this.ImportSpec(this.clipboard);
        if (action==='exportieren') return this.ExportSpec();
        if (action==='markdown') return this.ExportSpecMarkdown();
        return done('Unbekannter Spec-Befehl',false);
      }
      case "analyse": {
        const [action, ...question] = arg.split(/\s+/);
        const goals = { verstehen: 'understand', fehler: 'debug', aenderung: 'change', 'änderung': 'change', understand: 'understand', debug: 'debug', change: 'change' };
        if (action === 'kopieren') { this.analysisBrief(); return {ok: true}; }
        if (action === 'importieren') { const result = this.importAnalysis(); return {ok: result.ok !== false}; }
        if (action === 'aktualisieren') { this.refreshAnalysis(); return {ok: true}; }
        if (action === 'vorlage') { this.analysisTemplate(question.join(' ')); return {ok: true}; }
        if (action === 'ergebnis' && question.join(' ') === 'kopieren') { this.copyAnalysisResult(); return {ok: true}; }
        if (action && !Object.hasOwn(goals, action)) return done('>analyse verstehen | fehler | aenderung <Frage> | kopieren | importieren | aktualisieren', false);
        this.analysis(goals[action] || '', question.join(' ')); return {ok: true};
      }
      case "hilfe": s.view = "guide"; return done("Funktionsübersicht");
      case "landkarte":
        if (arg === "kopieren") { this.copy(landkarteText(this, this.codeTargetPath())); this.clipboardOrigin = "landkarte"; return done("LANDKARTE kopiert"); }
        s.mode = "map"; s.view = "landkarte"; return done("LANDKARTE");
      case "snapshot": return this.saveMap();
      case "story": this.copy(flowStoryText(this)); return done("Story der Strecke kopiert");
      case "export":
        s.dialog = { title: "EXPORT", lines: ["KARTE (JSON) → Karten-Ordner codemaps/", "KONTEXT (Markdown für Agenten) → codemaps/<COMP>_context.md", "LANDKARTE kopieren → Zwischenablage", "STORY kopieren → Zwischenablage", "REVIEW kopieren → Zwischenablage"] };
        return done("Exportwege");
      case "review": this.copy(reviewTable(this, this.codeTargetPath())); return done("REVIEW-Tabelle kopiert");
      case "system": s.mode = "map"; s.view = "system"; return done("SYSTEM");
      case "lernen": s.learning = arg !== "aus"; return done(`Lernmodus ${s.learning ? "an" : "aus"}`);
      case "warum": case "why": s.mode = "record"; return this.openWhy();
      case "live": this.SetMode("record"); return done("RECORD");
      case "tour": this.SetMode("tour"); return done("CALL PATH");
      case "ziel":
        if (!arg) { s.dialog = { title: "ZIEL", lines: [`Analyse-Ziel: ${abs(this.codeTargetPath())}`, this.cs.Analysistarget ? "gepinnt" : "folgt dem markierten COMP"] }; return done("Ziel"); }
        if (arg === "aus") { this.cs.Analysistarget = ""; return done("Ziel folgt wieder dem markierten COMP"); }
        if (this.net.op(rel(arg))) { this.cs.Analysistarget = abs(rel(arg)); return done(`Ziel gepinnt: ${abs(rel(arg))}`); }
        return done(`>ziel: ${arg} gibt es nicht`);
      case "route": case "aufrufer": case "weg": {
        const h = this.selectedHit;
        if (arg.startsWith(".")) {
          const name = arg.slice(1);
          const ext = this.net.extClass(this.codeTargetPath());
          if (ext && this.net.member(ext.dat, name)) return this.openRoute(ext.dat, name);
        }
        if (["ganz", "schritt", "kompakt"].includes(arg)) { s.route.mode = arg; return done(`ROUTE ${arg}`); }
        if (arg === "aus") { s.route.thread = ""; return done("ROUTE-Faden ausgeblendet"); }
        if (arg.startsWith("faden ")) { s.route.thread = arg.slice(6).trim(); return done(`ROUTE-Faden: ${s.route.thread}`); }
        if (arg === "aufnehmen") return this.runAction("RECORDROUTE");
        if (h) return this.routeFromSelection();
        return done("ROUTE braucht eine markierte Methode");
      }
      case "impact": if (arg) return openTarget("refs"); else return this.impact();
      case "refs": {
        if (arg.startsWith(".")) {
          const ext = this.net.extClass(this.codeTargetPath());
          const name = arg.slice(1);
          if (!ext || !(this.net.member(ext.dat, name) || ext.model.accesses.some((a) => a.name === name))) return done(`Symbol ${arg} nicht gefunden`, false);
          s.symbolRefs = { dat: ext.dat, name }; s.mode = "refs"; s.view = "symbolrefs"; return done(`Symbol-Referenzen · ${arg}`);
        }
        return openTarget("refs");
      }
      case "karte": return openTarget("map");
      case "prüfen": case "pruefen": return openTarget("check");
      case "frage": this.copy(auditQuestion(this, this.selectedHit, this.codeTargetPath())); return done("Frage-Paket kopiert");
      case "ursache": return this.cause();
      case "absicht": s.intent = arg; return done(`Absicht notiert: ${arg}`);
      // StateLab-Untersuchung
      case "states": {
        s.mode = "map"; s.view = "states"; inv.watchView = false;
        if (arg === "beobachten") {
          this.stopStateWatch(); inv.watchTarget = this.codeTargetPath(); inv.watchHistory = []; inv.watching = true;
          this.sampleStates();
          this._stateWatchTimer = setInterval(() => { this.sampleStates(); this.rebuild(); }, 1000);
          this._stateWatchTimer.unref?.();
          return done("Pocket-Beobachtung läuft: 1.000 ms · maximal 30 Stichproben · >states stoppen");
        }
        if (arg === "stoppen") { this.stopStateWatch(); return done(`Pocket-Beobachtung gestoppt · ${inv.watchHistory.length} Stichproben`); }
        if (arg === "verlauf") { inv.watchView = true; return done("Pocket-Verlauf: Änderungen zwischen Stichproben; kurze Zwischenzustände können fehlen"); }
        if (arg) return done(">states [beobachten | stoppen | verlauf]", false);
        return done("State-Atlas · begrenzte Pocket-Werte");
      }
      case "untersuchung":
        s.mode = "map"; s.view = "untersuchung";
        if (arg === "kopieren") this.copy(JSON.stringify(packet(), null, 2), "evidence");
        return done("Untersuchung");
      case "fall": {
        const id = uid("case");
        const scope = this.codeTargetPath();
        const garden = scope === 'SignalGarden' || scope.startsWith('SignalGarden/');
        if (scope !== 'StateLab' && !garden) return done('Pocket-Fallvergleich: nur StateLab und SignalGarden modelliert; andere Ziele in TD untersuchen', false);
        inv.cases.push({ id, label: arg || `fall${inv.cases.length + 1}`, scope, packet: packet(),
          lab: clone(garden ? this.lab.garden.caseValues(scope) : lab.Observe()) });
        if (inv.cases.length > 12) inv.cases.shift();
        inv.caseId = id;
        s.mode = "map"; s.view = "untersuchung";
        return done(`Fall ${arg || ""} erfasst`);
      }
      case "vergleich": {
        const a = inv.cases[inv.cases.length - 2];
        const b = inv.cases[inv.cases.length - 1];
        if (!a || !b) { inv.comparison = null; return done("Vergleich braucht zwei Fälle (>fall …)", false); }
        if (a.scope !== b.scope) { inv.comparison = null; return done('Verschiedene Analysebereiche: zwei Fälle am selben Ziel aufnehmen', false); }
        const rows = [];
        if (a && b) for (const k of Object.keys(b.lab)) if (JSON.stringify(a.lab[k]) !== JSON.stringify(b.lab[k])) rows.push({ key: k, a: a.lab[k], b: b.lab[k] });
        inv.comparison = { id: uid("cmp"), rows, changed: rows.length };
        s.mode = "map"; s.view = "compare";
        return done(a && b ? `${rows.length} geänderte Werte` : "Vergleich braucht zwei Fälle (>fall …)");
      }
      case "beispiel": {
        this.copy(JSON.stringify(makeSample(packet(), arg), null, 2), arg);
        return done(`Beispiel ${arg} kopiert`);
      }
      case "nachfrage": {
        inv.request = null;
        inv.request = runProtocol(this, parseProtocol(this.clipboard), "request").result;
        s.mode = "map"; s.view = "request";
        return done(inv.request.status === "stale" ? "stale: Quellenrevision passt nicht; keine aktuellen Antworten" : "Nachfrage aus dem begrenzten Pocket-Paket beantwortet");
      }
      case "antwort": {
        inv.explanation = null;
        inv.explanation = runProtocol(this, parseProtocol(this.clipboard), "explanation").result;
        s.mode = "map"; s.view = "explanation";
        return done("Aussagen geprüft");
      }
      case "vorschau": {
        inv.preview = null;
        inv.preview = runProtocol(this, parseProtocol(this.clipboard, 3500000), "preview").result;
        s.mode = "map"; s.view = "preview";
        return done(`Pocket-Vorschau: ${inv.preview.status} · ${inv.preview.violations.length} Regelverletzungen · Quelle unverändert · keine Runtime-Prüfung`);
      }
      case "bildfall": {
        if (this.codeTargetPath() !== "StateLab") return done("Pocket-Bildfall ist auf StateLab-Farbwerte begrenzt; echte TOP-Aufnahme in TD", false);
        inv.visuals.push({ id: uid("img"), count: lab.count, red: Math.min(1, lab.count * 0.25), blue: lab.gainEffective });
        if (inv.visuals.length > 12) inv.visuals.shift();
        s.mode = "map"; s.view = "visual";
        return done("Pocket-Bildfall: simulierte Farbwerte erfasst; kein TOP-Pixelbild gespeichert");
      }
      case "minimalfall": {
        if (arg === "prüfen" || arg === "pruefen") {
          if (!inv.repro?.model) return done("Keine eigene Pocket-StateLab-Kopie vorhanden. Zuerst >minimalfall am StateLab", false);
          const copy = inv.repro.model;
          copy.RuntimeReset(); copy.Fire();
          inv.repro.observed = clone(copy.Observe());
          inv.repro.verified = inv.repro.observed.last_fire_increment === 2 && inv.repro.observed.count === 2;
          return done(inv.repro.verified ? "Pocket-Kopie: ein Fire erhöht 0 → 2; Doppelzählfehler im isolierten JS-Modell reproduziert. Kein TD-Lauf." : "Pocket-Kopie: Doppelzählfehler beim einen Fire nicht reproduziert. Kein allgemeiner Fehlerfrei-Nachweis.");
        }
        if (arg) return done(">minimalfall [prüfen]", false);
        if (this.codeTargetPath() !== "StateLab") return done("Pocket-Minimalfall ist nur für StateLab ausführbar; generische Quellenkopie in TD erstellen", false);
        const model = new Lab(this.net).stateLab;
        model.pars = clone(lab.pars);
        inv.repro = { path: `pocket-memory:StateLab-${uid("r")}`, model, executable: true, verified: false, origin: "pocket-simulation" };
        return done("Isolierte Pocket-StateLab-Kopie im Arbeitsspeicher angelegt; noch kein Prüflauf, keine TD-COMP-Kopie");
      }
      default:
        return done(`unbekannter Befehl >${head} – >hilfe zeigt alle`, false);
    }
    } catch (error) { return done(`Nicht übernommen: ${error.message}`, false); }
  }

  analysis(goal = '', question = '') { return openAnalysis(this, goal, question); }
  analysisBrief() { return exportAnalysis(this); }
  importAnalysis(text = '') { return importAnalysis(this, text); }
  refreshAnalysis() { return refreshAnalysis(this); }
  analysisTemplate(kind) { return analysisTemplate(this, kind); }
  copyAnalysisResult() { return copyAnalysisResult(this); }
  investigationSnapshot() { return {...analysisSnapshot(this),...this.spec.snapshot()}; }
  SpecView() { return this.spec.view(); }
  SpecStates() { return this.spec.states(); }
  NewSpec(title='') { return this.spec.new(title); }
  SelectSpecRequirement(id) { return this.spec.select(id); }
  AddSpecRequirement(title='') { return this.spec.add(title); }
  SetSpecField(field,value,id='') { return this.spec.set(field,value,id); }
  CheckSpecRequirement(id='') { return this.spec.check(id); }
  RecordSpecObservation(procedure,observation,id='') { return this.spec.observe(procedure,observation,id); }
  SpecBrief() { return this.spec.brief(); }
  SaveSpec() { return this.spec.save(); }
  LoadSpec(id) { return this.spec.load(id); }
  ImportSpec(text) { return this.spec.import(text); }
  ExportSpec() { return this.spec.export(); }
  ExportSpecMarkdown() { return this.spec.markdown(); }
  ConfirmSpecReplace(discard) { return this.spec.confirm(discard); }

  sampleStates() {
    const inv = this.state.inv;
    if (!inv.watching) return;
    const packet = collectEvidence(this, stateAtlas(this, inv.watchTarget), inv.watchTarget);
    inv.watchHistory.push(packet);
    if (inv.watchHistory.length >= 30) {
      this.stopStateWatch();
      this.state.status = "Pocket-Beobachtung nach 30 Stichproben automatisch beendet · >states verlauf";
    }
  }

  stopStateWatch() {
    if (this._stateWatchTimer) clearInterval(this._stateWatchTimer);
    this._stateWatchTimer = null;
    this.state.inv.watching = false;
  }

  // ------------------------------------------------------------------ Kopieren
  copy(text, kind = "", origin = "") {
    this.clipboard = String(text);
    // Gleicher Text kann erneut kopiert werden; Inhalt allein beweist keinen neuen Handgriff.
    this.clipboardSerial += 1;
    this.clipboardOrigin = origin;
    if (kind) this.state.inv.sample = kind;
    this.state.status = `kopiert: ${String(text).split("\n")[0].slice(0, 80)}`;
  }

  copyOptions(h = this.selectedHit) {
    if (!h) return [];
    const s = this.state;
    if (s.mode === "errors" && h.kind === "error") return [["Fehlerbericht (Markdown)", errorReport(this, h)]];
    const opts = [];
    const path = rel(h.path);
    if (["method", "symbol", "tourstep", "impact"].includes(h.kind) && h.ctx && this.net.member(path, h.ctx)) {
      opts.push(["Methodenaufruf", addressOfSymbol(this, path, h.ctx, "op_relative")]);
      opts.push(["voller Aufruf", addressOfSymbol(this, path, h.ctx, "op_full")]);
    }
    if (h.par) opts.push(["Parameter-Zugriff", `op('${this._relTo(path)}').par.${h.par}`]);
    if (h.kind === "chan") opts.push(["Kanal-Zugriff", `op('${this._relTo(path)}')['${h.text}']`]);
    if (path || path === "") {
      opts.push(["op() relativ", `op('${this._relTo(path)}')`]);
      opts.push(["op() voll", `op('${abs(path)}')`]);
      opts.push(["Name", baseName(path)]);
    }
    if (h.kind === "code" && h.text) opts.push(["Zeilentext", h.text]);
    return opts;
  }

  _relTo(path) {
    const base = rel(this.state.display.base);
    if (base && (path === base)) return ".";
    if (base && path.startsWith(base + "/")) return path.slice(base.length + 1);
    const pane = this.state.paneOwner;
    if (pane && path.startsWith(pane + "/")) return path.slice(pane.length + 1);
    return abs(path);
  }

  ctrlC(origin = "") {
    const s = this.state;
    if(selectedHits(this).length>1)return copySelection(this, 'rows', origin);
    if (s.mode === "record" && s.view !== "why") return this.copyChain(origin);
    if (s.mode === "table") return this.tableCopyCell(origin);
    const opts = this.copyOptions();
    if (!opts.length) { s.status = "nichts markiert"; return this.emit(); }
    if (opts.length === 1) { this.copy(opts[0][1], "", origin); return this.emit(); }
    s.menu = { title: "KOPIEREN", items: opts.map(([label, value]) => ({ label: `${label}:  ${value.split("\n")[0]}`, run: () => { this.copy(value, "", origin); } })) };
    this.emit();
  }
  selectionCopy(kind='rows') {return copySelection(this,kind);}
  selectionClear() {this.state.multi.clear();this.state.selected=-1;this.emit();}
  selectionMenu() {
    const count=selectedHits(this).length;
    this.state.menu={title:`AUSWAHL · ${count} Einträge`,items:[
      {label:'Ausgewählte Zeilen kopieren',run:()=>this.selectionCopy('rows')},
      {label:'Quellcode der Auswahl kopieren',run:()=>this.selectionCopy('code')},
      {label:'Fundstellen kopieren',run:()=>this.selectionCopy('paths')},
      {label:'Analysepaket aus ausgewählten Quellen',run:()=>this.selectionCopy('analysis')},
      {label:'Auswahl aufheben',run:()=>this.selectionClear()},
    ]};this.emit();
  }

  altP() {
    const h = this.selectedHit;
    if (s_has(h)) { this.copy(h.path || abs(this.state.focus)); }
    this.emit();
  }

  ctrlR() {
    const h = this.selectedHit;
    if (!h || !h.ctx) { this.state.status = "Strg+R braucht eine Methode"; return this.emit(); }
    const path = rel(h.path);
    const blocks = symbolDetail(this, path, h.ctx);
    const lines = [`# Reverse-Spec ${h.ctx}`, `Ort: ${abs(path)}`, ""];
    for (const b of blocks) for (const [k, v] of b.rows) lines.push(`${k}: ${String(v).replace(/\n/g, "; ")}`);
    this.copy(lines.join("\n"));
    this.emit();
  }

  altF() {
    this.copy(auditQuestion(this, this.selectedHit, this.codeTargetPath()));
    this.emit();
  }

  // ------------------------------------------------------------------ DATEN-Leiste
  setDataFormat(format) {
    const d = this.state.display;
    d.format = format;
    if (!d.details) d.prevFormat = format;
    this.emit();
  }

  dataDetails(on) {
    const d = this.state.display;
    if (on && !d.details) { d.prevFormat = d.format; d.details = true; d.format = "full"; }
    else if (!on && d.details) { d.details = false; d.format = d.prevFormat; }
    this.emit();
  }

  dataCycle() {
    const d = this.state.display;
    const i = DATA_FORMATS.indexOf(d.format);
    this.setDataFormat(DATA_FORMATS[(i + 1) % DATA_FORMATS.length]);
  }

  dataTakeNetwork() {
    this.state.display.base = abs(this.state.paneOwner);
    this.emit();
  }

  DataDisplayState() {
    const d = this.state.display;
    return { format: d.format, base: d.base, details: d.details };
  }

  dataAddress(h, format = this.state.display.format) {
    if (!h) return "";
    const path = rel(h.path);
    if (h.kind === "tablecell") {
      const t = this._relTo(path);
      const cell = `[${h.row}, ${h.col}]`;
      if (format === "name") return `${baseName(path)}${cell}`;
      if (format === "relative") return `${t}${cell}`;
      if (format === "full") return `${abs(path)}${cell}`;
      if (format === "op_full") return `op('${abs(path)}')${cell}`;
      return `op('${t}')${cell}`;
    }
    if (["method", "symbol"].includes(h.kind) && h.ctx && this.net.member(path, h.ctx)) return addressOfSymbol(this, path, h.ctx, format);
    if (!h.path) return "";
    const r = this._relTo(path);
    const suffix = h.par ? `.par.${h.par}` : (h.kind === "chan" ? `['${h.text}']` : "");
    if (format === "name") return baseName(path) + suffix;
    if (format === "relative") return r + suffix;
    if (format === "full") return abs(path) + suffix;
    if (format === "op_full") return `op('${abs(path)}')${suffix}`;
    return `op('${r}')${suffix}`;
  }

  dataCopy() {
    const h = this.selectedHit || (this.state.mode === "table" ? this.tableSelectedHit() : null);
    if (!h) { this.state.status = "erst eine Zeile markieren"; return this.emit(); }
    this.copy(this.dataAddress(h));
    this.emit();
  }

  // ------------------------------------------------------------------ RECORD
  recordStart() {
    const rec = this.state.record;
    rec.session = (rec.session || 0) + 1;
    rec.target = this.codeTargetPath();
    rec.recording = true;
    rec.records = [];
    rec.sourceHashes = Object.create(null);
    rec.provenance = {recording_id: uid('pocket-record'), origin: 'pocket-simulation', started: new Date().toISOString(), source_revisions: {}, completeness: ['JavaScript-Lab-Simulation; keine beobachteten Python-Codeobjekte.']};
    rec.chainIndex = 0;
    rec.liveHold = null;
    this.state.status = "RECORD läuft – Aktion auslösen, dann STOP";
    this.rebuild();
  }

  recordStop() {
    const rec = this.state.record;
    rec.recording = false;
    if (rec.provenance) rec.provenance.ended = new Date().toISOString();
    const chains = chainsOf(rec.records);
    const withRoute = chains.findIndex((c) => c.some((r) => r.name === "RouteEvent"));
    rec.chainIndex = withRoute >= 0 ? withRoute : Math.max(0, chains.length - 1);
    this.state.status = `RECORD gestoppt · ${rec.records.length} Aufrufe in ${chains.length} Ketten`;
    this.rebuild();
  }

  recordToggle() {
    if (this.state.record.recording) this.recordStop(); else this.recordStart();
  }

  recordHold() {
    const rec = this.state.record;
    rec.liveHold = rec.liveHold ? null : { at: rec.records.length };
    this.rebuild();
  }

  recordMini(on) {
    this.state.record.liveMini = on === undefined ? !this.state.record.liveMini : on;
    this.emit();
  }

  recordDuration() {
    const rec = this.state.record;
    rec.liveContinuous = !rec.liveContinuous;
    this.emit();
  }

  recordPrev() { this.state.record.chainIndex = Math.max(0, this.state.record.chainIndex - 1); this.rebuild(); }
  recordNext() {
    const n = chainsOf(this.state.record.records).length;
    this.state.record.chainIndex = Math.min(Math.max(0, n - 1), this.state.record.chainIndex + 1);
    this.rebuild();
  }

  copyChain(origin = "") {
    const chains = chainsOf(this.state.record.records);
    const chain = chains[this.state.record.chainIndex] || [];
    this.copy(chainText(chain) || "(keine Kette)", "", origin);
    this.emit();
  }

  // ------------------------------------------------------------------ WARUM
  _labValues() {
    const b = this.lab.blPars;
    return { Enabled: b.Enabled, Route: b.Route, Intensity: b.Intensity, colorNone: false };
  }

  openWhy() {
    const s = this.state;
    const chains = chainsOf(s.record.records);
    const chain = chains[s.record.chainIndex] && chains[s.record.chainIndex].some((r) => r.name === "RouteEvent")
      ? chains[s.record.chainIndex]
      : [...chains].reverse().find((c) => c.some((r) => r.name === "RouteEvent")) || chains[chains.length - 1];
    const item = whyCase(this, chain, this._labValues());
    if (item) {
      s.why.cases.push(item);
      s.why.index = s.why.cases.length - 1;
      s.why.compare = null;
    }
    s.mode = "record";
    s.view = "why";
    s.selected = -1;
    this.rebuild();
  }

  whyLever() {
    const h = this.selectedHit;
    const current = this.state.why.cases[this.state.why.index];
    const cause = current && current.causes[0];
    if (!cause) { this.state.status = "kein STOPP – kein Hebel nötig"; return this.emit(); }
    const m = /self\.eval(\w+)/.exec(cause.guard.test);
    if (!m) return;
    const par = m[1];
    const proposal = /^not\s/.test(cause.guard.test) ? "1" : "";
    this.state.dialog = {
      title: `HEBEL BranchLab.par.${par}`,
      lines: [`Guard Zeile ${cause.guard.line}: if ${cause.guard.test}`, `jetzt ${par} = ${this.lab.blPars[par] ? 1 : 0}`, `Vorschlag: ${par} = ${proposal}  (Enter übernimmt)`],
      confirm: () => { this.lab.blPars[par] = proposal === "1"; this.state.status = `BranchLab.par.${par} = ${proposal}`; },
    };
    void h;
    this.emit();
  }

  whyRetrigger() {
    const s = this.state;
    const before = s.why.cases[s.why.index];
    const capture = [];
    this._captureChain = capture;
    try { this.lab.onParFire(); } finally { this._captureChain = null; }
    const after = whyCase(this, capture.filter((r) => true), this._labValues());
    if (after) {
      s.why.cases.push(after);
      s.why.index = s.why.cases.length - 1;
      s.why.compare = before ? { before, after } : null;
    }
    s.status = "NOCHMAL AUSGELÖST · VORHER → NACHHER";
    this.rebuild();
  }

  whyQuestion() {
    this.copy(whyPacket(this));
    this.emit();
  }

  // ------------------------------------------------------------------ Kontext: Ursache, Snapshot, Karten
  cause() {
    const h = this.selectedHit;
    if (!h || !h.ctx) { this.state.status = "URSACHE braucht eine Zeile mit State"; return this.emit(); }
    const dat = rel(h.path);
    this.state.impactSymbol = { dat, name: h.ctx };
    this.state.impact = `${abs(dat)}:${h.ctx}`;
    this.state.mode = "impact";
    this.state.status = `URSACHE: wer schreibt ${h.ctx}, und welcher Auslöser führt dorthin`;
    this.rebuild();
  }

  saveMap() {
    const comp = this.codeTargetPath();
    const ext = this.net.extClass(comp);
    const time = new Date().toLocaleTimeString("de-DE");
    const symbols = ext ? ext.cls.members.map((m) => m.name) : [];
    const script = this.lab.script;
    const prev = this.state.savedMaps.filter((m) => m.comp === comp).pop();
    this.state.savedMaps.push({ comp, time, symbols, script });
    this.state.lastSnapshot = `${abs(comp)}@${time}#${this.state.savedMaps.length}`;
    if (prev && prev.script !== script) this.state.changeFeed.push({ comp, text: "Δ experiment_script geändert seit dem letzten Snapshot" });
    this.state.status = `Karte gespeichert (${this.cs.Mapfolder}/${baseName(comp)}_map.json)`;
    this.rebuild();
    return { ok: true };
  }

  _pickMap(index) {
    const s = this.state;
    s.mapPick = s.mapPick || [];
    s.mapPick.push(index);
    if (s.mapPick.length >= 2) {
      const [a, b] = s.mapPick.slice(-2).map((i) => s.savedMaps.filter((m) => m.comp === this.codeTargetPath())[i]);
      const lines = [];
      if (a && b) {
        const fa = (a.script.match(/def (\w+)/g) || []).join(", ");
        const fb = (b.script.match(/def (\w+)/g) || []).join(", ");
        lines.push(`A ${a.time}: ${fa}`, `B ${b.time}: ${fb}`, fa === fb ? "keine Änderung" : `Δ ${fa} → ${fb}`);
      }
      s.dialog = { title: "KARTEN-DIFF A → B", lines };
      s.mapPick = [];
    } else s.status = "Karte A gewählt – jetzt Enter auf B";
    this.emit();
  }

  runAction(key, h) {
    const s = this.state;
    switch (key) {
      case 'OPENCONTEXTSOURCE':
        s.context='selection';s.mode='map';s.view='';s.overview='';s.focus=rel(h.path);this.cs.Analysistarget=h.path;s.selected=-1;
        return this.rebuild();
      case "LANDKARTE": s.view = "landkarte"; s.selected = -1; return this.rebuild();
      case "SYSTEM": s.view = "system"; s.selected = -1; return this.rebuild();
      case "REVIEW": this.copy(reviewTable(this, this.codeTargetPath())); return this.emit();
      case "SAVEMAP": return this.saveMap();
      case "CONTEXT": s.status = `Kontext geschrieben: ${this.cs.Mapfolder}/${baseName(this.codeTargetPath())}_context.md`; return this.emit();
      case "GOCHECK": s.mode = "check"; s.view = ""; s.selected = -1; return this.rebuild();
      case "GOENTRIES": s.mode = "entries"; s.view = ""; s.selected = -1; return this.rebuild();
      case "GOERRORS": s.mode = "errors"; s.view = ""; s.selected = -1; return this.rebuild();
      case "RECHECK": s.status = "AUDIT neu aufgebaut"; return this.rebuild();
      case "QUESTION": return this.altF();
      case "RECORDROUTE": s.mode = "record"; s.view = ""; return this.recordStart();
      default: s.status = h ? h.text : ""; return this.emit();
    }
  }

  // ------------------------------------------------------------------ TABLE
  tableData() {
    const path = this.state.table.path;
    if (path === "BranchLab/ColorEngine/palette") return this.lab.palette;
    if (path === 'SignalGarden/Palette/colors') return this.lab.garden.table;
    const o = this.net.op(path);
    return o && o.table ? o.table : [];
  }

  tableView() {
    const t = this.state.table;
    const data = this.tableData();
    const header = data[0] || [];
    let rows = data.slice(1).map((cells, i) => ({ index: i + 1, cells }));
    const q = t.query.trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.cells.some((c) => String(c).toLowerCase().includes(q)));
    const [col, desc] = t.sort;
    if (col >= 0) {
      rows.sort((a, b) => {
        const x = a.cells[col] ?? "";
        const y = b.cells[col] ?? "";
        const nx = Number(x);
        const ny = Number(y);
        const cmp = Number.isFinite(nx) && Number.isFinite(ny) && x !== "" && y !== "" ? nx - ny : String(x).localeCompare(String(y));
        return desc ? -cmp : cmp;
      });
    }
    return { header, rows, path: t.path };
  }

  tableSort(col) {
    const t = this.state.table;
    t.sort = [col, t.sort[0] === col ? !t.sort[1] : false];
    this.rebuild();
  }

  tableSelect(row, col) {
    this.state.table.sel = { row, col };
    this.emit();
  }

  tableSelectedHit() {
    const t = this.state.table;
    if (!t.sel) return null;
    const data = this.tableData();
    const value = (data[t.sel.row] || [])[t.sel.col];
    return { kind: "tablecell", path: abs(t.path), text: String(value ?? ""), text_full: String(value ?? ""), line: t.sel.row, par: null, ctx: (data[0] || [])[t.sel.col] || "", detail: `[${t.sel.row}, ${t.sel.col}]`, conf: "", row: t.sel.row, col: t.sel.col };
  }

  tableEdit(row, col, value) {
    if (this.state.table.path === 'SignalGarden/Palette/colors') {
      const table = this.lab.garden.table;
      if (row > 0 && row < table.length && col > 0 && col < table[row].length) {
        this.lab.editCell(row, col, value, this.state.table.path); this.state.status = `colors[${row}, ${col}] = ${value}`;
      } else this.state.status = 'Nur vorhandene RGB-Zellen bearbeiten; Namen und Header bleiben fest.';
      return this.rebuild();
    }
    if (this.state.table.path !== "BranchLab/ColorEngine/palette") { this.state.status = "diese Tabelle ist im Kurs schreibgeschützt"; return this.emit(); }
    this.lab.editCell(row, col, value);
    this.state.status = `palette[${row}, ${col}] = ${value}`;
    this.rebuild();
  }

  tableCopyCell(origin = "") {
    const h = this.tableSelectedHit();
    if (!h) { this.state.status = "erst eine Zelle markieren"; return this.emit(); }
    const header = this.tableData()[0] || [];
    this.state.menu = { title: "KOPIEREN", items: [
      { label: `Zell-Zugriff:  op('${this._relTo(rel(h.path))}')[${h.row}, '${header[h.col]}']`, run: () => this.copy(`op('${this._relTo(rel(h.path))}')[${h.row}, '${header[h.col]}']`, "", origin) },
      { label: `Index:  [${h.row}, ${h.col}]`, run: () => this.copy(`op('${this._relTo(rel(h.path))}')[${h.row}, ${h.col}]`, "", origin) },
      { label: `Wert:  ${h.text}`, run: () => this.copy(h.text, "", origin) },
    ] };
    this.emit();
  }

  tableMenu(row, col) {
    const data = this.tableData();
    const header = data[0] || [];
    const cells = data[row] || [];
    const path = this.state.table.path;
    const editable = path === "BranchLab/ColorEngine/palette";
    const lab = this.lab;
    this.state.table.sel = { row, col };
    this.state.menu = { title: `ZELLE [${row}, ${col}]`, items: [
      { label: "Zeile als Dict kopieren", run: () => this.copy(pyStr(Object.fromEntries(header.map((h, i) => [h, cells[i]])))) },
      { label: "Spalte als Liste kopieren", run: () => this.copy(pyStr(data.slice(1).map((r) => r[col]))) },
      { label: "Tabelle als CSV kopieren", run: () => this.copy(data.map((r) => r.join(",")).join("\n")) },
      { label: "Zeile einfügen …", run: () => { if (editable) { lab.mutateTable(path, rows => rows.splice(row + 1, 0, header.map(() => ""))); this.state.status = "Testzeile eingefügt – Strg+Z macht sie rückgängig"; } } },
      { label: "Zeile löschen …", run: () => { if (editable && row > 0) { lab.mutateTable(path, rows => rows.splice(row, 1)); this.state.status = "Zeile gelöscht"; } } },
      { label: "Spalte einfügen …", run: () => { if (editable) { lab.mutateTable(path, rows => rows.forEach(r => r.splice(col + 1, 0, ""))); this.state.status = "Spalte ohne Namen eingefügt"; } } },
      { label: "Spalte löschen …", run: () => { if (editable && col > 0) { lab.mutateTable(path, rows => rows.forEach(r => r.splice(col, 1))); this.state.status = "Spalte gelöscht"; } } },
      { label: "Sortierung in den DAT schreiben …", run: () => {
        if (!editable) return;
        this.state.dialog = { title: "SORTIERUNG SCHREIBEN", lines: ["Die angezeigte Reihenfolge wird in den echten DAT geschrieben.", "SCHREIBEN (Enter) · ABBRECHEN (Esc)"],
          confirm: () => { const view = this.tableView(); lab.mutateTable(path, rows => rows.splice(0, rows.length, header.slice(), ...view.rows.map(r => r.cells.slice()))); this.state.status = "Sortierung in den DAT geschrieben"; } };
      } },
      { label: "Duplikate in Spalte markieren", run: () => { this.state.table.dups = col; this.state.status = `Duplikate in Spalte ${header[col]} markiert`; } },
    ] };
    this.emit();
  }

  undoTD() {
    this.state.status = this.lab.undoTable() ? "Letzte Änderung rückgängig · Strg+Y stellt sie wieder her"
      : this.lab.tableHistoryError || "Keine Änderung zum Rückgängigmachen";
    this.rebuild();
  }

  redoTD() {
    this.state.status = this.lab.redoTable() ? "Änderung wiederhergestellt"
      : this.lab.tableHistoryError || "Keine Änderung zum Wiederherstellen";
    this.rebuild();
  }

  // ------------------------------------------------------------------ Schnellsuche (Strg+P)
  quickOpen(fresh=false) {return openSearch(this,fresh);}
  closeAllSearchWindows() {for(const q of this.state.searchWindows){q.open=false;this.regexQueue?.cancel(q.id);}this.state.focusWin='main';this.state.quickFocusRequested=null;}
  quickActivate(id) {const q=this.state.searchWindows.find(item=>item.id===id);if(q){this.state.quick=q;this.state.focusWin='quick';this.state.floatFocus=null;}return q;}
  quickSearch(text,id=this.state.quick.id) {return searchSession(this,text,id);}
  quickScope(value,id=this.state.quick.id) {return scopeSession(this,value,id);}
  quickOption(name,value,id=this.state.quick.id) {
    const q=this.state.searchWindows.find(item=>item.id===id);if(!q)throw new Error('Suchfenster nicht vorhanden.');
    if(['regex','caseSensitive','includeTables','includeSys'].includes(name))q[name]=Boolean(value);
    else if(name==='maxResults' && Number.isInteger(value) && value>=1 && value<=5000)q[name]=value;
    else throw new Error('Ungültiger Suchfilter.');
    return this.quickSearch(q.query,id);
  }
  quickFilter(filter) {this.state.quick.filter=filter;return this.quickSearch(this.state.quick.query);}
  quickClose(id=this.state.quick.id) {const q=this.state.searchWindows.find(item=>item.id===id);if(q)q.open=false;this.regexQueue?.cancel(id);this.state.focusWin='main';this.emit();}

  quickSelect(i) { this.state.quick.selected = i; this.emit(); }

  quickJump(i) {
    const h = this.state.quick.hits[i];
    if (!h || h.kind === "section" || h.kind === "notice") return;
    this.state.quick.selected = i;
    this.jumpTo(h);
    this.emit();
  }

  quickToMain(i,id=this.state.quick.id) {return transferSearch(this,id,i);}

  // ------------------------------------------------------------------ Lesekopien, Definitionen
  floatList(size = 'side') { return openCopy(this, 'list', size); }
  floatCopy(kind = 'list', size = 'side') { return openCopy(this, kind, size); }
  floatMenu() { copyMenu(this); }
  floatSize(id, size) { sizeCopy(this, id, size); }

  floatDefinition(dat, name) {
    const member = this.net.member(dat, name);
    if (!member) return;
    this._showCode(dat, member.line, name);
    this.state.codeView.definition = true;
    const f = openCopy(this, 'code', 'side');
    if(f) f.title = `Definition · ${name} · Zweitansicht`;
    return f;
  }

  floatClose(id) {
    this.state.floats = this.state.floats.filter((f) => f.id !== id);
    if (this.state.floatFocus === id) this.state.floatFocus = null;
    this.emit();
  }

  definitionJump(name) {
    const cv = this.state.codeView;
    const dat = rel(cv.path);
    const member = this.net.member(dat, name);
    if (!member) { this.state.status = `${name}: keine Definition in ${baseName(dat)}`; return this.emit(); }
    cv.back.push({ path: cv.path, focus: cv.focus, line: cv.line, definition: cv.definition });
    cv.forward = [];
    cv.focus = name;
    cv.line = member.line;
    cv.definition = true;
    this.emit();
  }

  definitionBack() {
    const cv = this.state.codeView;
    const prev = cv.back.pop();
    if (!prev) return;
    cv.forward.push({ path: cv.path, focus: cv.focus, line: cv.line, definition: cv.definition });
    Object.assign(cv, prev);
    this.emit();
  }

  definitionForward() {
    const cv = this.state.codeView;
    const next = cv.forward.pop();
    if (!next) return;
    cv.back.push({ path: cv.path, focus: cv.focus, line: cv.line, definition: cv.definition });
    Object.assign(cv, next);
    this.emit();
  }

  chainReaderStep(index, steps) {
    this.state.chainReader = { index, reader: true };
    const step = steps[index];
    if (step) this._showCode(step.dat, step.line, step.name);
    this.emit();
  }

  // ------------------------------------------------------------------ Netz-Auswahl (TD-Seite)
  networkSelect(path) {
    this.state.networkSelected = path == null ? [] : [path];
    if (path != null) {
      this.state.targets = [abs(path)];
      this.state.focus = path;
      if(this.state.mode==='chain' && this.state.flow.pinned)return this.emit();
      const followMode = ["trace", "refs", "chain"].includes(this.state.mode) || CODE_MODES.has(this.state.mode);
      if (this.cs.Followselection && followMode) {
        this.state.selected = -1;
        this.rebuild();
        return;
      }
    }
    this.emit();
  }

  // Tooltip-Text der ART-Zelle (wie im Original): was diese Zeile IST
  explain(h) {
    const ui = this.ui;
    if (!h) return "";
    const kind = { chain: "station", tourbranch: "tourstep" }[h.kind] || h.kind;
    if (h.kind === "why" || h.kind === "whystep") {
      const why = ui.WHY_KIND_HELP || {};
      if (/STOPP/.test(h.art)) return why.stop;
      if (/ALTERNATIVE/.test(h.art)) return why.alt;
      if (/LIEF|START/.test(h.art)) return "✓ = laut Dashcam (RECORD) wirklich gelaufen. Die Landkarte (Code) hatte diesen Aufruf erwartet.";
      if (/VORHER/.test(h.art)) return "VORHER → NACHHER: derselbe Klick vor und nach dem Hebel – so siehst du, was die Änderung bewirkt hat.";
    }
    if (h.kind === "lint" || h.kind === "hot") {
      return {
        WARNUNG: "WARNUNG = CODE-BEFUND: ein Muster im Code, das bei Änderungen oft Ärger macht (mehrere Schreiber, State ohne Leser, starrer Pfad, teure Arbeit im Hot Path). Review-Kandidat, kein bewiesener Bug.",
        LINT: "LINT = VERTRAG: die Schnittstelle passt nicht zur Nutzung (public ohne Aufrufer von außen, privat aber von außen gerufen).",
        HINWEIS: "HINWEIS = AUSLÖSER: ein Execute- oder Eingabe-DAT ist ausgeschaltet – TD ruft ihn gar nicht.",
        HOT: "HOT = von einem Frame-Einstieg erreichbar: läuft potenziell jeden Frame. Kein gemessener Engpass.",
        Δ: "Δ = Änderung seit dem letzten Snapshot (>snapshot).",
      }[h.art] || "";
    }
    if (h.art === "ETAPPEN") return "ETAPPEN = Zusammenfassung der Strecke: wie viele QUELLEN vor dem SELECTED liegen und wie viele ZIELE danach.";
    if (h.art === "RÜCKKOPPLUNG") return "RÜCKKOPPLUNG = die Strecke kommt zu sich selbst zurück: ein Feedback TOP liest über seinen Par top einen späteren Ausgang. Kein Fehler, sondern ein Kreis.";
    if (h.art === "SELECTED") return "SELECTED = der markierte Op, um den FLOW die Strecke aufbaut (Strg+Enter macht eine andere Station zum SELECTED).";
    if (h.art === "COMP-IN" || h.art === "COMP-OUT") return `${h.art} = Kante durch eine COMP-Grenze: Eingang eines COMPs → sein In-OP innen, bzw. Out-OP innen → Ausgang des COMPs.`;
    return h.kind_note || (ui.HITKIND_HELP || {})[h.hitkind] || (ui.KIND_HELP || {})[h.kind_orig || kind]
      || (ui.CAT_HELP || {})[h.cat] || (ui.DETAIL_HELP || {})[h.art] || "";
  }

  // Detail-Bloecke der markierten Zeile (rechte Spalte) - zuerst WAS IST DAS (Tooltip der ART-Zelle)
  detailFor(h = this.selectedHit) {
    if (!h) return [];
    const blocks = this._detailBlocks(h);
    const what = this.explain(h);
    if (what) blocks.unshift({ title: "WAS IST DAS", rows: [[h.art || h.hitkind || (this.ui.KIND_LABELS || {})[h.kind] || h.kind, what]] });
    if (h.kind === "code" && h.line) {
      blocks.splice(1, 0, { title: "FUNDSTELLE", rows: [["ZEILE", `${h.line}${h.detail ? `  ·  in ${h.detail}` : ""}`], ["TEXT", h.text_full || h.text],
        ["GRENZE", "Ein Textfund beweist keinen Aufruf. Kein Treffer beweist keine Nichtbenutzung."]] });
    }
    return blocks;
  }

  _detailBlocks(h) {
    const net = this.net;
    const path = rel(h.path);
    const blocks = [];
    if (h.evidence) return [{ title: "BELEG", rows: [["GRENZE", h.reason], ...h.evidence.map((e) => [e.source || "RECORD", `Z.${e.line || "?"} · ${e.method || e.symbol || e.text || ""}`])] }];
    if (["method", "symbol", "state", "self", "tourstep", "impact", "parstate"].includes(h.kind) && h.ctx && net.code[path]) {
      blocks.push(...symbolDetail(this, path, h.ctx));
      if (h.kind === "parstate") {
        const par = h.ctx.replace(/^(eval|par)/, "");
        blocks.push({ title: "PARAMETER", rows: [["WERT JETZT", this.lab.helperParValue(net.datComp.get(path) ?? "", par)], ["MODUS", "CONSTANT"], ["LEBT", "am COMP (Custom-Par) – überlebt den Reinit"]] });
      }
      return blocks;
    }
    if (h.kind === "entry") {
      const entry = (this.state.meta.entries || []).find((e) => e.method === h.ctx && abs(e.source) === h.path);
      const rows = [["WANN", h.entry_when], ["WER", baseName(path)], ["RUFT", `${h.ctx}()`], ["STATUS", h.entry_state], ["WAHRHEIT", h.art.startsWith("≈") ? "≈ vermutet – nur nach Namenskonvention" : "sicher – aufgelöst"]];
      blocks.push({ title: "EINSTIEG", rows });
      if (entry) {
        const steps = entryChain(this, entry);
        blocks.push({ title: "KETTE", rows: steps.map((st, i) => [`${i + 1}`, st.text, `chain:${i}`]), steps });
        const gardenOwner = this.lab.garden.owner(path);
        const jetzt = gardenOwner ? Object.entries(this.lab.garden.pars[gardenOwner]).map(([name, value]) => [name, String(value)]) : entry.watched === "BranchLab/control"
          ? [["CHOP control", `gain ${fmtNum(this.lab.control.gain)} · route ${fmtNum(this.lab.control.route)}`]]
          : [["Enabled", this.lab.blPars.Enabled ? "1" : "0"], ["Route", this.lab.blPars.Route], ["Intensity", fmtNum(this.lab.blPars.Intensity)]];
        blocks.push({ title: "JETZT", rows: jetzt });
        if (entry.state === "AUS") blocks.push({ title: "STATUS", rows: [["», EXEC", "DAT aus (Par Active) – TD ruft gar nichts"]] });
      }
      return blocks;
    }
    if (h.kind === "whystep" && h.guard_line) {
      const current = this.state.why.cases[this.state.why.index];
      return [{ title: "WARUM", rows: [
        ["▶ AMPEL", `Zeile ${h.guard_line}: if ${h.guard_test}:`, "ampel"],
        ["JETZT", `jetzt ${h.guard_test.replace(/^not\s+/, "")} = ${current && current.values.Enabled ? "True" : "False"}`],
        ["HEBEL", `BranchLab.par.Enabled … (setzt 1)`, "lever"],
        ["NOCHMAL AUSLÖSEN", "Fire erneut pulsen und VORHER → NACHHER zeigen", "retrigger"],
        ["FRAGE-PAKET", "# CodeSearch WARUM … in die Zwischenablage", "question"],
      ] }];
    }
    if (h.kind === "why" || h.kind === "whystep") {
      return [{ title: "WARUM", rows: [["SATZ", h.text_full], ["HEBEL", "BranchLab.par.Enabled …", "lever"], ["NOCHMAL AUSLÖSEN", "Fire erneut pulsen", "retrigger"], ["FRAGE-PAKET", "# CodeSearch WARUM …", "question"]] }];
    }
    if (h.kind === "error") {
      return [{ title: "FEHLER", rows: [["OP", "error_probe (level, TOP)"], ["PAR", "opacity (Expression)"], ["AUSDRUCK", "op('absichtlich_fehlend')['gain']"], ["MELDUNG", "'NoneType' object is not subscriptable"], ["URSACHE", "op('absichtlich_fehlend') findet keinen Op → None"], ["ALT+KLICK", "Par auf CONSTANT schalten (Fehler weg, Expression bleibt im Par gespeichert)"]] }];
    }
    if (h.kind === "lint" || h.kind === "hot") {
      return [{ title: "BEFUND", rows: [["STUFE", h.art], ["ORT", `${baseName(path)}${h.line ? ` Z.${h.line}` : ""}`], ["HINWEIS", h.text], ["GRENZE", "ein Hinweis ist kein bewiesener Bug"]] }];
    }
    if (h.kind === "investigation" && h.atlas) {
      const a = h.atlas;
      return [{ title: "STATE", rows: Object.entries({ ORT: a.owner, ART: a.kind, WERT: JSON.stringify(a.value), LEBENSDAUER: a.lifetime, ALIAS: a.alias, SCHREIBER: (a.writers || []).join(", "), LESER: (a.readers || []).join(", "), MODUS: a.mode, NOTIZ: a.note, HERKUNFT: a.origin })
        .filter(([, v]) => v !== undefined && v !== "" && v !== "undefined").map(([k, v]) => [k, String(v)]) }];
    }
    if (path || path === "") {
      const o = net.op(path);
      if (o) {
        const rows = [["OP", `${o.name} (${net.shortType(path)}, ${o.family})`], ["FORM", opForm(this, path)], ["FLAGS", (o.flags || []).join(", ") || "—"], ["COOK", cookText(o)]];
        for (const e of net.edgesTo(path).filter((x) => ["expr", "bind", "export", "oppar", "watch"].includes(x.kind))) {
          const label = { expr: "EXPR ←", bind: "BIND ←", export: "EXPORT ⇐", oppar: "PAR-REF ←", watch: "BEOBACHTET" }[e.kind];
          rows.push([label, `Par ${e.par} ← ${e.text || baseName(e.src)}`, e.kind === "expr" ? `expr:${e.par}` : ""]);
        }
        const readers = net.edgesFrom(path).filter((x) => x.dst && ["expr", "bind", "export", "oppar", "wire"].includes(x.kind));
        if (readers.length) rows.push(["LESER →", [...new Set(readers.map((x) => baseName(x.dst)))].join(", ")]);
        if (o.comment) rows.push(["KOMMENTAR", o.comment]);
        if (h.kind_note) rows.push(["TOOLTIP", h.kind_note]);
        blocks.push({ title: "DETAIL", rows });
        rows.push(["ADRESSE", this.dataAddress(h)]);
      }
    }
    return blocks;
  }

  // ------------------------------------------------------------------ Fenster und Look
  toggleLook() {
    const imported = Object.keys(this.ui.CODESEARCH_LOOKS || {});
    const looks = imported.length ? imported : (this.parDefs.Look && this.parDefs.Look.menuNames) || ["classic", "graphite", "midnight", "paper", "sand", "contrast"];
    const i = looks.indexOf(this.cs.Look);
    this.cs.Look = looks[(i + 1) % looks.length];
    this.emit();
  }

  zoom(delta) {
    this.state.zoom = delta === 0 ? 1 : Math.max(0.7, Math.min(1.6, this.state.zoom + delta));
    this.emit();
  }

  nextTab(dir) {
    const i = TAB_ORDER.indexOf(this.state.mode);
    this.SetMode(TAB_ORDER[(i + dir + TAB_ORDER.length) % TAB_ORDER.length]);
  }

  // Werte fuer die Statuszeile
  statusLine() {
    const s = this.state;
    const label = (this.ui.TAB_LABELS || {})[s.mode] || s.mode;
    const count = countRows(s.hits);
    if (s.status) return s.status;
    if (s.mode === "search") {
      const total = s.meta && s.meta.total !== undefined ? s.meta.total : count;
      return `${label} · ${(this.ui.FILTER_LABELS || {})[this.cs.Searchfilter] || "ALLE"}: ${total} Treffer in ${baseName(abs(this.scopeRoot())) || "CodeSearch_Tutorial"}`;
    }
    return `${label} · ${abs(s.focus)} · ${count} Zeilen`;
  }

  columns() {
    const s = this.state;
    const ui = this.ui;
    if (s.mode === "search") {
      const f = this.cs.Searchfilter;
      const key = f === "all" ? "search_all" : (f === "par" ? "search_par" : f === "chan" ? "search_chan" : f === "op" ? "search_op" : f === "table" ? "search_table" : "search");
      return headers(ui, key, ["ART", "WO (Pfad)", "ZEILE", "INHALT"]);
    }
    if (s.view === "landkarte") return ["ROLLE", "WO", "DETAIL", "INHALT"];
    if (s.mode === "chain") return ["ART", "STATION", "FORM", "OP · FLAGS / COOK"];
    if (s.mode === "entries") return ["ANLASS", "QUELLE", "EINSTIEG IN CODE", "ZUSTAND"];
    if (s.mode === "check") return ["STUFE", "WO", "ZEILE", "BEFUND / ÄNDERUNG"];
    if (s.mode === "tour") return s.view === "route" ? ["HOP", "WO", "WARUM", "ROUTE"] : ["SCHRITT", "DAT", "ZEILE", "AUFRUFKETTE (Tiefe eingerückt)"];
    if (s.mode === "record") return s.view === "why" ? ["ART", "WO", "WAS", "WARUM"] : ["ART", "WO", "ZEIT", "AUFRUF"];
    return headers(ui, s.mode, ["ART", "WO", "DETAIL", "INHALT"]);
  }

  groups() {
    return groupsOf(this.state.hits);
  }

  auditFindings(comp) {
    return auditFindings(this, comp);
  }

  entriesFor(comp, context) {
    return entriesFor(this, comp, context);
  }
}

function s_has(h) { return Boolean(h); }

function emptyRow(text) {
  return { kind: "notice", path: "", text, text_full: text, line: null, par: null, ctx: "", detail: "", conf: "" };
}

function performanceNow() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

export { parentOf };
