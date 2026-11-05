// Service Worker und GitHub-Attrappe fuer Pocket-Projekte (Vertrag POCKET-PROJECTS-SPEC 11, 13 und 15).
//
// Teil 1: das ERZEUGTE sw.js laeuft in node:vm gegen nachgebaute self/caches/fetch. Belegt: respondWith nur fuer
//         Dateien aus offline.json und Seitenaufrufe der App; fremde Origins, Authorization, ausdrueckliche
//         Zugangsdaten, Nicht-GET und unbekannte Pfade gehen unberuehrt durch; nie cache.put zur Laufzeit.
// Teil 2: Selbsttest von tools/mock_github_store.py ueber echtes TCP auf 127.0.0.1 (Kindprozess): Antworten, CORS
//         und Cache-Control wie GitHub, Pfade gross/klein-genau, Kopf und Index nach den Regeln des Transport-Lesers.
// Belegt NICHT: echte Browser-Engines (SW-Lebenszyklus, CORS-Durchsetzung, HTTP-Cache) - das prueft der
// Browser-Test (Welle 3) gegen genau diese Attrappe.
//
// Aufruf: node tools/projects-sw-tests.mjs   (Teil 2 braucht Python 3.9+; ohne Python wird er uebersprungen)
// Testwerte sind synthetisch: Tokens sind Kanarienwerte, nie echte.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const SW_SOURCE = readFileSync(new URL("sw.js", ROOT), "utf8");
const MANIFEST = JSON.parse(readFileSync(new URL("offline.json", ROOT), "utf8"));
const FILES = MANIFEST.files.map((file) => file.path);
const ORIGIN = "https://tombkn.github.io";
const SCOPE = `${ORIGIN}/codesearch-pocket/`;
const SW_URL = `${SCOPE}sw.js`;
const CACHE = `codesearch-pocket-${MANIFEST.version}`;

// ================================================================== Teil 1: sw.js in der Sandbox

// Nachbau der Cache API. Jedes Schreiben (put/add/addAll) landet in spy.writes - so laesst sich "nur beim
// Installieren" beweisen. Schluessel werden wie im Browser gegen die Adresse von sw.js aufgeloest.
class FakeCache {
  constructor(spy) {
    this.spy = spy;
    this.entries = new Map();
  }

  static key(request, ignoreSearch = false) {
    const url = new URL(typeof request === "string" ? request : request.url, SW_URL);
    if (ignoreSearch) url.search = "";
    return url.href;
  }

  async put(request, response) {
    this.spy.writes.push(["put", FakeCache.key(request)]);
    this.entries.set(FakeCache.key(request), response);
  }

  async add(request) { this.spy.writes.push(["add", FakeCache.key(request)]); }

  async addAll(requests) { this.spy.writes.push(["addAll", requests.length]); }

  async delete(request) { return this.entries.delete(FakeCache.key(request)); }

  async match(request, options = {}) {
    const wanted = FakeCache.key(request, options.ignoreSearch);
    for (const [key, response] of this.entries) {
      if (FakeCache.key(key, options.ignoreSearch) === wanted) return response.clone();
    }
    return undefined;
  }
}

class FakeCacheStorage {
  constructor(spy) {
    this.spy = spy;
    this.stores = new Map();
  }

  async open(name) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache(this.spy));
    return this.stores.get(name);
  }

  async keys() { return [...this.stores.keys()]; }

  async has(name) { return this.stores.has(name); }

  async delete(name) {
    this.spy.deleted.push(name);
    return this.stores.delete(name);
  }

  async match(request, options) {
    for (const cache of this.stores.values()) {
      const hit = await cache.match(request, options);
      if (hit) return hit;
    }
    return undefined;
  }
}

// sw.js in einen frischen vm-Kontext laden. net.mode: "ok" | "offline" (fetch wirft) | "hang" (fetch antwortet nie).
// net.label kennzeichnet die Herkunft einer Antwort: "speicher" beim Installieren, danach "netz".
function loadWorker() {
  const spy = { writes: [], deleted: [], fetches: [], skipWaiting: 0, claims: 0 };
  const listeners = { install: [], activate: [], fetch: [] };
  const timers = [];
  const net = { mode: "ok", label: "speicher" };
  const sandbox = {
    location: new URL(SW_URL),
    addEventListener: (type, handler) => { (listeners[type] ||= []).push(handler); },
    skipWaiting: async () => { spy.skipWaiting += 1; },
    clients: { claim: async () => { spy.claims += 1; } },
    caches: new FakeCacheStorage(spy),
    fetch: async (input, init = {}) => {
      const url = typeof input === "string" ? new URL(input, SW_URL).href : input.url;
      spy.fetches.push({ url, init });
      if (net.mode === "offline") throw new TypeError("Failed to fetch");
      if (net.mode === "hang") return new Promise(() => {});
      return new Response(`${net.label}:${new URL(url).pathname}`, { status: 200 });
    },
    // Uhr in der Hand des Tests: die 4-s-Grenze feuert erst, wenn der Test sie ausloest.
    setTimeout: (handler, ms, ...args) => { timers.push({ handler, ms, args }); return timers.length; },
    clearTimeout: () => {},
    Response,
    Headers,
    URL,
    console,
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SW_SOURCE, sandbox, { filename: "sw.js" });
  return { sandbox, listeners, spy, net, timers, caches: sandbox.caches };
}

async function lifecycle(worker, type) {
  const waits = [];
  for (const handler of worker.listeners[type]) handler({ waitUntil: (promise) => waits.push(promise) });
  await Promise.all(waits);
}

async function installedWorker() {
  const worker = loadWorker();
  await lifecycle(worker, "install");
  await lifecycle(worker, "activate");
  worker.net.label = "netz";
  return worker;
}

// Gefaelschter Request: navigate ist im Request-Konstruktor verboten, darum ein schlichtes Objekt mit echten Headers.
function fakeRequest(url, { method = "GET", mode = "cors", credentials = "same-origin", headers = {} } = {}) {
  return { url: new URL(url, SCOPE).href, method, mode, credentials, headers: new Headers(headers) };
}

function dispatchFetch(worker, request) {
  const event = {
    request,
    responded: false,
    response: null,
    waits: [],
    respondWith(promise) {
      assert.equal(this.responded, false, "respondWith doppelt");
      this.responded = true;
      this.response = Promise.resolve(promise);
    },
    waitUntil(promise) { this.waits.push(promise); },
  };
  for (const handler of worker.listeners.fetch) handler(event);
  return event;
}

async function waitFor(condition, label) {
  for (let i = 0; i < 500; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`Zeitlimit: ${label}`);
}

async function bodyOf(event) {
  assert.equal(event.responded, true, `kein respondWith fuer ${event.request.url}`);
  const response = await event.response;
  return { status: response.status, text: await response.text() };
}

// Faelle, die der Worker NICHT beantworten darf (Vertrag 13: unberuehrt durchreichen).
const PASS_THROUGH = [
  ["api.github.com mit Token", "https://api.github.com/repos/Tombkn/codesearch-pocket-data/contents/projects/index.json",
    { headers: { Authorization: "Bearer mockvalid_canary_sw_0001", Accept: "application/vnd.github.raw+json" }, credentials: "omit" }],
  ["api.github.com ohne Token", "https://api.github.com/repos/Tombkn/codesearch-pocket-data/contents/store.json", { credentials: "omit" }],
  ["gleiche Origin, App-Datei, mit Authorization", "offline.json", { headers: { Authorization: "Bearer mockvalid_canary_sw_0001" } }],
  ["gleiche Origin, Kleinschreibung authorization", "data/course.json", { headers: { authorization: "token mockvalid_canary_sw_0001" } }],
  ["POST auf App-Datei", "offline.json", { method: "POST" }],
  ["PUT auf App-Datei", "index.html", { method: "PUT" }],
  ["HEAD auf App-Datei", "index.html", { method: "HEAD" }],
  ["fetch mit credentials include (cors)", "data/course.json", { credentials: "include", mode: "cors" }],
  ["fetch mit credentials include (same-origin)", "offline.json", { credentials: "include", mode: "same-origin" }],
  ["unbekannter Pfad: Werkzeug", "tools/mock_github_store.py", {}],
  ["unbekannter Pfad: sw.js selbst", "sw.js", {}],
  ["unbekannter Pfad: Projektdaten", "projects/index.json", {}],
  ["unbekannter Pfad: data-Datei ausserhalb der Liste", "data/signalgarden-scenarios.json", {}],
  ["unbekannter Pfad: Einzeldatei als Unterressource", "CodeSearch-Pocket-offline.html", {}],
  ["andere Seite derselben Origin", `${ORIGIN}/lageplan-vs-reisefuehrer/index.html`, {}],
  ["Seitenaufruf ausserhalb des Geltungsbereichs", `${ORIGIN}/lageplan-vs-reisefuehrer/`, { mode: "navigate", credentials: "include" }],
  ["anderes Schema (http statt https)", "http://tombkn.github.io/codesearch-pocket/index.html", {}],
];

describe("sw.js in der Sandbox", () => {
  test("Erlaubt-Liste im Worker = offline.json (Pfade ohne ?v=)", () => {
    const worker = loadWorker();
    // Array.from: das Feld aus dem vm-Kontext hat ein fremdes Array.prototype, deepStrictEqual vergleicht Prototypen.
    const allowed = Array.from(vm.runInContext("[...ALLOWED]", worker.sandbox));
    assert.deepEqual(allowed, FILES.map((file) => new URL(file, SW_URL).pathname));
    assert.equal(vm.runInContext("CACHE", worker.sandbox), CACHE);
  });

  test("Install legt genau die Dateien aus offline.json ab (cache reload), danach skipWaiting", async () => {
    const worker = loadWorker();
    await lifecycle(worker, "install");
    assert.deepEqual(worker.spy.writes, FILES.map((file) => ["put", new URL(file, SW_URL).href]));
    assert.deepEqual(worker.spy.fetches.map((call) => call.init.cache), FILES.map(() => "reload"));
    assert.equal(worker.spy.skipWaiting, 1);
    assert.deepEqual([...worker.caches.stores.keys()], [CACHE]);
  });

  test("App-Datei mit ?v=… kommt zuerst vom Netz (no-cache), ohne Laufzeit-Schreiben", async () => {
    const worker = await installedWorker();
    const writes = worker.spy.writes.length;
    const event = dispatchFetch(worker, fakeRequest(`js/app.js?v=${MANIFEST.version}`));
    const { status, text } = await bodyOf(event);
    assert.equal(status, 200);
    assert.equal(text, "netz:/codesearch-pocket/js/app.js");
    assert.equal(worker.spy.fetches.at(-1).init.cache, "no-cache");
    assert.equal(worker.spy.writes.length, writes);
  });

  test("App-Datei ohne Netz kommt aus dem Speicher", async () => {
    const worker = await installedWorker();
    worker.net.mode = "offline";
    const { text } = await bodyOf(dispatchFetch(worker, fakeRequest(`css/app.css?v=${MANIFEST.version}`, { mode: "no-cors", credentials: "include" })));
    assert.equal(text, "speicher:/codesearch-pocket/css/app.css");
  });

  test("Funkloch: nach der 4-s-Grenze antwortet der Speicher", async () => {
    const worker = await installedWorker();
    worker.net.mode = "hang";
    const event = dispatchFetch(worker, fakeRequest("data/course.json"));
    assert.equal(event.responded, true);
    await waitFor(() => worker.timers.some((timer) => timer.ms === 4000), "4-s-Timer");
    const timer = worker.timers.find((item) => item.ms === 4000);
    timer.handler(...timer.args);
    const { text } = await bodyOf(event);
    assert.equal(text, "speicher:/codesearch-pocket/data/course.json");
  });

  test("Bilder, CSS und Icons (no-cors, credentials include nach HTML-Regel) bleiben App-Dateien", async () => {
    const worker = await installedWorker();
    worker.net.mode = "offline";
    const image = FILES.find((file) => file.startsWith("img/"));
    for (const path of [image, "css/app.css", "icon-180.png", "icon.svg"]) {
      const { text } = await bodyOf(dispatchFetch(worker, fakeRequest(path, { mode: "no-cors", credentials: "include" })));
      assert.equal(text, `speicher:/codesearch-pocket/${path}`, path);
    }
  });

  test("Seitenaufruf der App: respondWith; offline Rueckfall auf index.html; raeumt alte Speicher auf", async () => {
    const worker = await installedWorker();
    await worker.caches.open("codesearch-pocket-0123456789");
    worker.net.mode = "offline";
    const start = dispatchFetch(worker, fakeRequest(SCOPE, { mode: "navigate", credentials: "include" }));
    assert.equal((await bodyOf(start)).text, "speicher:/codesearch-pocket/");
    await Promise.all(start.waits);
    assert.ok(worker.spy.deleted.includes("codesearch-pocket-0123456789"), "dropOld bei Navigation");
    const deep = dispatchFetch(worker, fakeRequest(`${SCOPE}irgendwo/tief?x=1`, { mode: "navigate", credentials: "include" }));
    assert.equal((await bodyOf(deep)).text, "speicher:/codesearch-pocket/index.html");
  });

  // Befund oberflaeche-f10 (Schlusspruefung 1.11.0): der ALTE Worker raeumte bei jedem Seitenaufruf auch den halb
  // gefuellten Speicher des neuen, noch installierenden Workers weg - die Seite lud danach alles doppelt, ohne Netz
  // fehlten dem neuen Worker Dateien. Solange ein neuerer Worker installiert oder wartet, bleibt dessen Speicher.
  test("Seitenaufruf, waehrend ein neuerer Worker installiert oder wartet: dessen Speicher bleibt", async () => {
    for (const state of ["installing", "waiting"]) {
      const worker = await installedWorker();
      const newer = "codesearch-pocket-bbbbbbbbbb";
      await worker.caches.open(newer);
      worker.sandbox.registration = { installing: null, waiting: null, active: {}, [state]: {} };
      const event = dispatchFetch(worker, fakeRequest(SCOPE, { mode: "navigate", credentials: "include" }));
      await bodyOf(event);
      await Promise.all(event.waits);
      assert.equal(worker.spy.deleted.includes(newer), false, `${state}: Speicher des neuen Workers geloescht`);
      assert.ok((await worker.caches.keys()).includes(newer), state);
      // Ohne neueren Worker raeumt der Seitenaufruf wie bisher auf.
      worker.sandbox.registration = { installing: null, waiting: null, active: {} };
      const later = dispatchFetch(worker, fakeRequest(SCOPE, { mode: "navigate", credentials: "include" }));
      await bodyOf(later);
      await Promise.all(later.waits);
      assert.ok(worker.spy.deleted.includes(newer), `${state}: danach aufgeraeumt`);
    }
  });

  test("Offline und nicht gespeichert: 503 statt fremder Antwort", async () => {
    const worker = await installedWorker();
    const cache = await worker.caches.open(CACHE);
    await cache.delete("offline.json");
    worker.net.mode = "offline";
    const { status, text } = await bodyOf(dispatchFetch(worker, fakeRequest("offline.json")));
    assert.equal(status, 503);
    assert.equal(text, "offline und nicht gespeichert");
  });

  for (const [label, url, options] of PASS_THROUGH) {
    test(`durchreichen ohne respondWith: ${label}`, async () => {
      const worker = await installedWorker();
      const fetches = worker.spy.fetches.length;
      const event = dispatchFetch(worker, fakeRequest(url, options));
      assert.equal(event.responded, false);
      assert.equal(event.waits.length, 0);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(worker.spy.fetches.length, fetches, "der Worker darf selbst nichts holen");
    });
  }

  test("nie cache.put zur Laufzeit: viele Anfragen mit und ohne Netz schreiben nichts", async () => {
    const worker = await installedWorker();
    const installWrites = structuredClone(worker.spy.writes);
    assert.equal(installWrites.length, FILES.length);
    // Je Netzlage erst alle Antworten abwarten: der Worker holt erst nach einem await - wuerde die Schleife net.mode
    // sofort umschalten, liefe kein einziger Request ueber den Netzweg (genau den, der schreiben koennte).
    for (const mode of ["ok", "offline"]) {
      worker.net.mode = mode;
      const events = [];
      for (const path of FILES) events.push(dispatchFetch(worker, fakeRequest(path)));
      events.push(dispatchFetch(worker, fakeRequest(SCOPE, { mode: "navigate", credentials: "include" })));
      for (const [, url, options] of PASS_THROUGH) events.push(dispatchFetch(worker, fakeRequest(url, options)));
      const bodies = await Promise.all(events.filter((event) => event.responded).map(async (event) => (await event.response).text()));
      await Promise.all(events.flatMap((event) => event.waits));
      const label = mode === "ok" ? "netz:" : "speicher:";
      assert.ok(bodies.length === FILES.length + 1 && bodies.every((body) => body.startsWith(label)), `${mode}: Antworten ${label}`);
    }
    assert.deepEqual(worker.spy.writes, installWrites);
  });

  test("dropOld loescht nur eigene alte Speicher (Namensschema), nie fremde mit aehnlichem Namen", async () => {
    const worker = loadWorker();
    const own = ["codesearch-pocket-0123456789", "codesearch-pocket-v2"];
    const foreign = ["codesearch-pocket-data", "codesearch-pocketX", "codesearch-pocket-0123456789-extra", "lageplan-v1", "cspp-projects-v1"];
    for (const name of [...own, ...foreign]) await worker.caches.open(name);
    await lifecycle(worker, "install");
    await lifecycle(worker, "activate");
    assert.deepEqual(worker.spy.deleted.sort(), [...own].sort());
    assert.deepEqual((await worker.caches.keys()).sort(), [...foreign, CACHE].sort());
    assert.equal(worker.spy.claims, 1);
  });
});

// ================================================================== Teil 2: GitHub-Attrappe

const MOCK = fileURLToPath(new URL("tools/mock_github_store.py", ROOT));
const TEST_ORIGIN = "http://127.0.0.1:5173";
const VALID = "mockvalid_canary_7f3a9c2e5b1d";
const BLOCKED = "mockblocked_canary_4e8b2a6c9d0f";
const OUTSIDE_CANARY = "OUTSIDE_CANARY_9d2f61";
const PID = "psp_00112233445566778899aabbccddeeff";
const REV_A = "rev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REV_B = "rev_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const REV_MISSING = "rev_cccccccccccccccccccccccccccccccc";
const REV_ODD = "rev_dddddddddddddddddddddddddddddddd";
const RAW = "application/vnd.github.raw+json";
const BASE = "/repos/Tombkn/codesearch-pocket-data/contents";
const AUTH = { Authorization: `Bearer ${VALID}` };

// Belegtes GitHub-Verhalten, gegen das die Attrappe hier geprueft wird (Stand 2026-11-05):
// - Cache-Control einer authentifizierten Lese-Antwort: docs.github.com "Getting started with the REST API"
//   (Beispielantwort mit Token; ohne Token sendet GitHub "public, max-age=60, s-maxage=60", live beobachtet).
// - Access-Control-Allow-Headers: live, Preflight auf api.github.com/repos/Tombkn/codesearch-pocket-data/contents/...
// - 404 ohne Token: ohne Cache-Control-Kopf (live).
const GITHUB_CACHE_CONTROL = "private, max-age=60, s-maxage=60";
const GITHUB_ALLOW_HEADERS = ["Authorization", "Content-Type", "If-Match", "If-Modified-Since", "If-None-Match",
  "If-Unmodified-Since", "Accept-Encoding", "X-GitHub-OTP", "X-Requested-With", "User-Agent", "GraphQL-Features",
  "X-Github-Next-Global-ID", "X-GitHub-Api-Version", "X-Fetch-Nonce", "Copilot-Integration-Id", "DD-CLIENT-TOKEN",
  "X-Client-Application", "X-Experiment-Commit-Agent-Version", "Idempotency-Key"];

function findPython() {
  const names = [process.env.PYTHON, process.platform === "win32" ? "python" : "python3", "python3", "python"].filter(Boolean);
  for (const name of new Set(names)) {
    const probe = spawnSync(name, ["-I", "-c", "import sys; print(sys.version_info >= (3, 9))"], { encoding: "utf8", timeout: 20000 });
    if (probe.status === 0 && probe.stdout.trim() === "True") return name;
  }
  return null;
}

const PYTHON = findPython();

// Synthetisches Paket: die Attrappe liest daraus nur Kopf-Felder (wie der Transport), kein gueltiges Schema noetig.
function syntheticPackage(revisionId, name, operators) {
  return Buffer.from(JSON.stringify({
    format: "codesearch.pocket.snapshot", projectId: PID, revision: { id: revisionId }, projectName: name,
    exportedAt: "2026-11-05T09:30:00Z", exportRoot: { path: "/project1/Weichzeichner" },
    operators: Array.from({ length: operators }, (_, i) => ({ rel: i ? `op${i}` : "" })), codeSources: [{ key: "op1" }],
  }), "utf8");
}

const gitBlobSha = (data) => createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${data.length}\0`), data])).digest("hex");

function sortedJson(value) {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${sortedJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// Wie lange darf der HTTP-Cache des Browsers (ein privater Cache) eine Antwort ohne Rueckfrage wiederverwenden?
// Reicht fuer die Frage dieser Tests: no-store/no-cache -> 0, sonst max-age in Sekunden, ohne Angabe 0.
function privateCacheLifetime(cacheControl) {
  if (typeof cacheControl !== "string") return 0;
  const directives = cacheControl.split(",").map((part) => part.trim().toLowerCase());
  if (directives.includes("no-store") || directives.includes("no-cache")) return 0;
  const maxAge = directives.find((directive) => directive.startsWith("max-age="));
  return maxAge ? Number(maxAge.slice("max-age=".length)) : 0;
}

// Regeln des strengen Speicher-Lesers im Transport (td-codesearch cs_pocket_transport: _is_head, _is_log_entry;
// Vertrag 4.1, 9 und 11), hier nachgebaut, damit dieser Test ohne das andere Repo laeuft.
const TIMESTAMP_FORM = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;
// Kalenderdatum pruefen: Date rollt den 30. Februar still auf den 2. Maerz - der Rueckweg muss denselben Text ergeben.
const isTimestamp = (value) => typeof value === "string" && TIMESTAMP_FORM.test(value)
  && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value.replace("Z", ".000Z");
const isCount = (value, minimum) => Number.isSafeInteger(value) && value >= minimum;
const isRevisionId = (value) => typeof value === "string" && /^rev_[0-9a-f]{32}$/.test(value);

function isText(value, limit) {
  if (typeof value !== "string" || !value.isWellFormed()) return false;
  const codepoints = [...value].length;
  return codepoints >= 1 && codepoints <= limit;
}

function isTransportHead(head) {
  return Boolean(head) && typeof head === "object" && isCount(head.seq, 1) && isRevisionId(head.revisionId)
    && isTimestamp(head.committedAt) && isTimestamp(head.exportedAt) && isText(head.projectName, 120)
    && isCount(head.bytes, 0) && isCount(head.counts?.operators, 0) && isCount(head.counts?.codeSources, 0)
    && isText(head.rootPath, 1024);
}

function isTransportLogEntry(entry) {
  return Boolean(entry) && typeof entry === "object" && isCount(entry.seq, 1) && isRevisionId(entry.revisionId)
    && isCount(entry.prevSeq, 0) && isTimestamp(entry.committedAt) && isTimestamp(entry.exportedAt)
    && isText(entry.projectName, 120) && /^[A-Za-z0-9_-]{8,64}$/.test(entry.installId ?? "");
}

// Ein HTTP-Request an die Attrappe auf 127.0.0.1 (eigene Verbindung je Request, damit nichts haengen bleibt).
function callAt(port, path, { method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path, method, headers, agent: false }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on("error", reject);
    });
    request.on("error", reject);
    request.setTimeout(20000, () => request.destroy(new Error(`Zeitlimit ${method} ${path}`)));
    if (body !== null) request.write(body);
    request.end();
  });
}

// Attrappe als Kindprozess starten; die erste stdout-Zeile ist die Startmeldung (Port 0 = frei waehlen).
// output sammelt stdout und stderr: der Leck-Test durchsucht ihn nach Tokens.
async function startMock(fixtures, tokensFile, extraArgs = []) {
  const child = spawn(PYTHON, ["-I", "-B", MOCK, "serve", "--port", "0", "--fixtures", fixtures, "--origin", TEST_ORIGIN,
    "--tokens-file", tokensFile, ...extraArgs], { stdio: ["ignore", "pipe", "pipe"] });
  const handle = { child, output: "", ready: null };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { handle.output += chunk; });
  handle.ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Attrappe startet nicht: ${handle.output}`)), 20000);
    child.stdout.on("data", (chunk) => {
      handle.output += chunk;
      const newline = handle.output.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      try { resolve(JSON.parse(handle.output.slice(0, newline))); } catch (error) { reject(error); }
    });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Attrappe beendet (${code}): ${handle.output}`)); });
  });
  return handle;
}

async function stopMock(handle) {
  if (handle && handle.child.exitCode === null) {
    await new Promise((resolve) => { handle.child.once("exit", resolve); handle.child.kill(); });
  }
}

describe("mock_github_store.py (Attrappe der GitHub-Contents-API)", { skip: PYTHON ? false : "kein Python 3.9+ gefunden" }, () => {
  let dir;
  let fixtures;
  let tokensFile;
  let mock;
  let port;
  // Grund, warum keine Verknuepfungen angelegt werden konnten (dann wird nur dieser Teiltest uebersprungen).
  let linkSkip = null;
  const revA = syntheticPackage(REV_A, "Weichzeichner", 3);
  const revB = syntheticPackage(REV_B, "Weichzeichner zwei", 4);
  const LINKS = ["alias", "elsewhere"];

  const call = (path, options) => callAt(port, path, options);

  const read = (rel, headers = {}) => call(`${BASE}/${rel}`, { headers: { ...AUTH, Accept: RAW, Origin: TEST_ORIGIN, ...headers } });

  async function control(command, payload = {}) {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const response = await call(`/__mock/${command}`, {
      method: "POST", headers: { "Content-Type": "application/json", "Content-Length": body.length }, body,
    });
    return { status: response.status, json: JSON.parse(response.body.toString("utf8")), headers: response.headers };
  }

  async function readJson(rel) {
    const response = await read(rel);
    assert.equal(response.status, 200, rel);
    return { response, doc: JSON.parse(response.body.toString("utf8")) };
  }

  // Alles, was die Attrappe als Kopf, Index und Log schreibt, muss der strenge Leser des Transports annehmen.
  async function assertStoreReadable(projectId) {
    const { doc: index } = await readJson("projects/index.json");
    for (const entry of index.projects) {
      assert.ok(entry.head === null || isTransportHead(entry.head), `Index-Kopf ${JSON.stringify(entry.head)}`);
    }
    const { doc: project } = await readJson(`projects/${projectId}/project.json`);
    assert.ok(project.head === null || isTransportHead(project.head), `Projekt-Kopf ${JSON.stringify(project.head)}`);
    assert.ok(project.log.every(isTransportLogEntry), "Kopf-Log");
    return { index, project };
  }

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "cspp-mock-"));
    fixtures = join(dir, "store");
    mkdirSync(join(fixtures, "projects", PID, "revisions"), { recursive: true });
    writeFileSync(join(fixtures, "store.json"), '{"format":"codesearch.pocket.store","version":1}');
    writeFileSync(join(fixtures, "projects", PID, "revisions", `${REV_A}.json`), revA);
    writeFileSync(join(fixtures, "projects", PID, "revisions", `${REV_B}.json`), revB);
    // Liegen NEBEN dem Fixture-Verzeichnis: kein Pfadtrick und keine Verknuepfung darf sie ausliefern.
    writeFileSync(join(dir, "outside-secret.txt"), OUTSIDE_CANARY);
    mkdirSync(join(dir, "outside"));
    writeFileSync(join(dir, "outside", "outside-secret.txt"), OUTSIDE_CANARY);
    // Verknuepfungen im Fixture-Verzeichnis: "alias" zeigt hinein (auf projects), "elsewhere" hinaus. Junctions
    // brauchen unter Windows keine Adminrechte; auf anderen Systemen legt Node daraus einen Symlink an.
    try {
      symlinkSync(join(fixtures, "projects"), join(fixtures, "alias"), "junction");
      symlinkSync(join(dir, "outside"), join(fixtures, "elsewhere"), "junction");
    } catch (error) {
      linkSkip = `keine Verknuepfung moeglich (${error.code})`;
    }
    // Tokens per Datei statt Kommandozeile: so stehen sie nicht in der Prozessliste.
    tokensFile = join(dir, "tokens.json");
    writeFileSync(tokensFile, JSON.stringify({ valid: [VALID], blocked: [BLOCKED] }));
    mock = await startMock(fixtures, tokensFile);
    assert.equal(mock.ready.event, "ready");
    assert.equal(mock.ready.host, "127.0.0.1");
    assert.equal(mock.ready.cacheControl, "github", "Standard bildet GitHub nach");
    port = mock.ready.port;
    assert.ok(Number.isInteger(port) && port > 0);
  });

  after(async () => {
    await stopMock(mock);
    if (dir) {
      // Verknuepfungen zuerst einzeln entfernen: das rekursive Loeschen soll nie einem Link folgen muessen.
      for (const link of LINKS) rmSync(join(fixtures, link), { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Rohdaten mit gueltigem Token: Bytes, exakte CORS-Freigabe, Cache-Control wie GitHub, schwacher ETag", async () => {
    const response = await read("store.json");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, readFileSync(join(fixtures, "store.json")));
    assert.equal(response.headers["access-control-allow-origin"], TEST_ORIGIN);
    assert.match(response.headers["access-control-expose-headers"], /\bETag\b/);
    assert.equal(response.headers["access-control-allow-credentials"], undefined);
    assert.equal(response.headers["cache-control"], GITHUB_CACHE_CONTROL);
    assert.match(response.headers.etag, /^W\/"[0-9a-f]{40}"$/);
    assert.match(response.headers.vary, /\bOrigin\b/);
    assert.equal(response.headers["content-type"], "application/vnd.github.raw+json; charset=utf-8");
  });

  test("If-None-Match mit passendem ETag -> 304 ohne Body (auch in einer Liste), anderer ETag -> 200", async () => {
    const first = await read(`projects/${PID}/revisions/${REV_A}.json`);
    const etag = first.headers.etag;
    const same = await read(`projects/${PID}/revisions/${REV_A}.json`, { "If-None-Match": etag });
    assert.equal(same.status, 304);
    assert.equal(same.body.length, 0);
    assert.equal(same.headers.etag, etag);
    assert.equal(same.headers["access-control-allow-origin"], TEST_ORIGIN);
    assert.equal(same.headers["cache-control"], GITHUB_CACHE_CONTROL, "304 traegt dieselben Cache-Angaben wie 200");
    assert.equal((await read(`projects/${PID}/revisions/${REV_A}.json`, { "If-None-Match": `"anders", ${etag}` })).status, 304);
    assert.equal((await read(`projects/${PID}/revisions/${REV_A}.json`, { "If-None-Match": 'W/"0000"' })).status, 200);
  });

  test("Cache-Control: Lesen 60 s privat cachebar, Fehler und Preflight ohne Kopf, Steuerung immer no-store", async () => {
    // Darauf beruht die Welle-3-Probe zu Vertrag 11 (cache:"no-store"): vergisst ein Client die Angabe, beantwortet
    // der HTTP-Cache des Browsers die Wiederholung, und /__mock/counters zaehlt sie nicht. Mit no-store von der
    // Attrappe fiele das nie auf - dann erreicht jede Anfrage den Server, egal was der Client setzt.
    const fresh = await read(`projects/${PID}/revisions/${REV_B}.json`);
    assert.equal(fresh.status, 200);
    assert.equal(privateCacheLifetime(fresh.headers["cache-control"]), 60);
    const notModified = await read(`projects/${PID}/revisions/${REV_B}.json`, { "If-None-Match": fresh.headers.etag });
    assert.equal(notModified.status, 304);
    assert.equal(privateCacheLifetime(notModified.headers["cache-control"]), 60);
    await control("fail", { path: "projects/kaputt.json", status: 503 });
    // Alles ausser gelesenen Inhalten: Fehler, fremde Pfade, falsche Methode und der Preflight.
    const uncached = [
      ["ohne Token", await call(`${BASE}/store.json`, { headers: { Accept: RAW, Origin: TEST_ORIGIN } })],
      ["falsches Token", await read("store.json", { Authorization: "Bearer falsch_falsch_falsch_01" })],
      ["gesperrtes Token", await read("store.json", { Authorization: `Bearer ${BLOCKED}` })],
      ["fehlt", await read("projects/fehlt.json")],
      ["Verzeichnis", await read("projects")],
      ["erzwungener Fehler", await read("projects/kaputt.json")],
      ["fremder Pfad", await call("/repos/Tombkn/codesearch-pocket-data/git/refs/heads/main", { headers: { ...AUTH, Accept: RAW } })],
      ["Methode", await call(`${BASE}/store.json`, { method: "DELETE", headers: { ...AUTH, "Content-Length": 0 } })],
      ["Preflight", await call(`${BASE}/store.json`, { method: "OPTIONS", headers: { Origin: TEST_ORIGIN, "Access-Control-Request-Method": "GET" } })],
    ];
    await control("reset");
    for (const [label, response] of uncached) {
      assert.ok(response.status >= 204 && response.status !== 200 && response.status !== 304, `${label}: ${response.status}`);
      assert.equal(response.headers["cache-control"], undefined, label);
      assert.equal(privateCacheLifetime(response.headers["cache-control"]), 0, label);
    }
    const steering = [
      ["state", await call("/__mock/state")], ["counters", await call("/__mock/counters")], ["log", await call("/__mock/log")],
      ["unbekannter Befehl", await call("/__mock/gibtsnicht")], ["POST reset", await call("/__mock/reset", {
        method: "POST", headers: { "Content-Type": "application/json", "Content-Length": 2 }, body: "{}" })],
      ["Preflight Steuerung", await call("/__mock/reset", {
        method: "OPTIONS", headers: { Origin: TEST_ORIGIN, "Access-Control-Request-Method": "POST" } })],
    ];
    for (const [label, response] of steering) assert.equal(response.headers["cache-control"], "no-store", label);
    assert.equal(JSON.parse((await call("/__mock/state")).body.toString("utf8")).cacheControl, "github");
  });

  test("--cache-control no-store: jede Antwort no-store (frueheres Verhalten); unbekannter Modus -> Startfehler", async () => {
    const second = await startMock(fixtures, tokensFile, ["--cache-control", "no-store"]);
    try {
      assert.equal(second.ready.cacheControl, "no-store");
      const headers = { ...AUTH, Accept: RAW, Origin: TEST_ORIGIN };
      const ok = await callAt(second.ready.port, `${BASE}/store.json`, { headers });
      assert.equal(ok.status, 200);
      assert.equal(ok.headers["cache-control"], "no-store");
      const same = await callAt(second.ready.port, `${BASE}/store.json`, { headers: { ...headers, "If-None-Match": ok.headers.etag } });
      assert.equal(same.status, 304);
      assert.equal(same.headers["cache-control"], "no-store");
      const missing = await callAt(second.ready.port, `${BASE}/store.json`, { headers: { Accept: RAW } });
      assert.equal(missing.status, 401);
      assert.equal(missing.headers["cache-control"], "no-store");
    } finally {
      await stopMock(second);
    }
    const wrong = spawnSync(PYTHON, ["-I", "-B", MOCK, "serve", "--port", "0", "--fixtures", fixtures, "--cache-control", "immer"],
      { encoding: "utf8", timeout: 30000 });
    assert.equal(wrong.status, 2);
    assert.match(wrong.stderr, /--cache-control/);
  });

  test("ohne oder mit falschem Token -> 401, gesperrtes Token -> 403 (lesbar dank CORS-Kopf)", async () => {
    const cases = [
      [{}, 401, "Requires authentication"],
      [{ Authorization: "Bearer falsch_falsch_falsch_01" }, 401, "Bad credentials"],
      [{ Authorization: `Basic ${VALID}` }, 401, "Bad credentials"],
      [{ Authorization: `Bearer ${BLOCKED}` }, 403, null],
    ];
    for (const [headers, status, message] of cases) {
      const response = await call(`${BASE}/store.json`, { headers: { Accept: RAW, Origin: TEST_ORIGIN, ...headers } });
      assert.equal(response.status, status, JSON.stringify(Object.keys(headers)));
      assert.equal(response.headers["access-control-allow-origin"], TEST_ORIGIN);
      if (message) assert.equal(JSON.parse(response.body.toString("utf8")).message, message);
    }
    assert.equal((await read("store.json", { Authorization: `token ${VALID}` })).status, 200, "Schema 'token' wie bei GitHub");
  });

  test("Preflight: nur die Test-Origin, Allow-Headers wie GitHub (mit X-GitHub-Api-Version), keine Credentials", async () => {
    // So fragt ein Browser fuer sync.js nach, wenn der Client wie der PC-Transport die API-Version mitsendet.
    // Accept fehlt in der Frage: fuer application/vnd.github.raw+json ist er CORS-safelisted.
    const asked = { "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization, if-none-match, x-github-api-version" };
    const ok = await call(`${BASE}/projects/index.json`, { method: "OPTIONS", headers: { Origin: TEST_ORIGIN, ...asked } });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers["access-control-allow-origin"], TEST_ORIGIN);
    const allowed = ok.headers["access-control-allow-headers"].split(",").map((item) => item.trim());
    assert.deepEqual(allowed, GITHUB_ALLOW_HEADERS, "Liste wie im Preflight von api.github.com");
    const lower = allowed.map((item) => item.toLowerCase());
    for (const name of ["authorization", "if-none-match", "x-github-api-version"]) assert.ok(lower.includes(name), name);
    assert.equal(ok.headers["access-control-allow-methods"], "GET");
    assert.equal(ok.headers["access-control-max-age"], "0");
    assert.equal(ok.headers["access-control-allow-credentials"], undefined);
    const foreign = await call(`${BASE}/projects/index.json`, { method: "OPTIONS", headers: { Origin: "https://evil.example", ...asked } });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.headers["access-control-allow-origin"], undefined);
    const steering = await call("/__mock/reset", { method: "OPTIONS", headers: { Origin: TEST_ORIGIN, ...asked } });
    assert.equal(steering.status, 403);
    assert.equal(steering.headers["access-control-allow-origin"], undefined);
    const privateNet = await call(`${BASE}/store.json`, { method: "OPTIONS", headers: { Origin: TEST_ORIGIN, ...asked, "Access-Control-Request-Private-Network": "true" } });
    assert.equal(privateNet.headers["access-control-allow-private-network"], "true");
    // Ein Header, den GitHub nicht freigibt, scheitert im Browser; das Log nennt ihn (Diagnose fuer Welle 3).
    await call(`${BASE}/projects/index.json`, { method: "OPTIONS", headers: { Origin: TEST_ORIGIN, "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "Authorization, X-Pocket-Extra, If-None-Match" } });
    const afterDenied = JSON.parse((await call("/__mock/log")).body.toString("utf8")).entries.at(-1);
    assert.deepEqual(afterDenied.preflightDenied, ["x-pocket-extra"]);
    // Die Attrappe vermerkt die gesendete API-Version (nur die Datumsform) und wertet sie nicht aus.
    assert.equal((await read("store.json", { "X-GitHub-Api-Version": "2022-11-28" })).status, 200);
    const withVersion = JSON.parse((await call("/__mock/log")).body.toString("utf8")).entries.at(-1);
    assert.equal(withVersion.apiVersion, "2022-11-28");
  });

  test("fremde Origin bekommt keine Freigabe (Browser wuerde blockieren)", async () => {
    const response = await read("store.json", { Origin: "https://evil.example" });
    assert.equal(response.status, 200);
    assert.equal(response.headers["access-control-allow-origin"], undefined);
    const noOrigin = await call(`${BASE}/store.json`, { headers: { ...AUTH, Accept: RAW } });
    assert.equal(noOrigin.headers["access-control-allow-origin"], undefined);
  });

  test("Standard-Medientyp: GitHub-JSON mit base64 und Git-Blob-SHA; ueber 1 MiB nur raw/object", async () => {
    const response = await call(`${BASE}/projects/${PID}/revisions/${REV_A}.json`, { headers: { ...AUTH, Accept: "application/vnd.github+json" } });
    assert.equal(response.status, 200);
    const doc = JSON.parse(response.body.toString("utf8"));
    assert.equal(doc.type, "file");
    assert.equal(doc.encoding, "base64");
    assert.equal(doc.size, revA.length);
    assert.deepEqual(Buffer.from(doc.content, "base64"), revA);
    assert.equal(doc.sha, gitBlobSha(revA));
    const big = Buffer.alloc(1024 * 1024 + 7, 0x61);
    assert.equal((await control("put-file", { path: "projects/big.json", base64: big.toString("base64") })).status, 200);
    try {
      assert.equal((await call(`${BASE}/projects/big.json`, { headers: { ...AUTH, Accept: "application/vnd.github+json" } })).status, 403);
      const object = JSON.parse((await call(`${BASE}/projects/big.json`, { headers: { ...AUTH, Accept: "application/vnd.github.object+json" } })).body);
      assert.equal(object.encoding, "none");
      assert.equal(object.content, "");
      assert.deepEqual((await read("projects/big.json")).body, big);
    } finally {
      await control("reset");
    }
  });

  test("Pfade aus dem Fixture-Verzeichnis heraus, versteckte Dateien und fremde Repos -> 404", async () => {
    const bad = ["../outside-secret.txt", "%2e%2e/outside-secret.txt", "projects/..%2F..%2Foutside-secret.txt",
      "..%5Coutside-secret.txt", "projects/.hidden", "projects//index.json", "store.json%00", "%E0%A4%A"];
    for (const rel of bad) {
      const response = await call(`${BASE}/${rel}`, { headers: { ...AUTH, Accept: RAW } });
      assert.equal(response.status, 404, rel);
      assert.ok(!response.body.toString("latin1").includes(OUTSIDE_CANARY), rel);
    }
    for (const path of ["/repos/Tombkn/codesearch-pocket/contents/store.json", "/repos/fremd/codesearch-pocket-data/contents/store.json", "/repos/Tombkn/codesearch-pocket-data/git/refs/heads/main"]) {
      assert.equal((await call(path, { headers: { ...AUTH, Accept: RAW } })).status, 404, path);
    }
    assert.equal((await call("/repos/tombkn/CODESEARCH-POCKET-DATA/contents/store.json", { headers: { ...AUTH, Accept: RAW } })).status, 200);
    assert.equal((await read("projects")).status, 501, "Verzeichnisse sind nicht nachgebildet");
  });

  test("Pfade gross/klein-genau wie bei Git: Schreibvarianten, Punkt am Namensende und Geraetenamen -> 404", async () => {
    // Windows (und macOS) oeffnen diese Varianten; GitHub kennt sie nicht. Ein Pfadfehler in sync.js muss auch in
    // Toms Windows-Testlauf als 404 auffallen.
    const exact = `projects/${PID}/revisions/${REV_A}.json`;
    assert.equal((await read(exact)).status, 200);
    const variants = ["STORE.JSON", "Store.json", "store.JSON", "store.json.", "store.json..", `Projects/${PID}/revisions/${REV_A}.json`,
      `projects/${PID.toUpperCase()}/revisions/${REV_A}.json`, `projects/${PID}/Revisions/${REV_A}.json`,
      `projects/${PID}/revisions/${REV_A.toUpperCase()}.json`, `projects/${PID}/revisions/${REV_A}.JSON`, `projects./${PID}/revisions/${REV_A}.json`,
      "NUL", "CON", "projects/NUL", "store.json/NUL", "store.json/x"];
    for (const rel of variants) {
      const response = await read(rel);
      assert.equal(response.status, 404, rel);
    }
    const overlay = "projects/Gross.json";
    assert.equal((await control("put-file", { path: overlay, text: "{}" })).status, 200);
    try {
      assert.equal((await read(overlay)).status, 200, "Ueberlagerung: genau dieser Name");
      assert.equal((await read("projects/gross.json")).status, 404, "Ueberlagerung: andere Schreibweise");
    } finally {
      await control("reset");
    }
  });

  test("Verknuepfungen im Fixture-Verzeichnis (Junction/Symlink) fuehren nie auf eine andere Datei -> 404", async (t) => {
    if (linkSkip) {
      t.skip(linkSkip);
      return;
    }
    const inside = await read(`alias/${PID}/revisions/${REV_A}.json`);
    assert.equal(inside.status, 404, "Umweg auf eine Datei innerhalb der Fixtures");
    assert.equal((await read("alias")).status, 404, "Umweg auf ein Verzeichnis");
    const outside = await read("elsewhere/outside-secret.txt");
    assert.equal(outside.status, 404, "Umweg aus den Fixtures heraus");
    assert.ok(!outside.body.toString("latin1").includes(OUTSIDE_CANARY));
  });

  test("set-head: index.json und project.json wie der Transport (kompakt, sortiert), Fixture bleibt unberuehrt", async () => {
    await control("reset");
    const first = await control("set-head", { projectId: PID, revisionId: REV_A, committedAt: "2026-11-05T10:00:00Z" });
    assert.equal(first.status, 200);
    assert.equal(first.json.head.seq, 1);
    assert.deepEqual(first.json.fallbacks, []);
    const one = await readJson("projects/index.json");
    assert.equal(one.response.body.toString("utf8"), sortedJson(one.doc));
    assert.equal(one.doc.format, "codesearch.pocket.index");
    assert.deepEqual(one.doc.projects, [{ projectId: PID, status: "active", head: {
      seq: 1, revisionId: REV_A, committedAt: "2026-11-05T10:00:00Z", exportedAt: "2026-11-05T09:30:00Z",
      projectName: "Weichzeichner", bytes: revA.length, counts: { operators: 3, codeSources: 1 }, rootPath: "/project1/Weichzeichner",
    } }]);
    const second = await control("set-head", { projectId: PID, revisionId: REV_B });
    assert.equal(second.json.head.seq, 2);
    const changed = await read("projects/index.json", { "If-None-Match": one.response.headers.etag });
    assert.equal(changed.status, 200, "neuer Kopf = neuer ETag");
    const two = JSON.parse(changed.body.toString("utf8"));
    assert.equal(two.projects[0].head.seq, 2);
    assert.equal(two.projects[0].head.revisionId, REV_B);
    assert.equal(two.projects[0].head.projectName, "Weichzeichner zwei");
    const { doc: project } = await readJson(`projects/${PID}/project.json`);
    assert.equal(project.format, "codesearch.pocket.project");
    assert.equal(project.status, "active");
    assert.deepEqual(project.log.map((entry) => [entry.seq, entry.prevSeq, entry.revisionId, entry.installId]),
      [[2, 1, REV_B, "mock-store"], [1, 0, REV_A, "mock-store"]]);
    assert.deepEqual(project.head, two.projects[0].head);
    await assertStoreReadable(PID);
    // Rueckfall der Projektliste (kleinere seq) und Kopf auf eine nicht gespeicherte Revision als Testfaelle
    assert.equal((await control("set-head", { projectId: PID, revisionId: REV_A, seq: 1 })).json.head.seq, 1);
    assert.equal((await control("set-head", { projectId: PID, revisionId: REV_MISSING })).status, 404);
    const missing = await control("set-head", { projectId: PID, revisionId: REV_MISSING, allowMissing: true });
    assert.equal(missing.status, 200);
    assert.equal(missing.json.head.bytes, 0);
    assert.equal((await read(`projects/${PID}/revisions/${REV_MISSING}.json`)).status, 404);
    await assertStoreReadable(PID);
    assert.equal((await control("set-head", { projectId: "psp_kaputt", revisionId: REV_A })).status, 400);
    assert.equal(existsSync(join(fixtures, "projects", "index.json")), false, "nur Ueberlagerung, nie das Fixture");
    assert.equal(existsSync(join(fixtures, "projects", PID, "project.json")), false);
  });

  test("Kopf bleibt fuer den Transport-Leser gueltig: Paketwerte ausserhalb der Grenzen -> Rueckfall + fallbacks", async () => {
    await control("reset");
    // Ein absichtlich kaputtes Testpaket soll in Pocket als Paketfehler auffallen, nicht als kaputter Speicher.
    const odd = Buffer.from(JSON.stringify({
      format: "codesearch.pocket.snapshot", projectId: PID, revision: { id: REV_ODD }, projectName: "N".repeat(300),
      exportedAt: "2026-02-30T10:00:00Z", exportRoot: { path: `/project1/${"x".repeat(2000)}` },
      operators: [{ rel: "" }], codeSources: [],
    }), "utf8");
    assert.equal((await control("put-file", { path: `projects/${PID}/revisions/${REV_ODD}.json`, base64: odd.toString("base64") })).status, 200);
    const result = await control("set-head", { projectId: PID, revisionId: REV_ODD, committedAt: "2026-11-05T12:00:00Z" });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.ok(isTransportHead(result.json.head), "Kopf nach den Regeln des Transport-Lesers");
    await assertStoreReadable(PID);
    assert.deepEqual([result.json.head.projectName, result.json.head.rootPath, result.json.head.exportedAt],
      ["Mock-Projekt", "/project1", "2026-11-05T12:00:00Z"]);
    assert.deepEqual(result.json.fallbacks, ["exportedAt", "projectName", "rootPath"]);
    // Ein ausdruecklicher Name ersetzt den Paketnamen: dann ist das kein Rueckfall.
    const named = await control("set-head", { projectId: PID, revisionId: REV_ODD, projectName: "Benannt", exportedAt: "2026-11-05T11:00:00Z" });
    assert.deepEqual(named.json.fallbacks, ["rootPath"]);
    assert.equal(named.json.head.projectName, "Benannt");
    // Einzelnes Surrogat im Paketnamen (JSON-Escape, kein UTF-8 moeglich): frueher brach die Antwort ganz ab.
    const lone = Buffer.from(`{"format":"codesearch.pocket.snapshot","projectId":"${PID}","revision":{"id":"${REV_ODD}"},`
      + '"projectName":"\\ud800","exportedAt":"2026-11-05T09:30:00Z","exportRoot":{"path":"/project1/x"},"operators":[],"codeSources":[]}', "utf8");
    const published = await control("publish", { base64: lone.toString("base64") });
    assert.equal(published.status, 200, JSON.stringify(published.json));
    assert.deepEqual(published.json.fallbacks, ["projectName"]);
    assert.equal(published.json.head.projectName, "Mock-Projekt");
    assert.equal(published.json.head.rootPath, "/project1/x");
    await assertStoreReadable(PID);
    await control("reset");
  });

  test("Ausdrueckliche Werte ausserhalb der Grenzen -> 400 (nie still ersetzt, nie ein abgebrochener Request)", async () => {
    await control("reset");
    const invalid = [{ projectName: "\ud800" }, { projectName: "N".repeat(121) }, { projectName: "" },
      { committedAt: "2026-02-30T10:00:00Z" }, { exportedAt: "2026-13-01T00:00:00Z" }, { committedAt: "2026-11-05 10:00:00" }];
    for (const payload of invalid) {
      const response = await control("set-head", { projectId: PID, revisionId: REV_A, ...payload });
      assert.equal(response.status, 400, JSON.stringify(payload));
    }
    const longest = await control("set-head", { projectId: PID, revisionId: REV_A, projectName: "N".repeat(120) });
    assert.equal(longest.status, 200, "120 Codepoints sind erlaubt");
    assert.equal((await control("delete-project", { projectId: PID, deletedAt: "2026-02-30T10:00:00Z" })).status, 400);
    assert.equal((await control("put-file", { path: "projects/lone.json", text: "\ud800" })).status, 400);
    await control("reset");
  });

  test("publish: Paket bytegleich ablegen und den Kopf darauf setzen", async () => {
    await control("reset");
    const vector = new URL("tools/fixtures/pocket/js-vectors/valid-weichzeichner.json", ROOT);
    const bytes = existsSync(vector) ? readFileSync(vector) : revB;
    const doc = JSON.parse(bytes.toString("utf8"));
    const result = await control("publish", { base64: bytes.toString("base64") });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.equal(result.json.projectId, doc.projectId);
    assert.equal(result.json.revisionId, doc.revision.id);
    assert.equal(result.json.head.bytes, bytes.length);
    assert.equal(result.json.head.counts.operators, doc.operators.length);
    assert.deepEqual(result.json.fallbacks, []);
    const stored = await read(`projects/${doc.projectId}/revisions/${doc.revision.id}.json`);
    assert.deepEqual(stored.body, bytes);
    const { index } = await assertStoreReadable(doc.projectId);
    assert.ok(index.projects.some((entry) => entry.projectId === doc.projectId && entry.head.revisionId === doc.revision.id));
    assert.equal((await control("publish", { base64: Buffer.from("{}").toString("base64") })).status, 400);
    await control("reset");
  });

  test("delete-project: Grabstein mit lastSeq, Revisionen weg, danach kein neuer Kopf und kein neues Paket", async () => {
    await control("reset");
    await control("set-head", { projectId: PID, revisionId: REV_A });
    await control("set-head", { projectId: PID, revisionId: REV_B });
    const deleted = await control("delete-project", { projectId: PID, deletedAt: "2026-11-05T11:00:00Z" });
    assert.equal(deleted.json.lastSeq, 2);
    const { doc: project } = await readJson(`projects/${PID}/project.json`);
    assert.deepEqual({ status: project.status, head: project.head, lastSeq: project.lastSeq, log: project.log, deletedAt: project.deletedAt },
      { status: "deleted", head: null, lastSeq: 2, log: [], deletedAt: "2026-11-05T11:00:00Z" });
    const { doc: index } = await readJson("projects/index.json");
    assert.deepEqual(index.projects, [{ projectId: PID, status: "deleted", head: null }]);
    await assertStoreReadable(PID);
    assert.equal((await read(`projects/${PID}/revisions/${REV_A}.json`)).status, 404);
    assert.equal((await control("set-head", { projectId: PID, revisionId: REV_A })).status, 409);
    // Spaete Outbox nach dem Grabstein (Abnahme 17): kein Kopf - und auch das Paket bleibt draussen, wie beim
    // Transport, der den Grabstein vor dem Blob prueft.
    const late = syntheticPackage(REV_MISSING, "Spaet", 1);
    assert.equal((await control("publish", { base64: late.toString("base64") })).status, 409);
    assert.equal((await read(`projects/${PID}/revisions/${REV_MISSING}.json`)).status, 404);
    await control("reset");
    assert.equal((await read(`projects/${PID}/revisions/${REV_A}.json`)).status, 200, "reset hebt die Ueberlagerung auf");
  });

  test("fail und delay: erzwungener Fehler je Pfad, verzoegerte Antwort kommt nach einer spaeteren", async () => {
    await control("reset");
    await control("fail", { path: "store.json", status: 503 });
    const failed = await read("store.json");
    assert.equal(failed.status, 503);
    assert.equal(failed.headers["access-control-allow-origin"], TEST_ORIGIN);
    await control("fail", { path: "store.json", status: null });
    assert.equal((await read("store.json")).status, 200);
    await control("delay", { path: `projects/${PID}/revisions/${REV_A}.json`, ms: 400 });
    const order = [];
    const slow = read(`projects/${PID}/revisions/${REV_A}.json`).then((response) => { order.push("A"); return response; });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const fast = read(`projects/${PID}/revisions/${REV_B}.json`).then((response) => { order.push("B"); return response; });
    const [a, b] = await Promise.all([slow, fast]);
    assert.deepEqual(order, ["B", "A"], "vertauschte Ankunft fuer den Pocket-Test");
    assert.deepEqual([a.status, b.status], [200, 200]);
    const logDoc = JSON.parse((await call("/__mock/log")).body.toString("utf8"));
    assert.ok(logDoc.entries.some((entry) => entry.rel === `projects/${PID}/revisions/${REV_A}.json` && entry.delayMs === 400));
    await control("reset");
  });

  test("token: sperren -> 403, widerrufen -> 401, wieder gueltig -> 200; unbekanntes Etikett -> 404", async () => {
    await control("token", { label: "valid-1", state: "blocked" });
    assert.equal((await read("store.json")).status, 403);
    await control("token", { label: "valid-1", state: "removed" });
    assert.equal((await read("store.json")).status, 401);
    await control("token", { label: "valid-1", state: "valid" });
    assert.equal((await read("store.json")).status, 200);
    assert.equal((await control("token", { label: "valid-9", state: "valid" })).status, 404);
    assert.equal((await control("token", { label: "valid-1", state: "kaputt" })).status, 400);
  });

  test("Steuerung: nur JSON-POST, nie CORS; die Pocket-API selbst ist nur lesbar", async () => {
    const plain = await call("/__mock/reset", { method: "POST", headers: { "Content-Type": "text/plain", "Content-Length": 2, Origin: TEST_ORIGIN }, body: "{}" });
    assert.equal(plain.status, 415);
    assert.equal(plain.headers["access-control-allow-origin"], undefined);
    const ok = await control("reset");
    assert.equal(ok.headers["access-control-allow-origin"], undefined);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal((await call(`${BASE}/store.json`, { method, headers: { ...AUTH, "Content-Length": 0 } })).status, 405, method);
    }
    assert.equal((await control("unbekannt")).status, 404);
  });

  test("Log, Zaehler, Zustand und Prozessausgabe enthalten nie ein Token (auch nicht aus Query oder fremdem Header)", async () => {
    // Ein falsch gebauter Client koennte das Token in die Query oder in X-GitHub-Api-Version stecken.
    await call(`${BASE}/store.json`, { headers: { ...AUTH, Accept: RAW, "X-GitHub-Api-Version": VALID } });
    await call(`${BASE}/store.json?access_token=${VALID}`, { headers: { ...AUTH, Accept: RAW } });
    const log = (await call("/__mock/log")).body.toString("utf8");
    const counters = JSON.parse((await call("/__mock/counters")).body.toString("utf8"));
    const state = (await call("/__mock/state")).body.toString("utf8");
    for (const text of [log, JSON.stringify(counters), state, mock.output]) {
      assert.ok(!text.includes(VALID), "gueltiges Token geleakt");
      assert.ok(!text.includes(BLOCKED), "gesperrtes Token geleakt");
    }
    const entries = JSON.parse(log).entries;
    const withQuery = entries.at(-1);
    assert.equal(withQuery.query, true);
    assert.equal(withQuery.path, `${BASE}/store.json`);
    assert.equal(entries.at(-2).apiVersion, "other", "fremder Wert im Versionskopf wird nur als 'other' vermerkt");
    assert.ok(entries.some((entry) => entry.auth === "valid" && entry.token === "valid-1"));
    assert.ok(entries.some((entry) => entry.auth === "blocked" && entry.token === "blocked-1"));
    assert.ok(counters.fetched > 0 && counters.notModified > 0 && counters.unauthorized > 0 && counters.forbidden > 0 && counters.preflights > 0);
    assert.deepEqual(JSON.parse(state).tokens, [{ label: "valid-1", state: "valid" }, { label: "blocked-1", state: "blocked" }]);
  });

  test("Kommandozeile: set-head und log als Hilfsbefehle gegen den laufenden Server", () => {
    const run = (...args) => spawnSync(PYTHON, ["-I", "-B", MOCK, ...args, "--port", String(port)], { encoding: "utf8", timeout: 30000 });
    const head = run("set-head", "--project", PID, "--revision", REV_B);
    assert.equal(head.status, 0, head.stderr);
    const result = JSON.parse(head.stdout);
    assert.equal(result.head.revisionId, REV_B);
    assert.deepEqual(result.fallbacks, []);
    const log = run("log");
    assert.equal(log.status, 0, log.stderr);
    assert.ok(JSON.parse(log.stdout).entries.length > 0);
    const reset = run("reset");
    assert.equal(reset.status, 0, reset.stderr);
  });
});
