import {searchOptions,searchScopeOptions} from './search-options.js';
import {MAX_SEARCH_WINDOWS} from '../core/search-sessions.js';
// Ebenen ueber dem Fenster: TD-Seite (Netz, Parameter, Timeline), Kurs, Atlas, FlowLens, Popup, Schnellsuche, Lesekopien.

import { $, esc, md, updateHtml } from "./dom.js";
import { laptopOverview } from "./learningview.js";
import { abs, rel, baseName, fmtNum } from "../core/util.js";
import { artOf, artClass, pathText, codeHtml, snapshotCodeHtml, renderCS } from "./cswin.js";
import {createHostContext,hostTemplate,normalizeHostIds,hostQuery} from './cs-host.js';
import { rgb } from "./looks.js";

// ------------------------------------------------------------------ TD-Seite
const FAMILY_FILL = { TOP: "#5b3f86", CHOP: "#2f6b37", SOP: "#2c4f86", DAT: "#7a3d68", COMP: "#4c5260", MAT: "#7a6a2a", POP: "#2a6b6b" };
const EDGE_COLOR = { wire: "#56c8e6", expr: "#9ba6ed", oppar: "#9ba6ed", watch: "#e07bd0", callbacks: "#e07bd0", export: "#6fd27b", bind: "#a98cf0", code: "#e07bd0" };

export function renderTD(ctx) {
  const { cs, td } = ctx;
  const layer = $("#layer-td");
  layer.classList.toggle("show", td.open);
  if (!td.open) return;
  const tabs = [["net", "NETZ"], ["par", "PARAMETER"], ["time", "TIMELINE"]];
  let body = "";
  if (td.tab === "net") body = `<div class="network-panes ${cs.state.secondaryPane.open?'split':''}"><section class="network-pane" data-network-pane="primary">${netHtml(ctx)}</section>${cs.state.secondaryPane.open?`<section class="network-pane secondary" data-network-pane="secondary"><div class="secondary-title">ZWEITE NETZWERKANSICHT · Pocket-Nachbau<button data-act="net-secondary-close" aria-label="Zweite Netzwerkansicht schließen">✕</button></div>${netHtml(ctx,cs.state.secondaryPane)}</section>`:''}</div>`;
  if (td.tab === "par") body = parHtml(ctx);
  if (td.tab === "time") body = timeHtml(ctx);
  if (layer.contains(document.activeElement) && document.activeElement.matches('input,select,textarea')) return;
  updateHtml(layer, `<div class="lhead"><h1>TOUCHDESIGNER</h1>${tabs.map(([k, l]) => `<button data-tdtab="${k}" class="${td.tab === k ? "on" : ""}">${l}</button>`).join("")}<button data-act="td-close">✕</button></div>${body}`);
  void cs;
}

function netHtml(ctx, pane=null) {
  const { cs, td } = ctx;
  const net = cs.net;
  const owner = pane ? pane.owner : cs.state.paneOwner;
  const kids = net.kids(owner);
  const ownerOp = net.op(owner);
  const anns = (ownerOp && ownerOp.annotations) || [];
  const xs = [];
  const ys = [];
  for (const o of kids) { xs.push(o.pos[0], o.pos[0] + o.size[0]); ys.push(o.pos[1], o.pos[1] + o.size[1]); }
  for (const a of anns) { if (a.position && a.size) { xs.push(a.position[0], a.position[0] + a.size[0]); ys.push(a.position[1], a.position[1] + a.size[1]); } }
  const minX = Math.min(...xs, 0) - 60;
  const maxX = Math.max(...xs, 400) + 60;
  const minY = Math.min(...ys, 0) - 60;
  const maxY = Math.max(...ys, 300) + 60;
  const w = maxX - minX;
  const h = maxY - minY;
  // Feste, lesbare Groesse wie im Network Editor; das Netz wird verschoben (scrollen), nicht winzig gerechnet
  const scale = 0.62 * (pane ? pane.zoom || 1 : td.zoom);
  const W = Math.round(w * scale);
  const H = Math.round(h * scale);
  const X = (x) => (x - minX) * scale;
  const Y = (y) => (maxY - y) * scale;   // TD: y nach oben
  const selected = new Set(pane ? [pane.target] : cs.state.networkSelected);
  const shapes = [];
  for (const a of anns) {
    if (!a.position || !a.size) continue;
    shapes.push(`<g class="net-ann"><rect x="${X(a.position[0])}" y="${Y(a.position[1] + a.size[1])}" width="${a.size[0] * scale}" height="${a.size[1] * scale}" rx="4"/><text x="${X(a.position[0]) + 6}" y="${Y(a.position[1] + a.size[1]) + 16}" font-size="12">${esc(a.title || "")}</text></g>`);
  }
  const byPath = new Map(kids.map((o) => [o.path, o]));
  const center = (o, side) => ({ x: X(side === "out" ? o.pos[0] + o.size[0] : o.pos[0]), y: Y(o.pos[1] + o.size[1] / 2) });
  for (const e of net.edges) {
    const a = byPath.get(e.src);
    const b = byPath.get(e.dst);
    if (!a || !b) continue;
    if (e.kind !== "wire" && !td.hidden) continue;
    const p = center(a, "out");
    const q = center(b, "in");
    const dash = e.kind === "wire" ? "" : `stroke-dasharray="${6 * Math.max(scale, 0.4)},${4 * Math.max(scale, 0.4)}"`;
    const midX = (p.x + q.x) / 2;
    shapes.push(`<path d="M${p.x},${p.y} C${midX},${p.y} ${midX},${q.y} ${q.x},${q.y}" fill="none" stroke="${EDGE_COLOR[e.kind] || "#888"}" stroke-width="${e.kind === "wire" ? 2 : 1.5}" ${dash} opacity="${e.kind === "wire" ? 0.95 : 0.8}"/>`);
  }
  const fs = Math.max(10, Math.min(13, 18 * scale));
  for (const o of kids) {
    const x = X(o.pos[0]);
    const y = Y(o.pos[1] + o.size[1]);
    const bw = Math.max(o.size[0] * scale, o.name.length * fs * 0.58 + 10);
    const bh = o.size[1] * scale;
    const isSel = selected.has(o.path);
    shapes.push(`<g class="net-op ${isSel ? "sel" : ""}" data-op="${esc(o.path)}" data-key="op-${esc(o.path)}">
      <rect class="box" x="${x}" y="${y}" width="${bw}" height="${bh}" rx="3" fill="${FAMILY_FILL[o.family] || "#444"}"/>
      <text x="${x + 4}" y="${y + fs + 2}" font-size="${fs}">${esc(o.name)}</text>
      <text class="ty" x="${x + 4}" y="${y + fs * 2 + 4}" font-size="${fs * 0.8}">${esc(o.type.replace(/(TOP|CHOP|SOP|DAT|COMP|MAT|POP)$/, " $1"))}</text>
    </g>`);
  }
  const sel = pane ? pane.target : cs.state.networkSelected[0];
  return `<div class="netbar"><button data-act="net-up" ${owner === "" ? "disabled" : ""}>↑ hoch</button>
      <span class="path">${esc(abs(owner))}</span>
      <button data-act="net-hidden" class="${td.hidden ? "on" : ""}">versteckte Kanten</button>
      <button data-act="net-zoom-out">−</button><button data-act="net-zoom-in">+</button>
      <button data-act="td-rec" title="Alt+Shift+A: RECORD von überall">Alt+Shift+A</button>
      <button data-act="td-undo" title="Letzte Änderung rückgängig">↶ Rückgängig</button>
      <button data-act="td-redo" title="Letzte Änderung wiederherstellen">↷ Wiederherstellen</button>
      <button data-act="td-down" title="↓ im TD-Netzwerk">↓</button></div>
    <div class="netwrap" data-scroll-key="network-${pane?'secondary':'primary'}-${esc(owner)}"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${shapes.join("")}</svg></div>
    ${sel != null ? netSelHtml(ctx, sel) : `<div class="netsel">Op antippen = markieren · Doppeltippen auf einen COMP = hineingehen · Kabel durchgezogen, versteckte Kanten gestrichelt (EXPR/PAR-REF blauviolett, EXPORT grün, BIND lila, Wächter magenta).</div>`}`;
}

function netSelHtml(ctx, path) {
  const { cs } = ctx;
  const o = cs.net.op(path);
  if (!o) return "";
  const rows = [["OP", `${o.name} (${o.type})`], ["PFAD", abs(path)]];
  for (const [k, v] of Object.entries(o.pars || {})) {
    if ("e" in v) rows.push([`Par ${k}`, `= ${v.e}  (Expression)`]);
    else if ("b" in v) rows.push([`Par ${k}`, `⟷ ${v.b}  (Bind)`]);
    else rows.push([`Par ${k}`, String(v.v)]);
  }
  const preview = typeof o.text === "string" ? (path === "BranchLab/experiment_script" ? cs.lab.script : o.text).split("\n").slice(0, 6).join("\n") : "";
  return `<div class="netsel">${rows.map(([k, v]) => `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join("")}
    ${preview ? `<div class="kv"><span class="k">TEXT</span><span class="v">${esc(preview)}${o.text.split("\n").length > 6 ? "\n…" : ""}</span></div>` : ""}
    <div class="tbtns">${o.family === "COMP" ? `<button data-act="net-enter" data-path="${esc(path)}">hineingehen</button>` : ""}
      ${typeof o.text === "string" ? `<button data-act="net-viewer" data-path="${esc(path)}">VIEWER</button>` : ""}
      <button data-act="net-par" data-path="${esc(path)}">PARAMETER</button>
      <button data-act="net-cs" data-mode="trace" data-path="${esc(path)}">→ USES</button>
      <button data-act="net-cs" data-mode="refs" data-path="${esc(path)}">→ USED BY</button>
      <button data-act="net-cs" data-mode="chain" data-path="${esc(path)}">→ FLOW</button></div></div>`;
}

const SHEETS = [["SignalGarden", "SignalGarden"], ["BranchLab", "BranchLab"], ["StateLab", "StateLab"], ["Farbmischer", "Farbmischer"], ["cs", "CodeSearch"], ["op", "markierter Op"]];

function parHtml(ctx) {
  const { cs, td } = ctx;
  const chips = SHEETS.map(([k, l]) => `<button class="chip ${td.sheet === k ? "on" : ""}" data-sheet="${k}">${l}</button>`).join("");
  let body = "";
  if (td.sheet === "BranchLab") body = branchSheet(ctx);
  else if (td.sheet === 'SignalGarden') body = gardenSheet(ctx);
  else if (td.sheet === "StateLab") body = stateSheet(ctx);
  else if (td.sheet === "Farbmischer") body = fmSheet(ctx);
  else if (td.sheet === "cs") body = csSheet(ctx);
  else body = opSheet(ctx, td.opPath || cs.state.networkSelected[0] || cs.state.focus);
  return `<div class="ltabs row-scroll">${chips}</div><div class="lbody parsheet" data-scroll-key="tdpar-${td.sheet}-${td.gardenOwner || 'root'}">${body}</div>`;
}

function parRow(name, label, help, control) {
  return `<div class="p"><div class="nm">${esc(label || name)}${help ? `<small>${esc(help)}</small>` : ""}</div><div>${control}</div></div>`;
}

function rgbCss(r, g, b) {
  const c = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}

function gardenSheet(ctx) {
  const garden = ctx.cs.lab.garden;
  const owners = { root: 'SignalGarden', sensor: 'SignalGarden/Sensor', scenes: 'SignalGarden/Scenes', palette: 'SignalGarden/Palette' };
  const owner = ctx.td.gardenOwner || 'root';
  const comp = ctx.cs.net.op(owners[owner]);
  const tabs = Object.entries(owners).map(([key, path]) => `<button class="chip ${key === owner ? 'on' : ''}" data-garden-owner="${key}">${key === 'root' ? 'Root' : path.split('/').pop()}</button>`).join('');
  const rows = (comp?.custom || []).map((p) => {
    const v = garden.pars[owner][p.name];
    let control;
    if (p.readOnly) control = `<span class="ro">${esc(v)}</span>`;
    else if (p.style === 'Pulse') control = `<button class="pulse" data-garden-pulse="${p.name}" data-owner="${owner}">${p.name}</button>`;
    else if (p.style === 'Toggle') control = `<button class="tog ${v ? 'on' : ''}" data-garden-toggle="${p.name}" data-owner="${owner}">${v ? '1 · an' : '0 · aus'}</button>`;
    else if (p.style === 'Menu') control = `<select data-garden-menu="${p.name}" data-owner="${owner}">${(p.menuNames || []).map((m) => `<option ${v === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>`;
    else if(p.style==='Str') control = `<input type="text" value="${esc(v)}" data-garden-text="${p.name}" data-owner="${owner}">`;
    else control = `<input type="number" inputmode="decimal" step="0.05" value="${esc(v)}" data-garden-num="${p.name}" data-owner="${owner}">`;
    return parRow(p.name, p.name, p.name === 'Prepare' ? 'Setzt das gesamte eigene Lab auf Anfang. Führt keinen Versuch aus.' : '', control);
  }).join('');
  return `<div class="ltabs row-scroll">${tabs}</div><div class="sect">${esc(owners[owner])}</div>${rows}
    ${['sensor', 'scenes'].includes(owner) ? `<button data-garden-reinit="${owner}">Nur ${owner === 'sensor' ? 'Sensor' : 'Scenes'} neu initialisieren</button>` : ''}
    <div class="sect">Output/out1 · modellierte Farbe</div><span class="swatch" style="background:${rgbCss(...garden.rgb)}"></span>
    <p>RGB ${garden.rgb.map(fmtNum).join(' · ')}<br>Samples ${garden.samples} · Requests ${garden.requests} · Mix ${fmtNum(garden.mix)}</p>
    <p class="evidence-note">Auto verwendet die Pocket-Timeline. Für die Workflows bleibt Auto aus: jeder Step rechnet genau 0.25 Sekunden. Der Farbfleck ist kein echter TOP-Render.</p>`;
}

function branchSheet(ctx) {
  const { cs } = ctx;
  const lab = cs.lab;
  const p = lab.blPars;
  const bl = cs.net.op("BranchLab");
  const def = (n) => (bl.custom || []).find((x) => x.name === n) || {};
  return `<div class="sect">BRANCHLAB · Demo</div>
    ${parRow("Enabled", "Enabled", "Guard: aus = RouteEvent kehrt sofort zurück", `<button class="tog ${p.Enabled ? "on" : ""}" data-bl-toggle="Enabled">${p.Enabled ? "1 · an" : "0 · aus"}</button>`)}
    ${parRow("Route", "Route", "welcher Zweig: warm / cool / neutral", `<select data-bl-menu="Route">${(def("Route").menuNames || ["warm", "cool", "neutral"]).map((m) => `<option ${p.Route === m ? "selected" : ""}>${m}</option>`).join("")}</select>`)}
    ${parRow("Intensity", "Intensity", "Faktor 0..1 für die Farbe und control.gain", `<input type="number" step="0.01" min="0" max="1" value="${p.Intensity}" data-bl-num="Intensity">`)}
    ${parRow("Softness", "Softness", "per BIND an blur_soft.size gekoppelt (0..64)", `<input type="number" step="1" min="0" max="64" value="${p.Softness}" data-bl-num="Softness">`)}
    ${parRow("Fire", "Fire", "Pulse → onParFire → RouteEvent", `<button class="pulse" data-bl-pulse="Fire">FIRE</button>`)}
    ${parRow("Reset", "Reset demo", "Pulse → onParReset → Reset", `<button class="pulse" data-bl-pulse="Reset">RESET</button>`)}
    ${parRow("Status", "Status", "nur Anzeige", `<span class="ro">${esc(p.Status)}</span>`)}
    <div class="sect">LIVE-WERTE</div>
    ${parRow("out", "ColorEngine/rgb", "geschrieben von _writeColor", `<span class="swatch" style="background:${rgbCss(...lab.rgb)}"></span> <span class="ro">${lab.rgb.map(fmtNum).join(" · ")}</span>`)}
    ${parRow("control", "control (CHOP)", "gain · route", `<span class="ro">gain ${fmtNum(lab.control.gain)} · route ${fmtNum(lab.control.route)}</span>`)}
    ${parRow("events", "Events · Branch · Writes", "", `<span class="ro">${lab.events} · ${esc(lab.branch)} · ${lab.writes}</span>`)}
    ${parRow("ce", "ColorEngine.Status", "", `<span class="ro">${esc(lab.ceStatus)}</span>`)}`;
}

function stateSheet(ctx) {
  const { cs } = ctx;
  const sl = cs.lab.stateLab;
  const o = sl.Observe();
  const comp = cs.net.op("StateLab");
  const pulses = (comp.custom || []).filter((p) => p.style === "Pulse");
  return `<div class="sect">STATELAB · eigene Übungswerte</div>
    ${parRow("Doublefire", "Übungsfehler: doppelt zählen", "Fire zählt +2 statt +1", `<button class="tog ${sl.pars.Doublefire ? "on" : ""}" data-sl-toggle="Doublefire">${sl.pars.Doublefire ? "1 · an" : "0 · aus"}</button>`)}
    ${parRow("Gain", "Gain", `Modus ${sl.gainMode}`, `<span class="ro">${fmtNum(sl.gainEffective)} (${sl.gainMode})</span>`)}
    ${parRow("Countdisplay", "Count jetzt (Output)", "Anzeige von _count", `<span class="ro">${sl.pars.Countdisplay}</span>`)}
    ${parRow("Status", "Status (Output)", "", `<span class="ro">${esc(sl.pars.Status)}</span>`)}
    ${pulses.map((p) => parRow(p.name, p.label || p.name, p.help || "", `<button class="pulse" data-sl-pulse="${esc(p.name)}">${esc(p.label || p.name)}</button>`)).join("")}
    <div class="sect">out1 · rot = Count · blau = Gain</div>
    ${parRow("out1", "out1", "", `<span class="swatch" style="background:${rgbCss(Math.min(1, o.count * 0.25), 0.15, o.gain_effective)}"></span>`)}
    <div class="sect">state_values (DAT)</div>
    <table class="grid">${sl.stateValues().map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>
    <div class="sect">dependency_display (CHOP)</div>
    ${parRow("value", "value", "liest DependentValue per Expression", `<span class="ro">${o.dependency_display}</span>`)}`;
}

function fmSheet(ctx) {
  const { cs } = ctx;
  const fm = cs.lab.farbmischer;
  return `<div class="sect">FARBMISCHER</div>
    ${parRow("Weiter", "Weiter", "nächste Farbe, Überblendung startet", `<button class="pulse" data-fm-pulse="Weiter">WEITER</button>`)}
    ${parRow("Zuruecksetzen", "Zurücksetzen", "zurück zu sonnenuntergang", `<button class="pulse" data-fm-pulse="Zuruecksetzen">ZURÜCK</button>`)}
    ${parRow("Auto", "Auto", "an = jeder Takt von null_takt ruft Weiter (takt_exec)", `<button class="tog ${fm.pars.Auto ? "on" : ""}" data-fm-toggle="Auto">${fm.pars.Auto ? "1 · an" : "0 · aus"}</button>`)}
    ${parRow("Dauer", "Dauer", "Sekunden je Überblendung", `<input type="number" step="0.1" min="0.05" value="${fm.pars.Dauer}" data-fm-num="Dauer">`)}
    ${parRow("farbe", "farbe_chop", `Index ${fm.index} · mix ${fmtNum(fm.mix)}`, `<span class="swatch" style="background:${rgbCss(...fm.chop)}"></span>`)}
    ${parRow("tasten", "tasten (Keyboard In DAT)", "absichtlich aus: active = 0", `<span class="ro">active = 0</span>`)}`;
}

function csSheet(ctx) {
  const { cs, ui } = ctx;
  const rows = [];
  let page = "";
  for (const p of ui.CS_PARS || []) {
    if (p.style === "Pulse" || ["Scopecomp", "Mapfolder"].includes(p.name)) continue;
    if (p.page !== page) { page = p.page; rows.push(`<div class="sect">${esc(page.toUpperCase())}</div>`); }
    const v = cs.cs[p.name];
    let control;
    if (p.style === "Toggle") control = `<button class="tog ${v ? "on" : ""}" data-cs-toggle="${p.name}">${v ? "1 · an" : "0 · aus"}</button>`;
    else if (p.style === "Menu") control = `<select data-cs-menu="${p.name}">${(p.menuNames || []).map((m) => `<option ${String(v) === m ? "selected" : ""}>${esc(m)}</option>`).join("")}</select>`;
    else if (p.style === "Int" || p.style === "Float") control = `<input type="number" step="${p.style === "Int" ? 1 : 0.5}" value="${esc(v)}" data-cs-num="${p.name}">`;
    else control = `<span class="ro">${esc(v || "—")}</span>`;
    rows.push(parRow(p.name, `${p.label || p.name}  (${p.name})`, p.help || "", control));
  }
  return rows.join("");
}

function opSheet(ctx, path) {
  const { cs } = ctx;
  const o = cs.net.op(path);
  if (!o) return `<p>kein Op markiert</p>`;
  const rows = [`<div class="sect">${esc(abs(path))} · ${esc(o.type)}</div>`];
  if (path === "BranchLab") return branchSheet(ctx);
  if (path === "StateLab") return stateSheet(ctx);
  if (path === "Farbmischer") return fmSheet(ctx);
  const gardenOwner={'SignalGarden':'root','SignalGarden/Sensor':'sensor','SignalGarden/Scenes':'scenes','SignalGarden/Palette':'palette'}[path];
  if(gardenOwner)return gardenSheet({...ctx,td:{...ctx.td,gardenOwner}});
  for (const p of o.custom || []) rows.push(parRow(p.name, p.label || p.name, p.help || "", `<span class="ro">${esc(p.value ?? p.default ?? "")}</span>`));
  for (const [k, v] of Object.entries(o.pars || {})) {
    const text = "e" in v ? `= ${v.e}` : ("b" in v ? `⟷ ${v.b}` : String(v.v));
    const mode = "e" in v ? "Expression" : ("b" in v ? "Bind" : "Constant");
    rows.push(parRow(k, k, mode, `<span class="ro">${esc(text)}</span>`));
  }
  if (rows.length === 1) rows.push(`<p class="ro">nur Standardwerte</p>`);
  return rows.join("");
}

function timeHtml(ctx) {
  const { tour, cs } = ctx;
  return `<div class="timeline"><button data-act="play" class="${tour.playing ? "on" : ""}">${tour.playing ? "■ PAUSE" : "▶ PLAY"}</button>
    <span class="ro">Frame ${cs.lab.frame} · ${fmtNum(cs.lab.time)} s</span>
    <button data-act="frames">+1 s laufen lassen</button></div>
    <div class="lbody"><p class="md">Die Timeline läuft im Hintergrund weiter, solange PLAY an ist. Frame-Callbacks (frame_tick → Tick) und der Takt von null_takt brauchen laufende Frames.</p></div>`;
}

// ------------------------------------------------------------------ Kurs
export function renderCourse(ctx) {
  const { tour, layers } = ctx;
  const layer = $("#layer-course");
  layer.classList.toggle("show", layers.course);
  if (!layers.course) return;
  const p = tour.progress();
  const cur = tour.lesson().chapter;
  const items = tour.chapters.map((name, i) => {
    const lessons = tour.lessons.filter((l) => l.chapter === i);
    const done = lessons.filter((l) => l.id in tour.done).length;
    const pct = lessons.length ? Math.round((done / lessons.length) * 100) : 0;
    return `<button class="chapter ${i === cur ? "cur" : ""}" data-chapter="${i}"><div class="n">KAPITEL ${String(i + 1).padStart(2, "0")} · ${done}/${lessons.length}</div><div class="t">${esc(name)}</div><div class="bar"><span style="width:${pct}%"></span></div></button>`;
  }).join("");
  updateHtml(layer, `<div class="lhead"><h1>KURS</h1><button data-act="course-close">✕</button></div>
    <div class="lbody" data-scroll-key="course"><div class="overall">${p.verified} im Modell geprüft · ${p.confirmed} selbst bestätigt · ${p.open} offen${p.skipped ? ` · ${p.skipped} übersprungen` : ""}<br>Ein Kapitel antippen springt zum ersten offenen Schritt. Die acht SignalGarden-Workflows starten am Anfang, damit ihr Versuchszustand nachvollziehbar bleibt; Häkchen bleiben erhalten. Laptop-Tests sind darin nicht enthalten.</div>${items}</div>`);
}

// ------------------------------------------------------------------ Atlas
export function renderAtlas(ctx) {
  const { layers, features, ui, course } = ctx;
  const layer = $("#layer-atlas");
  layer.classList.toggle("show", layers.atlas);
  if (!layers.atlas) return;
  const tab = layers.atlasTab || "cheat";
  const tabs = [["cheat", "SPICKZETTEL"], ["laptop", "AM LAPTOP"], ["docs", "DOKU"], ["pics", "BILDER"], ["gloss", "BEGRIFFE"]];
  let body = "";
  if (tab === "cheat") body = cheatSheet(ui);
  else if (tab === "laptop") body = laptopOverview(course);
  else if (tab === "docs") {
    if (layers.doc !== undefined && layers.doc !== null) body = `<button class="feat" data-doc="-1">‹ Übersicht</button><div class="md">${md(features[layers.doc].body.replace(/\]\((?:\.\.\/)?(?:docs\/)?images\/([\w-]+)\.png\)/g, (m, name) => `](${imgSrc(`${name}.webp`)})`))}</div>`;
    else body = features.map((f, i) => `<button class="feat" data-doc="${i}"><span class="n">${f.chapter ? `KAPITEL ${f.chapter}` : "ÜBERBLICK"}</span>${esc(f.title)}</button>`).join("");
  } else if (tab === "pics") body = pictures();
  else body = glossary(course);
  const key = `${tab}|${layers.doc ?? ""}`;
  updateHtml(layer, `<div class="lhead"><h1>ATLAS</h1><button data-act="atlas-close">✕</button></div>
    <div class="ltabs">${tabs.map(([k, l]) => `<button class="chip ${tab === k ? "on" : ""}" data-atlas="${k}">${l}</button>`).join("")}</div>
    <div class="lbody" data-scroll-key="atlas">${body}</div>`, ctx.atlasKey !== key);
  ctx.atlasKey = key;
}

function cheatSheet(ui) {
  const L = ui.TAB_LABELS || {};
  const q = [
    ["Wo steht dieses Wort?", L.search, "Shift+K · Kategorien grenzen ein · *wort* findet Teile"],
    ["Woher hat DIESER Op seinen Wert?", L.trace, "Alt+Shift+K · QUELLE: Kabel, EXPR, EXPORT, BIND, PAR-REF"],
    ["Wer merkt es, wenn ich ihn ändere?", L.refs, "Ctrl+Shift+K · NEBENAN / WOANDERS / INNEN"],
    ["Über welche Stationen läuft das Signal?", L.chain, "QUELLEN → SELECTED → ZIELE · RÜCKKOPPLUNG"],
    ["Was hängt an dieser Methode / diesem State?", L.impact, "Ctrl+I auf der Zeile"],
    ["Was ist JETZT kaputt?", L.errors, "Cook-, Python-, Expression-Fehler · Alt+Klick → CONSTANT"],
    ["Was steht in dieser Tabelle, wer liest die Zelle?", L.table, "Kopf sortiert · Doppeltippen ändert · Menü kopiert"],
    ["Wie ist die Extension gebaut?", L.map, "KETTEN · PUBLIC API · CALLBACKS · LIFECYCLE · INTERN · STATE · PARAMETER · >> LANDKARTE"],
    ["Wie kommt man von außen in den Code?", L.entries, "TD ruft / TD holt Werte / du löst aus / anderer Code ruft"],
    ["Welche Aufrufkette ist möglich?", L.tour, "Ctrl+Enter in TRIGGERS · Zweige klappbar · Ctrl+Shift+I = ROUTE"],
    ["Wer ruft diese Methode – bis zum Auslöser?", "ROUTE", "Ctrl+Shift+I · GANZ / SCHRITT (Ctrl+G) · MIT-Zeile → FADEN"],
    ["Was lief WIRKLICH?", L.record, "START → Aktion → STOP · PREV/NEXT · WARUM ▸ · Alt+Shift+A überall"],
    ["Warum lief ein Zweig nicht?", "WARUM", "STOPP-Zeile → AMPEL · HEBEL · NOCHMAL AUSLÖSEN · VORHER → NACHHER"],
    ["Ist der Bau sauber?", L.check, "CODE-BEFUNDE · VERTRÄGE · HOT PATH · Alt+F Frage-Paket"],
    ["Welche Werte leben wo, wie lange?", ">states", "State-Atlas: Attribut, Storage, Parameter, Alias, Lebensdauer"],
  ];
  const rows = q.map(([frage, tab, how]) => `<tr><td>${esc(frage)}</td><td><b>${esc(tab)}</b></td><td>${esc(how)}</td></tr>`).join("");
  const grenzen = [
    "Ein Textfund beweist keinen Aufruf. Kein Treffer beweist keine Nichtbenutzung.",
    "Statisch (STRUCTURE, CALL PATH, ROUTE) heißt: so KÖNNTE es laufen. Was lief, zeigt nur RECORD.",
    "HOT = von einem Frame-Einstieg erreichbar, kein gemessener Engpass.",
    "≈ = nur nach Namen vermutet · DYN = Ziel erst zur Laufzeit bekannt.",
    "AUDIT-Hinweise sind Kandidaten fürs Review, keine bewiesenen Bugs.",
  ];
  return `<div class="md"><h2>Welche Frage → welcher Tab</h2><table><tr><td><b>Frage</b></td><td><b>Tab</b></td><td><b>So</b></td></tr>${rows}</table>
    <h2>Grenzen, die du immer mitdenkst</h2><ul>${grenzen.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>
    <h2>Die drei Gruppen</h2><pre>${esc((ui.GROUP_HELP || {}).both || "")}</pre><pre>${esc((ui.GROUP_HELP || {}).net || "")}</pre><pre>${esc((ui.GROUP_HELP || {}).code || "")}</pre></div>`;
}

function pictures() {
  const pics = [
    ["codesearch-search.webp", "SEARCH im echten Fenster: GRUPPE links, Treffer Mitte, DETAIL rechts."],
    ["08_structure.webp", "STRUCTURE am Farbmischer (ältere Fassung): PUBLIC API, STATES, Aktionen >>."],
    ["05_flow.webp", "FLOW: QUELLEN → SELECTED → ZIELE mit Distanzen (←n)."],
    ["07_triggers.webp", "TRIGGERS: wann, wer, ruft, Status (HOT / AN / AUS)."],
    ["10_callpath.webp", "CALL PATH ohne Einstieg: erst in TRIGGERS Strg+Enter."],
    ["12_audit.webp", "AUDIT: CODE-BEFUNDE, VERTRÄGE / AUSLÖSER, HOT PATH."],
    ["06_table.webp", "TABLE: ein Table DAT als Gitter."],
    ["13_readorder.webp", "READ ORDER: in welcher Reihenfolge du ein fremdes Netz liest."],
    ["flowlens_branchlab_nur_kabel.webp", "FlowLens: BranchLab nur mit Kabeln (Show Hidden Links aus)."],
    ["flowlens_branchlab_raw.webp", "FlowLens: dieselbe Karte mit allen versteckten Kanten."],
    ["flowlens_branchlab_story.webp", "FlowLens STORY: fünf Etappen und EIN SIGNALPFAD."],
  ];
  return `<div class="md"><p>Bilder aus dem echten CodeSearch / FlowLens in TouchDesigner (Stand der Doku-Aufnahmen; Tab-Namen können älter sein).</p>${pics.map(([f, c]) => `<p><img src="${imgSrc(f)}" alt="${esc(c)}" loading="lazy"><br><i>${esc(c)}</i></p>`).join("")}</div>`;
}

function glossary(course) {
  const seen = new Map();
  for (const l of course.lessons) {
    for (const part of String(l.glossary || "").split(/(?<=\.)\s+(?=[A-ZÄÖÜ][^=]{0,40}=)/)) {
      const m = /^([^=]{1,40})=\s*(.+)$/.exec(part.trim());
      if (m && !seen.has(m[1].trim())) seen.set(m[1].trim(), m[2].trim());
    }
  }
  const rows = [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0], "de"));
  return `<div class="md"><p>${rows.length} Begriffe aus allen Stationen.</p>${rows.map(([k, v]) => `<p><b>${esc(k)}</b> — ${esc(v)}</p>`).join("")}</div>`;
}

// ------------------------------------------------------------------ FlowLens
const ROLE_BY_TYPE = [
  [/^noise|^constantTOP$|^constantCHOP$|^lfo|tableDAT$/, "SOURCE"], [/^level|^blur|^transform/, "TRANSFORM"], [/^composite|^merge|^cross/, "MIX"],
  [/^select|^switch/, "PICK"], [/^feedback/, "STATE"], [/^out/, "OUTPUT"], [/^in(TOP|CHOP)$/, "PASS"], [/^null/, "PASS"],
  [/execute|keyboardin/, "EVENT"],
];

function roleOf(cs, path) {
  const o = cs.net.op(path);
  if (!o) return "EXTERN";
  if (cs.net.code[path] && /class\s/.test(o.text || "")) return "LOGIC";
  if (/_callbacks$/.test(o.name)) return "EVENT";
  if (o.family === "COMP") return cs.net.extClass(path) ? "BASE" : "TRANSFORM";
  for (const [rx, role] of ROLE_BY_TYPE) if (rx.test(o.type)) return role;
  return "UTILITY";
}

function liveValue(cs, path) {
  const o = cs.net.op(path);
  if (!o) return "";
  if (path === "BranchLab/control") return `gain ${fmtNum(cs.lab.control.gain)} route ${fmtNum(cs.lab.control.route)}`;
  if (o.family === "TOP") return `${(o.pars && o.pars.resolutionw && o.pars.resolutionw.v) || 256} x ${(o.pars && o.pars.resolutionh && o.pars.resolutionh.v) || 256} 8-bit fixed (RGBA)`;
  if (o.table) return `${o.table.length} rows x ${o.table[0].length} cols`;
  if (typeof o.text === "string") return `${o.text.split("\n").length} rows x 1 cols`;
  if (o.chans) return o.chans.map((c) => `${c.name} ${fmtNum(c.value)}`).join(" ");
  return o.type;
}

function flEdges(cs, target, hidden) {
  const inside = (p) => p && (p === target || p.startsWith(target + "/")) && p.split("/").length === target.split("/").length + 1;
  return cs.net.edges.filter((e) => (inside(e.src) || inside(e.dst)) && (hidden || e.kind === "wire") && e.src && e.dst && !String(e.src).includes("ExtUtils") && !String(e.dst).includes("ExtUtils"));
}

function edgeClass(e) {
  if (e.kind === "wire") return "e-wire";
  if (e.kind === "export") return "e-export";
  if (e.kind === "bind") return "e-bind";
  if (e.kind === "code" || e.kind === "watch" || e.kind === "callbacks") return "e-code";
  return "e-par";
}

function edgeLabel(e) {
  if (e.kind === "wire") return "Kabel";
  if (e.kind === "expr") return `${(/\['(\w+)'\]/.exec(e.text || "") || [])[1] || "expr"} -> ${e.par}`;
  if (e.kind === "code") return `code: ${e.receiver}`;
  return e.par || e.kind;
}

export function renderFlowLens(ctx) {
  const { cs } = ctx;
  const fl = cs.state.flowlens;
  const layer = $("#layer-flowlens");
  layer.classList.toggle("show", fl.open);
  if (!fl.open) return;
  const target = rel(fl.target) || "BranchLab";
  const net = cs.net;
  const kids = net.kids(target).filter((o) => o.name !== "ExtUtils");
  const edges = flEdges(cs, target, fl.hidden);
  const wires = edges.filter((e) => e.kind === "wire").length;
  const status = `${baseName(abs(target))}: ${kids.length} Stationen, ${wires} Kabel, ${edges.length - wires} versteckt`;
  // Etappen nach Tiefe im Graphen (Story)
  const depth = new Map();
  const ins = (p) => edges.filter((e) => e.dst === p && kids.some((k) => k.path === e.src) && !(e.kind === "oppar" && e.par === "top" && net.opType(e.dst) === "feedbackTOP"));
  const calc = (p, stack = new Set()) => {
    if (depth.has(p)) return depth.get(p);
    if (stack.has(p)) return 0;
    stack.add(p);
    const d = Math.max(-1, ...ins(p).map((e) => calc(e.src, stack))) + 1;
    depth.set(p, d);
    return d;
  };
  kids.forEach((k) => calc(k.path));
  const maxD = Math.max(1, ...depth.values());
  const stageOf = (p) => Math.min(4, Math.floor((depth.get(p) / maxD) * 4.999));
  const names = ["ORIGIN", "SHAPE", "STEP", "COMBINE", "RESULT"];
  const familyColor = { TOP: 'purple', CHOP: 'green', SOP: 'blue', DAT: 'dat-fg', COMP: 'muted', MAT: 'yellow', POP: 'cyan' };
  const card = (o) => `<button class="fl-card ${fl.selected === o.path ? "sel" : ""}" style="--family-color:var(--${familyColor[o.family] || 'muted'})" data-fl="${esc(o.path)}" data-key="fl-${esc(o.path)}"><div class="r">${roleOf(cs, o.path)}</div><div class="n">${esc(o.name)}</div><div class="v">${esc(o.type)} · ${esc(liveValue(cs, o.path))}</div></button>`;
  let map;
  if (fl.story) {
    const connected = kids.filter((k) => edges.some((e) => e.src === k.path || e.dst === k.path));
    const unconnected = kids.filter((k) => !connected.includes(k));
    map = (connected.length ? `<div class="fl-stages">${names.map((n, i) => `<div class="fl-stage"><h3>${String(i + 1).padStart(2, "0")} ${n}</h3>${connected.filter((k) => stageOf(k.path) === i).map(card).join("")}</div>`).join("")}</div>` : '')
      + (unconnected.length ? `<div class="fl-unconnected"><h3>OHNE VERBINDUNG IM GEWÄHLTEN AUSSCHNITT · kein Beweis, dass diese Ops unbenutzt sind</h3><div class="fl-grid">${unconnected.map(card).join('')}</div></div>` : '')
      + (!kids.length ? '<p>Dieser COMP enthält keine darstellbaren Operatoren. Wähle im übergeordneten Netzwerk einen anderen COMP.</p>' : '');
  } else {
    map = `<div class="fl-grid">${kids.map(card).join("")}</div>`;
  }
  const sel = fl.selected && net.op(fl.selected) ? fl.selected : null;
  let micro = `<p>Station antippen: rechts erscheint das Mikroskop (URSACHEN → AUSGEWÄHLT → WIRKUNGEN).</p>`;
  if (sel) {
    const o = net.op(sel);
    const inE = edges.filter((e) => e.dst === sel);
    const outE = edges.filter((e) => e.src === sel);
    const changed = Object.entries(o.pars || {}).map(([k, v]) => ("e" in v ? `${k}: Default → =${v.e}` : ("b" in v ? `${k}: Default → ⟷ ${v.b}` : `${k}: ${v.v}`)));
    micro = `<h3>${roleOf(cs, sel)} · ${esc(o.name)}</h3><p class="v">${esc(o.type)} · ${esc(abs(sel))}</p>
      <h3>EIN SIGNALPFAD</h3><p>URSACHEN ${esc(inE.map((e) => baseName(e.src)).join(", ") || "—")}  →  AUSGEWÄHLT ${esc(o.name)}  →  WIRKUNGEN ${esc(outE.map((e) => baseName(e.dst)).join(", ") || "—")}</p>
      <h3>URSACHEN</h3><div class="fl-edges">${inE.map((e) => `<div class="${edgeClass(e)}">${esc(baseName(e.src))} --${esc(edgeLabel(e))}--> ${esc(o.name)}</div>`).join("") || "—"}</div>
      <h3>WIRKUNGEN</h3><div class="fl-edges">${outE.map((e) => `<div class="${edgeClass(e)}">${esc(o.name)} --${esc(edgeLabel(e))}--> ${esc(baseName(e.dst))}</div>`).join("") || "—"}</div>
      <h3>GEÄNDERTE WERTE</h3><p>${esc(changed.join("\n") || "—")}</p>
      <h3>IF BYPASSED</h3><p>${esc(outE.length ? `${[...new Set(outE.map((e) => baseName(e.dst)))].join(", ")} verlieren den Beitrag von ${o.name}.` : "niemand verliert etwas – keine Wirkung im Ziel")}</p>
      <h3>LIVE</h3><p class="v">${esc(liveValue(cs, sel))}</p>`;
  }
  const targetChanged = ctx.flowLensTarget !== target;
  updateHtml(layer, `<div class="lhead"><h1>FLOWLENS</h1>
      <button data-fla="story" class="on">${fl.story ? "STORY" : "RAW NETWORK"}</button>
      <button data-fla="hidden" class="${fl.hidden ? "on" : ""}">Show Hidden Links</button>
      <button data-fla="colors" class="${fl.colors ? "on" : ""}">FARBE ${fl.colors ? "AUS" : "AN"}</button>
      <button data-fla="codesearch">CODESEARCH →</button>
      <button data-fla="close">✕</button></div>
    <div class="fl-status">Ziel ${esc(abs(target))} · fixiert · ${esc(status)}</div>
    <div class="fl-legend"><span class="e-wire">KABEL</span><span class="e-par">PARAM / OP REF</span><span class="e-code">CALLBACK / CODE</span><span class="e-export">EXPORT</span><span class="e-bind">BIND</span><span class="e-loop">LOOP</span></div>
    <div class="fl-map ${fl.colors ? 'fl-colors' : ''}" data-scroll-key="flowlens-map">${map}</div><div class="fl-micro" data-scroll-key="flowlens-detail">${micro}</div>`, targetChanged);
  ctx.flowLensTarget = target;
}

// ------------------------------------------------------------------ Popup (Dialog, Menue, Viewer, Editor, Hilfe, Tooltip, Vergleich)
export function renderPopup(ctx) {
  const { cs, popup } = ctx;
  const s = cs.state;
  const box = $("#popup");
  let html = "";
  if (popup.json) {
    html = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="json-title"><div class="bh"><span class="t" id="json-title">${popup.json === "analysis" ? "LLM-ANTWORT PRÜFEN" : "JSON BEARBEITEN"}</span></div>
      <div class="bb"><p>${popup.json === 'analysis' ? 'Request, Explanation oder Preview einfügen und direkt prüfen. Die Aufnahme-ID muss noch vorhanden sein. Es wird kein Code ausgeführt.' : 'Hier steht die Pocket-Zwischenablage. Text ändern oder eine Antwort einfügen. „In Pocket übernehmen“ führt nichts aus; anschließend mit >nachfrage, >antwort oder >vorschau prüfen.'}</p>
      ${popup.jsonError ? `<p class="analysis-error" role="alert">${esc(popup.jsonError)}</p>` : ""}<label for="json-text">Datenpaket</label><textarea id="json-text" spellcheck="false" autocorrect="off" autocapitalize="off">${esc(popup.jsonDraft ?? cs.clipboard)}</textarea></div>
      <div class="bf"><button data-pop="json-cancel">Abbrechen</button><button class="ok" data-pop="json-apply">${popup.json === 'analysis' ? 'Import prüfen' : 'In Pocket übernehmen'}</button></div></div>`;
  } else if (s.editor) {
    html = `<div class="box"><div class="bh"><span class="t">BEARBEITEN · ${esc(abs(s.editor.path))}</span></div>
      <div class="bb"><textarea id="editor-text" spellcheck="false" autocapitalize="off">${esc(s.editor.text)}</textarea>${s.editor.error ? `<div class="err">${esc(s.editor.error)}</div>` : ""}</div>
      <div class="bf"><button data-pop="edit-cancel">ABBRECHEN</button><button class="ok" data-pop="edit-apply">ÜBERNEHMEN</button></div></div>`;
  } else if (s.dialog) {
    html = `<div class="box"><div class="bh"><span class="t">${esc(s.dialog.title)}</span></div><div class="bb">${esc(s.dialog.lines.join("\n"))}</div>
      <div class="bf"><button data-pop="esc">${esc(s.dialog.cancelLabel || 'Esc')}</button>${s.dialog.confirm ? `<button class="ok" data-pop="enter">${esc(s.dialog.confirmLabel || 'Enter · übernehmen')}</button>` : `<button class="ok" data-pop="esc">OK</button>`}</div></div>`;
  } else if (s.menu) {
    html = `<div class="box menu-box" role="dialog" aria-modal="true" aria-label="${esc(s.menu.title)}"><div class="bh"><span class="t">${esc(s.menu.title)}</span><button data-pop="esc" aria-label="Menü schließen">✕</button></div>
      ${s.menu.description ? `<div class="menu-description">${esc(s.menu.description)}</div>` : ""}<div class="bb" style="padding:0">${s.menu.items.map((it, i) => `${it.group && it.group !== s.menu.items[i - 1]?.group ? `<h2 class="menu-group">${esc(it.group)}</h2>` : ''}<button class="mi" data-menu="${i}">${it.swatches ? `<span class="look-swatches" aria-hidden="true">${it.swatches.map((color) => `<i style="background:${rgb(color)}"></i>`).join("")}</span>` : ""}${esc(it.label)}</button>`).join("")}</div></div>`;
  } else if (s.viewer) {
    const dat = s.viewer.path;
    html = `<div class="box"><div class="bh"><span class="t">VIEWER · ${esc(abs(dat))}${s.viewer.line ? ` · Zeile ${s.viewer.line}` : ""}</span><button data-pop="esc">✕ Esc</button></div>
      <div class="bb" style="padding:0">${codeHtml(cs, dat, s.viewer.line || 0, { from: 1, to: (dat === "BranchLab/experiment_script" ? cs.lab.script : cs.net.op(dat)?.text || "").split("\n").length })}</div></div>`;
  } else if (s.help) {
    html = `<div class="box"><div class="bh"><span class="t">HILFE · ${esc(s.help.title)}</span><button data-pop="help-close">✕</button></div><div class="bb">${esc(s.help.text)}</div></div>`;
  } else if (popup.tooltip) {
    html = `<div class="box"><div class="bh"><span class="t">${esc(popup.tooltip.title)}</span><button data-pop="tip-close">✕</button></div><div class="bb">${esc(popup.tooltip.text)}</div></div>`;
  } else if (popup.compare) {
    html = `<div class="box"><div class="bh"><span class="t">TABS VERGLEICHEN</span><button data-pop="compare-close">✕</button></div><div class="bb">${esc(compareText(ctx))}</div></div>`;
  }
  box.classList.toggle("show", Boolean(html));
  box.classList.toggle("hover-help", s.help?.source === 'tab-hover');
  const changed = updateHtml(box, html);
  if (s.editor && changed) {
    const ta = $("#editor-text");
    if (ta) ta.focus({ preventScroll: true });
  }
}

function compareText(ctx) {
  const ui = ctx.ui;
  const L = ui.TAB_LABELS || {};
  const S = ui.MODE_SEES || {};
  return [
    `${L.trace}: Was liest DIESER Op? ${S.trace}`,
    `${L.refs}: Wer liest ihn? ${S.refs}`,
    `${L.chain}: Die ganze Strecke. ${S.chain}`,
    `${L.impact}: Was hängt an dieser Methode oder diesem State? ${S.impact}`,
    "",
    "Wann welcher Tab?",
    `USED BY vor dem Umbenennen · USES am rätselhaften Wert · FLOW für die Strecke · IMPACT vor einer Symboländerung.`,
    "",
    "Bild: Bahnhof. USES = Zulauf an EINEM Bahnhof · USED BY = Abfahrt von diesem Bahnhof · FLOW = die ganze Zugstrecke · IMPACT = alle Fahrgäste, die an diesem einen Zug hängen.",
  ].join("\n");
}

// ------------------------------------------------------------------ Schnellsuche (zweites Fenster)
// Familie einer Suchfenster-Zeile: Op-Familie, Codezeilen gehoeren zu einem DAT
function familyClass(cs,h){const fam=h.family || (h.kind==='code'?'DAT':(cs.net.op(rel(h.path || ''))?.family || ''));return fam?`fam-${fam}`:'';}

export function renderQuick(ctx) {
  const {cs,ui}=ctx,s=cs.state,box=$('#quick'),windows=s.searchWindows.filter(q=>q.open);
  box.classList.toggle('show',windows.length>0);box.classList.toggle('unfocused',s.focusWin!=='quick');
  for(const card of box.querySelectorAll('[data-qid]'))if(!windows.some(q=>q.id===card.dataset.qid))card.remove();
  for(const q of windows) {
    let card=box.querySelector(`[data-qid="${q.id}"]`);
    if(!card) {
      card=document.createElement('section');card.className='search-window';card.dataset.qid=q.id;
      card.innerHTML=`<div class="qh"><span class="t">Suche ${q.number} / ${MAX_SEARCH_WINDOWS}</span><button data-q="new">+ Neue Suche</button><button data-q="esc" aria-label="Diese Suche schließen">✕</button></div><div class="qf"><input id="${q.number===2?'quick-input':'quick-input-'+q.id}" data-qinput autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="Suchtext für Suche ${q.number}"><button data-q="enter">⏎</button></div><label class="qscope">Suchbereich<select data-qscope></select></label><div class="qc row-scroll"></div><div class="qoptions"></div><div class="ql" data-scroll-key="${q.id}"></div><div class="qs" role="status"></div>`;
      box.append(card);
    }
    card.classList.toggle('active',s.quick===q&&s.focusWin==='quick');
    card.querySelector('[data-q=new]').disabled=windows.length>=MAX_SEARCH_WINDOWS;
    const input=card.querySelector('[data-qinput]');if(document.activeElement!==input)input.value=q.query;
    input.placeholder=ui.QUICK_PLACEHOLDER || 'Unabhängig suchen …';
    updateHtml(card.querySelector('[data-qscope]'),searchScopeOptions(cs,q));
    updateHtml(card.querySelector('.qc'),['all','code','ext','callback','op','par','chan','table','dat'].map(f=>`<button class="chip ${q.filter===f?'on':''}" data-qfilter="${f}">${esc((ui.FILTER_LABELS || {})[f] || f)}</button>`).join(''));
    updateHtml(card.querySelector('.qoptions'),searchOptions(q));
    const rows=q.hits.map((h,i)=>h.kind==='section'
      ?`<div class="hit section"><span class="art">${esc(h.num || '')}</span><span class="main"><span class="ttl">${esc(h.text)}</span><span class="cnt">${esc(h.count ?? '')}</span></span></div>`
      :`<button class="hit ${i===q.selected?'sel':''} ${familyClass(cs,h)}" data-qrow="${i}" data-key="q${i}"><span class="art ${artClass(h)}">${esc(artOf(ui,h))}</span><span class="main"><div class="wo">${h.line?`<span class="det">Z.${h.line}</span>`:''}${esc(pathText(cs,h))}</div><div class="txt">${esc(h.text)}</div></span></button>`).join('');
    updateHtml(card.querySelector('.ql'),rows);
    updateHtml(card.querySelector('.qs'),`${q.pending?'Suche läuft …':q.error?esc(q.error):`${q.total} Treffer · Stand der letzten Suche`} · Tippen = wählen · doppelt = springen · halten = im Hauptfenster untersuchen`);
  }
}

// ------------------------------------------------------------------ Lesekopien
export function renderFloats(ctx) {
  const {cs,ui}=ctx, s=cs.state, root=$('#floats');
  for (const card of root.querySelectorAll('[data-float]')) {
    if (!s.floats.some(f=>f.id===card.dataset.float)) {card.hostContext?.tabHelp?.dispose();card.remove();}
  }
  for (const f of s.floats) {
    const focus=s.floatFocus===f.id;
    let card=root.querySelector(`[data-float="${f.id}"]`);
    if (!card) {
      card=document.createElement('section');card.dataset.float=f.id;
      card.innerHTML='<div class="fh"></div><div class="fb" tabindex="0"></div><div class="float-copy-status" role="status"></div><div class="float-hint">Eingefrorener Stand · gleicher Look wie die Hauptansicht</div>';
      root.append(card);
    }
    card.className=`float ${f.live?'live':'historical'} ${focus?'focus':''} ${f.size==='full'?'full':'side'}`;
    card.style.fontSize=`${f.zoom*100}%`;card.setAttribute('aria-label',f.title);
    card.style.setProperty('--copy-zoom',String(f.zoom));
    updateHtml(card.querySelector('.fh'),`<button class="t" data-ffocus="${f.id}" title="${esc(f.title)}">${esc(f.title)}${f.zoom!==1?` · ${Math.round(f.zoom*100)} %`:''}</button>${f.live?`<button data-flayout="${f.id}" title="Zwischen Liste, Details und ganzem Arbeitsplatz wechseln">${["details","code"].includes(f.kind)?"Details":f.kind==="workspace"?"Alles":"Liste"} ▾</button>`:""}<button data-fsize="${f.id}" title="${f.size==='full'?'Kleines Fenster wiederherstellen':'Groß öffnen'}">${f.size==='full'?'Klein ↙':'Groß ↗'}</button><button data-fcopy="${f.id}" title="Aktuellen Inhalt kopieren">Kopieren</button><button data-fclose="${f.id}" aria-label="Zweitansicht schließen">✕</button>`);
    const content=card.querySelector('.fb'); content.dataset.scrollKey=`float-${f.id}`;
    card.querySelector('.float-hint').textContent=f.live?'Gemeinsame Auswahl und Änderungen · gleiche Aktionen wie im Original':'Historische Quelle · eingefrorener Stand · nur lesen';
    if(f.live) {
      if(!card.hostContext) {
        const host=document.createElement('div');host.className='cs cs-secondary';host.innerHTML=hostTemplate();normalizeHostIds(host,f.id);content.append(host);
        card.hostContext=createHostContext(ctx,host,f.id);
      }
      const hostCtx=card.hostContext, host=hostCtx.host;
      renderCS(hostCtx);
      const detailOnly=['details','code'].includes(f.kind) && !['analysis','spec'].includes(s.view);
      // Derselbe Renderer erzeugt auch die schmale Ansicht. Nur ihre Aufteilung ist anders.
      hostQuery(hostCtx,'#cs-list').hidden=detailOnly;
      hostQuery(hostCtx,'#cs-split').hidden=true;
      hostQuery(hostCtx,'#cs-detail').hidden=!detailOnly && f.kind!=='workspace';
      host.dataset.layout=detailOnly?'details':f.kind==='workspace'?'workspace':'list';
      host.style.zoom=String(f.zoom);
      normalizeHostIds(host,f.id);
      if(ctx.bindCSHost && !card.hostBound) {ctx.bindCSHost(hostCtx);card.hostBound=true;}
    } else {
      const body=f.code?snapshotCodeHtml(f.code):`<pre class="float-text">${esc(f.text)}</pre>`;
      updateHtml(content,body);
    }
    const operation=ctx.deviceCopy, status=card.querySelector('.float-copy-status');
    status.hidden=!(focus && operation?.kind==='float' && !operation.dismissed);
    updateHtml(status,status.hidden?'':`${esc(operation.message)}${operation.status==='failed'?'<button data-fmanual="true">Text manuell kopieren</button>':''}`);
  }
}

// ------------------------------------------------------------------ Offline
const HOME_URL = "https://tombkn.github.io/codesearch-pocket/";

export function renderOffline(ctx) {
  const { layers } = ctx;
  const o = ctx.offline;
  const layer = $("#layer-offline");
  layer.classList.toggle("show", Boolean(layers.offline));
  const btn = $("#btn-offline");
  if (btn) {
    const done = o.single || (o.manifest && o.cached === o.manifest.files.length);
    btn.textContent = done ? "✓ offline" : (o.busy ? "⇩ …" : "⇩");
    btn.classList.toggle("on", Boolean(done));
  }
  if (!layers.offline) return;
  const total = o.manifest ? o.manifest.files.length : 0;
  const totalBytes = o.manifest ? o.manifest.total : 0;
  const done = o.single || (o.manifest && o.cached === total);
  const yes = (v) => (v === true ? "ja" : (v === false ? "nein" : "unbekannt"));
  const status = o.single
    ? `<p><b>✓ Diese Datei enthält den ganzen Kurs.</b> Sie läuft ohne Netz. Der Fortschritt bleibt in diesem Browser.</p>`
    : `<table>
        <tr><td>Gespeichert</td><td><b>${o.cached} / ${total} Dateien</b> · ${mbText(o.bytes)} von ${mbText(totalBytes)} ${done ? "✓ komplett" : ""}</td></tr>
        <tr><td>Service Worker</td><td>${esc(o.sw)}</td></tr>
        <tr><td>Speicher geschützt</td><td>${yes(o.persisted)}${o.persisted ? "" : " – ohne Schutz darf der Browser bei Platzmangel löschen"}</td></tr>
        <tr><td>Als App geöffnet</td><td>${yes(o.installed)}</td></tr>
        <tr><td>Version</td><td><code>${esc(o.manifest ? o.manifest.version : "—")}</code></td></tr>
      </table>`;
  const single = o.manifest && o.manifest.single;
  layer.innerHTML = `<div class="lhead"><h1>OFFLINE</h1><button data-act="offline-close">✕</button></div>
    <div class="lbody md">
      ${status}
      ${o.progress ? `<p>Lade … ${esc(o.progress)}</p>` : ""}
      ${o.error ? `<p style="color:var(--red)">${esc(o.error)}</p>` : ""}
      <div class="tbtns">
        ${o.single ? "" : `<button class="special" data-off="download">${done ? "Alles neu laden" : "Komplett offline speichern"}</button>`}
        ${o.single ? "" : `<button data-off="persist">Speicher schützen</button>`}
        ${o.installPrompt ? `<button class="special" data-off="install">App installieren</button>` : ""}
        ${o.single ? "" : `<button data-off="check">Prüfen</button>`}
      </div>
      <h2>So wird es eine App auf dem Handy</h2>
      <p>Adresse: <a href="${HOME_URL}">${HOME_URL.replace(/^https:\/\//, "")}</a></p>
      <p><b>iPhone (Safari):</b> Teilen ⬆ → <b>Zum Home-Bildschirm</b> → Hinzufügen. Danach die App vom Home-Bildschirm öffnen, einmal mit Netz, bis oben <b>✓ offline</b> steht.</p>
      <p><b>Android (Chrome):</b> Menü ⋮ → <b>App installieren</b> (oder der Knopf oben, falls er erscheint). Dann öffnen, bis <b>✓ offline</b> steht.</p>
      <p><b>Test:</b> Flugmodus an, App öffnen – Kurs, Fenster, TD-Seite, Atlas und Bilder laufen weiter.</p>
      ${single ? `<h2>Eine Datei zum Mitnehmen</h2>
      <p><a href="${esc(single.path)}" download>${esc(single.path)}</a> (${mbText(single.size)}) – der ganze Kurs in einer HTML-Datei. Android: in Downloads mit Chrome öffnen. PC: Doppelklick. iPhone zeigt sie in der Dateien-App nur als Vorschau ohne Bedienung – dort die App vom Home-Bildschirm nehmen.</p>` : ""}
      <h2>Fortschritt mitnehmen</h2>
      <p>Der Fortschritt liegt im Speicher dieses Browsers. Zum Wechseln (z. B. von der Datei in die App) sichern und dort laden.</p>
      <div class="tbtns"><button data-off="export">Fortschritt sichern</button><button data-off="import">Fortschritt laden</button></div>
      <input type="file" id="progress-file" accept="application/json,.json" hidden>
    </div>`;
}

// Bild-Adresse: in der Einzel-Datei steckt das Bild als data:-URL in window.__POCKET_IMG__
function imgSrc(file) {
  const packed = typeof window !== "undefined" && window.__POCKET_IMG__;
  return (packed && packed[file]) || `img/${file}`;
}

function mbText(bytes) {
  return `${(Number(bytes || 0) / 1048576).toFixed(1).replace(".", ",")} MB`;
}
