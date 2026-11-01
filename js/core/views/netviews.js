// USES (was liest der Op), USED BY (wer liest ihn), FLOW (ganze Strecke) - aus der Kanten-Tabelle des Netzes.

import { abs, baseName, fmtNum, parentOf } from "../util.js";
import { hit, section, info } from "./common.js";

export function opLabel(net, path) {
  const o = net.op(path);
  if (!o) return baseName(path);
  return `${o.name} (${net.shortType(path)}, ${o.family})`;
}

function parQuoted(edge) {
  return edge.label ? `Par ‚${edge.label}‘ (${edge.par})` : `Par ‚${edge.par}‘`;
}

function parLabel(edge) {
  return edge.label ? `Par ${edge.label} (${edge.par})` : `Par ${edge.par}`;
}

// aktueller Wert eines Parameters, so gut die Simulation ihn kennt
export function parValue(cs, path, par) {
  const lab = cs.lab;
  if (par === "opacity" && path === "BranchLab/level_expr") return fmtNum(lab.exprOpacity);
  if (par === "opacity" && path === "BranchLab/level_export") return fmtNum(lab.exportOpacity);
  if (par === "opacity" && path === "BranchLab/error_probe") return lab.errorActive ? "(Fehler)" : fmtNum(lab.control.gain);
  if (par === "index" && path === "BranchLab/switch_route") return fmtNum(lab.control.route);
  if (par === "size" && path === "BranchLab/SoftBranch/blur_soft") return fmtNum(lab.softSize);
  if (path === "BranchLab/ColorEngine/color" && /^color[rgb]$/.test(par)) return fmtNum(lab.rgb["rgb".indexOf(par.slice(-1))]);
  const o = cs.net.op(path);
  const v = o && o.pars && o.pars[par];
  if (v && "v" in v) return typeof v.v === "string" ? `„${v.v}“` : fmtNum(v.v);
  return "≈";
}

function exprRefsText(net, edges) {
  const refs = edges.map((e) => e.src).filter((s) => s !== null && s !== undefined);
  return refs.length ? "liest " + refs.map((r) => baseName(r) || net.root.name).join(", ") : "liest keinen festen Op";
}

// ------------------------------------------------------------------------------------------ USES
export function buildUses(cs, target) {
  const net = cs.net;
  const o = net.op(target);
  if (!o) return { rows: [info("INFO", "", `${target} gibt es nicht`)],up:[],down:[] };
  const rows = [];
  const inEdges = net.edgesTo(target);
  const sources = inEdges.filter((e) => e.kind !== "code" && e.src !== null && e.src !== undefined);
  const left = sources.length ? [...new Set(sources.map((e) => baseName(e.src) || net.root.name))].join(" · ") : "—";
  const flow = hit("flow", abs(target), `${left}  →  ${o.name} (${o.type})`, { detail: "ÜBERBLICK", ctx: o.name });
  flow.art = "ÜBERBLICK";
  rows.push(flow);

  // QUELLE: Kabel rein, Parameter-Quellen
  const quelle = [];
  (o.inputs || []).forEach((src, i) => {
    const h = hit("wire", abs(src), `IN ${i + 1}   ←   ${opLabel(net, src)}`, { detail: `IN ${i + 1}` });
    h.family = net.family(src);
    quelle.push(h);
  });
  // COMP: Kabel kommen ueber die In-OPs innen an
  if (o.family === "COMP") {
    net.compInOps(target).forEach((inOp, i) => {
      const src = (o.inputs || [])[i];
      if (src) return;
      quelle.push(hit("wire", abs(inOp.path), `IN ${i + 1}   ←   (innen ${inOp.name}, außen nichts angeschlossen)`, { detail: `IN ${i + 1}` }));
    });
  }
  const byPar = new Map();
  for (const e of inEdges) {
    if (e.kind === "expr" || e.kind === "bind") {
      if (!byPar.has(e.par)) byPar.set(e.par, []);
      byPar.get(e.par).push(e);
    }
  }
  for (const [par, edges] of byPar) {
    const e = edges[0];
    const value = parValue(cs, target, par);
    if (e.kind === "bind") {
      const h = hit("bind", abs(target), `= ${value}   ⟷   Bind an ${e.text}   ·   beide Richtungen`, { par, detail: `Par ${par}` });
      h.kind_note = `Bind: Par ‚${par}‘ von ${o.name} ist mit ${e.text} gekoppelt – Änderungen gehen in beide Richtungen.`;
      quelle.push(h);
    } else {
      const refs = edges.filter((x) => x.src !== null && x.src !== undefined).map((x) => abs(x.src)).join(", ");
      const h = hit("expr", abs(target), `= ${value}   ←   ${e.text}   ·   ${exprRefsText(net, edges)}`, { par, ctx: refs, detail: `Par ${par}` });
      h.kind_note = `Expression in Par ‚${par}‘ von ${o.name}: der Wert wird berechnet und liest ${refs || "keinen festen Op"}.`;
      quelle.push(h);
    }
  }
  for (const e of inEdges.filter((x) => x.kind === "export")) {
    const src = net.op(e.src);
    const h = hit("export", abs(e.src), `= ${parValue(cs, target, e.par)}   ⇐   ${src.name} Kanal „${e.channel}“ exportiert in Par ‚${e.par}‘ von ${o.name}`, { par: e.par, detail: `Par ${e.par}` });
    h.kind_note = `Export: ${src.name} schreibt Kanal „${e.channel}“ direkt in Par ‚${e.par}‘ – kein Kabel, die Verbindung steckt im Parameter.`;
    quelle.push(h);
  }
  for (const e of inEdges.filter((x) => ["oppar", "watch", "callbacks"].includes(x.kind))) {
    const watching = e.kind === "watch";
    const sentence = watching
      ? `${o.name} beobachtet ${baseName(e.src)} über ${parQuoted(e)}`
      : `${o.name} zeigt über ${parQuoted(e)} auf ${baseName(e.src)}`;
    const h = hit("oppar", abs(e.src), sentence, { par: e.par, detail: parLabel(e) });
    h.art = watching ? "WÄCHTER" : (e.kind === "callbacks" ? "CALLBACKS" : "PAR-REF");
    if (watching) h.kind_orig = "watcher";
    h.kind_note = `Kein Kabel: ${parQuoted(e)} von ${o.name} enthält „${e.text}“.`;
    quelle.push(h);
  }
  rows.push(section("QUELLE", "", quelle.length, { num: "1" }));
  rows.push(...quelle);

  // AUSLÖSER: Execute-DATs im COMP (nur bei COMPs)
  if (o.family === "COMP") {
    const triggers = triggerRows(cs, target);
    rows.push(section("AUSLÖSER", "", triggers.length, { num: "2" }));
    rows.push(...triggers);
  }

  // DIESER OP: Steckbrief
  const own = [];
  own.push(info("TYP", target, `${o.type}   ·   ${opForm(cs, target)}`, "TYP"));
  own.push(info("COOK", target, `${cookText(o)}   ·   Frame ${cs.lab.frame}`, "COOK"));
  const ext = net.extClass(target);
  if (ext) own.push(info("EXT", ext.dat, `${ext.cls.name}   ·   ${ext.cls.members.length} Mitglieder   ·   Quelle ${baseName(ext.dat)}`, "EXT"));
  if (o.family === "COMP") own.push(info("KINDER", target, `${net.kids(target).length} Kinder`, "KINDER"));
  for (const e of net.edgesFrom(target, ["callbacks"])) own.push(info("CALLBACKS", e.dst, `Callbacks-DAT ${baseName(e.dst)}`, "CALLBACKS"));
  for (const docked of net.within(parentOf(target) || "", false).filter((x) => x.dock === target)) {
    own.push(info("DOCK", docked.path, `${docked.name} (${docked.type}) ist angedockt`, "DOCK"));
  }
  rows.push(section("DIESER OP", "der Op selbst: Typ und Daten, Cook-Zeit, Extension, Kinder, Callbacks-DAT, angedockte DATs", own.length, { num: o.family === "COMP" ? "3" : "2" }));
  rows.push(...own);

  // Seit TD-CodeSearch 1.5 gehören Empfänger, Wächter und OUT-Kabel ausschließlich in USED BY.
  return { rows };
}

export function cookText(o) {
  // Am Handy gibt es keinen Cook: die Zahl steht nur als Form da und ist als simuliert markiert
  const ms = { TOP: "0.05 ms CPU · 0.02 ms GPU", CHOP: "0.01 ms CPU", DAT: "0.00 ms CPU", COMP: "0.09 ms CPU · 0.00 ms GPU" }[o.family];
  return `${ms || "0.00 ms"} (Handy: simuliert)`;
}

export function buildSymbolRefs(cs, dat, name) {
  const model = cs.net.dat(dat);
  const rows = [];
  for (const site of (model?.accesses || []).filter((s) => s.name === name)) {
    const h = hit("self", abs(dat), `${site.func} · ${site.how} self.${name} · ${cs.net.lines(dat)[site.line - 1]?.trim() || ""}`, { ctx: name, line: site.line, detail: "STATISCH" });
    h.art = site.how.toUpperCase(); rows.push(h);
  }
  for (const call of cs.net.callersOf(dat, name)) {
    const h = hit("code", abs(call.from.dat), `${call.from.name} ruft ${name}() · statisch erfasst`, { ctx: call.from.name, line: call.line, detail: "CALL" });
    h.art = "CALL"; rows.push(h);
  }
  if (!rows.length) rows.push(info("INFO", dat, `Keine Referenz auf ${name} im begrenzten Modell; kein Beweis der Nichtbenutzung`));
  return { rows };
}

export function opForm(cs, path) {
  const net = cs.net;
  const o = net.op(path);
  if (!o) return "";
  if (o.family === "COMP") return `COMP · ${net.kids(path).length} Kinder`;
  if (o.family === "CHOP") {
    if (path === "BranchLab/control") return `2 Kanäle: gain ${fmtNum(cs.lab.control.gain)} · route ${fmtNum(cs.lab.control.route)}`;
    if (path === "BranchLab/ColorEngine/rgb") return `3 Kanäle: r ${fmtNum(cs.lab.rgb[0])} · g ${fmtNum(cs.lab.rgb[1])} · b ${fmtNum(cs.lab.rgb[2])}`;
    return o.chans ? `${o.chans.length} Kanäle: ${o.chans.map((c) => c.name).join(", ")}` : "Kanäle";
  }
  if (o.family === "DAT") {
    if (path === "BranchLab/ColorEngine/palette") return `${cs.lab.palette.length} Zeilen × ${cs.lab.palette[0].length} Spalten`;
    if (o.table) return `${o.table.length} Zeilen × ${(o.table[0] || []).length} Spalten`;
    if (typeof o.text === "string") return `${o.text.split("\n").length} Zeilen Text`;
    return "DAT";
  }
  if (o.family === "TOP") {
    const w = o.pars && o.pars.resolutionw ? o.pars.resolutionw.v : 256;
    const h = o.pars && o.pars.resolutionh ? o.pars.resolutionh.v : 256;
    return `${w}×${h} · 8 bit RGBA`;
  }
  return o.family;
}

// Auslöser im COMP (USES): Execute-DATs und abgeschaltete Eingaben
export function triggerRows(cs, comp) {
  const net = cs.net;
  const out = [];
  for (const o of net.within(comp, true)) {
    if (o.stub || o.path.includes("/ExtUtils")) continue;
    let when = "";
    if (o.type === "executeDAT" && o.pars && o.pars.framestart && o.pars.framestart.v) when = "jeden Frame";
    else if (o.type === "chopexecuteDAT") when = "Kanal ändert sich";
    else if (o.type === "keyboardinDAT") when = "Taste";
    else continue;
    const model = net.dat(o.path) || net.dat(`${parentOf(o.path)}/${o.name}_callbacks`) || net.dat(o.pars && o.pars.callbacks ? `${parentOf(o.path)}/${o.pars.callbacks.v}` : "");
    const fn = model && model.functions && model.functions[0] ? model.functions[0].name : "";
    const active = !(o.pars && o.pars.active && o.pars.active.v === false);
    const call = (net.calls.find((c) => c.from.dat === o.path || c.from.dat === `${parentOf(o.path)}/${o.pars?.callbacks?.v}`) || null);
    const callText = call ? `   →   ${call.to.name}()` : "";
    const h = hit("trigger", abs(o.path), `${o.name} (${o.type}) · ${when}   →   ruft ${fn || "Callback"}()${callText}${active ? "" : "   ·   AUS"}`, { detail: when, ctx: o.name });
    h.art = "AUSLÖSER";
    out.push(h);
  }
  return out;
}

// ------------------------------------------------------------------------------------------ USED BY
export function buildUsedBy(cs, target) {
  const net = cs.net;
  const o = net.op(target);
  if (!o) return { rows: [info("INFO", "", `${target} gibt es nicht`)],up:[],down:[] };
  const home = o.parent || "";
  const groups = { NEBENAN: [], WOANDERS: [], INNEN: [] };
  const place = (path) => {
    if (net.isInside(path, target) && path !== target) return "INNEN";
    if (net.isInside(path, home) || (home === "" && !path.includes("/"))) {
      // im selben Netz: Geschwister und alles in ihnen
      const rest = home ? path.slice(home.length + 1) : path;
      return rest ? "NEBENAN" : "WOANDERS";
    }
    return "WOANDERS";
  };
  const add = (sub, path, row) => {
    const g = place(path);
    if (!groups[g][sub]) groups[g][sub] = [];
    groups[g][sub].push(row);
  };
  for (const e of net.edgesFrom(target)) {
    if (!e.dst) continue;
    const reader = net.op(e.dst);
    if (e.kind === "expr") {
      const h = hit("expr", abs(e.dst), `${reader.name}.par.${e.par}   ←   ${e.text}`, { par: e.par, detail: `Par ${e.par}` });
      add("Expressions", e.dst, h);
    } else if (e.kind === "bind") {
      add("Binds", e.dst, hit("bind", abs(e.dst), `${reader.name}.par.${e.par}   ⟷   ${e.text}`, { par: e.par, detail: `Par ${e.par}` }));
    } else if (e.kind === "export") {
      add("Exports", e.dst, hit("export", abs(e.dst), `exportiert Kanal „${e.channel}“ in ${reader.name}.par.${e.par}`, { par: e.par, detail: `Par ${e.par}` }));
    } else if (e.kind === "oppar" || e.kind === "watch" || e.kind === "callbacks") {
      const watching = e.kind === "watch";
      const active = !(reader.pars && reader.pars.active && reader.pars.active.v === false);
      const text = watching
        ? `${reader.name} beobachtet ${o.name} über ${parQuoted(e)}   →   ruft onValueChange()${active ? "" : "   ·   DAT aus (Par Active)"}`
        : `${reader.name} zeigt über ${parQuoted(e)} auf ${o.name}`;
      const h = hit("oppar", abs(e.dst), text, { par: e.par, detail: parLabel(e) });
      h.art = watching ? "WÄCHTER" : "PAR-REF";
      if (watching) h.kind_orig = "watcher";
      add("Par-Referenzen", e.dst, h);
    } else if (e.kind === "wire") {
      const h = hit("wire", abs(e.dst), `OUT   →   ${opLabel(net, e.dst)}   ·   Eingang ${e.index + 1}`, { detail: "OUT" });
      add("Kabel", e.dst, h);
    }
  }
  for (const e of net.edges.filter((x) => x.kind === "code" && x.dst === target)) {
    const line = net.lines(e.src)[e.line - 1] || "";
    const h = hit("code", abs(e.src), line.trim(), { line: e.line, detail: `Zeile ${e.line}`, ctx: net.enclosingFunction(e.src, e.line) || "" });
    h.hitkind = "CODE";
    add("Code", e.src, h);
  }
  const rows = [];
  let num = 0;
  const order = ["Par-Referenzen", "Expressions", "Exports", "Binds", "Code", "Kabel"];
  for (const title of ["NEBENAN", "WOANDERS", "INNEN"]) {
    const subs = groups[title];
    const total = order.reduce((n, k) => n + (subs[k] ? subs[k].length : 0), 0);
    if (!total) continue;
    num += 1;
    rows.push(section(title, "", total, { num: String(num) }));
    for (const sub of order) {
      if (!subs[sub]) continue;
      rows.push(section(sub, "", subs[sub].length, { level: 1 }));
      rows.push(...subs[sub]);
    }
  }
  if (!rows.length) rows.push(info("INFO", target, "niemand liest diesen Op über Kabel, Parameter oder festen Code-Verweis"));
  return { rows };
}

// ------------------------------------------------------------------------------------------ FLOW
const ART_OF_EDGE = { wire: "WIRE", expr: "EXPR", export: "EXPORT", bind: "BIND", oppar: "OPPAR" };

// Feedback TOP: sein Par 'top' liest den eigenen spaeteren Ausgang - diese Kante schliesst einen Kreis
export function isFeedbackEdge(net, e) {
  return e.kind === "oppar" && e.par === "top" && net.opType(e.dst) === "feedbackTOP";
}

function flowNeighbors(net, path, direction, arrivedBy, scope) {
  // Datenwege: Kabel, Parameter-Quellen und COMP-Grenzen (In/Out-OPs). Ein COMP ist nur ueber Kabel eine Station
  // der Strecke; ueber Binds/Expressions gelesen ist er Quelle eines Parameters, kein Bildweg.
  const out = [];
  const o = net.op(path);
  if (!o) return out;
  const compAsParam = o.family === "COMP" && arrivedBy && arrivedBy !== "WIRE" && arrivedBy !== "COMP-OUT" && arrivedBy !== "COMP-IN";
  if (direction < 0) {
    if (compAsParam) return out;
    for (const e of net.edgesTo(path)) {
      if (!["wire", "expr", "export", "bind", "oppar"].includes(e.kind) || e.src === null || e.src === undefined) continue;
      if (e.kind === "expr" && ["autoexportroot", "rate"].includes(e.par)) continue;
      if (isFeedbackEdge(net, e)) continue;
      out.push({ path: e.src, art: ART_OF_EDGE[e.kind] });
    }
    if (o.type.startsWith("in") && o.parent) {
      const comp = o.parent;
      const index = net.compInOps(comp).findIndex((x) => x.path === path);
      const src = (net.op(comp).inputs || [])[index];
      if (src) out.push({ path: src, art: "COMP-IN" });
    }
    if (o.family === "COMP" && arrivedBy === "WIRE") {
      for (const outOp of net.compOutOps(path)) out.push({ path: outOp.path, art: "COMP-OUT" });
    }
  } else {
    for (const e of net.edgesFrom(path)) {
      // Der Indexbereich begrenzt Parameterleser, nicht die Kabelstrecke.
      if(scope && ['expr','export','bind','oppar'].includes(e.kind)) {
        const reader=net.op(e.dst), inside=net.isInside(e.dst,scope.root);
        if(!inside || scope.flat && e.dst!==scope.root && reader?.parent!==scope.root)continue;
        if(!scope.includeSys && e.dst.split('/').some(part=>['ExtUtils','ExtUtils1','Tour'].includes(part)))continue;
      }
      if (!["wire", "expr", "export", "bind", "oppar"].includes(e.kind) || !e.dst) continue;
      if (o.family === "COMP" && e.kind !== "wire") continue;
      if (e.kind === "expr" && ["autoexportroot", "rate"].includes(e.par)) continue;
      if (isFeedbackEdge(net, e)) continue;
      if (e.kind === "wire" && net.isComp(e.dst)) {
        const inOp = net.compInOps(e.dst)[e.index];
        if (inOp) { out.push({ path: inOp.path, art: "COMP-IN" }); continue; }
      }
      out.push({ path: e.dst, art: ART_OF_EDGE[e.kind] });
    }
    if (o.type.startsWith("out") && o.parent) out.push({ path: o.parent, art: "COMP-OUT" });
  }
  return out;
}

export function buildFlow(cs, target, scope=null) {
  const net = cs.net;
  const o = net.op(target);
  if (!o) return { rows: [info("INFO", "", `${target} gibt es nicht`)],up:[],down:[] };
  const walk = (direction) => {
    const seen = new Map([[target, 0]]);
    const list = [];
    let frontier = [{ path: target, dist: 0, art: "" }];
    while (frontier.length) {
      const next = [];
      for (const item of frontier) {
        for (const n of flowNeighbors(net, item.path, direction, item.art, scope)) {
          if (seen.has(n.path)) continue;
          seen.set(n.path, item.dist + 1);
          const entry = { path: n.path, art: n.art, dist: item.dist + 1, from: item.path };
          list.push(entry);
          next.push(entry);
        }
      }
      frontier = next;
    }
    return { list };
  };
  const up = walk(-1);
  const down = walk(1);
  // Kreis: eine Feedback-Kante, deren beide Enden auf dieser Strecke liegen
  const onPath = new Set([target, ...up.list.map((e) => e.path), ...down.list.map((e) => e.path)]);
  const feedback = net.edges.find((e) => isFeedbackEdge(net, e) && onPath.has(e.src) && onPath.has(e.dst));
  const rows = [];
  const stage = hit("flow", abs(target), `QUELLEN ${up.list.length}  →  SELECTED  →  ZIELE ${down.list.length}`, { detail: "ETAPPEN" });
  stage.art = "ETAPPEN";
  rows.push(stage);
  const station = (entry, sign) => {
    const dist = sign < 0 ? `(←${entry.dist})` : `(→${entry.dist})`;
    const h = hit("chain", abs(entry.path), `${dist} ${abs(entry.path)}`, { detail: opForm(cs, entry.path), ctx: baseName(entry.path) });
    h.art = entry.art;
    h.dist = sign * entry.dist;
    h.family = net.family(entry.path);
    h.station = `${baseName(entry.path)} (${net.shortType(entry.path)}, ${net.family(entry.path)})`;
    return h;
  };
  rows.push(section("QUELLEN", "bis zu den Quellen; WIRE und unsichtbare Kanten", up.list.length, { num: "1" }));
  up.list.sort((a, b) => b.dist - a.dist).forEach((e) => rows.push(station(e, -1)));
  rows.push(section("SELECTED", "der markierte Op – Ausgang der Strecke", 1, { num: "2" }));
  const sel = hit("chain", abs(target), abs(target), { detail: opForm(cs, target), ctx: o.name });
  sel.art = "SELECTED";
  sel.dist = 0;
  sel.anchor = true;
  sel.family = o.family;
  rows.push(sel);
  rows.push(section("ZIELE", "bis zu den Ausgängen", down.list.length, { num: "3" }));
  down.list.sort((a, b) => a.dist - b.dist).forEach((e) => rows.push(station(e, 1)));
  if (feedback) {
    rows.push(section("RÜCKKOPPLUNG", "die Strecke kommt zu sich selbst zurück: ein Feedback-Kreis", 1, { num: "4" }));
    const fb = net.op(feedback.dst);
    const h = hit("chain", abs(feedback.dst), `${baseName(feedback.src)}  →  ${fb.name} (Par top liest den späteren Ausgang: der Kreis schließt sich)`, { detail: "KREIS", ctx: fb.name, par: "top" });
    h.art = "RÜCKKOPPLUNG";
    rows.push(h);
  }
  return { rows, up: up.list, down: down.list };
}

// >story: die Strecke als Text
export function flowStory(cs, target) {
  const flow = buildFlow(cs, target);
  const lines = [`# FLOW-Story ${abs(target)}`, ""];
  lines.push("QUELLEN:");
  flow.up.forEach((e) => lines.push(`  ${e.art}  ${abs(e.path)}  (←${e.dist})`));
  lines.push(`SELECTED: ${abs(target)}`);
  lines.push("ZIELE:");
  flow.down.forEach((e) => lines.push(`  ${e.art}  ${abs(e.path)}  (→${e.dist})`));
  return lines.join("\n");
}
