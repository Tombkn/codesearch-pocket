// Projektansicht NOTIZEN (Vertrag 13/14): Liste lokaler Notizen mit Ankerstatus bleibt / verschoben / Quelle nicht
// uebertragen / nicht zugeordnet und Sprung zum Anker. Der Status kommt aus js/projects/anchors.js (resolveAnchor) -
// nie allein ueber die Zeilennummer. Notiztexte und Ausschnitte sind privat und werden nur als Text eingesetzt.
// notes: Notizen aus dem Store ({id, projectId, anchor, text, createdAt, updatedAt}); ein Eintrag darf das Ergebnis
// schon tragen ({note, resolved} oder note.resolved). model darf null sein (Projekt nicht geladen).
// actions: openCode(source, line) bzw. openSource(source, line), openDetails(rel), optional deleteNote(id).

import { ANCHOR_STATES, ANCHOR_STATE_LABELS, resolveAnchor } from "../projects/anchors.js";
import { appendExact, button, callAction, el, hasAction, isRecord, labelMap, labelOf, setAttr } from "./project-dom.js";

const STATE_CLASS = labelMap([
  ["kept", "pv-st-kept"], ["moved", "pv-st-moved"], ["source-not-transferred", "pv-st-missing"], ["unmatched", "pv-st-unmatched"],
]);
const STATE_LABELS = labelMap(Object.entries(ANCHOR_STATE_LABELS));
const KIND_TEXT = labelMap([["op", "Op"], ["range", "Bereich"], ["symbol", "Symbol"]]);
const EXCERPT_LINES = 12;

function normalize(item) {
  if (!isRecord(item)) return null;
  const note = isRecord(item.note) ? item.note : item;
  if (!isRecord(note.anchor)) return null;
  const given = isRecord(item.resolved) ? item.resolved : isRecord(note.resolved) ? note.resolved : null;
  return { note, given };
}

// Ankerstatus: mitgeliefert (vom Speicher/Shell geprueft) oder hier gegen das geoeffnete Modell aufgeloest.
export function noteStatus(note, model, given = null) {
  if (given && ANCHOR_STATES.includes(given.state)) return { ...given, label: labelOf(STATE_LABELS, given.state), checked: true };
  if (!model) {
    return { state: "unmatched", label: labelOf(STATE_LABELS, "unmatched"), anchor: note.anchor, rel: null, startLine: null, endLine: null,
      checked: false };
  }
  return { ...resolveAnchor(note.anchor, model), checked: true };
}

function openAction(actions) {
  if (hasAction(actions, "openCode")) return "openCode";
  if (hasAction(actions, "openSource")) return "openSource";
  return null;
}

function drawNote(doc, list, note, status, model, actions) {
  const card = el(doc, "article", "pv-note");
  const head = el(doc, "div", "pv-btnrow pv-note-head");
  head.appendChild(el(doc, "span", `pv-chip pv-st ${labelOf(STATE_CLASS, status.state, "pv-st-unmatched")}`, status.label));
  const anchor = status.anchor && isRecord(status.anchor) ? status.anchor : note.anchor;
  head.appendChild(el(doc, "span", "pv-chip", labelOf(KIND_TEXT, anchor.kind, "Anker")));
  if (anchor.kind === "op") appendExact(doc, head, anchor.origPath, "pv-u pv-mono");
  else {
    appendExact(doc, head, anchor.source ?? "", "pv-u pv-mono");
    if (Number.isSafeInteger(anchor.startLine)) head.appendChild(el(doc, "span", "pv-dim", ` Z. ${anchor.startLine}–${anchor.endLine}`));
    if (status.state === "moved" && note.anchor.startLine !== anchor.startLine && Number.isSafeInteger(note.anchor.startLine)) {
      head.appendChild(el(doc, "span", "pv-dim", ` (vorher Z. ${note.anchor.startLine}–${note.anchor.endLine})`));
    }
    if (typeof anchor.symbol === "string") {
      head.appendChild(el(doc, "span", "pv-dim", " · "));
      appendExact(doc, head, anchor.symbol, "pv-u pv-mono");
    }
  }
  if (!status.checked) head.appendChild(el(doc, "span", "pv-dim", " · Projekt nicht geladen, nicht geprüft"));
  card.appendChild(head);
  const text = el(doc, "div", "pv-pre pv-note-text");
  if (typeof note.text === "string" && note.text) appendExact(doc, text, note.text);
  else text.appendChild(el(doc, "span", "pv-dim", "(ohne Text)"));
  card.appendChild(text);
  if (anchor.kind !== "op" && typeof note.anchor.excerpt === "string" && note.anchor.excerpt) {
    const lines = note.anchor.excerpt.split("\n");
    const box = el(doc, "div", "pv-pre pv-mono pv-excerpt");
    appendExact(doc, box, lines.slice(0, EXCERPT_LINES).join("\n"));
    card.appendChild(box);
    if (lines.length > EXCERPT_LINES) card.appendChild(el(doc, "p", "pv-hint", `Ausschnitt: ${lines.length} Zeilen, ${EXCERPT_LINES} gezeigt`));
  }
  const meta = el(doc, "p", "pv-hint");
  meta.appendChild(doc.createTextNode("angelegt "));
  appendExact(doc, meta, typeof note.createdAt === "string" ? note.createdAt : "–");
  if (typeof note.updatedAt === "string" && note.updatedAt !== note.createdAt) {
    meta.appendChild(doc.createTextNode(" · geändert "));
    appendExact(doc, meta, note.updatedAt);
  }
  card.appendChild(meta);
  const tools = el(doc, "div", "pv-btnrow");
  const live = status.checked && (status.state === "kept" || status.state === "moved") && model;
  if (anchor.kind === "op") {
    tools.appendChild(button(doc, "Zum Op", () => callAction(actions, "openDetails", status.rel), {
      disabled: !live || !hasAction(actions, "openDetails") || !model.has(status.rel),
    }));
  } else {
    const action = openAction(actions);
    const jump = button(doc, "Zum Anker", () => callAction(actions, action, status.rel, status.startLine), {
      disabled: !live || action === null,
    });
    if (!live) setAttr(jump, "title", status.state === "source-not-transferred" ? "Die Quelle ist in dieser Revision nicht als Text übertragen." : "Der Ausschnitt ist in dieser Revision nicht eindeutig zu finden.");
    tools.appendChild(jump);
    if (status.state === "source-not-transferred" && model && typeof status.rel === "string" && model.has(status.rel)) {
      tools.appendChild(button(doc, "Op öffnen", () => callAction(actions, "openDetails", status.rel), { disabled: !hasAction(actions, "openDetails") }));
    }
  }
  card.appendChild(tools);
  if (hasAction(actions, "deleteNote") && typeof note.id === "string") drawDelete(doc, card, tools, note.id, actions);
  list.appendChild(card);
}

// Loeschen in zwei Schritten: Notizen liegen nur auf diesem Geraet und es gibt kein Rueckgaengig, der Knopf steht aber
// neben "Zum Anker". Der erste Tipp blendet nur die Rueckfrage ein; "Wirklich loeschen" steht in einer EIGENEN Zeile
// darunter, damit ein Doppeltipp auf dieselbe Stelle nicht sofort bestaetigt.
function drawDelete(doc, card, tools, id, actions) {
  const status = el(doc, "p", "pv-hint pv-warn pv-note-live");
  setAttr(status, "aria-live", "polite");
  const confirm = el(doc, "div", "pv-btnrow pv-note-confirm");
  confirm.hidden = true;
  setAttr(confirm, "role", "group");
  setAttr(confirm, "aria-label", "Löschen bestätigen");
  const arm = button(doc, "Löschen", null, { cls: "pv-btn pv-btn-danger" });
  setAttr(arm, "aria-expanded", "false");
  const cancel = button(doc, "Abbrechen", null);
  const yes = button(doc, "Wirklich löschen", null, { cls: "pv-btn pv-btn-danger" });
  const show = (open) => {
    confirm.hidden = !open;
    arm.hidden = open;
    setAttr(arm, "aria-expanded", open ? "true" : "false");
    status.textContent = open ? "Notiz wirklich löschen? Sie liegt nur auf diesem Gerät, Löschen lässt sich nicht rückgängig machen." : "";
  };
  arm.addEventListener("click", () => {
    show(true);
    cancel.focus();
  });
  cancel.addEventListener("click", () => {
    show(false);
    arm.focus();
  });
  yes.addEventListener("click", () => {
    // Nur einmal melden: die Huelle loescht asynchron und baut die Liste danach neu.
    if (yes.disabled) return;
    yes.disabled = true;
    callAction(actions, "deleteNote", id);
  });
  tools.appendChild(arm);
  confirm.appendChild(cancel);
  confirm.appendChild(yes);
  card.appendChild(status);
  card.appendChild(confirm);
}

export function renderNotes(container, notes, model, actions) {
  const doc = container.ownerDocument;
  const root = el(doc, "div", "pv-root pv-scroll pv-notes");
  const items = (Array.isArray(notes) ? notes : []).map(normalize).filter(Boolean);
  const counts = new Map(ANCHOR_STATES.map((s) => [s, 0]));
  const resolved = items.map(({ note, given }) => {
    const status = noteStatus(note, model, given);
    counts.set(status.state, (counts.get(status.state) || 0) + 1);
    return { note, status };
  });
  const summary = el(doc, "div", "pv-btnrow pv-note-summary");
  summary.appendChild(el(doc, "span", "pv-k", `${items.length} Notizen`));
  for (const state of ANCHOR_STATES) {
    if (counts.get(state)) summary.appendChild(el(doc, "span", `pv-chip pv-st ${labelOf(STATE_CLASS, state)}`, `${labelOf(STATE_LABELS, state)}: ${counts.get(state)}`));
  }
  root.appendChild(summary);
  if (!items.length) root.appendChild(el(doc, "p", "pv-hint", "Noch keine Notizen. Im Code eine Zeile wählen und „Notiz zur Auswahl“ antippen."));
  const list = el(doc, "div", "pv-note-list");
  for (const { note, status } of resolved) drawNote(doc, list, note, status, model, actions || {});
  root.appendChild(list);
  container.appendChild(root);
  let destroyed = false;
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
