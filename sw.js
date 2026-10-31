// Erzeugt von tools/build_offline.py - nicht von Hand aendern.
// Speichert beim ersten Besuch JEDE Datei des Kurses; ohne Netz kommt alles aus diesem Speicher.
const VERSION = "1dcb79df2b";
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
  "js/core/boot.js",
  "js/core/cs.js",
  "js/core/gestures.js",
  "js/core/investigation.js",
  "js/core/lab.js",
  "js/core/learning.js",
  "js/core/net.js",
  "js/core/phone.js",
  "js/core/tour.js",
  "js/core/util.js",
  "js/core/views/codeviews.js",
  "js/core/views/common.js",
  "js/core/views/miscviews.js",
  "js/core/views/netviews.js",
  "js/core/views/search.js",
  "js/ui/cswin.js",
  "js/ui/dom.js",
  "js/ui/layers.js",
  "js/ui/learningview.js",
  "js/ui/offline.js",
  "js/ui/tourcard.js",
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
// darum nicht nur beim Aktivieren, sondern bei jedem Seitenaufruf.
async function dropOld() {
  for (const key of await caches.keys()) {
    if (key.startsWith("codesearch-pocket") && key !== CACHE) await caches.delete(key);
  }
}

// Mit Netz: frisch holen. Ohne Netz oder nach 4 s Funkloch: aus dem Speicher.
// Geschrieben wird der Speicher nur beim Installieren - so liegt darin immer genau EINE Version.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (req.mode === "navigate") event.waitUntil(dropOld());
  event.respondWith((async () => {
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
  })());
});
