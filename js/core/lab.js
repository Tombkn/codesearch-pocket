// Die Uebungsnetze als Simulation. Jede Methode folgt Zeile fuer Zeile dem Python-Code im Netz
// (BranchLabExt, ColorEngineExt, FarbmischerExt, StateLabExt). trace() meldet Aufrufe an RECORD.

import { uid } from "./util.js";
import { SignalGarden } from "./signalgarden.js";

export const PALETTE = [["name", "r", "g", "b"], ["warm", "0.95", "0.36", "0.14"],
  ["cool", "0.12", "0.48", "0.88"], ["neutral", "0.55", "0.62", "0.60"]];

const BL = "BranchLab/BranchLabExt";
const CE = "BranchLab/ColorEngine/ColorEngineExt";
const FM = "Farbmischer/FarbmischerExt";
const SL = "StateLab/StateLabExt";

function pyFloat(text) {
  const value = String(text).trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(value) && !/^[+-]?(inf|nan)$/i.test(value)) {
    throw new Error(`could not convert string to float: '${text}'`);
  }
  return Number(value);
}

function pyTuple(values) {
  return "(" + values.map((v) => (Number.isInteger(v) ? v.toFixed(1) : String(v))).join(", ") + ")";
}

class StateLab {
  constructor(lab) {
    this.lab = lab;
    this.pars = { Doublefire: false, Gain: 0.5, GainExpr: "", Countdisplay: 0, Status: "Bereit" };
    this.storage = { lesson_value: "parent", lesson_session: 99 };
    this.childStorage = { lesson_value: "child" };
    this.startupValues = {};
    this._init();
  }

  _init() {
    this.generation = uid("gen");
    this.count = 0;
    this.shared = [0, 10];
    this.alias = this.shared;
    this.dependent = [0, 10];
    this.dependencyShown = 0;     // was der Expression-CHOP zuletzt gelesen hat
    this.notifications = 0;
    this.lastFireIncrement = 0;
    this.actionSerial = 0;
    this.lastAction = "init";
    this.startupConfigured = false;
    this.startupExpected = 7;
    this._publish();
  }

  get gainMode() { return this.pars.GainExpr ? "EXPRESSION" : "CONSTANT"; }
  get gainEffective() { return this.pars.GainExpr ? 0.75 : this.pars.Gain; }

  _call(name, fn) { return this.lab.call(SL, name, fn); }

  Prepare() {
    return this._call("Prepare", () => {
      this.pars.Doublefire = false;
      this.pars.Gain = 0.5;
      this.pars.GainExpr = "";
      this.storage.lesson_value = "parent";
      this.storage.lesson_session = 99;
      delete this.startupValues.lesson_session;
      this.childStorage.lesson_value = "child";
      this.startupConfigured = false;
      this._resetRuntime();
      this._finish("prepare");
    });
  }

  Fire() {
    return this._call("Fire", () => {
      const increment = this.pars.Doublefire ? 2 : 1;
      this.count += increment;
      this.lastFireIncrement = increment;
      this._finish("fire");
    });
  }

  Mutate() {
    return this._call("Mutate", () => {
      this.shared[0] += 1;
      this.dependent[0] += 1;   // in-place: die Dependency meldet noch nichts
      this._finish("mutate");
    });
  }

  Notify() {
    return this._call("Notify", () => {
      this.dependencyShown = this.dependent[0];  // modified(): Leser werden neu gekocht
      this.notifications += 1;
      this._finish("notify");
    });
  }

  ReplaceSameValue() {
    return this._call("ReplaceSameValue", () => {
      this.shared = this.shared.slice();
      this._finish("replace_same_value");
    });
  }

  RuntimeReset() {
    return this._call("RuntimeReset", () => { this._resetRuntime(); this._finish("runtime_reset"); });
  }

  StorageReset() {
    return this._call("StorageReset", () => {
      delete this.storage.lesson_value;
      delete this.storage.lesson_session;
      delete this.startupValues.lesson_session;
      delete this.childStorage.lesson_value;
      this.startupConfigured = false;
      this._finish("storage_reset");
    });
  }

  ClearChild() {
    return this._call("ClearChild", () => { delete this.childStorage.lesson_value; this._finish("clear_child"); });
  }

  UseExpression() {
    return this._call("UseExpression", () => { this.pars.GainExpr = "0.5 + 0.25"; this._finish("expression"); });
  }

  UseConstant() {
    return this._call("UseConstant", () => { this.pars.GainExpr = ""; this.pars.Gain = 0.5; this._finish("constant"); });
  }

  Reinit() {
    // reinitextensions: neue Instanz, Parameter und Storage bleiben
    this._call("Reinit", () => {});
    this._init();
    this.lab.call(SL, "__init__", () => {});
    this.lab.call(SL, "onInitTD", () => this._publish());
  }

  StartupExperiment() {
    return this._call("StartupExperiment", () => {
      this.storage.lesson_session = 99;
      this.startupValues.lesson_session = this.startupExpected;
      this.startupConfigured = true;
      this._finish("startup_configured_only");
    });
  }

  _resetRuntime() {
    this.count = 0;
    this.shared = [0, 10];
    this.alias = this.shared;
    this.dependent = [0, 10];
    this.dependencyShown = 0;   // Zuweisung an .val meldet sofort
    this.notifications = 0;
    this.lastFireIncrement = 0;
  }

  _finish(action) {
    this.lastAction = action;
    this.actionSerial += 1;
    this._publish();
  }

  _publish() {
    this.pars.Countdisplay = this.count;
    this.pars.Status = `${this.lastAction}: Count=${this.count}`;
  }

  stateValues() {
    return [["Ort", "Name", "Wert"], ["Attribut", "_count", String(this.count)],
      ["Attribut", "_shared[0]", String(this.shared[0])], ["Attribut", "_alias[0]", String(this.alias[0])],
      ["Alias", "gleiches Objekt", this.alias === this.shared ? "True" : "False"],
      ["Dependency", "Inhalt[0]", String(this.dependent[0])], ["Parameter", "Gain effektiv", String(this.gainEffective)],
      ["Storage", "Parent lesson_value", String(this.storage.lesson_value ?? "")],
      ["Storage", "Child lesson_value", String(this.childStorage.lesson_value ?? "")],
      ["Lebensdauer", "Instanz", this.generation]];
  }

  Observe() {
    const local = this.childStorage.lesson_value ?? null;
    const inherited = this.storage.lesson_value ?? null;
    const resolved = local ?? inherited;
    let origin = "missing";
    if ("lesson_value" in this.childStorage) origin = "child";
    else if ("lesson_value" in this.storage) origin = "parent";
    return {
      count: this.count, generation: this.generation,
      shared_first: this.shared[0], alias_first: this.alias[0], alias_shared: this.alias === this.shared,
      dependency_value: this.dependent[0], dependency_display: this.dependencyShown,
      notifications: this.notifications, last_fire_increment: this.lastFireIncrement,
      failure_reproduced: this.lastFireIncrement === 2, doublefire: Boolean(this.pars.Doublefire),
      gain_mode: this.gainMode, gain_effective: this.gainEffective,
      storage_parent: inherited, storage_child: local, storage_resolved: resolved, storage_origin: origin,
      session_current: this.storage.lesson_session ?? null,
      startup_configured: this.startupConfigured, startup_expected: this.startupExpected, startup_reloaded: false,
      action_serial: this.actionSerial, last_action: this.lastAction,
    };
  }
}

class Farbmischer {
  constructor(lab, net) {
    this.lab = lab;
    const comp = net.op("Farbmischer");
    const table = net.op("Farbmischer/palette");
    this.palette = table ? table.table.map((row) => row.slice()) : [["name", "r", "g", "b"]];
    this.pars = { Auto: false, Dauer: 1, Helligkeit: 1 };
    for (const p of comp.custom || []) if (p.name in this.pars && p.value !== undefined) this.pars[p.name] = p.value;
    this.index = 0;
    this.von = [0, 0, 0];
    this.nach = [0, 0, 0];
    this.mix = 1;
    this.letzterWechsel = 0;
    this.chop = [1, 0.45, 0.2];
    this.tastenActive = false;
    this.Zuruecksetzen(true, false);
  }

  _call(name, fn) { return this.lab.call(FM, name, fn); }

  _namen() { return this._call("_namen", () => this.palette.slice(1).map((r) => r[0])); }
  _anzahlFarben() { return this._call("_anzahlFarben", () => this._namen().length); }
  _farbeAus(index) {
    return this._call("_farbeAus", () => {
      if (!(index >= 0 && index < this.palette.length - 1)) return [0, 0, 0];
      const row = this.palette[index + 1];
      return [pyFloat(row[1]), pyFloat(row[2]), pyFloat(row[3])];
    });
  }
  _zwischenfarbe() {
    return this._call("_zwischenfarbe", () => this.von.map((alt, i) => alt + (this.nach[i] - alt) * this.mix));
  }
  _anwenden(farbe) { return this._call("_anwenden", () => { this.chop = farbe.slice(); }); }
  _starteUeberblendung(sofort = false) {
    return this._call("_starteUeberblendung", () => {
      this.von = this._zwischenfarbe();
      this.nach = this._farbeAus(this.index);
      this.mix = sofort ? 1 : 0;
      this.letzterWechsel = this.lab.time;
      if (sofort) this._anwenden(this.nach);
    });
  }
  Weiter() {
    return this._call("Weiter", () => {
      const anzahl = this._anzahlFarben();
      if (anzahl === 0) return;
      this.index = (this.index + 1) % anzahl;
      this._starteUeberblendung();
    });
  }
  Zuruecksetzen(sofort = false, traced = true) {
    const body = () => {
      const namen = this._namen();
      this.index = namen.includes("sonnenuntergang") ? namen.indexOf("sonnenuntergang") : 0;
      this._starteUeberblendung(sofort);
    };
    return traced ? this._call("Zuruecksetzen", body) : body();
  }
  Tick() {
    return this._call("Tick", () => {
      if (this.mix >= 1) return;
      const dauer = Math.max(0.05, Number(this.pars.Dauer));
      this.mix = Math.min(1, this.mix + 1 / (dauer * 60));
      this._anwenden(this._zwischenfarbe());
      if (this.mix >= 1) this._namen();
    });
  }
  get Deckkraft() {
    return Number(this.pars.Helligkeit) * (0.7 + 0.3 * (this.lab.beat ? 1 : 0));
  }
}

export class Lab {
  constructor(net) {
    this.net = net;
    this.time = 0;
    this.frame = 1;
    this.beat = false;
    this.playing = false;
    this.tracer = null;       // RECORD haengt sich hier ein
    this.depth = 0;
    const bl = net.op("BranchLab");
    this.blPars = { Enabled: true, Route: "warm", Intensity: 0.8, Softness: 12, Status: "Aufbau" };
    this.blParsMenu = (bl.custom || []).find((p) => p.name === "Route")?.menuNames || ["warm", "cool", "neutral"];
    this.events = 0;
    this.branch = "bereit";
    this.control = { gain: 0.8, route: 0 };
    this.palette = PALETTE.map((r) => r.slice());
    this.tableUndo = [];
    this.tableRedo = [];
    this.tableHistoryError = '';
    this.writes = 0;
    this.last = [0, 0, 0];
    this.ceStatus = "Bereit";
    this.rgb = [0.3325, 0.126, 0.049];
    this.errorProbe = { expr: "op('control')['gain']", mode: "EXPRESSION" };
    this.script = (net.op("BranchLab/experiment_script") || {}).text || "";
    this.farbmischer = new Farbmischer(this, net);
    this.stateLab = new StateLab(this);
    this.garden = new SignalGarden(this);
    this.Reset(false);
  }

  // Aufruf einer Python-Methode: RECORD sieht ihn (Name, DAT, Zeile, Tiefe, State-Aenderung)
  call(dat, name, fn) {
    const tracer = this.tracer;
    const before = tracer && tracer.wantsState ? this.stateSnapshot() : null;
    const entry = tracer ? tracer.enter(dat, name, this.depth) : null;
    this.depth += 1;
    let result;
    try {
      result = fn();
    } finally {
      this.depth -= 1;
      if (entry) tracer.leave(entry, before ? this.stateDiff(before) : "");
    }
    return result;
  }

  stateSnapshot() {
    const garden = this.garden?.Observe() || {};
    return { _events: this.events, _branch: this.branch, _writes: this.writes, _last: pyTuple(this.last),
      ...Object.fromEntries(Object.entries(garden).map(([k, v]) => [`garden.${k}`, Array.isArray(v) ? JSON.stringify(v) : v])) };
  }

  stateDiff(before) {
    const after = this.stateSnapshot();
    return Object.keys(after).filter((k) => after[k] !== before[k])
      .map((k) => `${k} ${JSON.stringify(before[k])} → ${JSON.stringify(after[k])}`).join(" · ");
  }

  // ------------------------------------------------------------- BranchLab (BranchLabExt)
  Reset(traced = true) {
    const body = () => {
      this.blPars.Enabled = true;
      this.blPars.Route = "warm";
      this.blPars.Intensity = 0.8;
      this.blPars.Softness = 12;
      this.events = 0;
      this.branch = "bereit";
      this.ApplyPreset("warm", 0.8);
      this.control.gain = 0.8;
      this.control.route = 0;
      this.blPars.Status = "Bereit: Route waehlen und Fire druecken.";
    };
    return traced ? this.call(BL, "Reset", body) : body();
  }

  onParFire() { return this.call(BL, "onParFire", () => this.RouteEvent()); }
  onParReset() { return this.call(BL, "onParReset", () => this.Reset()); }

  RouteEvent() {
    return this.call(BL, "RouteEvent", () => {
      this.events += 1;
      if (!this.blPars.Enabled) {
        this.branch = "blocked";
        this.blPars.Status = "BLOCKED: Enabled ist aus; ApplyPreset wurde nicht gerufen.";
        return;
      }
      if (this.blPars.Route === "warm") this._warm();
      else if (this.blPars.Route === "cool") this._cool();
      else this._neutral();
    });
  }

  _warm() { return this.call(BL, "_warm", () => this._send("warm", 0)); }
  _cool() { return this.call(BL, "_cool", () => this._send("cool", 1)); }
  _neutral() { return this.call(BL, "_neutral", () => this._send("neutral", 2)); }

  _send(name, route) {
    return this.call(BL, "_send", () => {
      const color = this.ApplyPreset(name, Number(this.blPars.Intensity));
      if (color === null) {
        this.branch = "invalid";
        this.blPars.Status = "INVALID: Palette pruefen; die bisherige Farbe bleibt.";
        return;
      }
      this.branch = name;
      this.control.gain = Number(this.blPars.Intensity);
      this.control.route = route;
      this.blPars.Status = `${name.toUpperCase()}: Ereignis ${this.events}; Farbe ${pyTuple(color)}`;
    });
  }

  // ------------------------------------------------------------- ColorEngine (ColorEngineExt)
  ApplyPreset(name, strength) {
    return this.call(CE, "ApplyPreset", () => {
      const table = this.palette;
      if (!table || table.length < 2) {
        this.ceStatus = "Palette fehlt oder ist leer";
        return null;
      }
      const row = table.slice(1).find((r) => r[0] === name);
      if (!row) {
        this.ceStatus = `Palette enthaelt ${name} nicht`;
        return null;
      }
      let color;
      try {
        if (row.length < 4) throw new Error("list index out of range");
        color = [pyFloat(row[1]), pyFloat(row[2]), pyFloat(row[3])];
      } catch (error) {
        this.ceStatus = `Ungueltige Palettenzeile ${name}: ${error.message}`;
        return null;
      }
      if (!color.every((v) => Number.isFinite(v))) {
        this.ceStatus = "Die Farbe muss endliche Zahlen enthalten";
        return null;
      }
      const result = color.map((v) => Math.max(0, Math.min(1, v * strength)));
      this._writeColor(result);
      this.ceStatus = `${name}: ${pyTuple(result)}`;
      return result;
    });
  }

  _writeColor(color) {
    return this.call(CE, "_writeColor", () => {
      this.rgb = color.slice();
      this.last = color.slice();
      this.writes += 1;
    });
  }

  // ------------------------------------------------------------- Werte, die die Tour liest
  get softSize() { return Number(this.blPars.Softness); }   // blur_soft.size ist per BIND an Softness gekoppelt
  get exprOpacity() { return this.control.gain; }          // level_expr.opacity = op('control')['gain']
  get exportOpacity() { return this.control.gain; }        // control_export exportiert gain in level_export.opacity

  setPalette(kind) {
    this.palette = kind === "empty" ? [PALETTE[0].slice()] : PALETTE.map((r) => r.slice());
    if (kind === "invalid") this.palette[1][1] = "kaputt";
  }

  editableTable(path) {
    if (path === 'BranchLab/ColorEngine/palette') return this.palette;
    if (path === 'SignalGarden/Palette/colors') return this.garden.table;
    return null;
  }

  _replaceTable(path, rows) {
    const copy = rows.map(row => row.slice());
    if (path === 'BranchLab/ColorEngine/palette') this.palette = copy;
    else if (path === 'SignalGarden/Palette/colors') this.garden.table = copy;
  }

  // Jede abgeschlossene Bearbeitung ist genau ein Schritt, auch über Tabellen hinweg.
  mutateTable(path, update) {
    const table = this.editableTable(path);
    if (!table) return false;
    const before = table.map(row => row.slice());
    const after = before.map(row => row.slice());
    update(after);
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    this._replaceTable(path, after);
    this.tableUndo.push({path, before, after});
    if (this.tableUndo.length > 100) this.tableUndo.shift();
    this.tableRedo = [];
    this.tableHistoryError = '';
    return true;
  }

  editCell(row, col, value, path = 'BranchLab/ColorEngine/palette') {
    const table = this.editableTable(path);
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0
      || !table?.[row] || col >= table[row].length) return false;
    return this.mutateTable(path, rows => { rows[row][col] = String(value); });
  }

  _tableHistoryStep(redo) {
    const from = redo ? this.tableRedo : this.tableUndo;
    const to = redo ? this.tableUndo : this.tableRedo;
    const entry = from.at(-1);
    this.tableHistoryError = '';
    if (!entry) return false;
    if(entry.operation){
      try{(redo?entry.redo:entry.undo)();}catch(error){this.tableHistoryError=error.message;return false;}
      from.pop();to.push(entry);return true;
    }
    const expected = redo ? entry.before : entry.after;
    if (JSON.stringify(this.editableTable(entry.path)) !== JSON.stringify(expected)) {
      this.tableHistoryError = 'Die Tabelle wurde inzwischen außerhalb von TABLE verändert. Der alte Schritt wird nicht angewendet.';
      return false;
    }
    this._replaceTable(entry.path, redo ? entry.after : entry.before);
    from.pop(); to.push(entry);
    return true;
  }

  undoTable() { return this._tableHistoryStep(false); }
  redoTable() { return this._tableHistoryStep(true); }
  recordEdit(undo,redo) {
    this.tableUndo.push({operation:true,undo,redo});if(this.tableUndo.length>100)this.tableUndo.shift();
    this.tableRedo=[];this.tableHistoryError='';
  }

  setError() {
    this.errorProbe = { expr: "op('absichtlich_fehlend')['gain']", mode: "EXPRESSION" };
  }

  restoreError() {
    this.errorProbe = { expr: "op('control')['gain']", mode: "EXPRESSION" };
  }

  get errorActive() {
    return this.errorProbe.mode === "EXPRESSION" && this.errorProbe.expr.includes("absichtlich_fehlend");
  }

  // Wert eines Custom-Pars, wie STRUCTURE > PARAMETER ihn als WERT JETZT zeigt
  helperParValue(comp, par) {
    const quote = (v) => (typeof v === "string" ? `„${v}“` : (typeof v === "boolean" ? (v ? "1" : "0") : String(Number(v.toFixed ? v.toFixed(4) : v))));
    const gardenOwner = this.garden.owner(comp);
    if (gardenOwner && par in this.garden.pars[gardenOwner]) return quote(this.garden.pars[gardenOwner][par]);
    if (comp === "BranchLab" && par in this.blPars) return quote(this.blPars[par]);
    if (comp === "BranchLab/ColorEngine" && par === "Status") return quote(this.ceStatus);
    if (comp === "Farbmischer" && par in this.farbmischer.pars) return quote(this.farbmischer.pars[par]);
    if (comp === "StateLab") {
      if (par === "Gain") return quote(this.stateLab.gainEffective);
      if (par in this.stateLab.pars) return quote(this.stateLab.pars[par]);
    }
    return "≈";
  }

  // Python-State einer Extension (WERT JETZT, Recordstate)
  stateValue(dat, name) {
    const gardenOwner = this.garden.owner(dat);
    if (gardenOwner) {
      const value = this.garden.attributes(gardenOwner)[name];
      return value === undefined ? undefined : JSON.stringify(value);
    }
    const tuple = (t) => pyTuple(t);
    const values = {
      "BranchLab/BranchLabExt": { _events: this.events, _branch: `'${this.branch}'`, ownerComp: "baseCOMP /project1/CodeSearch_Tutorial/BranchLab" },
      "BranchLab/ColorEngine/ColorEngineExt": { _writes: this.writes, _last: tuple(this.last), ownerComp: "baseCOMP /project1/CodeSearch_Tutorial/BranchLab/ColorEngine" },
      "Farbmischer/FarbmischerExt": { _index: this.farbmischer.index, _von: tuple(this.farbmischer.von), _nach: tuple(this.farbmischer.nach),
        _mix: this.farbmischer.mix, _letzterWechsel: Number(this.farbmischer.letzterWechsel.toFixed(3)), ownerComp: "baseCOMP /project1/CodeSearch_Tutorial/Farbmischer" },
      "StateLab/StateLabExt": { _count: this.stateLab.count, _generation: `'${this.stateLab.generation}'`, _shared: `[${this.stateLab.shared.join(", ")}]`,
        _alias: `[${this.stateLab.alias.join(", ")}]`, _notifications: this.stateLab.notifications, _last_fire_increment: this.stateLab.lastFireIncrement,
        _action_serial: this.stateLab.actionSerial, _last_action: `'${this.stateLab.lastAction}'`, _startup_configured: this.stateLab.startupConfigured ? "True" : "False",
        _startup_expected: this.stateLab.startupExpected, ownerComp: "baseCOMP /project1/CodeSearch_Tutorial/StateLab" },
    }[dat];
    return values ? values[name] : undefined;
  }

  // Zeit: Play laesst Frames laufen (Farbmischer-Tick, Takt)
  step(frames = 1) {
    for (let i = 0; i < frames; i += 1) {
      this.frame += 1;
      this.time += 1 / 60;
      this.garden.FrameTick(1 / 60);
      const beat = Math.floor(this.time * 0.5 * 2) % 2 === 0;
      const rising = beat && !this.beat;
      this.beat = beat;
      this.lab_frame_tick();
      if (rising && this.farbmischer.pars.Auto) {
        this.call("takt_exec", "onOffToOn", () => this.farbmischer.Weiter());
      }
    }
  }

  lab_frame_tick() {
    this.call("Farbmischer/frame_tick", "onFrameStart", () => this.farbmischer.Tick());
  }
}
