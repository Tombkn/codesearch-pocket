// Kleine DOM-Helfer: Escaping, Markdown light, Tipp-Gesten (Tippen, Doppeltippen, lange druecken).

export const $ = (sel, root = document) => root.querySelector(sel);

const renderedHtml = new WeakMap();

// Unveränderten Lesetext stehen lassen: sonst werden Auswahl, Details und
// laufende Touch-Bewegungen bei jedem Status-Update erneut aufgebaut.
export function updateHtml(element, html, reset = false) {
  if (!reset && renderedHtml.get(element) === html) return false;
  const top = reset ? 0 : element.scrollTop;
  const left = reset ? 0 : element.scrollLeft;
  const scrolls = reset ? [] : [...element.querySelectorAll("[data-scroll-key]")]
    .map((el) => [el.dataset.scrollKey, el.scrollTop, el.scrollLeft]);
  const opened = reset ? [] : [...element.querySelectorAll("details[data-persist][open]")]
    .map((el) => el.dataset.persist);
  element.innerHTML = html;
  for (const el of element.querySelectorAll("details[data-persist]")) {
    if (opened.includes(el.dataset.persist)) el.open = true;
  }
  for (const el of element.querySelectorAll("[data-scroll-key]")) {
    const saved = scrolls.find(([key]) => key === el.dataset.scrollKey);
    if (saved) [el.scrollTop, el.scrollLeft] = saved.slice(1);
  }
  element.scrollTop = top;
  element.scrollLeft = left;
  renderedHtml.set(element, html);
  return true;
}

export function esc(text) {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function md(text) {
  const lines = String(text || "").split("\n");
  const out = [];
  let inCode = false;
  let code = [];
  let table = [];
  let list = [];
  const flushTable = () => {
    if (!table.length) return;
    out.push("<table>" + table.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") + "</table>");
    table = [];
  };
  const flushList = () => {
    if (!list.length) return;
    out.push("<ul>" + list.map((li) => `<li>${inline(li)}</li>`).join("") + "</ul>");
    list = [];
  };
  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) { out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`); code = []; }
      inCode = !inCode;
      continue;
    }
    if (inCode) { code.push(line); continue; }
    if (/^\|.*\|\s*$/.test(line)) {
      const cells = line.trim().slice(1, -1).split("|").map((c) => c.trim());
      if (!cells.every((c) => /^:?-+:?$/.test(c))) table.push(cells);
      continue;
    }
    flushTable();
    if (/^\s*[-*] /.test(line)) { list.push(line.replace(/^\s*[-*] /, "")); continue; }
    flushList();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    if (/^!\[.*\]\((.*)\)/.test(line)) {
      const m = /^!\[(.*)\]\((.*)\)/.exec(line);
      out.push(`<p><img alt="${esc(m[1])}" src="${esc(m[2])}" loading="lazy"></p>`);
      continue;
    }
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  flushTable();
  flushList();
  return out.join("");
}

function inline(text) {
  return esc(text).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\*([^*]+)\*/g, "<i>$1</i>");
}

// Tippen / Doppeltippen / lange druecken auf Elementen mit data-Attribut. Verhindert Doppel-Ausloesung.
export function tapper(root, selector, { tap, double, long, longMs = 480 }) {
  let timer = null;
  let longFired = false;
  let startX = 0;
  let startY = 0;
  let last = { el: null, t: 0 };
  root.addEventListener("pointerdown", (ev) => {
    const el = ev.target.closest(selector);
    if (!el || !root.contains(el)) return;
    longFired = false;
    startX = ev.clientX;
    startY = ev.clientY;
    clearTimeout(timer);
    if (long) {
      timer = setTimeout(() => {
        longFired = true;
        if (navigator.vibrate) navigator.vibrate(12);
        long(el, ev);
      }, longMs);
    }
  });
  root.addEventListener("pointermove", (ev) => {
    if (Math.abs(ev.clientX - startX) > 10 || Math.abs(ev.clientY - startY) > 10) clearTimeout(timer);
  });
  root.addEventListener("pointerup", () => clearTimeout(timer));
  root.addEventListener("pointercancel", () => clearTimeout(timer));
  root.addEventListener("contextmenu", (ev) => {
    const el = ev.target.closest(selector);
    if (el && long) { ev.preventDefault(); if (!longFired) { longFired = true; long(el, ev); } }
  });
  root.addEventListener("click", (ev) => {
    const el = ev.target.closest(selector);
    if (!el || !root.contains(el)) return;
    if (longFired) { longFired = false; return; }
    const now = Date.now();
    if (double && last.el === el.dataset.key && now - last.t < 330) {
      last = { el: null, t: 0 };
      double(el, ev);
      return;
    }
    last = { el: el.dataset.key, t: now };
    tap(el, ev);
  });
}

let toastTimer = null;
export function toast(text) {
  const box = document.getElementById("toast");
  box.textContent = text;
  box.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove("show"), 1800);
}

export function copyToDevice(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(() => {});
  } catch { /* nur interne Zwischenablage */ }
}
