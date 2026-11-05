// Erzeugt von tools/build_offline.py - nicht von Hand aendern.
// Speichert beim Installieren JEDE Datei des Kurses; ohne Netz kommt alles aus diesem Speicher.
//
// Erlaubt-Liste (Vertrag POCKET-PROJECTS-SPEC 13 und 15): Der Worker antwortet NUR fuer die Dateien aus offline.json
// und fuer Seitenaufrufe dieser App. Alles andere geht ohne respondWith unveraendert ans Netz, als gaebe es den
// Worker nicht: fremde Origins (api.github.com), Anfragen mit Authorization-Header oder ausdruecklichen
// Zugangsdaten, alles ausser GET und unbekannte Pfade derselben Origin. Grund: private Projektdaten und Tokens
// laufen nie durch diesen Code und landen nie in Cache Storage, das sich alle Seiten von tombkn.github.io teilen.
// Geschrieben wird der Speicher nur beim Installieren, nie beim Beantworten einer Anfrage.
const VERSION = "025cbe83a6";
const CACHE = `codesearch-pocket-${VERSION}`;
const FILES = [
  "./",
  "index.html",
  "manifest.json",
  "icon.svg",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "css/app.css",
  "js/app.js",
  "js/core/analysis-workbench.js",
  "js/core/boot.js",
  "js/core/comp-operations.js",
  "js/core/cs.js",
  "js/core/float-copies.js",
  "js/core/flow-session.js",
  "js/core/gestures.js",
  "js/core/investigation.js",
  "js/core/lab.js",
  "js/core/learning.js",
  "js/core/multi-selection.js",
  "js/core/net.js",
  "js/core/phone.js",
  "js/core/progress.js",
  "js/core/regex-queue.js",
  "js/core/search-sessions.js",
  "js/core/signalgarden.js",
  "js/core/source-ref.js",
  "js/core/spec-workbench.js",
  "js/core/tour.js",
  "js/core/util.js",
  "js/core/views/codeviews.js",
  "js/core/views/common.js",
  "js/core/views/comp-context.js",
  "js/core/views/miscviews.js",
  "js/core/views/netviews.js",
  "js/core/views/search.js",
  "js/projects/anchors.js",
  "js/projects/c14n.js",
  "js/projects/model.js",
  "js/projects/schema.js",
  "js/projects/store.js",
  "js/projects/sync.js",
  "js/projects/verify.js",
  "js/ui/analysis.js",
  "js/ui/cs-host.js",
  "js/ui/cswin.js",
  "js/ui/dom.js",
  "js/ui/float-focus.js",
  "js/ui/layers.js",
  "js/ui/learningview.js",
  "js/ui/looks.js",
  "js/ui/offline.js",
  "js/ui/project-code.js",
  "js/ui/project-details.js",
  "js/ui/project-dom.js",
  "js/ui/project-highlight.js",
  "js/ui/project-netmath.js",
  "js/ui/project-network.js",
  "js/ui/project-notes.js",
  "js/ui/project-views.js",
  "js/ui/projects.js",
  "js/ui/search-options.js",
  "js/ui/spec.js",
  "js/ui/tabhelp.js",
  "js/ui/tourcard.js",
  "js/ui/viewport.js",
  "js/ui/wheel.js",
  "data/course.json",
  "data/net.json",
  "data/code.json",
  "data/ui.json",
  "data/features.json",
  "img/05_flow.webp",
  "img/06_table.webp",
  "img/07_triggers.webp",
  "img/08_structure.webp",
  "img/10_callpath.webp",
  "img/12_audit.webp",
  "img/13_readorder.webp",
  "img/codesearch-search.webp",
  "img/flowlens_branchlab_nur_kabel.webp",
  "img/flowlens_branchlab_raw.webp",
  "img/flowlens_branchlab_story.webp",
  "offline.json"
];
// Ort von sw.js = Geltungsbereich der App (app.js meldet sw.js ohne eigenes scope an).
const SCOPE = new URL("./", self.location.href);
// Erlaubte Pfade ohne ?v=...: index.html haengt die Version an CSS und JS, der Speicher sucht mit ignoreSearch.
const ALLOWED = new Set(FILES.map((file) => new URL(file, SCOPE).pathname));
// Nur Speicher mit dem eigenen Namensschema aufraeumen (10 Hex, ganz frueher "v2"); fremde Caches derselben Origin,
// die zufaellig aehnlich anfangen, bleiben unberuehrt.
const OWN_CACHE = /^codesearch-pocket-(?:[0-9a-f]{10}|v[0-9]+)$/;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const file of FILES) {
      const res = await fetch(file, { cache: "reload" });
      if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
      await cache.put(file, res);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await dropOld();
    await self.clients.claim();
  })());
});

// Alte Speicher weg. Ein alter Service Worker kann waehrend des Wechsels noch einmal in seinen Speicher schreiben,
// darum nicht nur beim Aktivieren, sondern bei jedem Seitenaufruf. Nicht, solange ein neuerer Worker installiert oder
// wartet: dessen halb gefuellter Speicher waere hier sonst "alt" und weg - die Seite luede alles doppelt, und ohne Netz
// startete der neue Worker mit Luecken. Aufgeraeumt wird dann beim Aktivieren des neuen Workers.
async function dropOld() {
  const reg = self.registration;
  if (reg && (reg.installing || reg.waiting)) return;
  for (const key of await caches.keys()) {
    if (OWN_CACHE.test(key) && key !== CACHE) await caches.delete(key);
  }
}

// Nur App-Anfragen bekommen eine Antwort vom Worker; alles andere sieht der Worker nur kurz und gibt es frei.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!isAppRequest(req)) return;
  if (req.mode === "navigate") event.waitUntil(dropOld());
  event.respondWith(netFirst(req));
});

// Darf der Worker antworten? Erst alles Fremde aussortieren, danach zaehlt nur die Erlaubt-Liste.
function isAppRequest(req) {
  if (req.method !== "GET") return false;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return false;
  // Ein Token im Header heisst: Daten eines Kontos. Solche Antworten gehen nie durch diesen Code.
  if (req.headers.has("authorization")) return false;
  // Seitenaufrufe der App; der Browser schickt sie immer mit credentials "include", das ist hier normal.
  if (req.mode === "navigate") return url.href.startsWith(SCOPE.href);
  // credentials "include" aus fetch() (mode cors oder same-origin) ist eine ausdrueckliche Anfrage mit Zugangsdaten
  // und bleibt draussen. Bilder, CSS und Icons laedt der Browser nach HTML-Regel auch mit "include", aber im mode
  // "no-cors" - das sind die App-Dateien selbst und muessen offline weiter aus dem Speicher kommen.
  if (req.credentials === "include" && req.mode !== "no-cors") return false;
  return ALLOWED.has(url.pathname);
}

// Mit Netz: frisch holen. Ohne Netz oder nach 4 s Funkloch: aus dem Speicher.
// Hier steht bewusst kein cache.put: so liegt im Speicher immer genau EINE Version und nie eine Laufzeitantwort.
async function netFirst(req) {
  const url = new URL(req.url);
  const cache = await caches.open(CACHE);
  const key = url.origin + url.pathname;
  const fromNet = fetch(req, { cache: "no-cache" });
  fromNet.catch(() => undefined);
  const cached = () => cache.match(key, { ignoreSearch: true })
    .then((hit) => hit || (req.mode === "navigate" ? cache.match("index.html") : undefined));
  const slow = new Promise((resolve) => { setTimeout(resolve, 4000, "slow"); });
  try {
    const first = await Promise.race([fromNet, slow]);
    if (first !== "slow") return first;
    return (await cached()) || (await fromNet);
  } catch {
    const hit = await cached();
    if (hit) return hit;
    return new Response("offline und nicht gespeichert", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
