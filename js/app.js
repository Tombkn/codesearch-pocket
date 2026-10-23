import { createEngine } from "./engine.js";

const STORE = "codesearch-pocket-v1";

const $ = (sel) => document.querySelector(sel);

function md(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/^\|(.+)\|$/gm, (line) => {
      const cells = line.slice(1, -1).split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-+:?$/.test(c))) return "";
      return "<tr>" + cells.map((c) => `<td>${c}</td>`).join("") + "</tr>";
    })
    .replace(/(<tr>[\s\S]*?<\/tr>)+/g, "<table>$&</table>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/^(?!<h|<p|<table|<pre|<tr)(.+)$/gm, "<p>$1</p>");
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "{}");
  } catch {
    return {};
  }
}

function saveState(engine) {
  localStorage.setItem(STORE, JSON.stringify({
    lessonIndex: engine.state.lessonIndex,
    done: engine.state.done,
    failed: engine.state.failed,
  }));
}

function labNeeded(lesson) {
  return lesson.target === "StateLab" || (lesson.id || "").startsWith("invest_");
}

async function main() {
  const [course, hits, features] = await Promise.all([
    fetch("data/course.json").then((r) => r.json()),
    fetch("data/hits.json").then((r) => r.json()),
    fetch("data/features.json").then((r) => r.json()),
  ]);
  const engine = createEngine(course, hits);
  const saved = loadState();
  engine.state.done = saved.done || {};
  engine.state.failed = saved.failed || {};
  engine.enter(saved.lessonIndex || 0);
  engine.openWorkspace();
  engine.play(true);

  let sheetOpen = false;
  let banner = "";
  let bannerOk = false;
  let featureBody = "";

  const field = $("#cmd");

  function paint() {
    const vm = engine.viewModel();
    const lesson = vm.lesson;
    $("#focus-name").textContent = vm.target || "BranchLab";
    $("#prog-mini").textContent = `${vm.progress.done}/${vm.progress.total}`;
    $("#tabs").innerHTML = vm.tabs.map((tab) => (
      `<button class="tab ${tab.id === vm.mode ? "on" : ""}" data-mode="${tab.id}">${tab.label}</button>`
    )).join("");
    $("#groups").innerHTML = vm.groups.map((group) => (
      `<button data-group="${group}">${group}</button>`
    )).join("");
    $("#list").innerHTML = vm.rows.map((row) => (
      `<button class="row ${row.id === vm.selectedId ? "on" : ""}" data-id="${row.id}">
        <span class="art">${row.art || row.kind || ""}</span>
        <span>
          <div class="name">${row.name || ""}</div>
          <div class="meta">${row.path || ""} · ${row.text || ""}</div>
        </span>
      </button>`
    )).join("");
    const selected = vm.selected || {};
    $("#detail").innerHTML = `
      <div class="k">${vm.view === "states" ? "STATE" : "DETAIL"}</div>
      <div class="v">${selected.name || selected.extra?.name || "—"}</div>
      <div class="note">${selected.text || selected.extra?.note || selected.path || "Zeile antippen."}</div>
      ${selected.extra?.lifetime ? `<div class="note">${selected.extra.lifetime}</div>` : ""}
      ${selected.extra?.alias ? `<div class="note">${selected.extra.alias}</div>` : ""}
      ${vm.recordText ? `<div class="note">RECORD\n${vm.recordText}</div>` : ""}
      ${vm.clipboard ? `<div class="note">CLIPBOARD\n${vm.clipboard.slice(0, 280)}</div>` : ""}
    `;
    $("#status-left").textContent = `${String(vm.view).toUpperCase()} · ${vm.rows.length} Zeilen · ${vm.opened ? "offen" : "zu"}`;
    $("#status-right").textContent = vm.lab ? `Count ${vm.lab.count} · Gain ${vm.lab.gain}` : "";
    $("#labbar").classList.toggle("show", labNeeded(lesson));
    const red = Math.round(Math.min(1, vm.lab.count / 4) * 255);
    const blue = Math.round(vm.lab.gain * 255);
    $("#swatch").style.background = `rgb(${red}, 38, ${blue})`;
    $("#sheet").classList.toggle("open", sheetOpen);
    $("#sheet-ch").textContent = `KAPITEL ${String(lesson.chapter + 1).padStart(2, "0")} · ${vm.chapterName}`;
    $("#sheet-title").textContent = lesson.title;
    $("#peek").textContent = lesson.action || "";
    $("#now").textContent = lesson.action || "";
    $("#why").textContent = lesson.why || "";
    $("#expected").textContent = lesson.expected || lesson.meaning || "";
    $("#limit").textContent = lesson.limit || "";
    $("#glossary").textContent = lesson.glossary || "";
    const report = vm.check;
    $("#checks").innerHTML = (report.results || []).map((row) => (
      `<li><span class="dot ${row.ok ? "ok" : ""}"></span><span>${row.hint || row.key}</span></li>`
    )).join("");
    $("#banner").className = "banner " + (banner ? (bannerOk ? "ok" : "bad") : "hidden");
    $("#banner").textContent = banner;
    $("#map-progress").textContent = `${vm.progress.done} von ${vm.progress.total} geprüft`;
    field.value = vm.lastCommand.startsWith(">") ? vm.lastCommand : (engine.state.query || "");
  }

  function go(index) {
    banner = "";
    engine.enter(index);
    engine.openWorkspace();
    saveState(engine);
    paint();
  }

  $("#tabs").addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-mode]");
    if (!btn) return;
    engine.setMode(btn.dataset.mode);
    paint();
  });
  $("#list").addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-id]");
    if (!btn) return;
    const vm = engine.viewModel();
    const row = vm.rows.find((item) => item.id === btn.dataset.id);
    if (row) engine.selectHit(row);
    paint();
  });
  $("#go").addEventListener("click", () => {
    engine.runCommand(field.value);
    paint();
  });
  field.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      engine.runCommand(field.value);
      paint();
    }
  });
  $("#btn-work").addEventListener("click", () => {
    engine.openWorkspace();
    paint();
  });
  $("#btn-play").addEventListener("click", () => {
    engine.play(!engine.state.playing);
    paint();
  });
  $("#btn-map").addEventListener("click", () => {
    renderMap();
    $("#overlay-map").classList.add("show");
  });
  $("#btn-feat").addEventListener("click", () => {
    renderFeatures();
    $("#overlay-feat").classList.add("show");
  });
  document.querySelectorAll(".close").forEach((btn) => {
    btn.addEventListener("click", () => btn.closest(".overlay").classList.remove("show"));
  });
  $("#handle").addEventListener("click", () => {
    sheetOpen = !sheetOpen;
    paint();
  });
  $("#btn-seen").addEventListener("click", () => {
    engine.seen();
    paint();
  });
  $("#btn-back").addEventListener("click", () => go(engine.state.lessonIndex - 1));
  $("#btn-next").addEventListener("click", () => go(engine.state.lessonIndex + 1));
  $("#btn-check").addEventListener("click", () => {
    const report = engine.check(engine.currentLesson());
    engine.markDone(report.ok);
    bannerOk = report.ok;
    banner = report.ok
      ? "Prüfen trägt. Der Schritt ist gespeichert."
      : (report.results.find((row) => !row.ok)?.hint || "Noch nicht erfüllt.");
    saveState(engine);
    if (report.ok) {
      sheetOpen = true;
    }
    paint();
  });
  $("#labbar").addEventListener("click", (ev) => {
    const act = ev.target.closest("[data-lab]")?.dataset.lab;
    if (!act) return;
    if (act === "double") engine.lab.setDoublefire(!engine.state.lab.doublefire);
    else engine.lab[act]();
    paint();
  });
  $("#scopes").addEventListener("click", (ev) => {
    const chip = ev.target.closest("[data-scope]");
    if (!chip) return;
    engine.state.scope = chip.dataset.scope;
    document.querySelectorAll("[data-scope]").forEach((el) => el.classList.toggle("on", el === chip));
    paint();
  });

  function renderMap() {
    const box = $("#map-list");
    box.innerHTML = engine.chapters.map((name, index) => {
      const items = engine.lessons.filter((lesson) => lesson.chapter === index);
      const done = items.filter((lesson) => engine.state.done[lesson.id]).length;
      const first = engine.lessons.findIndex((lesson) => lesson.chapter === index);
      const pct = items.length ? Math.round((done / items.length) * 100) : 0;
      return `<button class="chapter" data-jump="${first}">
        <div class="num">KAPITEL ${String(index + 1).padStart(2, "0")} · ${done}/${items.length}</div>
        <div class="ttl">${name}</div>
        <div class="bar"><span style="width:${pct}%"></span></div>
      </button>`;
    }).join("");
    box.onclick = (ev) => {
      const jump = ev.target.closest("[data-jump]");
      if (!jump) return;
      $("#overlay-map").classList.remove("show");
      go(Number(jump.dataset.jump));
      sheetOpen = true;
    };
  }

  function renderFeatures() {
    const box = $("#feat-list");
    if (featureBody) {
      box.innerHTML = `<button class="feature" data-back="1"><div class="ttl">Zurück zur Übersicht</div></button><div class="md">${featureBody}</div>`;
      box.onclick = (ev) => {
        if (ev.target.closest("[data-back]")) {
          featureBody = "";
          renderFeatures();
        }
      };
      return;
    }
    box.innerHTML = features.map((item, index) => (
      `<button class="feature" data-feat="${index}">
        <div class="num">${item.chapter ? "Kapitel " + item.chapter : "Überblick"}</div>
        <div class="ttl">${item.title}</div>
      </button>`
    )).join("");
    box.onclick = (ev) => {
      const btn = ev.target.closest("[data-feat]");
      if (!btn) return;
      featureBody = md(features[Number(btn.dataset.feat)].body);
      renderFeatures();
    };
  }

  paint();
}

main().catch((err) => {
  document.body.innerHTML = `<p style="padding:24px">Konnte die Kursdaten nicht laden. ${err.message}</p>`;
});
