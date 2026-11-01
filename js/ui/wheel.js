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

// Strg + Rad = Inhaltszoom wie Strg+Plus/Minus: Zweitfenster unter dem Zeiger, sonst das Hauptfenster.
export function ctrlWheelZoom(ev, zoom) {
  if (!ev.ctrlKey || !zoom) return false;
  const delta = ev.deltaY || ev.deltaX;
  if (!delta) return false;
  const card = ev.target.closest?.("[data-float]");
  const main = ev.target.closest?.("#cs, .cs");
  if (!card && !main) return false;
  ev.preventDefault();          // sonst zoomt der Browser die ganze Seite
  zoom(card ? card.dataset.float : null, delta < 0 ? 1 : -1);
  return true;
}

export function bindShiftWheel(target = document, zoom = null) {
  target.addEventListener("wheel", (ev) => { if (!ctrlWheelZoom(ev, zoom)) shiftWheelHorizontal(ev); }, { passive: false });
}
