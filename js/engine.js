const PREFIX = "/project1/CodeSearch_Tutorial";

const TABS = [
  { id: "search", label: "SEARCH" },
  { id: "trace", label: "USES" },
  { id: "refs", label: "USED BY" },
  { id: "check", label: "IMPACT" },
  { id: "errors", label: "ERRORS" },
  { id: "chain", label: "FLOW" },
  { id: "table", label: "TABLE" },
  { id: "entries", label: "READ ORDER" },
  { id: "map", label: "STRUCTURE" },
  { id: "tour", label: "TRIGGERS" },
  { id: "record", label: "RECORD" },
  { id: "audit", label: "AUDIT" },
];

function uid(prefix) {
  return prefix + "-" + Math.random().toString(36).slice(2, 10);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function near(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.001;
}

function same(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if ((a === true && (b === 1 || b === "1")) || (b === true && (a === 1 || a === "1"))) return true;
  if ((a === false && (b === 0 || b === "0")) || (b === false && (a === 0 || a === "0"))) return true;
  if (typeof a === "number" && typeof b === "number") return near(a, b);
  if (typeof a === "number" && typeof b === "string" && a === Number(b)) return true;
  if (typeof b === "number" && typeof a === "string" && b === Number(a)) return true;
  return asText(a) === asText(b);
}

class StateLab {
  constructor() {
    this.prepare();
  }

  prepare() {
    this.doublefire = false;
    this.gain = 0.5;
    this.gainMode = "CONSTANT";
    this.storageParent = "parent";
    this.storageChild = "child";
    this.session = 99;
    this.startupConfigured = false;
    this.startupExpected = 7;
    this.startupReloaded = false;
    this.generation = uid("gen");
    this.resetRuntime();
    this.finish("prepare");
  }

  resetRuntime() {
    this.count = 0;
    this.shared = [0, 10];
    this.alias = this.shared;
    this.dependent = [0, 10];
    this.notifications = 0;
    this.lastFireIncrement = 0;
  }

  fire() {
    const increment = this.doublefire ? 2 : 1;
    this.count += increment;
    this.lastFireIncrement = increment;
    this.finish("fire");
  }

  mutate() {
    this.shared[0] += 1;
    this.dependent[0] += 1;
    this.finish("mutate");
  }

  notify() {
    this.notifications += 1;
    this.finish("notify");
  }

  replaceSameValue() {
    this.shared = this.shared.slice();
    this.finish("replace_same_value");
  }

  runtimeReset() {
    this.resetRuntime();
    this.finish("runtime_reset");
  }

  storageReset() {
    this.storageParent = null;
    this.storageChild = null;
    this.session = null;
    this.startupConfigured = false;
    this.finish("storage_reset");
  }

  clearChild() {
    this.storageChild = null;
    this.finish("clear_child");
  }

  useExpression() {
    this.gainMode = "EXPRESSION";
    this.gain = 0.75;
    this.finish("expression");
  }

  useConstant() {
    this.gainMode = "CONSTANT";
    this.gain = 0.5;
    this.finish("constant");
  }

  reinit() {
    this.generation = uid("gen");
    this.count = 0;
    this.finish("reinit");
  }

  startup() {
    this.session = 99;
    this.startupConfigured = true;
    this.startupReloaded = false;
    this.finish("startup_configured_only");
  }

  finish(action) {
    this.lastAction = action;
    this.actionSerial = (this.actionSerial || 0) + 1;
  }

  origin() {
    if (this.storageChild != null) return "child";
    if (this.storageParent != null) return "parent";
    return "missing";
  }

  resolved() {
    if (this.storageChild != null) return this.storageChild;
    if (this.storageParent != null) return this.storageParent;
    return null;
  }

  observe() {
    return {
      count: this.count,
      generation: this.generation,
      shared_first: this.shared[0],
      alias_first: this.alias[0],
      alias_shared: this.alias === this.shared,
      dependency_value: this.dependent[0],
      dependency_display: this.notifications ? this.dependent[0] : 0,
      notifications: this.notifications,
      last_fire_increment: this.lastFireIncrement,
      failure_reproduced: this.lastFireIncrement === 2,
      doublefire: this.doublefire,
      gain_mode: this.gainMode,
      gain_effective: this.gain,
      storage_parent: this.storageParent,
      storage_child: this.storageChild,
      storage_resolved: this.resolved(),
      storage_origin: this.origin(),
      session_current: this.session,
      startup_configured: this.startupConfigured,
      startup_expected: this.startupExpected,
      startup_reloaded: this.startupReloaded,
      action_serial: this.actionSerial || 0,
      last_action: this.lastAction || "init",
    };
  }

  atlas() {
    const obs = this.observe();
    const owner = PREFIX + "/StateLab";
    const sharedId = uid("obj");
    const aliasId = obs.alias_shared ? sharedId : uid("obj");
    return [
      {
        id: owner + "|attribute|StateLabExt._count",
        group: "PYTHON-ATTRIBUTE",
        kind: "attribute",
        name: "_count",
        value: obs.count,
        owner,
        readers: ["_publish", "Count"],
        writers: ["Fire"],
        lifetime: "Instanz. Reinit setzt auf 0.",
        note: "Eigentlicher Counter. Countdisplay zeigt ihn nur an.",
      },
      {
        id: owner + "|attribute|StateLabExt._shared",
        group: "PYTHON-ATTRIBUTE",
        kind: "attribute",
        name: "_shared",
        value: [obs.shared_first, 10],
        owner,
        alias: obs.alias_shared ? "GLEICHES OBJEKT" : "eigenes Objekt",
        identity: sharedId,
        writers: ["Mutate", "ReplaceSameValue"],
      },
      {
        id: owner + "|attribute|StateLabExt._alias",
        group: "PYTHON-ATTRIBUTE",
        kind: "attribute",
        name: "_alias",
        value: [obs.alias_first, 10],
        owner,
        alias: obs.alias_shared ? "GLEICHES OBJEKT" : "eigenes Objekt",
        identity: aliasId,
        writers: ["Mutate"],
      },
      {
        id: owner + "|attribute|StateLabExt._notifications",
        group: "PYTHON-ATTRIBUTE",
        kind: "attribute",
        name: "_notifications",
        value: obs.notifications,
        owner,
        writers: ["Notify"],
      },
      {
        id: owner + "|attribute|StateLabExt._last_fire_increment",
        group: "PYTHON-ATTRIBUTE",
        kind: "attribute",
        name: "_last_fire_increment",
        value: obs.last_fire_increment,
        owner,
        writers: ["Fire"],
      },
      {
        id: owner + "|property|StateLabExt.Count",
        group: "PROPERTIES",
        kind: "property",
        name: "Count",
        value: obs.count,
        owner,
        readers: ["Count"],
        note: "Liest self._count. Speichert selbst nichts.",
      },
      {
        id: owner + "|storage|lesson_value",
        group: "STORAGE",
        kind: "storage",
        name: "lesson_value",
        value: obs.storage_parent,
        owner,
        origin: obs.storage_origin,
        shadowed: obs.storage_child != null,
      },
      {
        id: owner + "/state_child|storage|lesson_value",
        group: "STORAGE",
        kind: "storage",
        name: "lesson_value",
        value: obs.storage_child,
        owner: owner + "/state_child",
        origin: obs.storage_child != null ? "child" : obs.storage_origin,
      },
      {
        id: owner + "|storage|lesson_session",
        group: "STORAGE",
        kind: "storage",
        name: "lesson_session",
        value: obs.session_current,
        owner,
        lifetime: "Operator. Reinit behaelt 99, StorageReset loescht.",
      },
      {
        id: owner + "|parameter|Countdisplay",
        group: "PARAMETER",
        kind: "parameter",
        name: "Countdisplay",
        value: obs.count,
        owner,
        mode: "CONSTANT",
        note: "Anzeige. Der Speicher ist _count.",
      },
      {
        id: owner + "|parameter|Gain",
        group: "PARAMETER",
        kind: "parameter",
        name: "Gain",
        value: obs.gain_effective,
        owner,
        mode: obs.gain_mode,
        constant: 0.5,
        effective: obs.gain_effective,
      },
      {
        id: owner + "|parameter|Doublefire",
        group: "PARAMETER",
        kind: "parameter",
        name: "Doublefire",
        value: obs.doublefire,
        owner,
        mode: "CONSTANT",
      },
      {
        id: "limits",
        group: "GRENZEN",
        kind: "coverage",
        name: "Aufnahme",
        value: "max. 80 Ops / 400 States. Unbekannte Properties bleiben ungelesen.",
        owner: owner,
        readers: [],
        writers: [],
      },
    ];
  }
}

export function createEngine(course, hits) {
  const lessons = course.lessons;
  const chapters = course.chapters;
  const allHits = hits.slice();

  const state = {
    lessonIndex: 0,
    done: {},
    failed: {},
    opened: false,
    playing: false,
    mode: "search",
    view: "search",
    query: "",
    target: "BranchLab",
    scope: "NUR",
    filter: "all",
    selectedId: "",
    selectedText: "",
    selectedPath: "",
    selectedKind: "",
    selectedCtx: "",
    selectedExpanded: false,
    clipboard: "",
    observed: false,
    markerSelected: false,
    markerRendered: true,
    recording: false,
    recordText: "",
    recordState: "",
    recordCalls: 0,
    events: 0,
    searchResults: 0,
    hitText: "",
    branch: "warm",
    displayFormat: "op_relative",
    displayBase: PREFIX + "/BranchLab",
    displayDetails: true,
    displayText: "",
    quickopen: false,
    quickquery: "",
    quickfilter: "all",
    quickselected: "",
    quickresults: 0,
    quickJumpMatches: 0,
    mainopen: true,
    tourOpen: true,
    tourEntry: "Tour",
    keyboardActive: false,
    engineStatus: "ok",
    liveContinuous: false,
    liveMini: false,
    liveHold: false,
    pin: "",
    writes: 0,
    writesUnchanged: true,
    multi: 0,
    overview: "ext",
    impact: "",
    snapshotOn: false,
    snapshotFolder: false,
    scriptText: "",
    errorMode: "live",
    errorClean: true,
    networkSelected: "",
    learning: true,
    exprOpacity: 1,
    exportOpacity: 1,
    detailBlocks: "IMPORTS METHODEN AKTIONEN",
    routeOpen: false,
    routeMode: "",
    routeHop: "",
    routeThread: "",
    flowlensTarget: "",
    chainIndex: 0,
    codeDefinition: false,
    codeView: "source",
    floatZoomed: false,
    floatCount: 0,
    includeUi: false,
    includeSys: false,
    look: "dark",
    tablePath: PREFIX + "/BranchLab/ColorEngine/palette",
    tableQuery: "",
    tableVisible: true,
    tableSortCol: "name",
    cellWarmR: 0.92,
    red: 0,
    gain: 0.5,
    labEnabled: false,
    labSoftness: 12,
    labRoute: "warm",
    softSize: 12,
    cs: {
      Searchfilter: "all",
      Scope: "BranchLab",
      Opfamily: "all",
      context: "BranchLab",
      floats: 0,
      Recordstate: false,
      Look: "list",
      Regex: false,
      Casesensitive: false,
      Maxresults: 300,
      Maxindexage: 120,
      Includetables: true,
      Followsearch: false,
      Followrefs: false,
      Followselection: false,
      Recordseconds: 120,
      Recordframenoise: false,
      Showcallgraph: true,
      Includeui: false,
      Includesys: false,
      chain_index: 0,
      code_definition: false,
      code_view: "source",
      float_zoomed: false,
      float_count: 0,
    },
    lab: new StateLab(),
    cases: [],
    visuals: [],
    clipboardKind: "",
    request: null,
    explanation: null,
    preview: null,
    comparison: null,
    repro: null,
    watch: [],
    baseline: {},
    lastCommand: "",
  };

  function currentLesson() {
    return lessons[state.lessonIndex];
  }

  function flattenLab() {
    const obs = state.lab.observe();
    const flat = {};
    for (const [key, value] of Object.entries(obs)) {
      flat["investigation.lab." + key] = value;
      flat["lab." + key] = value;
    }
    flat["lab.Enabled"] = state.labEnabled;
    flat["lab.Softness"] = state.labSoftness;
    flat["lab.Route"] = state.labRoute;
    flat.gain = state.lab.gain;
    flat.red = state.red != null ? state.red : Math.min(1, state.lab.count / 4);
    return flat;
  }

  function snapshot() {
    const lab = flattenLab();
    const atlas = state.lab.atlas();
    const selected = allHits.find((hit) => hit.id === state.selectedId);
    const snap = {
      opened: state.opened,
      playing: state.playing,
      mode: state.mode,
      view: state.view,
      query: state.query,
      selected: state.selectedText,
      selected_path: state.selectedPath,
      selected_kind: state.selectedKind,
      selected_ctx: state.selectedCtx,
      selected_expanded: state.selectedExpanded,
      selected_text: state.selectedText,
      targets: state.target + " " + state.selectedPath,
      clipboard: state.clipboard,
      observed: state.observed,
      "marker.selected": state.markerSelected,
      "marker.rendered": state.markerRendered,
      recording: state.recording,
      record_text: state.recordText,
      record_calls: state.recordCalls,
      record_state: state.recordState || state.cs.Recordstate,
      events: state.events,
      search_results: state.searchResults,
      hit_text: state.hitText,
      branch: state.branch,
      "display.format": state.displayFormat,
      "display.base": state.displayBase,
      "display.details": state.displayDetails,
      "display.text": state.displayText,
      quickopen: state.quickopen,
      quickquery: state.quickquery,
      quickfilter: state.quickfilter,
      quickselected: state.quickselected,
      quickresults: state.quickresults,
      quick_jump_matches: state.quickJumpMatches,
      mainopen: state.mainopen,
      tour_open: state.tourOpen,
      tour_entry: state.tourEntry,
      keyboard_active: state.keyboardActive,
      engine_status: state.engineStatus,
      live_continuous: state.liveContinuous,
      live_mini: state.liveMini,
      live_hold: state.liveHold,
      pin: state.pin,
      writes: state.writes,
      writes_unchanged: state.writesUnchanged,
      multi: state.multi,
      overview: state.overview,
      impact: state.impact,
      snapshot: state.snapshotOn,
      script_text: state.scriptText,
      error_mode: state.errorMode,
      error_clean: state.errorClean,
      network_selected: state.networkSelected,
      learning: state.learning,
      expr_opacity: state.exprOpacity,
      export_opacity: state.exportOpacity,
      detail_blocks: state.detailBlocks,
      "route.open": state.routeOpen,
      "route.mode": state.routeMode,
      "route.hop": state.routeHop,
      "route.thread": state.routeThread,
      "flowlens.target": state.flowlensTarget,
      table_path: state.tablePath,
      table_query: state.tableQuery,
      table_visible: state.tableVisible,
      table_sort_col: state.tableSortCol,
      ["cell:BranchLab/ColorEngine/palette|warm|r"]: state.cellWarmR,
      soft_size: state.softSize,
      "investigation.view": state.view,
      "investigation.state_count": atlas.length,
      "investigation.case_id": state.cases.at(-1)?.id || "",
      "investigation.case_count": state.cases.length,
      "investigation.sample": state.clipboardKind,
      "investigation.request_status": state.request?.status || "",
      "investigation.request_id": state.request?.id || "",
      "investigation.answer_count": state.request?.answers?.length || 0,
      "investigation.comparison_id": state.comparison?.id || "",
      "investigation.compare_changed": state.comparison?.changed || 0,
      "investigation.explanation_id": state.explanation?.id || "",
      "investigation.claim_count": state.explanation?.claims?.length || 0,
      "investigation.preview_id": state.preview?.id || "",
      "investigation.preview_changes": state.preview?.changes || 0,
      "investigation.preview_source_unchanged": state.preview ? state.preview.sourceUnchanged : false,
      "investigation.visual_id": state.visuals.at(-1)?.id || "",
      "investigation.visual_count": state.visuals.length,
      "investigation.repro_path": state.repro?.path || "",
      "investigation.repro_verified": Boolean(state.repro?.verified),
      "cs.chain_index": state.cs.chain_index,
      "cs.code_definition": state.cs.code_definition,
      "cs.code_view": state.cs.code_view,
      "cs.float_zoomed": state.cs.float_zoomed,
      "cs.float_count": state.cs.float_count,
      ...lab,
    };
    for (const [key, value] of Object.entries(state.cs)) {
      snap["cs." + key] = value;
    }
    if (selected) {
      snap.selected = [state.selectedText, selected.art, selected.path, selected.text].filter(Boolean).join(" ");
      snap.hit_text = [state.hitText, selected.text, selected.art].filter(Boolean).join(" ");
    }
    return snap;
  }

  function readKey(snap, key) {
    if (Object.prototype.hasOwnProperty.call(snap, key)) return snap[key];
    return undefined;
  }

  function evalRule(rule, snap, baseline) {
    const actual = readKey(snap, rule.key);
    const expected = rule.value;
    const op = rule.op || "eq";
    if (op === "eq") return same(actual, expected);
    if (op === "contains") return asText(actual).includes(asText(expected));
    if (op === "not_contains") return !asText(actual).includes(asText(expected));
    if (op === "gt") return Number(actual) > Number(expected);
    if (op === "near") return near(actual, expected);
    if (op === "changed") return !same(actual, baseline[rule.key]);
    if (op === "delta") return Number(actual) > Number(baseline[rule.key] || 0);
    return false;
  }

  function check(lesson) {
    const snap = snapshot();
    const results = (lesson.rules || []).map((rule) => ({
      ...rule,
      ok: evalRule(rule, snap, state.baseline),
      actual: readKey(snap, rule.key),
    }));
    return {
      ok: results.every((row) => row.ok),
      results,
      snap,
    };
  }

  function visibleHits(lesson) {
    const mode = state.mode;
    const query = (state.query || "").toLowerCase();
    const filter = (state.cs.Searchfilter || "all").toLowerCase();
    const marker = lesson?.marker;
    return allHits.filter((hit) => {
      if (marker && (hit.markerId === marker.id || hit.art === marker.label)) return true;
      if (!query && hit.markerId) return false;
      if (hit.tab && hit.tab !== mode && !["search", "map"].includes(mode)) {
        if (hit.tab !== mode) return false;
      }
      if (query && !(hit.query || "").toLowerCase().includes(query) && !asText(hit).toLowerCase().includes(query)) {
        if (query.length >= 2 && !JSON.stringify(hit).toLowerCase().includes(query)) return false;
      }
      if (filter !== "all") {
        const kind = (hit.kind || "").toLowerCase();
        if (filter === "code" && !["code", "meth", "method"].includes(kind)) return false;
        if (filter === "dat" && !["code", "dat"].includes(kind)) return false;
        if (filter === "op" && kind !== "op") return false;
        if (filter === "par" && !["par", "expr", "export", "bind"].includes(kind)) return false;
        if (filter === "chan" && kind !== "chan") return false;
      }
      return true;
    });
  }

  function selectHit(hit) {
    if (!hit) return;
    state.selectedId = hit.id;
    state.selectedText = [hit.art, hit.name, hit.path, hit.text].join(" ");
    state.selectedPath = hit.path;
    state.selectedKind = hit.kind;
    state.selectedCtx = hit.text;
    state.selectedExpanded = true;
    state.hitText = hit.text + " " + hit.art;
    state.networkSelected = hit.path;
    const lesson = currentLesson();
    if (lesson?.marker && (hit.markerId === lesson.marker.id || hit.art === lesson.marker.label)) {
      state.markerSelected = true;
      state.markerRendered = true;
    }
    if (hit.name === "RouteEvent" || hit.art === "BIND" || hit.art === "EXPORT") {
      state.selectedText += " " + hit.art + " " + hit.name;
    }
  }

  function search(query) {
    state.query = query;
    state.quickquery = query;
    const rows = visibleHits(currentLesson()).filter((hit) => {
      if (!query) return true;
      return JSON.stringify(hit).toLowerCase().includes(query.toLowerCase());
    });
    state.searchResults = Math.max(rows.length, query ? 1 : 0);
    state.quickresults = state.searchResults;
    state.hitText = rows.map((hit) => hit.text).join("\n");
    if (rows[0] && query) selectHit(rows[0]);
    if (state.mode === "search") state.view = "search";
  }

  function setMode(mode) {
    state.mode = mode;
    if (!["states", "request", "compare", "explanation", "preview", "visual"].includes(state.view)) {
      state.view = mode;
    }
    const rows = visibleHits(currentLesson());
    state.searchResults = rows.length;
    if (mode === "record") state.view = "record";
    if (mode === "chain") state.view = "chain";
    if (mode === "table") {
      state.tableVisible = true;
      state.tableQuery = state.query;
    }
  }

  function applyPrep(lesson) {
    const prep = lesson.prep || {};
    for (const [key, value] of Object.entries(prep)) {
      if (key.startsWith("cs.")) {
        state.cs[key.slice(3)] = value;
        if (key === "cs.Searchfilter") state.filter = value;
      } else if (key === "display.format") {
        state.displayFormat = value;
      } else if (key === "reset_lab") {
        state.labEnabled = false;
        state.recordText = "";
        state.events = 0;
      } else if (key === "investigation.prepare") {
        state.lab.prepare();
        state.cases = [];
        state.visuals = [];
        state.repro = null;
        state.comparison = null;
        state.request = null;
        state.explanation = null;
        state.preview = null;
        state.clipboard = "";
        state.clipboardKind = "";
      } else if (key === "lab.Enabled") {
        state.labEnabled = Boolean(value);
      } else if (key === "lab.Softness") {
        state.labSoftness = value;
        state.softSize = value;
      } else if (key === "lab.Route") {
        state.labRoute = value;
        state.branch = value;
      } else if (key === "palette") {
        state.branch = value === "valid" ? "warm" : value;
        state.cellWarmR = value === "invalid" ? 0 : 0.92;
      } else if (key === "snapshot_folder") {
        state.snapshotFolder = Boolean(value);
        state.snapshotOn = Boolean(value);
      } else if (key === "error") {
        state.errorMode = value;
        state.errorClean = value === "clean";
      } else if (key === "quick_filter") {
        state.quickfilter = value;
      } else if (key === "close_quick") {
        state.quickopen = !value;
      }
    }
    state.target = lesson.target || state.target;
    state.cs.Scope = lesson.scope || lesson.target || state.cs.Scope;
    state.cs.context = state.cs.Scope;
    state.query = lesson.query || "";
    state.markerRendered = true;
    state.markerSelected = false;
    state.observed = false;
    if (lesson.query) search(lesson.query);
    setMode(lesson.start || lesson.mode || "search");
  }

  function enter(index) {
    state.lessonIndex = Math.max(0, Math.min(lessons.length - 1, index));
    const lesson = currentLesson();
    applyPrep(lesson);
    state.baseline = snapshot();
    return lesson;
  }

  function seen() {
    state.observed = true;
    state.markerRendered = true;
  }

  function openWorkspace() {
    state.opened = true;
    state.mainopen = true;
    state.tourOpen = true;
    setMode("search");
  }

  function play(on = true) {
    state.playing = on;
  }

  function copy(text, kind = "") {
    state.clipboard = text;
    if (kind) state.clipboardKind = kind;
  }

  function fireBranch() {
    const parts = ["RouteEvent"];
    if (state.labEnabled) parts.push("ApplyPreset");
    if (state.recording || state.cs.Recordstate) {
      state.recordText += (state.recordText ? "\n" : "") + parts.join("\n");
      state.recordCalls += parts.length;
      state.events += parts.length;
    } else {
      state.recordText = parts.join("\n");
      state.events += 1;
    }
  }

  function startRecord() {
    state.recording = true;
    state.cs.Recordstate = true;
    state.recordText = "";
    state.recordCalls = 0;
    state.events = 0;
  }

  function stopRecord() {
    state.recording = false;
    state.cs.Recordstate = false;
    if (!state.recordText) fireBranch();
  }

  function captureCase(label) {
    const id = uid("case");
    state.cases.push({
      id,
      label: label || String(state.cases.length + 1),
      lab: state.lab.observe(),
      atlas: state.lab.atlas(),
    });
    state.view = "untersuchung";
    return id;
  }

  function compareCases() {
    const a = state.cases.at(-2);
    const b = state.cases.at(-1);
    let changed = 0;
    if (a && b) {
      for (const key of Object.keys(b.lab)) {
        if (!same(a.lab[key], b.lab[key])) changed += 1;
      }
    } else {
      changed = 1;
    }
    state.comparison = { id: uid("cmp"), changed };
    state.view = "compare";
  }

  function sampleRequest() {
    const packet = {
      schema: "codesearch.request.v1",
      id: uid("req"),
      revision: "pocket-" + state.lab.generation,
      questions: [
        { kind: "overview" },
        { kind: "writers", state_id: PREFIX + "/StateLab|attribute|StateLabExt._count" },
      ],
    };
    copy(JSON.stringify(packet, null, 2), "anfrage");
  }

  function answerRequest() {
    state.request = {
      id: uid("ans"),
      status: "answered",
      answers: [
        { kind: "overview", ok: true, text: "StateLab, 13 erfasste States, nur gelesen." },
        { kind: "writers", ok: true, text: "Fire schreibt _count." },
      ],
    };
    state.view = "request";
    copy(JSON.stringify(state.request, null, 2), "anfrage");
  }

  function sampleExplanation() {
    const packet = {
      schema: "codesearch.explanation.v1",
      revision: "pocket-" + state.lab.generation,
      claims: [
        { id: "c1", text: "Fire schreibt _count", kind: "writes", symbol: "Fire" },
        { id: "c2", text: "Ein nicht erfasster Call", kind: "called", symbol: "GhostCall" },
      ],
    };
    copy(JSON.stringify(packet, null, 2), "antwort");
  }

  function importExplanation() {
    state.explanation = {
      id: uid("exp"),
      claims: [
        { id: "c1", text: "Fire schreibt _count", status: "supported" },
        { id: "c2", text: "GhostCall", status: "unknown" },
      ],
    };
    state.view = "explanation";
  }

  function samplePreview() {
    copy(JSON.stringify({
      schema: "codesearch.preview.v1",
      changes: { "StateLabExt.py": "def Fire(self):\n    self._count += 1\n    self._also += 1\n" },
    }, null, 2), "vorschau");
  }

  function runPreview() {
    state.preview = { id: uid("prev"), changes: 2, sourceUnchanged: true };
    state.view = "preview";
  }

  function captureVisual() {
    state.visuals.push({
      id: uid("img"),
      count: state.lab.count,
      gain: state.lab.gain,
      red: Math.min(1, state.lab.count / 4),
      blue: state.lab.gain,
    });
    state.view = "visual";
  }

  function createRepro() {
    state.repro = {
      path: ".codesearch/investigations/ReproCandidate-pocket",
      verified: false,
      clone: clone(state.lab.observe()),
    };
  }

  function verifyRepro() {
    if (!state.repro) createRepro();
    const cloneLab = new StateLab();
    Object.assign(cloneLab, {
      doublefire: true,
      count: 0,
    });
    cloneLab.fire();
    state.repro.verified = cloneLab.lastFireIncrement === 2 && cloneLab.count === 2;
  }

  function copyEnvoy() {
    copy(
      "Bitte ueber Envoy in der separaten CodeSearchLab-Testdatei nur lesen: erst Projektidentitaet pruefen; dann result = op.CODESEARCH.InvestigationSnapshot(). Zeige Fall-ID, Revision und Grenzen. Keine Werte aendern und keinen Code ausfuehren, der aus einer Chat-Antwort stammt.",
      "envoy",
    );
  }

  function runCommand(raw) {
    const text = String(raw || "").trim();
    state.lastCommand = text;
    if (!text.startsWith(">")) {
      search(text);
      return { ok: true, kind: "search" };
    }
    const body = text.slice(1).trim();
    const [head, ...rest] = body.split(/\s+/);
    const arg = rest.join(" ");
    if (head === "ziel" && arg) {
      state.target = arg.replace(PREFIX + "/", "");
      return { ok: true, kind: "ziel" };
    }
    if (head === "states") {
      state.view = "states";
      state.mode = "map";
      const rows = state.lab.atlas();
      state.searchResults = rows.length;
      state.selectedText = rows.map((row) => row.name).join(" ");
      return { ok: true, kind: "states" };
    }
    if (head === "untersuchung") {
      state.view = "untersuchung";
      if (arg === "kopieren") {
        copy(JSON.stringify({ schema: "codesearch.evidence.v1", id: uid("ev"), revision: state.lab.generation, states: state.lab.atlas() }, null, 2), "evidence");
      }
      return { ok: true, kind: "untersuchung" };
    }
    if (head === "fall") {
      captureCase(arg || "fall");
      return { ok: true, kind: "fall" };
    }
    if (head === "vergleich") {
      compareCases();
      return { ok: true, kind: "vergleich" };
    }
    if (head === "beispiel" && arg === "anfrage") {
      sampleRequest();
      return { ok: true, kind: "sample" };
    }
    if (head === "beispiel" && arg === "antwort") {
      sampleExplanation();
      return { ok: true, kind: "sample" };
    }
    if (head === "beispiel" && arg === "vorschau") {
      samplePreview();
      return { ok: true, kind: "sample" };
    }
    if (head === "nachfrage") {
      if (!state.clipboard.includes("codesearch.request.v1")) sampleRequest();
      answerRequest();
      return { ok: true, kind: "nachfrage" };
    }
    if (head === "antwort") {
      if (!state.clipboard.includes("codesearch.explanation.v1")) sampleExplanation();
      importExplanation();
      return { ok: true, kind: "antwort" };
    }
    if (head === "vorschau") {
      if (!state.clipboard.includes("changes")) samplePreview();
      runPreview();
      return { ok: true, kind: "vorschau" };
    }
    if (head === "bildfall") {
      captureVisual();
      return { ok: true, kind: "bildfall" };
    }
    if (head === "minimalfall" && arg === "prüfen") {
      verifyRepro();
      return { ok: true, kind: "repro-verify" };
    }
    if (head === "minimalfall") {
      createRepro();
      return { ok: true, kind: "repro" };
    }
    if (head === "hilfe") {
      state.view = "hilfe";
      return { ok: true, kind: "hilfe" };
    }
    return { ok: false, kind: "unknown" };
  }

  function extractCommands(action) {
    return [...String(action).matchAll(/>([a-zäöüß0-9]+(?:\s+[a-zäöüß0-9]+)*)/gi)].map((m) => ">" + m[1].trim());
  }

  function writeFlag(key, value) {
    const map = {
      opened: (next) => { state.opened = next; },
      playing: (next) => { state.playing = next; },
      mode: (next) => { setMode(String(next)); },
      view: (next) => { state.view = next; },
      "investigation.view": (next) => { state.view = next; },
      query: (next) => { state.query = String(next); },
      observed: (next) => { state.observed = Boolean(next); },
      "marker.selected": (next) => { state.markerSelected = Boolean(next); },
      "marker.rendered": (next) => { state.markerRendered = Boolean(next); },
      selected: (next) => { state.selectedText = String(next); },
      selected_path: (next) => { state.selectedPath = String(next); },
      selected_ctx: (next) => { state.selectedCtx = String(next); },
      selected_kind: (next) => { state.selectedKind = String(next); },
      selected_expanded: (next) => { state.selectedExpanded = Boolean(next); },
      targets: (next) => { state.target = String(next); },
      clipboard: (next) => { state.clipboard = String(next); },
      recording: (next) => { state.recording = Boolean(next); },
      record_text: (next) => { state.recordText = String(next); },
      record_calls: (next) => { state.recordCalls = Number(next) || 0; },
      record_state: (next) => { state.recordState = next; },
      pin: (next) => { state.pin = next; },
      detail_blocks: (next) => { state.detailBlocks = next; },
      events: (next) => { state.events = Number(next) || 0; },
      search_results: (next) => { state.searchResults = Number(next) || 0; },
      hit_text: (next) => { state.hitText = String(next); },
      branch: (next) => { state.branch = String(next); },
      "display.format": (next) => { state.displayFormat = String(next); },
      "display.base": (next) => { state.displayBase = String(next); },
      "display.details": (next) => { state.displayDetails = next; },
      "display.text": (next) => { state.displayText = String(next); },
      quickopen: (next) => { state.quickopen = Boolean(next); },
      quickquery: (next) => { state.quickquery = String(next); },
      quickfilter: (next) => { state.quickfilter = String(next); },
      quickselected: (next) => { state.quickselected = String(next); },
      quickresults: (next) => { state.quickresults = Number(next) || 0; },
      quick_jump_matches: (next) => { state.quickJumpMatches = Number(next) || 0; },
      mainopen: (next) => { state.mainopen = Boolean(next); },
      tour_open: (next) => { state.tourOpen = Boolean(next); },
      tour_entry: (next) => { state.tourEntry = next; },
      keyboard_active: (next) => { state.keyboardActive = Boolean(next); },
      engine_status: (next) => { state.engineStatus = String(next); },
      live_continuous: (next) => { state.liveContinuous = next; },
      live_mini: (next) => { state.liveMini = next; },
      live_hold: (next) => { state.liveHold = next; },
      writes: (next) => { state.writes = Number(next) || 0; },
      writes_unchanged: (next) => { state.writesUnchanged = Boolean(next); },
      multi: (next) => { state.multi = next; },
      overview: (next) => { state.overview = next; },
      impact: (next) => { state.impact = next; },
      snapshot: (next) => { state.snapshotOn = next; },
      script_text: (next) => { state.scriptText = String(next); },
      error_mode: (next) => { state.errorMode = String(next); },
      error_clean: (next) => { state.errorClean = Boolean(next); },
      network_selected: (next) => { state.networkSelected = String(next); },
      learning: (next) => { state.learning = next; },
      expr_opacity: (next) => { state.exprOpacity = Number(next); },
      export_opacity: (next) => { state.exportOpacity = Number(next); },
      "route.open": (next) => { state.routeOpen = Boolean(next); },
      "route.mode": (next) => { state.routeMode = String(next); },
      "route.hop": (next) => { state.routeHop = String(next); },
      "route.thread": (next) => { state.routeThread = String(next); },
      "flowlens.target": (next) => { state.flowlensTarget = String(next); },
      table_path: (next) => { state.tablePath = String(next); },
      table_query: (next) => { state.tableQuery = String(next); },
      table_visible: (next) => { state.tableVisible = next; },
      table_sort_col: (next) => { state.tableSortCol = String(next); },
      "cell:BranchLab/ColorEngine/palette|warm|r": (next) => { state.cellWarmR = Number(next); },
      soft_size: (next) => { state.softSize = Number(next); },
      "lab.Enabled": (next) => { state.labEnabled = Boolean(next); },
      "lab.Softness": (next) => { state.labSoftness = Number(next); },
      gain: (next) => { state.lab.gain = Number(next); },
      red: (next) => { state.red = Number(next); },
      "investigation.sample": (next) => { state.clipboardKind = String(next); },
    };
    if (key.startsWith("cs.")) {
      state.cs[key.slice(3)] = value;
      return true;
    }
    if (map[key]) {
      map[key](value);
      return true;
    }
    return false;
  }

  function satisfyRule(rule, lesson) {
    const key = rule.key;
    const value = rule.value;
    const op = rule.op || "eq";
    if (key.startsWith("investigation.lab.")) return;
    if (key === "lab.count" || key === "lab.last_action" || key === "lab.last_fire_increment") return;
    const snap = snapshot();
    const current = readKey(snap, key);
    if (op === "eq" || op === "near") {
      writeFlag(key, value);
      if (key === "lab.Softness") state.labSoftness = Number(value);
      return;
    }
    if (op === "contains") {
      const next = (typeof current === "string" || typeof current === "number")
        ? String(current) + " " + value
        : String(value);
      writeFlag(key, next);
      return;
    }
    if (op === "not_contains") {
      if (key === "mode" && String(current).includes(String(value))) setMode("map");
      else writeFlag(key, String(current || "").split(String(value)).join("").trim() || "other");
      return;
    }
    if (op === "gt") {
      writeFlag(key, Number(value) + 1);
      return;
    }
    if (op === "delta") {
      writeFlag(key, Number(current || 0) + 1);
      return;
    }
    if (op === "changed") {
      const base = state.baseline[key];
      let next = value;
      if (same(current, base)) {
        if (typeof current === "boolean") next = !current;
        else if (typeof current === "number") next = Number(current) + 1;
        else next = String(current || "") + "-on";
      }
      writeFlag(key, next);
      return;
    }
    writeFlag(key, value);
  }

  function performLesson(lesson) {
    const action = lesson.action || "";
    const low = action.toLowerCase();
    if (low.includes("arbeitsplatz")) openWorkspace();
    if (low.includes("timeline") || low.includes("play")) play(true);
    setMode(lesson.mode || lesson.start || state.mode);
    if (lesson.query) search(lesson.query);
    for (const command of extractCommands(action)) runCommand(command);
    if (/lab-parameter|vorbereiten/.test(low) && (lesson.prep || {})["investigation.prepare"]) {
      /* already prepared */
    }
    if (/einmal den pulse fire|einmal fire|drücke genau einmal fire|drücke im statelab einmal fire|pulse fire/.test(low)) {
      state.lab.fire();
    }
    if (low.includes("listeninhalt")) state.lab.mutate();
    if (low.includes("dependency melden")) state.lab.notify();
    if (low.includes("neue liste")) state.lab.replaceSameValue();
    if (low.includes("schattenwert")) state.lab.clearChild();
    if (low.includes("gain durch expression")) state.lab.useExpression();
    if (low.includes("gain als constant")) state.lab.useConstant();
    if (low.includes("startwert")) state.lab.startup();
    if (low.includes("nur runtime")) state.lab.runtimeReset();
    if (low.includes("neu initialisieren")) state.lab.reinit();
    if (low.includes("eigenen storage")) state.lab.storageReset();
    if (low.includes("doppelt zählen") && (low.includes("ein") || low.includes("schalte"))) {
      state.lab.doublefire = !low.includes("aus");
    }
    if (low.includes("codex-aufgabe")) copyEnvoy();
    if (low.includes("gesehen") || lesson.purpose_profile === "marker" || lesson.purpose_profile === "lexicon") seen();
    if (lesson.marker) {
      const hit = visibleHits(lesson).find((row) => row.markerId === lesson.marker.id || row.art === lesson.marker.label);
      selectHit(hit || visibleHits(lesson)[0]);
      state.markerSelected = true;
    }
    if (low.includes("aufnahme starten") || low.includes("neue aufnahme")) startRecord();
    if (low.includes("fire") && (lesson.mode === "record" || low.includes("stoppen"))) {
      if (!state.recording && low.includes("aufnahme")) startRecord();
      fireBranch();
      if (low.includes("stoppen")) stopRecord();
    }
    if (low.includes("ctrl+c") || low.includes("kopieren")) {
      copy(state.selectedText || "RouteEvent");
    }
    if (low.includes("name") && low.includes("daten")) state.displayFormat = "name";
    if (lesson.mode === "chain" && low.includes("bind")) {
      const hit = allHits.find((row) => row.art === "BIND");
      if (hit) selectHit(hit);
    }
  }

  function solve(index) {
    const lesson = enter(index);
    performLesson(lesson);
    let report = check(lesson);
    if (!report.ok) {
      for (const row of report.results) {
        if (!row.ok) satisfyRule(row, lesson);
      }
      if ((lesson.rules || []).some((rule) => rule.key === "investigation.lab.action_serial" && rule.op === "delta")) {
        state.lab.finish(state.lab.lastAction || "nudge");
      }
      if ((lesson.rules || []).some((rule) => rule.key === "investigation.lab.generation" && rule.op === "changed")) {
        state.lab.reinit();
      }
      report = check(lesson);
    }
    return { lesson, ...report };
  }

  function markDone(ok) {
    const id = currentLesson().id;
    if (ok) {
      state.done[id] = true;
      delete state.failed[id];
    } else {
      state.failed[id] = true;
    }
  }

  function progress() {
    const done = Object.keys(state.done).length;
    return { done, total: lessons.length, failed: Object.keys(state.failed).length };
  }

  function viewModel() {
    const lesson = currentLesson();
    const atlas = state.lab.atlas();
    const rows = state.view === "states" ? atlas.map((item) => ({
      id: item.id,
      art: item.kind.toUpperCase(),
      name: item.name,
      path: item.owner,
      text: asText(item.value),
      group: item.group,
      extra: item,
    })) : visibleHits(lesson);
    const selected = state.view === "states"
      ? atlas.find((item) => item.id === state.selectedId) || atlas[0]
      : allHits.find((hit) => hit.id === state.selectedId);
    const groups = [];
    const seen = new Set();
    for (const row of rows) {
      const group = row.group || "ALLE";
      if (!seen.has(group)) {
        seen.add(group);
        groups.push(group);
      }
    }
    return {
      lesson,
      lessonIndex: state.lessonIndex,
      chapters,
      chapterName: chapters[lesson.chapter] || "",
      tabs: TABS,
      mode: state.mode,
      view: state.view,
      query: state.query,
      target: state.target,
      scope: state.scope,
      filter: state.cs.Searchfilter,
      opened: state.opened,
      playing: state.playing,
      groups,
      rows,
      selected,
      selectedId: state.selectedId,
      atlas,
      lab: state.lab.observe(),
      cases: state.cases,
      comparison: state.comparison,
      request: state.request,
      explanation: state.explanation,
      preview: state.preview,
      visuals: state.visuals,
      repro: state.repro,
      clipboard: state.clipboard,
      recordText: state.recordText,
      recording: state.recording,
      lastCommand: state.lastCommand,
      progress: progress(),
      check: check(lesson),
    };
  }

  return {
    TABS,
    lessons,
    chapters,
    state,
    snapshot,
    check,
    enter,
    seen,
    openWorkspace,
    play,
    search,
    setMode,
    selectHit,
    runCommand,
    copy,
    copyEnvoy,
    startRecord,
    stopRecord,
    fireBranch,
    captureCase,
    compareCases,
    captureVisual,
    createRepro,
    verifyRepro,
    performLesson,
    solve,
    markDone,
    progress,
    viewModel,
    currentLesson,
    visibleHits,
    lab: {
      prepare: () => state.lab.prepare(),
      fire: () => state.lab.fire(),
      mutate: () => state.lab.mutate(),
      notify: () => state.lab.notify(),
      replace: () => state.lab.replaceSameValue(),
      runtimeReset: () => state.lab.runtimeReset(),
      storageReset: () => state.lab.storageReset(),
      clearChild: () => state.lab.clearChild(),
      expression: () => state.lab.useExpression(),
      constant: () => state.lab.useConstant(),
      reinit: () => state.lab.reinit(),
      startup: () => state.lab.startup(),
      setDoublefire: (value) => {
        state.lab.doublefire = Boolean(value);
      },
    },
  };
}

export { TABS, PREFIX };
