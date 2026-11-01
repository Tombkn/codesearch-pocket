// CodeSearch Pocket - Rahmen: Daten laden, zeichnen, jede Beruehrung auf genau eine Geste (core/gestures.js) abbilden.

import { createApp } from "./core/boot.js";
import { CS_DEFAULTS } from "./core/cs.js";
import { keysFor } from "./core/phone.js";
import { $, esc, updateHtml, tapper, toast, copyToDevice } from "./ui/dom.js";
import { renderCS } from "./ui/cswin.js";
import { renderTour } from "./ui/tourcard.js";
import { renderTD, renderCourse, renderAtlas, renderFlowLens, renderPopup, renderQuick, renderFloats, renderOffline } from "./ui/layers.js";
import { offline, loadManifest, checkStatus, complete, downloadAll, persist, watchInstall, install } from "./ui/offline.js";
import { bindViewport } from "./ui/viewport.js";
import { bindTabHelp } from "./ui/tabhelp.js";
import { bindSpec } from './ui/spec.js';
import {syncFloatFocus, trapFloatTab} from './ui/float-focus.js';
import { bindShiftWheel } from './ui/wheel.js';
import {hostQuery} from './ui/cs-host.js';

const KEYS_ALL = ["Enter", "Esc", "Ctrl+C", "Ctrl+Enter", "Ctrl+I", "Ctrl+Shift+I", "Ctrl+P", "Ctrl+F", "Alt+P", "Alt+F", "Ctrl+R", "F6", "Alt+D",
  "Ctrl+G", "Left", "Right", "Up", "Down", "Ctrl+Right", "Ctrl+Left", "Alt+Left", "Alt+Right", "Ctrl+Alt+Left", "Ctrl+Alt+Right",
  "Ctrl+Plus", "Ctrl+Minus", "Alt+0", "Alt+Shift+A", "Shift+K", "Alt+Shift+K", "Ctrl+Shift+K", "Ctrl+Z", "Ctrl+Y", "Ctrl+Shift+Z"];
const KEY_LABEL = { Left: "←", Right: "→", Up: "↑", Down: "↓", "Ctrl+Right": "Strg+→", "Ctrl+Left": "Strg+←", "Alt+Left": "Alt+←", "Alt+Right": "Alt+→",
  "Ctrl+Alt+Left": "Strg+Alt+←", "Ctrl+Alt+Right": "Strg+Alt+→", Enter: "⏎ Enter" };

async function main() {
  bindViewport();
  // Einzel-Datei: die Daten stecken schon in der Seite (window.__POCKET_DATA__), sonst aus data/ laden
  const packed = window.__POCKET_DATA__;
  const fetchJson = (name) => (packed ? Promise.resolve(packed[name])
    : fetch(`data/${name}`).then((r) => { if (!r.ok) throw new Error(`${name}: ${r.status}`); return r.json(); }));
  const [course, net, code, ui, features] = await Promise.all(["course.json", "net.json", "code.json", "ui.json", "features.json"].map(fetchJson));
  let storage = null;
  try { storage = window.localStorage; storage.getItem("x"); } catch { storage = null; }
  const app = createApp({ course, net, code, ui }, storage);
  const { cs, tour, gestures: g } = app;
  const ctx = {
    app, cs, tour, g, ui, features, course,
    td: { open: false, tab: "net", sheet: "BranchLab", zoom: 1, hidden: true, opPath: null },
    layers: { course: false, atlas: false, atlasTab: "cheat", doc: null, offline: false },
    offline, storage,
    popup: { tooltip: null, compare: false },
    lastCheck: null, keysOpen: false, tourOpen: true, fieldFocused: false,
    readerLarge: false, readerScroll: 0,
  };
  try { ctx.readerLarge = storage?.getItem("codesearch-pocket-reader-size") === "large"; } catch { /* Ansicht bleibt lokal. */ }

  // Lokale Zwischenablage und Geräteübertragung sind zwei verschiedene Ergebnisse.
  const innerCopy = cs.copy.bind(cs);
  cs.copy = (text, kind) => {
    innerCopy(text, kind);
    const operation = {serial: cs.clipboardSerial, text: String(text), kind, status: 'pending', message: 'Text in Pocket bereit. Geräte-Zwischenablage wird geprüft …'};
    ctx.deviceCopy = operation;
    cs.state.status = operation.message;
    toast(operation.message);
    ctx.render?.();
    copyToDevice(operation.text).then((result) => {
      // Eine verspätete Antwort einer alten Kopie darf die neuere nicht überschreiben.
      if (ctx.deviceCopy !== operation || cs.clipboardSerial !== operation.serial) return;
      operation.status = result.ok ? 'success' : 'failed';
      operation.message = result.ok ? 'In die Geräte-Zwischenablage kopiert.'
        : result.reason === 'unavailable' ? 'Geräte-Zwischenablage nicht verfügbar. Text bleibt in Pocket bereit.'
        : 'Geräte-Kopieren fehlgeschlagen oder blockiert. Text bleibt in Pocket bereit.';
      cs.state.status = operation.message;
      toast(operation.message);
      ctx.render?.();
    });
  };

  tour.load();
  tour.prepare(true);

  let queued = false;
  const render = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      renderAll(ctx);
    });
  };
  ctx.render = render;
  cs.onChange(render);
  // Einmalig: wie das Handy CodeSearch und TouchDesigner nachbildet
  let introSeen = false;
  try { introSeen = storage && storage.getItem("codesearch-pocket-intro") === "1"; } catch { introSeen = false; }
  if (!introSeen) {
    ctx.popup.tooltip = { title: "SO GEHT'S AM HANDY", text: [
      "1 · VERSTEHEN: Lies, wofür du die Funktion brauchst, und den nächsten Handgriff. Mit Aa stellst du die Leseschrift größer.",
      "2 · AUSPROBIEREN: „Zur Übung“ wechselt ins nachgebildete CodeSearch. Tippen markiert eine Zeile, Doppeltippen öffnet sie. TD zeigt das Übungsnetz und seine Parameter; ⌨ öffnet die Tastenleiste.",
      "3 · PRÜFEN: Nach deinem Handgriff liest „Prüfen“ den Modellzustand. „Gesehen“ ist deine eigene Lesebestätigung. Ein Häkchen beweist noch keinen sicheren Umgang am Laptop.",
      "„Lektion lesen“ bringt dich an deine Lesestelle zurück. Hinweise und Werkzeuge kannst du passend zur Aufgabe öffnen. ATLAS → AM LAPTOP enthält den Einstieg ins echte Projekt.",
      "Auf dem iPhone: Safari → Teilen → Zum Home-Bildschirm. Über ⇩ einmal alle Dateien speichern und den Offline-Start anschließend selbst testen.",
    ].join("\n\n") };
    try { if (storage) storage.setItem("codesearch-pocket-intro", "1"); } catch { /* egal */ }
  }
  renderAll(ctx);
  wire(ctx);
  startOffline(ctx);
  setInterval(() => {
    if (tour.playing) { cs.lab.step(6); if (cs.state.mode === "record" && cs.state.record.recording) render(); }
  }, 100);
}

function renderAll(ctx) {
  if(ctx.cs.state.parameterViewRequested!=null){ctx.td.open=true;ctx.td.tab='par';ctx.td.sheet='op';ctx.td.opPath=ctx.cs.state.parameterViewRequested;ctx.cs.state.parameterViewRequested=null;}
  if(ctx.cs.state.networkViewRequested){ctx.td.open=true;ctx.td.tab='net';ctx.cs.state.networkViewRequested=false;}
  const wasReading = $("#tour").classList.contains("open");
  const sameLesson = ctx.renderedLessonId === ctx.tour.lesson().id;
  if (!sameLesson) ctx.readerScroll = 0;
  else if (wasReading) ctx.readerScroll = $("#tour-body").scrollTop;
  document.documentElement.classList.toggle("reader-large", ctx.readerLarge);
  $("#tour").classList.toggle("open", ctx.tourOpen);
  $("#tour").classList.toggle("mini", !ctx.tourOpen);
  const keepScroll = $("#cs-list").scrollTop;
  renderCS(ctx);
  renderClipboardStatus(ctx);
  $("#cs-list").scrollTop = keepScroll;
  renderTour(ctx);
  renderKeys(ctx);
  // Netz: Scrollposition halten; beim Oeffnen / neuen Netz zum markierten Op scrollen
  const oldWrap = document.querySelector("#layer-td .netwrap");
  const netScroll = oldWrap ? [oldWrap.scrollLeft, oldWrap.scrollTop] : null;
  const netKey = `${ctx.td.open}|${ctx.td.tab}|${ctx.cs.state.paneOwner}|${ctx.td.zoom}`;
  renderTD(ctx);
  const wrap = document.querySelector("#layer-td .netwrap");
  if (wrap) {
    if (netKey === ctx.lastNetKey && netScroll) [wrap.scrollLeft, wrap.scrollTop] = netScroll;
    else {
      const sel = wrap.querySelector(".net-op.sel") || wrap.querySelector(".net-op");
      if (sel && typeof sel.getBBox==='function') {
        const box = sel.getBBox();
        wrap.scrollLeft = Math.max(0, box.x - wrap.clientWidth / 2 + box.width / 2);
        wrap.scrollTop = Math.max(0, box.y - wrap.clientHeight / 2 + box.height / 2);
      }
    }
  }
  ctx.lastNetKey = netKey;
  const secondary=ctx.cs.state.secondaryPane,secondaryKey=`${secondary.open}|${secondary.owner}|${secondary.target}|${secondary.zoom || 1}`;
  if(secondary.open && secondaryKey!==ctx.lastSecondaryKey){
    const secondaryWrap=document.querySelector('[data-network-pane="secondary"] .netwrap'),target=secondaryWrap?.querySelector('.net-op.sel');
    if(target && typeof target.getBBox==='function'){const box=target.getBBox();secondaryWrap.scrollLeft=Math.max(0,box.x-secondaryWrap.clientWidth/2+box.width/2);secondaryWrap.scrollTop=Math.max(0,box.y-secondaryWrap.clientHeight/2+box.height/2);}
  }
  ctx.lastSecondaryKey=secondaryKey;
  renderCourse(ctx);
  renderAtlas(ctx);
  renderFlowLens(ctx);
  renderPopup(ctx);
  renderManualClipboard(ctx);
  renderQuick(ctx);
  renderFloats(ctx);
  scrollSelectedIntoView(ctx);
  renderOffline(ctx);
  $("#app").classList.toggle("reading", ctx.tourOpen);
  $("#cs").inert = ctx.tourOpen;
  $("#keys").inert = ctx.tourOpen;
  $("#quick").inert = ctx.tourOpen;
  $("#floats").inert = ctx.tourOpen;
  syncFloatFocus(ctx);
  $("#tour-grip").textContent = ctx.tourOpen ? "Zur Übung →" : "↑ Lektion lesen";
  $("#tour-grip").setAttribute("aria-expanded", String(ctx.tourOpen));
  $("#keys").classList.toggle("show", ctx.keysOpen);
  $("#btn-keys").classList.toggle("on", ctx.keysOpen);
  $("#btn-td").classList.toggle("on", ctx.td.open);
  // Erst das fertige Layout restaurieren: Chromium begrenzt scrollTop sonst
  // noch gegen die Höhe der eingeklappten Lernkarte.
  if (ctx.tourOpen && !wasReading) $("#tour-body").scrollTop = ctx.readerScroll;
}

function scrollSelectedIntoView(ctx) {
  const s=ctx.cs.state, i=s.selected, float=s.floats.find(f=>f.id===s.floatFocus&&f.live);
  if(s.focusWin==='quick' && s.quick.open){
    const q=s.quick,key=`${q.id}:${q.generation}:${q.selected}`;
    if(ctx.lastQuickSelected!==key){ctx.lastQuickSelected=key;document.querySelector(`[data-qid="${q.id}"] [data-qrow="${q.selected}"]`)?.scrollIntoView({block:'nearest'});}return;
  }
  const owner=float?`float:${float.id}`:'main', previous=ctx.lastSelectedByHost??={};
  if(previous[owner]===i)return;previous[owner]=i;if(i<0)return;
  const list=float?document.querySelector(`[data-float="${float.id}"] [data-role="cs-list"]`):document.querySelector('#cs-list');
  list?.querySelector(`[data-row="${i}"]`)?.scrollIntoView({block:'nearest'});
}

function renderClipboardStatus(ctx) {
  let box = $('#clipboard-notice');
  if (!box) {
    box = document.createElement('div');
    box.id = 'clipboard-notice';
    box.className = 'cs-data';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.style.cssText = 'flex:0 0 auto;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 8px';
    $('#cs-status').before(box);
  }
  const operation = ctx.deviceCopy;
  // Core-Aktionen dürfen weiterhin die lokale Kopierhandlung beschreiben; in
  // der Browser-UI ist „kopiert“ erst nach bestätigtem Gerätezugriff sichtbar.
  if (operation && operation.status !== 'success' && /kopiert/i.test(ctx.cs.state.status)) $('#cs-status .l').textContent = operation.message;
  box.hidden = !operation || operation.dismissed;
  box.style.display = operation && !operation.dismissed ? 'flex' : 'none';
  if (!operation) return;
  box.dataset.copyStatus = operation.status;
  updateHtml(box, `<span style="flex:1;min-width:150px;white-space:normal">${esc(operation.message)}</span>${operation.status === 'failed' ? '<button type="button" class="chip" style="min-height:44px;border:1px solid var(--line2)" data-act="clipboard-manual">Text manuell kopieren</button>' : ''}<button type="button" class="chip" style="min-height:44px" data-act="clipboard-dismiss" aria-label="Kopierhinweis schließen">Schließen</button>`);
}

function renderManualClipboard(ctx) {
  if (ctx.popup.json !== 'manual') return;
  const box = $('#popup');
  $('#json-title').textContent = 'TEXT MANUELL KOPIEREN';
  const paragraph = box.querySelector('.bb > p');
  paragraph.textContent = `${ctx.deviceCopy?.message || 'Text ist in Pocket verfügbar.'} Mit „Text markieren“ alles auswählen und anschließend im iPhone-Auswahlmenü „Kopieren“ wählen. Danach in deinen Chat wechseln und einfügen. Es wird nichts importiert.`;
  const textarea = $('#json-text');
  textarea.readOnly = true;
  textarea.setAttribute('aria-label', 'Text zum manuellen Kopieren');
  box.querySelector('[data-pop=json-cancel]').textContent = 'Schließen';
  const retry = box.querySelector('[data-pop=json-apply]');
  retry.textContent = ctx.deviceCopy?.status === 'pending' ? 'Geräte-Kopieren läuft …' : 'Geräte-Kopieren erneut versuchen';
  retry.disabled = ctx.deviceCopy?.status === 'pending';
  if (!box.querySelector('[data-pop=clipboard-select]')) {
    const select = document.createElement('button');
    select.type = 'button'; select.dataset.pop = 'clipboard-select'; select.textContent = 'Text markieren';
    retry.before(select);
  }
}

function renderKeys(ctx) {
  const lesson = ctx.tour.lesson();
  const wanted = keysFor(lesson.action);
  const mods = ctx.g.mods;
  const order = [...wanted.filter((k) => KEYS_ALL.includes(k)), ...KEYS_ALL.filter((k) => !wanted.includes(k))];
  $("#keys").innerHTML = `<button class="key mod ${mods.ctrl ? "on" : ""}" data-mod="ctrl">STRG</button>
    <button class="key mod ${mods.alt ? "on" : ""}" data-mod="alt">ALT</button>
    <button class="key mod ${mods.shift ? "on" : ""}" data-mod="shift">⇧</button><span class="key sep">|</span>`
    + order.map((k) => `<button class="key ${wanted.includes(k) ? "hint" : ""}" data-key="${k}">${esc(KEY_LABEL[k] || k.replace(/Ctrl/g, "Strg"))}</button>`).join("");
}

function wire(ctx) {
  const { cs, tour, g } = ctx;
  const render = () => ctx.render();
  const act = (fn) => (...args) => { try { fn(...args); } catch (error) { toast(error.message); } render(); };

  // ---------------------------------------------------------------- Kopf
  $("#btn-td").addEventListener("click", act(() => { ctx.td.open = !ctx.td.open; }));
  $("#btn-keys").addEventListener("click", act(() => { ctx.keysOpen = !ctx.keysOpen; if (ctx.keysOpen) ctx.tourOpen = false; }));
  $("#btn-course").addEventListener("click", act(() => { ctx.layers.course = true; }));
  $("#btn-atlas").addEventListener("click", act(() => { ctx.layers.atlas = true; }));
  $("#btn-reopen").addEventListener("click", act(() => g.openCodeSearch()));
  $("#btn-offline").addEventListener("click", act(() => { ctx.layers.offline = true; checkStatus().then(render); }));

  // ---------------------------------------------------------------- Offline-Ebene
  $("#layer-offline").addEventListener("click", act((ev) => {
    const t = ev.target.closest("[data-off],[data-act]");
    if (!t) return undefined;
    if (t.dataset.act === "offline-close") { ctx.layers.offline = false; return undefined; }
    switch (t.dataset.off) {
      case "download": downloadAll(render, complete()); return undefined;
      case "persist": persist().then(render); return undefined;
      case "install": install().then(render); return undefined;
      case "check": checkStatus().then(() => { toast(complete() ? "✓ alles offline gespeichert" : `${offline.missing.length} Dateien fehlen noch`); render(); }); return undefined;
      case "export": return exportProgress(ctx);
      case "import": $("#progress-file").click(); return undefined;
      default: return undefined;
    }
  }));
  $("#layer-offline").addEventListener("change", (ev) => {
    if (ev.target.id === "progress-file" && ev.target.files[0]) importProgress(ctx, ev.target.files[0]);
  });

  ctx.bindCSHost = hostCtx => bindCSHost(hostCtx);
  bindCSHost(ctx);

  // ---------------------------------------------------------------- Tastenleiste
  $("#keys").addEventListener("click", act((ev) => {
    const t = ev.target.closest("[data-key],[data-mod]");
    if (!t) return undefined;
    if (t.dataset.mod) return g.modifier(t.dataset.mod);
    const key = t.dataset.key;
    if (key === "Ctrl+C" && ctx.fieldFocused) return g.copyFieldText();
    if (key === "Down" && ctx.td.open) return toast("Fokus im TD-Netzwerk: die CodeSearch-Liste bleibt stehen.");
    return g.key(key);
  }));

  // ---------------------------------------------------------------- Tour-Karte
  $("#tour-grip").addEventListener("click", act(() => { ctx.tourOpen = !ctx.tourOpen; }));
  const tourClick = act((ev) => {
    const t = ev.target.closest("[data-tour]");
    if (!t) return undefined;
    switch (t.dataset.tour) {
      case "back": ctx.lastCheck = null; ctx.tourOpen = true; return g.back();
      case "next": ctx.lastCheck = null; if (!g.next()) ctx.showFeedback = true; ctx.tourOpen = true; return undefined;
      case "check": { ctx.lastCheck = g.check(); ctx.tourOpen = true; ctx.showFeedback = true; return undefined; }
      case "seen": return g.seen();
      case "hint": ctx.tourOpen = true; ctx.showHint = true; return g.hint();
      case "show-hint": ctx.tourOpen = true; ctx.showHint = true; if (!tour.hint) g.hint(); return undefined;
      case "practice": ctx.tourOpen = false; return undefined;
      case "read-size": {
        ctx.readerLarge = !ctx.readerLarge;
        try { ctx.storage?.setItem("codesearch-pocket-reader-size", ctx.readerLarge ? "large" : "normal"); } catch { /* Kein Speicher nötig. */ }
        return undefined;
      }
      case "skip": ctx.lastCheck = null; ctx.tourOpen = true; return g.skip();
      case "workspace": ctx.tourOpen = false; return g.workspace();
      case "labparams": ctx.td.open = true; ctx.td.tab = "par"; ctx.td.sheet = tour.lesson().target.startsWith("SignalGarden") ? "SignalGarden" : tour.lesson().target.startsWith("StateLab") ? "StateLab" : (tour.lesson().target.startsWith("Farbmischer") ? "Farbmischer" : "BranchLab"); return undefined;
      case "params": ctx.td.open = true; ctx.td.tab = "par"; ctx.td.sheet = "op"; ctx.td.opPath = tour.lesson().target; return undefined;
      case "csparams": ctx.td.open = true; ctx.td.tab = "par"; ctx.td.sheet = "cs"; return undefined;
      case "compare": ctx.popup.compare = true; return undefined;
      case "chapters": ctx.layers.course = true; return undefined;
      case "laptop": ctx.layers.atlas = true; ctx.layers.atlasTab = "laptop"; return undefined;
      case "json": ctx.popup.json = true; ctx.popup.jsonDraft = null; ctx.popup.jsonError = ''; return undefined;
      case "pause": return pause(ctx);
      case "error": return g.setError();
      case "restore": return g.restoreError();
      case "flowlens": ctx.tourOpen = false; return g.openFlowLens();
      case "prompt": return g.copyPrompt();
      default: return undefined;
    }
  });
  $("#tour-body").addEventListener("click", tourClick);
  $("#tour-actions").addEventListener("click", tourClick);
  $("#tour-head").addEventListener("click", tourClick);

  // ---------------------------------------------------------------- TD-Seite
  const tdLayer = $("#layer-td");
  tdLayer.addEventListener("click", act((ev) => {
    const t = ev.target.closest("[data-tdtab],[data-act],[data-sheet],[data-bl-toggle],[data-bl-pulse],[data-sl-toggle],[data-sl-pulse],[data-fm-toggle],[data-fm-pulse],[data-cs-toggle],[data-garden-owner],[data-garden-toggle],[data-garden-pulse],[data-garden-reinit]");
    if (!t) return undefined;
    const d = t.dataset;
    // Safari fokussiert Buttons nicht immer: beendete Eingaben dürfen die
    // nächste Parameteraktion oder den Blattwechsel nicht vom Rendern abhalten.
    if (tdLayer.contains(document.activeElement) && document.activeElement.matches('input,select,textarea')) document.activeElement.blur();
    if (d.tdtab) { ctx.td.tab = d.tdtab; return undefined; }
    if (d.sheet) { ctx.td.sheet = d.sheet; return undefined; }
    if (d.blToggle) return g.blPar(d.blToggle, !cs.lab.blPars[d.blToggle]);
    if (d.blPulse) { g.blPulse(d.blPulse); return toast(`${d.blPulse} gepulst · ${cs.lab.blPars.Status}`); }
    if (d.gardenOwner) { ctx.td.sheet='SignalGarden';ctx.td.gardenOwner = d.gardenOwner; return undefined; }
    if (d.gardenToggle) return g.gardenPar(d.owner, d.gardenToggle, !cs.lab.garden.pars[d.owner][d.gardenToggle]);
    if (d.gardenPulse) { g.gardenPulse(d.owner, d.gardenPulse); return toast(`${d.owner}.${d.gardenPulse} ausgeführt`); }
    if (d.gardenReinit) return g.gardenReinit(d.gardenReinit);
    if (d.slToggle) return g.slPar(d.slToggle, !cs.lab.stateLab.pars[d.slToggle]);
    if (d.slPulse) { g.slPulse(d.slPulse); return toast(cs.lab.stateLab.pars.Status); }
    if (d.fmToggle) return g.fmPar(d.fmToggle, !cs.lab.farbmischer.pars[d.fmToggle]);
    if (d.fmPulse) return g.fmPulse(d.fmPulse);
    if (d.csToggle) return g.csPar(d.csToggle, !cs.cs[d.csToggle]);
    if(t.closest('[data-network-pane="secondary"]')){
      if(d.act==='net-up')return cs.secondaryNetwork('up');
      if(d.act==='net-enter')return cs.secondaryNetwork('enter',d.path);
      if(d.act==='net-zoom-in')return cs.secondaryNetwork('zoom',1.4);
      if(d.act==='net-zoom-out')return cs.secondaryNetwork('zoom',1/1.4);
      if(d.act==='net-secondary-close')return cs.secondaryNetwork('close');
    }
    switch (d.act) {
      case "td-close": ctx.td.open = false; return undefined;
      case "net-up": return g.netUp();
      case "net-hidden": ctx.td.hidden = !ctx.td.hidden; return undefined;
      case "net-zoom-in": ctx.td.zoom = Math.min(4, ctx.td.zoom * 1.4); return undefined;
      case "net-zoom-out": ctx.td.zoom = Math.max(0.4, ctx.td.zoom / 1.4); return undefined;
      case "td-rec": g.key("Alt+Shift+A"); return toast(cs.state.record.recording ? "RECORD läuft (Alt+Shift+A stoppt)" : "RECORD gestoppt");
      case "td-undo": g.key("Ctrl+Z"); return toast(cs.state.status);
      case "td-redo": g.key("Ctrl+Y"); return toast(cs.state.status);
      case "td-down": return toast("Fokus im TD-Netzwerk: ↓ bewegt die CodeSearch-Liste nicht.");
      case "net-enter": return g.netEnter(d.path);
      case "net-viewer": cs.state.viewer = { path: d.path, line: null }; return cs.emit();
      case "net-par": ctx.td.tab = "par"; ctx.td.sheet = "op"; ctx.td.opPath = d.path; return undefined;
      case "net-cs": ctx.td.open = false; return cs.OpenAt(d.mode, { target: d.path });
      case "play": return g.play(!tour.playing);
      case "frames": return g.frames(60);
      default: return undefined;
    }
  }));
  tdLayer.addEventListener("change", act((ev) => {
    const t = ev.target;
    const d = t.dataset;
    if (d.blMenu) return g.blPar(d.blMenu, t.value);
    if (d.blNum) return g.blPar(d.blNum, Number(t.value));
    if (d.gardenMenu) return g.gardenPar(d.owner, d.gardenMenu, t.value);
    if (d.gardenNum) return g.gardenPar(d.owner, d.gardenNum, Number(t.value));
    if (d.gardenText) return g.gardenPar(d.owner, d.gardenText, t.value);
    if (d.fmNum) return g.fmPar(d.fmNum, Number(t.value));
    if (d.csMenu) return g.csPar(d.csMenu, t.value);
    if (d.csNum) return g.csPar(d.csNum, Number(t.value));
    return undefined;
  }));
  tapper(tdLayer, "[data-op]", {
    tap: act((el) => el.closest('[data-network-pane="secondary"]') ? cs.secondaryNetwork('select',el.dataset.op) : g.netSelect(el.dataset.op)),
    double: act((el) => { const o = cs.net.op(el.dataset.op); if (o && o.family === "COMP") {if(el.closest('[data-network-pane="secondary"]'))cs.secondaryNetwork('enter',el.dataset.op);else g.netEnter(el.dataset.op);} else { cs.state.viewer = { path: el.dataset.op, line: null }; cs.emit(); } }),
  });

  // ---------------------------------------------------------------- Kurs, Atlas, FlowLens
  $("#layer-course").addEventListener("click", act((ev) => {
    const t = ev.target.closest("[data-chapter],[data-act]");
    if (!t) return undefined;
    if (t.dataset.act === "course-close") { ctx.layers.course = false; return undefined; }
    ctx.layers.course = false;
    ctx.lastCheck = null;
    ctx.tourOpen = true;
    tour.chapterStart(Number(t.dataset.chapter));
    return cs.emit();
  }));
  $("#layer-atlas").addEventListener("click", act((ev) => {
    const t = ev.target.closest("[data-atlas],[data-doc],[data-act],[data-learn-chapter]");
    if (!t) return undefined;
    if (t.dataset.act === "atlas-close") { ctx.layers.atlas = false; return undefined; }
    if (t.dataset.learnChapter !== undefined) {
      ctx.layers.atlas = false; ctx.tourOpen = true; ctx.lastCheck = null;
      tour.chapterStart(Number(t.dataset.learnChapter)); return cs.emit();
    }
    if (t.dataset.atlas) { ctx.layers.atlasTab = t.dataset.atlas; ctx.layers.doc = null; return undefined; }
    if (t.dataset.doc !== undefined) { ctx.layers.doc = Number(t.dataset.doc) < 0 ? null : Number(t.dataset.doc); $("#layer-atlas .lbody").scrollTop = 0; }
    return undefined;
  }));
  $("#layer-flowlens").addEventListener("click", act((ev) => {
    const t = ev.target.closest("[data-fla],[data-fl]");
    if (!t) return undefined;
    if (t.dataset.fl) return g.flowlens("select", t.dataset.fl);
    if (t.dataset.fla === "codesearch") { g.flowlens("codesearch"); g.flowlens("close"); return toast("FLOW auf der gewählten Station – die Auswahl im TD-Netz bleibt."); }
    return g.flowlens(t.dataset.fla);
  }));

  // ---------------------------------------------------------------- Popup
  $("#popup").addEventListener("click", act((ev) => {
    if (ev.target.id === "popup") { closePopup(ctx); return undefined; }
    const t = ev.target.closest("[data-pop],[data-menu]");
    if (!t) return undefined;
    if (t.dataset.menu !== undefined) {
      const item = cs.state.menu.items[Number(t.dataset.menu)];
      cs.state.menu = null;
      if (item) item.run();
      return cs.rebuild();
    }
    switch (t.dataset.pop) {
      case "clipboard-select": {
        const textarea = $('#json-text'); textarea.focus(); textarea.select(); textarea.setSelectionRange(0, textarea.value.length);
        return undefined;
      }
      case "json-cancel": ctx.popup.json = false; ctx.popup.jsonError = ""; ctx.popup.jsonDraft = null; return undefined;
      case "json-apply": {
        const text = $("#json-text").value;
        if (ctx.popup.json === 'manual') { cs.copy(text, ctx.deviceCopy?.kind || 'manual'); return undefined; }
        const analyse = ctx.popup.json === 'analysis';
        if (analyse) {
          const result = cs.importAnalysis(text);
          if (result.ok === false) { ctx.popup.jsonDraft = text; ctx.popup.jsonError = result.error; return undefined; }
        }
        ctx.popup.json = false;
        ctx.popup.jsonError = '';
        ctx.popup.jsonDraft = null;
        if (!analyse) g.setClipboard(text);
        ctx.tourOpen = false;
        return undefined;
      }
      case "esc": return g.key("Esc");
      case "enter": return g.enter();
      case "edit-apply": g.editSet($("#editor-text").value); return g.editApply();
      case "edit-cancel": return g.editCancel();
      case "help-close": cs.state.help = null; return cs.emit();
      case "tip-close": ctx.popup.tooltip = null; return undefined;
      case "compare-close": ctx.popup.compare = false; return undefined;
      default: return undefined;
    }
  }));
  $("#popup").addEventListener("click", (ev) => {
    const id = ev.target.closest("#popup .code [data-id]");
    if (id) act(() => g.codeClick(id.dataset.id))();
  });

  // ---------------------------------------------------------------- Schnellsuche
  const quick = $('#quick');
  const sessionAt=element=>cs.quickActivate(element.closest('[data-qid]')?.dataset.qid);
  quick.addEventListener('pointerdown',ev=>sessionAt(ev.target));
  quick.addEventListener('focusin',ev=>sessionAt(ev.target));
  quick.addEventListener('input',act(ev=>{if(ev.target.hasAttribute('data-qinput')){sessionAt(ev.target);g.quickType(ev.target.value);}}));
  quick.addEventListener('change',act(ev=>{
    const q=sessionAt(ev.target);if(!q)return;
    if(ev.target.hasAttribute('data-qscope'))return cs.quickScope(ev.target.value);
    const option=ev.target.dataset.qoption;if(option)return cs.quickOption(option,ev.target.type==='checkbox'?ev.target.checked:Number(ev.target.value),q.id);
  }));
  quick.addEventListener('keydown',act(ev=>{
    sessionAt(ev.target);
    if(ev.target.hasAttribute('data-qinput') && ev.key==='Enter'){ev.preventDefault();g.quickEnter();}
    if(ev.key==='Escape'){ev.preventDefault();g.quickEsc();}
  }));
  quick.addEventListener('click',act(ev=>{
    sessionAt(ev.target);const t=ev.target.closest('[data-q],[data-qfilter]');if(!t)return;
    if(t.dataset.qfilter)return g.quickFilter(t.dataset.qfilter);
    if(t.dataset.q==='new')return cs.quickOpen(true);
    if(t.dataset.q==='esc')return g.quickEsc();
    if(t.dataset.q==='enter')return g.quickEnter();
  }));
  tapper(quick,'[data-qrow]',{
    tap:act(el=>{sessionAt(el);g.quickTap(Number(el.dataset.qrow));}),
    double:act(el=>{sessionAt(el);g.quickDoubleTap(Number(el.dataset.qrow));}),
    long:act(el=>{
      const q=sessionAt(el),id=q.id,i=Number(el.dataset.qrow);g.quickTap(i);
      cs.state.menu={title:'SCHNELLSUCHE',items:[{label:'IM HAUPTFENSTER ÖFFNEN',run:()=>cs.quickToMain(i,id)},
        {label:'SPRINGEN (Doppelklick)',run:()=>{if(cs.quickActivate(id))cs.quickJump(i);}}]};cs.emit();
    }),
  });

  // ---------------------------------------------------------------- Lesekopien
  $("#floats").addEventListener("focusin",ev=>{const card=ev.target.closest('[data-float]');if(card){cs.state.floatFocus=card.dataset.float;cs.state.focusWin="float";}});
  $("#floats").addEventListener("click", act((ev) => {
    const t = ev.target.closest("[data-ffocus],[data-fclose],[data-frow],[data-fsize],[data-flayout],[data-fcopy],[data-fmanual]");
    if (!t) return undefined;
    if (t.dataset.fmanual) {ctx.popup.json='manual';ctx.popup.jsonDraft=ctx.deviceCopy?.text ?? cs.clipboard;ctx.popup.jsonError='';return undefined;}
    if(t.dataset.flayout) {const f=cs.state.floats.find(item=>item.id===t.dataset.flayout);f.kind=f.kind==='workspace'?'list':['details','code'].includes(f.kind)?'workspace':'details';cs.state.floatFocus=f.id;return cs.emit();}
    if (t.dataset.fsize) { const f = cs.state.floats.find(item => item.id === t.dataset.fsize); return cs.floatSize(f.id, f.size === 'full' ? 'side' : 'full'); }
    if (t.dataset.fcopy) { const f = cs.state.floats.find(item => item.id === t.dataset.fcopy); cs.state.floatFocus=f.id; return cs.copy(f.text, 'float'); }
    if (t.dataset.fclose) { g.focusFloat(t.dataset.fclose); return g.floatEsc(); }
    if (t.dataset.ffocus) return g.focusFloat(t.dataset.ffocus);
    if (t.dataset.frow !== undefined) {
      g.focusFloat(t.dataset.fid);
      const f = cs.state.floats.find((x) => x.id === t.dataset.fid);
      if (f) f.selected = Number(t.dataset.frow);
      return cs.emit();
    }
    return undefined;
  }));

  // Hardware-Tastatur (Tablet / Desktop): dieselben Gesten
  document.addEventListener("keydown", act((ev) => {
    if (ev.defaultPrevented) return undefined;
    if (trapFloatTab(ctx, ev)) return undefined;
    if(ev.target.closest?.('.code-viewport') && !ev.ctrlKey && !ev.metaKey && !ev.altKey && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End',' '].includes(ev.key))return undefined;
    if (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA" || ev.target.tagName === "SELECT") return undefined;
    // Im Lesetext und in überlagerten Seiten bleiben Pfeile/Enter beim Browser.
    if (ctx.tourOpen || ctx.td.open || Object.values(ctx.layers).some((value) => value === true)
      || (cs.state.help?.source !== 'tab-hover' && (cs.state.menu || cs.state.dialog || cs.state.viewer || cs.state.editor || cs.state.help || ctx.popup.tooltip || ctx.popup.json || ctx.popup.compare))) return undefined;
    if (ev.target.closest?.("button, summary") && (ev.key === "Enter" || ev.key === " ")) return undefined;
    const parts = [];
    if (ev.ctrlKey || ev.metaKey) parts.push("Ctrl");
    if (ev.altKey) parts.push("Alt");
    // Auf Tastaturen mit Shift+= bleibt Strg++ derselbe Zoom-Shortcut.
    if (ev.shiftKey && ev.key !== "+") parts.push("Shift");
    const map = { ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down", Escape: "Esc", Enter: "Enter", "+": "Plus", "=": "Plus", "-": "Minus" };
    const k = map[ev.key] || (ev.key.length === 1 ? ev.key.toUpperCase() : ev.key);
    const name = [...parts, k].join("+");
    if (KEYS_ALL.includes(name)) { ev.preventDefault(); return g.key(name); }
    return undefined;
  }));
  bindShiftWheel(document, (floatId, step) => {
    if (floatId) g.focusFloat(floatId);
    g.key(step > 0 ? "Ctrl+Plus" : "Ctrl+Minus");
    ctx.render();
  });
}

function bindCSHost(ctx) {
  const $ = selector => hostQuery(ctx, selector);
  const {cs, tour, g} = ctx;
  const render = () => ctx.render();
  const act = fn => (...args) => { try { fn(...args); } catch(error) { toast(error.message); } render(); };
  bindSpec(ctx);
  $('#cs').addEventListener('change',act(event=>{
    if(event.target.hasAttribute('data-code-zoom'))return cs.emit();
    if(event.target.dataset.flowFilter)return cs.flowFilter(event.target.dataset.flowFilter,event.target.value);
    const option=event.target.dataset.searchOption;if(!option)return;
    const names={caseSensitive:'Casesensitive',regex:'Regex',includeTables:'Includetables',includeSys:'Includesys',maxResults:'Maxresults'};
    if(names[option]){cs.cs[names[option]]=event.target.type==='checkbox'?event.target.checked:Number(event.target.value);cs.rebuild();}
  }));
  // Der Fragetext bleibt beim Tippen im selben DOM-Knoten; keine Render-Schleife unter der iPhone-Tastatur.
  $("#cs").addEventListener("input", (event) => {
    if(event.target.hasAttribute('data-code-zoom')){
      cs.setCodeZoom(Number(event.target.value)/100,false);
      for(const host of document.querySelectorAll('.cs'))host.style.setProperty('--code-zoom',String(cs.state.codeZoom));
      event.target.nextElementSibling.textContent=event.target.value+' %';return;
    }
    if ((event.target.dataset.role || event.target.id) === 'analysis-question') cs.state.inv.analysis.question = event.target.value;
  });
  // ---------------------------------------------------------------- Fenster: Klicks mit data-Attributen
  const focusHost=()=>{cs.state.focusWin=ctx.host?"float":"main";cs.state.floatFocus=ctx.hostId || null;};
  $("#cs").addEventListener("pointerdown",focusHost);$("#cs").addEventListener("focusin",focusHost);
  $("#cs").addEventListener("click", act((ev) => {
    cs.state.floatFocus = ctx.hostId || null;
    const t = ev.target.closest("[data-act],[data-scope],[data-mode],[data-ctx],[data-overview],[data-filter],[data-family],[data-address],[data-format],[data-rec],[data-jump],[data-block],[data-detail],[data-id],[data-sort]");
    if (!t) return;
    const d = t.dataset;
    if (d.scope) return g.scope(d.scope);
    if (d.mode) { g.mods.alt = false; return g.tab(d.mode); }
    if (d.ctx) return g.context(d.ctx);
    if (d.overview) return g.overview(d.overview);
    if (d.filter) return g.filter(d.filter);
    if (d.family) return g.family(d.family);
    if (d.address) return g.address(d.address);
    if (d.format) return g.data(d.format);
    if (d.rec) return g.record(d.rec);
    if (d.jump) {
      const el = $("#cs-list").querySelector(`[data-row="${d.jump}"]`);
      if (el) el.scrollIntoView({ block: "start" });
      return undefined;
    }
    if (d.block) return g.detail("block", d.block);
    if (d.detail) {
      const [name, arg] = d.detail.split(":");
      if (name === "exec") return toast("AUSFÜHREN ruft die Methode jetzt auf – im Kurs nur in TD selbst.");
      if (name === "chain") return g.detail("chain", Number(arg));
      if (name === "expr") return g.detail("expr", arg);
      return g.detail(name);
    }
    if (d.id) return g.codeClick(d.id);
    if (d.sort !== undefined) return g.tableSort(Number(d.sort));
    switch (d.act) {
      case "clipboard-manual": {
        ctx.popup.json = 'manual'; ctx.popup.jsonDraft = ctx.deviceCopy?.text ?? cs.clipboard; ctx.popup.jsonError = '';
        return undefined;
      }
      case "clipboard-dismiss": if (ctx.deviceCopy) ctx.deviceCopy.dismissed = true; return undefined;
      case "analysis": return cs.analysis();
      case "code-full": return cs.setCodeFull();
      case "code-zoom-reset": return cs.setCodeZoom(1);
      case "selection-mode": cs.state.multiSelect=!cs.state.multiSelect;return cs.emit();
      case "selection-menu": return cs.selectionMenu();
      case "selection-clear": return cs.selectionClear();
      case "flow-pin": return cs.flowPin();
      case "flow-refresh": return cs.flowRefresh();
      case "flow-pane": return cs.openNetworkPane(cs.selectedHit?.path || cs.flowTarget());
      case "td-undo": return cs.undoTD();
      case "td-redo": return cs.redoTD();
      case "spec": return cs.SpecView();
      case "analysis-goal": return cs.analysis(d.goal);
      case "analysis-refresh": return cs.refreshAnalysis();
      case "analysis-export": return cs.analysisBrief();
      case "analysis-import": ctx.popup.json = 'analysis'; ctx.popup.jsonDraft = ''; ctx.popup.jsonError = ''; return undefined;
      case "analysis-template": {
        const value = cs.analysisTemplate(d.template);
        ctx.popup.jsonDraft = JSON.stringify(value, null, 2); ctx.popup.jsonError = ''; ctx.popup.json = 'analysis';
        return undefined;
      }
      case "analysis-result-copy": return cs.copyAnalysisResult();
      case "analysis-next": {
        const next = cs.state.inv.analysis.result.data.answers[Number(d.answer)]?.next_request;
        if (next) return cs.importAnalysis(JSON.stringify(next));
        return undefined;
      }
      case "json": ctx.popup.json = true; ctx.popup.jsonDraft = null; ctx.popup.jsonError = ''; return undefined;
      case "quick": return g.key("Ctrl+P");
      case "look": return g.lookMenu();
      case "extension-menu": return g.extensionMenu(d.comp, Number(d.slot));
      case "win-min": if(ctx.hostId)return cs.floatSize(ctx.hostId,'side');return g.window(cs.state.window === "min" ? "normal" : "min");
      case "win-max": if(ctx.hostId){const f=cs.state.floats.find(x=>x.id===ctx.hostId);return cs.floatSize(f.id,f.size==='full'?'side':'full');}return g.window(cs.state.window === "max" ? "normal" : "max");
      case "win-close": if (ctx.hostId) return cs.floatClose(ctx.hostId); cs.state.mainopen = false; return cs.emit();
      case "readorder": return g.readOrder();
      case "help": return g.help();
      case "flowlens": return g.openFlowLens();
      case "data-net": return g.dataTakeNetwork();
      case "data-menu": {
        const d = cs.state.display;
        const labels = { name: "NAME – kürzester eindeutiger Name", relative: "RELATIV – Pfad ab RELATIV AB", full: "FULL PATH – volle Adresse ab /", op_relative: "op(RELATIV) – Python-Zugriff relativ", op_full: "op(FULL) – Python-Zugriff voll" };
        cs.state.menu = { title: "DATEN", items: [
          ...Object.entries(labels).map(([key, label]) => ({ label: `${d.format === key ? "● " : "○ "}${label}`, run: () => g.data(key) })),
          { label: `RELATIV AB: ${d.base}  →  NETZ ÜBERNEHMEN (${cs.state.paneOwner || "/"})`, run: () => g.dataTakeNetwork() },
        ] };
        return cs.emit();
      }
      case "data-details": return g.dataDetails();
      case "data-back": return g.dataBack();
      case "data-copy": return g.dataCopy();
      case "editor": return g.detail("editor");
      case "edit": return g.editOpen();
      case "float-list": return g.floatList();
      case "float-menu": return cs.floatMenu();
      case "float-code": return cs.floatCopy('code');
      case "reveal": return g.detail("reveal");
      case "def-back": return g.key("Alt+Left");
      case "def-fwd": return g.key("Alt+Right");
      default: return undefined;
    }
  }));
  $('#cs-detail').addEventListener('pointerdown',event=>{
    const handle=event.target.closest('[data-code-resize]');if(!handle)return;
    event.preventDefault();handle.setPointerCapture(event.pointerId);
    const start=event.clientY,height=ctx.codeHeight || 300;
    const resize=value=>{ctx.codeHeight=Math.round(Math.max(100,Math.min(900,value)));$('#cs').style.setProperty('--code-height',ctx.codeHeight+'px');handle.setAttribute('aria-valuenow',String(ctx.codeHeight));};
    const move=e=>resize(height+start-e.clientY);
    const stop=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',stop);handle.removeEventListener('pointercancel',stop);handle.removeEventListener('lostpointercapture',stop);};
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);handle.addEventListener('lostpointercapture',stop);
  });
  $('#cs-detail').addEventListener('keydown',event=>{
    const handle=event.target.closest('[data-code-resize]');if(!handle || !['ArrowUp','ArrowDown','Home'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();ctx.codeHeight=event.key==='Home'?300:Math.max(100,Math.min(900,(ctx.codeHeight || 300)+(event.key==='ArrowUp'?30:-30)));
    $('#cs').style.setProperty('--code-height',ctx.codeHeight+'px');handle.setAttribute('aria-valuenow',String(ctx.codeHeight));
  });
  // READ ORDER lange druecken = ReadPath-Marken (Shift+Klick)
  tapper($('#cs-context'),'[data-ctx="comp"]',{tap:()=>{},long:act(()=>g.compMenu())});
  tapper($("#cs-tabs"), "[data-act=readorder]", { tap: () => {}, long: act(() => { g.readOrderMarks(); toast(`ReadPath-Marken ${cs.state.readMarks ? "an" : "aus"}`); }) });
  tapper($("#cs-tabs"), "[data-mode]", { tap: () => {}, long: act((el) => g.altHelp(el.dataset.mode)) });
  ctx.tabHelp = bindTabHelp($("#cs-tabs"), {
    allowed: () => !ctx.tourOpen && !ctx.td.open && !Object.values(ctx.layers).some((value) => value === true)
      && !cs.state.menu && !cs.state.dialog && !cs.state.viewer && !cs.state.editor,
    show: (mode) => { g.altHelp(mode); cs.state.help.source = 'tab-hover'; },
    hide: () => { if (cs.state.help?.source === 'tab-hover') { cs.state.help = null; cs.emit(); } },
  });

  // Trefferliste: tippen, doppelt tippen, lange druecken; ART-Zelle = Tooltip
  tapper($("#cs-list"), "[data-row]", {
    tap: act((el, ev) => {
      const i = Number(el.dataset.row);
      const h = cs.state.hits[i];
      g.tapRow(i,{ctrl:ev.ctrlKey || ev.metaKey});
      if (ev.target.closest("[data-art]") && h && h.kind !== "section") showTooltip(ctx, h);
      if (h && h.kind === "section") showSectionHelp(ctx, h);
    }),
    double: act((el,ev) => {if(ev.ctrlKey || ev.metaKey || cs.state.multiSelect || g.mods.ctrl)g.tapRow(Number(el.dataset.row),{ctrl:ev.ctrlKey || ev.metaKey});else g.doubleTapRow(Number(el.dataset.row));}),
    long: act((el) => g.rowMenu(Number(el.dataset.row))),
  });
  // TABLE: Zelle tippen / doppelt = aendern / lange = Menue
  tapper($("#cs-list"), "[data-cell]", {
    tap: act((el) => { const [r, c] = el.dataset.cell.split(",").map(Number); g.tableTap(r, c); }),
    double: act((el) => {
      const [r, c] = el.dataset.cell.split(",").map(Number);
      const old = (cs.tableData()[r] || [])[c];
      const value = window.prompt(`Zelle [${r}, ${c}] ändern`, old);
      if (value !== null) g.tableEdit(r, c, value);
    }),
    long: act((el) => { const [r, c] = el.dataset.cell.split(",").map(Number); g.tableMenu(r, c); }),
  });

  // Feld
  const input = $("#cs-input");
  input.addEventListener("focus", () => { ctx.fieldFocused = true; });
  input.addEventListener("blur", () => { setTimeout(() => { ctx.fieldFocused = false; }, 300); });
  input.addEventListener("input", act(() => g.type(input.value)));
  input.addEventListener("keydown", act((ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); g.enter(input.value); input.blur(); }
    if (ev.key === "Escape") { g.key("Esc"); }
  }));
  input.addEventListener("copy", () => {
    const text = input.value.substring(input.selectionStart, input.selectionEnd) || input.value;
    cs.copy(text);
  });
  $("#cs-enter").addEventListener("click", act(() => { g.enter(input.value); }));

  // Splitter zwischen Liste und Detail
  const split = $("#cs-split");
  split.addEventListener("pointerdown", (ev) => {
    split.setPointerCapture(ev.pointerId);
    const body = $("#cs-body").getBoundingClientRect();
    const wide = window.innerWidth >= 900;
    const move = (e) => {
      const detail = $("#cs-detail");
      if (wide) detail.style.width = `${Math.max(160, Math.min(body.width - 160, body.right - e.clientX))}px`;
      else detail.style.height = `${Math.max(60, Math.min(body.height - 80, body.bottom - e.clientY))}px`;
    };
    const up = () => {
      split.removeEventListener("pointermove", move); split.removeEventListener("pointerup", up);
      split.removeEventListener("pointercancel", up); split.removeEventListener("lostpointercapture", up);
    };
    split.addEventListener("pointermove", move);
    split.addEventListener("pointerup", up);
    split.addEventListener("pointercancel", up);
    split.addEventListener("lostpointercapture", up);
  });

}

function closePopup(ctx) {
  const s = ctx.cs.state;
  if (s.editor || ctx.popup.json) return;
  if (s.dialog || s.menu || s.viewer) { ctx.g.key("Esc"); return; }
  s.help = null;
  ctx.popup.tooltip = null;
  ctx.popup.compare = false;
}

function showTooltip(ctx, h) {
  const ui = ctx.ui;
  const art = h.art || h.hitkind || (ui.KIND_LABELS || {})[h.kind] || h.kind;
  const text = h.kind_note || (ui.HITKIND_HELP || {})[h.hitkind] || (ui.KIND_HELP || {})[h.kind_orig || h.kind] || (ui.CAT_HELP || {})[h.cat] || (ui.DETAIL_HELP || {})[h.art] || "keine Erklärung zu dieser Zelle";
  ctx.popup.tooltip = { title: `TOOLTIP · ${art}`, text: `${text}\n\n${h.text_full || h.text}` };
}

function showSectionHelp(ctx, h) {
  const ui = ctx.ui;
  const text = h.detail || (ui.SECTION_HELP || {})[h.text] || (ui.ENTRY_HELP || {})[h.text] || "";
  if (text) toast(`${h.text}: ${text}`);
}

function pause(ctx) {
  const { cs, tour } = ctx;
  if (cs.state.record.recording) cs.recordStop();
  Object.assign(cs.cs, CS_DEFAULTS);
  cs.closeAllSearchWindows();
  cs.state.floats = [];
  tour.feedback = "PAUSE. CodeSearch-Settings wiederhergestellt. „Arbeitsplatz“ setzt beim gespeicherten Schritt fort.";
  tour.save();
  cs.rebuild();
}

// Service Worker anmelden, Speicherstand pruefen, Fehlendes von selbst nachladen
async function startOffline(ctx) {
  const render = () => ctx.render();
  watchInstall(render);
  if (offline.single) { render(); return; }
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    try { await navigator.serviceWorker.register("sw.js"); } catch (error) { offline.sw = `Fehler: ${error.message}`; }
  }
  await loadManifest();
  if (!offline.manifest) { offline.sw = "offline.json fehlt"; render(); return; }
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    try { await navigator.serviceWorker.ready; } catch { /* egal */ }
  }
  await checkStatus();
  render();
  if (!complete() && navigator.onLine !== false && "caches" in window) await downloadAll(render);
}

// Fortschritt als Datei sichern und wieder laden (z. B. von der Einzel-Datei in die App)
function exportProgress(ctx) {
  const { storage } = ctx;
  if (!storage) return toast("Dieser Browser erlaubt keinen Speicher.");
  const data = {};
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && key.startsWith("codesearch-pocket")) data[key] = storage.getItem(key);
  }
  const blob = new Blob([JSON.stringify({ app: "codesearch-pocket", saved: new Date().toISOString(), data }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "codesearch-pocket-fortschritt.json";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return toast(`Fortschritt gesichert: Schritt ${ctx.tour.step + 1}`);
}

async function importProgress(ctx, file) {
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.app !== "codesearch-pocket" || !parsed.data) throw new Error("keine Fortschritts-Datei von CodeSearch Pocket");
    for (const [key, value] of Object.entries(parsed.data)) {
      if (key.startsWith("codesearch-pocket")) ctx.storage.setItem(key, value);
    }
    toast("Fortschritt geladen – Seite startet neu");
    setTimeout(() => location.reload(), 600);
  } catch (error) {
    toast(`Laden fehlgeschlagen: ${error.message}`);
  }
}

main().catch((error) => {
  document.body.innerHTML = `<p style="padding:24px;font-family:sans-serif">Konnte den Kurs nicht laden: ${esc(error.message)}</p>`;
  console.error(error);
});
