// RECORD + WARUM, AUDIT, ERRORS, Funktionsuebersicht (?), StateLab-Untersuchung (State-Atlas und LLM-Werkzeuge).

import { abs, baseName, fmtNum, parentOf } from "../util.js";
import { memberCategory } from "../net.js";
import { hit, section, action, info, notice } from "./common.js";
import { entriesFor } from "./codeviews.js";

// ------------------------------------------------------------------------------------------ RECORD
export function chainsOf(records) {
  const chains = [];
  for (const r of records) {
    if (r.depth === 0 || !chains.length) chains.push([]);
    chains[chains.length - 1].push(r);
  }
  return chains;
}

export function buildRecord(cs) {
  const rec = cs.state.record;
  const rows = [];
  const chains = chainsOf(rec.records);
  const index = Math.min(Math.max(0, rec.chainIndex), Math.max(0, chains.length - 1));
  const chain = chains[index] || [];
  const status = rec.recording ? "LIVE" : (rec.liveHold ? "HOLD" : (rec.records.length ? "STOPPED" : "READY"));
  const head = hit("info", "", `${status}   ·   ${rec.records.length} Aufrufe   ·   Kette ${chains.length ? index + 1 : 0} / ${chains.length}`, { detail: "STATUS" });
  head.art = status;
  rows.push(head);
  rows.push(section("AUFRUFKETTE", "ENTRY = Einstieg (Auslöser außerhalb der Aufnahme) · Pfeil = beobachteter Python-Aufruf", chain.length, { num: "1" }));
  const first = chain[0] ? chain[0].t : 0;
  chain.forEach((r) => {
    const h = hit("record", abs(r.dat), `${"   ".repeat(r.depth)}${r.depth ? "→ " : ""}${r.name}()`, {
      line: r.line, ctx: r.name, detail: `+${(r.t - first).toFixed(2)} ms · Dauer ${r.dur.toFixed(2)} ms`,
    });
    h.art = r.depth === 0 ? "ENTRY" : "→";
    h.depth = r.depth;
    if (cs.cs.Recordstate) h.state_change = r.state || "";
    rows.push(h);
  });
  if (!chain.length) rows.push(notice(rec.recording ? "Aufnahme läuft – löse jetzt die Aktion aus (z. B. Fire)" : "noch keine Aufnahme: START, Aktion auslösen, STOP"));
  if (chains.length > 1) {
    rows.push(section("FRÜHERE KETTEN", "PREV / NEXT blättert", chains.length - 1, { num: "2" }));
    chains.forEach((c, i) => {
      if (i === index) return;
      const h = hit("record", abs(c[0].dat), `Kette ${i + 1}: ${c.map((r) => r.name).join(" → ")}`, { ctx: c[0].name, detail: `${c.length} Aufrufe` });
      h.art = "KETTE";
      h.chain_index = i;
      rows.push(h);
    });
  }
  return { rows, chain, chains, index };
}

export function chainText(chain) {
  return chain.map((r) => `${"  ".repeat(r.depth)}${r.name}  ${abs(r.dat)}:${r.line}  +${r.dur.toFixed(2)} ms`).join("\n");
}

// ------------------------------------------------------------------------------------------ WARUM
// Vergleicht die Landkarte (was rufen koennte) mit der Dashcam (was lief) fuer die letzte Kette.
export function whyCase(cs, chain, labState) {
  const net = cs.net;
  if (!chain || !chain.length) return null;
  const ran = new Set(chain.map((r) => `${r.dat}:${r.name}`));
  const steps = [];
  const causes = [];
  const alternatives = [];
  steps.push({ mark: "✓", art: "START", text: `${chain[0].name}()`, dat: chain[0].dat, name: chain[0].name, line: chain[0].line });
  const visit = (dat, name, seen) => {
    const key = `${dat}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const astInfo = ((net.code[dat] || {}).ast || {})[name] || {};
    const sites = ((net.code[dat] || {}).sites || []).filter((s) => s.func === name && s.type === "call");
    for (const c of net.calleesOf(dat, name)) {
      const cKey = `${c.to.dat}:${c.to.name}`;
      if (ran.has(cKey)) {
        steps.push({ mark: "✓", art: "LIEF", text: `${c.to.name}()`, dat: c.to.dat, name: c.to.name, line: c.line });
        visit(c.to.dat, c.to.name, seen);
        continue;
      }
      const guard = (astInfo.guards || []).find((g) => g.returns && g.line < c.line && guardTrue(g.test, labState));
      const site = sites.find((s) => s.line === c.line && s.attr === c.to.name);
      if (guard) {
        steps.push({ mark: "✗", art: "STOPP", text: `${c.to.name}()`, dat: c.to.dat, name: c.to.name, line: c.line, guard, caller: name, callerDat: dat });
        if (!causes.find((x) => x.guard.line === guard.line)) causes.push({ guard, caller: name, dat });
      } else if (site && site.branch_group) {
        const chosen = sites.find((s) => s.branch_group === site.branch_group && ran.has(`${dat}:${s.attr}`) || ran.has(`${net.calleesOf(dat, name).find((x) => x.line === s.line)?.to.dat}:${s.attr}`));
        const prior = sites.filter((s) => s.branch_group === site.branch_group && s.line < c.line && s.branch_kind !== "else");
        const need = prior.length ? prior[prior.length - 1].branch_test : site.branch_test;
        alternatives.push({ name: c.to.name, line: c.line, need, chosen: chosen ? chosen.attr : "", test: site.branch_test, kind: site.branch_kind });
        steps.push({ mark: "–", art: "ALTERNATIVE", text: `${c.to.name}()`, dat: c.to.dat, name: c.to.name, line: c.line });
      }
    }
  };
  visit(chain[0].dat, chain[0].name, new Set());
  return { steps, causes, alternatives, values: { ...labState }, when: cs.lab.frame, chainNames: chain.map((r) => r.name) };
}

function guardTrue(test, values) {
  const m = /^not\s+self\.eval(\w+)$/.exec(test.trim());
  if (m) return !values[m[1]];
  const n = /^self\.eval(\w+)\s*==\s*'([^']*)'$/.exec(test.trim());
  if (n) return values[n[1]] === n[2];
  if (test.trim() === "color is None") return values.colorNone === true;
  return false;
}

export function guardNow(test, values) {
  const m = /self\.eval(\w+)/.exec(test);
  if (!m) return test;
  const v = values[m[1]];
  return `self.eval${m[1]} = ${typeof v === "boolean" ? (v ? "True" : "False") : `'${v}'`}`;
}

export function buildWhy(cs) {
  const why = cs.state.why;
  const rows = [];
  const current = why.cases[why.index];
  if (!current) {
    rows.push(notice("WARUM braucht eine Aufnahme: RECORD → START → Fire → STOP, dann WARUM ▸"));
    return { rows };
  }
  const stop = current.causes[0];
  if (stop) {
    const sentence = `Du hast ${current.chainNames[0]} ausgelöst → ${current.chainNames.slice(1).join(" → ") || "nichts weiter"} lief → in Zeile ${stop.guard.line} war ${stop.guard.test} wahr (${guardNow(stop.guard.test, current.values)}) → return: ${current.steps.filter((s) => s.art === "STOPP").map((s) => s.text).join(", ")} liefen nicht.`;
    const h = hit("why", abs(stop.dat), `✗ STOPP   ${stop.caller}() kehrt in Zeile ${stop.guard.line} zurück: ${stop.guard.test}`, { line: stop.guard.line, ctx: stop.caller, detail: "STOPP" });
    h.text_full = sentence;
    h.art = "STOPP";
    rows.push(h);
  } else {
    const h = hit("why", abs(current.steps[0].dat), `✓ alles lief: ${current.chainNames.join(" → ")}`, { ctx: current.steps[0].name, detail: "LIEF" });
    h.art = "✓ LIEF";
    rows.push(h);
  }
  rows.push(section("ERWARTET → PASSIERT", "Landkarte gegen Dashcam: ✓ lief · ✗ blieb aus", current.steps.length, { num: "1" }));
  current.steps.forEach((s) => {
    const h = hit("whystep", abs(s.dat), `${s.mark} ${s.art} ${s.text}`, { line: s.line, ctx: s.name, detail: s.art });
    h.art = s.art === "LIEF" || s.art === "START" ? `✓ ${s.art}` : (s.art === "STOPP" ? "✗ STOPP" : "ALTERNATIVE");
    if (s.guard) { h.guard_line = s.guard.line; h.guard_test = s.guard.test; }
    rows.push(h);
  });
  const alts = current.alternatives;
  rows.push(section("ALTERNATIVEN", "normale Zweige, die diesmal nicht dran waren", alts.length, { num: "2" }));
  alts.forEach((a) => {
    const chosen = a.chosen ? ` · gewählt: ${a.chosen}()` : (stop ? ` · vorher Guard Zeile ${stop.guard.line}` : "");
    const h = hit("whystep", "", `${a.name}()   braucht \`${a.need}\` = falsch, jetzt ${a.chosen ? "wahr" : "unerreicht"}${chosen}`, { line: a.line, ctx: a.name, detail: "ALTERNATIVE" });
    h.art = "ALTERNATIVE";
    rows.push(h);
  });
  if (why.compare) {
    const { before, after } = why.compare;
    rows.push(section("VORHER → NACHHER", "derselbe Klick vor und nach dem Hebel", null, { num: "3" }));
    const names = [...new Set([...before.steps, ...after.steps].map((s) => s.text))];
    names.forEach((n) => {
      const b = before.steps.find((s) => s.text === n);
      const a = after.steps.find((s) => s.text === n);
      const h = hit("whystep", "", `${n}   VORHER ${b ? `${b.mark} ${b.art}` : "—"}   →   NACHHER ${a ? `${a.mark} ${a.art}` : "—"}`, { ctx: n, detail: "VORHER → NACHHER" });
      h.art = "VORHER";
      rows.push(h);
    });
  }
  const earlier = why.cases.map((c, i) => ({ c, i })).filter((x) => x.i !== why.index);
  rows.push(section("FRÜHERE KLICKS", "Enter holt einen alten Fall zurück", earlier.length, { num: "4" }));
  earlier.forEach(({ c, i }) => {
    const h = hit("whyhistory", "", `Klick ${i + 1}: ${c.causes[0] ? `✗ STOPP Zeile ${c.causes[0].guard.line}` : "✓ lief"}   ·   ${c.chainNames.join(" → ")}`, { ctx: String(i), detail: "FRÜHER" });
    h.art = "FRÜHER";
    h.case_index = i;
    rows.push(h);
  });
  return { rows, current };
}

export function whyPacket(cs) {
  const current = cs.state.why.cases[cs.state.why.index];
  if (!current) return "# CodeSearch WARUM\n(kein Fall)";
  const lines = ["# CodeSearch WARUM", "", `Kette: ${current.chainNames.join(" → ")}`];
  current.steps.forEach((s) => lines.push(`- ${s.mark} ${s.art} ${s.text}${s.guard ? ` (Guard Zeile ${s.guard.line}: ${s.guard.test}; jetzt ${guardNow(s.guard.test, current.values)})` : ""}`));
  current.alternatives.forEach((a) => lines.push(`- ALTERNATIVE ${a.name}(): braucht ${a.need} = falsch`));
  lines.push("", "Frage: Warum lief der erwartete Zweig nicht, und welcher Hebel ändert das?");
  return lines.join("\n");
}

// ------------------------------------------------------------------------------------------ AUDIT
export function auditFindings(cs, comp) {
  const net = cs.net;
  const ext = net.extClass(comp);
  const out = [];
  if (!ext) return out;
  const dat = ext.dat;
  const lines = net.lines(dat);
  const states = net.states(dat).filter((s) => s.name !== "ownerComp");
  for (const s of states) {
    const acc = net.accesses(dat, s.name);
    const writers = [...new Set(acc.filter((a) => (a.how === "write" || a.how === "mutate") && a.func !== "__init__").map((a) => a.func))];
    const readers = acc.filter((a) => a.how === "read");
    if (writers.length >= 2) out.push({ art: "WARNUNG", sec: "code", dat, line: s.line, text: `mehrere Schreiber: self.${s.name}: ${writers.length} Schreiber außerhalb __init__ (${writers.join(", ")})` });
    if (!readers.length && writers.length) out.push({ art: "WARNUNG", sec: "code", dat, line: s.line, text: `State ohne Leser: self.${s.name} wird nie gelesen` });
  }
  lines.forEach((line, i) => {
    if (/self\.ownerComp\.par\./.test(line)) out.push({ art: "WARNUNG", sec: "code", dat, line: i + 1, text: `ownerComp.par statt Helper: ${line.trim()}` });
    if (/op\(\s*['"]\//.test(line)) out.push({ art: "WARNUNG", sec: "code", dat, line: i + 1, text: `absoluter Pfad: ${line.trim()}` });
  });
  // Hot Path: Methoden, die ein Frame-Einstieg erreicht
  const hotEntries = entriesFor(cs, comp, "selection").filter((e) => e.hot);
  for (const e of hotEntries) {
    for (const c of net.calleesOf(e.dat, e.method)) {
      const member = net.member(c.to.dat, c.to.name);
      out.push({ art: "HOT", sec: "hot", dat: c.to.dat, line: member ? member.line : null, text: `${c.to.name}() · läuft pro Frame (${baseName(e.dat)} → ${e.method})`, name: c.to.name });
      if (member) {
        for (let n = member.line; n <= (member.end || member.line); n += 1) {
          const l = net.lines(c.to.dat)[n - 1] || "";
          if (/\bdebug\(/.test(l)) out.push({ art: "WARNUNG", sec: "code", dat: c.to.dat, line: n, text: `Hot-Path-Flag: debug() in ${c.to.name} (Z.${n}) – läuft pro Frame` });
          if (/\bop\(/.test(l)) out.push({ art: "WARNUNG", sec: "code", dat: c.to.dat, line: n, text: `Hot-Path-Flag: op(…) in ${c.to.name} (Z.${n}) – Suche pro Frame` });
        }
      }
    }
  }
  // Vertraege: public ohne Aufrufer von aussen, privat von aussen gerufen, inaktive Ausloeser
  for (const m of ext.cls.members) {
    const cat = memberCategory(m);
    const callers = net.callersOf(dat, m.name);
    const outside = callers.filter((c) => {
      const from = net.datComp.get(c.from.dat) ?? parentOf(c.from.dat);
      return from !== comp && !(from && from.startsWith(comp + "/"));
    });
    if ((cat === "public" || cat === "property") && !outside.length) {
      out.push({ art: "LINT", sec: "api", dat, line: m.line, text: `${m.name}${m.property ? "" : "()"} ist public, hat aber keinen externen Aufrufer – eigentlich privat?` });
    }
    if (cat === "intern") {
      const foreign = callers.filter((c) => c.from.dat !== dat);
      foreign.forEach((c) => out.push({ art: "LINT", sec: "api", dat: c.from.dat, line: c.line, text: `${m.name}() ist privat, wird aber von ${baseName(c.from.dat)}.${c.from.name} gerufen` }));
    }
  }
  for (const e of entriesFor(cs, comp, "selection")) {
    if (e.state === "AUS") out.push({ art: "HINWEIS", sec: "api", dat: e.source, line: e.line || null, text: `AUSLÖSER INAKTIV: ${e.method} · ${e.when}` });
  }
  return out;
}

export function buildAudit(cs, target) {
  const comp = cs.net.datComp.get(target) ?? cs.net.compOf(target);
  const findings = auditFindings(cs, comp);
  const rows = [];
  rows.push(action("NEU", "Analyse neu aufbauen und alle Prüfungen erneut ausführen", "RECHECK", comp));
  rows.push(action("FRAGE", "FÜR AGENT · diese Zeile: Reverse-Spec + Ursache als Frage-Paket (Alt+F)", "QUESTION", comp));
  rows.push(action("ERRORS", "Live-Fehler   →   Tab ERRORS · was JETZT kaputt ist", "GOERRORS", comp));
  const mk = (f, kind) => {
    const h = hit(kind, abs(f.dat), f.text, { line: f.line, detail: f.art, ctx: f.name || "" });
    h.art = f.art;
    return h;
  };
  rows.push(section("BLOCKIERT / KAPUTT", "tote Verbindungen (Bind/Export ohne Quelle) – Live-Fehler: Tab ERRORS", 0, { num: "1", accent: "red" }));
  rows.push(info("INFO", comp, "OK   ·   keine toten Binds/Exports – Live-Fehler: Tab ERRORS", "OK"));
  const code = findings.filter((f) => f.sec === "code");
  rows.push(section("CODE-BEFUNDE", "State, Reihenfolge, breite Fehlerbehandlung und Muster im Hot Path", code.length, { num: "2", accent: "yellow" }));
  code.forEach((f) => rows.push(mk(f, "lint")));
  const api = findings.filter((f) => f.sec === "api");
  rows.push(section("VERTRÄGE / AUSLÖSER", "Public API, private Aufrufe und inaktive Execute-DATs", api.length, { num: "3", accent: "cyan" }));
  api.forEach((f) => rows.push(mk(f, "lint")));
  const hot = findings.filter((f) => f.sec === "hot");
  rows.push(section("HOT PATH", "läuft pro Frame; Flags zeigen teure Muster", hot.length, { num: "4", accent: "red" }));
  hot.forEach((f) => rows.push(mk(f, "hot")));
  const feed = cs.state.changeFeed.filter((c) => c.comp === comp);
  rows.push(section("ÄNDERUNGS-FEED", "Δ seit dem letzten Snapshot", feed.length, { num: "5" }));
  feed.forEach((c) => {
    const h = hit("lint", abs(comp), c.text, { detail: "Δ" });
    h.art = "Δ";
    rows.push(h);
  });
  return { rows, findings };
}

export function auditQuestion(cs, row, comp) {
  return [
    "# CodeSearch Frage-Paket",
    `Ziel: ${abs(comp)}`,
    row ? `Befund: [${row.art}] ${row.text}` : "Befund: (keine Zeile markiert)",
    row && row.line ? `Ort: ${row.path}:${row.line}` : "",
    "",
    "Bitte: Reverse-Spec dieser Stelle (was rein, was raus) und die wahrscheinlichste Ursache. Nur lesen, nichts ändern.",
  ].filter((l) => l !== "").join("\n");
}

// ------------------------------------------------------------------------------------------ ERRORS
export function buildErrors(cs) {
  const lab = cs.lab;
  const rows = [];
  if (lab.errorActive) {
    rows.push(section("FEHLER", "Cook- und Python-Fehler im Bereich, jetzt", 1, { num: "1", accent: "red" }));
    const h = hit("error", abs("BranchLab/error_probe"), "Expression-Fehler   ·   Par opacity   ·   op('absichtlich_fehlend')['gain']: 'NoneType' object is not subscriptable", { par: "opacity", detail: "EXPR", ctx: "opacity" });
    h.art = "FEHLER";
    h.hitkind = "FEHLER";
    rows.push(h);
  } else {
    rows.push(section("FEHLER", "Cook- und Python-Fehler im Bereich, jetzt", 0, { num: "1" }));
    rows.push(info("OK", cs.scopeRoot(), "0 Errors · 0 Warnings im Bereich", "OK"));
  }
  return { rows };
}

export function errorReport(cs, row) {
  return [
    "## CodeSearch Fehlerbericht",
    `- Op: ${row ? row.path : abs("BranchLab/error_probe")}`,
    "- Art: Expression-Fehler in Par opacity",
    "- Ausdruck: op('absichtlich_fehlend')['gain']",
    "- Meldung: 'NoneType' object is not subscriptable",
    "- Ursache: op('absichtlich_fehlend') findet keinen Op und liefert None",
  ].join("\n");
}

// ------------------------------------------------------------------------------------------ ? Funktionsuebersicht
export function buildGuide(cs) {
  const ui = cs.ui;
  const rows = [];
  const tabs = Object.entries(ui.TAB_LABELS || {}).filter(([k]) => k !== "path");
  rows.push(section("TABS", "Enter oder Doppelklick öffnet den Tab", tabs.length, { num: "1" }));
  tabs.forEach(([mode, label]) => {
    const h = hit("guide", "", `${label}   ·   ${(ui.MODE_SEES || {})[mode] || ""}`, { detail: (ui.MODE_KEYS || {})[mode] || "", ctx: mode });
    h.art = "TAB";
    h.guide_mode = mode;
    rows.push(h);
  });
  const keys = [
    ["Strg+P", "Schnellsuche im zweiten Fenster"], ["Strg+I", "IMPACT der markierten Methode / des States"],
    ["Strg+Umschalt+I", "ROUTE: wer ruft das, bis zum Auslöser"], ["Strg+Enter", "neuer SELECTED / CALL PATH ab hier"],
    ["Strg+C", "Zeile kopieren (Menü)"], ["Alt+P", "voller Pfad"], ["Alt+F", "Frage-Paket"], ["Strg+R", "Reverse-Spec"],
    ["F6", "DATEN-Format weiterschalten"], ["Alt+D", "DETAILS an/aus"], ["Alt+← / Alt+→", "Definition zurück / vor"],
    ["Strg+Alt+← / →", "Verlauf"], ["Strg+→ / Strg+←", "nächster / voriger Tab"], ["Strg+Plus / Alt+0", "Zoom / 100 %"],
    ["Alt+Shift+A", "RECORD von überall starten/stoppen"], ["Esc", "zurück / Fenster schließen"],
  ];
  rows.push(section("TASTEN", "", keys.length, { num: "2" }));
  keys.forEach(([key, what]) => {
    const h = hit("guide", "", `${key}   ·   ${what}`, { detail: key });
    h.art = "TASTE";
    rows.push(h);
  });
  const commands = (ui.COMMANDS || []).filter((c) => Array.isArray(c));
  rows.push(section("BEFEHLE", "im Feld mit > tippen und Enter", commands.length, { num: "3" }));
  commands.forEach(([cmd, what]) => {
    const h = hit("guide", "", `>${cmd}   ·   ${what}`, { detail: `>${cmd}`, ctx: cmd });
    h.art = "BEFEHL";
    h.guide_command = cmd;
    rows.push(h);
  });
  return { rows };
}

// ------------------------------------------------------------------------------------------ StateLab-Untersuchung
export function stateAtlas(cs) {
  const s = cs.lab.stateLab;
  const obs = s.Observe();
  const owner = abs("StateLab");
  const row = (group, kind, name, value, extra = {}) => ({ id: `${owner}|${kind}|${name}`, group, kind, name, value, owner, ...extra });
  return [
    row("PYTHON-ATTRIBUTE", "attribute", "StateLabExt._count", obs.count, { lifetime: "Instanz · Reinit setzt auf 0", writers: ["Fire", "_reset_runtime"], readers: ["Count", "_publish"], note: "Eigentlicher Counter. Countdisplay zeigt ihn nur an." }),
    row("PYTHON-ATTRIBUTE", "attribute", "StateLabExt._shared", `[${s.shared.join(", ")}]`, { alias: obs.alias_shared ? "GLEICHES OBJEKT wie _alias" : "eigenes Objekt", writers: ["Mutate", "ReplaceSameValue"] }),
    row("PYTHON-ATTRIBUTE", "attribute", "StateLabExt._alias", `[${s.alias.join(", ")}]`, { alias: obs.alias_shared ? "GLEICHES OBJEKT wie _shared" : "eigenes Objekt", writers: ["_reset_runtime"] }),
    row("PYTHON-ATTRIBUTE", "attribute", "StateLabExt._dependent", `[${s.dependent.join(", ")}]`, { note: `Dependency · Leser sehen ${obs.dependency_display}`, writers: ["Mutate", "Notify"] }),
    row("PYTHON-ATTRIBUTE", "attribute", "StateLabExt._notifications", obs.notifications, { writers: ["Notify"] }),
    row("PYTHON-ATTRIBUTE", "attribute", "StateLabExt._last_fire_increment", obs.last_fire_increment, { writers: ["Fire"] }),
    row("PROPERTIES", "property", "StateLabExt.Count", obs.count, { readers: ["Count"], note: "Liest self._count. Speichert selbst nichts." }),
    row("STORAGE", "storage", "lesson_value", obs.storage_parent, { origin: obs.storage_origin, note: obs.storage_child != null ? "vom Child überschattet" : "" }),
    row("STORAGE", "storage", "state_child.lesson_value", obs.storage_child, { owner: `${owner}/state_child`, origin: obs.storage_child != null ? "child" : obs.storage_origin }),
    row("STORAGE", "storage", "lesson_session", obs.session_current, { lifetime: "Operator · Reinit behält, StorageReset löscht" }),
    row("PARAMETER", "parameter", "Countdisplay", obs.count, { mode: "CONSTANT", note: "Anzeige. Der Speicher ist _count." }),
    row("PARAMETER", "parameter", "Gain", obs.gain_effective, { mode: obs.gain_mode, constant: s.pars.Gain }),
    row("PARAMETER", "parameter", "Doublefire", obs.doublefire, { mode: "CONSTANT" }),
    row("GRENZEN", "coverage", "Aufnahme", "max. 80 Ops / 400 States · unbekannte Properties bleiben ungelesen", {}),
  ];
}

export function buildInvestigation(cs) {
  const view = cs.state.view;
  const inv = cs.state.inv;
  const rows = [];
  const add = (art, name, value, detail = "", path = abs("StateLab")) => {
    const h = hit("investigation", path, `${name}   ·   ${value}`, { detail, ctx: name });
    h.art = art;
    rows.push(h);
  };
  if (view === "states" || view === "untersuchung") {
    const atlas = stateAtlas(cs);
    let group = "";
    let n = 0;
    for (const a of atlas) {
      if (a.group !== group) {
        group = a.group;
        n += 1;
        rows.push(section(group, "", atlas.filter((x) => x.group === group).length, { num: String(n) }));
      }
      const h = hit("investigation", a.owner, `${a.name}   ·   ${typeof a.value === "string" ? a.value : JSON.stringify(a.value)}`, { detail: a.kind.toUpperCase(), ctx: a.name });
      h.art = a.kind.toUpperCase();
      h.atlas = a;
      rows.push(h);
    }
    if (view === "untersuchung") {
      rows.push(section("FÄLLE", "mit >fall <name> gespeichert", inv.cases.length, { num: String(n + 1) }));
      inv.cases.forEach((c) => add("FALL", c.label, `Count ${c.lab.count} · ${c.id}`));
    }
  } else if (view === "request") {
    rows.push(section("NACHFRAGE", "Antwort auf die Anfrage aus der Zwischenablage", inv.request ? inv.request.answers.length : 0, { num: "1" }));
    (inv.request ? inv.request.answers : []).forEach((a) => add("ANTWORT", a.kind, a.text));
  } else if (view === "compare") {
    rows.push(section("VERGLEICH", "die letzten zwei Fälle", inv.comparison ? inv.comparison.rows.length : 0, { num: "1" }));
    (inv.comparison ? inv.comparison.rows : []).forEach((r) => add("Δ", r.key, `${JSON.stringify(r.a)} → ${JSON.stringify(r.b)}`));
  } else if (view === "explanation") {
    rows.push(section("AUSSAGEN", "jede Behauptung gegen Fundstellen geprüft", inv.explanation ? inv.explanation.claims.length : 0, { num: "1" }));
    (inv.explanation ? inv.explanation.claims : []).forEach((c) => add(c.status === "supported" ? "BELEGT" : "UNKLAR", c.text, c.status, c.status === "supported" ? "Fire Z.108 schreibt self._count" : "kein erfasster Call"));
  } else if (view === "preview") {
    rows.push(section("VORSCHAU", "was der Vorschlag ändern würde – der DAT bleibt unverändert", inv.preview ? inv.preview.items.length : 0, { num: "1" }));
    (inv.preview ? inv.preview.items : []).forEach((p) => add("NEU", p.name, p.text));
  } else if (view === "visual") {
    rows.push(section("BILDFÄLLE", "out1 des StateLab samt Kontext", inv.visuals.length, { num: "1" }));
    inv.visuals.forEach((v, i) => add("BILD", `Bildfall ${i + 1}`, `rot ${fmtNum(v.red)} · blau ${fmtNum(v.blue)} · Count ${v.count}`, v.id));
  }
  if (!rows.length) rows.push(notice("leer"));
  return { rows };
}

export { info, parentOf };
