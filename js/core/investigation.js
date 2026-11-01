// Begrenzte Pocket-Untersuchung. JSON-Vertrag aus td-codesearch/docs/state-atlas/PROTOCOL.md.
// Keine Python-Ausführung: Runtime-Daten stammen ausschließlich aus dem bekannten Lab-Modell.
import { abs, rel, clone, uid } from "./util.js";

const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function requireThat(ok, message) { if (!ok) throw new Error(message); }
function fields(value, allowed, required = allowed) {
  requireThat(object(value), "JSON-Objekt erwartet");
  requireThat(Object.keys(value).every((k) => allowed.includes(k)), "Unbekanntes JSON-Feld");
  requireThat(required.every((k) => Object.hasOwn(value, k)), `Pflichtfelder: ${required.join(", ")}`);
}
function string(value, name, max = 4000, empty = false) {
  requireThat(typeof value === "string" && value.length <= max && (empty || value.length > 0), `${name}: begrenzter String erforderlich`);
}

// JSON.parse allein verliert doppelte Keys. Dieser Parser lehnt sie vor der Übernahme ab.
export function parseProtocol(text, limit = 100000, maxNodes = 40000, maxDepth = 30) {
  requireThat(typeof text === "string" && new TextEncoder().encode(text).length <= limit, `JSON überschreitet ${limit} UTF-8-Bytes`);
  let pos = 0;
  let nodes = 0;
  const ws = () => { while (/[ \t\r\n]/.test(text[pos] || "") && pos < text.length) pos += 1; };
  const tokenString = () => {
    const start = pos++;
    while (pos < text.length) {
      const c = text[pos++];
      if (c === "\\") pos += 1;
      else if (c === '"') return JSON.parse(text.slice(start, pos));
    }
    throw new Error("Unvollständiger JSON-String");
  };
  const value = (depth = 0) => {
    requireThat(depth <= maxDepth && ++nodes <= maxNodes, "JSON zu tief oder zu viele Einträge");
    ws();
    if (text[pos] === '"') return tokenString();
    if (text[pos] === "{" || text[pos] === "[") {
      const isObject = text[pos++] === "{";
      const end = isObject ? "}" : "]";
      const out = isObject ? Object.create(null) : [];
      ws();
      if (text[pos] === end) { pos += 1; return out; }
      while (pos < text.length) {
        ws();
        let key;
        if (isObject) {
          requireThat(text[pos] === '"', "JSON-Key muss String sein");
          key = tokenString();
          requireThat(!Object.hasOwn(out, key), `Doppelter JSON-Key: ${key}`);
          ws(); requireThat(text[pos++] === ":", "JSON-Doppelpunkt fehlt");
        }
        const item = value(depth + 1);
        if (isObject) out[key] = item; else out.push(item);
        ws();
        if (text[pos] === end) { pos += 1; return out; }
        requireThat(text[pos++] === ",", "JSON-Komma fehlt");
      }
      throw new Error("Unvollständiges JSON");
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(pos));
    requireThat(match, "Ungültiger JSON-Wert");
    pos += match[0].length;
    const out = JSON.parse(match[0]);
    requireThat(typeof out !== "number" || Number.isFinite(out), "Nicht endliche JSON-Zahl");
    return out;
  };
  const out = value(); ws();
  requireThat(pos === text.length, "Text nach dem JSON-Ende");
  return out;
}

// SHA-256 bleibt synchron, damit Feld-Eingaben und Kurs-Prüfungen denselben Ablauf nutzen.
// Byte-Framing entspricht exakt revision_for() im nativen cs_core.py.
export function revisionFor(sources) {
  const bytes = [];
  for (const path of Object.keys(sources).sort()) for (const part of [path, sources[path]]) {
    const encoded = new TextEncoder().encode(part);
    bytes.push(0, 0, 0, 0, (encoded.length >>> 24) & 255, (encoded.length >>> 16) & 255, (encoded.length >>> 8) & 255, encoded.length & 255);
    for (const b of encoded) bytes.push(b);
  }
  const bitLength = bytes.length * 8;
  bytes.push(128);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 4294967296);
  for (const word of [high, bitLength >>> 0]) for (let shift = 24; shift >= 0; shift -= 8) bytes.push((word >>> shift) & 255);
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const rotate = (n, r) => (n >>> r) | (n << (32 - r));
  for (let start = 0; start < bytes.length; start += 64) {
    const w = new Int32Array(64);
    for (let i = 0; i < 16; i++) { const j = start + i * 4; w[i] = bytes[j] << 24 | bytes[j+1] << 16 | bytes[j+2] << 8 | bytes[j+3]; }
    for (let i = 16; i < 64; i++) {
      const x = w[i-15], y = w[i-2];
      w[i] = w[i-16] + (rotate(x,7) ^ rotate(x,18) ^ (x >>> 3)) + w[i-7] + (rotate(y,17) ^ rotate(y,19) ^ (y >>> 10));
    }
    let [a,b,c,d,e,f,g,z] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (z + (rotate(e,6) ^ rotate(e,11) ^ rotate(e,25)) + ((e & f) ^ (~e & g)) + k[i] + w[i]) | 0;
      const t2 = ((rotate(a,2) ^ rotate(a,13) ^ rotate(a,22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      [a,b,c,d,e,f,g,z] = [(t1+t2)|0,a,b,c,(d+t1)|0,e,f,g];
    }
    [a,b,c,d,e,f,g,z].forEach((v,i) => { h[i] = (h[i] + v) | 0; });
  }
  return "sha256:" + h.map((n) => (n >>> 0).toString(16).padStart(8,"0")).join("");
}

export function collectEvidence(cs, atlas, target = cs.codeTargetPath()) {
  const sources = Object.create(null);
  const owners = Object.create(null);
  const nativeModels = new Map();
  const rejectedSources = new Set();
  const analysisCoverage = [];
  for (const [path, model] of Object.entries(cs.net.code)) {
    if (!cs.net.isInside(path, target) || model.error) continue;
    sources[abs(path)] = cs.net.lines(path).join("\n");
    owners[abs(path)] = abs(cs.net.datComp.get(path) || cs.net.compOf(path));
    const native = model.state_atlas;
    if (native && native.revision === revisionFor({ [abs(path)]: sources[abs(path)] }) && Array.isArray(native.states) && !(native.errors?.length)) {
      nativeModels.set(abs(path), native);
      analysisCoverage.push(...(native.coverage || []));
    } else {
      if (native) {
        rejectedSources.add(abs(path));
        analysisCoverage.push(`${abs(path)}: Native StateAtlas-Fakten passen nicht zur Quelle oder enthalten Analysefehler; keine statischen Zugriffsfakten dieser Quelle übernommen.`);
      } else analysisCoverage.push(`${abs(path)}: Keine nativen StateAtlas-Fakten vorhanden; begrenzter CodeModel-Fallback.`);
    }
  }
  const states = atlas.filter((s) => s.kind !== "coverage").map((s) => {
    const row = { ...clone(s), value: { type: Array.isArray(s.value) ? "list" : s.value === null ? "NoneType" : typeof s.value, value: clone(s.value) }, writers: [], readers: [] };
    for (const [source, owner] of Object.entries(owners)) {
      if (rejectedSources.has(source)) continue;
      const native = nativeModels.get(source);
      if (native) {
        // Der native Analyzer löst auch Child-Storage und verschachtelte Mutationen auf.
        // Deshalb zuerst nach der exakten State-ID suchen, nicht nach dem DAT-Parent filtern.
        const state = native.states.find((item) => item.id === s.id);
        if (state) {
          row.readers.push(...clone(state.readers)); row.writers.push(...clone(state.writers));
          row.coverage = [...(row.coverage || []), ...(state.coverage || [])];
        }
        continue;
      }
      if (owner !== s.owner) continue;
      const model = cs.net.code[rel(source)];
      for (const site of model.accesses || []) {
        const matches = s.kind === "attribute" && `${site.cls}.${site.name}` === s.name
          || s.kind === "parameter" && ["eval" + s.name, "par" + s.name].includes(site.name);
        if (!matches) continue;
        const group = site.how === "read" ? "readers" : "writers";
        row[group].push({ method: `${source}:${site.cls ? site.cls + "." : ""}${site.func}`, source, line: site.line, confidence: "static", kind: site.how });
      }
    }
    return row;
  });
  const symbol = (ref) => `${abs(ref.dat)}:${cs.net.extClass(ref.dat)?.cls.name ? cs.net.extClass(ref.dat).cls.name + "." : ""}${ref.name}`;
  const calls = [...nativeModels.values()].flatMap((model) => clone(model.calls || []));
  calls.push(...cs.net.calls.filter((c) => Object.hasOwn(sources, abs(c.from.dat)) && !nativeModels.has(abs(c.from.dat)) && !rejectedSources.has(abs(c.from.dat))).map((c) => ({ caller: symbol(c.from), callee: symbol(c.to), source: abs(c.from.dat), line: c.line, confidence: "static" })));
  const symbols = Object.assign(Object.create(null), ...[...nativeModels.values()].map((model) => clone(model.symbols || {})));
  const events = cs.state.record.records.filter((r) => Object.hasOwn(sources, abs(r.dat))).slice(-300).map((r) => ({ symbol: r.symbol || symbol(r), source: abs(r.dat), method: r.name, line: r.line, frame: r.frame, origin: "pocket-simulation", recording_id: r.recording_id || "", recorded_source_hash: r.recorded_source_hash || "", source_relation: r.recorded_source_hash === revisionFor({ [abs(r.dat)]: sources[abs(r.dat)] }) ? "simulated_source_unchanged" : "unknown" }));
  return { schema: "codesearch.evidence.v1", id: uid("ev"), revision: revisionFor(sources), scope: abs(target),
    captured: { utc: new Date().toISOString(), start_frame: cs.lab.frame, end_frame: cs.lab.frame, generation: cs.lab.stateLab.generation, origin: "pocket-simulation" },
    sources, owners, states, calls, symbols, events, recording: clone(cs.state.record.provenance || {}), outputs: [], coverage: ["Pocket: eingebetteter Quellstand und bekannte JavaScript-Lab-Werte; keine Verbindung zu TouchDesigner.",
      `${nativeModels.size}/${Object.keys(sources).length} Quellen nutzen per SHA256 geprüfte Fakten des nativen StateAtlas-Analyzers. Das bleibt statische Analyse; dynamische Zugriffe und Alias-Wirkungen können fehlen.`,
      "Beim CodeModel-Fallback können zusätzlich verschachtelte Mutationen (z. B. self._dependent.val[0]), Par-Attribute und Storage-Zugriffe fehlen. Ein Read-Fund ohne erfassten Write widerlegt keine Write-Aussage.",
      "RECORD enthält nur tatsächlich erfasste Aufrufe der Pocket-Simulation; keine TD-Runtime-Beobachtung.", ...new Set(analysisCoverage)] };
}

function protocolVersion(input, name, names, optional = []) {
  const v2 = input?.schema === `codesearch.${name}.v2`;
  fields(input, [...names, ...optional, ...(v2 ? ["evidence_id"] : [])], [...names, ...(v2 ? ["evidence_id"] : [])]);
  requireThat(input.schema === `codesearch.${name}.${v2 ? "v2" : "v1"}`, `Unbekanntes ${name}-Schema`);
  string(input.revision, "revision", 10000, true);
  if (v2) string(input.evidence_id, "evidence_id");
  return v2;
}
export function packetBinding(packet, input, v2 = input?.schema?.endsWith(".v2")) {
  if (input.revision !== packet.revision || packet.revision !== revisionFor(packet.sources) || (v2 && input.evidence_id !== packet.id)) return "stale";
  return v2 ? "bound" : "legacy_unbound";
}

export function answerRequest(packet, request) {
  const v2 = protocolVersion(request, "request", ["schema", "id", "revision", "questions"]);
  string(request.id, "id", 200);
  requireThat(Array.isArray(request.questions) && request.questions.length >= 1 && request.questions.length <= 40, "1–40 questions erforderlich");
  const allowed = { overview: [], state: ["state_id"], readers: ["state_id"], writers: ["state_id"], calls: ["symbol"], source: ["source"], ...(v2 ? {symbol: ["symbol"], source_range: ["source", "start_line", "end_line"], events: [], coverage: [], states: [], symbols: []} : {}) };
  const optional = v2 ? {calls: ["direction", "offset", "limit"], events: ["symbol", "offset", "limit"], coverage: ["offset", "limit"], states: ["offset", "limit"], symbols: ["offset", "limit"]} : {};
  for (const q of request.questions) {
    requireThat(object(q) && Object.hasOwn(allowed, q.kind), "Unbekannte question-Art");
    fields(q, ["kind", ...allowed[q.kind], ...(optional[q.kind] || [])], ["kind", ...allowed[q.kind]]);
    for (const key of ["symbol", "source", "state_id"]) if (key in q) string(q[key], key);
    for (const key of ["offset", "limit", "start_line", "end_line"]) if (key in q) requireThat(Number.isSafeInteger(q[key]) && q[key] >= (key === "offset" ? 0 : 1), `${key}: gültiger Integer erforderlich`);
    requireThat((q.limit ?? 20) <= 80 && ["in", "out", "both"].includes(q.direction ?? "both"), "Ungültiges Listenlimit oder Richtung");
    if (q.kind === "source_range") requireThat(q.end_line >= q.start_line && q.end_line - q.start_line < 120, "source_range: 1–120 Zeilen erforderlich");
  }
  const binding = packetBinding(packet, request, v2);
  const out = { schema: `codesearch.response.${v2 ? "v2" : "v1"}`, id: request.id, revision: packet.revision, requested_revision: request.revision, binding, status: binding === "stale" ? "stale" : "ok", answers: [], evidence_id: packet.id, captured: clone(packet.captured), coverage: packet.coverage.slice() };
  if (out.status === "stale") return out;
  for (const q of request.questions) {
    const a = { question: clone(q), kind: q.kind, status: "supported" };
    if (q.kind === "overview") a.value = { scope: packet.scope, sources: Object.keys(packet.sources), state_count: packet.states.length, call_count: packet.calls.length, event_count: packet.events.length, captured: packet.captured };
    else if (["state", "writers", "readers"].includes(q.kind)) {
      const state = packet.states.find((s) => s.id === q.state_id);
      if (state) a.value = q.kind === "state" ? clone(state) : clone(state[q.kind]);
    } else if (q.kind === "symbol") { if (Object.hasOwn(packet.symbols || {}, q.symbol)) a.value = clone(packet.symbols[q.symbol]); }
    else if (["calls", "events", "coverage", "states", "symbols"].includes(q.kind)) {
      let found = packet[q.kind] || [];
      if (q.kind === 'states') found = packet.states.map((state) => Object.fromEntries(['id', 'name', 'kind', 'owner'].filter((key) => key in state).map((key) => [key, state[key]])));
      if (q.kind === 'symbols') found = Object.entries(packet.symbols || {}).map(([symbol, value]) => ({symbol, ...Object.fromEntries(['name', 'source', 'line', 'end_line', 'kind'].filter((key) => key in value).map((key) => [key, value[key]]))}));
      if (q.kind === "calls") found = found.filter((c) => ((q.direction ?? "both") !== "in" && c.caller === q.symbol) || ((q.direction ?? "both") !== "out" && c.callee === q.symbol));
      if (q.kind === "events" && q.symbol) found = found.filter((e) => (e.qualified_symbol || e.symbol || `${e.source}:${e.method}`) === q.symbol);
      const offset = q.offset ?? 0, limit = q.limit ?? 20;
      a.value = clone(v2 ? found.slice(offset, offset + limit) : found);
      if (v2) {
        const end = Math.min(offset + limit, found.length);
        a.coverage = { total: found.length, offset, returned: a.value.length, truncated: end < found.length };
        if (a.coverage.truncated) a.next_request = {...clone(request), questions: [{...q, offset: end, limit}]};
      }
    } else if (Object.hasOwn(packet.sources, q.source)) {
      if (q.kind === "source_range") {
        const lines = packet.sources[q.source].split("\n"), end = Math.min(q.end_line, lines.length);
        if (q.start_line <= lines.length) a.value = {source: q.source, start_line: q.start_line, end_line: end, text: lines.slice(q.start_line - 1, end).join("\n"), total_lines: lines.length};
      } else a.value = { source: q.source, text: packet.sources[q.source] };
    }
    if (!("value" in a) || (["calls", "events"].includes(q.kind) && !a.value.length)) { a.status = "unknown"; a.reason = "Nicht im begrenzten Paket gefunden; Abwesenheit ist kein Gegenbeweis"; }
    a.text = `${a.status} · ${a.reason || JSON.stringify(a.value)}${a.coverage?.truncated ? " · gekürzt; next_request nachreichen" : ""}`;
    out.answers.push(a);
  }
  return out;
}

export function checkExplanation(packet, explanation) {
  const v2 = protocolVersion(explanation, "explanation", ["schema", "revision", "claims"]);
  requireThat(Array.isArray(explanation.claims) && explanation.claims.length >= 1 && explanation.claims.length <= 80, "1–80 claims erforderlich");
  const ids = new Set(), binding = packetBinding(packet, explanation, v2);
  const required = { writes: ["state_id", "symbol"], reads: ["state_id", "symbol"], called: ["symbol"], source: ["source", "line", "text"] };
  const claims = explanation.claims.map((c) => {
    fields(c, ["id", "text", "kind", "state_id", "symbol", "source", "line", ...(v2 ? ["commentary"] : [])], v2 ? ["id", "kind"] : ["id", "text", "kind"]);
    requireThat(Object.hasOwn(required, c.kind), "Unbekannte Claim-Art");
    for (const [key, val] of Object.entries(c)) if (key !== "line") string(val, key, 10000, key !== "id");
    requireThat(!ids.has(c.id), "Claim-IDs müssen eindeutig sein"); ids.add(c.id);
    requireThat(required[c.kind].every((key) => Object.hasOwn(c, key)), `Claim benötigt ${required[c.kind].join(", ")}`);
    if (Object.hasOwn(c, "line")) requireThat(Number.isSafeInteger(c.line) && c.line > 0, "line muss positiver Integer sein");
    const statements = { writes: `Statische Analyse: ${c.symbol} ist als Writer von ${c.state_id} erfasst.`, reads: `Statische Analyse: ${c.symbol} ist als Reader von ${c.state_id} erfasst.`, called: `Pocket-Simulation: ${c.symbol} wurde in der Aufnahme als Call erfasst.`, source: `Exaktes Quellzitat: ${c.source}:${c.line} stimmt mit dem angegebenen Text überein.` };
    const row = { ...clone(c), text: c.text || "", checked_statement: "Prüfaussage: " + statements[c.kind], commentary: c.commentary ?? (c.kind === "source" ? "" : c.text || ""), commentary_checked: false, binding, evidence_kind: c.kind === "called" ? "simulated_event" : c.kind === "source" ? "source_quote" : "static_access", source_relation: c.kind === "called" ? "unknown" : "not_applicable", limits: ["Freier Kommentar wird nicht semantisch geprüft."], status: "unknown", evidence: [], reason: "Nicht durch das begrenzte Paket belegt" };
    if (c.kind === "called") row.limits.push("Pocket-RECORD ist ein JavaScript-Modell; kein Nachweis einer ausgeführten TD-/Python-Funktion.");
    if (binding === "stale") { row.status = "stale"; row.reason = "Anderes Belegpaket oder andere Quellenrevision"; return row; }
    if (c.kind === "source") {
      const actual = packet.sources[c.source]?.split("\n")[c.line - 1];
      if (actual !== undefined) { row.status = (v2 ? actual === c.text : actual.trim() === c.text.trim()) ? "supported" : "contradicted"; row.evidence = [{ source: c.source, line: c.line, text: actual }]; row.reason = "Exakter Quellzeilenvergleich; keine Freitextprüfung"; }
    } else if (c.kind === "called") {
      row.evidence = clone(packet.events.filter((e) => (e.qualified_symbol || e.symbol) === c.symbol && (c.source === undefined || c.source === e.source) && (c.line === undefined || c.line === e.line)));
      if (row.evidence.length) { row.status = "supported"; row.reason = "Aufruf in Pocket-RECORD simuliert; kein TD-Nachweis"; const relations = new Set(row.evidence.map((e) => e.source_relation || "unknown")); row.source_relation = relations.size === 1 ? [...relations][0] : "unknown"; }
    } else {
      const state = packet.states.find((s) => s.id === c.state_id);
      const matches = (e) => e.method === c.symbol && (c.source === undefined || c.source === e.source) && (c.line === undefined || c.line === e.line);
      row.evidence = clone((state?.[c.kind === "writes" ? "writers" : "readers"] || []).filter(matches));
      if (row.evidence.length) {
        row.status = "supported";
        const notes = [...new Set(row.evidence.map((e) => e.note).filter(Boolean))];
        row.reason = `Statischer Zugriff ${row.evidence.some((e) => e.confidence === "inferred") ? "teilweise aus Konventionen abgeleitet" : "belegt"}; keine beobachtete Ausführung${notes.length ? '; ' + notes.join('; ') : ''}`;
      }
      else if (c.kind === "writes" && c.source !== undefined && c.line !== undefined) {
        row.evidence = clone((state?.readers || []).filter(matches));
        if (row.evidence.length) row.reason = "Nur ein Read ist im begrenzten Modell erfasst; Mutationen und Aliase können fehlen. Die Write-Aussage bleibt unknown.";
      }
    }
    return row;
  });
  return { id: uid("exp"), revision: packet.revision, evidence_id: packet.id, binding, status: binding === "stale" ? "stale" : "ok", claims };
}

export function previewChange(packet, proposal) {
  const v2 = protocolVersion(proposal, "preview", ["schema", "revision", "changes"], ["rules"]);
  const binding = packetBinding(packet, proposal, v2);
  string(proposal.revision, "revision", 10000, true);
  requireThat(object(proposal.changes) && Object.keys(proposal.changes).length > 0 && Object.keys(proposal.changes).length <= 100, "changes benötigt 1–100 bekannte Quellen");
  let size = 0;
  for (const [source, code] of Object.entries(proposal.changes)) {
    requireThat(Object.hasOwn(packet.sources, source), `Quelle nicht im Paket: ${source}`);
    string(code, "Quelltext", 1000000, true); size += code.length;
  }
  requireThat(size <= 3000000, "Quelltexte zusammen zu groß");
  const rules = proposal.rules || {};
  fields(rules, ["forbid_new_writers", "allowed_writers", "preserve_symbols"], []);
  if (Object.hasOwn(rules, "forbid_new_writers")) requireThat(typeof rules.forbid_new_writers === "boolean", "forbid_new_writers muss Boolean sein");
  if (Object.hasOwn(rules, "allowed_writers")) {
    requireThat(object(rules.allowed_writers), "allowed_writers muss Objekt sein");
    for (const [key, list] of Object.entries(rules.allowed_writers)) { string(key, "State-ID"); requireThat(Array.isArray(list), "Writer-Liste erwartet"); list.forEach((v) => string(v, "Symbol")); }
  }
  if (Object.hasOwn(rules, "preserve_symbols")) { requireThat(Array.isArray(rules.preserve_symbols), "preserve_symbols muss Array sein"); rules.preserve_symbols.forEach((v) => string(v, "Symbol")); }
  const out = { id: uid("prev"), evidence_id: packet.id, revision: packet.revision, binding, diffs: [], status: "limited", items: [], violations: [], sourceUnchanged: true, runtimeVerified: false, coverage: "Pocket prüft ausschließlich am unveränderten Quelltext angehängte einfache Methoden mit self.<Attribut> =/<+= Zahl. Beliebige Python-Änderungen und vollständige Regelprüfung brauchen >vorschau in TD." };
  if (binding === "stale") { out.status = "stale"; out.items.push({ name: "REVISION", text: "Andere Quellenrevision; keine aktuelle Vorschau", status: "stale" }); return out; }
  for (const [source, code] of Object.entries(proposal.changes)) {
    const original = packet.sources[source];
    if (code === original) { out.items.push({ name: source, text: "Quelltext identisch; keine Änderung", status: "unchanged" }); continue; }
    const oldLines = original.split("\n"), newLines = code.split("\n");
    let start = 0, oldEnd = oldLines.length, newEnd = newLines.length;
    while (start < oldEnd && start < newEnd && oldLines[start] === newLines[start]) start += 1;
    while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) { oldEnd -= 1; newEnd -= 1; }
    const diff = [`--- ${source} (vorher)`, `+++ ${source} (Vorschlag)`, `@@ -${start + 1},${oldEnd - start} +${start + 1},${newEnd - start} @@`, ...oldLines.slice(start, oldEnd).map((line) => "-" + line), ...newLines.slice(start, newEnd).map((line) => "+" + line)].join("\n");
    out.diffs.push({source, text: diff.slice(0, 40000), truncated: diff.length > 40000});
    const className = /^class\s+(\w+)/m.exec(original)?.[1];
    const tail = code.startsWith(original) ? code.slice(original.length) : "";
    const lines = tail.split("\n").filter((l) => l.trim());
    const method = /^    def (\w+)\(self\):$/.exec(lines[0] || "");
    const assignments = lines.slice(1).map((l) => /^        self\.(\w+)\s*(\+=|=)\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$/.exec(l));
    const uniqueMethod = method && !new RegExp(`^    def ${method[1]}\\(`,"m").test(original);
    if (!className || !uniqueMethod || assignments.length === 0 || assignments.some((a) => !a)) {
      out.status = "unknown"; out.items.push({ name: source, text: "Geänderter Quelltext vorhanden. Python-Syntax, Zugriffe und Regeln in Pocket nicht geprüft; native Vorschau in TD erforderlich.", status: "unknown" }); continue;
    }
    for (const a of assignments) {
      const methodName = `${source}:${className}.${method[1]}`;
      const stateId = `${packet.owners[source]}|attribute|${className}.${a[1]}`;
      const violation = rules.forbid_new_writers === true || (Object.hasOwn(rules.allowed_writers || {}, stateId) && !rules.allowed_writers[stateId].includes(methodName));
      out.items.push({ name: `self.${a[1]}`, text: `${method[1]} ${a[2] === "+=" ? "liest und schreibt" : "schreibt"} self.${a[1]} · neue Stelle in begrenzter Pocket-Vorschau${violation ? " · Regelverletzung" : ""}`, status: violation ? "violation" : "added", source, method: methodName, state_id: stateId });
      if (violation) out.violations.push({ state_id: stateId, method: methodName });
    }
  }
  return out;
}

export function makeSample(packet, kind) {
  const counter = packet.states.find((s) => s.name === "StateLabExt._count");
  if (kind === "anfrage") return { schema: "codesearch.request.v2", id: uid("req"), evidence_id: packet.id, revision: packet.revision, questions: [{ kind: "overview" }, ...(counter ? [{ kind: "writers", state_id: counter.id }] : [])] };
  if (kind === "antwort") {
    const site = counter?.writers.find((s) => s.method.endsWith(".Fire"));
    const source = Object.keys(packet.sources)[0];
    requireThat(site || source, "Ziel enthält keine Quelle für eine Beispielantwort");
    return { schema: "codesearch.explanation.v2", evidence_id: packet.id, revision: packet.revision, claims: [site ? { id: "c1", text: "Fire schreibt _count", kind: "writes", state_id: counter.id, symbol: site.method } : { id: "c1", kind: "source", source, line: 1, text: packet.sources[source].split("\n")[0] }, { id: "c2", text: "Ein nicht erfasster Call", kind: "called", symbol: "GhostCall" }] };
  }
  requireThat(kind === "vorschau", ">beispiel anfrage | antwort | vorschau");
  const garden = Object.keys(packet.sources).find((p) => p.endsWith('/SignalGarden/Scenes/SceneControllerExt'));
  const source = garden || Object.keys(packet.sources).find((p) => p.endsWith('/StateLabExt'));
  requireThat(source, 'Das Vorschaubeispiel benötigt StateLab oder SignalGarden/Scenes');
  const addition = garden ? '\n    def _candidateReset(self):\n        self._requests = 0\n' : '\n    def PreviewOnly(self):\n        self._count = 999\n';
  return { schema: 'codesearch.preview.v2', evidence_id: packet.id, revision: packet.revision,
    changes: { [source]: packet.sources[source] + addition }, rules: { forbid_new_writers: true } };
}
