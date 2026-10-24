// Code-Tabs: STRUCTURE (+ LANDKARTE, Ueberblick, SYSTEM, REVIEW), IMPACT, TRIGGERS, CALL PATH, ROUTE.
// Grundlage ist das echte CodeModel (Mitglieder, Aufrufe, State-Zugriffe, Zweige) aus data/code.json.

import { abs, baseName, fmtNum, parentOf } from "../util.js";
import { memberCategory } from "../net.js";
import { hit, section, action, info, notice } from "./common.js";

const MAP_LIST_LIMIT = 4;

function listText(names, limit = MAP_LIST_LIMIT) {
  if (!names.length) return "—";
  const shown = names.slice(0, limit).join(", ");
  return names.length > limit ? `${shown} (+${names.length - limit})` : shown;
}

// Code-Ziel: Extension-COMP (oder Python-DAT) zum markierten Op
export function codeTarget(cs, target) {
  const net = cs.net;
  if (net.extClass(target)) return target;
  if (net.datComp.has(target)) return net.datComp.get(target);
  const comp = net.compOf(target);
  return comp;
}

export function memberInfo(cs, dat, member) {
  const net = cs.net;
  const callers = net.callersOf(dat, member.name);
  const callees = net.calleesOf(dat, member.name);
  const td = net.tdCaller(dat, member.name);
  const cat = memberCategory(member);
  const comp = net.datComp.get(dat);
  const external = callers.filter((c) => {
    const from = net.datComp.get(c.from.dat) ?? parentOf(c.from.dat);
    return !(from === comp || (comp && from && from.startsWith(comp + "/") && !net.extClass(from)));
  });
  const writes = net.accesses(dat).filter((a) => a.func === member.name && (a.how === "write" || a.how === "mutate") && !/^(eval|par)[A-Z]/.test(a.name));
  const reads = net.accesses(dat).filter((a) => a.func === member.name && a.how === "read" && !/^(eval|par)[A-Z]/.test(a.name) && a.name !== "ownerComp");
  let role = "";
  if (cat === "intern") role = callers.length >= 2 ? "ZENTRUM" : (callers.length === 0 ? "ISOLIERT" : "ZUBRINGER");
  return { member, cat, callers, callees, td, external, writes, reads, role };
}

function callerNames(cs, mi) {
  const names = mi.callers.map((c) => (c.from.dat === mi.member.dat ? c.from.name : c.from.name));
  if (mi.td && mi.td.kind === "par") names.unshift(`TD (Par ${mi.td.par})`);
  if (mi.td && mi.td.kind === "td") names.unshift("TD");
  return [...new Set(names)];
}

function calleeNames(mi) {
  return [...new Set(mi.callees.map((c) => c.to.name))];
}

function changeNames(mi) {
  const facts = mi.member.facts || {};
  const names = [...new Set(mi.writes.map((w) => w.name))];
  for (const w of facts.par_writes || []) {
    const m = /Par (\S+)/.exec(w);
    if (m) names.push(`Par ${m[1]}`);
  }
  return [...new Set(names)];
}

export function memberHit(cs, dat, mi, { landkarte = false } = {}) {
  const m = mi.member;
  const name = m.name;
  const callers = callerNames(cs, mi);
  const callees = calleeNames(mi);
  const changes = changeNames(mi);
  let text;
  let detail;
  if (mi.cat === "intern") {
    text = `${mi.role}   ·   von ${listText(callers)} → ruft ${listText(callees)} · ändert ${listText(changes)}`;
    detail = `Z.${m.line} · von ${mi.callers.length} · ruft ${callees.length}`;
  } else if (mi.cat === "property") {
    const returns = (m.facts && m.facts.returns) || [];
    text = `${name}   ·   PROPERTY   ·   gibt ${listText(returns)}   ·   EXT ${mi.external.length}`;
    detail = "PROPERTY";
  } else if (mi.cat === "callback") {
    text = `${name}()   ·   ${mi.td ? `TD: Par ${mi.td.par} (${mi.td.style || "Par"})` : "TD"}   →   ruft ${listText(callees)}`;
    detail = "CALLBACK";
  } else if (mi.cat === "lifecycle") {
    text = `${name}()   ·   von: TD   →   ruft ${listText(callees)}`;
    detail = "LIFECYCLE";
  } else {
    text = `${name}()   ·   EXT ${mi.external.length}   ·   ${m.doc || "ruft " + listText(callees)}`;
    detail = "PUBLIC";
  }
  const kind = landkarte ? "symbol" : "method";
  const h = hit(kind, abs(dat), text, { line: m.line, ctx: name, detail });
  h.cat = mi.cat === "property" && !landkarte ? "public" : mi.cat;
  if (landkarte) {
    h.cat = mi.cat;
    h.chip_text = mi.cat === "intern" ? mi.role : (cs.ui.CAT_CHIP || {})[mi.cat] || mi.cat.toUpperCase();
    h.art = h.chip_text;
  } else {
    h.art = mi.cat === "intern" ? mi.role : `+ ${(cs.ui.CAT_CHIP || {})[mi.cat === "property" ? "public" : mi.cat] || mi.cat.toUpperCase()}`;
  }
  h.symbol = name;
  return h;
}

export function stateSites(cs, dat, name) {
  const net = cs.net;
  const lines = net.lines(dat);
  return net.accesses(dat, name).map((a) => {
    const code = (lines[a.line - 1] || "").trim();
    const m = /=\s*(.+?)\s*(#.*)?$/.exec(code);
    return { ...a, code, value: a.how === "read" ? "" : (m ? m[1] : "") };
  });
}

function stateHit(cs, dat, state, { landkarte = false } = {}) {
  const sites = stateSites(cs, dat, state.name);
  const writers = [...new Set(sites.filter((s) => s.how === "write" || s.how === "mutate").map((s) => s.func))];
  const readers = [...new Set(sites.filter((s) => s.how === "read").map((s) => s.func))];
  const init = sites.some((s) => s.how === "init");
  const text = writers.length
    ? `${state.name}   ·   ${writers.length} SCHREIBER: ${listText(writers)}   ·   liest ${listText(readers)}`
    : `${state.name}   ·   init ${init ? "✓" : "✗"}   ·   nur gelesen von ${listText(readers)}`;
  const h = hit(landkarte ? "symbol" : "state", abs(dat), text, { line: state.line, ctx: state.name, detail: "STATE" });
  h.cat = "state";
  if (landkarte) h.chip_text = "STATE";
  h.art = landkarte ? "STATE" : "+ STATE";
  h.symbol = state.name;
  h.expanded = false;
  return h;
}

export function stateSiteRows(cs, dat, name) {
  return stateSites(cs, dat, name).map((s) => {
    const art = s.how === "init" ? "INIT" : (s.how === "read" ? "LIEST" : "SCHREIBT");
    const h = hit("self", abs(dat), `${s.func}   ·   Z.${s.line}   ·   ${s.code}`, { line: s.line, ctx: name, detail: art });
    h.art = art;
    h.site_of = name;
    return h;
  });
}

function parHit(cs, dat, name, comp) {
  const value = cs.lab.helperParValue(comp, name.replace(/^(eval|par)/, ""));
  const h = hit("parstate", abs(dat), `${name} = ${value}`, { ctx: name, detail: "PARAMETER" });
  h.art = "PAR";
  h.cat = "par";
  h.symbol = name;
  return h;
}

// Ketten ab Einstiegen (KETTEN-Sektion): onParFire  →  RouteEvent  →  [_warm, _cool, _neutral]  →  _send …
export function chainText(cs, dat, start, depth = 6, width = 4) {
  const net = cs.net;
  const parts = [start];
  let level = [{ dat, name: start }];
  const seen = new Set([`${dat}:${start}`]);
  for (let i = 0; i < depth && level.length; i += 1) {
    const next = [];
    for (const node of level) {
      for (const c of net.calleesOf(node.dat, node.name)) {
        const key = `${c.to.dat}:${c.to.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(c.to);
      }
    }
    if (!next.length) break;
    const names = next.map((n) => n.name);
    parts.push(names.length === 1 ? names[0] : `[${names.slice(0, width).join(", ")}${names.length > width ? `, +${names.length - width}` : ""}]`);
    level = next;
  }
  return parts.join("  →  ");
}

export function buildStructure(cs, target) {
  const net = cs.net;
  const comp = codeTarget(cs, target);
  const ext = net.extClass(comp);
  const rows = [];
  if (!ext) {
    const dat = net.code[target] ? target : null;
    if (dat) return buildModuleStructure(cs, dat);
    rows.push(info("INFO", comp, `${baseName(comp) || "CodeSearch_Tutorial"} hat keine Extension`, "markiere eine Extension oder einen Python-DAT"));
    return { rows };
  }
  const dat = ext.dat;
  const members = ext.cls.members.map((m) => memberInfo(cs, dat, m));
  const states = net.states(dat);
  const pars = net.helperPars(dat);
  const symbols = members.length + states.length;
  const edges = members.reduce((n, mi) => n + mi.callees.length, 0);
  const entries = members.filter((mi) => mi.cat === "callback" || mi.external.length).length;
  const z = hit("target", abs(comp), `${ext.cls.name}   ·   ${symbols} Symbole   ·   ${edges} Kanten   ·   ${entries} Einstiege`, { detail: "ZIEL", ctx: ext.cls.name });
  z.art = "ZIEL";
  rows.push(z);
  rows.push(action("SNAPSHOT", "SNAPSHOT   ·   Enter oder Klick   →   Karte speichern (für Δ-Vergleich)", "SAVEMAP", comp));
  rows.push(action("KONTEXT", "FÜR AGENT   ·   ganze Extension: KARTE + EINSTIEGE als Datei", "CONTEXT", comp));
  rows.push(action("LANDKARTE", "LANDKARTE   ·   Enter oder Klick   →   jede Methode mit REIN, RUFT, ÄNDERT", "LANDKARTE", comp));
  rows.push(action("REVIEW", "REVIEW   ·   Kategorie-Tabelle in die Zwischenablage", "REVIEW", comp));
  rows.push(action("SYSTEM", "SYSTEM   ·   ein FLUSS-Satz und sechs Sektionen", "SYSTEM", comp));
  let num = 0;
  const add = (title, rest, list) => {
    num += 1;
    rows.push(section(title, rest, list.length, { num: String(num) }));
    rows.push(...list);
  };
  const starts = members.filter((mi) => mi.cat === "callback" || (mi.cat === "lifecycle" && mi.member.name === "onInitTD") || mi.external.length);
  add("KETTEN", "ab jedem Einstieg: wer ruft wen (Ebenen, Zyklen enden)", starts.map((mi) => {
    const h = hit("symbol", abs(dat), chainText(cs, dat, mi.member.name), { line: mi.member.line, ctx: mi.member.name, detail: "KETTE" });
    h.art = "KETTE";
    h.symbol = mi.member.name;
    return h;
  }));
  const ui = cs.ui;
  add("PUBLIC API", ui.CAT_SECTION_HELP.public, members.filter((mi) => mi.cat === "public" || mi.cat === "property").map((mi) => memberHit(cs, dat, mi)));
  add("CALLBACKS", ui.MAP_SECTION_REST.callback, members.filter((mi) => mi.cat === "callback").map((mi) => memberHit(cs, dat, mi)));
  add("LIFECYCLE", ui.MAP_SECTION_REST.lifecycle, members.filter((mi) => mi.cat === "lifecycle").map((mi) => memberHit(cs, dat, mi)));
  add("INTERN", ui.MAP_SECTION_REST.intern, members.filter((mi) => mi.cat === "intern").map((mi) => memberHit(cs, dat, mi)));
  add("STATE", ui.CAT_SECTION_HELP.state, states.map((s) => stateHit(cs, dat, s)));
  add("PARAMETER", ui.CAT_SECTION_HELP.par, pars.map((p) => parHit(cs, dat, p, comp)));
  rows.push(action("PRÜFEN", `BEFUNDE   ·   Enter oder Klick   →   Tab AUDIT`, "GOCHECK", comp));
  const mods = net.within(comp, false).filter((o) => net.code[o.path] && !net.datComp.has(o.path));
  if (mods.length) {
    add("MODUL- UND CALLBACK-DATS", "Python-DATs im Ziel, die keine Extension-Quelle sind", mods.map((o) => {
      const fns = (net.code[o.path].functions || []).map((f) => f.name);
      const h = hit("mapfile", abs(o.path), `${o.name}   ·   ${o.type.endsWith("executeDAT") || o.name.endsWith("callbacks") ? "CALLBACKS" : "MODUL"}   ·   ${fns.length} Funktionen: ${listText(fns)}`, { detail: o.type.endsWith("executeDAT") || o.name.endsWith("callbacks") ? "CALLBACKS" : "MODUL" });
      h.art = h.detail;
      return h;
    }));
  }
  const maps = cs.state.savedMaps.filter((m) => m.comp === comp);
  num += 1;
  rows.push(section("GESPEICHERTE KARTEN", "Snapshots für den Vergleich: Enter auf A, dann auf B", maps.length, { num: String(num) }));
  maps.forEach((m, i) => {
    const h = hit("mapfile", abs(comp), `${String.fromCharCode(65 + i)}   ·   ${m.time}   ·   ${m.symbols.length} Symbole`, { detail: "KARTE", ctx: String(i) });
    h.art = "KARTE";
    h.map_index = i;
    rows.push(h);
  });
  return { rows, dat, comp };
}

function buildModuleStructure(cs, dat) {
  const net = cs.net;
  const rows = [];
  const model = net.code[dat];
  const z = hit("target", abs(dat), `${baseName(dat)}   ·   Python-DAT   ·   ${(model.functions || []).length} Funktionen`, { detail: "ZIEL" });
  z.art = "ZIEL";
  rows.push(z);
  rows.push(section("FUNKTIONEN", "Modul-Funktionen dieses DATs", (model.functions || []).length, { num: "1" }));
  for (const f of model.functions || []) {
    const callees = net.calleesOf(dat, f.name).map((c) => `${c.to.name}`);
    const h = hit("method", abs(dat), `${f.name}()   ·   ruft ${listText(callees)}`, { line: f.line, ctx: f.name, detail: "FUNKTION" });
    h.art = "+ FUNKTION";
    rows.push(h);
  }
  return { rows, dat, comp: net.op(dat).parent };
}

export function buildLandkarte(cs, target, datFilter = "") {
  const net = cs.net;
  const comp = codeTarget(cs, target);
  const ext = net.extClass(comp);
  if (!ext) return { rows: [info("INFO", comp, "keine Extension im Ziel")] };
  const dat = ext.dat;
  const members = ext.cls.members.map((m) => memberInfo(cs, dat, m));
  const rows = [];
  const ui = cs.ui;
  let num = 0;
  for (const cat of ui.CAT_ORDER || ["lifecycle", "state", "public", "callback", "property", "intern"]) {
    let list;
    if (cat === "state") {
      list = [];
      for (const s of net.states(dat)) {
        const h = stateHit(cs, dat, s, { landkarte: true });
        const open = cs.state.expandedStates.has(`${dat}:${s.name}`);
        h.expanded = open;
        list.push(h);
        if (open) list.push(...stateSiteRows(cs, dat, s.name));
      }
    } else {
      list = members.filter((mi) => mi.cat === cat).map((mi) => memberHit(cs, dat, mi, { landkarte: true }));
    }
    if (!list.length) continue;
    num += 1;
    rows.push(section(ui.CAT_TITLE[cat] || cat.toUpperCase(), ui.CAT_SECTION_HELP[cat] || "", list.filter((r) => r.kind !== "self").length, { num: String(num) }));
    rows.push(...list);
  }
  return { rows, dat, comp };
}

// Detail einer Methode / eines States: DATENFLUSS, AUFRUFE, AKTIONEN, Code
export function symbolDetail(cs, dat, name) {
  const net = cs.net;
  const member = net.member(dat, name);
  const blocks = [];
  if (member) {
    const mi = memberInfo(cs, dat, member);
    const f = member.facts || {};
    const rein = [...(member.params || []).map((p) => `Argument ${p}`), ...(f.par_reads || []), ...(f.pulls || []),
      ...mi.reads.map((r) => `liest self.${r.name} (Z.${r.line})`)];
    const back = (f.returns && f.returns.length) ? f.returns : ["None (kein return mit Wert)"];
    const aendert = [...mi.writes.map((w) => `schreibt self.${w.name} (Z.${w.line})`), ...(f.par_writes || []), ...(f.effects || [])];
    blocks.push({ title: "DATENFLUSS", rows: [
      ["REIN", rein.length ? rein.join("\n") : "—"],
      ["GIBT ZURÜCK", back.join("\n")],
      ["ÄNDERT", aendert.length ? aendert.join("\n") : "—"],
    ] });
    const astInfo = (net.code[dat].ast || {})[name] || {};
    if ((astInfo.locals || []).length || (astInfo.guards || []).length) {
      const local = [];
      for (const l of astInfo.locals || []) local.push([`Z.${l.line}`, `${l.name} = ${l.value}`]);
      for (const g of astInfo.guards || []) local.push([`Z.${g.line}`, `if ${g.test}:${g.returns ? "   → return (Guard)" : ""}`]);
      blocks.push({ title: "LOKAL · GUARDS", rows: local });
    }
    const von = callerNames(cs, mi).map((n) => {
      const ext = mi.external.find((c) => c.from.name === n);
      return ext ? `◄ AUSSEN ${baseName(ext.from.dat)}.${n}` : n;
    });
    blocks.push({ title: "AUFRUFE", rows: [
      ["VON", von.length ? von.join("\n") : "— (kein Aufrufer im Modell)"],
      ["RUFT", calleeNames(mi).length ? mi.callees.map((c) => `${c.to.name}()  Z.${c.line}${c.to.dat !== dat ? `  ◄ ${baseName(c.to.dat)}` : ""}`).join("\n") : "—"],
      ["ROLLE", mi.role || (cs.ui.CAT_LABEL || {})[mi.cat] || mi.cat],
    ] });
    const lifecycle = mi.cat === "lifecycle";
    blocks.push({ title: "AKTIONEN", rows: [
      ["IMPACT", "Strg+I: was hängt daran", "impact"],
      ["ROUTE", "Strg+Umschalt+I: wer ruft das, bis zum Auslöser", "route"],
      ["AUSFÜHREN", lifecycle ? "gesperrt: LEBENSZYKLUS – RUFT NUR TD" : "Rechtsklick → AUSFÜHREN", lifecycle ? "" : "exec"],
      ["KOPIEREN", `Strg+C: ${addressOfSymbol(cs, dat, name, "op_relative")}`, "copy"],
    ] });
  } else {
    const sites = stateSites(cs, dat, name);
    if (sites.length) {
      const values = cs.lab.stateValue(dat, name);
      blocks.push({ title: "STATE", rows: [
        ["WERT JETZT", values === undefined ? "—" : String(values)],
        ["INIT", sites.filter((s) => s.how === "init").map((s) => `Z.${s.line} ${s.code}`).join("\n") || "✗ nicht in __init__"],
        ["SCHREIBT", sites.filter((s) => s.how === "write" || s.how === "mutate").map((s) => `${s.func} Z.${s.line}: ${s.value || s.code}`).join("\n") || "—"],
        ["LIEST", sites.filter((s) => s.how === "read").map((s) => `${s.func} Z.${s.line}`).join("\n") || "—"],
      ] });
    }
  }
  return blocks;
}

// ADRESSE eines Symbols je nach DATEN-Format (op(relativ) eines Methodenaufrufs = parent().Name())
export function addressOfSymbol(cs, dat, name, format) {
  const comp = cs.net.datComp.get(dat);
  const member = cs.net.member(dat, name);
  const call = member && !member.property ? `${name}()` : name;
  const base = cs.state.display.base;
  const compAbs = abs(comp ?? "");
  if (format === "name") return call;
  if (format === "full") return `${compAbs}.${call}`;
  if (format === "relative") return compAbs === base ? call : `${compAbs.slice(base.length + 1) || baseName(compAbs)}.${call}`;
  if (format === "op_full") return `op('${compAbs}').${call}`;
  if (compAbs === base) return `parent().${call}`;
  const rel = compAbs.startsWith(base + "/") ? compAbs.slice(base.length + 1) : compAbs;
  return `op('${rel}').${call}`;
}

// ------------------------------------------------------------------------------------------ IMPACT
export function buildImpact(cs, dat, name) {
  const net = cs.net;
  const rows = [];
  const head = hit("impact", abs(dat), `${baseName(dat)}.${name}   ·   was hängt daran`, { ctx: name, detail: "IMPACT" });
  head.art = "IMPACT";
  rows.push(head);
  const member = net.member(dat, name);
  const leser = [];
  const seen = new Set();
  const up = (d, n, depth) => {
    for (const c of net.callersOf(d, n)) {
      const key = `${c.from.dat}:${c.from.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const via = (cs.ui.IMPACT_VIA_TEXT || {})[c.via] || c.via;
      const h = hit("impact", abs(c.from.dat), `${"   ".repeat(depth)}${c.from.name}()   ${via}   ${n}()   ·   Z.${c.line}`, { line: c.line, ctx: c.from.name, detail: "AUFRUFER" });
      h.art = "AUFRUFER";
      leser.push(h);
      up(c.from.dat, c.from.name, depth + 1);
    }
  };
  if (member) up(dat, name, 0);
  else {
    for (const s of stateSites(cs, dat, name).filter((x) => x.how !== "init")) {
      const h = hit("impact", abs(dat), `${s.func}   ${s.how === "read" ? "liest" : "verändert"}   self.${name}   ·   Z.${s.line}`, { line: s.line, ctx: s.func, detail: s.how === "read" ? "LESER" : "SCHREIBER" });
      h.art = s.how === "read" ? "LESER" : "AUFRUFER";
      leser.push(h);
    }
  }
  rows.push(section("LESER / AUFRUFER", "wer daran hängt (rückwärts)", leser.length, { num: "1" }));
  rows.push(...leser);
  const effects = [];
  if (member) {
    const mi = memberInfo(cs, dat, member);
    for (const w of changeNames(mi)) {
      const h = hit("impact", abs(dat), `ändert ${w}`, { ctx: name, detail: "AUSWIRKUNG" });
      h.art = "ÄNDERT";
      effects.push(h);
    }
    for (const c of mi.callees) {
      const h = hit("impact", abs(c.to.dat), `ruft ${c.to.name}()   ·   Z.${c.line}`, { line: c.line, ctx: c.to.name, detail: "AUSWIRKUNG" });
      h.art = "RUFT";
      effects.push(h);
    }
  }
  rows.push(section("AUSWIRKUNGEN", "was es verändert oder weiterruft", effects.length, { num: "2" }));
  rows.push(...effects);
  const doors = entriesFor(cs, net.datComp.get(dat) ?? parentOf(dat), "selection").filter((e) => reaches(cs, e, dat, name));
  rows.push(section("EINSTIEGE", "Auslöser, die hier ankommen", doors.length, { num: "3" }));
  doors.forEach((e) => rows.push(entryHit(cs, e)));
  return { rows };
}

function reaches(cs, entry, dat, name) {
  if (!entry.dat || !entry.method) return false;
  const seen = new Set();
  const walk = (d, n) => {
    if (d === dat && n === name) return true;
    const key = `${d}:${n}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return cs.net.calleesOf(d, n).some((c) => walk(c.to.dat, c.to.name));
  };
  return walk(entry.dat, entry.method);
}

// ------------------------------------------------------------------------------------------ TRIGGERS
// Einstiege eines Code-Ziels: TD ruft deinen Code / TD holt Werte / du loest aus / anderer Code ruft
export function entriesFor(cs, comp, context = "selection") {
  const net = cs.net;
  const comps = context === "comp" ? [comp, ...net.within(comp, true).filter((o) => o.family === "COMP" && net.extClass(o.path)).map((o) => o.path)] : [comp];
  const out = [];
  for (const c of comps) {
    const ext = net.extClass(c);
    if (ext) {
      for (const m of ext.cls.members) {
        const td = net.tdCaller(ext.dat, m.name);
        if (td && td.kind === "par") {
          const pulse = (td.style || "") === "Pulse";
          out.push({ group: "td", when: pulse ? `Pulse an Par ${td.par}` : `Wert von Par ${td.par}`, source: `${c}`, sourceText: `${baseName(c)}.par.${td.par}`,
            method: m.name, dat: ext.dat, state: "AN", sure: pulse, line: m.line, comp: c });
        }
        if (m.name === "onInitTD") {
          out.push({ group: "td", when: "Extension startet", source: c, sourceText: `${baseName(c)} (Extension)`, method: m.name, dat: ext.dat, state: "AN", sure: true, line: m.line, comp: c });
        }
      }
    }
    for (const o of net.within(c, false)) {
      if (o.stub) continue;
      if (o.type === "executeDAT" && o.pars && o.pars.framestart && o.pars.framestart.v) {
        const fn = (net.code[o.path]?.functions || [])[0];
        out.push({ group: "td", when: "jeden Frame", source: o.path, sourceText: o.name, method: fn ? fn.name : "onFrameStart", dat: o.path, state: "HOT", sure: true, line: fn?.line, comp: c, hot: true });
      }
      if (o.type === "chopexecuteDAT") {
        const watched = net.edgesTo(o.path, ["watch"])[0];
        const active = !(o.pars && o.pars.active && o.pars.active.v === false);
        const fn = (net.code[o.path]?.functions || [])[0];
        const isOuter = c !== net.compOf(o.path);
        out.push({ group: isOuter ? "other" : "td", when: `Wert von CHOP ${watched ? baseName(watched.src) : "?"} ändert sich`, source: o.path, sourceText: o.name,
          method: fn ? fn.name : "onValueChange", dat: o.path, state: active ? "AN" : "AUS", sure: true, line: fn?.line, comp: c, watched: watched ? watched.src : null });
      }
      if (o.type === "keyboardinDAT") {
        const cb = net.edgesTo(o.path, ["callbacks"])[0];
        const fn = cb ? (net.code[cb.src]?.functions || []).find((f) => f.name === "onKey") : null;
        const keys = o.pars && o.pars.keys ? o.pars.keys.v : "";
        const active = !(o.pars && o.pars.active && o.pars.active.v === false);
        out.push({ group: "input", when: `Taste ${String(keys).toUpperCase()}`, source: o.path, sourceText: o.name, method: fn ? fn.name : "onKey", dat: cb ? cb.src : o.path,
          state: active ? "AN" : "AUS", sure: true, line: fn?.line, comp: c });
      }
    }
    // Werte: Expressions, die eine Property der Extension lesen
    for (const e of net.edges.filter((x) => x.kind === "expr" && x.src === c && /\.(\w+)\s+if/.test(x.text || ""))) {
      const prop = /\.(\w+)\s+if/.exec(e.text)[1];
      if (ext && net.member(ext.dat, prop)) {
        out.push({ group: "value", when: `Wert für ${e.par} benötigt`, source: e.dst, sourceText: `${baseName(e.dst)}.par.${e.par}`, method: prop, dat: ext.dat, state: "AN", sure: true, comp: c, expr: e.text });
      }
    }
    // Anderer Code ruft: Aufrufer ausserhalb dieses COMPs
    if (ext) {
      for (const call of net.calls.filter((x) => x.to.dat === ext.dat)) {
        const fromComp = net.datComp.get(call.from.dat) ?? parentOf(call.from.dat);
        if (fromComp === c || call.from.dat === ext.dat) continue;
        if (context === "comp" && comps.includes(fromComp)) continue;
        out.push({ group: "other", when: "anderer Code ruft", source: call.from.dat, sourceText: `${baseName(call.from.dat)}.${call.from.name}`, method: call.to.name, dat: ext.dat,
          state: "≈ AN", sure: false, line: call.line, comp: c, caller: call });
      }
    }
  }
  return out;
}

export function entryHit(cs, e) {
  const h = hit("entry", abs(e.source), `${e.sourceText}   →   ${e.method}()   ·   ${e.state}`, { line: e.line ?? null, ctx: e.method, detail: e.method });
  h.art = e.sure ? e.when : `≈ ${e.when}`;
  h.entry_when = e.when;
  h.entry_state = e.state;
  h.entry_dat = abs(e.dat);
  h.entry_group = e.group;
  return h;
}

export function buildTriggers(cs, target) {
  const comp = codeTarget(cs, target);
  const context = cs.state.context === "comp" ? "comp" : "selection";
  const scopeComp = context === "comp" ? cs.state.paneOwner : comp;
  const entries = entriesFor(cs, scopeComp, context);
  const rows = [];
  const leg = hit("info", "", "ROT = jeden Frame · GRAU = ausgeschaltet · ≈ = nur nach Namenskonvention", { detail: "LEGENDE" });
  leg.art = "LEGENDE";
  rows.push(section("LEGENDE", "", 0, { num: "0" }));
  rows.push(leg);
  const groups = [
    ["td", "TD RUFT DEINEN CODE", "TD ruft eine Funktion in deinem Code, wenn sich etwas ändert"],
    ["value", "TD HOLT SICH WERTE", "TD liest oder schreibt einen Parameter, der deinen Code fragt"],
    ["input", "DU LÖST AUS (Maus/Taste)", "Du löst es aus: Taste, Klick oder Panel"],
    ["other", "ANDERER CODE RUFT", "Code außerhalb des Ziels ruft eine öffentliche Methode"],
  ];
  groups.forEach(([key, title, rest], i) => {
    const list = entries.filter((e) => e.group === key);
    rows.push(section(title, rest, list.length, { num: String(i + 1) }));
    list.forEach((e) => rows.push(entryHit(cs, e)));
  });
  rows.push(action("AUDIT", "Befunde zu API und Auslösern   →   Tab AUDIT", "GOCHECK", comp));
  const scopeText = context === "comp"
    ? `DIESE COMP: ${baseName(scopeComp)} samt Unter-COMPs · eine Node-Auswahl filtert hier nicht`
    : `AUSWAHL: ${baseName(comp)} (aufgelöst zum Code-Ziel)`;
  return { rows, entries, scopeText, comp: scopeComp };
}

// KETTE im Detail einer TRIGGERS-Zeile: Schritt fuer Schritt bis zur letzten Methode
export function entryChain(cs, entry) {
  const net = cs.net;
  const steps = [];
  if (!entry.dat || !entry.method) return steps;
  steps.push({ text: `${entry.sourceText}  →  ${entry.method}()`, dat: entry.dat, line: entry.line || null, name: entry.method });
  let current = { dat: entry.dat, name: entry.method };
  const seen = new Set();
  for (let i = 0; i < 8; i += 1) {
    const callees = net.calleesOf(current.dat, current.name);
    if (!callees.length) break;
    const first = callees[0];
    const key = `${first.to.dat}:${first.to.name}`;
    if (seen.has(key)) break;
    seen.add(key);
    const alt = callees.length > 1 ? `   (+${callees.length - 1} Zweige)` : "";
    steps.push({ text: `${current.name}  →  ${first.to.name}()${alt}`, dat: current.dat, line: first.line, name: first.to.name, from: current.name });
    current = first.to;
  }
  return steps;
}

// ------------------------------------------------------------------------------------------ CALL PATH
export function buildCallPath(cs, dat, start) {
  const net = cs.net;
  const rows = [];
  if (!dat || !start) {
    rows.push(section("EINSTIEG WÄHLEN", "die Einstiege wohnen im Tab TRIGGERS (Strg+Enter)", 1, { num: "1" }));
    rows.push(action("EINSTIEGE", "Einstiege   ·   Enter oder Klick   →   Tab TRIGGERS", "GOENTRIES"));
    return { rows };
  }
  rows.push(section(`AUFRUFKETTE ab ${start}`, "statisch aus dem Code: jeder mögliche Weg, Zweige klappbar", null, { num: "1" }));
  let step = 0;
  const closed = cs.state.tourClosed;
  const seen = new Set();
  const visit = (d, name, depth, viaLine) => {
    step += 1;
    const member = net.member(d, name);
    const h = hit("tourstep", abs(d), `${"   ".repeat(depth)}${step} · ${name}()${d !== dat ? `   ◄ ${baseName(d)}` : ""}`, { line: member ? member.line : viaLine, ctx: name, detail: member ? `Z.${member.line}` : "" });
    h.art = `SCHRITT ${step}`;
    h.depth = depth;
    rows.push(h);
    const key = `${d}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const astInfo = (net.code[d] && net.code[d].ast || {})[name] || {};
    const sites = (net.code[d] && net.code[d].sites || []).filter((s) => s.func === name && s.type === "call");
    const callees = net.calleesOf(d, name);
    // Guards mit return: eigener Zweig "wenn …: return"
    for (const g of astInfo.guards || []) {
      if (!g.returns) continue;
      const id = `${d}:${name}:guard:${g.line}`;
      const isClosed = closed.has(id);
      const b = hit("tourbranch", abs(d), `${"   ".repeat(depth + 1)}${isClosed ? "+" : "−"} wenn ${g.test}`, { line: g.line, ctx: name, detail: `Z.${g.line}` });
      b.art = "ZWEIG";
      b.branch_id = id;
      rows.push(b);
      if (!isClosed) {
        const r = hit("tourstep", abs(d), `${"   ".repeat(depth + 2)}↳ return   ·   Ende dieses Wegs`, { line: g.line + 1, ctx: name, detail: "STOPP" });
        r.art = "STOPP";
        rows.push(r);
      }
    }
    const groups = new Map();
    for (const c of callees) {
      const site = sites.find((s) => s.line === c.line && s.attr === c.to.name);
      const group = site && site.branch_group ? site.branch_group : "";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({ c, site });
    }
    for (const [group, list] of groups) {
      if (!group) {
        list.forEach(({ c }) => visit(c.to.dat, c.to.name, depth + 1, c.line));
        continue;
      }
      for (const { c, site } of list) {
        const id = `${d}:${name}:${group}:${site.branch_kind}:${c.line}`;
        const isClosed = closed.has(id);
        const label = site.branch_kind === "else" ? "else" : `${site.branch_kind === "elif" ? "sonst wenn" : "wenn"} ${site.branch_test}`;
        const b = hit("tourbranch", abs(d), `${"   ".repeat(depth + 1)}${isClosed ? "+" : "−"} ${label}`, { line: c.line, ctx: name, detail: `Z.${c.line}` });
        b.art = "ZWEIG";
        b.branch_id = id;
        rows.push(b);
        if (!isClosed) visit(c.to.dat, c.to.name, depth + 2, c.line);
      }
    }
  };
  visit(dat, start, 0, null);
  return { rows };
}

// ------------------------------------------------------------------------------------------ ROUTE
// Rueckweg einer Methode: Ausloeser (Hop 0) … START (hoechste Nummer). Je Pfeil: WARUM und WIE SICHER.
export function routeFor(cs, dat, name) {
  const net = cs.net;
  const hops = [{ dat, name, start: true }];
  const choices = [];
  let current = { dat, name };
  const seen = new Set([`${dat}:${name}`]);
  for (let i = 0; i < 12; i += 1) {
    const callers = net.callersOf(current.dat, current.name);
    if (!callers.length) {
      const td = net.tdCaller(current.dat, current.name);
      if (td && td.kind === "par") {
        hops.unshift({ trigger: true, text: `TD · Pulse an Par ${td.par} (${baseName(td.comp)})`, why: "TD-Auslöser", sure: "sicher", comp: td.comp, par: td.par });
      } else if (td && td.kind === "td") {
        hops.unshift({ trigger: true, text: "TD · Lebenszyklus der Extension", why: "TD-Auslöser", sure: "sicher" });
      } else {
        const entry = entriesFor(cs, net.datComp.get(current.dat) ?? parentOf(current.dat), "selection").find((e) => e.dat === current.dat && e.method === current.name);
        if (entry) hops.unshift({ trigger: true, text: `TD · ${entry.when} (${entry.sourceText})`, why: "TD-Auslöser", sure: "sicher" });
        else hops.unshift({ gap: true, text: "? LÜCKE – kein Aufrufer im Modell", why: "", sure: "" });
      }
      break;
    }
    const chosen = callers[0];
    if (callers.length > 1) {
      choices.push({ at: current.name, chosen: chosen.from.name, others: callers.slice(1).map((c) => c.from.name), line: chosen.line });
    }
    const key = `${chosen.from.dat}:${chosen.from.name}`;
    if (seen.has(key)) break;
    seen.add(key);
    const site = ((net.code[chosen.from.dat] || {}).ast || {})[chosen.from.name];
    const callSrc = site ? (site.calls || []).find((c) => c.line === chosen.line && c.attr === current.name) : null;
    const params = (net.member(current.dat, current.name) || {}).params || [];
    const args = callSrc ? callSrc.args : [];
    hops[0].via = { how: chosen.via, line: chosen.line, args: params.map((p, i) => ({ param: p.split(":")[0].trim(), arg: args[i] ?? "?" })) };
    hops.unshift({ dat: chosen.from.dat, name: chosen.from.name });
    current = chosen.from;
  }
  return { hops, choices };
}

const WHY_OF_VIA = { self: "self", op: "op('…') am COMP", shortcut: "Shortcut parent.X", ext: ".ext", run: "run()-String", name: "Name-Raten (getattr)" };

export function buildRoute(cs, dat, name) {
  const route = routeFor(cs, dat, name);
  const state = cs.state.route;
  const mode = state.mode || "ganz";
  const rows = [];
  const hops = route.hops;
  const sentence = hops.map((h) => (h.trigger || h.gap ? h.text : `${h.name}()`)).join("  →  ");
  const head = hit("route", abs(dat), `[${mode.toUpperCase()}]   SATZ: ${sentence}`, { ctx: name, detail: "ROUTE" });
  head.art = "ROUTE";
  rows.push(head);
  if (hops[0].gap) {
    const gap = hit("route", abs(dat), `? LÜCKE   ·   ${name}() hat im Modell keinen Aufrufer – im Code ruft sie niemand`, { ctx: name, detail: "LÜCKE" });
    gap.art = "? LÜCKE";
    rows.push(gap);
    const rec = action("AUFNAHME DIESER ROUTE", "▶ AUFNAHME DIESER ROUTE   ·   RECORD soll den Aufrufer zur Laufzeit sehen", "RECORDROUTE");
    rows.push(rec);
  }
  route.choices.forEach((c) => {
    const g = hit("route", abs(dat), `GEWÄHLT: ${c.chosen}()   weil: erster Aufrufer im Code (Z.${c.line})   ·   andere: ${c.others.map((o) => `${o}()`).join(", ")}`, { ctx: c.at, detail: "GABEL" });
    g.art = "GEWÄHLT";
    rows.push(g);
  });
  rows.push(section("HOPS", "Hop 0 = Auslöser oben · die höchste Nummer = START unten", hops.length, { num: "1" }));
  hops.forEach((h, i) => {
    if (mode === "schritt" && Math.abs(i - state.hop) > 1) return;
    const isStart = i === hops.length - 1;
    const text = h.trigger || h.gap ? h.text : `${h.name}()   ·   ${baseName(h.dat)} Z.${(cs.net.member(h.dat, h.name) || {}).line ?? "?"}${isStart ? "   ● START" : ""}`;
    const r = hit("routehop", h.dat ? abs(h.dat) : "", `HOP ${i}   ${text}`, { ctx: h.name || "", detail: i === state.hop ? "▶ hier" : "" });
    r.art = isStart ? "● START" : (h.trigger ? "AUSLÖSER" : `HOP ${i}`);
    r.hop = i;
    rows.push(r);
    if (h.via && i < hops.length) {
      const why = WHY_OF_VIA[h.via.how] || h.via.how;
      const arrow = hit("routearrow", h.dat ? abs(h.dat) : "", `   ↓ ruft über ${why}   ·   sicher   ·   Z.${h.via.line}`, { ctx: h.name || "", detail: "WARUM" });
      arrow.art = "↓";
      rows.push(arrow);
      const args = h.via.args || [];
      if (mode === "schritt") {
        args.forEach((a) => {
          const m = hit("routearg", h.dat ? abs(h.dat) : "", `   MIT ${a.param} ← ${a.arg}`, { ctx: a.param, detail: "MIT" });
          m.art = "MIT";
          m.param = a.param;
          rows.push(m);
        });
      } else if (args.length) {
        const m = hit("routearg", h.dat ? abs(h.dat) : "", `   MIT ${args.map((a) => `${a.param} ← ${a.arg}`).join("  ·  ")}`, { ctx: args[0].param, detail: "MIT" });
        m.art = "MIT";
        m.param = args.length === 1 ? args[0].param : "";
        m.params = args.map((a) => a.param);
        rows.push(m);
      }
    }
  });
  if (state.thread) {
    const lines = [];
    hops.forEach((h, i) => {
      for (const a of (h.via && h.via.args) || []) if (a.param === state.thread) lines.push(`HOP ${i}: ${a.param} ← ${a.arg}`);
    });
    rows.push(section(`FADEN ${state.thread}`, "ein Parameterwert über die Route", lines.length, { num: "2" }));
    lines.forEach((t) => {
      const r = hit("routearg", abs(dat), t, { ctx: state.thread, detail: "FADEN" });
      r.art = "FADEN";
      rows.push(r);
    });
  }
  return { rows, route };
}

// ------------------------------------------------------------------------------------------ Ueberblick / SYSTEM / REVIEW
export function buildOverview(cs, kind) {
  const net = cs.net;
  const rows = [];
  const comps = [...net.extDat.keys()];
  if (kind === "ext") {
    rows.push(section("ALLE EXTENSIONS", "Extension-COMPs im Projekt", comps.length, { num: "1" }));
    for (const c of comps) {
      const ext = net.extClass(c);
      const pub = ext.cls.members.filter((m) => memberCategory(m) === "public").length;
      const h = hit("opfind", abs(c), `${ext.cls.name}   ·   ${pub} public   ·   ${net.states(ext.dat).length} States   ·   ${net.lines(ext.dat).length} Zeilen`, { detail: baseName(ext.dat) });
      h.art = "EXT";
      rows.push(h);
    }
  } else if (kind === "atlas") {
    rows.push(section("ATLAS", "je Extension: Zentrum und Zubringer", comps.length, { num: "1" }));
    for (const c of comps) {
      const ext = net.extClass(c);
      const infos = ext.cls.members.map((m) => memberInfo(cs, ext.dat, m)).filter((mi) => mi.cat === "intern");
      const centers = infos.filter((mi) => mi.role === "ZENTRUM").map((mi) => mi.member.name);
      const h = hit("opfind", abs(c), `ZENTRUM ${listText(centers)}   ·   ZUBRINGER ${infos.filter((mi) => mi.role === "ZUBRINGER").length}`, { detail: ext.cls.name });
      h.art = centers.length ? "ZENTRUM" : "ZUBRINGER";
      rows.push(h);
    }
  } else if (kind === "short") {
    const list = [...net.ops.values()].filter((o) => o.pars && o.pars.parentshortcut);
    rows.push(section("SHORTCUTS", "Parent Shortcuts (parent.X) und Global OP Shortcuts (op.X)", list.length, { num: "1" }));
    for (const o of list) {
      const h = hit("opfind", abs(o.path), `parent.${o.pars.parentshortcut.v}   ·   von innen erreichbar`, { detail: o.type });
      h.art = "parent.X";
      rows.push(h);
    }
  } else if (kind === "health") {
    rows.push(section("GESUND", "Befunde je Extension (Details: AUDIT)", comps.length, { num: "1" }));
    for (const c of comps) {
      const findings = cs.auditFindings(c);
      const h = hit("opfind", abs(c), `${findings.filter((f) => f.art === "WARNUNG").length} Warnungen   ·   ${findings.filter((f) => f.art === "LINT" || f.art === "HINWEIS").length} Hinweise   ·   ${findings.filter((f) => f.art === "HOT").length} HOT`, { detail: "GESUND" });
      h.art = findings.some((f) => f.art === "WARNUNG") ? "WARNUNG" : "OK";
      rows.push(h);
    }
  }
  return { rows };
}

export function buildSystem(cs, target) {
  const net = cs.net;
  const comp = codeTarget(cs, target);
  const ext = net.extClass(comp);
  const rows = [];
  if (!ext) return { rows: [info("INFO", comp, "keine Extension")] };
  const dat = ext.dat;
  const entries = entriesFor(cs, comp, "selection");
  const first = entries.find((e) => e.group === "td" && e.when.startsWith("Pulse")) || entries[0];
  const flow = first ? `${first.when}  →  ${chainText(cs, first.dat, first.method)}` : chainText(cs, dat, ext.cls.members[0].name);
  const f = hit("system", abs(comp), `FLUSS: ${flow}`, { detail: "FLUSS" });
  f.art = "FLUSS";
  rows.push(f);
  const infos = ext.cls.members.map((m) => memberInfo(cs, dat, m));
  const blocks = [
    ["EINSTIEGE", entries.map((e) => `${e.when} → ${e.method}()`)],
    ["ZENTRUM", infos.filter((mi) => mi.role === "ZENTRUM").map((mi) => `${mi.member.name}() · von ${mi.callers.length}`)],
    ["STATE", net.states(dat).map((s) => s.name)],
    ["PARAMETER", net.helperPars(dat)],
    ["AUSSEN", infos.flatMap((mi) => mi.callees.filter((c) => c.to.dat !== dat).map((c) => `${mi.member.name} → ${baseName(c.to.dat)}.${c.to.name}()`))],
    ["BEFUNDE", cs.auditFindings(comp).map((x) => x.text)],
  ];
  blocks.forEach(([title, list], i) => {
    rows.push(section(title, "", list.length, { num: String(i + 1) }));
    list.forEach((t) => {
      const r = hit("system", abs(comp), t, { detail: title });
      r.art = title;
      rows.push(r);
    });
  });
  return { rows };
}

export function reviewTable(cs, target) {
  const net = cs.net;
  const comp = codeTarget(cs, target);
  const ext = net.extClass(comp);
  if (!ext) return "";
  const lines = [`# Review ${ext.cls.name} (${abs(comp)})`, "", "| Kategorie | Methode | von | ruft | ändert |", "|---|---|---|---|---|"];
  for (const m of ext.cls.members) {
    const mi = memberInfo(cs, ext.dat, m);
    lines.push(`| ${(cs.ui.CAT_LABEL || {})[mi.cat] || mi.cat} | ${m.name} | ${callerNames(cs, mi).join(", ") || "—"} | ${calleeNames(mi).join(", ") || "—"} | ${changeNames(mi).join(", ") || "—"} |`);
  }
  return lines.join("\n");
}

export function landkarteText(cs, target) {
  const { rows } = buildLandkarte(cs, target);
  return rows.map((r) => (r.kind === "section" ? `\n## ${r.text}` : `- ${r.ctx}: ${r.text}`)).join("\n");
}

export { notice, fmtNum };
