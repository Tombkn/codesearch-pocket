import {browserRegexQueue} from '../regex-queue.js';
// SEARCH: Code, Operatoren, Parameter, Kanaele, Tabellen im Bereich - mit derselben Abfrage-Sprache wie CodeSearch.

import { abs, compileQuery, fmtNum } from "../util.js";
import { hit, section, notice, countRows } from "./common.js";

const ALL_SECTION_MAX = 60;
const LANG_HITKIND = { glsl: "GLSL", json: "JSON", yaml: "YAML", xml: "XML", tscript: "TSCRIPT" };

// Welche Art Text steht im DAT? (wie die Einordnung in CodeSearch: Sprache, JSON-Dokument, Python)
export function datKind(net, o) {
  const pars = o.pars || {};
  const lang = pars.language && pars.language.v;
  const ext = pars.extension && pars.extension.v;
  const custom = pars.customext && pars.customext.v;
  if (lang && LANG_HITKIND[lang]) return LANG_HITKIND[lang];
  if (custom === "js" || ext === "js") return "JS";
  if (net.code[o.path] && !net.code[o.path].error) return "PYTHON";
  const text = (o.text || "").trim();
  if (/^[{[]/.test(text)) {
    try { JSON.parse(text); return "JSON"; } catch { /* kein JSON */ }
  }
  if (/^<!DOCTYPE html|<html[\s>]/i.test(text)) return "HTML";
  if (/^\s*[.#]?[\w-]+\s*\{[\s\S]*\}\s*$/m.test(text) && /:\s*[^;]+;/.test(text) && !/\bdef\b/.test(text)) return "CSS";
  if (/^<\w/.test(text)) return "XML";
  return "TEXT";
}

function pythonCommentLines(text) {
  // Kommentare und Docstrings: laufen nie
  const lines = text.split("\n");
  const comment = new Set();
  let inDoc = false;
  let quote = "";
  lines.forEach((line, i) => {
    const t = line.trim();
    if (inDoc) {
      comment.add(i + 1);
      if (t.includes(quote)) inDoc = false;
      return;
    }
    if (t.startsWith("#")) { comment.add(i + 1); return; }
    const m = /^("""|''')/.exec(t);
    if (m) {
      comment.add(i + 1);
      quote = m[1];
      const rest = t.slice(3);
      if (!rest.includes(quote)) inDoc = true;
    }
  });
  return comment;
}

export function lineHitkind(net, o, lineNo, comments) {
  const kind = datKind(net, o);
  if (kind === "PYTHON") return comments.has(lineNo) ? "KOMMENTAR" : "CODE";
  return kind;
}

function enclosing(net, dat, line) {
  const name = net.enclosingFunction(dat, line);
  if (!name) return "";
  const member = net.member(dat, name);
  return member && member.property ? name : `${name}()`;
}

function scopeOps(cs, request={}) {
  const scope = request.scopeRoot ?? cs.scopeRoot();
  const flat = request.flat ?? (cs.cs.Scope === "currentflat" && !cs.contextActive());
  // Der Bereichs-COMP selbst gehoert dazu (seine Custom-Pars, z. B. BranchLab.Intensity)
  const self = scope ? [cs.net.op(scope)].filter(Boolean) : [];
  const list = [...self, ...cs.net.within(scope, !flat)];
  return (request.includeSys ?? cs.cs.Includesys) ? list : list.filter((o) => !o.path.split("/").some((p) => p === "ExtUtils" || p === "Tour" || p === "ExtUtils1"));
}

export function searchIndex(cs, request={}) {
  const net = cs.net;
  const ops = scopeOps(cs,request);
  const opRows = [];
  const codeRows = [];
  const parRows = [];
  const chanRows = [];
  const tableRows = [];
  for (const o of ops) {
    const comment = o.comment ? [o.comment] : [];
    const parts = [...comment];
    if (o.tags && o.tags.length) parts.push("Tags: " + o.tags.join(", "));
    const short = o.pars && o.pars.parentshortcut && o.pars.parentshortcut.v;
    if (short) parts.push(`Shortcut: parent.${short}`);
    if (o.family === "COMP") parts.push(`${net.kids(o.path).length} Kinder`);
    const address = [];
    if (short) address.push("parent");
    if (o.ext && o.ext.length) address.push("ext");
    opRows.push({ o, match: [o.name, o.type, ...parts].join(" "), text: parts.join("   ·   "), address });
    if (typeof o.text === "string") {
      const text = o.path==='BranchLab/experiment_script'?cs.lab.script:o.text;
      const lines = text.split("\n");
      const comments = net.code[o.path] ? pythonCommentLines(text) : new Set();
      const isExt = net.datComp.has(o.path);
      const isCallback = ["chopexecuteDAT", "datexecuteDAT", "parameterexecuteDAT", "panelexecuteDAT", "opexecuteDAT", "executeDAT"].includes(o.type)
        || o.name.endsWith("_callbacks");
      const isPython = Boolean(net.code[o.path] && !net.code[o.path].error);
      lines.forEach((line, i) => {
        if (!line.trim()) return;
        codeRows.push({ o, line: i + 1, text: line, hitkind: lineHitkind(net, o, i + 1, comments), isExt, isCallback, isPython });
      });
    }
    if (Array.isArray(o.table)) {
      const table=o.path==='BranchLab/ColorEngine/palette'?cs.lab.palette:o.path==='SignalGarden/Palette/colors'?cs.lab.garden.table:o.table;
      table.forEach((row, i) => tableRows.push({ o, line: i, text: row.join("  ") }));
    }
    for (const [name, val] of Object.entries(o.pars || {})) {
      if ("e" in val) parRows.push({ o, name, kind: "expr", text: val.e });
      else if ("b" in val) parRows.push({ o, name, kind: "bind", text: val.b });
    }
    for (const edge of net.edgesTo(o.path, ["oppar", "watch", "callbacks"])) {
      parRows.push({ o, name: edge.par, kind: "oppar", text: edge.text });
    }
    for (const edge of net.edgesTo(o.path, ["export"])) {
      parRows.push({ o, name: edge.par, kind: "export", text: `${net.op(edge.src).name} Kanal „${edge.channel}“` });
    }
    for (const p of o.custom || []) {
      if (p.style === "Header") continue;
      parRows.push({ o, name: p.name, kind: "custom", text: p.label || p.name, value: p.value ?? p.default });
    }
    for (const chan of o.chans || []) chanRows.push({ o, name: chan.name, index: (o.chans || []).indexOf(chan) });
  }
  return { opRows, codeRows, parRows, chanRows, tableRows };
}

function codeHit(cs, r) {
  const h = hit("code", abs(r.o.path), r.text.replace(/\t/g, "    ").trim(), {
    line: r.line, detail: enclosing(cs.net, r.o.path, r.line), ctx: cs.net.enclosingFunction(r.o.path, r.line) || "",
  });
  h.hitkind = r.hitkind;
  return h;
}

// Kleine gemeinsame LRU: gleiche Quelle/Scope wird bei neuen Queries nicht neu zerlegt.
export function sharedSearchIndex(cs,request) {
  const key=JSON.stringify([request.scopeRoot??cs.scopeRoot(),request.flat??(cs.cs.Scope==='currentflat'&&!cs.contextActive()),request.includeSys??cs.cs.Includesys]);
  const revision=JSON.stringify([cs.lab.script,cs.lab.palette,cs.lab.garden.table]);
  if(cs.searchIndexRevision!==revision){cs.searchIndexCache=new Map();cs.searchIndexRevision=revision;}
  const cache=cs.searchIndexCache;
  if(cache.has(key)){const index=cache.get(key);cache.delete(key);cache.set(key,index);return {index,key};}
  const index=searchIndex(cs,request);cache.set(key,index);cs.searchIndexBuilds=(cs.searchIndexBuilds || 0)+1;
  while(cache.size>4)cache.delete(cache.keys().next().value);
  return {index,key};
}

// Überblick ohne Suchtext: eine Zeile pro Operator, begrenzt wie jede Suche (Maxresults).
function listAllOps(cs, request, filter, family, address, limit) {
  cs.regexQueue?.cancel(request.owner || 'main');
  const {index:idx,key:indexKey}=sharedSearchIndex(cs,request);
  const wantFamily = filter === 'ext' ? 'comp' : family;
  const wantAddress = filter === 'ext' ? 'ext' : address;
  const list = idx.opRows.filter((r) => (wantFamily === 'all' || r.o.family.toLowerCase() === wantFamily)
    && (wantAddress === 'all' || r.address.includes(wantAddress)));
  const counts = { op: list.length, code: 0, ext: filter === 'ext' ? list.length : 0, callback: 0, par: 0, chan: 0, table: 0, dat: 0 };
  const title = filter === 'ext' ? 'ALLE COMPs MIT EXTENSION' : 'ALLE OPERATOREN' + (wantFamily === 'all' ? '' : ' · ' + wantFamily.toUpperCase());
  const rows = [notice('Ohne Suchtext: Überblick', filter === 'ext' ? 'Eine Zeile pro COMP mit Extension. Suchtext filtert wieder Zeilen.' : 'Familie und Adresse grenzen ein; z. B. baseCOMP eintippen für nur baseCOMPs.'),
    section(title, '', list.length, { num: '1' })];
  for (const r of list.slice(0, limit)) {
    const h = hit('opfind', abs(r.o.path), r.text, { detail: r.o.type });
    h.art = r.o.family; h.family = r.o.family;
    rows.push(h);
  }
  return { rows, counts, total: list.length, indexKey, listAll: true };
}

export function buildSearch(cs, request={}) {
  const query = request.query ?? cs.state.query;
  const filter = request.filter ?? cs.cs.Searchfilter ?? 'all';
  const family = request.family ?? cs.cs.Opfamily ?? 'all';
  const address = request.address ?? cs.state.opAddress ?? 'all';
  const limit = Math.max(1, Math.min(2000,Number(request.maxResults ?? cs.cs.Maxresults) || 300));
  const options = {caseSensitive:Boolean(request.caseSensitive ?? cs.cs.Casesensitive),regex:Boolean(request.regex ?? cs.cs.Regex)};
  const counts = { op: 0, code: 0, ext: 0, callback: 0, par: 0, chan: 0, table: 0, dat: 0 };
  // Ohne Suchtext: OPERATOREN listet alles der gewählten Familie/Adresse, EXTENSIONS alle COMPs mit Extension.
  if (!query.trim() && (filter === 'op' || filter === 'ext')) return listAllOps(cs, request, filter, family, address, limit);
  if (!query.trim()) {
    cs.regexQueue?.cancel(request.owner || 'main');
    return { rows: [notice("Suchtext eingeben", "Wort = ganzes Wort · tick* Anfang · *tick* irgendwo · Wörter = UND · ^wort = ohne · ohne Suchtext: OPERATOREN oder EXTENSIONS zeigt alles")], counts, total: 0 };
  }
  if(query.length>512){cs.regexQueue?.cancel(request.owner || 'main');return {rows:[notice('Suchtext zu lang: höchstens 512 Zeichen.')],counts,total:0,error:'Suchtext zu lang'};}
  if(options.regex){try {new RegExp(query);}catch(error){cs.regexQueue?.cancel(request.owner || 'main');return {rows:[notice('Ungültiger Regex: '+error.message)],counts,total:0,error:error.message};}}
  const {index:idx,key:indexKey}=sharedSearchIndex(cs,request);
  let regexMatch=null;
  if(options.regex && (typeof Worker!=='undefined' || typeof window!=='undefined')) {
    cs.regexQueue ??= browserRegexQueue();
    if(!cs.regexQueue)return {rows:[notice('Regex-Worker nicht verfügbar. Suche ohne Regex bleibt bedienbar.')],counts,total:0,error:'Regex-Worker nicht verfügbar'};
    cs.searchIndexIds ??= new WeakMap();
    if(!cs.searchIndexIds.has(idx))cs.searchIndexIds.set(idx,(cs.searchIndexId=(cs.searchIndexId || 0)+1));
    const key=JSON.stringify([cs.searchIndexIds.get(idx),query,options.caseSensitive]);
    const texts=[...new Set([...idx.opRows.map(r=>r.match),...idx.codeRows.map(r=>r.text),...idx.parRows.map(r=>`${r.o.name} ${r.name} ${r.text}`),...idx.chanRows.map(r=>r.name),...idx.tableRows.map(r=>r.text)])];
    const result=cs.regexQueue.request(request.owner || 'main',key,{query,caseSensitive:options.caseSensitive,texts},request.onReady || (()=>cs.rebuild()));
    if(!result)return {rows:[notice('Regex wird geprüft …','Die Oberfläche bleibt bedienbar. Ein langsames Muster wird abgebrochen.')],counts,total:0,pending:true,indexKey};
    if(result.error)return {rows:[notice(result.error)],counts,total:0,error:result.error,indexKey};
    regexMatch=text=>result.matches.has(text);
  } else cs.regexQueue?.cancel(request.owner || 'main');
  const lineMatch = regexMatch || compileQuery(query, { ...options, whole: true });
  const nameMatch = regexMatch || compileQuery(query, { ...options, whole: false });
  const ops = idx.opRows.filter((r) => nameMatch(r.match));
  const code = idx.codeRows.filter((r) => lineMatch(r.text));
  const pars = idx.parRows.filter((r) => nameMatch(`${r.o.name} ${r.name} ${r.text}`));
  const chans = idx.chanRows.filter((r) => nameMatch(r.name));
  const tables = (request.includeTables ?? cs.cs.Includetables) ? idx.tableRows.filter((r) => nameMatch(r.text)) : [];
  counts.op = ops.length;
  counts.code = code.filter((r) => r.isPython).length;
  counts.ext = code.filter((r) => r.isExt).length;
  counts.callback = code.filter((r) => r.isCallback).length;
  counts.par = pars.length;
  counts.chan = chans.length;
  counts.table = tables.length;
  counts.dat = code.length + tables.length;
  const rows = [];
  const famOk = (r) => family === "all" || r.o.family.toLowerCase() === family;
  const addrOk = (r) => address === "all" || r.address.includes(address);
  const opHit = (r) => {
    const h = hit("opfind", abs(r.o.path), r.text, { detail: r.o.type });
    h.art = r.o.family;
    h.family = r.o.family;
    return h;
  };
  const parHit = (r) => {
    let text = r.text;
    if (r.kind === "expr") text = `= ${r.text}`;
    if (r.kind === "bind") text = `⟷ ${r.text}`;
    if (r.kind === "custom") text = `${r.name}   ·   ${r.text}` + (r.value !== undefined ? `   ·   = ${fmtNum(r.value)}` : "");
    const h = hit(r.kind, abs(r.o.path), text, { par: r.name, detail: r.name });
    if (r.kind === "oppar") h.art = "PAR-REF";
    return h;
  };
  const chanHit = (r) => hit("chan", abs(r.o.path), r.name, { detail: `Kanal ${r.index}` });
  const tableHit = (r) => {
    const h = hit("code", abs(r.o.path), r.text, { line: r.line, detail: `Zeile ${r.line}` });
    h.hitkind = "TABLE";
    return h;
  };
  const add = (title, list, make, max) => {
    if (!list.length) return;
    rows.push(section(title, "", list.length, { num: String(rows.filter((x) => x.kind === "section").length + 1) }));
    list.slice(0, max).forEach((r) => rows.push(make(r)));
  };
  let total = 0;
  if (filter === "all") {
    total = ops.length + code.length + pars.length + chans.length + tables.length;
    add("OPERATOREN", ops, opHit, ALL_SECTION_MAX);
    add("CODE", code, codeHit.bind(null, cs), limit);
    add("PARAMETER", pars, parHit, ALL_SECTION_MAX);
    add("KANÄLE", chans, chanHit, ALL_SECTION_MAX);
    add("TABLE", tables, tableHit, ALL_SECTION_MAX);
  } else if (filter === "op") {
    const list = ops.filter(famOk).filter(addrOk);
    total = list.length;
    add("OPERATOREN", list, opHit, limit);
  } else if (filter === "par") {
    total = pars.length;
    add("PARAMETER", pars, parHit, limit);
  } else if (filter === "chan") {
    total = chans.length;
    add("KANÄLE", chans, chanHit, limit);
  } else if (filter === "table") {
    total = tables.length;
    add("TABLE", tables, tableHit, limit);
  } else {
    const pick = {
      code: (r) => r.isPython, ext: (r) => r.isExt, callback: (r) => r.isCallback, dat: () => true,
    }[filter] || (() => true);
    const list = code.filter(pick);
    total = list.length + (filter === "dat" ? tables.length : 0);
    add(filter === "dat" ? "DAT-INHALT" : "CODE", list, codeHit.bind(null, cs), limit);
    if (filter === "dat") add("TABLE", tables, tableHit, limit);
  }
  // Maxresults deckelt die Liste, die Statuszeile nennt die Gesamtzahl
  let shown = 0;
  const capped = [];
  for (const row of rows) {
    if (row.kind === "section") { capped.push(row); continue; }
    if (shown < limit) { capped.push(row); shown += 1; }
  }
  if (!countRows(capped)) {
    return { rows: [notice("KEINE TREFFER", "Bereich, Kategorie, Schreibweise prüfen · Wort = ganzes Wort, *wort* findet Teile")], counts, total: 0 };
  }
  return { rows: capped, counts, total };
}

// READ ORDER: Lesereihenfolge des offenen Netzes (Quellen zuerst, dann entlang der Kabel)
export function buildReadOrder(cs) {
  const net = cs.net;
  const owner = cs.state.paneOwner;
  const kids = net.kids(owner).filter((o) => !o.stub || o.family === "COMP");
  const names = new Set(kids.map((o) => o.path));
  const inputs = new Map(kids.map((o) => [o.path, (o.inputs || []).filter((i) => names.has(i))]));
  const order = [];
  const done = new Set();
  const visit = (p, stack = new Set()) => {
    if (done.has(p) || stack.has(p)) return;
    stack.add(p);
    for (const src of inputs.get(p) || []) visit(src, stack);
    done.add(p);
    order.push(p);
  };
  kids.filter((o) => (o.inputs || []).length === 0 && net.edgesFrom(o.path, ["wire"]).length).forEach((o) => visit(o.path));
  kids.forEach((o) => visit(o.path));
  const rows = [section("LESEREIHENFOLGE", "ReadPath: erst die Quellen, dann entlang der Kabel", order.length, { num: "1" })];
  order.forEach((p, i) => {
    const o = net.op(p);
    const h = hit("pathstep", abs(p), `${o.name} (${o.type})`, { detail: `${i + 1}`, ctx: o.name });
    h.art = `SCHRITT ${i + 1}`;
    rows.push(h);
  });
  return { rows };
}
