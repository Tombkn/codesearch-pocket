"""Baut alles, was der Kurs fuer den Offline-Betrieb braucht.

1. CodeSearch-Pocket-offline.html: der ganze Kurs in EINER Datei (JS gebuendelt, CSS, Daten und Bilder eingebettet).
2. offline.json: jede Datei, die das Handy speichern muss, mit Groesse und einer Version (Hash ueber alle Inhalte).
3. sw.js: Service Worker, der genau diese Dateien beim ersten Besuch speichert und ohne Netz aus dem Speicher liefert.
4. index.html: ?v=<version> an CSS und JS, damit ein neuer Stand nicht an einer alten Browser-Kopie haengt.

Aufruf (nach build_data.py und nach jeder Aenderung an js/, css/, img/, data/):  python tools/build_offline.py
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SINGLE = "CodeSearch-Pocket-offline.html"
DATA_FILES = ["course.json", "net.json", "code.json", "ui.json", "features.json"]


def app_files() -> list[str]:
    """Alle Dateien, die die App zur Laufzeit laedt (ohne offline.json, sw.js, index.html)."""
    files = ["manifest.json", "icon.svg", *sorted(p.name for p in ROOT.glob("icon-*.png"))]
    files += [p.relative_to(ROOT).as_posix() for p in sorted((ROOT / "css").glob("*.css"))]
    files += [p.relative_to(ROOT).as_posix() for p in sorted((ROOT / "js").rglob("*.js"))]
    files += [f"data/{name}" for name in DATA_FILES]
    files += [p.relative_to(ROOT).as_posix() for p in sorted((ROOT / "img").glob("*.webp"))]
    missing = [f for f in files if not (ROOT / f).is_file()]
    if missing:
        raise SystemExit(f"fehlt: {missing}")
    return files


# ------------------------------------------------------------------ Einzel-Datei: ES-Module zu einem Skript buendeln
IMPORT_RE = re.compile(r'''^import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];\s*$''', re.M | re.S)
EXPORT_DECL_RE = re.compile(r"^export\s+(async\s+function|function|class|const|let|var)\s+([A-Za-z_$][\w$]*)", re.M)
EXPORT_LIST_RE = re.compile(r"^export\s*\{([^}]*)\};?\s*$", re.M)


def bundle(entry: str) -> str:
    """Module in Abhaengigkeits-Reihenfolge als IIFEs; jedes gibt seine Exporte als Objekt zurueck."""
    order: list[str] = []
    state: dict[str, str] = {}

    def visit(path: str) -> None:
        if state.get(path) == "done":
            return
        if state.get(path) == "busy":
            raise SystemExit(f"Kreis-Import bei {path} - Buendeln so nicht moeglich")
        state[path] = "busy"
        text = (ROOT / path).read_text(encoding="utf-8")
        for _names, spec in IMPORT_RE.findall(text):
            visit(resolve(path, spec))
        state[path] = "done"
        order.append(path)

    visit(entry)
    parts = ['"use strict";', "const __m = {};"]
    for path in order:
        text = (ROOT / path).read_text(encoding="utf-8")
        exports: list[str] = []

        def imp(match: re.Match[str], here: str = path) -> str:
            names = [n.strip() for n in match.group(1).split(",") if n.strip()]
            pattern = ", ".join(n.replace(" as ", ": ") for n in names)
            return f'const {{ {pattern} }} = __m["{resolve(here, match.group(2))}"];'

        text = IMPORT_RE.sub(imp, text)

        def decl(match: re.Match[str]) -> str:
            exports.append(match.group(2))
            return f"{match.group(1)} {match.group(2)}"

        text = EXPORT_DECL_RE.sub(decl, text)

        def lst(match: re.Match[str]) -> str:
            exports.extend(n.strip() for n in match.group(1).split(",") if n.strip())
            return ""

        text = EXPORT_LIST_RE.sub(lst, text)
        # Nur echte Modul-Statements am Zeilenanfang; eingerueckte Klassenmethoden import()/export() sind erlaubt.
        if re.search(r"^(import|export)\b", text, re.M):
            raise SystemExit(f"{path}: unbekannte import/export-Form uebrig")
        parts.append(f'// ---- {path}\n__m["{path}"] = (() => {{\n{text}\nreturn {{ {", ".join(exports)} }};\n}})();')
    return "\n".join(parts).replace("</script", "<\\/script")


def resolve(here: str, spec: str) -> str:
    if not spec.startswith("."):
        raise SystemExit(f"{here}: nur relative Imports erlaubt ({spec})")
    parts = [p for p in Path(here).parent.as_posix().split("/") if p and p != "."]
    for piece in spec.split("/"):
        if piece in ("", "."):
            continue
        if piece == "..":
            parts.pop()
        else:
            parts.append(piece)
    return "/".join(parts)


BINARY = {".png", ".webp"}


def content(path: str) -> bytes:
    data = (ROOT / path).read_bytes()
    return data if Path(path).suffix in BINARY else data.replace(b"\r\n", b"\n")


def build_single() -> int:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "css/app.css").read_text(encoding="utf-8")
    data = {name: json.loads((ROOT / "data" / name).read_text(encoding="utf-8")) for name in DATA_FILES}
    imgs = {p.name: "data:image/webp;base64," + base64.b64encode(p.read_bytes()).decode("ascii") for p in sorted((ROOT / "img").glob("*.webp"))}
    svg = "data:image/svg+xml;base64," + base64.b64encode((ROOT / "icon.svg").read_bytes()).decode("ascii")
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    img_payload = json.dumps(imgs, separators=(",", ":"))

    # CSP-Meta der App (Vertrag 14) heraus: die Einzeldatei fuehrt alles als Inline-Skript aus, unter "script-src 'self'"
    # liefe dort nichts (Browser-Test Welle 3b, WebKit + Chromium). Ohne diese Meta schaltet js/ui/projects.js die
    # Projekte ab - unter file:// und ebenso ueber https (Pages liefert die Datei mit aus); die Datei zeigt nur eigene
    # Kursdaten. Genau eine Meta erwartet - sonst stimmt die Vorlage nicht mehr.
    html, csp_count = re.subn(r'\s*<meta http-equiv="Content-Security-Policy"[^>]*>', "", html)
    if csp_count != 1:
        raise SystemExit(f"index.html: genau eine CSP-Meta erwartet, gefunden {csp_count}")
    html = re.sub(r"\s*<!-- CSP \(POCKET-PROJECTS-SPEC.*?-->", "", html, count=1, flags=re.S)
    # Kopf: kein Manifest (die Datei ist keine installierbare App), Icon eingebettet, CSS inline
    html = re.sub(r'\s*<link rel="manifest"[^>]*>', "", html)
    html = re.sub(r'\s*<link rel="(?:icon|apple-touch-icon)"[^>]*>', "", html)
    html = html.replace("</title>", f'</title>\n  <link rel="icon" href="{svg}">', 1)
    html = re.sub(r'<link rel="stylesheet" href="css/app\.css[^"]*">', lambda _m: f"<style>\n{css}\n</style>", html)
    # Offline-Knopf zeigt hier "in der Datei" statt Download
    script = (f"<script>window.__POCKET_DATA__ = {payload};\nwindow.__POCKET_IMG__ = {img_payload};</script>\n"
              f"  <script>\n{bundle('js/app.js')}\n</script>")
    html, n = re.subn(r'<script type="module" src="js/app\.js[^"]*"></script>', lambda _m: script, html)
    if n != 1:
        raise SystemExit("index.html: Modul-Skript nicht gefunden")
    out = ROOT / SINGLE
    # GitHub liefert LF aus; Windows-Zeilenenden dürfen die Downloadgröße nicht verfälschen.
    out.write_text(html, encoding="utf-8", newline="\n")
    return out.stat().st_size


# ------------------------------------------------------------------ Service Worker
# Sicherheitsregeln (Vertrag POCKET-PROJECTS-SPEC 13 und 15) stehen als Kommentar im erzeugten sw.js; geprueft
# werden sie in tools/package-tests.mjs (Text) und tools/projects-sw-tests.mjs (Verhalten in einer Sandbox).
# Im Template keine Backslashes verwenden: es ist ein normaler Python-String.
SW_TEMPLATE = """// Erzeugt von tools/build_offline.py - nicht von Hand aendern.
// Speichert beim Installieren JEDE Datei des Kurses; ohne Netz kommt alles aus diesem Speicher.
//
// Erlaubt-Liste (Vertrag POCKET-PROJECTS-SPEC 13 und 15): Der Worker antwortet NUR fuer die Dateien aus offline.json
// und fuer Seitenaufrufe dieser App. Alles andere geht ohne respondWith unveraendert ans Netz, als gaebe es den
// Worker nicht: fremde Origins (api.github.com), Anfragen mit Authorization-Header oder ausdruecklichen
// Zugangsdaten, alles ausser GET und unbekannte Pfade derselben Origin. Grund: private Projektdaten und Tokens
// laufen nie durch diesen Code und landen nie in Cache Storage, das sich alle Seiten von tombkn.github.io teilen.
// Geschrieben wird der Speicher nur beim Installieren, nie beim Beantworten einer Anfrage.
const VERSION = "__VERSION__";
const CACHE = `codesearch-pocket-${VERSION}`;
const FILES = __FILES__;
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
"""


def main() -> None:
    single_size = build_single()
    files = app_files()
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    plain = re.sub(r"\?v=[\w-]+", "", html)

    digest = hashlib.sha256()
    for f in files:
        digest.update(f.encode())
        digest.update(content(f))
    digest.update(plain.replace("\r\n", "\n").encode())
    version = digest.hexdigest()[:10]

    html = re.sub(r'(href="css/app\.css)(\?v=[\w-]+)?"', rf'\1?v={version}"', html)
    html = re.sub(r'(src="js/app\.js)(\?v=[\w-]+)?"', rf'\1?v={version}"', html)
    (ROOT / "index.html").write_text(html, encoding="utf-8", newline="\n")

    index_size = len(content("index.html"))
    entries = [{"path": "./", "size": index_size}, {"path": "index.html", "size": index_size}]
    entries += [{"path": f, "size": len(content(f))} for f in files]
    entries.append({"path": "offline.json", "size": 0})
    manifest = {
        "version": version,
        "total": sum(e["size"] for e in entries),
        "files": entries,
        "single": {"path": SINGLE, "size": single_size},
    }
    # offline.json kennt seine eigene Groesse erst nach dem Schreiben: zweimal rechnen, bis sie stimmt
    for _ in range(3):
        size = len(json.dumps(manifest, indent=1).encode())
        manifest["files"][-1]["size"] = size
        manifest["total"] = sum(e["size"] for e in manifest["files"])
    (ROOT / "offline.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8", newline="\n")

    sw = SW_TEMPLATE.replace("__VERSION__", version).replace("__FILES__", json.dumps([e["path"] for e in entries], indent=2))
    (ROOT / "sw.js").write_text(sw, encoding="utf-8", newline="\n")
    print(json.dumps({"version": version, "files": len(entries), "MB": round(manifest["total"] / 1048576, 2),
                      "single_MB": round(single_size / 1048576, 2)}))


if __name__ == "__main__":
    main()
