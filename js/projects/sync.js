// Abgleich mit dem Speicher (Vertrag POCKET-PROJECTS-SPEC 11-13): GitHub-Contents-API nur lesen, jedes Paket pruefen,
// erst dann ueber store.js aktivieren. Rein bis auf das injizierte fetch: kein DOM, kein localStorage.
//
// Warum so streng:
// - Kein Server prueft (Vertrag 11): Pocket nimmt nur, was verify.js samt Bindung an den Index-Eintrag besteht.
// - Pocket liest nur projects/index.json und revisions/<id>.json (raw). Header: Authorization, If-None-Match, Accept -
//   sonst nichts; cache "no-store" und credentials "omit", damit weder HTTP-Cache noch Cookies private Daten halten.
// - Das Token liegt nur im Store "sync" (IndexedDB) und geht nur als Authorization-Header hinaus; nie in Meldungen.
// - Nur im Vordergrund und ohne Versprechen einer Hintergrund-Aktualisierung (Vertrag 13): Ausloeser kommen von
//   app.js, hier wird entprellt, hoechstens 3 Wiederholungen mit Abstand, Abbruch jederzeit.
// - Meldungen sind feste Vorlagen je Code: nie ein Wert aus dem Paket, dem Index oder einer Server-Antwort.

import { CanonicalError, canonicalize, codepointLength, decodeUtf8Strict, hasUtf8Bom, isWellFormedString } from "./c14n.js";
import { PATTERNS, isUtcStamp } from "./schema.js";
import { POCKET_MAX_BYTES, diagnoseNonCanonical, messageFor, verifyPackage } from "./verify.js";
import { StoreError } from "./store.js";

// Speicherprofil GitHub (Entscheidung Tom 2026-11-05, Vertrag 11). Repo-Name steht fest - nie aus Paket oder Eingabe.
export const STORE_API = Object.freeze({
  origin: "https://api.github.com",
  owner: "Tombkn",
  repo: "codesearch-pocket-data",
});
// Vorbefuellte Seite fuer ein Nur-Lese-Token je Geraet (90 Tage, Contents: Read).
export const TOKEN_PAGE_URL = "https://github.com/settings/personal-access-tokens/new?name=Pocket+iPhone&expires_in=90&contents=read";
export const RAW_ACCEPT = "application/vnd.github.raw+json";
// Speicherdateien (index.json, store.json) wie cs_pocket_transport.MAX_STORE_FILE_BYTES.
export const STORE_FILE_MAX_BYTES = 8 * 1024 * 1024;
// Hoechstens 3 Wiederholungen je Anfrage, mit wachsendem Abstand (Vertrag 13).
export const RETRY_DELAYS_MS = Object.freeze([1500, 4000, 10000]);
export const DEFAULT_DEBOUNCE_MS = 800;
// Automatische Ausloeser (sichtbar, online) nach einem erfolgreichen Lauf erst wieder nach dieser Zeit.
export const DEFAULT_MIN_INTERVAL_MS = 20000;

// Schluessel im Store "sync". Nicht "local-removed:"/"local-cleared-epoch" - die gehoeren store.js.
export const SYNC_KEYS = Object.freeze({ token: "pp-token", index: "pp-index" });
// Je Projekt im Store "uistate" mit projectId: removeLocal/clearProjects raeumen sie automatisch mit weg.
export const FAILURE_KEY_PREFIX = "sync-failure:";

const STORE_FORMAT = "codesearch.pocket.store";
const INDEX_FORMAT = "codesearch.pocket.index";
const TOKEN_RE = /^[A-Za-z0-9_]{20,255}$/;
const ETAG_RE = /^(?:W\/)?"[\x21\x23-\x7e]{0,250}"$/;

// Feste Texte je Ergebnis-Code (Vertrag 4.15/8: Meldungen ohne Inhalte).
export const SYNC_MESSAGES = Object.freeze({
  ok: "Abgleich fertig.",
  "not-modified": "Speicher unverändert.",
  "no-token": "Kein Zugang eingerichtet.",
  offline: "Offline: Abgleich, sobald wieder Netz da ist.",
  auth: "Zugang abgelaufen oder widerrufen. Lokale Projekte bleiben; neues Token einrichten.",
  "not-found": "Kein Zugriff oder Speicher-Repo fehlt (GitHub meldet bei privaten Repos ohne Zugriff 404).",
  "rate-limit": "GitHub-Limit erreicht. Später erneut versuchen.",
  network: "Keine Verbindung zum Speicher.",
  http: "Speicher antwortet mit einem Fehler.",
  "too-large": "Datei ist zu groß für Pocket (höchstens 16 MiB).",
  "index-invalid": "Projektliste auf dem Speicher ist beschädigt.",
  "index-newer": "Projektliste stammt aus einer neueren CodeSearch-Version: App aktualisieren.",
  "store-invalid": "Speicher-Kennung (store.json) fehlt oder ist ungültig.",
  "store-newer": "Speicher stammt aus einer neueren CodeSearch-Version: App aktualisieren.",
  "revision-missing": "Kopf zeigt auf eine Revision, die auf dem Speicher fehlt.",
  "package-invalid": "Paket abgelehnt: Prüfung fehlgeschlagen.",
  aborted: "Abgleich abgebrochen.",
  "store-error": "Lokaler Speicher meldet einen Fehler; nichts wurde halb geschrieben.",
  error: "Abgleich mit einem unerwarteten Fehler abgebrochen.",
  "store-quota": "Gerätespeicher voll: nichts wurde geschrieben.",
  "token-format": "Das sieht nicht wie ein GitHub-Token aus (nur Buchstaben, Ziffern, _).",
  "import-input": "Keine lesbare Datei.",
  "import-too-large": "Datei ist zu groß für Pocket (höchstens 16 MiB).",
  unavailable: "Projektspeicher ist hier nicht verfügbar.",
});

export function syncMessage(code) {
  if (typeof code !== "string") return "Abgleich fehlgeschlagen.";
  if (Object.hasOwn(SYNC_MESSAGES, code)) return SYNC_MESSAGES[code];
  // store-<code> aus StoreError (timeout, connection-lost, integrity-conflict ...): eine Sammelmeldung reicht.
  return code.startsWith("store-") ? SYNC_MESSAGES["store-error"] : "Abgleich fehlgeschlagen.";
}

// Ein Fehler, den der Nutzer mit "Aktualisieren" nicht durch Warten behebt: dieselbe Revision wird automatisch nicht
// erneut geladen (spart 16-MiB-Downloads bei jedem Wechsel in den Vordergrund), manuell schon.
const PERMANENT_FAILURES = new Set(["package-invalid", "revision-missing", "too-large", "store-integrity-conflict"]);

export function isPermanentFailure(code) {
  return PERMANENT_FAILURES.has(code);
}

export class SyncError extends Error {
  constructor(code) {
    super(syncMessage(code));
    this.name = "SyncError";
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isInt(value, min) {
  return Number.isSafeInteger(value) && value >= min;
}

function isText(value, max) {
  return typeof value === "string" && value.length > 0 && isWellFormedString(value) && codepointLength(value) <= max;
}

function isoOf(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ------------------------------------------------------------------ Token

// Leerzeichen und Zeilenumbrueche vom Einfuegen entfernen; was danach bleibt, muss ein Header-tauglicher Token sein.
export function checkTokenFormat(raw) {
  const token = typeof raw === "string" ? raw.trim() : "";
  if (!TOKEN_RE.test(token)) return { ok: false, code: "token-format" };
  return { ok: true, token, fineGrained: token.startsWith("github_pat_") };
}

export async function readToken(store) {
  const record = await store.getSyncValue(SYNC_KEYS.token);
  if (!isRecord(record) || typeof record.token !== "string") return null;
  const checked = checkTokenFormat(record.token);
  return checked.ok ? checked.token : null;
}

export async function readTokenInfo(store) {
  const record = await store.getSyncValue(SYNC_KEYS.token);
  if (!isRecord(record) || !checkTokenFormat(record.token).ok) return { present: false, authFailedAt: null };
  return {
    present: true,
    savedAt: typeof record.savedAt === "string" ? record.savedAt : null,
    checkedAt: typeof record.checkedAt === "string" ? record.checkedAt : null,
    fineGrained: record.token.startsWith("github_pat_"),
    authFailedAt: authHoldOf(record),
  };
}

// Halt nach 401/403 (Vertrag 12: "Sync stoppt"): steht am Token-Datensatz, damit er auch einen Neustart der App
// uebersteht - sonst fragte jeder Start und jeder Wechsel in den Vordergrund erneut mit dem widerrufenen Token.
// Aufgehoben wird er nur durch eine Handlung des Nutzers: neues Token speichern, "Zugang pruefen" oder ⟳.
function authHoldOf(record) {
  return isRecord(record) && typeof record.authFailedAt === "string" && isUtcStamp(record.authFailedAt) ? record.authFailedAt : null;
}

async function holdAuth(store, token, now) {
  const record = await store.getSyncValue(SYNC_KEYS.token);
  // Nur das Token anhalten, das abgelehnt wurde: hat der Nutzer waehrenddessen ein neues gespeichert, bleibt es frei.
  if (!isRecord(record) || record.token !== token || authHoldOf(record)) return;
  await store.putSyncValue(SYNC_KEYS.token, { ...record, authFailedAt: isoOf(now) });
}

export async function clearAuthHold(store) {
  const record = await store.getSyncValue(SYNC_KEYS.token);
  if (!isRecord(record) || !authHoldOf(record)) return false;
  const rest = { ...record };
  delete rest.authFailedAt;
  await store.putSyncValue(SYNC_KEYS.token, rest);
  return true;
}

export async function saveToken(store, token, now = Date.now()) {
  const checked = checkTokenFormat(token);
  if (!checked.ok) throw new SyncError("token-format");
  const stamp = isoOf(now);
  await store.putSyncValue(SYNC_KEYS.token, { token: checked.token, savedAt: stamp, checkedAt: stamp });
  // Der zwischengespeicherte Index gehoerte zum alten Zugang: der neue liest frisch.
  await store.deleteSyncValue(SYNC_KEYS.index);
}

export async function removeToken(store) {
  await store.deleteSyncValue(SYNC_KEYS.token);
  await store.deleteSyncValue(SYNC_KEYS.index);
}

// ------------------------------------------------------------------ Lesen ueber die Contents-API

export function contentsUrl(path) {
  return `${STORE_API.origin}/repos/${STORE_API.owner}/${STORE_API.repo}/contents/${path}`;
}

function sleepFor(ms, signal) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", stop);
      resolve(true);
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      resolve(false);
    };
    if (signal) signal.addEventListener("abort", stop, { once: true });
  });
}

// AbortSignal.any fehlt in iOS-Safari vor 17.4: zwei Signale selbst verbinden.
export function linkSignals(...signals) {
  const active = signals.filter((s) => s && typeof s.aborted === "boolean");
  const controller = new AbortController();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

async function readBody(response, maxBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    if (response.body && typeof response.body.cancel === "function") await response.body.cancel();
    return null;
  }
  // Gestreamt mitzaehlen: Content-Length kann fehlen oder (gzip) zu klein sein - so endet ein zu grosses Paket
  // spaetestens nach maxBytes statt nach dem ganzen Download im Speicher.
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    return bytes;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.length > maxBytes ? null : bytes;
}

// Eine GET-Anfrage auf eine Speicherdatei. Ergebnis {kind, status?, bytes?, etag?, retryable?}:
// ok | not-modified | auth | not-found | rate-limit | too-large | http | network | aborted
export async function getStoreFile(deps, path, { token, etag = null, signal = null, maxBytes = STORE_FILE_MAX_BYTES } = {}) {
  const headers = { Accept: RAW_ACCEPT, Authorization: `Bearer ${token}` };
  if (etag) headers["If-None-Match"] = etag;
  let response;
  try {
    response = await deps.fetch(contentsUrl(path), {
      method: "GET",
      headers,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: signal || undefined,
    });
  } catch (error) {
    if ((signal && signal.aborted) || (error && error.name === "AbortError")) return { kind: "aborted" };
    // fetch meldet Netzfehler (auch CORS und abgelehnte Weiterleitung) als TypeError - ohne Details, mit Absicht.
    if (error instanceof TypeError) return { kind: "network", retryable: true };
    throw error;
  }
  const status = response.status;
  if (status === 304) return { kind: "not-modified", status };
  if (status === 200) {
    let bytes;
    try {
      bytes = await readBody(response, maxBytes);
    } catch (error) {
      if ((signal && signal.aborted) || (error && error.name === "AbortError")) return { kind: "aborted" };
      if (error instanceof TypeError) return { kind: "network", retryable: true };
      throw error;
    }
    if (bytes === null) return { kind: "too-large", status };
    const tag = response.headers.get("etag");
    return { kind: "ok", status, bytes, etag: typeof tag === "string" && ETAG_RE.test(tag) ? tag : null };
  }
  // Antwortkoerper von Fehlern wird nie gelesen oder angezeigt (kann Pfade nennen); nur der Status zaehlt.
  if (response.body && typeof response.body.cancel === "function") {
    try {
      await response.body.cancel();
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  }
  if (status === 401) return { kind: "auth", status };
  if (status === 403) {
    // 403 heisst meist "kein Recht". Leeres Kontingent (x-ratelimit-remaining 0) oder retry-after (Sekundaerlimit,
    // oft mit Rest-Kontingent) heisst "Limit": der Zugang ist noch gueltig, kein Halt - wie cs_pocket_transport.
    // GitHub gibt beide Koepfe per Access-Control-Expose-Headers frei (gelesen 2026-11-05).
    const remaining = response.headers.get("x-ratelimit-remaining");
    const limited = remaining === "0" || response.headers.get("retry-after") !== null;
    return limited ? { kind: "rate-limit", status } : { kind: "auth", status };
  }
  if (status === 404) return { kind: "not-found", status };
  if (status === 429) return { kind: "rate-limit", status };
  return { kind: "http", status, retryable: status >= 500 };
}

// Bis zu 3 Wiederholungen bei Netz- und Serverfehlern; Auth, 404, Limit und Groesse sind sofort endgueltig.
export async function getWithRetries(deps, path, options = {}) {
  const delays = Array.isArray(deps.retryDelaysMs) ? deps.retryDelaysMs : RETRY_DELAYS_MS;
  const sleep = typeof deps.sleep === "function" ? deps.sleep : sleepFor;
  let attempt = 0;
  for (;;) {
    const result = await getStoreFile(deps, path, options);
    if (!result.retryable || attempt >= delays.length || attempt >= 3) return { ...result, attempts: attempt + 1 };
    const waited = await sleep(delays[attempt], options.signal);
    attempt += 1;
    if (waited === false || (options.signal && options.signal.aborted)) return { kind: "aborted", attempts: attempt };
  }
}

// ------------------------------------------------------------------ Speicherdateien streng lesen

// Wie cs_pocket_transport._strict_json: kein BOM, striktes UTF-8, keine doppelten Schluessel, nur Ganzzahlen,
// Tiefe <= 32, kein __proto__. Die Form (Leerraum, Reihenfolge) ist frei - eine Hand-Aenderung bricht nicht alles.
export function parseStoreFile(bytes, code = "index-invalid") {
  if (!(bytes instanceof Uint8Array) || hasUtf8Bom(bytes)) throw new SyncError(code);
  let text;
  let value;
  try {
    text = decodeUtf8Strict(bytes);
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof CanonicalError || error instanceof SyntaxError) throw new SyncError(code);
    throw error;
  }
  if (diagnoseNonCanonical(text) !== null) throw new SyncError(code);
  try {
    canonicalize(value);
  } catch (error) {
    if (error instanceof CanonicalError) throw new SyncError(code);
    throw error;
  }
  return value;
}

function cleanHead(head) {
  return {
    seq: head.seq,
    revisionId: head.revisionId,
    committedAt: head.committedAt,
    exportedAt: head.exportedAt,
    projectName: head.projectName,
    bytes: head.bytes,
    counts: { operators: head.counts.operators, codeSources: head.counts.codeSources },
    rootPath: head.rootPath,
  };
}

// Kopf nach cs_pocket_transport._is_head.
export function isHead(head) {
  return isRecord(head) && isInt(head.seq, 1) && typeof head.revisionId === "string" && PATTERNS.revisionId.test(head.revisionId)
    && isUtcStamp(head.committedAt) && isUtcStamp(head.exportedAt) && isText(head.projectName, 120)
    && isInt(head.bytes, 0) && isRecord(head.counts) && isInt(head.counts.operators, 0)
    && isInt(head.counts.codeSources, 0) && isText(head.rootPath, 1024);
}

// index.json: Format, Version, Projektliste mit eindeutigen IDs, Status und Kopf (Vertrag 11, Pruefung wie der
// Python-Transport). Zurueck kommt eine bereinigte Kopie nur mit bekannten Feldern.
export function checkIndex(value) {
  if (!isRecord(value) || value.format !== INDEX_FORMAT) throw new SyncError("index-invalid");
  if (Number.isSafeInteger(value.version) && value.version > 1) throw new SyncError("index-newer");
  if (value.version !== 1 || !Array.isArray(value.projects)) throw new SyncError("index-invalid");
  const seen = new Set();
  const projects = [];
  for (const entry of value.projects) {
    const valid = isRecord(entry) && typeof entry.projectId === "string" && PATTERNS.projectId.test(entry.projectId)
      && (entry.status === "active" || entry.status === "deleted") && Object.hasOwn(entry, "head")
      && (entry.head === null || isHead(entry.head));
    if (!valid || seen.has(entry.projectId)) throw new SyncError("index-invalid");
    seen.add(entry.projectId);
    projects.push({ projectId: entry.projectId, status: entry.status, head: entry.head === null ? null : cleanHead(entry.head) });
  }
  return { format: INDEX_FORMAT, version: 1, projects };
}

export function checkStoreMarker(value) {
  if (!isRecord(value) || value.format !== STORE_FORMAT) throw new SyncError("store-invalid");
  if (Number.isSafeInteger(value.version) && value.version > 1) throw new SyncError("store-newer");
  if (value.version !== 1) throw new SyncError("store-invalid");
  return true;
}

// Zugang pruefen: store.json lesen (gleiche Anfrageform wie der Abgleich). Ein Versuch, keine Wiederholung -
// der Nutzer wartet am Knopf.
export async function checkAccess(deps, token, { signal = null } = {}) {
  const format = checkTokenFormat(token);
  if (!format.ok) return { state: "token-format" };
  const result = await getStoreFile(deps, "store.json", { token: format.token, signal });
  if (result.kind !== "ok") return { state: result.kind === "not-modified" ? "http" : result.kind };
  try {
    checkStoreMarker(parseStoreFile(result.bytes, "store-invalid"));
  } catch (error) {
    if (error instanceof SyncError) return { state: error.code };
    throw error;
  }
  return { state: "ok", fineGrained: format.fineGrained };
}

// ------------------------------------------------------------------ Abgleich

// Gemerkter Index: ETag fuer die bedingte Anfrage und die Index-Koepfe fuer "Lokal entfernt" (Name, Stand). Ohne
// ETag (Server schickt keinen) bleibt er trotzdem stehen, wird dann aber nie als Antwort auf 304 benutzt.
async function readIndexCache(store) {
  const cached = await store.getSyncValue(SYNC_KEYS.index);
  if (!isRecord(cached)) return null;
  const etag = typeof cached.etag === "string" && ETAG_RE.test(cached.etag) ? cached.etag : null;
  // Der Store "sync" liegt in der geteilten Origin (Vertrag 15): den gemerkten Index jedes Mal neu pruefen.
  try {
    return { etag, index: checkIndex(cached.index) };
  } catch (error) {
    if (error instanceof SyncError) return null;
    throw error;
  }
}

// Lokal entfernte Projekte, die der Speicher (zuletzt gesehener Index) noch aktiv mit Kopf fuehrt: Vertrag 13
// verbietet nur das AUTOMATISCHE Laden - die Oberflaeche bietet sie mit "Wieder laden" an. Legt nichts an.
// Ergebnis [{projectId, head}] in Index-Reihenfolge; ohne gemerkten Index (kein Zugang, nie abgeglichen) leer.
export async function listLocallyRemoved(store) {
  const cached = await readIndexCache(store);
  if (!cached) return [];
  const rows = [];
  for (const entry of cached.index.projects) {
    if (entry.status !== "active" || entry.head === null) continue;
    if (await store.isLocallyRemoved(entry.projectId)) rows.push({ projectId: entry.projectId, head: entry.head });
  }
  return rows;
}

async function readFailure(store, projectId) {
  const value = await store.getUiState(FAILURE_KEY_PREFIX + projectId);
  return isRecord(value) && typeof value.code === "string" ? value : null;
}

// Unter der Epoche des Laufs: nach "lokale Projekte loeschen" (auch aus einem zweiten Tab) entsteht kein Vermerk mehr,
// der Lauf endet stattdessen.
async function writeFailure(store, projectId, failure, epoch) {
  const saved = await store.putUiState(FAILURE_KEY_PREFIX + projectId, failure, { projectId, epoch });
  if (saved && saved.status === "aborted") throw new SyncStop("aborted");
}

async function clearFailure(store, projectId) {
  await store.deleteUiState(FAILURE_KEY_PREFIX + projectId);
}

function sameHead(a, b) {
  return isRecord(a) && isRecord(b) && a.seq === b.seq && a.revisionId === b.revisionId && a.committedAt === b.committedAt
    && a.projectName === b.projectName && a.exportedAt === b.exportedAt && a.bytes === b.bytes;
}

class SyncStop extends Error {
  constructor(state) {
    super(syncMessage(state));
    this.name = "SyncStop";
    this.state = state;
  }
}

// Paket eines Kopfes laden, pruefen (mit Bindung an den Index-Eintrag) und aktivieren - im Single-Flight des Speichers.
async function downloadHead(deps, entry, token, options) {
  const { store } = deps;
  const { projectId, head } = entry;
  const failed = async (code, extra = {}) => {
    const failure = { code, seq: head.seq, revisionId: head.revisionId, at: isoOf(deps.now()), ...extra };
    await writeFailure(store, projectId, failure, options.epoch);
    return { state: "failed", ...failure };
  };
  if (head.bytes > POCKET_MAX_BYTES) return failed("too-large");
  if (!options.force) {
    const previous = await readFailure(store, projectId);
    if (previous && isPermanentFailure(previous.code) && previous.revisionId === head.revisionId && previous.seq === head.seq) {
      return { state: "failed", skipped: true, code: previous.code, seq: head.seq, revisionId: head.revisionId, category: previous.category };
    }
  }
  options.onProject(projectId, { state: "loading", seq: head.seq });
  // Die Epoche vom Start des ganzen Laufs, nicht die beim Start dieses Downloads (Befund kern-f1).
  return store.syncProject(projectId, async (flightSignal) => {
    const signal = linkSignals(options.signal, flightSignal);
    const got = await getWithRetries(deps, `projects/${projectId}/revisions/${head.revisionId}.json`, {
      token, signal, maxBytes: POCKET_MAX_BYTES,
    });
    if (got.kind === "aborted") return { state: "aborted" };
    if (got.kind === "auth") throw new SyncStop("auth");
    if (got.kind === "rate-limit") throw new SyncStop("rate-limit");
    if (got.kind !== "ok") return failed(got.kind === "not-found" ? "revision-missing" : got.kind);
    const verified = await verifyPackage(got.bytes, { index: { projectId, revisionId: head.revisionId, seq: head.seq } });
    if (!verified.ok) {
      const first = verified.errors[0] || {};
      return failed("package-invalid", { stage: verified.stage, check: first.code || null, category: first.category || null });
    }
    let result;
    try {
      // explicit nur auf ausdrueckliche Wahl ("Speicherstand laden"): dann sperren seq-Gleichstand und kleinere seq
      // nicht (Vertrag 13: aeltere/andere Revision nur auf ausdrueckliche Wahl).
      result = await store.activate(verified, { head, signal, explicit: options.explicit === true });
    } catch (error) {
      if (!(error instanceof StoreError)) throw error;
      const extra = error.code === "quota" && error.detail && error.detail.estimate ? { estimate: error.detail.estimate } : {};
      return failed(`store-${error.code}`, extra);
    }
    switch (result.status) {
      case "activated":
      case "already-active":
        await clearFailure(store, projectId);
        return { state: result.status === "activated" ? "activated" : "current", seq: head.seq, revisionId: head.revisionId };
      case "stale":
        return { state: "older", seq: head.seq, activeSeq: result.activeSeq };
      case "seq-conflict":
        return { state: "conflict", seq: head.seq };
      case "deleted":
        return { state: "removed" };
      default:
        // Lokale Projekte wurden geloescht (Epoche): der ganze Lauf endet, kein weiteres Projekt wird angelegt.
        if (result.reason === "cleared") throw new SyncStop("aborted");
        return { state: "aborted", reason: result.reason || null };
    }
  }, { epoch: options.epoch });
}

// Index gegen den lokalen Stand halten: Grabstein und fehlende Projekte markieren (nie still loeschen), neuere Koepfe
// laden, kleinere seq nur melden (Vertrag 13). Gibt je Projekt einen Zustand zurueck.
async function reconcile(deps, index, token, options) {
  const { store } = deps;
  const records = new Map((await store.listProjects()).map((p) => [p.projectId, p]));
  const results = new Map();
  const listed = new Set();
  const report = (projectId, state) => {
    results.set(projectId, state);
    options.onProject(projectId, state);
  };
  // Unter der Epoche des Laufs: nach "lokale Projekte loeschen" legt markServerState nichts an, der Lauf endet.
  const mark = async (projectId, info) => {
    const marked = await store.markServerState(projectId, info, { epoch: options.epoch });
    if (marked && marked.status === "aborted") throw new SyncStop("aborted");
  };
  for (const entry of index.projects) {
    if (options.signal && options.signal.aborted) break;
    const { projectId } = entry;
    listed.add(projectId);
    const local = records.get(projectId) || null;
    if (entry.status === "deleted") {
      // Grabstein: lokale Kopie bleibt und wird nur markiert; ohne lokale Kopie entsteht kein Eintrag.
      if (local && local.serverStatus !== "deleted") await mark(projectId, { status: "deleted" });
      if (local) report(projectId, { state: "deleted" });
      continue;
    }
    if (local && local.serverStatus === "deleted") {
      // Ein Grabstein ist endgueltig (Vertrag 10): die projectId nimmt nie wieder Koepfe an.
      report(projectId, { state: "deleted" });
      continue;
    }
    if (await store.isLocallyRemoved(projectId)) {
      results.set(projectId, { state: "removed" });
      continue;
    }
    if (!local || local.serverStatus !== "active" || !sameHead(local.indexHead, entry.head)) {
      await mark(projectId, { status: "active", head: entry.head });
    }
    if (entry.head === null) {
      report(projectId, { state: "no-head" });
      continue;
    }
    const activeSeq = local && Number.isSafeInteger(local.activeSeq) ? local.activeSeq : 0;
    const forced = options.force === true || (options.forceProjects instanceof Set && options.forceProjects.has(projectId));
    // "Speicherstand laden": ausdrueckliche Wahl je Projekt. Nie aus force (⟳ fuer alle) - ein Konflikt wird nie
    // still aufgeloest (Vertrag 10); die bisherige Revision bleibt als vorherige erhalten (store.js).
    const adopt = options.adoptProjects instanceof Set && options.adoptProjects.has(projectId);
    if (entry.head.seq > activeSeq) {
      report(projectId, await downloadHead(deps, entry, token, { ...options, force: forced }));
    } else if (adopt && local.activeRevision !== entry.head.revisionId) {
      report(projectId, await downloadHead(deps, entry, token, { ...options, force: true, explicit: true }));
    } else if (entry.head.seq < activeSeq) {
      report(projectId, { state: "older", seq: entry.head.seq, activeSeq });
    } else if (local.activeRevision !== entry.head.revisionId) {
      report(projectId, { state: "conflict", seq: entry.head.seq });
    } else {
      report(projectId, { state: "current", seq: entry.head.seq });
    }
  }
  if (options.signal && options.signal.aborted) return results;
  for (const [projectId, local] of records) {
    if (listed.has(projectId)) continue;
    // Nie auf dem Speicher gesehen (nur aus einer Datei importiert): nichts zu markieren.
    if (local.serverStatus === null && local.indexHead === null) {
      results.set(projectId, { state: "local-only" });
      continue;
    }
    // Ein bekannter Grabstein bleibt Grabstein, auch wenn der Eintrag spaeter aus dem Index faellt.
    if (local.serverStatus === "deleted") {
      report(projectId, { state: "deleted" });
      continue;
    }
    if (local.serverStatus !== "missing") await mark(projectId, { status: "missing" });
    report(projectId, { state: "missing" });
  }
  return results;
}

// Ein ganzer Abgleich. deps: {store, fetch, now, sleep?, online?, retryDelaysMs?}. options: {signal, force,
// forceProjects (Set), adoptProjects (Set: Speicherstand ausdruecklich uebernehmen), retryAuth (manueller Lauf:
// auch nach 401/403 erneut fragen), onProject(projectId, state)}. Ergebnis {state, projects: Map, checkedAt}.
export async function syncOnce(deps, options = {}) {
  const { store } = deps;
  const opts = {
    signal: options.signal || null,
    force: options.force === true,
    forceProjects: options.forceProjects instanceof Set ? options.forceProjects : null,
    adoptProjects: options.adoptProjects instanceof Set ? options.adoptProjects : null,
    onProject: typeof options.onProject === "function" ? options.onProject : () => {},
  };
  const done = (state, extra = {}) => ({ state, projects: new Map(), checkedAt: isoOf(deps.now()), ...extra });
  if (!store) return done("unavailable");
  // Loesch-Epoche EINMAL je Lauf, vor dem Token: jede Schreib-Transaktion dieses Laufs prueft sie (store.js). Ein
  // "Abmelden + lokale Projekte loeschen" danach - auch in einem zweiten Tab - beendet den Lauf, statt dass spaetere
  // Projekte aus dem schon gelesenen Index und mit dem Token im Arbeitsspeicher wieder angelegt werden.
  opts.epoch = await store.syncEpoch();
  const token = await readToken(store);
  if (!token) return done("no-token");
  // Angehalten nach 401/403: ohne ausdruecklichen Lauf keine Anfrage mit diesem Token (Vertrag 12).
  if (options.retryAuth !== true && authHoldOf(await store.getSyncValue(SYNC_KEYS.token))) return done("auth", { held: true });
  if (typeof deps.online === "function" && deps.online() === false) return done("offline");
  const cached = await readIndexCache(store);
  const got = await getWithRetries(deps, "projects/index.json", {
    token, etag: cached ? cached.etag : null, signal: opts.signal, maxBytes: STORE_FILE_MAX_BYTES,
  });
  let index;
  let state;
  if (got.kind === "not-modified" && cached && cached.etag) {
    index = cached.index;
    state = "not-modified";
  } else if (got.kind === "ok") {
    try {
      index = checkIndex(parseStoreFile(got.bytes));
    } catch (error) {
      if (error instanceof SyncError) return done(error.code);
      throw error;
    }
    const saved = await store.putSyncValue(SYNC_KEYS.index, { etag: got.etag, index, fetchedAt: isoOf(deps.now()) }, { epoch: opts.epoch });
    if (saved && saved.status === "aborted") return done("aborted");
    state = "ok";
  } else {
    if (got.kind === "auth") await holdAuth(store, token, deps.now());
    // 304 ohne gemerkten ETag kann nur ein falscher Server sein: wie ein Serverfehler behandeln.
    return done(got.kind === "not-modified" ? "http" : got.kind, { status: got.status ?? null });
  }
  // Der Speicher hat diesen Zugang gerade angenommen: ein alter Halt ist erledigt.
  await clearAuthHold(store);
  let projects;
  try {
    projects = await reconcile(deps, index, token, opts);
  } catch (error) {
    if (!(error instanceof SyncStop)) throw error;
    if (error.state === "auth") await holdAuth(store, token, deps.now());
    return done(error.state);
  }
  if (opts.signal && opts.signal.aborted) return done("aborted", { projects });
  return done(state, { projects });
}

// ------------------------------------------------------------------ Datei-Import (ohne Speicher-Index)

// Lokal importiertes Paket: dieselbe Pruefung wie beim Download, gebunden an sich selbst (projectId/revision.id aus dem
// gepruefen Paket). seq: bekannte Revision -> ihre seq vom Speicher; sonst die aktive seq (ein spaeterer, neuerer
// Kopf vom Speicher gewinnt wieder); neues Projekt -> 1. Aktivierung ausdruecklich (explicit), committedAt null
// kennzeichnet "lokal importiert".
export async function importPackageFile(deps, file) {
  const { store } = deps;
  if (!store) return { ok: false, code: "unavailable" };
  if (!file || typeof file.arrayBuffer !== "function") return { ok: false, code: "import-input" };
  if (Number.isSafeInteger(file.size) && file.size > POCKET_MAX_BYTES) return { ok: false, code: "import-too-large" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const first = await verifyPackage(bytes, { unbound: true });
  if (!first.ok) return { ok: false, code: "package-invalid", stage: first.stage, errors: first.errors.slice(0, 5) };
  const { projectId, revisionId, doc } = first;
  const report = {
    projectId, revisionId, projectName: doc.projectName, unknownFields: first.unknownFields.length,
    entryErrors: first.entryErrors.length,
  };
  const project = await store.getProject(projectId);
  if (project && project.activeRevision === revisionId) return { ok: true, status: "already-active", ...report };
  // Ausdrueckliches Laden einer Datei hebt "lokal entfernt, nicht automatisch laden" auf.
  if (await store.isLocallyRemoved(projectId)) await store.clearLocalRemoval(projectId);
  const known = (await store.listRevisions(projectId)).find((r) => r.revisionId === revisionId) || null;
  let seq = 1;
  if (known && isInt(known.lastSeq, 1)) seq = known.lastSeq;
  else if (project && isInt(project.activeSeq, 1)) seq = project.activeSeq;
  const bound = await verifyPackage(bytes, { index: { projectId, revisionId, seq } });
  if (!bound.ok) return { ok: false, code: "package-invalid", stage: bound.stage, errors: bound.errors.slice(0, 5) };
  const head = {
    seq, revisionId, committedAt: null, exportedAt: doc.exportedAt, projectName: doc.projectName, bytes: bound.byteLength,
    counts: { operators: doc.operators.length, codeSources: doc.codeSources.length }, rootPath: doc.exportRoot.path,
  };
  let result;
  try {
    result = await store.activate(bound, { head, explicit: true });
  } catch (error) {
    if (!(error instanceof StoreError)) throw error;
    return { ok: false, code: error.code === "quota" ? "store-quota" : "store-error", storeCode: error.code, ...report };
  }
  await clearFailure(store, projectId);
  return { ok: result.status === "activated" || result.status === "already-active", status: result.status, seq, ...report };
}

// Meldung zu einem abgelehnten Paket: feste Vorlage der Pruefstufe (verify.js), nie Inhalte.
export function packageProblemText(errors) {
  const first = Array.isArray(errors) && errors.length ? errors[0] : null;
  return first ? messageFor(first.code) : "Paket abgelehnt.";
}

// ------------------------------------------------------------------ Steuerung: Ausloeser, Entprellen, Single-Flight

// Ein Abgleich zur Zeit. Automatische Ausloeser (start, visible, online) werden entprellt; nach einem erfolgreichen
// Lauf zaehlt eine Mindestpause. "manual" startet sofort. Kommt waehrend eines Laufs ein Ausloeser, folgt genau EIN
// Nachlauf. Kein Timer haelt die App wach: ohne neuen Ausloeser passiert nichts (kein Hintergrund-Versprechen).
// Jeder Aufruf von request() bekommt ein Versprechen, das sich sicher erfuellt (Ergebnis des Laufs oder null).
export class SyncController {
  constructor(deps, options = {}) {
    this.deps = deps;
    this.debounceMs = Number.isFinite(options.debounceMs) ? options.debounceMs : DEFAULT_DEBOUNCE_MS;
    this.minIntervalMs = Number.isFinite(options.minIntervalMs) ? options.minIntervalMs : DEFAULT_MIN_INTERVAL_MS;
    this.onChange = typeof options.onChange === "function" ? options.onChange : () => {};
    this.setTimer = typeof options.setTimer === "function" ? options.setTimer : (fn, ms) => setTimeout(fn, ms);
    this.clearTimer = typeof options.clearTimer === "function" ? options.clearTimer : (id) => clearTimeout(id);
    this.running = false;
    this.lastResult = null;
    this.lastSuccessAt = null;
    this.live = new Map();
    this.runs = 0;
    this._debounce = null;
    this._followUp = null;
    this._controller = null;
    this._current = null;
  }

  projectState(projectId) {
    return this.live.get(projectId) || null;
  }

  // trigger: start | visible | online | manual. options: {force, projectId, adopt}. adopt (nur mit projectId) =
  // "Speicherstand laden" fuer dieses Projekt, auch bei Konflikt oder kleinerer seq.
  request(trigger, options = {}) {
    const one = options.projectId ? new Set([options.projectId]) : new Set();
    const job = { trigger, force: options.force === true, projects: one, adopt: options.adopt === true ? new Set(one) : new Set() };
    if (this._current) return this._queueFollowUp(job);
    if (trigger === "manual") {
      const waiting = this._takeDebounce();
      const run = this._start(waiting ? this._merge(waiting.job, job) : job);
      if (waiting) waiting.resolve(run);
      return run;
    }
    const recent = this.lastSuccessAt !== null && this.deps.now() - this.lastSuccessAt < this.minIntervalMs;
    if (recent && trigger !== "start") return Promise.resolve(null);
    return this._debounceJob(job);
  }

  cancel() {
    const waiting = this._takeDebounce();
    if (waiting) waiting.resolve(null);
    const next = this._followUp;
    this._followUp = null;
    if (next) next.resolve(null);
    if (this._controller) this._controller.abort();
  }

  _deferred(job) {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { job, promise, resolve, timer: null };
  }

  _queueFollowUp(job) {
    if (this._followUp) this._followUp.job = this._merge(this._followUp.job, job);
    else this._followUp = this._deferred(job);
    return this._followUp.promise;
  }

  // Weitere Ausloeser innerhalb der Frist verschieben den Start und teilen sich EIN Versprechen.
  _debounceJob(job) {
    if (this._debounce) {
      this._debounce.job = this._merge(this._debounce.job, job);
      this.clearTimer(this._debounce.timer);
    } else {
      this._debounce = this._deferred(job);
    }
    const pending = this._debounce;
    pending.timer = this.setTimer(() => {
      if (this._debounce !== pending) return;
      this._debounce = null;
      pending.resolve(this._current ? this._queueFollowUp(pending.job) : this._start(pending.job));
    }, this.debounceMs);
    return pending.promise;
  }

  _takeDebounce() {
    const waiting = this._debounce;
    if (!waiting) return null;
    this.clearTimer(waiting.timer);
    this._debounce = null;
    return waiting;
  }

  _merge(a, b) {
    if (!a) return b;
    return {
      trigger: b.trigger === "manual" ? "manual" : a.trigger,
      force: a.force || b.force,
      projects: new Set([...a.projects, ...b.projects]),
      adopt: new Set([...a.adopt, ...b.adopt]),
    };
  }

  _start(job) {
    const controller = new AbortController();
    this._controller = controller;
    this.running = true;
    this.runs += 1;
    for (const [projectId, state] of this.live) if (state.state === "loading") this.live.delete(projectId);
    this.onChange({ type: "start", trigger: job.trigger });
    const run = (async () => {
      let result;
      try {
        result = await syncOnce(this.deps, {
          signal: controller.signal,
          force: job.force,
          forceProjects: job.projects,
          adoptProjects: job.adopt,
          // Nur ein ausdruecklicher Lauf fragt nach 401/403 erneut (Vertrag 12: "Sync stoppt").
          retryAuth: job.trigger === "manual",
          onProject: (projectId, state) => {
            this.live.set(projectId, { ...state, at: this.deps.now() });
            this.onChange({ type: "project", projectId, state });
          },
        });
      } catch (error) {
        // StoreError (Speicher voll, Verbindung verloren ausserhalb einer Aktivierung) ist ein erwarteter Zustand.
        // Alles andere ist ein Programmfehler: sichtbar in der Konsole, der Lauf endet trotzdem sauber mit "error".
        if (!(error instanceof StoreError)) console.error(error);
        const state = error instanceof StoreError ? (error.code === "quota" ? "store-quota" : "store-error") : "error";
        result = { state, projects: new Map(), checkedAt: null, reload: Boolean(error && error.detail && error.detail.reload) };
      }
      if (controller.signal.aborted && result.state !== "aborted") result = { ...result, state: "aborted" };
      for (const [projectId, state] of this.live) if (state.state === "loading") this.live.delete(projectId);
      this.lastResult = result;
      if (result.state === "ok" || result.state === "not-modified") this.lastSuccessAt = this.deps.now();
      return result;
    })();
    this._current = run;
    return run.finally(() => {
      this._current = null;
      this._controller = null;
      this.running = false;
      this.onChange({ type: "finish", result: this.lastResult });
      const next = this._followUp;
      this._followUp = null;
      if (next) next.resolve(this._start(next.job));
    });
  }
}
