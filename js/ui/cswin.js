import {searchOptions} from './search-options.js';
import {hostQuery} from './cs-host.js';
import {selectableHit} from '../core/multi-selection.js';
import { renderAnalysis } from "./analysis.js";
import { renderSpec } from './spec.js';
// Zeichnet das CodeSearch-Fenster aus dem Zustand von cs (js/core/cs.js). Keine Logik ausser Darstellung.

import { $, esc, familyToken, updateHtml } from "./dom.js";
import { abs, rel, baseName, fmtNum } from "../core/util.js";
import { DATA_LABELS, CONTEXT_MODES, TARGET_EDIT_MODES } from "../core/cs.js";
import { applyLook } from "./looks.js";

const GROUP_TABS = { both: ["search", "trace", "refs", "impact", "errors"], net: ["chain", "table"], code: ["map", "entries", "tour", "record", "check"] };
const CODE_TABS = new Set(["map", "entries", "tour", "record", "check"]);

export function artOf(ui, h) {
  if (h.art) return h.art;
  if (h.hitkind) return h.hitkind;
  if (h.kind === "notice") return "";
  return (ui.KIND_LABELS || {})[h.kind] || String(h.kind || "").toUpperCase();
}

export function artClass(h) {
  // Familie kommt aus den Daten: nur eine bekannte Familie wird Klasse. Eine unbekannte ergab schon frueher keine
  // passende CSS-Regel - darum hier "" statt eines Rueckfalls auf k-wire o.ae., das Aussehen bleibt gleich.
  if (h.family && ["opfind", "chain", "wire"].includes(h.kind)) {
    const family = familyToken(h.family);
    return family ? `k-${family}` : "";
  }
  if (h.kind === "code") return h.hitkind === "KOMMENTAR" ? "k-comment" : "k-code";
  if (h.kind === "lint") return "k-warn";
  if (h.kind === "hot" || h.art === "STOPP" || h.art === "✗ STOPP" || h.kind === "error") return "k-stop";
  if (h.cat) return `k-${esc(h.cat === "par" ? "callback" : h.cat)}`;
  const map = { expr: "k-expr", export: "k-export", bind: "k-bind", wire: "k-wire", oppar: "k-oppar", watcher: "k-watcher", trigger: "k-hot", entry: h.entry_state === "HOT" ? "k-hot" : (h.entry_state === "AUS" ? "k-comment" : "k-ok") };
  return map[h.kind] || "";
}

export function pathText(cs, h) {
  if (!h.path) return "";
  const d = cs.state.display;
  const path = rel(h.path);
  const format = d.details ? "full" : d.format;
  if (format === "name") return baseName(h.path) || "CodeSearch_Tutorial";
  if (format === "full") return h.path;
  if (format === "op_full") return `op('${h.path}')`;
  const base = d.base;
  const relText = h.path === base ? "." : (h.path.startsWith(base + "/") ? h.path.slice(base.length + 1) : h.path);
  if (format === "relative") return relText;
  return `op('${relText}')`;
  void path;
}

export function renderTitle(ctx) {
  const $ = selector => hostQuery(ctx, selector);
  const { cs } = ctx;
  const s = cs.state;
  const focus = cs.net.op(s.focus);
  const name = focus ? (focus.name || "CodeSearch_Tutorial") : s.focus;
  const type = focus ? focus.type : "";
  updateHtml($("#cs-title"), `
    <span class="focus"><b>FOCUS</b> ${esc(name)} · ${esc(type)} · bleibt</span>
    <span class="sp"></span>
    <button class="quickbtn" data-act="quick" title="Schnellsuche (Ctrl+P)">quick ⌕</button>
    <button class="look" data-act="look" title="Look wählen: Farben und Lesbarkeit" aria-haspopup="dialog">LOOK · ${esc(cs.ui.CODESEARCH_LOOKS?.[cs.cs.Look]?.[0] || cs.cs.Look)} ▾</button>
    <button class="wbtn" data-act="win-min" title="Minimieren">—</button>
    <button class="wbtn" data-act="win-max" title="Maximieren / Zurück">▢</button>
    <button class="wbtn" data-act="win-close" title="Schließen (Esc)">✕</button>`);
}

// Bereich (Par Scope) gilt fuer SEARCH, USES, USED BY, IMPACT, ERRORS - nur dort erscheinen die Scope-Chips.
const SCOPE_MODES = ["search", "trace", "refs", "impact", "errors"];

export function renderScopes(ctx) {
  const $ = selector => hostQuery(ctx, selector);
  const { cs } = ctx;
  const s = cs.state;
  // 1.10.3: eine Kopfzeile wie native ui/scopes - SUCHEN IN + Scope-Chips, danach AUSWAHL / DIESE COMP, Zieltext,
  // FLOWLENS, LLM ANALYSE, SPEC, ZWEITANSICHT. Die Zeile bleibt immer sichtbar (die drei Werkzeug-Knoepfe gelten in
  // jedem Tab); Scope-Chips und Kontext-Umschalter zeigen sich nach ihren eigenen Regeln (Vereinigung beider Mengen).
  const showScopeChips = SCOPE_MODES.includes(s.mode) && !s.view;
  const showContext = CONTEXT_MODES.has(s.mode) && !["analysis", "spec"].includes(s.view);
  const box = $("#cs-scopes");
  box.style.display = "";
  const pane = baseName(abs(s.paneOwner)) || "CodeSearch_Tutorial";
  const scope = cs.cs.Scope;
  const comp = baseName(cs.cs.Scopecomp || "") || "…";
  const contextActive = cs.contextActive();
  const parts = [];
  if (showScopeChips) {
    // DIESE COMP legt den Bereich selbst fest: Chips bleiben sichtbar, aber gedimmt und nicht klickbar; Label BEREICH wie native.
    const chip = (key, label) => `<button class="chip ${scope === key ? "on" : ""} ${contextActive ? "dim" : ""}" data-scope="${key}"${contextActive ? " disabled" : ""}>${label}</button>`;
    parts.push(`<span class="lbl">${contextActive ? "BEREICH" : "SUCHEN IN"}</span>`);
    parts.push(chip("project", "GLOBAL"), chip("currentflat", `${esc(pane)}  NUR`), chip("currentpane", `${esc(pane)}  REKURSIV`), chip("comp", `IN ${esc(comp)}  ▼`));
  }
  if (showContext) {
    parts.push(`<div class="context-switch" role="group" aria-label="Analyse-Kontext wählen">
      ${[['selection', 'AUSWAHL', 'Kontext: ausgewählter Operator'], ['comp', 'DIESE COMP', 'Kontext: das offene Netzwerk · Rechtsklick oder lange drücken für COMP-Aktionen']].map(([key, label, title]) => `<button type="button" class="context-button" data-ctx="${key}" aria-pressed="${s.context === key}" title="${title}"><span class="context-check" aria-hidden="true">${s.context === key ? '✓' : ''}</span><span>${label}</span></button>`).join('')}
    </div>`);
    parts.push(`<span class="ctxinfo">${esc(cs.contextDescription())}</span>`);
    parts.push(`<button class="chip" data-act="flowlens">FLOWLENS ↗</button>`);
  }
  parts.push(`<button class="chip ${s.view === "analysis" ? "on" : ""}" data-act="analysis" title="Geführte Analyse mit deinen vorhandenen Chats">LLM ANALYSE ↗</button>`);
  parts.push(`<button class="chip ${s.view === 'spec' ? 'on' : ''}" data-act="spec" title="Gewünschtes Verhalten und eigene Tests">SPEC ↗</button>`);
  parts.push(`<button class="chip" data-act="float-menu" title="Bedienbare Zweitansicht: Fenster daneben oder groß öffnen">ZWEITANSICHT ↗ ▾</button>`);
  box.className = "cs-scopes row-scroll";
  updateHtml(box, parts.join(""));
}

export function renderTabs(ctx) {
  const $ = selector => hostQuery(ctx, selector);
  const { cs, ui, g } = ctx;
  const s = cs.state;
  const groupOfMode = ui.GROUP_OF_MODE || {};
  const activeGroup = groupOfMode[s.mode];
  const codeOk = cs.contextActive() || Boolean(cs.net.extClass(cs.codeTargetPath()) || cs.net.code[s.focus]);
  const html = ["both", "net", "code"].map((grp) => {
    const tabs = GROUP_TABS[grp].map((mode) => {
      const off = (CODE_TABS.has(mode) && !codeOk) || (mode === "table" && !cs._isTable(s.focus) && !cs._isTable(s.table.path));
      return `<button class="tab ${s.mode === mode ? "on" : ""} ${off ? "off" : ""}" data-mode="${mode}">${esc((ui.TAB_LABELS || {})[mode] || mode)}</button>`;
    }).join("");
    // 1.10.3: Praefix-Schild vor den Tabs (wie native ui/tabs/grp_*): kurze Gruppenbezeichnung, langer Titel als Tooltip
    const title = (ui.GROUP_LABELS || {})[grp] || grp;
    const long = (ui.GROUP_TITLES || {})[grp] || "";
    return `<div class="tabgrp"><span class="gt ${activeGroup === grp ? "on" : ""}" title="${esc(long)}">${esc(title)}</span><div class="tabs">${tabs}</div></div>`;
  }).join("");
  $("#cs-tabs").className = `cs-tabs ${g.mods.alt ? "helpmode" : ""}`;
  updateHtml($("#cs-tabs"), html + `<div class="tab-extra">
      <button data-act="readorder" class="${s.view === "path" ? "on" : ""}" title="READ ORDER: Lesereihenfolge (lange drücken = ReadPath-Marken)">${esc((ui.TAB_LABELS || {}).path || "READ ORDER")}</button>
      <button data-act="help" class="${s.view === "guide" ? "on" : ""}" title="Funktionsübersicht">?</button>
    </div>`);
}

export function renderContext(ctx) {
  const $ = selector => hostQuery(ctx, selector);
  const { cs } = ctx;
  const s = cs.state;
  const box = $("#cs-context");
  // 1.10.3: AUSWAHL / DIESE COMP, Zieltext, FLOWLENS, LLM ANALYSE, SPEC und ZWEITANSICHT stehen in der SUCHEN-IN-Zeile
  // (renderScopes). Hier bleiben nur die PROJEKT-Chips der Code-Tabs und der ENTRIES-Bereichstext; leer = Zeile weg.
  const parts = [];
  if (CODE_TABS.has(s.mode)) {
    parts.push(`<span class="chip head">PROJEKT ›</span>`);
    for (const [key, label] of [["ext", "ALLE EXTENSIONS"], ["atlas", "ATLAS"], ["short", "SHORTCUTS"], ["health", "GESUND"]]) {
      parts.push(`<button class="chip ${s.overview === key ? "on" : ""}" data-overview="${key}">${label}</button>`);
    }
  }
  if (s.mode === "entries" && s.meta && s.meta.scopeText) parts.push(`<span class="ctxinfo">${esc(s.meta.scopeText)}</span>`);
  box.className = "cs-context row-scroll";
  updateHtml(box, parts.join(""));
}

// Ein Knopf je Extension (eigene Funktion, damit der Test das Markup direkt pruefen kann). slot stammt aus den
// Daten (ext[].slot) und ist dort nicht zwingend eine Zahl - darum wie jeder andere Wert escaped. String() statt
// esc()-Default: ein fehlender slot bleibt "undefined" (Number() = NaN, kein Menue) und wird nie "" (= Slot 0).
// app.js liest den Wert danach unveraendert ueber dataset.slot.
export function extensionButtonHtml(comp, ext) {
  return `<button class="extension-source" data-act="extension-menu" data-comp="${esc(comp)}" data-slot="${esc(String(ext.slot))}" aria-haspopup="dialog" title="${esc(ext.available ? `Code öffnen: ${abs(ext.path)}` : ext.reason)}">
      <span class="ext-kind">EXTENSION</span> <strong>${esc(ext.name)}</strong><span>${ext.available ? "Code öffnen ▾" : "Quelle prüfen ▾"}</span></button>`;
}

export function renderField(ctx) {
  const $ = selector => hostQuery(ctx, selector);
  const { cs, ui } = ctx;
  const s = cs.state;
  const input = $("#cs-input");
  const target = s.mode==='chain' ? cs.flowTarget() : cs.contextActive() ? s.paneOwner : CODE_TABS.has(s.mode) ? cs.codeTargetPath() : s.focus;
  const comp = cs.net.datComp.get(target) ?? target;
  const owner = cs.net.op(comp);
  const extensions = cs.net.extensionSources(comp);
  updateHtml($("#cs-target"), extensions.length ? `
    <div class="target-owner"><span class="target-label">${CODE_TABS.has(s.mode) ? "ANALYSEZIEL" : "FOCUS"}</span>
      <strong>${esc(owner?.name || comp)}</strong><span class="target-type">${esc(owner?.type || "")}</span>
      ${CODE_TABS.has(s.mode) && !cs.contextActive() && cs.cs.Analysistarget ? '<span class="target-pin">📌 gepinnt</span>' : ""}
      ${TARGET_EDIT_MODES.includes(s.mode) ? `<button class="chip target-edit" data-act="target-edit" title="Pfad tippen + Enter · Esc behält das Ziel">Ziel ändern…</button>` : ""}</div>
    <div class="extension-list">${extensions.map((ext) => extensionButtonHtml(comp, ext)).join("")}</div>
    <span class="target-path">${esc(abs(comp))}</span>` : "");
  $("#cs-mode-label").textContent = s.view === "path" ? "READ ORDER" : ((ui.TAB_LABELS || {})[s.mode] || s.mode).toUpperCase();
  input.placeholder = s.mode === "table" ? "filtern … oder [zeile,spalte] + ⏎" : ((ui.MODE_HINTS || {})[s.mode] || "suchen …");
  const value = s.mode === "search" ? (s.fieldDraft || s.query) : (s.mode === "table" ? s.table.query : s.fieldDraft || "");
  if (document.activeElement !== input && input.value !== value) input.value = value;
  if (document.activeElement === input && ctx.fieldSynced !== value && input.value !== value && !String(input.value).startsWith(">")) input.value = value;
}

export function renderFilters(ctx) {
  const $ = selector => hostQuery(ctx, selector);
  const { cs, ui } = ctx;
  const s = cs.state;
  const box = $("#cs-filters");
  if (s.mode !== "search" || s.view) { updateHtml(box, ""); return; }
  const counts = (s.meta && s.meta.counts) || {};
  const f = cs.cs.Searchfilter;
  const chip = (key) => `<button class="chip ${f === key ? "on" : ""}" data-filter="${key}">${esc((ui.FILTER_LABELS || {})[key] || key)}${key === "all" ? "" : `<span class="n">${counts[key] ?? 0}</span>`}</button>`;
  let html = chip("all") + `<span class="sep"></span><span class="chip head">CODE ›</span>${chip("code")}${chip("ext")}${chip("callback")}`
    + `<span class="sep"></span><span class="chip head">NETZ ›</span>${chip("op")}${chip("par")}${chip("chan")}`
    + `<span class="sep"></span><span class="chip head">DAT-INHALT ›</span>${chip("table")}${chip("dat")}`;
  if (f === "op") {
    html += `<span class="sep"></span><span class="chip head">FAMILIE ›</span>` + (ui.OP_FAMILIES || []).map((k) => `<button class="chip ${cs.cs.Opfamily === k ? "on" : ""}" data-family="${k}">${esc((ui.OP_FAMILY_LABELS || {})[k] || k)}</button>`).join("");
    html += `<span class="sep"></span><span class="chip head">ADRESSE ›</span>` + (ui.OP_ADDRESSES || []).map((k) => `<button class="chip ${s.opAddress === k ? "on" : ""}" data-address="${k}" title="${esc((ui.OP_ADDRESS_HELP || {})[k] || "")}">${esc((ui.OP_ADDRESS_LABELS || {})[k] || k)}</button>`).join("");
  }
  box.className = "cs-filters row-scroll";
  updateHtml(box, html + searchOptions({caseSensitive:cs.cs.Casesensitive,regex:cs.cs.Regex,includeTables:cs.cs.Includetables,includeSys:cs.cs.Includesys,maxResults:cs.cs.Maxresults},'data-search-option'));
}

function dataControls(cs) {
  const s = cs.state;
  if (["record", "errors", "check"].includes(s.mode) || s.view === "why") return "";
  const d = s.display, layout = s.splitLayout || {};
  // 1.10.3: GRUPPEN und DETAILS klappen die Seitenspalten ein (native ui/floatbar); Zustand bleibt ueber Schliessen
  return `<button class="chip" data-act="column-left" title="Gruppen-Chips ein- oder ausklappen">${layout.leftHidden ? '▷ GRUPPEN' : '◁ GRUPPEN'}</button>
    <button class="chip on" data-act="data-menu" title="DATEN: wie Adressen geschrieben werden">DATEN · ${DATA_LABELS[d.format]} ▾</button>
    ${d.details ? `<button class="chip on" data-act="data-back">ZURÜCK</button>` : `<button class="chip" data-act="data-details">DETAILS</button>`}
    <button class="chip" data-act="data-copy">KOPIEREN</button>
    <button class="chip" data-act="column-right" title="Detail-Spalte und Code ein- oder ausklappen">${layout.rightHidden ? 'DETAILS ◁' : 'DETAILS ▷'}</button><span class="sep"></span>`;
}

export function renderFlowControls(ctx) {
  const box=hostQuery(ctx,'#cs-flow');if(!box)return;
  const {cs}=ctx,s=cs.state,f=s.flow;
  if(s.mode!=='chain' || s.view){updateHtml(box,'');return;}
  const select=(key,label,options)=>`<label>${label}<select data-flow-filter="${key}">${options.map(([value,text])=>`<option value="${value}" ${String(f.filters[key])===String(value)?'selected':''}>${text}</option>`).join('')}</select></label>`;
  updateHtml(box,`<div class="flow-actions row-scroll"><button data-act="flow-pin" class="chip ${f.pinned?'on':''}" aria-pressed="${f.pinned}">${f.pinned?'📌 FLOW fixiert · lösen':'FLOW fixieren'}</button><button class="chip" data-act="flow-refresh">↻ Aktualisieren</button><button class="chip" data-act="flow-pane">Netz rechts daneben ↗</button><span>${esc(abs(cs.flowTarget()))}</span></div>
    <details class="flow-options" data-persist="flow-options"><summary>Filter und Bereich${f.pinned?' · Stand bleibt bis Aktualisieren':''}</summary><div class="flow-filter-fields">${select('direction','Richtung',[['both','Beide'],['up','Quellen'],['down','Folgen']])}${select('family','Familie',['all','top','chop','sop','dat','comp','mat','pop'].map(v=>[v,v==='all'?'Alle':v.toUpperCase()]))}${select('links','Verbindungen',[['all','Alle'],['wire','Kabel / COMP'],['refs','Parameter-Referenzen']])}${select('depth','Tiefe',[1,2,4,8,16,64].map(n=>[n,String(n)]))}</div><p>${f.pinned?'Ziel und Suchbereich bleiben beim Navigieren erhalten. Filter ändern nur diese Darstellung. Projektänderungen erscheinen nach Aktualisieren.':'Ohne Fixierung folgt das Ziel der Auswahl bzw. DIESE COMP.'} Bereich für Parameter-Leser: ${esc(abs((f.pinned?f.scope?.root:cs.scopeRoot()) || ''))}${f.pinned&&f.scope?.flat?' · direkt':''}. Kabel und Quellen können darüber hinausführen.</p></details>`);
}

export function renderRecord(ctx) {
  const $ = selector => hostQuery(ctx, selector);
  const { cs } = ctx;
  const s = cs.state;
  const box = $("#cs-record");
  if (s.mode !== "record") { updateHtml(box, ""); return; }
  const r = s.record;
  const duration = r.liveContinuous ? "CONTINUOUS ↔" : `${fmtNum(Number(cs.cs.Recordseconds))} s ↔`;
  box.className = "cs-record row-scroll";
  updateHtml(box, `
    <button class="rbtn ${r.recording ? "live" : ""}" data-rec="${r.recording ? "stop" : "start"}">${r.recording ? "■ STOP" : "▶ START"}</button>
    <button class="rbtn ${r.liveHold ? "on" : ""}" data-rec="hold">${r.liveHold ? "FOLLOW LIVE" : "HOLD VIEW"}</button>
    <button class="rbtn ${r.liveMini ? "on" : ""}" data-rec="${r.liveMini ? "full" : "mini"}">${r.liveMini ? "FULL TAB" : "MINI WINDOW"}</button>
    <button class="rbtn" data-rec="duration" title="Dauer: CONTINUOUS oder Recordseconds">${duration}</button>
    <span class="rinfo">Ziel: …/${esc(baseName(abs(r.target)))}</span>
    <button class="rbtn" data-rec="prev">◀ PREV</button>
    <button class="rbtn" data-rec="next">NEXT ▶</button>
    <button class="rbtn" data-rec="copy">COPY CHAIN</button>
    <button class="rbtn ${s.view === "why" ? "on" : ""}" data-rec="why">WARUM ▸</button>`);
}

export function renderCrumb(ctx) {
  const $ = selector => hostQuery(ctx, selector);
  const { cs, ui } = ctx;
  const s = cs.state;
  // 1.10.3: kurze Brotkrume wie native - 'FOCUS name' (📌 wenn gepinnt) › Art › [Symbol] › [Zeile]. Gruppe und Tab stehen
  // schon in der Tab-Zeile, 'sieht:' im Alt-Hilfetext; 'braucht:' (die Handlungsanweisung) nur, solange keine Zeile markiert ist.
  const view = { landkarte: "LANDKARTE", why: "WARUM", route: "ROUTE", system: "SYSTEM", guide: "FUNKTIONEN", states: "STATE-ATLAS", path: "READ ORDER" }[s.view] || "";
  const target = s.mode === "chain" ? cs.flowTarget() : s.mode === "table" ? s.table.path : (CODE_TABS.has(s.mode) ? cs.codeTargetPath() : s.focus);
  const pinned = CODE_TABS.has(s.mode) && !cs.contextActive() && Boolean(cs.cs.Analysistarget);
  const hit = cs.selectedHit || (s.mode === "table" ? cs.tableSelectedHit() : null);
  const owner = cs.net.op(target);
  const art = hit ? artOf(ui, hit) : (owner?.type || "");
  const back = document.getElementById("cs-back"), forward = document.getElementById("cs-forward");
  if (back) back.disabled = (s.history || []).length < 2;
  if (forward) forward.disabled = !(s.future || []).length;
  const segments = [`<b>FOCUS</b> ${pinned ? "📌 " : ""}${esc(baseName(abs(target)) || "CodeSearch_Tutorial")}`];
  if (view) segments.push(`<b>${view}</b>`);
  if (art) segments.push(esc(art));
  if (hit?.ctx) segments.push(esc(hit.ctx));
  if (hit?.line) segments.push(`Zeile ${esc(String(hit.line))}`);
  const needs = hit ? "" : ((ui.MODE_NEEDS || {})[s.view === "path" ? "path" : s.mode] || "");
  $("#cs-crumb").innerHTML = segments.join(" › ") + (needs ? ` &nbsp; braucht: ${esc(needs)}` : "");
}

export function renderGroups(ctx) {
  const $ = selector => hostQuery(ctx, selector);
  const { cs } = ctx;
  const groups = cs.state.mode === "table" ? [] : cs.groups();
  const box = $("#cs-groups");
  box.className = "cs-groups row-scroll";
  const s=cs.state,count=s.multi.size,choose=s.mode!=='table' && s.hits.some(selectableHit)
    ? `<button class="chip ${s.multiSelect?'on':''}" data-act="selection-mode" aria-pressed="${Boolean(s.multiSelect)}">${s.multiSelect?'✓ Mehrfachauswahl':'Mehrere auswählen'}</button>${count>1 || s.multiSelect?`<button class="chip" data-act="selection-menu">${count} ausgewählt · Aktionen ▾</button><button class="chip" data-act="selection-clear">Aufheben</button>`:''}`:'';
  // GRUPPEN eingeklappt: nur die Werkzeugzeile bleibt, die Gruppen-Chips verschwinden (Liste nimmt den Platz)
  const shownGroups = s.splitLayout?.leftHidden ? [] : groups;
  updateHtml(box, choose+dataControls(cs) + shownGroups.map((gp) => `<button class="g" data-jump="${gp.index}">${esc(gp.num)} · ${esc(gp.title)}${gp.count !== null && gp.count !== undefined ? `<span class="n">${gp.count}</span>` : ""}</button>`).join(""));
}

export function renderList(ctx) {
  const $ = selector => hostQuery(ctx, selector);
  const { cs, ui } = ctx;
  const s = cs.state;
  const box = $("#cs-list");
  box.classList.toggle('guide-view', s.view === 'guide');
  if (s.mode === "table") { updateHtml(box, tableHtml(cs)); return; }
  const cols = cs.columns();
  const head = `<div class="colhead"><span>${esc(cols[0])}</span><span>${esc(cols[1])} · ${esc(cols[2])} / ${esc(cols[3])}</span></div>`;
  const rows = s.hits.map((h, i) => {
    if (h.kind === "section") {
      const acc = h.accent ? `acc-${h.accent}` : "";
      return `<button class="hit section ${h.level ? "lvl1" : ""} ${acc}" data-row="${i}" data-key="r${i}"><span class="art">${esc(h.num || "")}</span><span class="main"><span class="ttl">${esc(h.text)}</span>${h.count !== null && h.count !== undefined ? `<span class="cnt">${esc(h.count)}</span>` : ""}<span class="rest">${esc(h.detail || "")}</span></span></button>`;
    }
    const cls = ["hit", h.kind];
    if (i === s.selected) cls.push("sel");
    if (s.multi.has(i)) cls.push("multi");
    const wo = pathText(cs, h);
    const det = [h.detail, h.line && h.kind !== "tourstep" && h.kind !== "record" ? `Z.${h.line}` : ""].filter(Boolean).join(" · ");
    const st = h.state_change ? `<div class="st">${esc(h.state_change)}</div>` : "";
    // FLOW-Station: Distanz + Station im DATEN-Format (der volle Pfad steht im Detail)
    const txt = h.kind === "chain" && h.station
      ? `${h.dist ? (h.dist < 0 ? `(←${-h.dist}) ` : `(→${h.dist}) `) : ""}${h.station}`
      : h.text;
    return `<button class="${cls.join(" ")}" data-row="${i}" data-key="r${i}" ${selectableHit(h)?`aria-pressed="${s.multi.has(i)}"`:''}>${s.multiSelect&&selectableHit(h)?`<span class="selection-check" aria-hidden="true">${s.multi.has(i)?'✓':'○'}</span>`:''}<span class="art ${artClass(h)}" data-art="${i}">${esc(artOf(ui, h))}</span><span class="main"><div class="wo">${det ? `<span class="det">${esc(det)}</span>` : ""}${esc(wo)}</div><div class="txt">${esc(txt)}</div>${st}</span></button>`;
  }).join("");
  updateHtml(box, head + rows);
}

function tableHtml(cs) {
  const view = cs.tableView();
  const s = cs.state;
  const sel = s.table.sel;
  const data = cs.tableData();
  const dupCol = s.table.dups;
  const counts = {};
  if (dupCol >= 0) for (const row of data.slice(1)) counts[row[dupCol]] = (counts[row[dupCol]] || 0) + 1;
  const head = `<tr><th class="idx">#</th>${view.header.map((c, i) => `<th data-sort="${i}" class="${s.table.sort[0] === i ? "sorted" : ""}">${esc(c || "(ohne Namen)")}${s.table.sort[0] === i ? (s.table.sort[1] ? " ▼" : " ▲") : ""}</th>`).join("")}</tr>`;
  const body = view.rows.map((r) => `<tr><td class="idx">${r.index}</td>${r.cells.map((c, ci) => {
    const isSel = sel && sel.row === r.index && sel.col === ci;
    const dup = dupCol === ci && counts[c] > 1;
    return `<td data-cell="${r.index},${ci}" data-key="c${r.index}-${ci}" class="${isSel ? "sel" : ""} ${dup ? "dup" : ""}">${esc(c)}</td>`;
  }).join("")}</tr>`).join("");
  return `<div class="colhead"><span>TABLE</span><span>${esc(abs(view.path))} · ${view.rows.length} sichtbar · Kopf = sortieren · Doppeltippen = ändern · lange drücken = Menü</span></div>
    <div class="table-actions"><button data-act="td-undo" title="Strg+Z">↶ Rückgängig</button><button data-act="td-redo" title="Strg+Y oder Strg+Shift+Z">↷ Wiederherstellen</button></div>
    <div class="table-wrap"><table class="grid">${head}${body}</table></div>`;
}

const PY_KW = new Set(["def", "class", "return", "if", "elif", "else", "for", "while", "in", "not", "and", "or", "is", "None", "True", "False", "import", "from", "as", "try", "except", "with", "pass", "lambda", "self", "yield", "raise", "global"]);

function codeLineHtml(cs, dat, line, savedMembers = null) {
  const members = new Set(savedMembers ?? cs.net.members(dat).map((m) => m.name));
  const parts = [];
  let rest = line;
  const comment = rest.indexOf("#");
  let tail = "";
  if (comment >= 0 && !/['"][^'"]*#/.test(rest.slice(0, comment + 1))) {
    tail = rest.slice(comment);
    rest = rest.slice(0, comment);
  }
  const rx = /('[^']*'|"[^"]*")|([A-Za-z_][A-Za-z0-9_]*)|([^A-Za-z_'"]+)/g;
  let m;
  while ((m = rx.exec(rest))) {
    if (m[1]) parts.push(`<span class="str">${esc(m[1])}</span>`);
    else if (m[2]) {
      const w = m[2];
      if (PY_KW.has(w)) parts.push(`<span class="kw">${w}</span>`);
      else parts.push(`<span class="id ${members.has(w) ? "def" : ""}" ${savedMembers ? '' : `data-id="${esc(w)}"`}>${esc(w)}</span>`);
    } else parts.push(esc(m[3]));
  }
  if (tail) parts.push(`<span class="cm">${esc(tail)}</span>`);
  return parts.join("");
}

export function codeHtml(cs, dat, focusLine, { from = null, to = null } = {}) {
  const lines = dat === "BranchLab/experiment_script" ? cs.lab.script.split("\n") : cs.net.lines(dat);
  if (!lines.length) return "";
  const member = cs.net.enclosingFunction(dat, focusLine || 1);
  const m = member ? cs.net.member(dat, member) : null;
  const start = from ?? Math.max(1, m ? m.line - 1 : (focusLine || 1) - 6);
  const end = to ?? Math.min(lines.length, m ? (m.end || m.line) + 1 : (focusLine || 1) + 8);
  const out = [];
  for (let n = start; n <= end; n += 1) {
    out.push(`<div class="ln ${n === focusLine ? "focus" : ""}"><span class="no">${n}</span><span>${codeLineHtml(cs, dat, lines[n - 1] ?? "")}</span></div>`);
  }
  return `<div class="code" data-dat="${esc(dat)}">${out.join("")}</div>`;
}

export function snapshotCodeHtml(code) {
  return `<div class="code">${code.lines.map((line, i) => `<div class="ln ${code.start + i === code.line ? 'focus' : ''}"><span class="no">${code.start + i}</span><span>${codeLineHtml(null, code.dat, line, code.members)}</span></div>`).join('')}</div>`;
}

export function renderDetail(ctx) {
  const $ = selector => hostQuery(ctx, selector);
  const { cs } = ctx;
  const s = cs.state;
  const box = $("#cs-detail");
  const h = cs.selectedHit || (s.mode === "table" ? cs.tableSelectedHit() : null);
  const rightHidden = Boolean(s.splitLayout?.rightHidden);   // DETAILS eingeklappt: Spalte und Griff weg
  box.classList.toggle("hidden-col", rightHidden);
  $("#cs-split").classList.toggle("hidden-col", rightHidden);
  box.classList.toggle("empty", !h);
  $("#cs-split").classList.toggle("empty", !h);
  if (!h) {
    updateHtml(box, `<div class="det-empty">DETAIL – Zeile antippen = Steckbrief + Code · lange drücken = Menü (Rechtsklick) · ART-Zelle antippen = Tooltip</div>`);
    return;
  }
  const bar = [];
  if (h.line && cs.net.code[rel(h.path)]) bar.push(`<button data-act="editor">IM EDITOR ÖFFNEN</button>`);
  if (h.kind === "code" && h.line && cs.net.op(rel(h.path)) && typeof cs.net.op(rel(h.path)).text === "string") bar.push(`<button data-act="edit">BEARBEITEN</button>`);
  bar.push(`<button data-act="float-list">LISTE ↗ DANEBEN</button><button data-act="float-menu">WEITERE ANSICHTEN ▾</button>`);
  if (s.learning) bar.push(`<button data-act="reveal">AUFDECKEN</button>`);
  let blocks = s.mode === "table" ? tableDetail(cs, h) : cs.detailFor(h);
  const hidden = !cs.cs.Showcallgraph && !s.revealed;
  let detailRow = 0;   // laufende Zeilennummer ueber alle Bloecke = Shift+F6-Cursor (cs.state.detailCursor)
  const blocksHtml = blocks.map((b) => {
    const closed = s.collapsedBlocks.has(b.title);
    const veiled = hidden && b.title === "AUFRUFE";
    const rows = closed ? "" : (veiled ? `<div class="kv act" data-act="reveal"><span class="k">VERDECKT</span><span class="v">Call-Graph verdeckt (Showcallgraph aus) – antippen zum Aufdecken</span></div>`
      : b.rows.map(([k, v, act]) => { const index = detailRow++; return `<div class="kv ${act ? "act" : ""}${s.detailFocus && index === s.detailCursor ? " cur" : ""}" data-detail-row="${index}" ${act ? `data-detail="${esc(act)}"` : ""}><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`; }).join(""));
    if (closed || veiled) detailRow += b.rows.length;   // verborgene Zeilen zaehlen mit, damit der Cursor zum Modell passt
    return `<div class="blk"><button class="blk-h" data-block="${esc(b.title)}">${esc(b.title)}<span class="tw">${closed ? "▸" : "▾"}</span></button>${rows}</div>`;
  }).join("");
  let code = "";
  const cv = s.codeView;
  const cvOp = cv.path ? cs.net.op(rel(cv.path)) : null;
  if (cvOp && typeof cvOp.text === "string") {
    const dat = rel(cv.path);
    code = `<div class="code-head"><span class="sp">${esc(cv.path)}:${esc(cv.line ?? "")}${cv.definition ? " · DEFINITION" : ""}</span>
      <button data-act="def-back" title="Alt+←">◀</button><button data-act="def-fwd" title="Alt+→">▶</button><button data-act="code-full" aria-pressed="${Boolean(s.codeFull)}">${s.codeFull?'Ausschnitt':'Vollcode'}</button><button data-act="float-code">CODE ↗ FENSTER</button></div>
      <div class="code-controls"><label>Code-Schrift <input type="range" min="25" max="250" step="5" value="100" data-code-zoom aria-label="Code-Schriftgröße"><output>100 %</output></label><button data-act="code-zoom-reset">100 %</button></div>
      <div class="code-resize" data-code-resize tabindex="0" role="separator" aria-label="Höhe des Codebereichs einstellen" aria-orientation="horizontal" aria-valuemin="100" aria-valuemax="900" aria-valuenow="${ctx.codeHeight || 300}">↕ Codebereich ziehen</div>
      <div class="code-viewport" data-scroll-key="code-${esc(dat)}-${s.codeFull?'full':'excerpt'}" tabindex="0" aria-label="${s.codeFull?'Vollständiger Code':'Codeausschnitt'}">${codeHtml(cs, dat, cv.line, s.codeFull?{from:1,to:dat==='BranchLab/experiment_script'?cs.lab.script.split('\n').length:cs.net.lines(dat).length}:{})}</div>`;
  }
  const detailKey = `${s.mode}|${h.path}|${h.ctx}|${h.line}|${h.row}|${h.col}|${cv.path}|${cv.line}|${s.detailFocus ? s.detailCursor : "-"}`;
  updateHtml(box, `<div class="det-bar">${bar.join("")}</div>${blocksHtml}${code}`, ctx.detailKey !== detailKey);
  const slider=box.querySelector('[data-code-zoom]');if(slider){slider.value=String(Math.round((s.codeZoom || 1)*100));slider.nextElementSibling.textContent=slider.value+' %';}
  ctx.detailKey = detailKey;
}

function tableDetail(cs, h) {
  const header = cs.tableData()[0] || [];
  const col = header[h.col];
  const value = h.text;
  const numeric = /^-?\d+(\.\d+)?$/.test(value.trim());
  const users = [];
  if (rel(h.path) === "BranchLab/ColorEngine/palette") {
    if (["r", "g", "b"].includes(col)) users.push(`ColorEngineExt.ApplyPreset Z.44: float(row[${header.indexOf(col)}].val) – Zeile per table.row(name)`);
    if (col === "name") users.push("ColorEngineExt.ApplyPreset Z.39: table.row(name) sucht die Zeile über diesen Namen");
  }
  return [
    { title: "ZELLE", rows: [["ZELLE", `[${h.row}, ${h.col}]  ·  Zeile ${(cs.tableData()[h.row] || [])[0]} · Spalte ${col}`], ["WERT", value], ["TYP", numeric ? "str (sieht aus wie float – Code muss umwandeln)" : "str"], ["ADRESSE", cs.dataAddress(h)]] },
    { title: "WER NUTZT GENAU DIESE ZELLE", rows: users.length ? users.map((u) => ["LESER", u]) : [["LESER", "kein Leser im Code gefunden"]] },
    { title: "GANZER DAT", rows: rel(h.path) === "BranchLab/ColorEngine/palette" ? [["CODE", "ColorEngineExt Z.35: self.ownerComp.op('palette')"]] : [["CODE", "—"]] },
  ];
}

export function renderStatus(ctx) {
  const $ = selector => hostQuery(ctx, selector);
  const { cs, ui } = ctx;
  const s = cs.state;
  $("#cs-status").innerHTML = `<span class="l">${esc(cs.statusLine())}</span><span class="r">${esc((ui.MODE_KEYS || {})[s.mode] || "")}</span>`;
  const win = $("#cs");
  win.classList.toggle("closed", !ctx.host && !s.mainopen);
  if (!ctx.host && !s.mainopen) $("#cs-closed-why").textContent = s.status || "CodeSearch ist zu (Esc oder ✕). Shift+K oder der Knopf öffnet es wieder – Arbeitsplatz auf der Karte richtet die Station neu ein.";
  win.classList.toggle("min", !ctx.host && s.window === "min");
  win.classList.toggle("max", !ctx.host && s.window === "max");
  if (ctx.appliedLook !== cs.cs.Look) { applyLook(document.body, ui, cs.cs.Look); ctx.appliedLook = cs.cs.Look; }
  win.style.zoom = String(s.zoom);
  win.style.setProperty('--code-zoom',String(s.codeZoom || 1));
  // Zonen-Zoom (1.10.3, Strg + Rad ueber Liste / Details): Faktor je Zone, 1 = wie der Gesamtzoom
  win.style.setProperty('--zone-results',String(s.zoneZoom?.results || 1));
  win.style.setProperty('--zone-detail',String(s.zoneZoom?.detail || 1));
  win.style.setProperty('--code-height',`${ctx.codeHeight || 300}px`);
}

export function renderCS(ctx) {
  const $ = selector => hostQuery(ctx, selector);
  renderTitle(ctx);
  renderScopes(ctx);
  renderTabs(ctx);
  renderContext(ctx);
  renderField(ctx);
  renderFilters(ctx);
  renderRecord(ctx);
  renderFlowControls(ctx);
  renderCrumb(ctx);
  renderGroups(ctx);
  renderList(ctx);
  renderDetail(ctx);
  renderStatus(ctx);
  renderAnalysis(ctx);
  renderSpec(ctx);
}
