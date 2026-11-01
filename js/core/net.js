// Uebungsnetz + echte Code-Analyse als abfragbares Modell. Alle Pfade relativ zum Tutorial-Root ("BranchLab/control").

import { abs, rel, baseName, parentOf } from "./util.js";

const LIFECYCLE = new Set(["__init__", "onInitTD", "onDestroyTD", "onStart", "onCreate"]);

export function memberCategory(member) {
  const name = member.name;
  if (LIFECYCLE.has(name)) return "lifecycle";
  if (member.property) return "property";
  if (/^onPar[A-Z]/.test(name) || /^onPulse[A-Z]/.test(name) || /^onSeq[A-Z]/.test(name)) return "callback";
  if (name.startsWith("_")) return "intern";
  if (/^[A-Z]/.test(name)) return "public";
  return "intern";
}

export class Net {
  constructor(netJson, codeJson) {
    this.root = netJson.root;
    this.ops = new Map();
    this.ops.set("", { ...netJson.root, path: "", parent: null });
    for (const o of netJson.ops) this.ops.set(o.path, o);
    this.children = new Map();
    for (const o of netJson.ops) {
      const key = o.parent || "";
      if (!this.children.has(key)) this.children.set(key, []);
      this.children.get(key).push(o.path);
    }
    this.edges = netJson.edges || [];
    this.code = codeJson;
    this.extDat = new Map();   // COMP -> Extension-DAT
    this.datComp = new Map();  // Extension-DAT -> COMP
    for (const o of this.ops.values()) {
      for (const ext of this.extensionSources(o.path)) {
        if (ext.available) {
          if (!this.extDat.has(o.path)) this.extDat.set(o.path, ext.path);
          this.datComp.set(ext.path, o.path);
        }
      }
    }
    this._buildCallGraph();
  }

  op(path) {
    return this.ops.get(path) || null;
  }

  has(path) {
    return this.ops.has(path);
  }

  isComp(path) {
    const o = this.op(path);
    return Boolean(o && o.family === "COMP");
  }

  kids(path) {
    return (this.children.get(path || "") || []).map((p) => this.op(p));
  }

  // Alle Ops unter path (ohne Huellen-Innereien), optional nur eine Ebene.
  within(path, recursive = true) {
    const out = [];
    const walk = (p) => {
      for (const child of this.kids(p)) {
        out.push(child);
        if (recursive && child.family === "COMP" && !child.stub) walk(child.path);
      }
    };
    walk(path || "");
    return out;
  }

  isInside(path, scope) {
    if (!scope) return true;
    return path === scope || path.startsWith(scope + "/");
  }

  compOf(path) {
    const o = this.op(path);
    if (!o) return "";
    return o.family === "COMP" ? path : (o.parent || "");
  }

  // Extension: Klasse am COMP (oder am Extension-DAT selbst)
  extClass(compOrDat) {
    const dat = this.extDat.get(compOrDat) || (this.datComp.has(compOrDat) ? compOrDat : null);
    if (!dat) return null;
    const model = this.code[dat];
    if (!model || !model.classes || !model.classes.length) return null;
    const comp = this.datComp.get(dat);
    const binding = this.extensionSources(comp).find((ext) => ext.path === dat);
    const cls = model.classes.find((item) => item.name === binding?.className) || model.classes[0];
    return { dat, comp, cls, model };
  }

  // Jeder Slot behält seinen eigenen Namen und Source-DAT. Dynamische Ausdrücke
  // werden nie ausgeführt und niemals durch einen gleichnamigen DAT geraten.
  extensionSources(comp) {
    const owner = this.op(comp);
    if (!owner || owner.family !== "COMP") return [];
    return (owner.ext || []).map((ext, slot) => {
      const match = /^\s*op\(\s*(['"])([^'"]+)\1\s*\)\.(?:module|mod)\.([A-Za-z_]\w*)\s*\(\s*me\s*\)\s*$/.exec(ext.object || "")
        || /^\s*mod\(\s*(['"])([^'"]+)\1\s*\)\.([A-Za-z_]\w*)\s*\(\s*me\s*\)\s*$/.exec(ext.object || "");
      let path = null;
      if (match) {
        const source = match[2];
        const parts = source.startsWith("/") ? rel(source).split("/") : [...comp.split("/"), ...source.split("/")];
        const normalized = [];
        let outside = source.startsWith("/") && rel(source).startsWith("/");
        for (const part of parts) {
          if (part === "." || part === "") continue;
          if (part === "..") { if (normalized.length) normalized.pop(); else outside = true; }
          else normalized.push(part);
        }
        if (!outside) path = normalized.join("/");
      }
      const dat = path ? this.op(path) : null;
      const available = Boolean(dat && dat.family === "DAT" && typeof dat.text === "string");
      return { comp, slot: ext.slot ?? slot, name: ext.name || match?.[3] || `Extension ${slot + 1}`, className: match?.[3] || "", path, available,
        reason: available ? "" : (match ? "Source-DAT fehlt im Übungsprojekt" : "Source-DAT ist aus diesem Ausdruck nicht eindeutig auflösbar") };
    });
  }

  // Python-DAT-Modell (Klassen oder Modul-Funktionen)
  dat(path) {
    return this.code[path] || null;
  }

  pythonDats(scope = "", recursive = true) {
    return this.within(scope, recursive).filter((o) => this.code[o.path] && !this.code[o.path].error);
  }

  lines(path) {
    const o = this.op(path);
    return o && typeof o.text === "string" ? o.text.split("\n") : [];
  }

  edgesTo(path, kinds = null) {
    return this.edges.filter((e) => e.dst === path && (!kinds || kinds.includes(e.kind)));
  }

  edgesFrom(path, kinds = null) {
    return this.edges.filter((e) => e.src === path && (!kinds || kinds.includes(e.kind)));
  }

  // Kabel an der COMP-Grenze: Eingang n eines COMPs speist dessen n-tes In-OP; Out-OPs speisen den COMP-Ausgang
  compInOps(comp) {
    return this.kids(comp).filter((o) => o.type.startsWith("in")).sort((a, b) => a.name.localeCompare(b.name));
  }

  compOutOps(comp) {
    return this.kids(comp).filter((o) => o.type.startsWith("out")).sort((a, b) => a.name.localeCompare(b.name));
  }

  family(path) {
    const o = this.op(path);
    return o ? o.family : "";
  }

  opType(path) {
    const o = this.op(path);
    return o ? o.type : "";
  }

  shortType(path) {
    const t = this.opType(path);
    return t.replace(/(TOP|CHOP|SOP|DAT|COMP|MAT|POP)$/, "");
  }

  absPath(path) {
    return abs(path);
  }

  // ---------------------------------------------------------------- Code-Modell: Mitglieder, Aufrufe, State

  members(dat) {
    const model = this.code[dat];
    if (!model) return [];
    if (model.classes && model.classes.length) return model.classes[0].members;
    return (model.functions || []).map((f) => ({ ...f, params: [], facts: {}, module: true }));
  }

  member(dat, name) {
    return this.members(dat).find((m) => m.name === name) || null;
  }

  _buildCallGraph() {
    // Kante: {from: {dat, name}, to: {dat, name}, line, via}
    this.calls = [];
    for (const [dat, model] of Object.entries(this.code)) {
      // Nicht lesbare DATs liefern nur zeilenweise gefundene Modul-Aufrufe (wie nativ) - sonst ueberspringen
      if (!model || (model.error && !(model.sites || []).length)) continue;
      const host = this.op(dat);
      const home = host ? (host.parent || "") : "";
      const ownClass = model.classes && model.classes[0] ? model.classes[0].name : "";
      for (const site of model.sites || []) {
        if (site.type !== "call") continue;
        let target = null;
        let via = site.via;
        if (site.via === "self" && ownClass) {
          if (this.member(dat, site.attr)) target = { dat, name: site.attr };
        } else if (site.via === 'iop' && site.shortcut) {
          const comp = this.findInternalShortcut(home, site.shortcut);
          const ext = comp != null ? this.extClass(comp) : null;
          if (ext && this.member(ext.dat, site.attr)) target = { dat: ext.dat, name: site.attr };
        } else if ((site.via === "opof" || site.via === "op") && site.op) {
          const comp = home ? `${home}/${site.op}` : site.op;
          const ext = this.extClass(comp);
          if (ext && this.member(ext.dat, site.attr)) target = { dat: ext.dat, name: site.attr };
          via = "op";
        } else if (site.via === "parentshortcut" && site.shortcut) {
          const comp = this.findParentShortcut(home, site.shortcut);
          const ext = comp != null ? this.extClass(comp) : null;
          if (ext && this.member(ext.dat, site.attr)) target = { dat: ext.dat, name: site.attr };
          via = "shortcut";
        } else if (site.via === "ext" && site.shortcut) {
          const comp = this.findParentShortcut(home, site.shortcut);
          const ext = comp != null ? this.extClass(comp) : null;
          if (ext && this.member(ext.dat, site.attr)) target = { dat: ext.dat, name: site.attr };
          via = "ext";
        } else if (site.via === "modof" && site.op) {
          // op('X').module.f() / mod('X').f() / import X: X liegt im Netz des rufenden DATs (ownercomp-Basis: im COMP selbst)
          const moduleDat = this.resolveModuleDat(dat, home, site);
          if (moduleDat && this.member(moduleDat, site.attr)) target = { dat: moduleDat, name: site.attr };
          via = "module";
        }
        if (target) this.calls.push({ from: { dat, name: site.func }, to: target, line: site.line, via });
      }
      // run('args[0].Zuruecksetzen(sofort=True)') im onInitTD
      for (const site of model.sites || []) {
        if (site.type === "run" && site.text) {
          const m = /args\[0\]\.(\w+)\(/.exec(site.text);
          if (m && this.member(dat, m[1])) {
            this.calls.push({ from: { dat, name: site.func }, to: { dat, name: m[1] }, line: site.line, via: "run" });
          }
        }
      }
    }
    // Code ausserhalb einer Klasse, der eine Extension ueber op('X').Methode() ruft (takt_exec)
    for (const edge of this.edges) {
      if (edge.kind !== "code" || !edge.dst) continue;
      const ext = this.extClass(edge.dst);
      if (!ext) continue;
      const line = this.lines(edge.src)[edge.line - 1] || "";
      const m = /\)\s*\.\s*(\w+)\s*\(/.exec(line) || /\.(?:ext\.\w+\.)?(\w+)\s*\(/.exec(line.split(edge.receiver).pop() || "");
      if (m && this.member(ext.dat, m[1])) {
        const func = this.enclosingFunction(edge.src, edge.line);
        const exists = this.calls.some((c) => c.from.dat === edge.src && c.to.dat === ext.dat && c.to.name === m[1] && c.line === edge.line);
        if (!exists) {
          this.calls.push({ from: { dat: edge.src, name: func || "<modul>" }, to: { dat: ext.dat, name: m[1] }, line: edge.line, via: edge.art === "short" ? "shortcut" : "op" });
        }
      }
    }
  }

  resolveModuleDat(callerDat, home, site) {
    const rel = String(site.op || "").replace(/^\.\//, "");
    if (!rel) return null;
    const candidates = [];
    if (rel.startsWith("/")) candidates.push(rel.replace(/^\/project1\/CodeSearch_Tutorial\//, "").replace(/^\//, ""));
    const base = site.base === "ownercomp" ? this.datComp.get(callerDat) ?? home : home;
    candidates.push(base ? `${base}/${rel}` : rel);
    if (home) candidates.push(`${home}/${rel}`);
    candidates.push(rel);
    for (const path of candidates) {
      const model = this.code[path];
      if (model && !model.error && (model.functions || []).length) return path;
    }
    return null;
  }

  findParentShortcut(start, short) {
    let path = start || "";
    for (;;) {
      const o = this.op(path);
      if (o && o.pars && o.pars.parentshortcut && o.pars.parentshortcut.v === short) return path;
      if (!path) return null;
      path = parentOf(path);
    }
  }

  findInternalShortcut(start, alias) {
    let path = start || '';
    for (;;) {
      const value = this.op(path)?.iop?.[alias];
      if (typeof value === 'string') {
        const relative = /^=me\.op\(['"]([^'"]+)['"]\)$/.exec(value)?.[1] || value;
        const parts = path ? path.split('/') : [];
        for (const part of relative.split('/')) {
          if (part === '..') parts.pop();
          else if (part && part !== '.') parts.push(part);
        }
        const resolved = parts.join('/');
        return this.has(resolved) ? resolved : null;
      }
      if (!path) return null;
      path = parentOf(path);
    }
  }

  enclosingFunction(dat, line) {
    const members = this.members(dat);
    let best = null;
    for (const m of members) {
      if (m.line <= line && line <= (m.end || m.line)) {
        if (!best || m.line > best.line) best = m;
      }
    }
    return best ? best.name : null;
  }

  callersOf(dat, name) {
    return this.calls.filter((c) => c.to.dat === dat && c.to.name === name);
  }

  calleesOf(dat, name) {
    return this.calls.filter((c) => c.from.dat === dat && c.from.name === name);
  }

  // TD ruft Callbacks: onParX ueber CustomParHelper, Lifecycle ueber TD selbst
  tdCaller(dat, name) {
    const comp = this.datComp.get(dat);
    if (/^onPar([A-Z]\w*)$/.test(name) && comp != null) {
      const par = name.slice(5);
      const o = this.op(comp);
      const cp = (o.custom || []).find((p) => p.name === par);
      return { kind: "par", par, style: cp ? cp.style : "", comp };
    }
    if (LIFECYCLE.has(name)) return { kind: "td", comp };
    return null;
  }

  accesses(dat, state = null) {
    const model = this.code[dat];
    if (!model) return [];
    return (model.accesses || []).filter((a) => !state || a.name === state);
  }

  // Python-State (self.x), ohne CustomParHelper-Pars (evalX/parX)
  states(dat) {
    const model = this.code[dat];
    if (!model || !model.classes || !model.classes.length) return [];
    return Object.entries(model.classes[0].states)
      .filter(([name]) => !/^(eval|par)[A-Z]/.test(name))
      .map(([name, line]) => ({ name, line }));
  }

  helperPars(dat) {
    const model = this.code[dat];
    if (!model || !model.classes || !model.classes.length) return [];
    const names = new Set();
    for (const a of model.accesses || []) if (/^(eval|par)[A-Z]/.test(a.name)) names.add(a.name);
    return [...names];
  }

  memberAt(dat, line) {
    return this.enclosingFunction(dat, line);
  }

  label(path) {
    return baseName(path) || "CodeSearch_Tutorial";
  }
}
