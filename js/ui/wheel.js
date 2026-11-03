// Shift + Mausrad = waagerecht scrollen, immer nur im Bereich unter dem Zeiger
// (Code, Details, Liste, Fenster). Ohne waagerechten Überstand bleibt das Rad beim Browser.

// Nächster Vorfahr, der waagerecht wirklich scrollen kann; sonst null.
export function horizontalScroller(element, styleOf = (node) => getComputedStyle(node)) {
  for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
    if (/(auto|scroll)/.test(styleOf(node).overflowX) && node.scrollWidth > node.clientWidth + 1) return node;
  }
  return null;
}

export function shiftWheelHorizontal(ev, styleOf) {
  if (!ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) return false;
  const delta = ev.deltaX || ev.deltaY;
  if (!delta) return false;
  const scroller = horizontalScroller(ev.target, styleOf);
  if (!scroller) return false;
  // Selbst verschieben und den Browser-Standard unterdrücken: kein Doppelschritt, kein senkrechtes Mitlaufen.
  ev.preventDefault();
  scroller.scrollLeft += delta;
  return true;
}

// Zone unter dem Zeiger im Hauptfenster (1.10.3, wie native ZONE_OF_BODY_PANEL): Code → CODE-Regler, Detail-Spalte →
// 'detail', Trefferliste → 'results', Leisten → Gesamtzoom ('ui'). Zweitfenster haben ihren eigenen Zoom (null).
export function wheelZone(target) {
  if (!target?.closest) return "ui";
  if (target.closest(".code-viewport")) return "code";
  if (target.closest(".cs-detail")) return "detail";
  if (target.closest(".cs-list")) return "results";
  return "ui";
}

// Strg + Rad = Inhaltszoom wie Strg+Plus/Minus: Zweitfenster unter dem Zeiger, sonst die Zone des Hauptfensters.
// zoom(floatId, step, zone): floatId gesetzt = Zweitfenster; sonst zone 'code' | 'detail' | 'results' | 'ui'.
export function ctrlWheelZoom(ev, zoom) {
  if (!ev.ctrlKey || !zoom) return false;
  const delta = ev.deltaY || ev.deltaX;
  if (!delta) return false;
  const card = ev.target.closest?.("[data-float]");
  const main = ev.target.closest?.("#cs, .cs");
  if (!card && !main) return false;
  ev.preventDefault();          // sonst zoomt der Browser die ganze Seite
  zoom(card ? card.dataset.float : null, delta < 0 ? 1 : -1, card ? null : wheelZone(ev.target));
  return true;
}

// Maus-Daumentasten (Desktop-Browser): button 3 = zurück (-1), 4 = vor (+1) – wie ◀ ▶ im Eingabekopf; sonst 0.
export function sideButtonStep(ev) {
  if (ev.button === 3) return -1;
  if (ev.button === 4) return 1;
  return 0;
}

export function bindShiftWheel(target = document, zoom = null) {
  target.addEventListener("wheel", (ev) => { if (!ctrlWheelZoom(ev, zoom)) shiftWheelHorizontal(ev); }, { passive: false });
}
