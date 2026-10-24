// Gemeinsame Bausteine aller Ansichten: Trefferzeile, Sektion, Aktionszeile, Spaltenkoepfe.
// Feldnamen und Reihenfolge wie _hit() in CodeSearchExt.py, weil die Tour str(hit) liest.

import { abs, short } from "../util.js";

export function hit(kind, path = "", text = "", { line = null, par = null, ctx = "", detail = "", conf = "", ...extra } = {}) {
  const row = {
    kind, path, text: String(text ?? ""), text_full: String(text ?? ""), line, par, ctx, detail: String(detail ?? ""), conf,
  };
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) row[key] = value;
  }
  return row;
}

export function section(title, rest = "", count = null, { num = "", accent = "", level = 0 } = {}) {
  const row = hit("section", "", title, { detail: rest });
  row.count = count;
  row.level = level;
  row.num = String(num);
  row.accent = accent;
  return row;
}

// >> Knopf-Zeile: Enter / Klick loest action aus
export function action(label, text, actionKey, path = "") {
  const row = hit("button", path ? abs(path) : "", text, { detail: "Enter / Klick" });
  row.art = `>> ${label}`;
  row.action_key = actionKey;
  return row;
}

export function info(art, path, text, detail = "") {
  const row = hit("info", path ? abs(path) : "", text, { detail });
  row.art = art;
  return row;
}

export function notice(text, detail = "") {
  return hit("notice", "", text, { detail });
}

// Spaltenkoepfe aus HEADER_HELP ('ART: …' -> 'ART')
export function headers(ui, key, fallback) {
  const list = ui.HEADER_HELP && ui.HEADER_HELP[key];
  if (Array.isArray(list) && list.length >= 4) {
    return list.slice(0, 4).map((text) => short(String(text).split(":")[0].trim(), 28));
  }
  return fallback;
}

export function countRows(rows) {
  return rows.filter((h) => !["info", "empty", "header", "section", "button", "notice"].includes(h.kind)).length;
}

// Gruppen fuer die linke Spalte aus den Sektionen der Liste
export function groupsOf(rows) {
  const groups = [];
  let current = null;
  rows.forEach((row, index) => {
    if (row.kind === "section" && !row.level) {
      current = { title: row.text, num: row.num || String(groups.length + 1), count: row.count, index, accent: row.accent };
      groups.push(current);
    }
  });
  return groups;
}
