// Projektspeicher (Vertrag Abschnitt 13): IndexedDB "cspp-projects-v1" und MemoryStore mit derselben Schnittstelle.
// Stores: projects, revisions, packages, notes, uistate, sync. Kein localStorage, kein Kurs-Praefix.
//
// Regeln, die hier durchgesetzt werden:
// - Pruefen, Hashen, Laden passieren VOR jeder Transaktion (verify.js). Transaktionen enthalten nur IDB-Anfragen im
//   Callback-Stil - nie ein await auf fetch/crypto.subtle, sonst committet IndexedDB still mittendrin.
// - Aktivierung in EINER readwrite-Transaktion: schreibt nur bei head.seq > activeSeq und ohne Loeschvermerk.
//   Der Store "sync" ist dafuer mit in der Transaktion (nur gelesen), damit der Loeschvermerk atomar geprueft wird.
// - Fehler -> Transaktion bricht ab -> alte aktive Revision bleibt, nichts halb geschrieben (auch bei Quota).
// - Kurze Transaktionen mit Zeitlimit; onabort/onerror/versionchange; "connection lost" -> einmal neu oeffnen,
//   danach Fehler mit reload:true (die Oberflaeche laedt kontrolliert neu).
// - Pro Projekt hoechstens ein Abgleich gleichzeitig (ProjectFlights); Loeschen bricht ihn ab.
// - "Lokale Projekte loeschen" beim Abmelden zaehlt eine Epoche im Store sync hoch. Ein Abgleich liest sie EINMAL
//   zu Beginn (sync.js syncOnce) und gibt sie jeder seiner Schreib-Transaktionen mit (Aktivierung, Serverzustand,
//   gemerkter Index, Fehlervermerk). Jede prueft darin, dass die Epoche noch dieselbe ist, sonst schreibt sie nichts
//   ({status:"aborted", reason:"cleared"}) und der ganze Lauf endet: ein Abgleich, der vor dem Loeschen begann, legt
//   danach nichts wieder an - auch nicht aus einem zweiten Tab derselben Origin (dort bricht clearProjects die
//   laufenden Abgleiche nicht ab, die gehoeren dem anderen Tab).
// - Aufbewahrung: aktives und vorheriges Paket bleiben, aeltere Pakete gehen, Revisions-Metadaten bleiben.

import { validateAnchor } from "./anchors.js";
import { PATTERNS } from "./schema.js";
import { codepointLength } from "./c14n.js";

export const DB_NAME = "cspp-projects-v1";
export const DB_VERSION = 1;
export const STORE_NAMES = Object.freeze(["projects", "revisions", "packages", "notes", "uistate", "sync"]);
export const LOCAL_REMOVED_PREFIX = "local-removed:";
export const CLEAR_EPOCH_KEY = "local-cleared-epoch";
export const NOTES_FORMAT = "codesearch.pocket.notes";
export const NOTES_WARNING = "Enthält Ausschnitte aus privatem Code.";
export const DEFAULT_TX_TIMEOUT_MS = 10000;
export const DEFAULT_OPEN_TIMEOUT_MS = 10000;
export const MAX_NOTE_CHARS = 100000;
export const MAX_IMPORT_NOTES = 20000;

const KEY_PATHS = Object.freeze({
  projects: "projectId",
  revisions: ["projectId", "revisionId"],
  packages: ["projectId", "revisionId"],
  notes: "id",
  uistate: "key",
  sync: "key",
});
const BY_PROJECT = new Set(["revisions", "packages", "notes", "uistate"]);
const ACTIVATION_STORES = ["projects", "revisions", "packages", "sync"];
const PROJECT_DATA_STORES = ["projects", "revisions", "packages", "uistate", "sync"];

// Feste Meldungen je Code; nie Inhalte, nie Browser-Fehlertexte (die koennen Schluessel nennen).
const MESSAGES = Object.freeze({
  quota: "Speicher voll: nichts wurde geschrieben.",
  timeout: "Speicher antwortet nicht rechtzeitig.",
  "connection-lost": "Verbindung zum Speicher verloren. Seite neu laden.",
  unavailable: "IndexedDB ist hier nicht verfügbar.",
  blocked: "Speicher ist durch ein anderes Fenster blockiert.",
  version: "Speicher stammt aus einer neueren App-Version.",
  aborted: "Abgleich abgebrochen.",
  "integrity-conflict": "Revision existiert lokal mit anderem Inhalt; nichts überschrieben.",
  invalid: "Ungültige Eingabe für den Projektspeicher.",
  closed: "Projektspeicher ist geschlossen.",
  error: "Speicherfehler.",
});

export class StoreError extends Error {
  constructor(code, detail = {}) {
    super(MESSAGES[code] || MESSAGES.error);
    this.name = "StoreError";
    this.code = code;
    this.detail = detail;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function randomHex(bytes) {
  const data = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(data);
  return Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function newNoteId() {
  return `note_${randomHex(16)}`;
}

function removedKey(projectId) {
  return LOCAL_REMOVED_PREFIX + projectId;
}

// Loeschvermerke und Epoche gehoeren dem Speicher selbst; sync.js darf sie weder setzen noch loeschen.
function isReservedSyncKey(key) {
  return key.startsWith(LOCAL_REMOVED_PREFIX) || key === CLEAR_EPOCH_KEY;
}

function epochOf(record) {
  return record && Number.isSafeInteger(record.value) ? record.value : 0;
}

// Schreiben fuer einen laufenden Abgleich: der Koerper laeuft nur, wenn die Loesch-Epoche in DIESER Transaktion noch
// die vom Start des Abgleichs ist (epoch keine Ganzzahl = ohne diese Pruefung). Die Transaktion braucht den Store sync.
function underEpoch(epoch, body) {
  if (!Number.isSafeInteger(epoch)) return body;
  return (tx) => {
    tx.get("sync", CLEAR_EPOCH_KEY, (record) => {
      if (epochOf(record) !== epoch) {
        tx.result = { ...ABORTED, reason: "cleared" };
        return;
      }
      body(tx);
    });
  };
}

// DOMException & Co. auf feste Codes abbilden. Nur der Name bleibt als Detail, nie die Meldung.
function mapError(error) {
  if (error instanceof StoreError) return error;
  const name = error && typeof error.name === "string" ? error.name : "";
  const text = error && typeof error.message === "string" ? error.message : "";
  if (name === "QuotaExceededError") return new StoreError("quota", { name });
  if (name === "VersionError") return new StoreError("version", { name });
  if (name === "AbortError") return new StoreError("aborted", { name });
  if (name === "TimeoutError") return new StoreError("timeout", { name });
  // WebKit: "UnknownError: Connection to Indexed Database server lost" bzw. geschlossene Verbindung.
  if (name === "UnknownError" || name === "InvalidStateError" || /connection.*lost/i.test(text)) {
    return new StoreError("connection-lost", { name });
  }
  return new StoreError("error", { name: name || "Error" });
}

// ------------------------------------------------------------------ Single-Flight je Projekt

const ABORTED = Object.freeze({ status: "aborted" });

// Hoechstens ein Abgleich je Projekt. Ausloeser waehrend eines Laufs warten auf EINEN Nachlauf (der neueste
// Auftrag gewinnt), statt parallel zu laden. abort() bricht den Lauf ab (AbortSignal) und streicht den Nachlauf.
export class ProjectFlights {
  constructor() {
    this._slots = new Map();
  }

  run(projectId, task) {
    let slot = this._slots.get(projectId);
    if (!slot) {
      slot = { current: null, next: null };
      this._slots.set(projectId, slot);
    }
    if (!slot.current) return this._start(projectId, slot, task);
    if (!slot.next) {
      let resolve;
      let rejectNext;
      const promise = new Promise((res, rej) => {
        resolve = res;
        rejectNext = rej;
      });
      slot.next = { task, promise, resolve, reject: rejectNext };
    } else {
      slot.next.task = task;
    }
    return slot.next.promise;
  }

  // Der Auftrag startet synchron: ein abort() direkt nach run() erreicht ihn sicher. slot.current steht vorher,
  // damit ein Auftrag, der selbst run() fuer dasselbe Projekt ruft, in den Nachlauf geht statt parallel.
  _start(projectId, slot, task) {
    const controller = new AbortController();
    slot.current = { controller, promise: null };
    let promise;
    try {
      promise = Promise.resolve(task(controller.signal));
    } catch (error) {
      promise = Promise.reject(error);
    }
    slot.current.promise = promise;
    const settle = () => {
      slot.current = null;
      const next = slot.next;
      slot.next = null;
      if (next) this._start(projectId, slot, next.task).then(next.resolve, next.reject);
      else if (this._slots.get(projectId) === slot) this._slots.delete(projectId);
    };
    promise.then(settle, settle);
    return promise;
  }

  abort(projectId) {
    const slot = this._slots.get(projectId);
    if (!slot) return false;
    if (slot.next) {
      slot.next.resolve(ABORTED);
      slot.next = null;
    }
    if (slot.current) slot.current.controller.abort();
    return true;
  }

  // Abmelden: alle laufenden und wartenden Abgleiche stoppen. Zaehlt die betroffenen Projekte.
  abortAll() {
    let count = 0;
    for (const projectId of [...this._slots.keys()]) if (this.abort(projectId)) count += 1;
    return count;
  }

  isRunning(projectId) {
    const slot = this._slots.get(projectId);
    return Boolean(slot && slot.current);
  }
}

// ------------------------------------------------------------------ Eingaben pruefen (vor jeder Transaktion)

function cleanHead(head, fallback) {
  const source = isRecord(head) ? head : fallback;
  const str = (v, max = 1024) => (typeof v === "string" && codepointLength(v) <= max ? v : null);
  const int = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
  const counts = isRecord(source.counts) ? source.counts : {};
  return {
    seq: Number.isSafeInteger(source.seq) ? source.seq : null,
    revisionId: typeof source.revisionId === "string" && PATTERNS.revisionId.test(source.revisionId) ? source.revisionId : null,
    committedAt: str(source.committedAt),
    exportedAt: str(source.exportedAt),
    projectName: str(source.projectName, 120),
    bytes: int(source.bytes),
    counts: { operators: int(counts.operators), codeSources: int(counts.codeSources) },
    rootPath: str(source.rootPath),
  };
}

function activationInput(verified, options, now) {
  const ok = isRecord(verified) && verified.ok === true && verified.bound === true && isRecord(verified.doc)
    && Number.isSafeInteger(verified.seq) && verified.seq >= 1
    && PATTERNS.projectId.test(String(verified.projectId)) && PATTERNS.revisionId.test(String(verified.revisionId))
    && PATTERNS.hash.test(String(verified.contentHash)) && verified.bytes instanceof Uint8Array;
  if (!ok) throw new StoreError("invalid", { what: "verified" });
  const { doc, seq, projectId, revisionId } = verified;
  const counts = { operators: doc.operators.length, codeSources: doc.codeSources.length };
  const fallback = {
    seq, revisionId, committedAt: null, exportedAt: doc.exportedAt, projectName: doc.projectName,
    bytes: verified.byteLength, counts, rootPath: doc.exportRoot.path,
  };
  const head = cleanHead(options.head, fallback);
  // Der Kopf muss zur gepruefen Bindung passen - sonst haette verify.js etwas anderes gebunden als hier aktiviert wird.
  if (head.seq !== seq || head.revisionId !== revisionId) throw new StoreError("invalid", { what: "head" });
  const signal = options.signal && typeof options.signal.aborted === "boolean" ? options.signal : null;
  return {
    projectId,
    revisionId,
    seq,
    contentHash: verified.contentHash,
    explicit: options.explicit === true,
    signal,
    epoch: null,
    now,
    head,
    // Eigene Kopie (Buffer.slice() in Node teilt den Speicher): spaetere Aenderungen am Puffer erreichen den Speicher nie.
    pkg: {
      projectId, revisionId, bytes: new Uint8Array(verified.bytes), byteLength: verified.byteLength,
      integrity: verified.integrity, storedAt: now,
    },
    meta: {
      projectId, revisionId, contentHash: verified.contentHash, analysisHash: verified.analysisHash,
      integrity: verified.integrity, exportedAt: doc.exportedAt, projectName: doc.projectName,
      byteLength: verified.byteLength, counts, rootPath: doc.exportRoot.path, basedOnSeq: doc.revision.basedOnSeq,
      firstSeq: seq, lastSeq: seq, storedAt: now,
    },
  };
}

function newProjectRecord(projectId, now) {
  return {
    projectId,
    localName: null,
    activeRevision: null,
    activeSeq: 0,
    previousRevision: null,
    previousSeq: 0,
    activeHead: null,
    indexHead: null,
    serverStatus: null,
    serverCheckedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

// Anzeigename: lokaler Name -> projectName des aktiven Kopfes -> Index-Name (Vertrag 13).
export function projectDisplayName(record) {
  if (!isRecord(record)) return "";
  if (record.localName) return record.localName;
  if (record.activeHead && record.activeHead.projectName) return record.activeHead.projectName;
  if (record.indexHead && record.indexHead.projectName) return record.indexHead.projectName;
  return record.projectId;
}

const ANCHOR_KEYS = ["projectId", "kind", "op", "origPath", "source", "symbol", "startLine", "endLine", "excerpt",
  "before", "after", "textHash", "sourceSha256", "revisionId"];

// Nur bekannte Felder uebernehmen: eine importierte Datei darf nichts Fremdes in den Speicher schmuggeln.
export function cleanNote(raw) {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || !/^note_[0-9a-f]{32}$/.test(raw.id)) return null;
  if (typeof raw.projectId !== "string" || !PATTERNS.projectId.test(raw.projectId)) return null;
  if (typeof raw.text !== "string" || codepointLength(raw.text) > MAX_NOTE_CHARS) return null;
  for (const k of ["createdAt", "updatedAt"]) if (typeof raw[k] !== "string" || raw[k].length > 64) return null;
  if (!validateAnchor(raw.anchor).ok || raw.anchor.projectId !== raw.projectId) return null;
  const anchor = {};
  for (const k of ANCHOR_KEYS) anchor[k] = Array.isArray(raw.anchor[k]) ? [...raw.anchor[k]] : raw.anchor[k];
  return { id: raw.id, projectId: raw.projectId, anchor, text: raw.text, createdAt: raw.createdAt, updatedAt: raw.updatedAt };
}

// ------------------------------------------------------------------ Transaktions-Koerper (gemeinsam fuer IDB und Memory)
// tx: get(store,key,cb) getAll(store,cb) getAllKeys(store,cb) getByProject(store,id,cb) getKeysByProject(store,id,cb)
//     put(store,value) delete(store,key) fail(code,detail); Ergebnis ueber tx.result.

function activationBody(input) {
  const { projectId, revisionId, seq } = input;
  return (tx) => {
    tx.get("sync", removedKey(projectId), (removed) => {
      // Lokal geloescht: der Abgleich darf das Projekt nicht wieder anlegen (Vertrag 13).
      if (removed) {
        tx.result = { status: "deleted", projectId, revisionId, seq };
        return;
      }
      // Abbruch erst hier pruefen, nicht nur vor dem Oeffnen: zwischen activate() und dieser Stelle liegen
      // await open() und die Warteschlange der Transaktionen - genau dort kann removeLocal/clearProjects laufen.
      if (input.signal && input.signal.aborted) {
        tx.result = { ...ABORTED, projectId, revisionId, seq };
        return;
      }
      tx.get("sync", CLEAR_EPOCH_KEY, (epochRecord) => {
        if (epochOf(epochRecord) !== input.epoch) {
          tx.result = { ...ABORTED, reason: "cleared", projectId, revisionId, seq };
          return;
        }
        activateProject(tx, input);
      });
    });
  };
}

// Schreibt die Aktivierung (nur aus activationBody, nach Loeschvermerk-, Abbruch- und Epochenpruefung).
function activateProject(tx, input) {
  const { projectId, revisionId, seq, now } = input;
  tx.get("projects", projectId, (stored) => {
    const project = stored || newProjectRecord(projectId, now);
    const activeSeq = Number.isSafeInteger(project.activeSeq) ? project.activeSeq : 0;
    const base = { projectId, revisionId, seq, activeSeq, activeRevision: project.activeRevision };
    if (!input.explicit) {
      // Vorwaertsschutz: ein spaet eintreffender aelterer Download ueberschreibt nie die neuere Revision.
      if (seq < activeSeq) {
        tx.result = { status: "stale", ...base };
        return;
      }
      if (seq === activeSeq) {
        tx.result = { status: project.activeRevision === revisionId ? "already-active" : "seq-conflict", ...base };
        return;
      }
    }
    tx.get("revisions", [projectId, revisionId], (meta) => {
      // Revisionen sind unveraenderlich: gleiche ID mit anderem contentHash ist ein Integritaetsfehler.
      if (meta && meta.contentHash !== input.contentHash) {
        tx.fail("integrity-conflict", { projectId, revisionId });
        return;
      }
      tx.put("revisions", meta
        ? { ...meta, firstSeq: Math.min(meta.firstSeq ?? seq, seq), lastSeq: Math.max(meta.lastSeq ?? seq, seq) }
        : input.meta);
      tx.get("packages", [projectId, revisionId], (pkg) => {
        // Erste Fassung bleibt; eine Wiederholung mit anderen Metadaten wird verworfen (Vertrag 10).
        if (!pkg) tx.put("packages", input.pkg);
        const changed = project.activeRevision !== null && project.activeRevision !== revisionId;
        const next = {
          ...project,
          activeRevision: revisionId,
          activeSeq: seq,
          previousRevision: changed ? project.activeRevision : project.previousRevision,
          previousSeq: changed ? activeSeq : project.previousSeq,
          activeHead: input.head,
          updatedAt: now,
        };
        tx.put("projects", next);
        tx.getKeysByProject("packages", projectId, (keys) => {
          const keep = new Set([next.activeRevision, next.previousRevision]);
          let pruned = 0;
          for (const key of keys) {
            if (!keep.has(key[1])) {
              tx.delete("packages", key);
              pruned += 1;
            }
          }
          tx.result = {
            status: "activated", ...base, previousRevision: next.previousRevision, pruned,
            explicit: input.explicit,
          };
        });
      });
    });
  });
}

function removeLocalBody(projectId, keepNotes, now) {
  return (tx) => {
    tx.put("sync", { key: removedKey(projectId), projectId, removedAt: now });
    tx.delete("projects", projectId);
    const stores = keepNotes ? ["revisions", "packages", "uistate"] : ["revisions", "packages", "uistate", "notes"];
    let removed = 0;
    for (const name of stores) {
      tx.getKeysByProject(name, projectId, (keys) => {
        for (const key of keys) tx.delete(name, key);
        removed += keys.length;
        tx.result = { status: "removed", projectId, records: removed, keepNotes };
      });
    }
    tx.result = { status: "removed", projectId, records: removed, keepNotes };
  };
}

function serverStateBody(projectId, info, now) {
  return (tx) => {
    tx.get("sync", removedKey(projectId), (removed) => {
      if (removed) {
        tx.result = { status: "deleted", projectId };
        return;
      }
      tx.get("projects", projectId, (stored) => {
        const project = stored || newProjectRecord(projectId, now);
        const next = { ...project, serverStatus: info.status, serverCheckedAt: now, updatedAt: now };
        if (info.head !== undefined) next.indexHead = info.head;
        tx.put("projects", next);
        tx.result = { status: "updated", projectId, serverStatus: info.status };
      });
    });
  };
}

function pruneBody(projectId) {
  return (tx) => {
    tx.get("projects", projectId, (project) => {
      const keep = new Set(project ? [project.activeRevision, project.previousRevision] : []);
      tx.getKeysByProject("packages", projectId, (keys) => {
        let pruned = 0;
        for (const key of keys) {
          if (!keep.has(key[1])) {
            tx.delete("packages", key);
            pruned += 1;
          }
        }
        tx.result = { pruned };
      });
    });
  };
}

// Aufraeumen beim Start: Pakete/Metadaten ohne Projekt, Pakete jenseits von aktiv+vorher (Abbruch zwischen Schritten,
// aeltere App-Staende). Notizen bleiben immer: "Notizen ohne Projekt" haengen sich ueber die projectId wieder an.
function cleanupBody() {
  return (tx) => {
    tx.getAll("projects", (projects) => {
      const keep = new Map(projects.map((p) => [p.projectId, new Set([p.activeRevision, p.previousRevision])]));
      const report = { packages: 0, revisions: 0 };
      tx.result = report;
      tx.getAllKeys("packages", (keys) => {
        for (const key of keys) {
          const allowed = keep.get(key[0]);
          if (!allowed || !allowed.has(key[1])) {
            tx.delete("packages", key);
            report.packages += 1;
          }
        }
      });
      tx.getAllKeys("revisions", (keys) => {
        for (const key of keys) {
          if (!keep.has(key[0])) {
            tx.delete("revisions", key);
            report.revisions += 1;
          }
        }
      });
    });
  };
}

// ------------------------------------------------------------------ Gemeinsame Schnittstelle

export class ProjectStore {
  constructor(options = {}) {
    this.flights = new ProjectFlights();
    this._now = typeof options.now === "function" ? options.now : isoNow;
    // Epoche je laufendem Abgleich (Projekt -> Epoche beim Start); activate() vergleicht in der Transaktion.
    this._flightEpochs = new Map();
  }

  // Unterklassen: _run(storeNames, mode, body) -> Promise(tx.result)

  // Abgleich eines Projekts im Single-Flight. task(signal) -> Ergebnis. epoch = die Epoche vom Start des ganzen
  // Abgleichs (syncOnce); ohne Angabe wird sie hier VOR dem Download gelesen. Ein Abmelden-mit-Loeschen waehrend des
  // Laufs macht die spaetere Aktivierung damit wirkungslos.
  syncProject(projectId, task, { epoch = null } = {}) {
    return this.flights.run(projectId, async (signal) => {
      const flightEpoch = Number.isSafeInteger(epoch) ? epoch : await this.syncEpoch();
      this._flightEpochs.set(projectId, flightEpoch);
      try {
        return await task(signal);
      } finally {
        if (this._flightEpochs.get(projectId) === flightEpoch) this._flightEpochs.delete(projectId);
      }
    });
  }

  // Aktuelle Loesch-Epoche (0 = nie geloescht).
  syncEpoch() {
    return this._run(["sync"], "readonly", (tx) => tx.get("sync", CLEAR_EPOCH_KEY, (r) => { tx.result = epochOf(r); }));
  }

  listProjects() {
    return this._run(["projects"], "readonly", (tx) => tx.getAll("projects", (list) => { tx.result = list; }));
  }

  getProject(projectId) {
    return this._run(["projects"], "readonly", (tx) => tx.get("projects", projectId, (p) => { tx.result = p ?? null; }));
  }

  // verified = Ergebnis von verifyPackage mit Bindung (ok, bound, seq). options: {head, explicit, signal}.
  // Ergebnis.status: activated | already-active | stale | seq-conflict | deleted | aborted.
  async activate(verified, options = {}) {
    if (options.signal && options.signal.aborted) return { ...ABORTED, projectId: verified && verified.projectId };
    const input = activationInput(verified, options, this._now());
    // Erwartete Epoche: die vom Start des Abgleichs (syncProject), sonst die von jetzt.
    const flightEpoch = this._flightEpochs.get(input.projectId);
    input.epoch = flightEpoch !== undefined ? flightEpoch : await this.syncEpoch();
    try {
      return await this._run(ACTIVATION_STORES, "readwrite", activationBody(input));
    } catch (error) {
      const mapped = mapError(error);
      // Quota: Meldung mit estimate(); die Transaktion hat nichts geschrieben.
      if (mapped.code === "quota") mapped.detail.estimate = await this.estimate();
      throw mapped;
    }
  }

  // Server-Sicht festhalten (Index/Grabstein/fehlt): markiert lokal, loescht nie still (Vertrag 13). epoch = die des
  // laufenden Abgleichs: nach "lokale Projekte loeschen" legt der Lauf keinen Datensatz mehr an (status "aborted").
  markServerState(projectId, info = {}, { epoch = null } = {}) {
    const allowed = ["active", "deleted", "missing"];
    if (!PATTERNS.projectId.test(String(projectId)) || !allowed.includes(info.status)) {
      return Promise.reject(new StoreError("invalid", { what: "server-state" }));
    }
    const clean = { status: info.status };
    if (info.head === null) clean.head = null;
    else if (info.head !== undefined) clean.head = cleanHead(info.head, {});
    return this._run(["projects", "sync"], "readwrite", underEpoch(epoch, serverStateBody(projectId, clean, this._now())));
  }

  // Umbenennen = lokaler Anzeigename (null = wieder Exportname).
  setLocalName(projectId, name) {
    const valid = name === null || (typeof name === "string" && name.trim() !== "" && codepointLength(name) <= 120);
    if (!valid) return Promise.reject(new StoreError("invalid", { what: "name" }));
    const now = this._now();
    return this._run(["projects"], "readwrite", (tx) => tx.get("projects", projectId, (p) => {
      if (!p) {
        tx.result = { status: "missing" };
        return;
      }
      tx.put("projects", { ...p, localName: name, updatedAt: now });
      tx.result = { status: "renamed" };
    }));
  }

  // Lokales Loeschen: Loeschvermerk setzen, laufenden Abgleich abbrechen, lokale Projektdaten entfernen.
  // Notizen bleiben (getrennt loeschen); das Serverprojekt bleibt unberuehrt.
  removeLocal(projectId, { keepNotes = true } = {}) {
    if (!PATTERNS.projectId.test(String(projectId))) return Promise.reject(new StoreError("invalid", { what: "projectId" }));
    this.flights.abort(projectId);
    const stores = keepNotes ? PROJECT_DATA_STORES : [...PROJECT_DATA_STORES, "notes"];
    return this._run(stores, "readwrite", removeLocalBody(projectId, keepNotes, this._now()));
  }

  isLocallyRemoved(projectId) {
    return this._run(["sync"], "readonly", (tx) => tx.get("sync", removedKey(projectId), (v) => { tx.result = Boolean(v); }));
  }

  // Ausdrueckliche Nutzerwahl "wieder laden": Loeschvermerk entfernen.
  clearLocalRemoval(projectId) {
    return this._run(["sync"], "readwrite", (tx) => {
      tx.delete("sync", removedKey(projectId));
      tx.result = { status: "cleared" };
    });
  }

  // Aktives Paket zum Oeffnen: {project, revision, bytes}. Der Aufrufer prueft die Bytes erneut (verifyStored).
  getActivePackage(projectId) {
    return this._run(["projects", "revisions", "packages"], "readonly", (tx) => {
      tx.result = null;
      tx.get("projects", projectId, (project) => {
        if (!project || !project.activeRevision) return;
        tx.get("revisions", [projectId, project.activeRevision], (revision) => {
          tx.get("packages", [projectId, project.activeRevision], (pkg) => {
            if (revision && pkg) tx.result = { project, revision, bytes: toBytes(pkg.bytes) };
          });
        });
      });
    });
  }

  getPackage(projectId, revisionId) {
    return this._run(["packages"], "readonly", (tx) => tx.get("packages", [projectId, revisionId], (pkg) => {
      tx.result = pkg ? toBytes(pkg.bytes) : null;
    }));
  }

  listRevisions(projectId) {
    return this._run(["revisions"], "readonly", (tx) => tx.getByProject("revisions", projectId, (list) => { tx.result = list; }));
  }

  prune(projectId) {
    return this._run(["projects", "packages"], "readwrite", pruneBody(projectId));
  }

  cleanup() {
    return this._run(["projects", "revisions", "packages"], "readwrite", cleanupBody());
  }

  // Abmelden mit "lokale Projekte loeschen": alle Projektdaten, Notizen optional; sync bleibt (Token/Vermerke
  // verwaltet sync.js) bis auf die Epoche: sie steigt in derselben Transaktion, damit kein laufender Abgleich die
  // Projekte danach wieder anlegt. Laufende Abgleiche werden zusaetzlich abgebrochen (spart den Download).
  clearProjects({ keepNotes = true } = {}) {
    this.flights.abortAll();
    const stores = keepNotes ? ["projects", "revisions", "packages", "uistate"] : ["projects", "revisions", "packages", "uistate", "notes"];
    const now = this._now();
    return this._run([...stores, "sync"], "readwrite", (tx) => {
      const report = {};
      tx.result = report;
      tx.get("sync", CLEAR_EPOCH_KEY, (record) => {
        report.epoch = epochOf(record) + 1;
        tx.put("sync", { key: CLEAR_EPOCH_KEY, value: report.epoch, updatedAt: now });
      });
      for (const name of stores) {
        tx.getAllKeys(name, (keys) => {
          for (const key of keys) tx.delete(name, key);
          report[name] = keys.length;
        });
      }
    });
  }

  // ---------------------------------------------------------------- Notizen (eigener Export/Import, Vertrag 13)

  async createNote({ projectId, anchor, text }) {
    const now = this._now();
    const note = cleanNote({ id: newNoteId(), projectId, anchor, text, createdAt: now, updatedAt: now });
    if (!note) throw new StoreError("invalid", { what: "note" });
    await this._run(["notes"], "readwrite", (tx) => {
      tx.put("notes", note);
      tx.result = note;
    });
    return note;
  }

  async putNote(raw) {
    const note = cleanNote(raw);
    if (!note) throw new StoreError("invalid", { what: "note" });
    return this._run(["notes"], "readwrite", (tx) => {
      tx.put("notes", note);
      tx.result = note;
    });
  }

  getNote(id) {
    return this._run(["notes"], "readonly", (tx) => tx.get("notes", id, (n) => { tx.result = n ?? null; }));
  }

  listNotes(projectId) {
    return this._run(["notes"], "readonly", (tx) => {
      if (projectId === undefined) tx.getAll("notes", (list) => { tx.result = list; });
      else tx.getByProject("notes", projectId, (list) => { tx.result = list; });
    });
  }

  // "Notizen ohne Projekt": Projekt lokal entfernt; sie haengen sich ueber die projectId wieder an.
  listOrphanNotes() {
    return this._run(["projects", "notes"], "readonly", (tx) => {
      tx.getAll("projects", (projects) => {
        const known = new Set(projects.map((p) => p.projectId));
        tx.getAll("notes", (notes) => { tx.result = notes.filter((n) => !known.has(n.projectId)); });
      });
    });
  }

  deleteNote(id) {
    return this._run(["notes"], "readwrite", (tx) => {
      tx.delete("notes", id);
      tx.result = { status: "deleted" };
    });
  }

  deleteNotes(projectId) {
    return this._run(["notes"], "readwrite", (tx) => tx.getKeysByProject("notes", projectId, (keys) => {
      for (const key of keys) tx.delete("notes", key);
      tx.result = { deleted: keys.length };
    }));
  }

  // Datenebene des Notiz-Exports; die Oberflaeche speichert das Objekt als Datei mit Warnhinweis.
  async exportNotes({ projectId } = {}) {
    const notes = await this.listNotes(projectId);
    return {
      format: NOTES_FORMAT,
      version: 1,
      warning: NOTES_WARNING,
      exportedAt: this._now(),
      projectId: projectId ?? null,
      notes: notes.map((n) => cleanNote(n)).filter(Boolean),
    };
  }

  // Import: nur gueltige Notizen, nur bekannte Felder; vorhandene IDs bleiben, ausser replace:true.
  async importNotes(data, { replace = false } = {}) {
    if (!isRecord(data) || data.format !== NOTES_FORMAT || data.version !== 1 || !Array.isArray(data.notes)) {
      throw new StoreError("invalid", { what: "notes-file" });
    }
    if (data.notes.length > MAX_IMPORT_NOTES) throw new StoreError("invalid", { what: "notes-count" });
    // Doppelte IDs in derselben Datei vorher aussortieren (die erste gewinnt): in einer Transaktion laufen alle get()
    // vor dem ersten put() - der Bericht meldete sonst "2 hinzugefuegt", waehrend die zweite die erste ueberschreibt.
    const valid = [];
    const seen = new Set();
    let invalid = 0;
    let duplicates = 0;
    for (const raw of data.notes) {
      const note = cleanNote(raw);
      if (!note) invalid += 1;
      else if (seen.has(note.id)) duplicates += 1;
      else {
        seen.add(note.id);
        valid.push(note);
      }
    }
    return this._run(["notes"], "readwrite", (tx) => {
      const report = { added: 0, replaced: 0, skipped: duplicates, invalid };
      tx.result = report;
      for (const note of valid) {
        tx.get("notes", note.id, (existing) => {
          if (existing && !replace) {
            report.skipped += 1;
            return;
          }
          tx.put("notes", note);
          if (existing) report.replaced += 1;
          else report.added += 1;
        });
      }
    });
  }

  // ---------------------------------------------------------------- Ansichtszustand und Abgleich-Daten

  getUiState(key) {
    return this._run(["uistate"], "readonly", (tx) => tx.get("uistate", key, (r) => { tx.result = r ? r.value : null; }));
  }

  // epoch: nur fuer Schreiben aus einem laufenden Abgleich (siehe underEpoch).
  putUiState(key, value, { projectId = null, epoch = null } = {}) {
    if (typeof key !== "string" || !key) return Promise.reject(new StoreError("invalid", { what: "key" }));
    const record = { key, projectId, value, updatedAt: this._now() };
    if (projectId === null) delete record.projectId;
    const stores = Number.isSafeInteger(epoch) ? ["uistate", "sync"] : ["uistate"];
    return this._run(stores, "readwrite", underEpoch(epoch, (tx) => {
      tx.put("uistate", record);
      tx.result = { status: "saved" };
    }));
  }

  deleteUiState(key) {
    return this._run(["uistate"], "readwrite", (tx) => {
      tx.delete("uistate", key);
      tx.result = { status: "deleted" };
    });
  }

  getSyncValue(key) {
    return this._run(["sync"], "readonly", (tx) => tx.get("sync", key, (r) => { tx.result = r ? r.value : null; }));
  }

  // Loeschvermerk und Epoche sind reserviert: nur removeLocal/clearLocalRemoval/clearProjects aendern sie.
  // epoch: nur fuer Schreiben aus einem laufenden Abgleich (gemerkter Index, siehe underEpoch).
  putSyncValue(key, value, { epoch = null } = {}) {
    if (typeof key !== "string" || !key || isReservedSyncKey(key)) {
      return Promise.reject(new StoreError("invalid", { what: "key" }));
    }
    return this._run(["sync"], "readwrite", underEpoch(epoch, (tx) => {
      tx.put("sync", { key, value, updatedAt: this._now() });
      tx.result = { status: "saved" };
    }));
  }

  deleteSyncValue(key) {
    if (typeof key !== "string" || isReservedSyncKey(key)) {
      return Promise.reject(new StoreError("invalid", { what: "key" }));
    }
    return this._run(["sync"], "readwrite", (tx) => {
      tx.delete("sync", key);
      tx.result = { status: "deleted" };
    });
  }

  // navigator.storage.estimate(): nur Anzeige. Fehlt die API (Node, alte Engines), gibt es schlicht keine Zahl.
  async estimate() {
    const storage = globalThis.navigator && globalThis.navigator.storage;
    if (!storage || typeof storage.estimate !== "function") return null;
    try {
      const { usage, quota } = await storage.estimate();
      return { usage: Number.isFinite(usage) ? usage : null, quota: Number.isFinite(quota) ? quota : null };
    } catch (error) {
      // estimate() ist reine Information: ohne Zahl bleibt die Meldung trotzdem richtig ("Speicher voll").
      return { usage: null, quota: null, error: error && error.name ? error.name : "Error" };
    }
  }
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

// "Offline verfuegbar" haengt an persisted() (Vertrag 13); persist() nur auf Wunsch der installierten App.
export async function storagePersistence({ request = false } = {}) {
  const storage = globalThis.navigator && globalThis.navigator.storage;
  if (!storage || typeof storage.persisted !== "function") return { supported: false, persisted: false, granted: null };
  let granted = null;
  if (request && typeof storage.persist === "function") granted = await storage.persist();
  return { supported: true, persisted: await storage.persisted(), granted };
}

// ------------------------------------------------------------------ MemoryStore (Tests, gleiche Schnittstelle)

function primaryKey(storeName, value) {
  const path = KEY_PATHS[storeName];
  return Array.isArray(path) ? path.map((p) => value[p]) : value[path];
}

function memoryKey(key) {
  return Array.isArray(key) ? key.join("\u0000") : String(key);
}

function sortedValues(map) {
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v);
}

// Spielt IndexedDB-Semantik nach, soweit die Koerper sie brauchen: Kopie je Transaktion, Callbacks in
// Anfragereihenfolge, Werte als strukturierte Kopien, Commit nur ohne Fehler, Quota prueft vor dem Commit.
export class MemoryStore extends ProjectStore {
  constructor(options = {}) {
    super(options);
    this._data = new Map(STORE_NAMES.map((name) => [name, new Map()]));
    this._quotaBytes = Number.isFinite(options.quotaBytes) ? options.quotaBytes : Infinity;
    this._closed = false;
    this.transactions = 0;
  }

  open() {
    this._closed = false;
    return Promise.resolve(this);
  }

  close() {
    this._closed = true;
  }

  _run(names, mode, body) {
    return new Promise((resolve, reject) => {
      if (this._closed) {
        reject(new StoreError("closed"));
        return;
      }
      this.transactions += 1;
      const readOnly = mode !== "readwrite";
      const staged = new Map(names.map((name) => [name, new Map(this._data.get(name))]));
      const queue = [];
      let failure = null;
      const table = (name) => {
        const t = staged.get(name);
        if (!t) throw new StoreError("invalid", { what: "store-scope" });
        return t;
      };
      const write = () => {
        if (readOnly) throw new StoreError("invalid", { what: "readonly" });
      };
      const later = (fn) => queue.push(fn);
      const projectRows = (name, projectId) => {
        if (!BY_PROJECT.has(name)) throw new StoreError("invalid", { what: "index" });
        return sortedValues(table(name)).filter((v) => v.projectId === projectId);
      };
      const api = {
        result: undefined,
        get(name, key, cb) {
          const v = table(name).get(memoryKey(key));
          later(() => cb(v === undefined ? undefined : structuredClone(v)));
        },
        getAll(name, cb) {
          const list = sortedValues(table(name)).map((v) => structuredClone(v));
          later(() => cb(list));
        },
        getAllKeys(name, cb) {
          const keys = sortedValues(table(name)).map((v) => primaryKey(name, v));
          later(() => cb(keys));
        },
        getByProject(name, projectId, cb) {
          const list = projectRows(name, projectId).map((v) => structuredClone(v));
          later(() => cb(list));
        },
        getKeysByProject(name, projectId, cb) {
          const keys = projectRows(name, projectId).map((v) => primaryKey(name, v));
          later(() => cb(keys));
        },
        put(name, value) {
          write();
          const copy = structuredClone(value);
          table(name).set(memoryKey(primaryKey(name, copy)), copy);
        },
        delete(name, key) {
          write();
          table(name).delete(memoryKey(key));
        },
        fail(code, detail) {
          failure = failure || new StoreError(code, detail);
        },
      };
      try {
        body(api);
        for (let i = 0; i < queue.length && !failure; i += 1) queue[i]();
      } catch (error) {
        failure = failure || mapError(error);
      }
      if (failure) {
        reject(failure);
        return;
      }
      if (!readOnly) {
        const packages = staged.get("packages") || this._data.get("packages");
        let used = 0;
        for (const pkg of packages.values()) used += pkg.byteLength || 0;
        if (used > this._quotaBytes) {
          reject(new StoreError("quota", { name: "QuotaExceededError" }));
          return;
        }
        for (const [name, map] of staged) this._data.set(name, map);
      }
      resolve(api.result);
    });
  }
}

// ------------------------------------------------------------------ IdbStore (Browser)

// Vorwaerts-Migration; Pakete werden nie umgeschrieben, nur neu bewertet (Vertrag 16).
function upgradeDatabase(db, oldVersion) {
  if (oldVersion < 1) {
    db.createObjectStore("projects", { keyPath: KEY_PATHS.projects });
    for (const name of ["revisions", "packages", "notes", "uistate"]) {
      const store = db.createObjectStore(name, { keyPath: KEY_PATHS[name] });
      store.createIndex("byProject", "projectId", { unique: false });
    }
    db.createObjectStore("sync", { keyPath: KEY_PATHS.sync });
  }
}

export class IdbStore extends ProjectStore {
  constructor(options = {}) {
    super(options);
    this._factory = options.indexedDB !== undefined ? options.indexedDB : globalThis.indexedDB;
    this._timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TX_TIMEOUT_MS;
    this._openTimeoutMs = Number.isFinite(options.openTimeoutMs) ? options.openTimeoutMs : DEFAULT_OPEN_TIMEOUT_MS;
    this._db = null;
    this._opening = null;
    this.reconnects = 0;
  }

  open() {
    if (this._db) return Promise.resolve(this._db);
    if (this._opening) return this._opening;
    const factory = this._factory;
    if (!factory || typeof factory.open !== "function") return Promise.reject(new StoreError("unavailable"));
    this._opening = new Promise((resolve, reject) => {
      let settled = false;
      let blocked = false;
      let request;
      try {
        request = factory.open(DB_NAME, DB_VERSION);
      } catch (error) {
        reject(mapError(error));
        return;
      }
      const timer = setTimeout(() => {
        settled = true;
        reject(new StoreError(blocked ? "blocked" : "timeout"));
      }, this._openTimeoutMs);
      request.onupgradeneeded = (event) => {
        try {
          upgradeDatabase(request.result, event.oldVersion);
        } catch (error) {
          // Ohne vollstaendige Stores ist die DB unbrauchbar: Upgrade abbrechen, open() meldet den Fehler.
          request.transaction.abort();
        }
      };
      request.onblocked = () => {
        blocked = true;
      };
      request.onsuccess = () => {
        const db = request.result;
        if (settled) {
          db.close();    // Zeitlimit war schon abgelaufen: spaete Verbindung nicht liegen lassen
          return;
        }
        settled = true;
        clearTimeout(timer);
        // Ein anderes Fenster will upgraden oder loeschen: sofort freigeben statt es zu blockieren.
        db.onversionchange = () => this._drop(db);
        db.onclose = () => {
          if (this._db === db) this._db = null;
        };
        this._db = db;
        resolve(db);
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(mapError(request.error));
      };
    });
    const opening = this._opening;
    opening.then(() => { this._opening = null; }, () => { this._opening = null; });
    return opening;
  }

  close() {
    if (this._db) this._drop(this._db);
  }

  // IDBDatabase.close() wirft laut Spezifikation nie; offene Transaktionen laufen noch zu Ende.
  _drop(db) {
    if (this._db === db) this._db = null;
    db.close();
  }

  // Einmal neu oeffnen nach "connection lost" (WebKit nach langer Hintergrundzeit), sonst kontrolliert neu laden.
  async _run(names, mode, body) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let db = null;
      try {
        db = await this.open();
        return await this._transaction(db, names, mode, body);
      } catch (error) {
        const mapped = mapError(error);
        if (mapped.code !== "connection-lost") throw mapped;
        if (db) this._drop(db);
        this.reconnects += 1;
      }
    }
    throw new StoreError("connection-lost", { reload: true });
  }

  _transaction(db, names, mode, body) {
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = mode === "readwrite" ? db.transaction(names, mode, { durability: "strict" }) : db.transaction(names, mode);
      } catch (error) {
        reject(mapError(error));
        return;
      }
      let settled = false;
      let failure = null;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      const abort = () => {
        try {
          tx.abort();
        } catch (error) {
          // Transaktion schon beendet: onabort/oncomplete hat bereits entschieden.
          return error && error.name;
        }
        return null;
      };
      const guard = (cb) => (event) => {
        if (failure) return;
        try {
          cb(event.target.result);
        } catch (error) {
          failure = mapError(error);
          abort();
        }
      };
      const api = {
        result: undefined,
        get(name, key, cb) {
          tx.objectStore(name).get(key).onsuccess = guard((v) => cb(v === undefined ? undefined : v));
        },
        getAll(name, cb) {
          tx.objectStore(name).getAll().onsuccess = guard(cb);
        },
        getAllKeys(name, cb) {
          tx.objectStore(name).getAllKeys().onsuccess = guard(cb);
        },
        getByProject(name, projectId, cb) {
          tx.objectStore(name).index("byProject").getAll(projectId).onsuccess = guard(cb);
        },
        getKeysByProject(name, projectId, cb) {
          tx.objectStore(name).index("byProject").getAllKeys(projectId).onsuccess = guard(cb);
        },
        put(name, value) {
          tx.objectStore(name).put(value);
        },
        delete(name, key) {
          tx.objectStore(name).delete(key);
        },
        fail(code, detail) {
          failure = failure || new StoreError(code, detail);
          abort();
        },
      };
      const timer = setTimeout(() => {
        failure = failure || new StoreError("timeout");
        abort();
        // Haengende Transaktion (WebKit-Fehlerbild ohne Events): Verbindung gilt als verdaechtig.
        this._drop(db);
        finish(reject, failure);
      }, this._timeoutMs);
      tx.oncomplete = () => finish(resolve, api.result);
      tx.onabort = () => finish(reject, failure || mapError(tx.error || { name: "AbortError" }));
      tx.onerror = () => {
        // Fehler einer einzelnen Anfrage (z.B. QuotaExceededError): die Transaktion bricht danach ab -> onabort.
      };
      try {
        body(api);
      } catch (error) {
        failure = failure || mapError(error);
        abort();
      }
    });
  }
}

// Browser: IdbStore. Einzeldatei (file://): Projekte deaktiviert (Vertrag 13) - ausdruecklich am Protokoll geprueft,
// weil Chromium IndexedDB auch unter file:// anbietet. Ohne IndexedDB (Node) gibt es ebenfalls keinen Speicher.
export function createProjectStore(options = {}) {
  const location = options.location !== undefined ? options.location : globalThis.location;
  if (location && location.protocol === "file:") return null;
  const factory = options.indexedDB !== undefined ? options.indexedDB : globalThis.indexedDB;
  if (!factory) return null;
  return new IdbStore({ ...options, indexedDB: factory });
}
