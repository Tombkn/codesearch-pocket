// Prüft das ausgelieferte Paket, keine Browserdarstellung oder echte Offlinecache-Engine.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { JSDOM, VirtualConsole } from "jsdom";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const json = (path) => JSON.parse(read(path).toString("utf8"));
const normalized = (path) => /\.(png|webp)$/.test(path) ? read(path) : Buffer.from(read(path).toString("utf8").replace(/\r\n/g, "\n"));
const manifest = json("offline.json");
let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`OK ${name}`); };

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
    assert.match($("#tour-head").textContent, /584/);
    for (const name of ["course", "net", "code", "ui", "features"]) {
      assert.deepEqual(JSON.parse(JSON.stringify(window.__POCKET_DATA__[`${name}.json`])), json(`data/${name}.json`));
    }
    assert.ok($("#tour").classList.contains("open"));
  });
  await click("#popup");
  await click("#tour-grip");
  check("Gebündelte App wechselt zur Übung", () => assert.ok($("#tour").classList.contains("mini")));
  await click("#tour-grip");
  await click("#btn-atlas");
  await click("[data-atlas=laptop]");
  check("Alle 45 Laptop-Leitfäden stecken in der Einzeldatei", () => {
    assert.equal(window.document.querySelectorAll("[data-learn-chapter]").length, 45);
    assert.deepEqual(errors, []);
    assert.equal(requests, 0);
  });
  globalThis.console.log(JSON.stringify({ passed, engine: "jsdom", networkRequests: requests, nativeOfflineCache: "nicht geprüft" }));
} finally {
  window.close();
}
