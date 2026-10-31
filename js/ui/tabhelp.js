// Alt-Hilfe gehört ausschließlich dem bereits überfahrenen Tab. Jede zweite
// Taste bricht den Timer ab, damit Tastenkombinationen ohne Popup durchkommen.
export function bindTabHelp(root, { show, hide, allowed = () => true, delay = 180 }) {
  let hovered = null;
  let altDown = false;
  let blocked = false;
  let timer = null;
  const cancel = () => { clearTimeout(timer); timer = null; hide(); };
  const reset = () => { cancel(); altDown = false; blocked = false; };
  const tabAt = (target) => target?.closest?.('[data-mode]') || null;
  root.addEventListener('pointerover', (event) => {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    const tab = tabAt(event.target);
    if (tab !== hovered) { cancel(); hovered = tab; }
  });
  root.addEventListener('pointerout', (event) => {
    if (tabAt(event.relatedTarget) !== hovered) { cancel(); hovered = null; }
  });
  root.addEventListener('scroll', () => { cancel(); hovered = null; });
  const doc = root.ownerDocument;
  doc.addEventListener('keydown', (event) => {
    if (event.key !== 'Alt') { if (altDown || event.altKey) { blocked = true; cancel(); } return; }
    if (event.repeat) return;
    altDown = true;
    if (event.ctrlKey || event.shiftKey || event.metaKey || blocked || !hovered || !allowed()) return;
    event.preventDefault();
    const tab = hovered;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (altDown && !blocked && hovered === tab && tab.isConnected && allowed()) show(tab.dataset.mode);
    }, delay);
  }, true);
  doc.addEventListener('keyup', (event) => { if (event.key === 'Alt') reset(); }, true);
  doc.defaultView.addEventListener('blur', reset);
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) reset(); });
  return { reset };
}
