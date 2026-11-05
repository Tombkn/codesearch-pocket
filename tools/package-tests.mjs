// Prüft das ausgelieferte Paket, keine Browserdarstellung oder echte Offlinecache-Engine.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { JSDOM, VirtualConsole } from "jsdom";
import { SOURCE_REF } from "../js/core/source-ref.js";
import { esc, familyToken } from "../js/ui/dom.js";
import { artClass, extensionButtonHtml } from "../js/ui/cswin.js";
import { familyClass } from "../js/ui/layers.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const json = (path) => JSON.parse(read(path).toString("utf8"));
const normalized = (path) => /\.(png|webp)$/.test(path) ? read(path) : Buffer.from(read(path).toString("utf8").replace(/\r\n/g, "\n"));
const manifest = json("offline.json");
const course = json("data/course.json");
let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`OK ${name}`); };

check("Laptop-Quellenlinks und Kurs verwenden dieselbe Revision", () => {
  const lock = json("upstream.json");
  for (const key of ["repo", "commit", "version", "checked"]) assert.equal(SOURCE_REF[key], lock[key], key);
  for (const key of ["repo", "commit", "version"]) assert.equal(SOURCE_REF[key], course.source[key], key);
});

check("Manifest enthält alle Dateien mit richtigen Größen", () => {
  assert.equal(new Set(manifest.files.map((file) => file.path)).size, manifest.files.length);
  for (const file of manifest.files) {
    assert.equal(normalized(file.path === "./" ? "index.html" : file.path).length, file.size, file.path);
  }
  assert.equal(manifest.total, manifest.files.reduce((total, file) => total + file.size, 0));
  // Git normalisiert Textdateien: die veröffentlichte Größe muss auch bei CRLF-Checkouts stimmen.
  assert.equal(normalized(manifest.single.path).length, manifest.single.size);
});
const index = read("index.html").toString("utf8");
const single = read(manifest.single.path).toString("utf8");
check("Version stimmt mit App-Inhalten, Seite und Service Worker überein", () => {
  const digest = createHash("sha256");
  for (const file of manifest.files.filter((file) => !["./", "index.html", "offline.json"].includes(file.path))) {
    digest.update(file.path);
    digest.update(normalized(file.path));
  }
  digest.update(index.replace(/\?v=[\w-]+/g, "").replace(/\r\n/g, "\n"));
  assert.equal(digest.digest("hex").slice(0, 10), manifest.version);
  assert.ok(index.includes(`css/app.css?v=${manifest.version}`));
  assert.ok(index.includes(`js/app.js?v=${manifest.version}`));
  const worker = read("sw.js").toString("utf8");
  assert.ok(worker.includes(`const VERSION = "${manifest.version}"`));
  for (const file of manifest.files) assert.ok(worker.includes(JSON.stringify(file.path)), file.path);
});

// ---- Sicherheit (Vertrag POCKET-PROJECTS-SPEC 13-15): was offline gespeichert und veroeffentlicht wird, ist nur die
// oeffentliche App. Das Verhalten von sw.js prueft tools/projects-sw-tests.mjs in einer Sandbox; hier steht der Text.
// CRLF normalisieren: ein Windows-Checkout (core.autocrlf) darf die Textpruefung nicht kippen.
const worker = read("sw.js").toString("utf8").replace(/\r\n/g, "\n");
const workerFiles = () => {
  const match = /^const FILES = (\[[\s\S]*?\]);$/m.exec(worker);
  assert.ok(match, "FILES fehlt in sw.js");
  return JSON.parse(match[1]);
};
const DATA_FILES = ["data/code.json", "data/course.json", "data/features.json", "data/net.json", "data/ui.json"];
const ALLOWED_APP_PATH = [/^\.\/$/, /^index\.html$/, /^manifest\.json$/, /^icon(?:-[a-z0-9-]+)?\.(?:svg|png)$/,
  /^css\/app\.css$/, /^js\/(?:[a-z0-9_-]+\/)*[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*\.js$/,
  /^data\/(?:course|net|code|ui|features)\.json$/, /^img\/[A-Za-z0-9_-]+\.webp$/, /^offline\.json$/];

check("Precache-Liste nur aus erlaubten App-Pfaden (sw.js = offline.json)", () => {
  const paths = manifest.files.map((file) => file.path);
  assert.deepEqual(workerFiles(), paths);
  for (const path of paths) {
    assert.ok(ALLOWED_APP_PATH.some((pattern) => pattern.test(path)), `nicht erlaubt im Precache: ${path}`);
    assert.ok(path === "./" || !path.split("/").some((part) => part === "" || part.startsWith(".")), `Pfadteil: ${path}`);
  }
  assert.deepEqual(paths.filter((path) => path.startsWith("data/")).sort(), DATA_FILES);
  for (const needed of ["./", "index.html", "manifest.json", "offline.json", "css/app.css", "js/app.js"]) {
    assert.ok(paths.includes(needed), `fehlt im Precache: ${needed}`);
  }
});

check("sw.js reicht Fremdes durch und schreibt den Speicher nur beim Installieren", () => {
  for (const [rule, pattern] of [
    ["respondWith erst nach der Pruefung", /if \(!isAppRequest\(req\)\) return;\n[^\n]*\n\s*event\.respondWith\(netFirst\(req\)\);/],
    ["nur GET", /if \(req\.method !== "GET"\) return false;/],
    ["nur die eigene Origin", /if \(url\.origin !== self\.location\.origin\) return false;/],
    ["nie mit Authorization", /if \(req\.headers\.has\("authorization"\)\) return false;/],
    ["Seitenaufrufe nur im Geltungsbereich", /if \(req\.mode === "navigate"\) return url\.href\.startsWith\(SCOPE\.href\);/],
    ["nie mit ausdruecklichen Zugangsdaten", /if \(req\.credentials === "include" && req\.mode !== "no-cors"\) return false;/],
    ["sonst nur die Erlaubt-Liste", /return ALLOWED\.has\(url\.pathname\);/],
    ["Erlaubt-Liste aus FILES", /const ALLOWED = new Set\(FILES\.map\(\(file\) => new URL\(file, SCOPE\)\.pathname\)\);/],
    ["dropOld nur eigenes Namensschema", /const OWN_CACHE = \/\^codesearch-pocket-\(\?:\[0-9a-f\]\{10\}\|v\[0-9\]\+\)\$\/;[\s\S]*if \(OWN_CACHE\.test\(key\) && key !== CACHE\)/],
  ]) assert.match(worker, pattern, rule);
  const install = /^self\.addEventListener\("install", [\s\S]*?^\}\);$/m.exec(worker);
  assert.ok(install, "install-Handler fehlt");
  assert.equal((install[0].match(/\.put\(/g) || []).length, 1, "install schreibt genau an einer Stelle");
  const rest = worker.replace(install[0], "");
  assert.doesNotMatch(rest, /\.(?:put|add|addAll)\(/, "Laufzeit-Schreiben in den Speicher");
  assert.equal((worker.match(/respondWith\(/g) || []).length, 1, "genau eine respondWith-Stelle");
});

// Merkmale privater Projektdaten - die DATENform (JSON-Feld "format":"codesearch.pocket.…", IDs, Integritaetsblock),
// nicht der Code, der Projekte verarbeitet (der nennt Formatnamen als Konstanten).
const PROJECT_MARKERS = [
  ["projectId", /psp_[0-9a-f]{32}/],
  ["revision.id", /rev_[0-9a-f]{32}/],
  ["Paket- oder Speicherdatei", /"format"\s*:\s*"codesearch\.pocket\.(?:snapshot|index|project|store|notes)"/],
  ["Integritaetsblock", /"canonicalization"\s*:\s*"cspocket-c14n-1"/],
  ["GitHub-Token", /\bgh[pousr]_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/],
];
check("Einzeldatei, Manifest, sw.js und Precache-Dateien enthalten keine Projektmarkierungen", () => {
  const texts = [["Einzeldatei", single], ["offline.json", read("offline.json").toString("utf8")], ["sw.js", worker]];
  for (const file of manifest.files) {
    if (file.path !== "./" && !/\.(?:png|webp)$/.test(file.path)) texts.push([file.path, read(file.path).toString("utf8")]);
  }
  for (const [name, text] of texts) {
    for (const [marker, pattern] of PROJECT_MARKERS) assert.doesNotMatch(text, pattern, `${name}: ${marker}`);
  }
  // Selbstprobe: die Muster erkennen ein echtes Paket (sonst waere der Test blind).
  const sample = '{"format":"codesearch.pocket.snapshot","projectId":"psp_0123456789abcdef0123456789abcdef"}';
  assert.ok(PROJECT_MARKERS.some(([, pattern]) => pattern.test(sample)));
});

check("esc() maskiert ' und verhindert den Ausbruch aus Attributen", () => {
  assert.equal(esc("'"), "&#39;");
  assert.equal(esc(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  assert.equal(esc(null), "");
  assert.equal(esc(0), "0");
  // "Eine Zeile mit 1 Mio. Zeichen" (Vertrag 14, Abnahme 17): einmal schlicht, einmal voller Zeichen, die maskiert
  // werden muessen - so faellt auch eine Maskierung auf, die nur einen Anfang des Textes behandelt.
  const unit = `a'b"c<d>e&f `;
  const longPlain = "x".repeat(1_000_000);
  const longMixed = unit.repeat(Math.ceil(1_000_000 / unit.length)).slice(0, 1_000_000);
  assert.equal(longMixed.length, 1_000_000);
  // Zeitgrenze nur fuer esc() selbst (gemessen etwa 25 ms): faengt eine Maskierung, die mit der Laenge quadratisch
  // waechst. Der JSDOM-Rundweg unten zaehlt nicht mit, er misst den Parser und nicht esc().
  const started = performance.now();
  const escapedMixed = esc(longMixed);
  const elapsedMs = performance.now() - started;
  assert.ok(elapsedMs < 1000, `esc() einer 1-Mio-Zeile dauerte ${Math.round(elapsedMs)} ms`);
  assert.doesNotMatch(escapedMixed, /['"<>]/, "keine rohen Sonderzeichen im Ergebnis");
  const dom = new JSDOM("<!doctype html><body></body>");
  try {
    const { document } = dom.window;
    // Darstellungs-Testvektoren aus Vertrag 14 (Text, einfach und doppelt quotierte Attribute). U+202E und U+200B
    // stehen als Escape: als Rohzeichen waeren sie im Quelltext unsichtbar.
    for (const value of [`' onmouseover='alert(1)`, `"><svg onload=alert(1)>`, "<img src=x onerror=alert(1)>",
      "javascript:alert(1)", "‮gnp.exe", "a​b", "constructor", "__proto__", longPlain, longMixed]) {
      // Kurzer Name fuer Meldungen: ein Fehlschlag soll nicht eine Million Zeichen ausgeben.
      const label = value.length > 80 ? `${value.slice(0, 24)}... (${value.length} Zeichen)` : value;
      document.body.innerHTML = `<span title='${esc(value)}' data-x="${esc(value)}">${esc(value)}</span>`;
      const span = document.body.firstElementChild;
      assert.equal(document.body.children.length, 1, label);
      assert.deepEqual(span.getAttributeNames(), ["title", "data-x"], label);
      assert.ok(span.getAttribute("title") === value, `${label}: title`);
      assert.ok(span.dataset.x === value, `${label}: data-x`);
      assert.ok(span.textContent === value, `${label}: Text`);
      assert.equal(document.querySelectorAll("svg, img, script").length, 0, label);
    }
  } finally {
    dom.window.close();
  }
});

check("Op-Familie und Extension-Slot gelangen nur geprueft ins Markup", () => {
  for (const family of ["COMP", "TOP", "CHOP", "SOP", "DAT", "MAT", "POP"]) {
    assert.equal(familyToken(family), family);
    assert.equal(artClass({ kind: "opfind", family }), `k-${family}`);
    assert.equal(familyClass({ net: { op: () => null } }, { family }), `fam-${family}`);
  }
  const lab = { net: { op: () => ({ family: `TOP" onclick="alert(1)` }) } };
  for (const evil of [`COMP" onmouseover="alert(1)`, "COMP x", "comp", "constructor", "__proto__", "toString", 7, {}]) {
    assert.equal(familyToken(evil), "", String(evil));
    assert.equal(artClass({ kind: "chain", family: evil }), "", String(evil));
    assert.equal(familyClass(lab, { family: evil }), "", String(evil));
  }
  assert.equal(familyClass(lab, { path: "/project1/x" }), "", "Familie aus dem Netz wird genauso geprueft");
  assert.equal(familyClass(lab, { kind: "code" }), "fam-DAT");
  assert.equal(artClass({ cat: `x" onclick="y` }), "k-x&quot; onclick=&quot;y");
  const dom = new JSDOM("<!doctype html><body></body>");
  try {
    const { document } = dom.window;
    const slot = `0" onclick="alert(1)`;
    document.body.innerHTML = extensionButtonHtml("Comp", { slot, name: "<b>Ext</b>", available: false, reason: "' onfocus='x" });
    const button = document.body.querySelector("button");
    assert.equal(document.body.children.length, 1);
    assert.equal(button.dataset.slot, slot);
    assert.equal(button.getAttribute("onclick"), null);
    assert.equal(button.getAttribute("onfocus"), null);
    assert.equal(button.querySelector("strong").textContent, "<b>Ext</b>");
    document.body.innerHTML = extensionButtonHtml("Comp", { slot: 2, name: "Ext", available: false, reason: "" });
    assert.equal(document.body.querySelector("button").dataset.slot, "2", "Kurs-Slots bleiben Zahlen wie vorher");
  } finally {
    dom.window.close();
  }
});

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error) => errors.push(error.message));
virtualConsole.on("error", (...args) => errors.push(args.join(" ")));
let requests = 0;
const page = new JSDOM(single, {
  url: "file:///CodeSearch-Pocket-offline.html",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole,
  beforeParse(window) {
    window.TextEncoder = TextEncoder;
    window.TextDecoder = TextDecoder;
    window.fetch = async () => { requests += 1; throw new Error("Die Einzeldatei darf keine App-Dateien nachladen."); };
    window.HTMLElement.prototype.scrollIntoView = function () {};
  },
});
const { window } = page;
const $ = (selector) => {
  const element = window.document.querySelector(selector);
  assert.ok(element, `Element fehlt: ${selector}`);
  return element;
};
const click = async (selector) => { $(selector).click(); await delay(40); };
try {
  await delay(100);
  check("Einzeldatei startet ohne Netz und externe App-Ressourcen", () => {
    assert.equal(window.document.querySelectorAll("script[src],link[rel=stylesheet]").length, 0);
    assert.equal(requests, 0);
    assert.deepEqual(errors, []);
    assert.ok($("#tour-head").textContent.includes(String(course.lessons.length)));
    for (const name of ["course", "net", "code", "ui", "features"]) {
      assert.deepEqual(JSON.parse(JSON.stringify(window.__POCKET_DATA__[`${name}.json`])), json(`data/${name}.json`));
    }
    assert.ok($("#tour").classList.contains("open"));
  });
  check("Einzeldatei bettet nur die 5 Kursdateien und Bilder aus img/ ein", () => {
    assert.deepEqual(Object.keys(window.__POCKET_DATA__).sort(), DATA_FILES.map((path) => path.slice("data/".length)));
    const images = Object.keys(window.__POCKET_IMG__);
    assert.ok(images.length > 0);
    for (const name of images) {
      assert.match(name, /^[A-Za-z0-9_-]+\.webp$/);
      assert.ok(manifest.files.some((file) => file.path === `img/${name}`), name);
      assert.match(window.__POCKET_IMG__[name], /^data:image\/webp;base64,/);
    }
  });
  await click("#popup");
  await click("#tour-grip");
  check("Gebündelte App wechselt zur Übung", () => assert.ok($("#tour").classList.contains("mini")));
  await click("#tour-grip");
  await click("#btn-atlas");
  await click("[data-atlas=laptop]");
  check("Alle Laptop-Leitfäden stecken in der Einzeldatei", () => {
    assert.equal(window.document.querySelectorAll("[data-learn-chapter]").length, course.chapters.length);
    assert.deepEqual(errors, []);
    assert.equal(requests, 0);
  });
  globalThis.console.log(JSON.stringify({ passed, engine: "jsdom", networkRequests: requests, nativeOfflineCache: "nicht geprüft" }));
} finally {
  window.close();
}
