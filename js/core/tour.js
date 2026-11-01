// Mitmach-Tour: Vorbereitung, Snapshot und Pruefung wie TourExt.py / checks.py / tutorial_adapter.py.
// Pruefen liest nur den Zustand - es fuehrt die zu lernende Aktion nie selbst aus.

import { abs, rel, pyStr, casefold } from "./util.js";
import { stateAtlas } from "./views/miscviews.js";
import { resolveProgressStep } from "./progress.js";
import { newFlowState } from "./flow-session.js";

const CODE_MODES = new Set(["map", "entries", "tour", "impact", "record", "check"]);
const SKIP_KINDS = new Set(["info", "empty", "header", "section", "button", "notice"]);

// ------------------------------------------------------------------ checks.evaluate
function isNum(v) { return typeof v === "number" || typeof v === "boolean"; }
function num(v) { return typeof v === "boolean" ? (v ? 1 : 0) : v; }

function pyEq(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a === null || b === null) return a === b;
  if (isNum(a) && isNum(b)) return num(a) === num(b);
  if (typeof a === "object" && typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

function pyText(v) {
  return typeof v === "string" ? v : pyStr(v);
}

export function evaluate(rules, state, baseline) {
  const failures = [];
  const results = [];
  for (const rule of rules || []) {
    const key = rule.key;
    let ok;
    if (!(key in state)) {
      ok = false;
      failures.push(rule.missing || `${key} ist in diesem Zustand nicht lesbar.`);
      results.push({ ...rule, ok, actual: undefined });
      continue;
    }
    const value = state[key];
    const expected = rule.value;
    const op = rule.op || "eq";
    if (op === "eq") ok = pyEq(value, expected);
    else if (op === "contains") ok = casefold(pyText(value)).includes(casefold(pyText(expected)));
    else if (op === "not_contains") ok = !casefold(pyText(value)).includes(casefold(pyText(expected)));
    else if (op === "gt") ok = isNum(value) && num(value) > num(expected);
    else if (op === "delta") {
      const previous = baseline[key];
      ok = previous !== null && previous !== undefined && isNum(value) && num(value) > num(previous);
    } else if (op === "changed") ok = key in baseline && !pyEq(value, baseline[key]);
    else if (op === "near") ok = isNum(value) && Math.abs(num(value) - expected) <= (rule.tolerance ?? 0.001);
    else ok = false;
    if (!ok) failures.push(rule.hint || `Noch nicht erreicht: ${key}.`);
    results.push({ ...rule, ok, actual: value });
  }
  return { passed: failures.length === 0, failures, results };
}

export function markerMatch(hit, match) {
  if (!match || !hit || !Object.keys(hit).length) return false;
  for (const [key, value] of Object.entries(match)) {
    if (key === "contains") {
      if (!casefold(pyStr(hit)).includes(casefold(value))) return false;
    } else if (!pyEq(hit[key], value)) return false;
  }
  return true;
}

// ------------------------------------------------------------------ Tour
export class Tour {
  constructor({ course, cs, storage = null }) {
    this.course = course;
    this.lessons = course.lessons;
    this.chapters = course.chapters;
    this.cs = cs;
    this.lab = cs.lab;
    this.storage = storage;
    this.step = 0;
    this.done = {};
    this.skipped = new Set();
    this.observed = false;
    this.opened = false;
    this.hint = false;
    this.feedback = "";
    this.playing = false;
    this.baseline = {};
    this.prepared = -1;
    this.currentPassed = false;
    this.workplaceSelectionSerial = 0;
  }

  lesson(i = this.step) { return this.lessons[i]; }

  // TourExt.Prepare + ShowWorkplace + tutorial_adapter.prepare
  prepare(force = false) {
    const lesson = this.lesson();
    if (!lesson) return;
    if (this.prepared === this.step && !force) return;
    this.prepared = this.step;
    this.currentPassed = false;
    const cs = this.cs;
    const prep = lesson.prep || {};
    this.observed = false;
    this.opened = false;
    this.hint = false;
    this.feedback = "Führe die Aktion selbst aus. „Prüfen“ liest danach das Ergebnis.";
    cs.state.status = "";
    // Hilfe-Einblendung, Menues und Dialoge gehoeren zur letzten Geste, nicht zur neuen Station
    cs.state.help = null;
    cs.state.menu = null;
    cs.state.dialog = null;
    cs.state.viewer = null;
    if (cs.state.record.recording && !lesson.keep) cs.recordStop();
    if (cs.state.inv.watching && !lesson.keep) cs.stopStateWatch();
    if (prep.close_quick) cs.closeAllSearchWindows();
    if ("quick_filter" in prep) cs.state.quick.filter = prep.quick_filter;
    if (!lesson.keep) {
      Object.assign(cs.cs, { Regex: false, Casesensitive: false, Searchfilter: "all", Opfamily: "all", Maxresults: 500, Includetables: true, Analysistarget: "" });
      cs.state.scopeDepth = 0;     // REKURSIV wieder alle Ebenen
      cs.state.floatFocus = null;  // offenes Zweitfenster bleibt, faengt aber keine Tasten der neuen Station ab
      // Eine neue Station verspricht ihr eigenes Ziel; alte Pins und Filter dürfen es nicht überlagern.
      cs.state.flow = newFlowState();
    }
    if (prep.reset_lab) {
      this.lab.setPalette("valid");
      this.lab.Reset(false);
    }
    for (const [key, value] of Object.entries(prep)) {
      if (key.startsWith("cs.")) cs.cs[key.slice(3)] = value;
      else if (key.startsWith("lab.")) this.lab.blPars[key.slice(4)] = value;
    }
    if ("palette" in prep) this.lab.setPalette(prep.palette);
    if (prep.error === "clean") this.lab.restoreError();
    if (prep.snapshot_folder) cs.cs.Mapfolder = "CodeSearch_Tutorial/codemaps";
    if (!lesson.keep && this.step !== 0) this.showWorkplace(false);
    if (!lesson.keep) {
      cs.state.display = { format: prep["display.format"] || "name", base: abs("BranchLab"), details: false, prevFormat: prep["display.format"] || "name" };
    }
    if (lesson.target === "StateLab" && prep["investigation.prepare"]) this.lab.stateLab.Prepare();
    if (prep['garden.prepare']) this.lab.garden.Prepare();
    for (const [key, value] of Object.entries(prep)) {
      if (key.startsWith('garden.par.')) {
        const [, , owner, name] = key.split('.');
        this.lab.garden.pars[owner][name] = value;
      }
    }
    if (prep["investigation.clear_repro"]) cs.state.inv.repro = null;
    cs.rebuild();
    this.baseline = this.snapshot();
    this.save();
  }

  showWorkplace(emit = true) {
    const lesson = this.lesson();
    const cs = this.cs;
    const target = lesson.target;
    const o = cs.net.op(target);
    if (!o) {
      this.feedback = `Das Ziel dieser Station fehlt: ${target}`;
      return;
    }
    const isComp = o.family === "COMP";
    cs.state.paneOwner = isComp ? target : (o.parent || "");
    cs.state.networkSelected = isComp ? [] : [target];
    cs.cs.Followselection = false;
    cs.cs.Includeui = false;
    cs.cs.Includesys = false;
    cs.state.why.compare = null;
    cs.state.focusWin = "main";
    cs.state.route = { anchor: "", dat: "", name: "", hop: 0, mode: "ganz", thread: "" };
    cs.state.tourClosed = new Set();
    cs.state.tourEntry = "";
    cs.state.context = "selection";
    cs.state.collapsedBlocks = new Set();
    cs.state.expandedStates = new Set();
    cs.state.codeView = { path: "", focus: "", definition: false, back: [], forward: [] };
    cs.state.chainReader = { index: -1, reader: false };
    cs.state.impactSymbol = null;
    cs.OpenAt(lesson.start || lesson.mode, { target, query: lesson.query || "", symbol: lesson.symbol || "", scope: lesson.scope || "" });
    if (lesson.view === "landkarte") {
      cs.state.view = "landkarte";
      cs.rebuild();
    }
    this.opened = true;
    // Automatische Vorbereitung (emit=false) ist kein Rücksprung des Nutzers.
    if (emit) this.workplaceSelectionSerial = cs.state.flowlens.selectionSerial || 0;
    if (emit) cs.emit();
  }

  // TourExt.Snapshot + tutorial_adapter.snapshot + view_state
  snapshot() {
    const cs = this.cs;
    const s = cs.state;
    const lab = this.lab;
    const lesson = this.lesson();
    const hits = s.hits || [];
    const hit = s.hits[s.selected] && s.hits[s.selected].kind !== undefined ? s.hits[s.selected] : (s.mode === "table" ? cs.tableSelectedHit() : null);
    const sel = hit || {};
    const rec = s.record;
    const table = cs.tableView();
    const quickHit = s.quick.hits[s.quick.selected] || {};
    const state = {
      opened: this.opened, observed: this.observed, playing: this.playing,
      "clipboard.copy_serial": cs.clipboardSerial, "clipboard.origin": cs.clipboardOrigin,
      mode: s.mainopen || s.quick.open ? s.mode : s.mode, view: s.view, query: s.query, hits: hits.length,
      search_results: hits.filter((h) => !SKIP_KINDS.has(h.kind)).length,
      hit_text: hits.map((h) => pyStr(h)).join("\n"), selected: pyStr(sel), selected_kind: sel.kind || "",
      targets: s.targets.join(" "), impact: s.impact, tour_entry: s.tourEntry, tour_open: s.tourClosed.size,
      overview: s.overview, learning: s.learning, quickopen: s.quick.open, quickquery: s.quick.query, mainopen: s.mainopen,
      quickfilter: s.quick.filter,
      quickresults: (s.quick.hits || []).filter((h) => !["info", "header", "section", "notice", "empty"].includes(h.kind)).length,
      selected_ctx: sel.ctx || "", selected_path: sel.path || "", selected_expanded: Boolean(sel.expanded),
      expr_opacity: lab.exprOpacity, export_opacity: lab.exportOpacity, multi: s.multi.size,
      table_path: s.mode === "table" || s.table.path ? abs(s.table.path) : "", table_query: s.table.query,
      table_visible: table.rows.length, table_sort_col: s.table.sort[0],
      recording: rec.recording, record_text: rec.records.map((r) => r.name).join(" "), record_calls: rec.records.length,
      'record.session': rec.session || 0,
      record_state: rec.records.map((r) => r.state || "").join(" "),
      live_hold: rec.liveHold !== null, live_mini: rec.liveMini, live_continuous: rec.liveContinuous,
      events: lab.events, branch: lab.branch, writes: lab.writes, engine_status: lab.ceStatus,
      gain: lab.control.gain, red: lab.rgb[0], soft_size: lab.softSize, keyboard_active: lab.farbmischer.tastenActive,
      error_mode: lab.errorProbe.mode, error_clean: !lab.errorActive && lab.errorProbe.expr.includes("op('control')"),
      script_text: lab.script, snapshot: s.lastSnapshot,
      quickselected: pyStr(quickHit),
      quick_jump_matches: Boolean(quickHit.path && s.networkSelected.includes(rel(quickHit.path))),
      detail_blocks: [...s.collapsedBlocks].sort().join(" "), status_text: s.status,
    };
    const routeOpen = s.mode === "tour" && s.view === "route" && Boolean(s.route.dat);
    state["route.open"] = routeOpen;
    state["route.anchor"] = s.route.anchor;
    state["route.hop"] = s.route.hop;
    state["route.mode"] = s.route.dat ? s.route.mode : "";
    state["route.thread"] = s.route.thread;
    const marker = lesson.marker || {};
    state["marker.present"] = hits.some((h) => markerMatch(h, marker.match));
    state["marker.selected"] = markerMatch(sel, marker.match);
    state["marker.rendered"] = Boolean(marker.label && String(lesson.meaning || "").includes(marker.label));
    state.pin = cs.cs.Analysistarget || "";
    state.writes_unchanged = state.writes === (this.baseline.writes ?? state.writes);
    const display = cs.DataDisplayState();
    state["display.format"] = display.format;
    state["display.base"] = display.base;
    state["display.details"] = display.details;
    state["display.text"] = hit ? cs.dataAddress(hit) : "";
    state.network_selected = s.networkSelected.map((p) => abs(p)).join(" ");
    for (const def of cs.ui.CS_PARS || []) {
      if (def.style === "Pulse") continue;
      state[`cs.${def.name}`] = cs.cs[def.name] ?? "";
    }
    for (const name of ["Enabled", "Route", "Intensity", "Softness"]) state[`lab.${name}`] = lab.blPars[name];
    for (const rule of lesson.rules || []) {
      if (rule.key === "clipboard") state.clipboard = cs.clipboard;
      else if (rule.key.startsWith("cell:")) {
        const [path, row, col] = rule.key.slice(5).split("|");
        const data = rel(abs(path)) === 'SignalGarden/Palette/colors' ? lab.garden.table : rel(abs(path)) === "BranchLab/ColorEngine/palette" ? lab.palette : (cs.net.op(path) || {}).table || [];
        const header = data[0] || [];
        const r = data.find((x, i) => i > 0 && x[0] === row);
        const c = header.indexOf(col);
        state[rule.key] = r && c >= 0 ? r[c] : null;
      }
    }
    // tutorial_adapter.snapshot: InvestigationSnapshot + StateLab.Observe + view_state
    const inv = s.inv;
    Object.assign(state, {
      "investigation.view": s.view, "investigation.state_count": s.view === "states" || s.view === "untersuchung" ? stateAtlas(cs).filter((row) => row.kind !== "coverage").length : 0,
      "investigation.watch_count": inv.watchHistory.length, "investigation.watching": inv.watching, "investigation.watch_view": inv.watchView,
      "investigation.error": inv.error, "investigation.request_protocol_status": inv.request?.status || "",
      "investigation.revision": inv.packet?.revision || "", "investigation.preview_status": inv.preview?.status || "",
      "investigation.preview_violations": inv.preview?.violations.length || 0,
      "investigation.claim_status": inv.explanation?.claims.map((c) => c.status).join(" ") || "",
      "investigation.repro_observed_count": inv.repro?.observed?.count ?? -1,
      "investigation.case_id": inv.caseId || "", "investigation.case_count": inv.cases.length, "investigation.sample": inv.sample,
      "investigation.request_status": inv.request ? (inv.request.status === "ok" ? "answered" : inv.request.status) : "", "investigation.request_id": inv.request ? inv.request.id : "",
      "investigation.answer_count": inv.request ? inv.request.answers.length : 0,
      "investigation.comparison_id": inv.comparison ? inv.comparison.id : "", "investigation.compare_changed": inv.comparison ? inv.comparison.changed : 0,
      "investigation.explanation_id": inv.explanation ? inv.explanation.id : "", "investigation.claim_count": inv.explanation ? inv.explanation.claims.length : 0,
      "investigation.preview_id": inv.preview ? inv.preview.id : "", "investigation.preview_changes": inv.preview ? inv.preview.items.length : 0,
      "investigation.preview_source_unchanged": inv.preview ? inv.preview.sourceUnchanged : false,
      "investigation.visual_id": inv.visuals.length ? inv.visuals[inv.visuals.length - 1].id : "", "investigation.visual_count": inv.visuals.length,
      "investigation.repro_path": inv.repro ? inv.repro.path : "", "investigation.repro_verified": Boolean(inv.repro && inv.repro.verified),
      "investigation.lab.ready": true,
    });
    for (const [key, value] of Object.entries(lab.stateLab.Observe())) state[`investigation.lab.${key}`] = value;
    if (typeof cs.investigationSnapshot === 'function') {
      Object.assign(state, cs.investigationSnapshot());
      const packetKey = 'investigation.analysis_packet_id';
      state['investigation.analysis_packet_unchanged'] = Boolean(this.baseline[packetKey]) && state[packetKey] === this.baseline[packetKey];
    }
    for (const [key, value] of Object.entries(lab.garden.Observe())) state[`garden.${key}`] = value;
    state['workflow.investigation_view'] = s.view === 'untersuchung' ? 'investigation' : s.view;
    // DARIN zaehlt nur, solange die DARIN-Suche (Bereich = dieser COMP) zu sehen ist
    const darin = Boolean(s.contents && s.mode === 'search' && cs.cs.Scope === 'comp' && rel(cs.cs.Scopecomp || '') === s.contents.path);
    for (const [owner, pars] of Object.entries(lab.garden.pars)) for (const [name, value] of Object.entries(pars)) state[`garden.par.${owner}.${name}`] = value;
    Object.assign(state, {
      "cs.context": s.context,
      "cs.code_definition": Boolean(s.codeView.definition),
      "cs.code_view": `${s.codeView.path}:${s.codeView.focus}`,
      "cs.chain_index": s.chainReader.reader ? s.chainReader.index : -1,
      "cs.floats": s.floats.map((f) => f.title).join(" | "),
      "cs.float_count": s.floats.length,
      "cs.float_zoomed": s.floats.some((f) => f.zoom !== f.zoomStart),
      "cs.ui_scale": s.zoom,
      'workspace.search_count': 1+s.searchWindows.filter(q=>q.open).length,
      'workspace.search_queries': s.searchWindows.filter(q=>q.open).map(q=>q.query).join('\n'),
      'workspace.code_full': Boolean(s.codeFull),
      'workspace.code_zoom': s.codeZoom || 1,
      'workspace.flow_pinned': s.flow.pinned,
      'workspace.flow_target': s.flow.anchor || '',
      'workspace.flow_direction': s.flow.filters.direction,
      'workspace.flow_refresh': s.flow.generation,
      'workspace.secondary_pane': s.secondaryPane.open,
      'workspace.parent_value_exists': Object.hasOwn(lab.garden.pars.root,'Value'),
      'workspace.promotion_cancel_serial': cs.promotionCancelSerial || 0,
      'workspace.sensor_value_connected': cs.promotedBindings?.get('SignalGarden/Sensor:Value')?.parent==='SignalGarden' && Boolean(Object.getOwnPropertyDescriptor(lab.garden.pars.sensor,'Value')?.get),
      'workspace.scope_mode': cs.cs.Scope,
      'workspace.scope_depth': s.scopeDepth || 0,
      'workspace.network_follow': Boolean(s.networkFollow),
      'workspace.left_hidden': false,
      'workspace.right_hidden': false,
      'workspace.contents_comp': darin ? s.contents.path : '',
      'workspace.contents_family': darin ? s.contents.family : '',
      'workspace.module_target': s.moduleView ? s.moduleView.path : '',
      'workspace.module_external': s.moduleView ? s.moduleView.external : 0,
      'workspace.history_back': cs.historyBackCount || 0,
      'workspace.session_menu': cs.sessionMenuCount || 0,
      'workspace.search_overview': (s.mode === 'search' && !String(s.query || '').trim() && ['op', 'ext'].includes(cs.cs.Searchfilter)) ? cs.cs.Searchfilter : '',
      "flowlens.target": s.flowlens.target,
      "flowlens.colors": s.flowlens.colors,
      "flowlens.selected": s.flowlens.selected,
      "flowlens.selection_serial": s.flowlens.selectionSerial || 0,
      "flowlens.returned_selection": this.workplaceSelectionSerial > 0 && this.workplaceSelectionSerial === s.flowlens.selectionSerial,
    });
    return state;
  }

  check() {
    const lesson = this.lesson();
    const result = evaluate(lesson.rules, this.snapshot(), this.baseline);
    this.currentPassed = result.passed;
    if (result.passed) {
      const kind = lesson.observed ? "confirmed" : "verified";
      this.done[lesson.id] = kind;
      this.skipped.delete(lesson.id);
      this.feedback = kind === "confirmed"
        ? "VON DIR BESTÄTIGT. Diese Beobachtung wurde nicht automatisch gemessen. Weiter ist frei."
        : `ZUSTAND GEPRÜFT. ${lesson.expected} Weiter ist frei.`;
      this.save();
    } else {
      this.feedback = "NOCH OFFEN\n" + result.failures.slice(0, 3).join("\n");
    }
    return { id: lesson.id, passed: result.passed, missing: result.failures, results: result.results };
  }

  seen() {
    this.observed = true;
    this.feedback = "Als selbst gesehen markiert. „Prüfen“ bestätigt diese Sichtprüfung.";
  }

  toggleHint() { this.hint = !this.hint; }

  next() {
    if (!(this.lesson().id in this.done) || ((this.lesson().workflow_id || this.lesson().sequence_id) && !this.currentPassed)) {
      this.feedback = "Dieser Schritt ist noch offen. Erst Prüfen oder bewusst Überspringen.";
      return false;
    }
    this.goTo(this.step + 1);
    return true;
  }

  back() { this.goTo(this.step - 1); }

  skip() {
    this.skipped.add(this.lesson().id);
    this.goTo(this.step + 1);
  }

  goTo(index) {
    this.step = Math.max(0, Math.min(index, this.lessons.length - 1));
    this.prepare(true);
  }

  chapterStart(chapter) {
    const items = this.lessons.map((l, i) => [i, l]).filter(([, l]) => l.chapter === chapter);
    if (!items.length) return;
    const open = (items[0][1].workflow_id || items[0][1].sequence_id) ? items[0] : items.find(([, l]) => !(l.id in this.done));
    this.goTo((open || items[0])[0]);
  }

  progress() {
    const values = Object.values(this.done);
    return {
      verified: values.filter((v) => v === "verified").length,
      confirmed: values.filter((v) => v === "confirmed").length,
      open: this.lessons.length - Object.keys(this.done).length,
      total: this.lessons.length,
      skipped: this.skipped.size,
    };
  }

  save() {
    if (!this.storage) return;
    try {
      this.storage.setItem("codesearch-pocket-v2", JSON.stringify({ version: 3, lessonId: this.lesson().id, step: this.step, done: this.done, skipped: [...this.skipped] }));
    } catch { /* privater Modus: Fortschritt bleibt nur in dieser Sitzung */ }
  }

  load() {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem("codesearch-pocket-v2");
      if (raw) {
        const data = JSON.parse(raw);
        const known = new Set(this.lessons.map((l) => l.id));
        this.done = Object.fromEntries(Object.entries(data.done || {}).filter(([id, status]) => known.has(id) && ["verified", "confirmed"].includes(status)));
        this.skipped = new Set((data.skipped || []).filter((id) => known.has(id)));
        this.step = resolveProgressStep(data, this.lessons);
        if (this.lesson().workflow_id) this.step = this.lessons.findIndex((l) => l.workflow_id === this.lesson().workflow_id);
        if (this.lesson().sequence_id) this.step = this.lessons.findIndex((l) => l.sequence_id === this.lesson().sequence_id);
        return;
      }
      const old = this.storage.getItem("codesearch-pocket-v1");
      if (old) {
        const data = JSON.parse(old);
        const known = new Set(this.lessons.map((l) => l.id));
        this.done = Object.fromEntries(Object.keys(data.done || {}).filter((id) => known.has(id)).map((id) => [id, "verified"]));
        this.step = 0;
      }
    } catch { /* kaputter Speicher: neu anfangen */ }
  }
}

export { CODE_MODES };
