// Ebene PROJEKTE (Vertrag POCKET-PROJECTS-SPEC 13 und 14): "My Pocket Projects", Zugang, Datei-Import, Abgleich und die
// Tabs UEBERSICHT · HIERARCHIE · NETZ · CODE · SUCHE eines geoeffneten Projekts. NETZ, CODE, Details, Verstehen und
// Notizen zeichnet js/ui/project-views.js; diese Datei ist der Rahmen drumherum.
//
// Regeln, die hier gelten:
// - Projektinhalte kommen NUR per createElement/textContent/setAttribute ins DOM (Baukasten h() unten). Kein
//   innerHTML, kein updateHtml, kein md(); Paketwerte nie in href/src/style/on* - h() kennt diese Attribute nicht.
// - Die Kurs-Engine (CodeSearch-Simulation, Lab, Tour, Gesten) wird fuer Projekte nie angefasst: die Ebene liest aus
//   dem App-Kontext nur offline (Offline-Status) und setzt nur layers.projects.
// - Lookups ueber Map/Set: "constructor" und "__proto__" sind gueltige TD-/Python-Namen.
// - Zurueck ueber history (app.js baut die Navigation, hier wird nur angewendet): Ebene, Projekt, Tab, Blatt.

import { toast, copyToDevice } from "./dom.js";
import { exactNode } from "./project-dom.js";
import { renderNetwork, renderCode, renderDetails, renderUnderstand, renderNotes } from "./project-views.js";
import { createProjectStore, projectDisplayName, storagePersistence, StoreError } from "../projects/store.js";
import { verifyStored, messageFor } from "../projects/verify.js";
import { createModel, SEARCH_KINDS, SEARCH_LIMITS } from "../projects/model.js";
import { AnchorError, createAnchor, resolveAnchor, validateAnchor } from "../projects/anchors.js";
import { PATTERNS, WARNING_SEVERITY } from "../projects/schema.js";
import {
  SyncController, TOKEN_PAGE_URL, checkAccess, checkTokenFormat, clearAuthHold, importPackageFile, listLocallyRemoved,
  packageProblemText, readToken, readTokenInfo, removeToken, saveToken, syncMessage, STORE_API,
} from "../projects/sync.js";

export const TABS = Object.freeze(["overview", "hierarchy", "network", "code", "search"]);
const TAB_LABELS = new Map([
  ["overview", "ÜBERSICHT"], ["hierarchy", "HIERARCHIE"], ["network", "NETZ"], ["code", "CODE"], ["search", "SUCHE"],
]);
const SEARCH_KIND_LABELS = new Map([
  ["name", "Name"], ["path", "Pfad"], ["method", "Methode"], ["code", "Code"], ["parameter", "Parameter"], ["table", "Tabelle"],
]);
const STATUS_LABELS = new Map([
  ["imported", "lokal importiert"], ["loading", "wird geladen"], ["remote", "auf dem Speicher"],
  ["local", "lokal geladen"], ["offline", "offline verfügbar"], ["failed", "fehlgeschlagen"],
]);
const SOURCE_STATUS_LABELS = new Map([
  ["exact", "exakt"], ["truncated", "gekürzt"], ["omitted-secret", "ausgelassen: Geheimnis"],
  ["omitted-size", "ausgelassen: zu groß"], ["omitted-type", "ausgelassen: Typ"], ["derived-not-read", "nicht gelesen (abgeleitet)"],
  ["unreadable", "nicht lesbar"], ["excluded-user", "vom Nutzer ausgeschlossen"], ["invalid-unicode", "ungültiges Unicode"],
]);
// Pocket zeigt nie den message-Text einer Paket-Warnung (Vertrag 4.15), sondern eine eigene Vorlage je Code.
const WARNING_TEXT = new Map([
  ["capture.changed", "Netz hat sich während der Erfassung geändert; die Momentaufnahme kann uneinheitlich sein."],
  ["capture.retried", "Erfassung wurde wiederholt, bis zwei Durchläufe übereinstimmten."],
  ["capture.long-frames", "Erfassung hatte lange Frames (unteilbare Lesezugriffe)."],
  ["root.slash", "Export ab / gewählt: der ganze Projektbaum ist im Umfang."],
  ["package.large", "Paket ist groß."],
  ["package.pocket-limit", "Paket liegt nahe an der Pocket-Grenze von 16 MiB."],
  ["operator.name-length", "Operator mit zu langem Namen oder Pfad ausgelassen."],
  ["operator.depth", "Operator zu tief verschachtelt, ausgelassen."],
  ["operator.secret-name", "Operator-Name sah wie ein Geheimnis aus, ausgelassen."],
  ["annotation.omitted", "Annotation ausgelassen."],
  ["value.size", "Wert, Expression oder Text zu lang; nicht übertragen."],
  ["source.size", "Code-Quelle zu groß; nicht übertragen."],
  ["source.truncated", "Tabelle gekürzt."],
  ["source.invalid-unicode", "Quelle enthält ungültiges Unicode; nicht übertragen."],
  ["secret.source", "Code-Quelle wegen eines Geheimnis-Funds nicht übertragen."],
  ["secret.value", "Wert wegen eines Geheimnis-Funds nicht übertragen."],
  ["analysis.skipped-size", "Analyse übersprungen: Quelle zu groß."],
  ["analysis.schema", "Analyse-Eintrag fehlerhaft; die Quelle bleibt lesbar."],
  ["analysis.parse", "Quelle ist kein lesbares Python; Analyse nur zeilenweise."],
]);
const SEVERITY_LABELS = new Map([["info", "Hinweis"], ["warning", "Warnung"], ["error", "Fehler"]]);
// Meldung nach dem Kopieren je Art (actions.copyText(text, kind) aus den Ansichten, "context" aus der Kopfzeile).
const COPY_TOASTS = new Map([
  ["context", "Kontext kopiert."], ["path", "Pfad kopiert."], ["code", "Code kopiert."], ["selection", "Auswahl kopiert."],
]);
const CAPABILITY_LABELS = new Map([
  ["positions", "Positionen"], ["annotations", "Annotationen"], ["wires", "Leitungen"], ["compConnectors", "COMP-Stecker"],
  ["docks", "Docks"], ["customPars", "Custom Pars"], ["builtinPars", "Eingebaute Pars"], ["effectiveValues", "Effektive Werte"],
  ["codeText", "Code-Text"], ["tables", "Tabellen"], ["analysis", "Analyse"], ["references", "Verweise"],
  ["storage", "Storage"], ["channels", "Kanäle"], ["media", "Medien"],
]);
const MAX_LIST_ITEMS = 100;
const TREE_CHUNK = 200;
const FILTER_MAX = 500;
const SAVE_DELAY_MS = 500;
const MAX_MODELS = 2;
const UI_KEY_PREFIX = "view:";

// Nahtstelle fuer Node-Tests (jsdom hat kein IndexedDB, kein echtes Netz). Im Browser bleiben die Standardwerte.
export const platform = {
  createStore: () => createProjectStore(),
  fetch: (...args) => globalThis.fetch(...args),
  now: () => Date.now(),
  sleep: null,
  online: () => !(globalThis.navigator && globalThis.navigator.onLine === false),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (id) => clearTimeout(id),
  debounceMs: undefined,
  minIntervalMs: undefined,
  retryDelaysMs: undefined,
};

// ------------------------------------------------------------------ DOM-Baukasten (Vertrag 14)

// Nur diese Attribute; href/src/style/on* fehlen absichtlich. dataset-Werte sind reine Daten (inert).
const SAFE_ATTRS = new Set(["class", "id", "type", "role", "title", "tabindex", "for", "name", "placeholder", "accept",
  "multiple", "autocomplete", "autocapitalize", "spellcheck", "inputmode", "enterkeyhint", "hidden", "disabled",
  "lang", "dir", "rows", "maxlength", "readonly", "checked"]);

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "text") el.textContent = String(value);
      else if (key === "value") el.value = String(value);
      else if (key === "dataset") for (const [name, item] of Object.entries(value)) el.dataset[name] = String(item);
      else if (key.startsWith("aria-") || SAFE_ATTRS.has(key)) el.setAttribute(key, value === true ? "" : String(value));
      else throw new Error(`projects: Attribut nicht erlaubt (${key})`);
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(isDomNode(child) ? child : document.createTextNode(String(child)));
  }
  return el;
}

// Paketzeichenkette exakt und richtungsisoliert (<bdi>), Bidi-/Nullbreitenzeichen mit sichtbarer Marke wie in den
// Ansichten (project-dom.js): ein U+202E in Namen, Pfaden oder Trefferzeilen vertauscht sonst die Anzeige.
function exact(text) {
  return exactNode(document, text);
}

// Externe Links nur zu festen Zieladressen dieser Datei - nie zu einem Wert aus Paket oder Speicher.
const EXTERNAL_LINKS = new Set([TOKEN_PAGE_URL]);
function externalLink(url, label) {
  if (!EXTERNAL_LINKS.has(url)) throw new Error("projects: Link nicht erlaubt");
  const a = h("a", { class: "pp-link" }, label);
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}

// Ohne globale DOM-Klassen (Node, HTMLElement): in Tests laufen die Module im Node-Realm mit jsdom-Dokument.
function isDomNode(value) {
  return value !== null && typeof value === "object" && typeof value.nodeType === "number";
}

function focusable(value) {
  return isDomNode(value) && typeof value.focus === "function" ? value : null;
}

function button(label, action, extra = {}) {
  const { dataset = {}, class: cls = "", ...rest } = extra;
  return h("button", { type: "button", class: `pp-btn ${cls}`.trim(), dataset: { pp: action, ...dataset }, ...rest }, label);
}

// ------------------------------------------------------------------ Anzeige-Helfer

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
let timeFormat = null;

export function formatTime(stamp) {
  if (typeof stamp !== "string" || !STAMP.test(stamp)) return "—";
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return stamp;
  try {
    timeFormat ??= new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
    return timeFormat.format(date);
  } catch (error) {
    if (error instanceof RangeError) return stamp;
    throw error;
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1048576).toFixed(1).replace(".", ",")} MB`;
}

function count(n, one, many) {
  return `${Number.isSafeInteger(n) ? n.toLocaleString("de-DE") : "?"} ${n === 1 ? one : many}`;
}

function shortRevision(revisionId) {
  return typeof revisionId === "string" ? revisionId.slice(0, 16) : "—";
}

function isInstalledApp() {
  const media = typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
  return media || window.navigator.standalone === true;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Einzeldatei (file://): Projekte deaktiviert (Vertrag 13); ohne IndexedDB gibt es keinen Projektspeicher.
// Ohne die CSP-Meta aus index.html (Vertrag 14) ebenfalls keine Projekte, egal unter welchem Protokoll: die Einzeldatei
// (build_single nimmt die Meta heraus) liegt auch auf Pages und liefe dort sonst mit Token und Paketen ohne CSP.
export function projectsAvailability(location, store, doc = globalThis.document) {
  if (location && location.protocol === "file:") return { enabled: false, reason: "file" };
  if (!hasCspMeta(doc)) return { enabled: false, reason: "no-csp" };
  if (!store) return { enabled: false, reason: "no-store" };
  return { enabled: true, reason: null };
}

// Steht eine Content-Security-Policy als <meta> im Kopf? Der Wert wird nicht ausgewertet: index.html traegt genau die
// Vertragsfassung (projects-ui-tests prueft sie), andere Seiten dieser App haben gar keine.
function hasCspMeta(doc) {
  if (!doc || typeof doc.querySelectorAll !== "function") return false;
  for (const meta of doc.querySelectorAll("head meta[http-equiv]")) {
    if (String(meta.getAttribute("http-equiv")).toLowerCase() === "content-security-policy") return true;
  }
  return false;
}

// Der Speicher fuehrt genau die aktive Revision mit derselben seq: ein Datei-Import ist damit bestaetigt.
function serverConfirms(record) {
  return record.serverStatus === "active" && isRecord(record.indexHead) && Boolean(record.activeRevision)
    && record.indexHead.revisionId === record.activeRevision && record.indexHead.seq === record.activeSeq;
}

// Kopf fuer die Karte: der aktive, ausser ein Import ist vom Speicher bestaetigt (dann zeigt die Karte dessen
// Speicher-Zeitpunkt). store.js behaelt den Import-Kopf; hier wird nur die Anzeige gewaehlt.
function displayHead(record) {
  const active = isRecord(record.activeHead) ? record.activeHead : null;
  if (active && active.committedAt === null && serverConfirms(record)) return record.indexHead;
  return active || (isRecord(record.indexHead) ? record.indexHead : null);
}

// Sync-Status je Projektkarte (Vertrag 13): genau einer von sechs, dazu Merkmale (Grabstein, fehlt, aelter, neuer,
// Konflikt). Der Konflikt (gleiche seq, andere Revision) folgt aus dem Datensatz - auch nach einem Neustart, bevor
// ein Abgleich gelaufen ist (Vertrag 10: Konflikt nie verstecken).
export function projectStatus(record, live, env) {
  const flags = [];
  if (record.serverStatus === "deleted") flags.push("deleted");
  if (record.serverStatus === "missing") flags.push("missing");
  const index = isRecord(record.indexHead) && Number.isSafeInteger(record.indexHead.seq) ? record.indexHead.seq : null;
  const active = Number.isSafeInteger(record.activeSeq) ? record.activeSeq : 0;
  if (record.activeRevision && index !== null && record.serverStatus === "active") {
    if (index < active) flags.push("older");
    else if (index > active) flags.push("newer");
    else if (typeof record.indexHead.revisionId === "string" && record.indexHead.revisionId !== record.activeRevision) flags.push("conflict");
  }
  if (live && live.state === "conflict" && !flags.includes("conflict")) flags.push("conflict");
  let primary;
  if (live && live.state === "loading") primary = "loading";
  else if (live && live.state === "failed") primary = "failed";
  else if (record.activeRevision) {
    if (isRecord(record.activeHead) && record.activeHead.committedAt === null && !serverConfirms(record)) primary = "imported";
    else primary = offlineReason(record, env) === null ? "offline" : "local";
  } else primary = "remote";
  return { primary, flags };
}

// "Offline verfuegbar" = App-Dateien vollstaendig im SW-Cache UND aktives Paket in IndexedDB, nur in der installierten
// App mit persisted() (Vertrag 13). Das aktive Paket gilt als vorhanden, wenn activeRevision gesetzt ist: store.js
// schreibt Paket und Zeiger in derselben Transaktion; beim Oeffnen wird es ohnehin erneut geprueft.
export function offlineReason(record, env) {
  if (!record.activeRevision) return "Paket noch nicht geladen";
  if (!env.appFilesComplete) return "App-Dateien nicht vollständig gespeichert";
  if (!env.installed) return "nicht als App installiert";
  if (env.persisted !== true) return "Speicher nicht geschützt";
  return null;
}

function failureText(live) {
  if (!live) return "";
  if (live.code === "package-invalid") return `${syncMessage("package-invalid")} ${live.check ? messageFor(live.check) : ""}`.trim();
  // Speicher voll: estimate() gehoert in die Meldung (Vertrag 13), damit klar ist, wie viel fehlt.
  const e = live.estimate;
  if (live.code === "store-quota" && e && Number.isFinite(e.usage) && Number.isFinite(e.quota)) {
    return `${syncMessage(live.code)} Belegt ${formatBytes(e.usage)} von ${formatBytes(e.quota)}.`;
  }
  return syncMessage(live.code);
}

function warningText(code) {
  return WARNING_TEXT.get(code) || "Unbekannter Hinweis (neuere Paketversion).";
}

function sourceStatusText(status) {
  return SOURCE_STATUS_LABELS.get(status) || "unbekannt";
}

// ------------------------------------------------------------------ Kontext als Text (Kopieren)

function endText(model, end, index) {
  if (!isRecord(end)) return "?";
  if (Object.hasOwn(end, "op")) return `${model.abs(end.op)}:${index}`;
  return `extern ${end.external}:${index}`;
}

function targetText(model, target) {
  if (!isRecord(target)) return "?";
  if (Object.hasOwn(target, "op")) return model.abs(target.op);
  if (Object.hasOwn(target, "external")) return `extern ${target.external}`;
  return `nicht aufgelöst (${target.unresolved})`;
}

function referenceLine(model, ref) {
  const where = ref.from.par !== null ? `.${ref.from.par}` : ref.from.line !== null ? ` Zeile ${ref.from.line}` : "";
  return `${model.abs(ref.from.op)}${where} ${ref.kind} → ${targetText(model, ref.target)} [${ref.certainty}]`;
}

// Pfad, Revision und belegte Beziehungen (Leitungen, Verweise mit Gewissheit) - genau das, was das Paket belegt.
export function contextText(model, focus = {}) {
  const lines = [
    `CodeSearch Pocket · statische Momentaufnahme vom ${model.exportedAt} (keine TD-Ausführung, kein Laufzeitzustand)`,
    `Projekt: ${model.projectName}`,
    `Revision: ${model.revisionId}`,
    `Root: ${model.root}`,
  ];
  const limit = 40;
  const add = (title, items) => {
    if (!items.length) return;
    lines.push(`${title}:`);
    for (const item of items.slice(0, limit)) lines.push(`  ${item}`);
    if (items.length > limit) lines.push(`  … und ${items.length - limit} weitere`);
  };
  const rel = typeof focus.rel === "string" && model.has(focus.rel) ? focus.rel : null;
  if (rel !== null) {
    const o = model.op(rel);
    lines.push(`Op: ${model.abs(rel)} (${o.opType}, ${o.family})`);
    add("Leitungen hinein", model.inputs(rel).map((c) => `${endText(model, c.from, c.fromIndex)} → ${endText(model, c.to, c.toIndex)} (${c.kind})`));
    add("Leitungen hinaus", model.outputs(rel).map((c) => `${endText(model, c.from, c.fromIndex)} → ${endText(model, c.to, c.toIndex)} (${c.kind})`));
    add("Verweise von hier", model.referencesFrom(rel).map((r) => referenceLine(model, r)));
    add("Verweise hierher", model.referencesTo(rel).map((r) => referenceLine(model, r)));
  }
  const key = typeof focus.source === "string" ? focus.source : null;
  const source = key !== null ? model.source(key) : null;
  if (source) {
    const line = Number.isSafeInteger(focus.line) ? ` Zeile ${focus.line}` : "";
    lines.push(`Quelle: ${model.abs(key)}${line} (${source.language}, ${source.status})`);
    if (rel === null) add("Verweise aus der Quelle", model.referencesInSource(key).map((r) => referenceLine(model, r)));
  }
  if (rel === null && !source) {
    const counts = model.doc.report.counts;
    lines.push(`Umfang: ${counts.operators} Ops, ${counts.connections} Leitungen, ${counts.codeSources} Code-Quellen, ${counts.references} Verweise, ${counts.external} extern`);
    add("Externe Abhängigkeiten", model.externalDependencies().map((d) => `${d.path} (${d.kinds.join(", ")}, ${d.count}×)`));
  }
  return lines.join("\n");
}

// ------------------------------------------------------------------ Ansichtszustand (je Projekt im Store uistate)

function defaultViews() {
  return {
    overview: { scrollTop: 0 },
    hierarchy: { scrollTop: 0, expanded: [""], filter: "" },
    // zoom/panX/panY null = einpassen (project-views.js); Zahlen nur als vollstaendiges Trio.
    network: { comp: "", selected: null, zoom: null, panX: null, panY: null },
    code: { source: null, line: null, scrollTop: 0, find: "" },
    search: { scrollTop: 0, query: "", kinds: ["name", "path", "method", "code", "parameter"] },
    lastOpened: null,
  };
}

function finiteOr(value, fallback, min = -Infinity, max = Infinity) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

// Zoom und Verschiebung nur als vollstaendiges Zahlen-Trio (Grenzen wie project-netmath NET_ZOOM), sonst einpassen.
function viewTrio(value) {
  const ok = isRecord(value) && typeof value.zoom === "number" && Number.isFinite(value.zoom) && value.zoom > 0
    && typeof value.panX === "number" && Number.isFinite(value.panX) && typeof value.panY === "number" && Number.isFinite(value.panY);
  return ok ? { zoom: Math.min(8, Math.max(0.01, value.zoom)), panX: value.panX, panY: value.panY } : { zoom: null, panX: null, panY: null };
}
const FIT = Object.freeze({ zoom: null, panX: null, panY: null });

// Gespeicherter Zustand liegt in der geteilten Origin (Vertrag 15): nur Bekanntes, Typgerechtes, im Modell Vorhandenes.
function restoreViews(saved, model) {
  const views = defaultViews();
  if (!isRecord(saved) || saved.revisionId !== model.revisionId) return views;
  const comp = (rel) => typeof rel === "string" && model.has(rel) && model.op(rel).isCOMP;
  const op = (rel) => typeof rel === "string" && model.has(rel);
  const src = (key) => typeof key === "string" && model.source(key) !== null;
  const text = (value, max) => (typeof value === "string" && value.length <= max ? value : "");
  if (isRecord(saved.overview)) views.overview.scrollTop = finiteOr(saved.overview.scrollTop, 0, 0);
  if (isRecord(saved.hierarchy)) {
    views.hierarchy.scrollTop = finiteOr(saved.hierarchy.scrollTop, 0, 0);
    views.hierarchy.filter = text(saved.hierarchy.filter, 200);
    if (Array.isArray(saved.hierarchy.expanded)) views.hierarchy.expanded = [...new Set(saved.hierarchy.expanded.filter(comp))].slice(0, 500);
  }
  if (isRecord(saved.network)) {
    const n = saved.network;
    if (comp(n.comp)) views.network.comp = n.comp;
    views.network.selected = op(n.selected) ? n.selected : null;
    Object.assign(views.network, viewTrio(n));
  }
  if (isRecord(saved.code) && src(saved.code.source)) {
    views.code.source = saved.code.source;
    views.code.line = Number.isSafeInteger(saved.code.line) && saved.code.line >= 1 ? saved.code.line : null;
    views.code.scrollTop = finiteOr(saved.code.scrollTop, 0, 0);
    views.code.find = text(saved.code.find, SEARCH_LIMITS.maxQuery);
  }
  if (isRecord(saved.search)) {
    views.search.scrollTop = finiteOr(saved.search.scrollTop, 0, 0);
    views.search.query = text(saved.search.query, SEARCH_LIMITS.maxQuery);
    if (Array.isArray(saved.search.kinds)) {
      const kinds = saved.search.kinds.filter((k) => SEARCH_KINDS.includes(k));
      if (kinds.length) views.search.kinds = [...new Set(kinds)];
    }
  }
  const last = saved.lastOpened;
  if (isRecord(last)) {
    if (last.kind === "code" && src(last.source)) {
      views.lastOpened = { kind: "code", source: last.source, line: Number.isSafeInteger(last.line) && last.line >= 1 ? last.line : null };
    } else if (last.kind === "network" && comp(last.comp)) {
      views.lastOpened = { kind: "network", comp: last.comp };
    }
  }
  return views;
}

// ------------------------------------------------------------------ Navigationseintraege (history.state)

// Eintrag aus history.state pruefen: der Verlauf kann Reste aelterer App-Versionen tragen.
export function cleanEntry(raw) {
  if (!isRecord(raw)) return null;
  if (raw.page === "list") return { page: "list" };
  if (raw.page !== "project" || typeof raw.projectId !== "string" || !PATTERNS.projectId.test(raw.projectId)) return { page: "list" };
  const tab = TABS.includes(raw.tab) ? raw.tab : "overview";
  return { page: "project", projectId: raw.projectId, tab, sheet: cleanSheet(raw.sheet) };
}

function cleanSheet(sheet) {
  if (!isRecord(sheet)) return null;
  if (sheet.kind === "notes") return { kind: "notes" };
  if (sheet.kind === "details" && typeof sheet.rel === "string") return { kind: "details", rel: sheet.rel };
  if (sheet.kind === "understand" && isRecord(sheet.target)) {
    const t = sheet.target;
    if (typeof t.op === "string") return { kind: "understand", target: { op: t.op } };
    if (typeof t.source === "string" && typeof t.symbol === "string") return { kind: "understand", target: { source: t.source, symbol: t.symbol } };
  }
  return null;
}

function entryKey(entry) {
  return JSON.stringify(entry || null);
}

// ------------------------------------------------------------------ Die Ebene

export class ProjectsShell {
  // host = App-Kontext (gelesen: offline; geschrieben: layers.projects; render()). nav = Navigation aus app.js.
  constructor({ host, layer, nav, location = globalThis.location, deps = platform }) {
    this.host = host;
    this.layer = layer;
    this.nav = nav;
    this.deps = deps;
    this.store = null;
    this.availability = { enabled: false, reason: "no-store" };
    this.location = location;
    this.entry = null;
    this.records = [];
    this.recordsLoaded = false;
    this.listError = null;
    this.tokenInfo = { present: false };
    this.env = { installed: false, persisted: null, estimate: null, supported: false, appFilesComplete: false };
    this.orphanNotes = 0;
    this.orphanList = [];
    this.removedRows = [];
    this.notice = null;
    this.dialog = null;
    this.model = null;
    this.modelState = { status: "idle", projectId: null, error: null };
    this.views = defaultViews();
    this._models = new Map();
    this._modelInfo = new WeakMap();
    this._pendingFocus = null;
    this._loadToken = 0;
    this._handles = new Map();
    this._sheetHandle = null;
    this._keys = new WeakMap();
    this._saveTimer = null;
    this._dialogReturn = null;
    this._sheetReturn = null;
    this._openReturn = null;
    this._listVersion = 0;
    this._accessVersion = 0;
    this._notesVersion = 0;
    this._started = false;
    this._build();
  }

  // ---------------------------------------------------------------- Aufbau und Start

  _build() {
    this.dom = {
      head: h("div", { class: "lhead pp-head" }),
      notice: h("div", { class: "pp-notices", role: "status", "aria-live": "polite" }),
      tabs: h("div", { class: "ltabs pp-tabs", role: "tablist", "aria-label": "Projekt-Ansichten" }),
      body: h("div", { class: "lbody pp-body", id: "pp-tabpanel", tabindex: "-1" }),
      sheet: h("div", { class: "pp-sheet-wrap", hidden: true }),
      dialog: h("div", { class: "pp-dialog-wrap", hidden: true }),
      main: null,
    };
    this.dom.main = h("div", { class: "pp-main" }, this.dom.head, this.dom.notice, this.dom.tabs, this.dom.body, this.dom.sheet);
    this.layer.replaceChildren(this.dom.main, this.dom.dialog);
    this.layer.addEventListener("click", (event) => this._onClick(event));
    this.layer.addEventListener("change", (event) => this._onChange(event));
    this.layer.addEventListener("keydown", (event) => this._onKeydown(event));
    this.dom.body.addEventListener("scroll", () => this._onBodyScroll(), { passive: true });
  }

  start() {
    if (this._started) return;
    this._started = true;
    // Vor jedem Speicherzugriff: Einzeldatei (file://) und Seiten ohne CSP-Meta oeffnen IndexedDB gar nicht erst.
    if ((this.location && this.location.protocol === "file:") || !hasCspMeta(document)) {
      this.availability = projectsAvailability(this.location, null);
      return;
    }
    this.store = this.deps.createStore();
    this.availability = projectsAvailability(this.location, this.store);
    if (!this.availability.enabled) return;
    this.sync = new SyncController({
      store: this.store, fetch: this.deps.fetch, now: this.deps.now, sleep: this.deps.sleep || undefined,
      online: this.deps.online, retryDelaysMs: this.deps.retryDelaysMs,
    }, {
      onChange: (event) => this._onSyncEvent(event),
      setTimer: this.deps.setTimer, clearTimer: this.deps.clearTimer,
      debounceMs: this.deps.debounceMs, minIntervalMs: this.deps.minIntervalMs,
    });
    this._startup = this._initialLoad();
  }

  async _initialLoad() {
    try {
      // Verwaiste Pakete/Metadaten (Abbruch zwischen Schritten) beim Start aufraeumen (Vertrag 13).
      await this.store.cleanup();
    } catch (error) {
      this._storeProblem(error);
    }
    const installed = isInstalledApp();
    let persistence = { supported: false, persisted: null };
    try {
      // persist() nur in der installierten App anfragen (Vertrag 13); im Tab nur nachsehen.
      persistence = await storagePersistence({ request: installed });
    } catch (error) {
      if (!(error instanceof TypeError || error instanceof DOMException)) throw error;
    }
    this.env = { ...this.env, installed, persisted: persistence.persisted, supported: persistence.supported };
    await this._refreshEnv();
    await this.refreshList();
    await this._refreshToken();
  }

  // Fertig mit dem ersten Laden (Speicher aufgeraeumt, Liste und Zugang gelesen) - app.js loest danach "start" aus.
  ready() {
    return this._startup || Promise.resolve();
  }

  // Ausloeser aus app.js (start, visible, online) und vom Nutzer (manual). Ohne Token haben automatische Ausloeser
  // nichts zu tun: kein Lauf, kein Flackern der Statuszeile.
  requestSync(trigger, options = {}) {
    if (!this.sync) return Promise.resolve(null);
    if (trigger !== "manual" && !this.tokenInfo.present) return Promise.resolve(null);
    // Nach 401/403 angehalten (Vertrag 12): automatische Ausloeser fragen nicht mit dem abgelehnten Token. sync.js
    // prueft denselben Halt noch einmal (auch nach einem Neustart); hier spart es Lauf und Statuszeilen-Flackern.
    if (trigger !== "manual" && this.tokenInfo.authFailedAt) return Promise.resolve(null);
    return this.sync.request(trigger, options);
  }

  get isOpen() {
    return this.entry !== null;
  }

  // ---------------------------------------------------------------- Navigation (app.js ruft apply)

  // Eintrag aus history anwenden (popstate, Start mit gemerktem Zustand, nach push). null = Ebene zu.
  apply(rawEntry) {
    const entry = rawEntry === null ? null : cleanEntry(rawEntry);
    const wasOpen = this.entry !== null;
    const previous = this.entry;
    this.entry = entry;
    this.dialog = null;
    if (entry === null) {
      this._closeViews();
      this.host.layers.projects = false;
    } else {
      this.host.layers.projects = true;
      if (!wasOpen) {
        // Safari fokussiert Knoepfe beim Tippen nicht: steht der Fokus auf body, geht er spaeter an PROJEKTE zurueck.
        const active = focusable(document.activeElement);
        this._openReturn = active && active !== document.body ? active : null;
      }
      if (entry.page === "project" && this.availability.enabled) this._ensureModel(entry.projectId);
      if (entry.page === "list" && previous && previous.page === "project") this._closeViews();
      if (entry.page === "list") this.refreshList();
    }
    // Fokus erst setzen, wenn app.js den Hintergrund (in)aktiv geschaltet hat: in ein inertes Gebiet laesst der
    // Browser keinen Fokus. renderFromHost() fuehrt das aus (app.js ruft es in renderAll nach den inert-Regeln).
    if (!wasOpen && entry !== null) this._pendingFocus = "title";
    if (wasOpen && entry === null) this._pendingFocus = "restore";
    this.render();
    this.host.render();
  }

  // Aus app.js (renderAll): zeichnen, danach einen ausstehenden Fokuswechsel ausfuehren.
  renderFromHost() {
    this.render();
    const pending = this._pendingFocus;
    this._pendingFocus = null;
    if (pending === "title" && this.isOpen) this._focusTitle();
    else if (pending === "restore" && !this.isOpen) this._restoreFocus();
  }

  _push(entry) {
    this.nav.push(entry);
    this.apply(entry);
  }

  openLayer() {
    if (this.isOpen) return;
    this._push({ page: "list" });
  }

  close() {
    if (!this.isOpen) return;
    this.nav.close();
  }

  // Esc: erst ein offenes Menue/Fenster, dann ein Blatt, sonst die ganze Ebene (Vertrag: Esc schliesst die Ebene).
  escape() {
    if (this.dialog) {
      this._closeDialog();
      return;
    }
    if (this.entry && this.entry.page === "project" && this.entry.sheet) {
      this.nav.back();
      return;
    }
    this.close();
  }

  _focusTitle() {
    const title = this.layer.querySelector("#pp-title");
    if (title) title.focus({ preventScroll: true });
  }

  _restoreFocus() {
    const target = this._openReturn && this._openReturn.isConnected ? this._openReturn : document.getElementById("btn-projects");
    this._openReturn = null;
    if (target && typeof target.focus === "function") target.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- Daten laden

  // removed:false fuer die Projekt-Ereignisse eines laufenden Abgleichs: die Liste "Lokal entfernt" kostet je
  // Index-Eintrag eine Leseanfrage und aendert sich erst mit dem Ende des Laufs (oder durch den Nutzer).
  async refreshList({ removed = true } = {}) {
    if (!this.store) return;
    try {
      this.records = await this.store.listProjects();
      this.recordsLoaded = true;
      this.listError = null;
      if (removed) this.removedRows = await listLocallyRemoved(this.store);
      const orphans = await this.store.listOrphanNotes();
      // Neueste zuerst; bei gleicher Zeit nach ID (stabile Reihenfolge).
      orphans.sort((a, b) => (a.updatedAt !== b.updatedAt ? (a.updatedAt < b.updatedAt ? 1 : -1) : (a.id < b.id ? -1 : 1)));
      const signature = orphans.map((n) => `${n.id}|${n.updatedAt}`).join("\n");
      // Notizen nur neu zeichnen, wenn sich dort etwas aendert: sonst baute jedes Abgleich-Ereignis ein offenes
      // Notizen-Blatt (Scrollstand) und die Datei-Auswahl "Notizen laden" neu.
      if (signature !== this._orphanSignature) {
        this._orphanSignature = signature;
        this.orphanList = orphans;
        this.orphanNotes = orphans.length;
        this._notesVersion += 1;
      }
    } catch (error) {
      // Noch nie geladen (IndexedDB laesst sich nicht oeffnen, z. B. gesperrter Website-Speicher): die Liste sagt das,
      // statt dauerhaft "Lade Projekte …" zu zeigen. Der naechste erfolgreiche Lauf nimmt den Zustand zurueck.
      if (error instanceof StoreError && !this.recordsLoaded) this.listError = error;
      this._storeProblem(error);
    }
    this._listVersion += 1;
    this.render();
  }

  async _refreshToken() {
    if (!this.store) return;
    try {
      this.tokenInfo = await readTokenInfo(this.store);
    } catch (error) {
      this._storeProblem(error);
    }
    this._accessVersion += 1;
    // Auch die Projektliste haengt am Zugang (Statuszeile mit 401-Halt, ⟳, "Speicherstand laden" auf den Karten).
    this._listVersion += 1;
    this.render();
  }

  async _refreshEnv() {
    let estimate = null;
    if (this.store) estimate = await this.store.estimate();
    this.env = { ...this.env, installed: isInstalledApp(), estimate };
    this._accessVersion += 1;
  }

  // App-Dateien und Installation live lesen: der SW-Cache wird oft erst nach dem Start vollstaendig.
  _liveEnv() {
    const offline = this.host.offline || {};
    const appFilesComplete = Boolean(offline.manifest && Array.isArray(offline.manifest.files) && offline.cached === offline.manifest.files.length);
    return { ...this.env, appFilesComplete, installed: isInstalledApp() };
  }

  _storeProblem(error) {
    if (!(error instanceof StoreError)) throw error;
    this.notice = { kind: "error", text: error.message, action: reloadAction(error.detail && error.detail.reload) };
    this.render();
  }

  _record(projectId) {
    return this.records.find((r) => r.projectId === projectId) || null;
  }

  _onSyncEvent(event) {
    if (event.type === "finish") {
      const result = event.result || {};
      // "offline" meldet schon der Offline-Hinweis oben; Abbruch ist eine Information, kein Fehler.
      const quiet = new Set(["ok", "not-modified", "no-token", "offline"]);
      const kind = result.state === "aborted" ? "info" : "error";
      this.notice = quiet.has(result.state) ? null
        : { kind, text: syncMessage(result.state), state: result.state, action: reloadAction(result.reload) };
      this.refreshList();
      // Halt nach 401/403 setzt oder loest sync.js am Token-Datensatz: die Anzeige (und requestSync) zieht nach.
      if (result.state === "auth" || this.tokenInfo.authFailedAt) this._refreshToken();
      this._checkNewRevision();
    } else if (event.type === "project") {
      // Auch bei "loading": markServerState hat fuer neue Serverprojekte gerade erst den Datensatz angelegt.
      this.refreshList({ removed: false });
    }
    this._listVersion += 1;
    this.render();
  }

  _checkNewRevision() {
    if (!this.model || !this.entry || this.entry.page !== "project") return;
    const record = this._record(this.model.projectId);
    if (record && record.activeRevision && record.activeRevision !== this.model.revisionId) this.render();
  }

  async _ensureModel(projectId, { reload = false } = {}) {
    if (!reload && this.model && this.model.projectId === projectId && this.modelState.status === "ready") return;
    const token = ++this._loadToken;
    this._closeViews();
    this.model = null;
    this.modelState = { status: "loading", projectId, error: null };
    this.render();
    let pkg;
    try {
      pkg = await this.store.getActivePackage(projectId);
    } catch (error) {
      if (!(error instanceof StoreError)) throw error;
      if (token === this._loadToken) this._modelFailed(projectId, "store", error.message, Boolean(error.detail && error.detail.reload));
      return;
    }
    if (token !== this._loadToken) return;
    if (!pkg) {
      this._modelFailed(projectId, "not-loaded", "Für dieses Projekt liegt noch kein Paket auf dem Gerät.");
      return;
    }
    const { project } = pkg;
    const cacheKey = `${projectId}\n${project.activeRevision}`;
    let model = this._models.get(cacheKey) || null;
    if (!model) {
      // Pakete in IndexedDB werden beim Oeffnen erneut geprueft (geteilte Origin, Vertrag 5 und 15).
      const verified = await verifyStored(pkg.bytes, { projectId, revisionId: project.activeRevision, seq: project.activeSeq });
      if (token !== this._loadToken) return;
      if (!verified.ok) {
        this._modelFailed(projectId, "stored-invalid", `Gespeichertes Paket besteht die Prüfung nicht: ${packageProblemText(verified.errors)}`);
        return;
      }
      model = createModel(verified);
      // Unbekannte Felder (neuere Minor-Version) werden ignoriert und in der Uebersicht genannt (Vertrag 4.1).
      this._modelInfo.set(model, { unknownFields: verified.unknownFields.length });
      this._models.set(cacheKey, model);
      while (this._models.size > MAX_MODELS) this._models.delete(this._models.keys().next().value);
    }
    let saved = null;
    try {
      saved = await this.store.getUiState(UI_KEY_PREFIX + projectId);
    } catch (error) {
      if (!(error instanceof StoreError)) throw error;
    }
    if (token !== this._loadToken) return;
    this.model = model;
    this.views = restoreViews(saved, model);
    this.modelState = { status: "ready", projectId, error: null };
    this._bodyKey = null;
    this.render();
  }

  // reload: der Speicher braucht einen Neustart der Seite (store.js nach "connection lost" trotz Neuoeffnen).
  _modelFailed(projectId, code, text, reload = false) {
    this.model = null;
    this.modelState = { status: "error", projectId, error: { code, text, reload } };
    this.render();
  }

  // ---------------------------------------------------------------- Zeichnen

  // Teilbereich nur neu bauen, wenn sich sein Schluessel aendert: Eingaben, Fokus und Scrollstand bleiben sonst stehen.
  _patch(container, key, build) {
    if (this._keys.get(container) === key) return false;
    const focused = document.activeElement && container.contains(document.activeElement) ? document.activeElement.dataset.ppFocus : null;
    this._keys.set(container, key);
    const content = build();
    container.replaceChildren(...(Array.isArray(content) ? content : [content]).filter(Boolean));
    if (focused) {
      const again = [...container.querySelectorAll("[data-pp-focus]")].find((el) => el.dataset.ppFocus === focused);
      if (again) again.focus({ preventScroll: true });
    }
    return true;
  }

  render() {
    const open = this.entry !== null;
    this.layer.classList.toggle("show", open);
    this.layer.setAttribute("aria-hidden", open ? "false" : "true");
    if (!open) return;
    this._renderHead();
    this._renderNotice();
    this._renderTabs();
    this._renderBody();
    this._renderSheet();
    this._renderDialog();
  }

  _title() {
    if (!this.availability.enabled || this.entry.page === "list") return "PROJEKTE";
    const record = this._record(this.entry.projectId);
    if (record) return projectDisplayName(record);
    return this.model ? this.model.projectName : "Projekt";
  }

  _renderHead() {
    const project = this.entry.page === "project" && this.availability.enabled;
    const running = Boolean(this.sync && this.sync.running);
    const key = entryKey([this.entry.page, this._title(), running, this.availability.enabled, this.tokenInfo.present, project && this.modelState.status]);
    this._patch(this.dom.head, key, () => {
      const parts = [];
      if (project) parts.push(button("‹ Liste", "up", { "aria-label": "Zurück zur Projektliste", dataset: { ppFocus: "up" } }));
      parts.push(h("h1", { id: "pp-title", tabindex: "-1" }, exact(this._title())));
      if (project && this.modelState.status === "ready") {
        parts.push(button("NOTIZEN", "notes", { dataset: { ppFocus: "notes" }, "aria-haspopup": "dialog" }));
        parts.push(button("Kontext kopieren", "copy-context", { dataset: { ppFocus: "copy" } }));
      }
      if (!project && this.availability.enabled && this.tokenInfo.present) {
        parts.push(running
          ? button("Abbrechen", "cancel-sync", { dataset: { ppFocus: "sync" } })
          : button("⟳ Aktualisieren", "sync", { dataset: { ppFocus: "sync" } }));
      }
      parts.push(button("✕", "close", { "aria-label": "Projekte schließen", dataset: { ppFocus: "close" } }));
      return parts;
    });
    this.layer.setAttribute("aria-labelledby", "pp-title");
  }

  _renderNotice() {
    const items = [];
    if (this.availability.enabled && !platformOnline(this.deps)) {
      items.push({ kind: "info", text: "Offline: lokale Projekte bleiben lesbar; abgeglichen wird erst wieder mit Netz." });
    }
    if (this.notice) items.push(this.notice);
    if (this.entry.page === "project" && this.model) {
      const record = this._record(this.model.projectId);
      if (record && record.activeRevision && record.activeRevision !== this.model.revisionId) {
        items.push({ kind: "info", text: "Neue Revision ist geladen.", action: ["Neue Revision öffnen", "open-new-revision"] });
      }
      if (record && record.serverStatus === "deleted") items.push({ kind: "warn", text: "Auf dem Speicher gelöscht (Grabstein). Diese lokale Kopie bleibt, bis du sie löschst." });
      if (record && record.serverStatus === "missing") items.push({ kind: "warn", text: "Nicht mehr auf dem Speicher. Diese lokale Kopie bleibt, bis du sie löschst." });
    }
    const key = entryKey(items.map((i) => [i.kind, i.text, i.action || null]));
    this._patch(this.dom.notice, key, () => items.map((item) => h("p", { class: `pp-notice pp-notice-${item.kind}` },
      item.text, item.action ? button(item.action[0], item.action[1], { class: "pp-inline" }) : null)));
  }

  _renderTabs() {
    const project = this.entry.page === "project" && this.availability.enabled;
    this.dom.tabs.hidden = !project;
    // Der Koerper ist nur auf der Projektseite das tabpanel der Tabs; die Liste ist ein gewoehnlicher Bereich.
    if (project) {
      this.dom.body.setAttribute("role", "tabpanel");
      this.dom.body.setAttribute("aria-labelledby", `pp-tab-${this.entry.tab}`);
    } else {
      this.dom.body.removeAttribute("role");
      this.dom.body.removeAttribute("aria-labelledby");
    }
    const key = project ? `${this.entry.tab}` : "";
    // Roving tabindex: nur der gewaehlte Tab liegt in der Tab-Reihenfolge, die Pfeiltasten wandern (_onKeydown).
    this._patch(this.dom.tabs, key, () => (project ? TABS.map((tab) => h("button", {
      type: "button", class: `chip pp-tab${tab === this.entry.tab ? " on" : ""}`, role: "tab", id: `pp-tab-${tab}`,
      "aria-controls": this.dom.body.id, tabindex: tab === this.entry.tab ? "0" : "-1",
      "aria-selected": tab === this.entry.tab ? "true" : "false", dataset: { pp: "tab", tab, ppFocus: `tab-${tab}` },
    }, TAB_LABELS.get(tab))) : []));
  }

  _renderBody() {
    if (!this.availability.enabled) {
      this._patch(this.dom.body, `off:${this.availability.reason}`, () => this._disabledBody());
      return;
    }
    if (this.entry.page === "list") {
      this.dom.body.classList.remove("pp-body-full");
      const env = this._liveEnv();
      const envKey = `${env.appFilesComplete}|${env.installed}|${env.persisted}`;
      const key = `list:${this._listVersion}:${this._accessVersion}:${this._notesVersion}:${envKey}`;
      let top = this.dom.body.scrollTop;
      if (this._bodyPage !== "list") {
        this._bodyPage = "list";
        this._listDom = null;
        top = this._listScroll || 0;
      }
      if (!this._listDom) {
        this._listDom = { projects: h("section", { class: "pp-section", "aria-labelledby": "pp-h-projects" }),
          access: h("section", { class: "pp-section", "aria-labelledby": "pp-h-access" }),
          files: h("section", { class: "pp-section", "aria-labelledby": "pp-h-import" }),
          notes: h("section", { class: "pp-section", "aria-labelledby": "pp-h-notes" }) };
        this._keys.delete(this.dom.body);
        this._patch(this.dom.body, "list-frame", () => [this._listDom.projects, this._listDom.access, this._listDom.files, this._listDom.notes]);
        this._bodyKey = null;
      }
      if (this._bodyKey !== key) {
        this._bodyKey = key;
        this._patch(this._listDom.projects, `p:${this._listVersion}:${envKey}`, () => this._projectsSection());
        this._patch(this._listDom.access, `a:${this._accessVersion}`, () => this._accessSection());
        this._patch(this._listDom.files, "f", () => this._importSection());
        this._patch(this._listDom.notes, `n:${this._notesVersion}`, () => this._notesSection());
        this.dom.body.scrollTop = top;
      }
      return;
    }
    this._bodyPage = "project";
    this._listDom = null;
    const state = this.modelState;
    const key = `project:${this.entry.projectId}:${state.status}:${this.model ? this.model.revisionId : ""}:${this.entry.tab}`;
    // NETZ und CODE scrollen selbst (project-views.js): dort fuellt die Ansicht die Flaeche ohne eigenen Rand.
    const full = state.status === "ready" && (this.entry.tab === "network" || this.entry.tab === "code");
    this.dom.body.classList.toggle("pp-body-full", full);
    if (this._bodyKey === key) return;
    this._bodyKey = key;
    this._closeTabViews();
    this._keys.delete(this.dom.body);
    this._patch(this.dom.body, key, () => {
      if (state.status === "loading" || state.projectId !== this.entry.projectId) return h("p", { class: "pp-empty" }, "Projekt wird geprüft …");
      if (state.status === "error") return this._modelErrorBody(state.error);
      return this._tabBody(this.entry.tab);
    });
    this._restoreScroll(this.entry.tab);
    this._mountTabView(this.entry.tab);
  }

  _disabledBody() {
    if (this.availability.reason === "file" || this.availability.reason === "no-csp") {
      return h("div", { class: "pp-section" },
        h("h2", {}, "Projekte sind hier deaktiviert"),
        h("p", {}, this.availability.reason === "file"
          ? "In der Einzeldatei (file://) gibt es keine Projekte: kein dauerhafter Speicher, kein Abgleich."
          : "Diese Seite läuft ohne Content Security Policy (die Einzeldatei CodeSearch-Pocket-offline.html, auch über https): darum keine Projekte, kein Token, kein Abgleich."),
        h("p", {}, "Projekte liest du in der installierten App: tombkn.github.io/codesearch-pocket, auf dem iPhone über Teilen → Zum Home-Bildschirm."));
    }
    return h("div", { class: "pp-section" },
      h("h2", {}, "Projektspeicher nicht verfügbar"),
      h("p", {}, "Dieser Browser stellt hier kein IndexedDB bereit (z. B. privates Fenster). Ohne Speicher gibt es keine Projekte."));
  }

  _modelErrorBody(error) {
    // Ein lokal veraendertes Paket bleibt in IndexedDB liegen (erste Fassung gewinnt): neu laden heisst hier erst
    // lokal entfernen (Notizen bleiben), dann vom Speicher holen.
    const stored = error.code === "stored-invalid";
    const record = this._record(this.entry.projectId);
    const onServer = Boolean(record && record.serverStatus === "active");
    let action = button(error.code === "not-loaded" ? "Jetzt laden" : "Vom Speicher neu laden", "refresh-project", { dataset: { project: this.entry.projectId } });
    // Verbindung zum Speicher verloren, auch nach dem Neuoeffnen: nur ein Neustart der Seite hilft (Vertrag 13
    // "kontrolliert neu laden"). Die installierte App hat keinen Neu-laden-Knopf des Browsers.
    if (error.reload) action = button(...reloadAction(true), { class: "pp-primary" });
    else if (stored) {
      // Nur neu laden, wenn der Speicher das Projekt noch hat - sonst waere die (unlesbare) Kopie ersatzlos weg.
      action = onServer
        ? button("Lokal entfernen und neu laden", "reload-stored", { dataset: { project: this.entry.projectId } })
        : button("Lokal löschen …", "menu-delete", { dataset: { project: this.entry.projectId } });
    }
    return h("div", { class: "pp-section", role: "alert" },
      h("h2", {}, error.code === "not-loaded" ? "Noch nicht geladen" : "Projekt lässt sich nicht öffnen"),
      h("p", {}, error.text),
      stored && !onServer ? h("p", { class: "pp-muted" }, "Auf dem Speicher ist dieses Projekt nicht mehr verfügbar; die lokale Kopie ist nicht lesbar.") : null,
      h("div", { class: "pp-actions" }, action, button("Zur Liste", "up")));
  }

  // ---------------------------------------------------------------- Liste "My Pocket Projects"

  _projectsSection() {
    const running = Boolean(this.sync && this.sync.running);
    const last = this.sync && this.sync.lastResult;
    const parts = [h("h2", { id: "pp-h-projects" }, "My Pocket Projects")];
    const status = [];
    if (running) status.push("Abgleich läuft …");
    else if (last && last.checkedAt) status.push(`Zuletzt geprüft: ${formatTime(last.checkedAt)} · ${syncMessage(last.state)}`);
    else if (!this.tokenInfo.present) status.push("Ohne Zugang nur lokale Projekte (Datei-Import).");
    else if (this.tokenInfo.authFailedAt) status.push(`${syncMessage("auth")} Abgleich angehalten bis „Zugang prüfen“ oder ⟳.`);
    status.push("Abgleich nur, solange Pocket offen ist: beim Start, beim Zurückkehren, wenn das Netz wiederkommt oder mit ⟳.");
    parts.push(h("p", { class: "pp-muted" }, status.join(" ")));
    if (!this.recordsLoaded && this.listError) {
      parts.push(h("div", { class: "pp-empty", role: "alert" },
        h("p", {}, "Projektspeicher nicht verfügbar."),
        h("p", {}, `${this.listError.message} Ohne Speicher lassen sich keine Projekte lesen oder importieren.`)));
      return parts;
    }
    if (!this.recordsLoaded) {
      parts.push(h("p", { class: "pp-empty" }, "Lade Projekte …"));
      return parts;
    }
    if (!this.records.length) {
      parts.push(h("div", { class: "pp-empty" },
        h("p", {}, "Noch keine Projekte."),
        h("p", {}, "Am PC in CodeSearch: COMP-Menü → SEND TO POCKET … Danach hier Zugang einrichten oder eine Paket-Datei importieren.")));
      parts.push(this._removedPart());
      return parts;
    }
    // Zuletzt aktualisierte zuerst; bei gleicher Zeit nach Name, dann nach ID (stabile Reihenfolge).
    const sorted = [...this.records].sort((a, b) => {
      const ta = this._recordTime(a) || "";
      const tb = this._recordTime(b) || "";
      if (ta !== tb) return ta < tb ? 1 : -1;
      const na = projectDisplayName(a);
      const nb = projectDisplayName(b);
      if (na !== nb) return na < nb ? -1 : 1;
      return a.projectId < b.projectId ? -1 : 1;
    });
    parts.push(h("div", { class: "pp-cards" }, sorted.map((record, i) => this._card(record, i))));
    parts.push(this._removedPart());
    return parts;
  }

  // Lokal geloescht, auf dem Speicher noch aktiv (Vertrag 13: "nicht automatisch laden" - manuell schon). Name und
  // Stand kommen aus dem gemerkten Index-Kopf und gehen nur als Text ins DOM.
  _removedPart() {
    if (!this.removedRows.length) return null;
    const shown = this.removedRows.slice(0, MAX_LIST_ITEMS);
    return h("div", { class: "pp-removed", role: "group", "aria-labelledby": "pp-h-removed" },
      h("h3", { id: "pp-h-removed" }, "Lokal entfernt (nicht automatisch geladen)"),
      h("p", { class: "pp-muted" }, "Auf diesem Gerät gelöscht, auf dem Speicher noch vorhanden. Pocket lädt sie nur auf deinen Wunsch."),
      h("ul", { class: "pp-list" }, shown.map(({ projectId, head }) => h("li", { class: "pp-removed-row" },
        h("span", { class: "pp-removed-text" },
          h("span", { class: "pp-removed-name" }, exact(head.projectName)),
          h("span", { class: "pp-muted" }, `${head.rootPath} · Stand ${head.seq} · ${formatTime(head.committedAt)}`)),
        button("Wieder laden", "restore-removed", {
          "aria-label": `Wieder laden: ${head.projectName}`, dataset: { project: projectId, ppFocus: `restore-${projectId}` },
        })))),
      this.removedRows.length > shown.length
        ? h("p", { class: "pp-muted" }, `${count(this.removedRows.length - shown.length, "weiteres", "weitere")} nicht angezeigt.`) : null);
  }

  _recordTime(record) {
    const head = displayHead(record);
    if (!isRecord(head)) return null;
    return head.committedAt || head.exportedAt || null;
  }

  _card(record, index) {
    const live = this.sync ? this.sync.projectState(record.projectId) : null;
    const env = this._liveEnv();
    const status = projectStatus(record, live, env);
    const head = displayHead(record);
    const name = projectDisplayName(record);
    const titleId = `pp-card-${index}`;
    const meta = [];
    if (head) {
      meta.push(head.rootPath || "—");
      if (head.counts) meta.push(count(head.counts.operators, "Op", "Ops"), count(head.counts.codeSources, "Codequelle", "Codequellen"));
    }
    const time = head
      ? (head.committedAt ? `auf dem Speicher seit ${formatTime(head.committedAt)}` : `exportiert ${formatTime(head.exportedAt)}`)
      : "noch kein Stand";
    const lines = [
      h("h3", { id: titleId, class: "pp-card-title" }, exact(name)),
      h("p", { class: "pp-card-meta" }, meta.join(" · ")),
      h("p", { class: "pp-card-time" }, time),
      h("p", { class: "pp-card-status" },
        h("span", { class: `pp-badge pp-badge-${status.primary}` }, STATUS_LABELS.get(status.primary)),
        record.activeRevision ? h("span", { class: "pp-offline" }, offlineReason(record, env) === null
          ? "Offline: verfügbar" : `Offline: nicht dauerhaft (${offlineReason(record, env)})`) : null),
    ];
    if (status.primary === "failed") lines.push(h("p", { class: "pp-card-problem" }, failureText(live)));
    const flagText = new Map([
      ["deleted", "Auf dem Speicher gelöscht – lokale Kopie bleibt."],
      ["missing", "Nicht mehr auf dem Speicher – lokale Kopie bleibt."],
      ["older", "Speicher meldet älteren Stand; lokal bleibt der neuere."],
      ["newer", "Neuer Stand auf dem Speicher."],
      ["conflict", "Speicher-Kopf weicht von der lokalen Revision ab (gleicher Stand, anderer Inhalt)."],
    ]);
    for (const flag of status.flags) lines.push(h("p", { class: `pp-card-flag pp-flag-${flag}` }, flagText.get(flag)));
    // Rueckweg zum Speicherstand nur auf ausdrueckliche Wahl (Vertrag 10/13); die bisherige Revision bleibt als vorherige.
    const canAdopt = this.tokenInfo.present && record.serverStatus === "active" && isRecord(record.indexHead)
      && (status.flags.includes("conflict") || status.flags.includes("older"));
    if (canAdopt) lines.push(h("p", { class: "pp-muted" }, "„Speicherstand laden“ macht den Stand vom Speicher aktiv; die bisherige Revision bleibt als vorherige auf dem Gerät."));
    const hasPackage = Boolean(record.activeRevision);
    const actions = h("div", { class: "pp-card-actions" },
      hasPackage
        ? button("Öffnen", "open", { class: "pp-primary", dataset: { project: record.projectId, ppFocus: `open-${record.projectId}` } })
        : button("Laden", "refresh-project", { class: "pp-primary", dataset: { project: record.projectId, ppFocus: `open-${record.projectId}` } }),
      canAdopt ? button("Speicherstand laden", "adopt-head", { dataset: { project: record.projectId, ppFocus: `adopt-${record.projectId}` } }) : null,
      button("⋯", "menu", { "aria-label": `Aktionen: ${name}`, "aria-haspopup": "dialog", dataset: { project: record.projectId, ppFocus: `menu-${record.projectId}` } }));
    return h("article", { class: "pp-card", "aria-labelledby": titleId }, h("div", { class: "pp-card-main" }, lines), actions);
  }

  // ---------------------------------------------------------------- Zugang

  _accessSection() {
    const parts = [h("h2", { id: "pp-h-access" }, "Zugang zum Speicher")];
    parts.push(h("p", { class: "pp-muted" }, `Speicher: GitHub, privates Repo ${STORE_API.repo}. Pocket liest nur; löschen kann nur der PC.`));
    parts.push(this.env.installed
      ? h("p", { class: "pp-hint" }, "Installierte App: eigener Speicher für Token und Projekte.")
      : h("p", { class: "pp-hint pp-hint-warn" }, "Du bist im Browser-Tab, nicht in der installierten App. Safari-Tab und App haben getrennte Speicher; im Tab darf Safari alles nach 7 Tagen ohne Besuch löschen, und der Tab teilt den Speicher mit den anderen Seiten auf tombkn.github.io. Token und Projekte deshalb in der App einrichten (Teilen → Zum Home-Bildschirm)."));
    if (this.tokenInfo.present) {
      parts.push(h("p", {}, `Zugang eingerichtet${this.tokenInfo.savedAt ? ` am ${formatTime(this.tokenInfo.savedAt)}` : ""}. Das Token bleibt nur in dieser App.`));
      if (this.tokenInfo.authFailedAt) {
        parts.push(h("p", { class: "pp-hint pp-hint-warn" }, `Abgleich angehalten: Zugang abgelaufen oder widerrufen (seit ${formatTime(this.tokenInfo.authFailedAt)}). Pocket fragt erst wieder, wenn du „Zugang prüfen“ oder ⟳ drückst oder ein neues Token einrichtest. Lokale Projekte bleiben.`));
      }
      if (!this.tokenInfo.fineGrained) parts.push(h("p", { class: "pp-hint pp-hint-warn" }, "Empfohlen ist ein fine-grained Token (beginnt mit github_pat_) nur für dieses Repo."));
      parts.push(h("div", { class: "pp-actions" },
        button("Zugang prüfen", "token-recheck", { dataset: { ppFocus: "token-recheck" } }),
        button("Token entfernen …", "token-remove", { dataset: { ppFocus: "token-remove" }, "aria-haspopup": "dialog" })));
    } else {
      parts.push(h("ol", { class: "pp-steps" },
        h("li", {}, "Auf github.com ein eigenes Nur-Lese-Token für dieses iPhone anlegen: ", externalLink(TOKEN_PAGE_URL, "Token-Seite öffnen (vorbefüllt)")),
        h("li", {}, `Dort „Only select repositories“ → ${STORE_API.repo} wählen. Contents: Read und 90 Tage Ablauf sind vorbefüllt.`),
        h("li", {}, "Token kopieren, hier einfügen und prüfen.")));
      const input = h("input", {
        type: "password", id: "pp-token", class: "pp-input", autocomplete: "off", autocapitalize: "off", spellcheck: "false",
        inputmode: "text", "aria-label": "GitHub-Token", placeholder: "github_pat_…", dataset: { ppFocus: "token-input" },
      });
      parts.push(h("label", { class: "pp-label", for: "pp-token" }, "Token"), input);
      // Vertrag 12: Eingabe in der installierten App. Im Tab nur nach einer zweiten Rueckfrage (Desktop-Test).
      parts.push(h("div", { class: "pp-actions" }, button(this.env.installed ? "Prüfen und speichern" : "Prüfen und speichern …", "token-save", {
        class: "pp-primary", dataset: { ppFocus: "token-save" }, "aria-haspopup": this.env.installed ? null : "dialog",
      })));
      parts.push(h("p", { class: "pp-muted" }, "Das Token liegt nur im Speicher dieser App (IndexedDB), nie im Fortschritts-Export. Widerruf jederzeit auf github.com."));
    }
    parts.push(h("p", { class: "pp-access-result", role: "status", "aria-live": "polite", id: "pp-access-result" }, this._accessResult || ""));
    const storage = [];
    storage.push(`Speicher geschützt: ${this.env.persisted === true ? "ja" : this.env.persisted === false ? "nein" : "unbekannt"}`);
    if (this.env.estimate && Number.isFinite(this.env.estimate.usage) && Number.isFinite(this.env.estimate.quota)) {
      storage.push(`belegt ${formatBytes(this.env.estimate.usage)} von ${formatBytes(this.env.estimate.quota)}`);
    }
    parts.push(h("p", { class: "pp-muted" }, storage.join(" · ")));
    if (this.env.supported && this.env.persisted !== true) parts.push(h("div", { class: "pp-actions" }, button("Speicher schützen", "persist")));
    return parts;
  }

  // allowTab: der Nutzer hat im Browser-Tab ausdruecklich bestaetigt (Fenster "token-tab"). Das Token bleibt bis
  // dahin nur im Eingabefeld - es wird weder im Fenster noch sonstwo zwischengespeichert.
  async _saveToken({ allowTab = false } = {}) {
    const input = this.layer.querySelector("#pp-token");
    const raw = input ? input.value : "";
    const format = checkTokenFormat(raw);
    if (!format.ok) {
      this._setAccessResult(syncMessage("token-format"));
      return;
    }
    // Vertrag 12: Eingabe in der installierten App (eigener Speicher). Der Tab teilt IndexedDB mit allen Seiten auf
    // tombkn.github.io (Vertrag 15) - dort nur nach zweiter, ausdruecklicher Bestaetigung, vor jeder Anfrage.
    if (!allowTab && !isInstalledApp()) {
      this._openDialog({ kind: "token-tab" });
      return;
    }
    this._setAccessResult("Prüfe Zugang …");
    const result = await checkAccess({ fetch: this.deps.fetch }, format.token);
    if (result.state !== "ok") {
      this._setAccessResult(`Nicht gespeichert: ${syncMessage(result.state)}`);
      return;
    }
    try {
      await saveToken(this.store, format.token, this.deps.now());
    } catch (error) {
      if (!(error instanceof StoreError)) throw error;
      this._setAccessResult(`Nicht gespeichert: ${error.message}`);
      return;
    }
    if (input) input.value = "";
    this._accessResult = result.fineGrained ? "Zugang funktioniert und ist gespeichert." : "Zugang funktioniert und ist gespeichert (empfohlen: fine-grained Token).";
    await this._refreshToken();
    this.requestSync("manual");
  }

  async _recheckToken() {
    let token = null;
    try {
      token = await readToken(this.store);
    } catch (error) {
      this._storeProblem(error);
      return;
    }
    if (!token) {
      this._setAccessResult(syncMessage("no-token"));
      return;
    }
    this._setAccessResult("Prüfe Zugang …");
    const result = await checkAccess({ fetch: this.deps.fetch }, token);
    this._setAccessResult(result.state === "ok" ? "Zugang funktioniert." : syncMessage(result.state));
    // Ausdrueckliche Pruefung erfolgreich: ein Halt nach 401/403 ist erledigt, automatische Abgleiche duerfen wieder.
    if (result.state !== "ok") return;
    try {
      if (await clearAuthHold(this.store)) await this._refreshToken();
    } catch (error) {
      this._storeProblem(error);
    }
  }

  _setAccessResult(text) {
    this._accessResult = text;
    const out = this.layer.querySelector("#pp-access-result");
    if (out) out.textContent = text;
  }

  // ---------------------------------------------------------------- Datei-Import

  _importSection() {
    return [
      h("h2", { id: "pp-h-import" }, "Paket-Datei importieren"),
      h("p", { class: "pp-muted" }, "Ein Paket (.json) aus CodeSearch „Send to Pocket …“ – wird vollständig geprüft, bevor es gespeichert wird."),
      h("div", { class: "pp-actions" },
        button("Datei wählen", "import", { class: "pp-primary" }),
        button("Ohne Filter wählen", "import-any")),
      h("input", { type: "file", id: "pp-import", accept: "application/json,.json", multiple: true, hidden: true, "aria-label": "Paket-Datei" }),
      h("input", { type: "file", id: "pp-import-any", multiple: true, hidden: true, "aria-label": "Datei ohne Filter" }),
      h("p", { class: "pp-hint" }, "iPhone: Dateien aus Cloud-Ordnern (z. B. OneDrive) lassen sich teils nicht wählen. Vorher in „Auf meinem iPhone“ sichern. Ist eine .json-Datei ausgegraut: „Ohne Filter wählen“."),
      h("p", { class: "pp-import-result", role: "status", "aria-live": "polite", id: "pp-import-result" }, this._importResult || ""),
    ];
  }

  async _importFiles(files) {
    const list = [...files];
    if (!list.length) return;
    const lines = [];
    for (const file of list) {
      this._setImportResult(`Prüfe ${list.length > 1 ? `${lines.length + 1}/${list.length}` : "Datei"} …`);
      let result;
      try {
        result = await importPackageFile({ store: this.store }, file);
      } catch (error) {
        // Speicherfehler (Verbindung verloren, Speicher gesperrt): diese Datei meldet ihn, die naechste wird trotzdem
        // geprueft - sonst bliebe "Pruefe …" fuer immer stehen. Andere Fehler sind Programmfehler und bleiben sichtbar.
        if (!(error instanceof StoreError)) throw error;
        lines.push(`Nicht importiert: ${error.message}`);
        if (error.detail && error.detail.reload) this._storeProblem(error);
        continue;
      }
      if (result.ok) {
        lines.push(result.status === "already-active" ? "Schon aktiv – nichts geändert." : `Importiert: ${result.projectName}${result.unknownFields ? ` (${result.unknownFields} unbekannte Felder ignoriert)` : ""}${result.entryErrors ? ` (${result.entryErrors} Analyse-Einträge fehlerhaft)` : ""}`);
      } else if (result.code === "package-invalid") {
        lines.push(`Abgelehnt: ${packageProblemText(result.errors)} Vorhandene Projekte bleiben unverändert.`);
      } else {
        lines.push(`Nicht importiert: ${syncMessage(result.code)}`);
      }
    }
    this._setImportResult(lines.join(" "));
    await this.refreshList();
  }

  _setImportResult(text) {
    this._importResult = text;
    const out = this.layer.querySelector("#pp-import-result");
    if (out) out.textContent = text;
  }

  // ---------------------------------------------------------------- Notizen (Liste)

  // Notizen haben einen eigenen Export/Import, nie im Fortschritts-Export (Vertrag 13). Die Datei traegt die Warnung
  // selbst (store.exportNotes) und wird hier vor dem Sichern noch einmal genannt.
  _notesSection() {
    return [
      h("h2", { id: "pp-h-notes" }, "Notizen"),
      h("p", { class: "pp-muted" }, this.orphanNotes
        ? `${count(this.orphanNotes, "Notiz", "Notizen")} ohne Projekt – sie bleiben und hängen sich über die Projekt-ID wieder an, sobald das Projekt zurückkommt.`
        : "Notizen bleiben lokal auf diesem Gerät, nie im Fortschritts-Export."),
      this._orphanPart(),
      h("p", { class: "pp-hint pp-hint-warn" }, "Die Notiz-Datei enthält Ausschnitte aus privatem Code: nur an sichere Orte speichern."),
      h("div", { class: "pp-actions" }, button("Notizen sichern", "notes-export"), button("Notizen laden", "notes-import")),
      h("input", { type: "file", id: "pp-notes-file", accept: "application/json,.json", hidden: true, "aria-label": "Notiz-Datei" }),
      h("p", { class: "pp-import-result", role: "status", "aria-live": "polite", id: "pp-notes-result" }, this._notesResult || ""),
    ];
  }

  // "Notizen ohne Projekt" (Vertrag 13): lesen und einzeln loeschen; "Notizen sichern" nimmt sie mit. Notiztext und
  // Ort (Pfad aus dem Anker, also aus dem Paket) nur als Text; lange Notizen klappen auf (details, kein Skript).
  _orphanPart() {
    if (!this.orphanList.length) return null;
    const shown = this.orphanList.slice(0, MAX_LIST_ITEMS);
    return h("div", { class: "pp-orphans", role: "group", "aria-labelledby": "pp-h-orphans" },
      h("h3", { id: "pp-h-orphans" }, "Notizen ohne Projekt"),
      h("ul", { class: "pp-list" }, shown.map((note) => {
        const a = note.anchor;
        const lines = a.kind !== "op" && Number.isSafeInteger(a.startLine) ? `, Zeilen ${a.startLine}–${a.endLine}` : "";
        const first = note.text.split("\n", 1)[0];
        const summary = first.length > 80 ? `${first.slice(0, 80)}…` : first || "(leer)";
        return h("li", { class: "pp-orphan" },
          h("details", { class: "pp-orphan-text" }, h("summary", {}, summary), h("p", { class: "pp-orphan-full" }, note.text)),
          h("p", { class: "pp-muted" }, `${a.origPath}${lines} · Projekt ${note.projectId.slice(0, 12)}… · ${formatTime(note.updatedAt)}`),
          button("Löschen …", "orphan-delete", { class: "pp-danger", "aria-haspopup": "dialog", "aria-label": `Notiz löschen: ${summary}`,
            dataset: { note: note.id, ppFocus: `orphan-${note.id}` } }));
      })),
      this.orphanList.length > shown.length
        ? h("p", { class: "pp-muted" }, `${count(this.orphanList.length - shown.length, "weitere", "weitere")} – vollständig in „Notizen sichern“.`) : null);
  }

  async _deleteOrphan(id) {
    if (typeof id !== "string" || !this.orphanList.some((n) => n.id === id)) return;
    try {
      await this.store.deleteNote(id);
    } catch (error) {
      if (!(error instanceof StoreError)) throw error;
      toast(error.message);
      return;
    }
    this._closeDialog();
    toast("Notiz gelöscht.");
    await this.refreshList();
  }

  async _exportNotes() {
    let data;
    try {
      data = await this.store.exportNotes();
    } catch (error) {
      if (!(error instanceof StoreError)) throw error;
      this._setNotesResult(error.message);
      return;
    }
    // Blob-Adresse aus eigenen Daten (keine Paketwerte im DOM); der Download-Link lebt nur fuer diesen Klick.
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "codesearch-pocket-notizen.json";
    document.body.append(a);
    a.click();
    a.remove();
    this.deps.setTimer(() => URL.revokeObjectURL(a.href), 2000);
    this._setNotesResult(`${count(data.notes.length, "Notiz", "Notizen")} gesichert – die Datei enthält Ausschnitte aus privatem Code.`);
  }

  async _importNotes(file) {
    // Grenze vor dem Lesen: Notizen sind Text, keine Pakete (20 000 Notizen x 100 000 Zeichen waeren schon zu viel).
    if (!file || file.size > 64 * 1024 * 1024) {
      this._setNotesResult("Notiz-Datei ist zu groß oder nicht lesbar.");
      return;
    }
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      this._setNotesResult("Keine Notiz-Datei von CodeSearch Pocket.");
      return;
    }
    let report;
    try {
      report = await this.store.importNotes(data);
    } catch (error) {
      if (!(error instanceof StoreError)) throw error;
      this._setNotesResult(error.code === "invalid" ? "Keine Notiz-Datei von CodeSearch Pocket." : error.message);
      return;
    }
    this._setNotesResult(`Notizen geladen: ${report.added} neu, ${report.skipped} schon vorhanden, ${report.invalid} ungültig.`);
    await this.refreshList();
  }

  _setNotesResult(text) {
    this._notesResult = text;
    const out = this.layer.querySelector("#pp-notes-result");
    if (out) out.textContent = text;
  }

  // ---------------------------------------------------------------- Projekt-Tabs

  _tabBody(tab) {
    switch (tab) {
      case "overview": return this._overviewBody();
      case "hierarchy": return this._hierarchyBody();
      case "network": return h("div", { class: "pp-view pp-view-network", dataset: { ppView: "network" } });
      case "code": return this._codeBody();
      case "search": return this._searchBody();
      default: return null;
    }
  }

  _restoreScroll(tab) {
    const view = this.views[tab];
    this.dom.body.scrollTop = view && Number.isFinite(view.scrollTop) && (tab === "overview" || tab === "hierarchy" || tab === "search") ? view.scrollTop : 0;
  }

  _onBodyScroll() {
    if (this.entry && this.entry.page === "list") this._listScroll = this.dom.body.scrollTop;
    if (!this.entry || this.entry.page !== "project" || !this.model) return;
    const tab = this.entry.tab;
    if (tab !== "overview" && tab !== "hierarchy" && tab !== "search") return;
    this.views[tab].scrollTop = this.dom.body.scrollTop;
    this._scheduleSave();
  }

  // ---------------------------------------------------------------- UEBERSICHT

  _overviewBody() {
    const m = this.model;
    const doc = m.doc;
    const record = this._record(m.projectId);
    const rootOp = m.rootOp();
    const imported = record && isRecord(record.activeHead) && record.activeHead.committedAt === null;
    const parts = [];
    parts.push(h("section", { class: "pp-section" },
      h("h2", {}, m.projectName),
      h("p", { class: "pp-snapshot" }, `Statische Momentaufnahme vom ${formatTime(m.exportedAt)} – keine TD-Ausführung, kein Laufzeitzustand, Umfang nur wie unten ausgewiesen.`),
      h("dl", { class: "pp-facts" },
        fact("Root", `${m.root}${rootOp ? ` (${rootOp.opType})` : ""}`),
        fact("Revision", `${shortRevision(m.revisionId)}…${record && record.activeSeq ? ` · Kopf ${record.activeSeq}` : ""}${imported ? " · lokal importiert" : ""}`),
        fact("Exportiert", formatTime(m.exportedAt)),
        fact("Erfasst mit", `${doc.source.tool} ${doc.source.toolVersion} · TD ${doc.source.tdBuild} · ${doc.source.projectFile}`),
        fact("Erfassung", doc.capture.consistency === "changed" ? "Netz änderte sich während der Erfassung" : doc.capture.consistency === "retried" ? "wiederholt, dann stabil" : "zwei Durchläufe stimmten überein")),
      h("div", { class: "pp-actions" }, button("Kontext kopieren", "copy-context"))));
    const last = this.views.lastOpened;
    if (last) {
      const label = last.kind === "code"
        ? `Weiterlesen: ${m.abs(last.source)}${last.line ? `, Zeile ${last.line}` : ""}`
        : `Weiter im Netz: ${m.abs(last.comp)}`;
      parts.push(h("section", { class: "pp-section" }, h("h3", {}, "Zuletzt geöffnet"), button(label, "resume", { class: "pp-tile" })));
    }
    parts.push(this._structureSection());
    parts.push(this._centralSection());
    parts.push(this._entrySection());
    parts.push(this._sourcesSection());
    parts.push(this._externalSection());
    parts.push(this._boundsSection());
    parts.push(this._stateSection());
    return parts;
  }

  _structureSection() {
    const m = this.model;
    const c = m.doc.report.counts;
    const families = new Map();
    for (const o of m.operators()) families.set(o.family, (families.get(o.family) || 0) + 1);
    const famText = [...families.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`).join(" · ");
    return h("section", { class: "pp-section" }, h("h3", {}, "Struktur"),
      h("ul", { class: "pp-stats" },
        h("li", {}, count(c.operators, "Operator", "Operatoren"), ` (${famText})`),
        h("li", {}, count(c.comps, "COMP", "COMPs"), " · ", count(c.annotations, "Annotation", "Annotationen")),
        h("li", {}, count(c.connections, "Leitung", "Leitungen"), " · ", count(c.references, "Verweis", "Verweise")),
        h("li", {}, count(c.codeSources, "Code-Quelle", "Code-Quellen"), ` (${count(c.codeChars, "Zeichen", "Zeichen")})`),
        h("li", {}, count(c.parameters, "Parameter", "Parameter"), " · ", count(c.external, "externe Abhängigkeit", "externe Abhängigkeiten"))));
  }

  // Zentrale COMPs: Extensions, Verweise auf den COMP und exportierte Kinder - als Fakten, nicht als Note.
  _centralSection() {
    const m = this.model;
    const rows = [];
    for (const o of m.operators()) {
      if (!o.isCOMP) continue;
      const ext = m.extensions(o.rel).length;
      const refs = m.referencesTo(o.rel).length;
      const kids = m.children(o.rel).length;
      rows.push({ o, ext, refs, kids, score: ext * 3 + refs * 2 + kids });
    }
    rows.sort((a, b) => b.score - a.score || (a.o.rel < b.o.rel ? -1 : 1));
    const top = rows.filter((r) => r.score > 0).slice(0, 6);
    return h("section", { class: "pp-section" }, h("h3", {}, "Zentrale COMPs"),
      top.length ? h("ul", { class: "pp-list" }, top.map((r) => h("li", {},
        button(m.abs(r.o.rel), "goto-network", { class: "pp-link-btn", dataset: { rel: r.o.rel } }),
        h("span", { class: "pp-muted" }, ` ${count(r.ext, "Extension", "Extensions")} · ${count(r.refs, "Verweis", "Verweise")} · ${count(r.kids, "Kind", "Kinder")}`))))
        : h("p", { class: "pp-muted" }, "Keine COMPs mit Extensions, Verweisen oder Kindern."));
  }

  _entrySection() {
    const m = this.model;
    const items = [];
    for (const o of m.operators()) {
      for (const ext of m.extensions(o.rel)) {
        const label = `${m.abs(o.rel)} → Extension ${ext.name || `Slot ${ext.slot}`}${ext.className ? ` (Klasse ${ext.className})` : ""}`;
        items.push(ext.dat !== null
          ? button(label, "open-code", { class: "pp-link-btn", dataset: { source: ext.dat } })
          : h("span", {}, `${label} – Quelle nicht im Paket`));
      }
    }
    for (const s of m.sources()) {
      for (const role of s.roles) {
        if (role.kind === "extension" || role.kind === "module") continue;
        const what = role.kind === "callbacks" ? `Callbacks von ${m.abs(role.owner)}.${role.par}`
          : role.kind === "glsl" ? `GLSL von ${m.abs(role.owner)}.${role.par}` : `Execute (${role.subtype})`;
        items.push(button(`${m.abs(s.key)} – ${what}`, "open-code", { class: "pp-link-btn", dataset: { source: s.key } }));
      }
    }
    return h("section", { class: "pp-section" }, h("h3", {}, "Einstiegspunkte (Extensions, Callbacks)"),
      items.length ? h("ul", { class: "pp-list" }, items.slice(0, MAX_LIST_ITEMS).map((item) => h("li", {}, item)),
        items.length > MAX_LIST_ITEMS ? h("li", { class: "pp-muted" }, `… und ${items.length - MAX_LIST_ITEMS} weitere`) : null)
        : h("p", { class: "pp-muted" }, "Keine Extensions oder Callbacks im Paket."));
  }

  _sourcesSection() {
    const m = this.model;
    const sources = m.sources();
    const unsearchable = m.unsearchable.map((u) => `${u.count}× ${sourceStatusText(u.reason)}`).join(", ");
    return h("section", { class: "pp-section" }, h("h3", {}, `Codequellen (${sources.length})`),
      unsearchable ? h("p", { class: "pp-muted" }, `Nicht als Text vorhanden: ${unsearchable}`) : null,
      sources.length ? h("ul", { class: "pp-list" }, sources.slice(0, MAX_LIST_ITEMS).map((s) => h("li", {},
        button(m.abs(s.key), "open-code", { class: "pp-link-btn", dataset: { source: s.key } }),
        h("span", { class: "pp-muted" }, ` ${s.language} · ${sourceStatusText(s.status)}${Number.isSafeInteger(s.lines) ? ` · ${count(s.lines, "Zeile", "Zeilen")}` : ""}`))),
        sources.length > MAX_LIST_ITEMS ? h("li", { class: "pp-muted" }, `… und ${sources.length - MAX_LIST_ITEMS} weitere (CODE-Tab)`) : null)
        : h("p", { class: "pp-muted" }, "Keine Code-Quellen."));
  }

  _externalSection() {
    const deps = this.model.externalDependencies();
    return h("section", { class: "pp-section" }, h("h3", {}, `Externe Abhängigkeiten (${deps.length})`),
      h("p", { class: "pp-muted" }, "Ziele außerhalb des Roots – nie mitexportiert, nicht navigierbar."),
      deps.length ? h("ul", { class: "pp-list" }, deps.slice(0, MAX_LIST_ITEMS).map((d) => h("li", {},
        h("span", { class: "pp-ext" }, `extern: ${d.path}`),
        h("span", { class: "pp-muted" }, ` ${d.opType || "Typ unbekannt"} · ${d.kinds.join(", ")} · ${d.count}×`))),
        deps.length > MAX_LIST_ITEMS ? h("li", { class: "pp-muted" }, `… und ${deps.length - MAX_LIST_ITEMS} weitere`) : null)
        : h("p", { class: "pp-muted" }, "Keine."));
  }

  // Exportgrenzen: was das Paket ausdruecklich nicht enthaelt bzw. nur begrenzt.
  _boundsSection() {
    const m = this.model;
    const doc = m.doc;
    const caps = [];
    for (const [key, label] of CAPABILITY_LABELS) {
      const value = doc.capabilities[key];
      caps.push(h("li", {}, `${label}: `, value === true ? "exportiert" : value === false ? "nicht exportiert" : `begrenzt (${String(value)})`));
    }
    const omissions = doc.report.omissions.map((o) => h("li", {}, `${o.what}: ${o.count}× (${o.reason})`));
    const secrets = doc.report.secrets;
    return h("section", { class: "pp-section" }, h("h3", {}, "Exportgrenzen"),
      h("ul", { class: "pp-list pp-caps" }, caps),
      omissions.length ? [h("h4", {}, "Ausgelassen"), h("ul", { class: "pp-list" }, omissions)] : null,
      h("p", { class: "pp-muted" }, `Geheimnis-Prüfung (${secrets.rules}): ${count(secrets.omittedSources, "Quelle", "Quellen")} und ${count(secrets.omittedValues, "Wert", "Werte")} nicht übertragen. Keine Behauptung vollständiger Erkennung.`));
  }

  _stateSection() {
    const warnings = this.model.doc.warnings;
    const entryProblems = this.model.entryProblems.length;
    const items = warnings.map((w) => {
      // Object.hasOwn: ein Code wie "constructor" (neuere Minor-Version) traefe sonst Object.prototype.
      const severity = Object.hasOwn(WARNING_SEVERITY, w.code) ? w.severity : "info";
      const where = [w.op !== null ? this.model.abs(w.op) : null, w.source !== null && w.source !== w.op ? this.model.abs(w.source) : null,
        Number.isSafeInteger(w.count) ? `${w.count}×` : null].filter(Boolean).join(" · ");
      return h("li", { class: `pp-state pp-state-${severity === "warning" || severity === "error" ? severity : "info"}` },
        h("span", { class: "pp-state-sev" }, SEVERITY_LABELS.get(severity) || "Hinweis"), " ", warningText(w.code), where ? h("span", { class: "pp-muted" }, ` (${where})`) : null);
    });
    if (entryProblems) items.push(h("li", { class: "pp-state pp-state-warning" }, h("span", { class: "pp-state-sev" }, "Warnung"), ` ${count(entryProblems, "Analyse-Eintrag", "Analyse-Einträge")} verletzt das Schema; die Quellen bleiben lesbar.`));
    const info = this._modelInfo.get(this.model);
    if (info && info.unknownFields) {
      items.push(h("li", { class: "pp-state pp-state-info" }, h("span", { class: "pp-state-sev" }, "Hinweis"), ` ${count(info.unknownFields, "unbekanntes Feld", "unbekannte Felder")} (neuere Paketversion) ignoriert.`));
    }
    return h("section", { class: "pp-section" }, h("h3", {}, "Projekt-Zustand"),
      items.length ? h("ul", { class: "pp-list" }, items) : h("p", { class: "pp-muted" }, "Keine Hinweise aus der Erfassung."));
  }

  // ---------------------------------------------------------------- HIERARCHIE (aufklappbar, bedarfsgerecht)

  _hierarchyBody() {
    const view = this.views.hierarchy;
    const input = h("input", {
      type: "search", class: "pp-input", id: "pp-filter", "aria-label": "Hierarchie filtern", placeholder: "Filtern: Name, Typ oder Pfad",
      autocomplete: "off", autocapitalize: "off", spellcheck: "false", enterkeyhint: "search", value: view.filter,
    });
    const tree = h("div", { class: "pp-tree", role: "tree", "aria-label": "Operator-Hierarchie" });
    this._treeDom = tree;
    this._treeShown = new Map();
    let timer = null;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        view.filter = input.value;
        this._renderTree();
        this._scheduleSave();
      }, 150);
    });
    this._renderTree();
    return [h("div", { class: "pp-toolbar" }, input), tree];
  }

  _renderTree() {
    const tree = this._treeDom;
    if (!tree || !this.model) return;
    const view = this.views.hierarchy;
    const query = view.filter.trim().toLowerCase();
    if (query) {
      const hits = [];
      for (const o of this.model.operators()) {
        if (hits.length > FILTER_MAX) break;
        const hay = `${o.name} ${o.opType} ${this.model.abs(o.rel)}`.toLowerCase();
        if (hay.includes(query)) hits.push(o);
      }
      const rows = hits.slice(0, FILTER_MAX).map((o) => this._treeRow(o, 0, true));
      if (hits.length > FILTER_MAX) rows.push(h("p", { class: "pp-muted" }, `Mehr als ${FILTER_MAX} Treffer – Filter genauer fassen.`));
      if (!hits.length) rows.push(h("p", { class: "pp-empty" }, "Kein Operator passt zum Filter."));
      tree.replaceChildren(...rows);
      return;
    }
    const expanded = new Set(view.expanded);
    const root = this.model.rootOp();
    tree.replaceChildren(...(root ? this._treeBranch(root, 0, expanded) : []));
  }

  _treeBranch(o, depth, expanded) {
    const out = [this._treeRow(o, depth, false, expanded.has(o.rel))];
    if (o.isCOMP && expanded.has(o.rel)) {
      const kids = this.model.children(o.rel);
      const shown = this._treeShown.get(o.rel) || TREE_CHUNK;
      const group = h("div", { role: "group" });
      for (const kid of kids.slice(0, shown)) group.append(...this._treeBranch(kid, depth + 1, expanded));
      if (kids.length > shown) group.append(button(`weitere ${Math.min(TREE_CHUNK, kids.length - shown)} von ${kids.length - shown} zeigen`, "tree-more", { class: "pp-more", dataset: { rel: o.rel } }));
      const hidden = this.model.hiddenChildren(o.rel);
      if (hidden > 0) group.append(h("p", { class: "pp-muted pp-tree-note" }, `${count(hidden, "Kind", "Kinder")} nicht exportiert`));
      out.push(group);
    }
    return out;
  }

  _treeRow(o, depth, flat, isOpen = false) {
    const m = this.model;
    const exported = o.isCOMP ? m.children(o.rel).length : 0;
    const total = o.isCOMP && Number.isSafeInteger(o.children) ? o.children : null;
    const hasCode = m.source(o.rel) !== null;
    const row = h("div", {
      class: "pp-row", role: "treeitem", "aria-level": String(flat ? 1 : depth + 1),
      "aria-expanded": o.isCOMP && !flat ? (isOpen ? "true" : "false") : null, dataset: { rel: o.rel },
    });
    row.style.setProperty("--pp-depth", String(flat ? 0 : Math.min(depth, 24)));
    row.append(
      o.isCOMP && !flat
        ? button(isOpen ? "▾" : "▸", "tree-toggle", { class: "pp-twisty", "aria-label": isOpen ? "Zuklappen" : "Aufklappen", dataset: { rel: o.rel } })
        : h("span", { class: "pp-twisty-space", "aria-hidden": "true" }),
      h("span", { class: "pp-row-text" },
        h("span", { class: "pp-row-name" }, exact(o.rel === "" ? (o.name || m.root) : o.name)),
        h("span", { class: "pp-row-type" }, ` ${o.opType}`),
        o.isCOMP ? h("span", { class: "pp-row-count" }, total !== null && total !== exported ? ` ${exported}/${total}` : ` ${exported}`) : null,
        h("span", { class: "pp-row-path" }, exact(m.abs(o.rel)))),
      h("span", { class: "pp-row-actions" },
        button("Netz", "goto-network", { dataset: { rel: o.rel }, "aria-label": `Netz: ${o.name || m.root}` }),
        hasCode ? button("Code", "open-code", { dataset: { source: o.rel }, "aria-label": `Code: ${o.name}` }) : null,
        button("Details", "details", { dataset: { rel: o.rel }, "aria-label": `Details: ${o.name || m.root}` })));
    return row;
  }

  // ---------------------------------------------------------------- CODE

  _codeBody() {
    const m = this.model;
    const view = this.views.code;
    const select = h("select", { class: "pp-input", id: "pp-source", "aria-label": "Code-Quelle", dataset: { ppSource: "1" } });
    select.append(h("option", { value: "" }, "Quelle wählen …"));
    for (const s of m.sources()) {
      const option = h("option", { value: s.key }, `${m.abs(s.key)} · ${s.language} · ${sourceStatusText(s.status)}`);
      if (s.key === view.source) option.selected = true;
      select.append(option);
    }
    const parts = [h("div", { class: "pp-toolbar" }, h("label", { class: "pp-label", for: "pp-source" }, "Quelle"), select)];
    if (view.source === null) {
      parts.push(h("p", { class: "pp-empty" }, m.sources().length ? "Eine Quelle wählen – oder aus ÜBERSICHT, HIERARCHIE oder SUCHE springen." : "Dieses Paket enthält keine Code-Quellen."));
    } else {
      parts.push(h("div", { class: "pp-view pp-view-code", dataset: { ppView: "code" } }));
    }
    return parts;
  }

  // ---------------------------------------------------------------- SUCHE

  _searchBody() {
    const view = this.views.search;
    const input = h("input", {
      type: "search", class: "pp-input", id: "pp-query", "aria-label": "Im Projekt suchen", placeholder: "Suchen: Wort, *teil*, a|b, „Phrase“",
      autocomplete: "off", autocapitalize: "off", spellcheck: "false", enterkeyhint: "search", value: view.query, maxlength: String(SEARCH_LIMITS.maxQuery),
    });
    const kinds = h("div", { class: "pp-kinds", role: "group", "aria-label": "Suchen in" }, SEARCH_KINDS.map((kind) => h("button", {
      type: "button", class: `chip pp-kind${view.kinds.includes(kind) ? " on" : ""}`, "aria-pressed": view.kinds.includes(kind) ? "true" : "false",
      dataset: { pp: "search-kind", kind },
    }, SEARCH_KIND_LABELS.get(kind))));
    const meta = h("p", { class: "pp-search-meta", role: "status", "aria-live": "polite" });
    const hits = h("ol", { class: "pp-hits" });
    this._searchDom = { input, meta, hits };
    let timer = null;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => this._runSearch(), 300);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        clearTimeout(timer);
        this._runSearch();
      }
    });
    const form = h("div", { class: "pp-toolbar" }, input, button("Suchen", "search-run", { class: "pp-primary" }));
    queueMicrotask(() => { if (view.query) this._runSearch(); });
    return [form, kinds, meta, hits];
  }

  _runSearch() {
    const dom = this._searchDom;
    if (!dom || !this.model) return;
    const view = this.views.search;
    view.query = dom.input.value;
    this._scheduleSave();
    if (!view.query.trim()) {
      dom.meta.textContent = "";
      dom.hits.replaceChildren();
      this._searchResult = null;
      return;
    }
    const result = this.model.search(view.query, { kinds: view.kinds, maxResults: SEARCH_LIMITS.defaultResults });
    this._searchResult = result;
    if (result.error) {
      dom.meta.textContent = result.error === "too-long" ? "Suchtext zu lang: höchstens 512 Zeichen." : "Suchtext fehlt.";
      dom.hits.replaceChildren();
      return;
    }
    const parts = [`Projekt ${this.model.projectName} · Revision ${shortRevision(result.revisionId)}… · ${count(result.total, "Treffer", "Treffer")}`];
    if (result.total > result.hits.length) parts.push(`gezeigt ${result.hits.length} (Grenze ${result.limit}, je Art höchstens ${SEARCH_LIMITS.sectionMax})`);
    const blind = result.unsearchable.reduce((sum, u) => sum + u.count, 0);
    if (blind) parts.push(`${count(blind, "Quelle", "Quellen")} nicht durchsuchbar (${result.unsearchable.map((u) => `${sourceStatusText(u.reason)} ${u.count}`).join(", ")})`);
    if (!view.kinds.includes("table")) parts.push("Tabellen nur mit „Tabelle“");
    dom.meta.textContent = parts.join(" · ");
    dom.hits.replaceChildren(...result.hits.map((hit, i) => h("li", {},
      h("button", { type: "button", class: "pp-hit", dataset: { pp: "hit", hit: String(i) } },
        h("span", { class: "pp-hit-kind" }, SEARCH_KIND_LABELS.get(hit.kind) || hit.kind),
        h("span", { class: "pp-hit-where" }, exact(`${this.model.abs(hit.rel)}${hit.line ? `:${hit.line}` : ""}${hit.par ? `.${hit.par}` : ""}`)),
        h("span", { class: "pp-hit-text" }, exact(hit.text), hit.cut ? " …" : null)))));
    if (!result.hits.length) dom.hits.append(h("li", { class: "pp-empty" }, "Keine Treffer."));
  }

  _openHit(index) {
    const hit = this._searchResult && this._searchResult.hits[index];
    if (!hit || !this.model) return;
    if (hit.kind === "code" || hit.kind === "table" || hit.kind === "method") this._openCode(hit.rel, hit.line);
    else if (hit.kind === "parameter") this._openSheet({ kind: "details", rel: hit.rel });
    else this._openNetworkAt(hit.rel);
  }

  // ---------------------------------------------------------------- NETZ/CODE ueber project-views.js

  _mountTabView(tab) {
    if (!this.model || this.modelState.status !== "ready") return;
    if (tab === "network") {
      const container = this.dom.body.querySelector('[data-pp-view="network"]');
      if (container) this._mountView("network", container, () => renderNetwork(container, this.model, { ...this.views.network }, this._actions("network")));
    } else if (tab === "code" && this.views.code.source !== null) {
      const container = this.dom.body.querySelector('[data-pp-view="code"]');
      if (container) this._mountView("code", container, () => renderCode(container, this.model, { ...this.views.code }, this._actions("code")));
    }
  }

  // Ansichten aus project-views.js sind ein fremdes Modul: ein Fehler dort soll nicht die ganze Ebene mitreissen.
  _mountView(kind, container, factory) {
    let handle = null;
    try {
      handle = factory();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      console.error(error);
      container.replaceChildren(h("p", { class: "pp-error", role: "alert" }, "Diese Ansicht konnte nicht gezeichnet werden."));
      return null;
    }
    if (kind === "sheet") this._sheetHandle = handle;
    else this._handles.set(kind, handle);
    return handle;
  }

  _closeTabViews() {
    for (const handle of this._handles.values()) destroyHandle(handle);
    this._handles.clear();
    this._treeDom = null;
    this._searchDom = null;
  }

  _closeViews() {
    this._closeTabViews();
    destroyHandle(this._sheetHandle);
    this._sheetHandle = null;
    this._sheetKey = null;
    this._sheetReturn = null;
    this._bodyKey = null;
  }

  _actions(origin) {
    return {
      selectOp: (rel) => this._networkAction({ selected: rel }),
      enterComp: (rel) => this._networkAction({ comp: rel, selected: null, ...FIT }),
      goParent: () => {
        const comp = this.model && this.model.op(this.views.network.comp);
        if (comp && comp.parent !== null) this._networkAction({ comp: comp.parent, selected: comp.rel, ...FIT });
      },
      openDetails: (rel) => this._openSheet({ kind: "details", rel }),
      openCode: (key, line) => this._openCode(key, line),
      openSource: (key, line) => this._openCode(key, line),
      openUnderstand: (target) => {
        const clean = cleanSheet({ kind: "understand", target });
        if (clean) this._openSheet(clean);
      },
      addNote: (draft) => this._startNote(draft),
      copyText: (text, kind) => this._copy(String(text), kind),
      deleteNote: (id) => this._deleteNote(id),
      setView: (partial) => this._setView(origin, partial),
    };
  }

  // Aenderung aus einer Aktion (Auswahl, COMP betreten): Zustand setzen und die Netzansicht neu ausrichten.
  _networkAction(partial) {
    if (!this.model) return;
    const view = this._mergeNetwork(partial);
    if (!view) return;
    if (this.entry.tab !== "network" || this.entry.sheet) {
      this._push({ page: "project", projectId: this.entry.projectId, tab: "network", sheet: null });
      return;
    }
    const handle = this._handles.get("network");
    if (handle && typeof handle.update === "function") handle.update({ ...this.views.network });
  }

  _mergeNetwork(partial) {
    if (!isRecord(partial) || !this.model) return null;
    const m = this.model;
    const next = { ...this.views.network };
    if (Object.hasOwn(partial, "comp")) {
      if (typeof partial.comp !== "string" || !m.has(partial.comp) || !m.op(partial.comp).isCOMP) return null;
      next.comp = partial.comp;
    }
    if (Object.hasOwn(partial, "selected")) {
      if (partial.selected !== null && (typeof partial.selected !== "string" || !m.has(partial.selected))) return null;
      next.selected = partial.selected;
    }
    if (Object.hasOwn(partial, "zoom") || Object.hasOwn(partial, "panX") || Object.hasOwn(partial, "panY")) {
      Object.assign(next, viewTrio({ zoom: partial.zoom ?? next.zoom, panX: partial.panX ?? next.panX, panY: partial.panY ?? next.panY }));
      if (partial.zoom === null || partial.panX === null || partial.panY === null) Object.assign(next, FIT);
    }
    this.views.network = next;
    this.views.lastOpened = { kind: "network", comp: next.comp };
    this._scheduleSave();
    return next;
  }

  // setView meldet, was die Ansicht selbst schon zeigt (Zoom, Verschieben, Scrollen): nur merken, nicht zurueckspiegeln.
  _setView(origin, partial) {
    if (!isRecord(partial) || !this.model) return;
    if (origin === "network") {
      this._mergeNetwork(partial);
      return;
    }
    const view = { ...this.views.code };
    if (Object.hasOwn(partial, "source") && typeof partial.source === "string" && this.model.source(partial.source)) view.source = partial.source;
    if (Object.hasOwn(partial, "line")) view.line = Number.isSafeInteger(partial.line) && partial.line >= 1 ? partial.line : null;
    if (Object.hasOwn(partial, "scrollTop")) view.scrollTop = finiteOr(partial.scrollTop, view.scrollTop, 0);
    if (Object.hasOwn(partial, "find") && typeof partial.find === "string" && partial.find.length <= SEARCH_LIMITS.maxQuery) view.find = partial.find;
    this.views.code = view;
    if (view.source !== null) this.views.lastOpened = { kind: "code", source: view.source, line: view.line };
    this._scheduleSave();
  }

  _openCode(key, line) {
    if (!this.model || typeof key !== "string" || !this.model.source(key)) return;
    const cleanLine = Number.isSafeInteger(line) && line >= 1 ? line : null;
    this.views.code = { ...this.views.code, source: key, line: cleanLine, scrollTop: 0 };
    this.views.lastOpened = { kind: "code", source: key, line: cleanLine };
    this._scheduleSave();
    if (this.entry.tab !== "code" || this.entry.sheet) {
      this._push({ page: "project", projectId: this.entry.projectId, tab: "code", sheet: null });
      return;
    }
    const handle = this._handles.get("code");
    if (handle && typeof handle.update === "function") {
      handle.update({ ...this.views.code });
      const select = this.layer.querySelector("#pp-source");
      if (select) select.value = key;
    } else {
      this._bodyKey = null;
      this._keys.delete(this.dom.body);
      this.render();
    }
  }

  _openNetworkAt(rel) {
    if (!this.model || !this.model.has(rel)) return;
    const o = this.model.op(rel);
    if (o.isCOMP) this._networkAction({ comp: rel, selected: null, ...FIT });
    else this._networkAction({ comp: o.parent, selected: rel, ...FIT });
  }

  _openSheet(sheet) {
    if (!this.model || !this.entry || this.entry.page !== "project") return;
    if (sheet.kind === "details" && !this.model.has(sheet.rel)) return;
    // Fokus-Rueckgabe beim Schliessen (wie _openReturn/_dialogReturn): der Ausloeser. Ein Blatt aus einem Blatt
    // behaelt das erste Ziel - der Knopf im alten Blatt verschwindet.
    if (!this.entry.sheet) {
      const active = focusable(document.activeElement);
      this._sheetReturn = active && active !== document.body ? active : null;
    }
    this._push({ page: "project", projectId: this.entry.projectId, tab: this.entry.tab, sheet });
  }

  _renderSheet() {
    const sheet = this.entry.page === "project" && this.model && this.modelState.status === "ready" ? this.entry.sheet : null;
    const key = sheet ? `${this.model.revisionId}|${entryKey(sheet)}|${this._notesVersion}` : "";
    if (this._sheetKey === key) return;
    this._sheetKey = key;
    destroyHandle(this._sheetHandle);
    this._sheetHandle = null;
    this.dom.sheet.hidden = !sheet;
    // Das Blatt deckt die ganze Ebene ab (z-index): alles darunter aus der Tab-Reihenfolge nehmen, auch die Kopfzeile.
    this.dom.body.inert = Boolean(sheet);
    this.dom.tabs.inert = Boolean(sheet);
    this.dom.head.inert = Boolean(sheet);
    this.dom.notice.inert = Boolean(sheet);
    if (!sheet) {
      // Erst nach dem Aufheben von inert: in ein inertes Gebiet laesst der Browser keinen Fokus. Ist der Ausloeser
      // nicht mehr da (anderer Tab, Liste), bleibt der Fokus, wo die Seite ihn hinsetzt.
      const hadSheet = this.dom.sheet.firstChild !== null;
      const back = this._sheetReturn;
      this._sheetReturn = null;
      this.dom.sheet.replaceChildren();
      if (hadSheet && back && back.isConnected && this.dom.main.contains(back)) back.focus({ preventScroll: true });
      return;
    }
    const titles = new Map([["details", "DETAILS"], ["understand", "VERSTEHEN"], ["notes", "NOTIZEN"]]);
    const body = h("div", { class: "pp-sheet-body", dataset: { ppView: sheet.kind } });
    this.dom.sheet.replaceChildren(h("div", { class: "pp-sheet", role: "region", "aria-labelledby": "pp-sheet-title" },
      h("div", { class: "pp-sheet-head" }, h("h2", { id: "pp-sheet-title", tabindex: "-1" }, titles.get(sheet.kind)),
        button("✕", "sheet-close", { "aria-label": "Blatt schließen", dataset: { ppFocus: "sheet-close" } })),
      body));
    const actions = this._actions("sheet");
    if (sheet.kind === "details") {
      if (!this.model.has(sheet.rel)) body.append(h("p", { class: "pp-empty" }, "Diesen Operator gibt es in dieser Revision nicht."));
      else this._mountView("sheet", body, () => renderDetails(body, this.model, sheet.rel, actions));
    } else if (sheet.kind === "understand") {
      this._mountView("sheet", body, () => renderUnderstand(body, this.model, sheet.target, actions));
    } else {
      this._mountNotes(body, actions);
    }
    const title = this.dom.sheet.querySelector("#pp-sheet-title");
    if (title) title.focus({ preventScroll: true });
  }

  // Notizen mit Anker-Status (bleibt / verschoben / Quelle nicht uebertragen / nicht zugeordnet). Ein verschobener
  // Anker wird fortgeschrieben (Vertrag 13), damit die Notiz beim naechsten Mal direkt passt.
  async _mountNotes(body, actions) {
    const model = this.model;
    const key = this._sheetKey;
    let notes;
    try {
      notes = await this.store.listNotes(model.projectId);
    } catch (error) {
      this._storeProblem(error);
      return;
    }
    const items = [];
    for (const note of notes) {
      const anchorStatus = resolveAnchor(note.anchor, model);
      if (anchorStatus.state === "moved" && validateAnchor(anchorStatus.anchor).ok) {
        try {
          await this.store.putNote({ ...note, anchor: anchorStatus.anchor, updatedAt: isoStamp(this.deps.now()) });
        } catch (error) {
          if (!(error instanceof StoreError)) throw error;
        }
      }
      // Form wie project-notes.js erwartet: {note, resolved}; resolved traegt den fortgeschriebenen Anker.
      items.push({ note, resolved: anchorStatus });
    }
    if (this._sheetKey !== key || this.model !== model) return;
    this._mountView("sheet", body, () => renderNotes(body, items, model, actions));
  }

  async _startNote(draft) {
    if (!this.model || !isRecord(draft)) return;
    let anchor = null;
    try {
      anchor = validateAnchor(draft).ok ? draft : await createAnchor(this.model, draft);
    } catch (error) {
      if (!(error instanceof AnchorError)) throw error;
      toast("Für diese Stelle lässt sich keine Notiz anlegen.");
      return;
    }
    this._openDialog({ kind: "note", anchor });
  }

  async _saveNote(text) {
    const dialog = this.dialog;
    if (!dialog || dialog.kind !== "note" || !this.model) return;
    if (!text.trim()) {
      toast("Notiz ist leer.");
      return;
    }
    try {
      await this.store.createNote({ projectId: this.model.projectId, anchor: dialog.anchor, text });
    } catch (error) {
      if (!(error instanceof StoreError)) throw error;
      toast(error.message);
      return;
    }
    this._closeDialog();
    this._notesVersion += 1;
    toast("Notiz gespeichert (nur auf diesem Gerät).");
    this.render();
  }

  async _deleteNote(id) {
    if (typeof id !== "string") return;
    try {
      await this.store.deleteNote(id);
    } catch (error) {
      if (!(error instanceof StoreError)) throw error;
      toast(error.message);
      return;
    }
    this._notesVersion += 1;
    this._sheetKey = null;
    this.render();
  }

  // kind sagt, was kopiert wurde (feste Texte, nie ein Paketwert): Kontext, Pfad, Code oder Auswahl.
  async _copy(text, kind = "context") {
    const result = await copyToDevice(text);
    toast(result.ok ? (COPY_TOASTS.get(kind) || "Kopiert.") : "Kopieren nicht möglich – Zwischenablage blockiert.");
  }

  _copyContext() {
    if (!this.model) return;
    const tab = this.entry.tab;
    const sheet = this.entry.sheet;
    let focus = {};
    if (sheet && sheet.kind === "details") focus = { rel: sheet.rel };
    else if (tab === "network") focus = { rel: this.views.network.selected ?? this.views.network.comp };
    else if (tab === "code" && this.views.code.source !== null) focus = { source: this.views.code.source, line: this.views.code.line };
    this._copy(contextText(this.model, focus));
  }

  // ---------------------------------------------------------------- Speichern des Ansichtszustands

  _scheduleSave() {
    if (!this.store || !this.model) return;
    const projectId = this.model.projectId;
    const tab = this.entry && this.entry.page === "project" ? this.entry.tab : "overview";
    // Momentaufnahme der reinen Daten (Zahlen, Strings, Listen): spaetere Aenderungen erreichen den Speicher nicht.
    const value = { revisionId: this.model.revisionId, tab, ...JSON.parse(JSON.stringify(this.views)) };
    if (this._saveTimer !== null) this.deps.clearTimer(this._saveTimer);
    this._saveTimer = this.deps.setTimer(() => {
      this._saveTimer = null;
      this.store.putUiState(UI_KEY_PREFIX + projectId, value, { projectId }).catch((error) => {
        // Ansichtszustand ist Komfort: ein Speicherfehler zeigt sich als Hinweis, die Ansicht laeuft weiter.
        if (error instanceof StoreError) this.notice = { kind: "info", text: error.message };
        else console.error(error);
      });
    }, SAVE_DELAY_MS);
  }

  // ---------------------------------------------------------------- Kleine Fenster (Menue, Umbenennen, Loeschen ...)

  _openDialog(dialog) {
    // Wechsel von Fenster zu Fenster (Menue -> Umbenennen/Loeschen): der Fokus steht auf einem Knopf, der gleich
    // verschwindet - das urspruengliche Ziel (⋯ der Karte) bleibt die Rueckgabe.
    const active = focusable(document.activeElement);
    if (!(this.dialog && active && this.dom.dialog.contains(active))) this._dialogReturn = active;
    this.dialog = dialog;
    this._dialogKey = null;
    this.render();
    const first = this.dom.dialog.querySelector("textarea, input:not([type=radio]), input[type=radio]:checked, button");
    if (first) first.focus({ preventScroll: true });
  }

  _closeDialog() {
    this.dialog = null;
    this.render();
    const back = this._dialogReturn;
    this._dialogReturn = null;
    if (back && back.isConnected) back.focus({ preventScroll: true });
  }

  _renderDialog() {
    const dialog = this.dialog;
    const key = dialog ? entryKey(dialog) : "";
    this.dom.main.inert = Boolean(dialog);
    if (this._dialogKey === key) return;
    this._dialogKey = key;
    this.dom.dialog.hidden = !dialog;
    if (!dialog) {
      this.dom.dialog.replaceChildren();
      return;
    }
    const record = dialog.projectId ? this._record(dialog.projectId) : null;
    const name = record ? projectDisplayName(record) : "";
    const panel = h("div", { class: "pp-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "pp-dialog-title" });
    const title = (text) => h("h2", { id: "pp-dialog-title" }, text);
    if (dialog.kind === "menu") {
      panel.append(title(name), h("div", { class: "pp-menu" },
        record && record.activeRevision ? button("Öffnen", "open", { dataset: { project: dialog.projectId } }) : null,
        record && record.activeRevision ? button("Suchen", "menu-search", { dataset: { project: dialog.projectId } }) : null,
        button("Aktualisieren", "refresh-project", { dataset: { project: dialog.projectId } }),
        button("Umbenennen (lokal) …", "menu-rename", { dataset: { project: dialog.projectId } }),
        button("Lokal löschen …", "menu-delete", { dataset: { project: dialog.projectId } }),
        button("Abbrechen", "dialog-close")),
      h("p", { class: "pp-muted" }, "Serverprojekte löscht nur der PC (CodeSearch)."));
    } else if (dialog.kind === "rename") {
      const input = h("input", { type: "text", id: "pp-rename", class: "pp-input", maxlength: "120", autocomplete: "off", value: name, "aria-label": "Lokaler Anzeigename" });
      panel.append(title("Umbenennen (nur auf diesem Gerät)"), h("label", { class: "pp-label", for: "pp-rename" }, "Anzeigename"), input,
        h("div", { class: "pp-actions" },
          button("Speichern", "rename-save", { class: "pp-primary", dataset: { project: dialog.projectId } }),
          record && record.localName ? button("Exportnamen verwenden", "rename-reset", { dataset: { project: dialog.projectId } }) : null,
          button("Abbrechen", "dialog-close")));
    } else if (dialog.kind === "delete") {
      panel.append(title(`„${name}“ lokal löschen?`),
        h("p", {}, "Entfernt Paket und Ansichten von diesem Gerät. Auf dem Speicher bleibt alles; das Projekt wird nicht automatisch neu geladen – „Wieder laden“ steht danach in der Liste unter „Lokal entfernt“."),
        h("fieldset", { class: "pp-fieldset" }, h("legend", {}, "Notizen zu diesem Projekt"),
          radio("pp-del-notes", "keep", "behalten (erscheinen unter „Notizen ohne Projekt“)", true),
          radio("pp-del-notes", "drop", "auch löschen", false)),
        h("div", { class: "pp-actions" },
          button("Lokal löschen", "delete-confirm", { class: "pp-danger", dataset: { project: dialog.projectId } }),
          button("Abbrechen", "dialog-close")));
    } else if (dialog.kind === "logout") {
      panel.append(title("Token entfernen?"),
        h("p", {}, "Danach lädt Pocket nichts mehr vom Speicher. Ein verlorenes Gerät: Token zusätzlich auf github.com widerrufen."),
        h("fieldset", { class: "pp-fieldset" }, h("legend", {}, "Lokale Projekte"),
          radio("pp-out-projects", "keep", "behalten (offline weiter lesbar)", true),
          radio("pp-out-projects", "drop", "von diesem Gerät löschen", false)),
        h("fieldset", { class: "pp-fieldset" }, h("legend", {}, "Notizen"),
          radio("pp-out-notes", "keep", "behalten", true),
          radio("pp-out-notes", "drop", "löschen", false)),
        h("div", { class: "pp-actions" }, button("Token entfernen", "logout-confirm", { class: "pp-danger" }), button("Abbrechen", "dialog-close")));
    } else if (dialog.kind === "token-tab") {
      panel.append(title("Token im Browser-Tab speichern?"),
        h("p", {}, "Pocket läuft hier im Browser-Tab, nicht in der installierten App. Der Tab teilt seinen Speicher (IndexedDB) mit allen anderen Seiten auf tombkn.github.io, und Safari darf ihn nach 7 Tagen ohne Besuch löschen."),
        h("p", {}, "Das Nur-Lese-Token gehört in die installierte App (Teilen → Zum Home-Bildschirm). Hier nur speichern, wenn du am Desktop testest."),
        // Abbrechen zuerst: das Fenster fokussiert den ersten Knopf - ein versehentliches Enter speichert nichts.
        h("div", { class: "pp-actions" },
          button("Abbrechen", "dialog-close"),
          button("Trotzdem hier speichern", "token-save-tab", { class: "pp-danger" })));
    } else if (dialog.kind === "orphan-delete") {
      panel.append(title("Notiz löschen?"),
        h("p", {}, "Die Notiz gehört zu keinem Projekt auf diesem Gerät. Gelöscht ist sie weg, auch wenn das Projekt später zurückkommt. Vorher sichern: „Notizen sichern“."),
        h("div", { class: "pp-actions" },
          button("Abbrechen", "dialog-close"),
          button("Notiz löschen", "orphan-delete-confirm", { class: "pp-danger", dataset: { note: dialog.noteId } })));
    } else if (dialog.kind === "note") {
      const where = dialog.anchor.kind === "op" ? this.model.abs(dialog.anchor.op)
        : `${this.model.abs(dialog.anchor.source)}${dialog.anchor.startLine ? `, Zeilen ${dialog.anchor.startLine}–${dialog.anchor.endLine}` : ""}`;
      panel.append(title("Notiz"), h("p", { class: "pp-muted" }, `Zu: ${where}`),
        h("textarea", { id: "pp-note-text", class: "pp-input", rows: "5", "aria-label": "Notiztext" }),
        h("p", { class: "pp-muted" }, "Bleibt nur auf diesem Gerät; nie im Fortschritts-Export."),
        h("div", { class: "pp-actions" }, button("Speichern", "note-save", { class: "pp-primary" }), button("Abbrechen", "dialog-close")));
    }
    this.dom.dialog.replaceChildren(h("div", { class: "pp-backdrop", dataset: { pp: "dialog-close" } }), panel);
  }

  // ---------------------------------------------------------------- Ereignisse

  _onClick(event) {
    const el = event.target.closest("[data-pp]");
    // Klicks in den Ansichten aus project-views.js gehoeren deren eigenen Handlern.
    if (!el || !this.layer.contains(el) || el.closest("[data-pp-view]")) return;
    const d = el.dataset;
    switch (d.pp) {
      case "close": return this.close();
      case "up": return this.nav.up();
      // ⟳ ist ein ausdruecklicher Wunsch: auch dauerhaft fehlgeschlagene Revisionen werden erneut versucht.
      case "sync": return this.requestSync("manual", { force: true });
      case "cancel-sync": return this.sync && this.sync.cancel();
      case "tab": return this._switchTab(d.tab);
      case "open": return this._openProject(d.project, "overview");
      case "menu": return this._openDialog({ kind: "menu", projectId: d.project });
      case "menu-search": return this._openProject(d.project, "search");
      case "menu-rename": return this._openDialog({ kind: "rename", projectId: d.project });
      case "menu-delete": return this._openDialog({ kind: "delete", projectId: d.project });
      case "dialog-close": return this._closeDialog();
      case "refresh-project": return this._refreshProject(d.project);
      case "reload-stored": return this._reloadStored(d.project);
      case "rename-save": return this._rename(d.project, this.layer.querySelector("#pp-rename")?.value ?? "");
      case "rename-reset": return this._rename(d.project, null);
      case "delete-confirm": return this._deleteLocal(d.project, checkedValue(this.layer, "pp-del-notes") === "keep");
      case "token-save": return this._saveToken();
      case "token-save-tab":
        this._closeDialog();
        return this._saveToken({ allowTab: true });
      case "restore-removed": return this._restoreRemoved(d.project);
      case "adopt-head": return this._adoptHead(d.project);
      case "orphan-delete": return this._openDialog({ kind: "orphan-delete", noteId: d.note });
      case "orphan-delete-confirm": return this._deleteOrphan(d.note);
      case "token-recheck": return this._recheckToken();
      case "token-remove": return this._openDialog({ kind: "logout" });
      case "logout-confirm": return this._logout(checkedValue(this.layer, "pp-out-projects") === "keep", checkedValue(this.layer, "pp-out-notes") === "keep");
      case "persist": return this._persist();
      case "import": return this.layer.querySelector("#pp-import")?.click();
      case "import-any": return this.layer.querySelector("#pp-import-any")?.click();
      case "notes-export": return this._exportNotes();
      case "notes-import": return this.layer.querySelector("#pp-notes-file")?.click();
      case "notes": return this._openSheet({ kind: "notes" });
      case "sheet-close": return this.nav.back();
      case "copy-context": return this._copyContext();
      case "open-new-revision": return this._openNewRevision();
      case "page-reload": return this._reloadPage();
      case "resume": return this._resume();
      case "goto-network": return this._openNetworkAt(d.rel);
      case "open-code": return this._openCode(d.source, null);
      case "details": return this._openSheet({ kind: "details", rel: d.rel });
      case "tree-toggle": return this._toggleTree(d.rel);
      case "tree-more": return this._treeMore(d.rel);
      case "search-run": return this._runSearch();
      case "search-kind": return this._toggleKind(d.kind);
      case "hit": return this._openHit(Number(d.hit));
      case "note-save": return this._saveNote(this.layer.querySelector("#pp-note-text")?.value ?? "");
      default: return undefined;
    }
  }

  _onChange(event) {
    const target = event.target;
    if (target.id === "pp-notes-file" && target.files && target.files.length) {
      const file = target.files[0];
      target.value = "";
      this._importNotes(file);
      return;
    }
    if ((target.id === "pp-import" || target.id === "pp-import-any") && target.files && target.files.length) {
      const files = [...target.files];
      target.value = "";
      this._importFiles(files);
      return;
    }
    if (target.id === "pp-source") {
      if (target.value) this._openCode(target.value, null);
    }
  }

  _onKeydown(event) {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      this.escape();
      return;
    }
    this._moveTabFocus(event);
  }

  // Tab-Leiste (WAI-ARIA Tabs, manuelle Aktivierung): Pfeile/Pos1/Ende bewegen nur den Fokus, Enter/Leertaste waehlt
  // (der Knopf selbst). So entsteht beim Durchblaettern kein Verlaufseintrag und keine schwere NETZ/CODE-Ansicht.
  _moveTabFocus(event) {
    const moves = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);
    if (!moves.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    const current = event.target && typeof event.target.closest === "function" ? event.target.closest('[data-pp="tab"]') : null;
    if (!current || !this.dom.tabs.contains(current)) return;
    const tabs = [...this.dom.tabs.querySelectorAll('[data-pp="tab"]')];
    const at = tabs.indexOf(current);
    let next = at;
    if (event.key === "ArrowRight") next = (at + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (at - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else next = tabs.length - 1;
    event.preventDefault();
    tabs.forEach((tab, i) => tab.setAttribute("tabindex", i === next ? "0" : "-1"));
    tabs[next].focus({ preventScroll: true });
  }

  _switchTab(tab) {
    if (!TABS.includes(tab) || !this.entry || this.entry.page !== "project" || tab === this.entry.tab) return;
    this._push({ page: "project", projectId: this.entry.projectId, tab, sheet: null });
    this._scheduleSave();
  }

  async _openProject(projectId, tab) {
    if (typeof projectId !== "string" || !PATTERNS.projectId.test(projectId)) return;
    this.dialog = null;
    let saved = null;
    try {
      saved = await this.store.getUiState(UI_KEY_PREFIX + projectId);
    } catch (error) {
      if (!(error instanceof StoreError)) throw error;
    }
    const record = this._record(projectId);
    // Ausdrueckliches Oeffnen aus der Liste: die Ansicht war geschlossen, es gilt die aktive Revision. Ein noch
    // gehaltenes Modell einer aelteren Revision (nach "‹ Liste" bleibt es fuer Zurueck/Vor erhalten) wird hier
    // verworfen, sonst zeigte "Öffnen" den alten Stand. Nur eine offene Ansicht bleibt bei ihrer Revision (Vertrag 13).
    if (this.model && this.model.projectId === projectId && record && record.activeRevision && this.model.revisionId !== record.activeRevision) {
      this._loadToken += 1;
      this.model = null;
      this.modelState = { status: "idle", projectId: null, error: null };
    }
    const sameRevision = isRecord(saved) && record && saved.revisionId === record.activeRevision;
    const startTab = tab === "overview" && sameRevision && TABS.includes(saved.tab) ? saved.tab : tab;
    this._push({ page: "project", projectId, tab: startTab, sheet: null });
    if (tab === "search") queueMicrotask(() => this.layer.querySelector("#pp-query")?.focus({ preventScroll: true }));
  }

  async _refreshProject(projectId) {
    if (typeof projectId !== "string" || !PATTERNS.projectId.test(projectId)) return;
    this.dialog = null;
    this.render();
    if (!this.tokenInfo.present) {
      toast("Ohne Zugang kein Abgleich – Paket-Datei importieren.");
      return;
    }
    // Nur dieses Projekt wird erneut erzwungen (auch nach einem dauerhaften Fehler); die anderen laufen normal.
    const result = await this.requestSync("manual", { projectId });
    const state = result && result.projects instanceof Map ? result.projects.get(projectId) : null;
    if (state && (state.state === "current")) toast("Schon aktuell.");
    if (this.entry && this.entry.page === "project" && this.entry.projectId === projectId) this._ensureModel(projectId, { reload: true });
  }

  // "Wieder laden" eines lokal entfernten Projekts: ausdrueckliche Wahl, also Loeschvermerk aufheben und genau dieses
  // Projekt abgleichen. Ohne Zugang bleibt der Vermerk stehen (sonst laede der naechste Abgleich ungefragt).
  async _restoreRemoved(projectId) {
    if (typeof projectId !== "string" || !PATTERNS.projectId.test(projectId)) return;
    if (!this.tokenInfo.present) {
      toast("Ohne Zugang kein Abgleich – Paket-Datei importieren.");
      return;
    }
    try {
      await this.store.clearLocalRemoval(projectId);
    } catch (error) {
      if (!(error instanceof StoreError)) throw error;
      toast(error.message);
      return;
    }
    await this.refreshList();
    await this._refreshProject(projectId);
  }

  // "Speicherstand laden" bei Konflikt oder aelterem Speicher-Kopf (Vertrag 10/13: nur auf ausdrueckliche Wahl). Eine
  // offene Ansicht bleibt bei ihrer Revision, bis "Neue Revision oeffnen" (Hinweis kommt aus _renderNotice).
  async _adoptHead(projectId) {
    if (typeof projectId !== "string" || !PATTERNS.projectId.test(projectId)) return;
    this.dialog = null;
    this.render();
    if (!this.tokenInfo.present) {
      toast("Ohne Zugang kein Abgleich – Paket-Datei importieren.");
      return;
    }
    const result = await this.requestSync("manual", { projectId, adopt: true });
    const state = result && result.projects instanceof Map ? result.projects.get(projectId) : null;
    if (state && state.state === "activated") toast("Speicherstand ist aktiv; die bisherige Revision bleibt als vorherige.");
  }

  // Gespeichertes Paket besteht die Pruefung beim Oeffnen nicht (geteilte Origin): lokal entfernen, Loeschvermerk
  // gleich wieder aufheben (der Nutzer will es ja neu haben) und vom Speicher laden. Notizen bleiben.
  async _reloadStored(projectId) {
    if (typeof projectId !== "string" || !PATTERNS.projectId.test(projectId)) return;
    if (!this.tokenInfo.present) {
      // Ohne Zugang gaebe es danach nichts zu laden: das Projekt bliebe weg. Also nur der Weg ueber die Datei.
      toast("Ohne Zugang: Projekt im Menü lokal löschen und die Paket-Datei erneut importieren.");
      return;
    }
    try {
      await this.store.removeLocal(projectId, { keepNotes: true });
      await this.store.clearLocalRemoval(projectId);
    } catch (error) {
      if (!(error instanceof StoreError)) throw error;
      toast(error.message);
      return;
    }
    for (const key of [...this._models.keys()]) if (key.startsWith(`${projectId}\n`)) this._models.delete(key);
    await this.refreshList();
    await this._refreshProject(projectId);
  }

  async _rename(projectId, name) {
    const value = name === null ? null : String(name).trim();
    if (value !== null && !value) {
      toast("Name darf nicht leer sein.");
      return;
    }
    try {
      await this.store.setLocalName(projectId, value);
    } catch (error) {
      if (!(error instanceof StoreError)) throw error;
      toast(error.message);
      return;
    }
    this._closeDialog();
    await this.refreshList();
  }

  async _deleteLocal(projectId, keepNotes) {
    try {
      await this.store.removeLocal(projectId, { keepNotes });
    } catch (error) {
      if (!(error instanceof StoreError)) throw error;
      toast(error.message);
      return;
    }
    for (const key of [...this._models.keys()]) if (key.startsWith(`${projectId}\n`)) this._models.delete(key);
    this._closeDialog();
    toast(keepNotes ? "Lokal gelöscht. Notizen bleiben." : "Lokal gelöscht, Notizen auch.");
    // Aus der Projektansicht geloescht: zurueck zur Liste, statt ein leeres Projekt offen zu halten.
    if (this.entry && this.entry.page === "project" && this.entry.projectId === projectId) this.nav.up();
    await this.refreshList();
  }

  // Abmelden: Token weg, Abgleich stoppt; lokale Projekte und Notizen nur auf ausdrueckliche Wahl (Vertrag 12).
  async _logout(keepProjects, keepNotes) {
    if (this.sync) this.sync.cancel();
    try {
      await removeToken(this.store);
      if (!keepProjects) await this.store.clearProjects({ keepNotes });
      else if (!keepNotes) {
        // Auch Notizen ohne Projekt: die Wahl "Notizen loeschen" gilt fuer alle Notizen dieses Geraets.
        const notes = await this.store.listNotes();
        for (const projectId of new Set(notes.map((n) => n.projectId))) await this.store.deleteNotes(projectId);
      }
    } catch (error) {
      if (!(error instanceof StoreError)) throw error;
      toast(error.message);
      return;
    }
    if (!keepProjects) this._models.clear();
    this._accessResult = "Token entfernt.";
    this._closeDialog();
    await this._refreshToken();
    await this.refreshList();
  }

  async _persist() {
    const result = await storagePersistence({ request: true });
    this.env = { ...this.env, persisted: result.persisted, supported: result.supported };
    await this._refreshEnv();
    this.render();
    toast(result.persisted ? "Speicher ist geschützt." : "Der Browser hat den Schutz nicht gewährt (am ehesten in der installierten App).");
  }

  // Kontrolliertes Neuladen (Vertrag 13): nur auf ausdruecklichen Knopfdruck, so entsteht keine Schleife aus
  // automatischen Neustarts, wenn der Speicher auch nach dem Neuladen nicht antwortet.
  _reloadPage() {
    if (this.location && typeof this.location.reload === "function") this.location.reload();
  }

  _openNewRevision() {
    if (!this.entry || this.entry.page !== "project") return;
    this.views = defaultViews();
    this._ensureModel(this.entry.projectId, { reload: true });
  }

  _resume() {
    const last = this.views.lastOpened;
    if (!last) return;
    if (last.kind === "code") this._openCode(last.source, last.line);
    else this._networkAction({ comp: last.comp, selected: null, ...FIT });
  }

  _toggleTree(rel) {
    const view = this.views.hierarchy;
    const expanded = new Set(view.expanded);
    if (expanded.has(rel)) expanded.delete(rel);
    else expanded.add(rel);
    view.expanded = [...expanded];
    this._renderTree();
    this._scheduleSave();
    const again = [...this.layer.querySelectorAll('[data-pp="tree-toggle"]')].find((el) => el.dataset.rel === rel);
    if (again) again.focus({ preventScroll: true });
  }

  _treeMore(rel) {
    this._treeShown.set(rel, (this._treeShown.get(rel) || TREE_CHUNK) + TREE_CHUNK);
    this._renderTree();
  }

  _toggleKind(kind) {
    if (!SEARCH_KINDS.includes(kind)) return;
    const view = this.views.search;
    const kinds = new Set(view.kinds);
    if (kinds.has(kind) && kinds.size > 1) kinds.delete(kind);
    else kinds.add(kind);
    view.kinds = SEARCH_KINDS.filter((k) => kinds.has(k));
    for (const chip of this.layer.querySelectorAll('[data-pp="search-kind"]')) {
      const on = view.kinds.includes(chip.dataset.kind);
      chip.classList.toggle("on", on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    }
    this._runSearch();
  }
}

function fact(label, value) {
  return [h("dt", {}, label), h("dd", {}, value)];
}

function radio(name, value, label, checked) {
  const id = `${name}-${value}`;
  return h("div", { class: "pp-radio" }, h("input", { type: "radio", name, id, checked, dataset: { value } }), h("label", { for: id }, label));
}

function checkedValue(root, name) {
  const el = [...root.querySelectorAll(`input[type=radio][name="${name}"]`)].find((input) => input.checked);
  return el ? el.dataset.value : null;
}

function destroyHandle(handle) {
  if (!handle || typeof handle.destroy !== "function") return;
  try {
    handle.destroy();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(error);
  }
}

function isoStamp(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function platformOnline(deps) {
  return typeof deps.online === "function" ? deps.online() !== false : true;
}

// Knopf "Seite neu laden" fuer StoreError mit detail.reload bzw. ein Abgleich-Ergebnis mit reload:true (store.js nach
// "connection lost" trotz Neuoeffnen). Null = kein Knopf.
function reloadAction(reload) {
  return reload ? ["Seite neu laden", "page-reload"] : null;
}

// Fabrik fuer app.js: Ebene bauen und starten.
export function createProjectsShell(options) {
  const shell = new ProjectsShell(options);
  shell.start();
  return shell;
}
