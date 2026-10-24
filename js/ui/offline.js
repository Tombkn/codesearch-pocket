// Offline: pruefen, ob jede Datei des Kurses im Speicher des Handys liegt, fehlende nachladen, Speicher schuetzen.
// Die Liste aller Dateien (offline.json) und der Service Worker (sw.js) kommen aus tools/build_offline.py.

const SINGLE = typeof window !== "undefined" && Boolean(window.__POCKET_DATA__);

export const offline = {
  single: SINGLE,
  manifest: null,
  cached: 0,
  bytes: 0,
  missing: [],
  busy: false,
  progress: "",
  persisted: null,
  sw: "prüfe …",
  installPrompt: null,
  installed: false,
  error: "",
};

function cacheName() {
  return `codesearch-pocket-${offline.manifest.version}`;
}

export async function loadManifest() {
  if (SINGLE) {
    offline.sw = "nicht nötig – diese Datei enthält alles";
    return null;
  }
  try {
    const res = await fetch("offline.json", { cache: "no-cache" });
    offline.manifest = await res.json();
  } catch {
    try {
      const hit = await caches.match("offline.json", { ignoreSearch: true });
      offline.manifest = hit ? await hit.json() : null;
    } catch { offline.manifest = null; }
  }
  return offline.manifest;
}

export async function checkStatus() {
  if (SINGLE || !offline.manifest) return;
  if (!("caches" in window)) { offline.sw = "dieser Browser kann nichts offline speichern"; return; }
  const cache = await caches.open(cacheName());
  let cached = 0;
  let bytes = 0;
  const missing = [];
  for (const file of offline.manifest.files) {
    const hit = await cache.match(file.path, { ignoreSearch: true });
    if (hit) { cached += 1; bytes += file.size; } else missing.push(file);
  }
  offline.cached = cached;
  offline.bytes = bytes;
  offline.missing = missing;
  if ("serviceWorker" in navigator) {
    const reg = await navigator.serviceWorker.getRegistration();
    offline.sw = reg && reg.active ? "aktiv" : (reg ? "wird eingerichtet" : "nicht registriert");
  } else offline.sw = "nicht verfügbar (nur über https oder localhost)";
  if (navigator.storage && navigator.storage.persisted) offline.persisted = await navigator.storage.persisted();
  offline.installed = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

export function complete() {
  return SINGLE || Boolean(offline.manifest && offline.cached === offline.manifest.files.length);
}

// Jede fehlende Datei holen (force = alle neu) und in den Kurs-Speicher legen
export async function downloadAll(onProgress, force = false) {
  if (SINGLE || !offline.manifest || offline.busy) return;
  offline.busy = true;
  offline.error = "";
  try {
    const cache = await caches.open(cacheName());
    const files = force ? offline.manifest.files : offline.missing;
    let n = 0;
    for (const file of files) {
      n += 1;
      offline.progress = `${n}/${files.length} · ${file.path}`;
      onProgress();
      const res = await fetch(file.path, { cache: "reload" });
      if (!res.ok) throw new Error(`${file.path}: HTTP ${res.status}`);
      await cache.put(file.path, res);
    }
    // Speicher schuetzen gleich mit anfragen: sonst darf der Browser ihn bei Platzmangel loeschen
    if (navigator.storage && navigator.storage.persist) offline.persisted = await navigator.storage.persist();
  } catch (error) {
    offline.error = `Nicht alles geladen: ${error.message}. Mit Netz erneut versuchen.`;
  } finally {
    offline.busy = false;
    offline.progress = "";
    await checkStatus();
    onProgress();
  }
}

export async function persist() {
  if (navigator.storage && navigator.storage.persist) offline.persisted = await navigator.storage.persist();
}

export function watchInstall(onChange) {
  window.addEventListener("beforeinstallprompt", (ev) => {
    ev.preventDefault();
    offline.installPrompt = ev;
    onChange();
  });
  window.addEventListener("appinstalled", () => { offline.installed = true; offline.installPrompt = null; onChange(); });
}

export async function install() {
  const prompt = offline.installPrompt;
  if (!prompt) return;
  prompt.prompt();
  await prompt.userChoice;
  offline.installPrompt = null;
}

export function mb(bytes) {
  return `${(bytes / 1048576).toFixed(1).replace(".", ",")} MB`;
}
