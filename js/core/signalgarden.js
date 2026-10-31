// Ausführbares Pocket-Modell der vier SignalGarden-Extensions.
// Gemeinsame scenarios.json prüft die Werte gegen die tatsächlichen Python-Quellen.
const PATHS = { root: 'SignalGarden/SignalGardenExt', sensor: 'SignalGarden/Sensor/SensorExt',
  scenes: 'SignalGarden/Scenes/SceneControllerExt', palette: 'SignalGarden/Palette/PaletteExt' };
const DEFAULTS = [['scene', 'r', 'g', 'b'], ['idle', '0.02', '0.04', '0.08'],
  ['warm', '1.0', '0.25', '0.05'], ['cool', '0.05', '0.35', '1.0']];
const clamp = (n) => Math.max(0, Math.min(1, n));
const clone = (v) => JSON.parse(JSON.stringify(v));
const float = (s) => /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(String(s).trim()) ? Number(s) : NaN;

export class SignalGarden {
  constructor(lab) {
    this.lab = lab;
    this.pars = { root: { Enabled: true, Auto: false, Scene: 'warm', Doubledispatch: false, Status: 'Bereit' },
      sensor: { Value: 0.2, Valid: true, Enter: 0.6, Exit: 0.4, Present: false, Status: 'Bereit' },
      scenes: { Brightness: 0.8, Duration: 1, Scenenow: 'idle', Mix: 1, Status: 'Bereit' }, palette: { Status: 'Bereit' } };
    this.table = clone(DEFAULTS);
    this.serial = 0; this.lastAction = 'init';
    this.present = false; this.samples = 0;
    this.initScenes();
  }
  call(owner, name, fn) { return this.lab.call(PATHS[owner], name, fn); }
  initScenes() {
    this.requests = 0; this.scene = 'idle'; this.rgb = [0, 0, 0]; this.from = [...this.rgb]; this.target = [...this.rgb];
    this.elapsed = 0; this.mix = 1; this.transitioning = false; this.sceneStatus = 'Runtime neu; noch keine Szene angefordert';
    this.publish();
  }
  publish() {
    Object.assign(this.pars.scenes, { Scenenow: this.scene, Mix: this.mix, Status: this.sceneStatus });
  }
  finish(action, status) {
    this.call('root', '_finish', () => { this.serial += 1; this.lastAction = action; this.pars.root.Status = status; });
  }
  restorePalette() {
    return this.call('palette', 'RestoreDefaults', () => { this.table = clone(DEFAULTS); this.pars.palette.Status = 'Drei gültige Szenen wiederhergestellt'; });
  }
  readColor(scene) {
    const row = this.table.slice(1).find((r) => r[0] === scene);
    if (!row || row.length !== 4) return null;
    const values = row.slice(1).map(float);
    return values.every(Number.isFinite) ? values.map(clamp) : null;
  }
  resolve(scene) {
    return this.call('palette', 'Resolve', () => {
      const color = this.call('palette', '_readColor', () => this.readColor(scene));
      this.pars.palette.Status = color ? `${scene}: gültig` : `ERROR: ungültige Palette für ${scene}`;
      return color;
    });
  }
  resetSensor() {
    return this.call('sensor', 'ResetRuntime', () => { this.present = false; this.samples = 0;
      this.call('sensor', '_publish', () => { this.pars.sensor.Present = false; this.pars.sensor.Status = 'Runtime zurückgesetzt; Einstellungen bleiben'; }); });
  }
  sample() {
    return this.call('sensor', 'Sample', () => {
      const p = this.pars.sensor;
      const value = Number(p.Value), enter = Number(p.Enter), exit = Number(p.Exit);
      this.samples += 1;
      const valid = Boolean(p.Valid) && [value, enter, exit].every(Number.isFinite) && exit >= 0 && exit <= enter && enter <= 1;
      if (!valid) this.present = false;
      else if (!this.present && clamp(value) >= enter) this.present = true;
      else if (this.present && clamp(value) <= exit) this.present = false;
      this.call('sensor', '_publish', () => { p.Present = this.present;
        p.Status = this.present ? 'present' : (valid ? 'absent' : 'invalid'); });
      return { valid, present: this.present, value: Number.isFinite(value) ? clamp(value) : 0 };
    });
  }
  resetScenes() {
    return this.call('scenes', 'ResetRuntime', () => {
      this.requests = 0; this.scene = 'idle'; this.rgb = [0.02, 0.04, 0.08].map((v) => v * clamp(Number(this.pars.scenes.Brightness)));
      this.from = [...this.rgb]; this.target = [...this.rgb]; this.elapsed = 0; this.mix = 1; this.transitioning = false;
      this.sceneStatus = 'idle; Runtime zurückgesetzt'; this.call('scenes', '_publish', () => this.publish());
    });
  }
  request(scene) {
    return this.call('scenes', 'Request', () => {
      this.requests += 1;
      const color = this.resolve(scene), brightness = Number(this.pars.scenes.Brightness);
      if (!color || !Number.isFinite(brightness)) {
        this.rgb = [0, 0, 0]; this.from = [...this.rgb]; this.target = [...this.rgb]; this.scene = 'invalid';
        this.elapsed = 0; this.mix = 1; this.transitioning = false; this.sceneStatus = 'ERROR: Palette ungültig; Output schwarz';
        this.call('scenes', '_publish', () => this.publish()); return false;
      }
      const target = color.map((v) => v * clamp(brightness));
      if (this.scene === scene && target.every((v, i) => v === this.target[i])) {
        this.sceneStatus = 'Gleiches Ziel; Übergang bleibt erhalten'; this.call('scenes', '_publish', () => this.publish()); return true;
      }
      this.scene = scene; this.from = [...this.rgb]; this.target = target; this.elapsed = 0; this.mix = 0;
      this.transitioning = true; this.sceneStatus = `Übergang zu ${scene}`;
      if (Number(this.pars.scenes.Duration) <= 0) this.tick(0);
      else this.call('scenes', '_publish', () => this.publish());
      return true;
    });
  }
  tick(dt) {
    return this.call('scenes', 'Tick', () => {
      if (!this.transitioning) return;
      const duration = Number(this.pars.scenes.Duration);
      if (![dt, duration].every(Number.isFinite)) {
        this.sceneStatus = 'ERROR: nicht endliche Zeit; Übergang angehalten'; this.call('scenes', '_publish', () => this.publish()); return;
      }
      this.elapsed += Math.max(0, dt); this.mix = duration <= 0 ? 1 : Math.min(1, this.elapsed / duration);
      this.rgb = this.from.map((start, i) => start + (this.target[i] - start) * this.mix);
      this.transitioning = this.mix < 1; this.sceneStatus = `${this.scene}: ${this.transitioning ? 'Übergang' : 'erreicht'}`;
      this.call('scenes', '_publish', () => this.publish());
    });
  }
  Prepare() {
    return this.call('root', 'Prepare', () => {
      this.call('root', '_ready', () => true);
      Object.assign(this.pars.root, { Enabled: true, Auto: false, Scene: 'warm', Doubledispatch: false });
      this.restorePalette();
      this.call('sensor', 'Prepare', () => { Object.assign(this.pars.sensor, { Value: 0.2, Valid: true, Enter: 0.6, Exit: 0.4 }); this.resetSensor(); });
      this.call('scenes', 'Prepare', () => { Object.assign(this.pars.scenes, { Brightness: 0.8, Duration: 1 }); this.resetScenes(); });
      this.finish('prepare', 'Vorbereitet; noch kein Submit und kein Step');
    });
  }
  Submit() {
    return this.call('root', 'Submit', () => {
      if (!this.pars.root.Enabled) { this.finish('submit', 'BLOCKED: Enabled aus; keine Sensorprobe'); return; }
      this.call('root', '_ready', () => true);
      const sample = this.sample(), scene = sample.valid && sample.present ? this.pars.root.Scene : 'idle';
      const accepted = this.request(scene);
      if (this.pars.root.Doubledispatch) this.request(scene);
      this.finish('submit', accepted ? `Anforderung ${scene}` : 'ERROR: Anforderung abgewiesen');
    });
  }
  Step() { return this.call('root', 'Step', () => { this.call('root', '_ready', () => true); this.tick(0.25); this.finish('step', 'Genau 0.25 Sekunden weiter'); }); }
  FrameTick(dt) {
    if (!this.pars.root.Enabled || !this.pars.root.Auto) return;
    this.call('root', 'FrameTick', () => {
      if (!Number.isFinite(dt)) { this.pars.root.Status = 'ERROR: Frame-Abstand ist nicht endlich'; return; }
      this.tick(Math.max(0, Math.min(0.1, dt)));
    });
  }
  pulse(owner, name) {
    const fn = { root: { Prepare: () => this.Prepare(), Submit: () => this.Submit(), Step: () => this.Step() },
      sensor: { Sample: () => this.sample(), Reset: () => this.resetSensor() },
      scenes: { Reset: () => this.resetScenes() }, palette: { Restore: () => this.restorePalette() } }[owner]?.[name];
    if (!fn) throw new Error(`Unbekannter SignalGarden-Pulse ${owner}.${name}`);
    return this.call(owner, `onPar${name}`, fn);
  }
  reinit(owner) {
    if (!['sensor', 'scenes'].includes(owner)) throw new Error('Nur Sensor oder Scenes neu initialisieren');
    this.call(owner, 'onDestroyTD', () => {});
    this.call(owner, '__init__', () => {
      if (owner === 'sensor') { this.present = false; this.samples = 0; this.pars.sensor.Present = false; }
      else this.initScenes();
    });
    this.call(owner, 'onInitTD', () => {});
  }
  Observe() {
    return { ready: true, enabled: Boolean(this.pars.root.Enabled),
      'sensor.value': Number(this.pars.sensor.Value), 'sensor.valid': Boolean(this.pars.sensor.Valid),
      'sensor.present': this.present, 'sensor.samples': this.samples,
      'scene.name': this.scene, 'scene.requests': this.requests, 'scene.mix': this.mix,
      'scene.transitioning': this.transitioning, 'scene.rgb': [...this.rgb], 'scene.target_rgb': [...this.target], 'scene.status': this.sceneStatus,
      'palette.rows': Math.max(0, this.table.length - 1), 'palette.valid': ['idle', 'warm', 'cool'].every((s) => this.readColor(s) !== null),
      action_serial: this.serial, last_action: this.lastAction };
  }
  owner(path) { return Object.keys(PATHS).find((key) => path === PATHS[key] || path === PATHS[key].slice(0, PATHS[key].lastIndexOf('/'))); }
  attributes(owner) {
    return { root: { _action_serial: this.serial, _last_action: this.lastAction },
      sensor: { _present: this.present, _samples: this.samples },
      scenes: { _requests: this.requests, _scene: this.scene, _rgb: [...this.rgb], _from_rgb: [...this.from], _target_rgb: [...this.target],
        _elapsed: this.elapsed, _mix: this.mix, _transitioning: this.transitioning, _status: this.sceneStatus }, palette: {} }[owner] || {};
  }
  caseValues(scope = 'SignalGarden') {
    const selected = scope === 'SignalGarden' ? Object.keys(PATHS) : [this.owner(scope)].filter(Boolean);
    const observations = this.Observe(), values = {};
    const prefix = { root: '', sensor: 'sensor.', scenes: 'scene.', palette: 'palette.' };
    for (const owner of selected) {
      for (const [name, value] of Object.entries(observations)) {
        if (owner === 'root' ? !name.includes('.') : name.startsWith(prefix[owner])) values[name] = value;
      }
      for (const [name, value] of Object.entries(this.pars[owner])) values[`par.${owner}.${name}`] = value;
    }
    if (selected.includes('palette')) values['palette.table'] = clone(this.table);
    return values;
  }
}
