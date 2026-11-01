// Alt-Hilfe gehört ausschließlich dem bereits überfahrenen Tab. Jede zweite
// Taste bricht den Timer ab, damit Tastenkombinationen ohne Popup durchkommen.
export function bindTabHelp(root, { show, hide, allowed = () => true, delay = 180 }) {
  let hovered = null;
  let altDown = false;
  let blocked = false;
  let timer = null;
  const cancel = () => { clearTimeout(timer); timer = null; hide(); };
  const reset = () => { cancel(); altDown = false; blocked = false; };
  const listeners=[];
  const listen=(target,type,handler,options)=>{target.addEventListener(type,handler,options);listeners.push(()=>target.removeEventListener(type,handler,options));};
  const tabAt = (target) => target?.closest?.('[data-mode]') || null;
  listen(root,'pointerover', (event) => {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    const tab = tabAt(event.target);
    if (tab !== hovered) { cancel(); hovered = tab; }
  });
  listen(root,'pointerout', (event) => {
    if (tabAt(event.relatedTarget) !== hovered) { cancel(); hovered = null; }
  });
  listen(root,'scroll', () => { cancel(); hovered = null; });
  const doc = root.ownerDocument;
  listen(doc,'keydown', (event) => {
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
  listen(doc,'keyup', (event) => { if (event.key === 'Alt') reset(); }, true);
  listen(doc.defaultView,'blur', reset);
  listen(doc,'visibilitychange', () => { if (doc.hidden) reset(); });
  return { reset, dispose:()=>{clearTimeout(timer);timer=null;for(const remove of listeners)remove();hovered=null;} };
}
