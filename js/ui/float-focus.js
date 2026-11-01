// Ein großes Lesefenster hält den Tastaturfokus; kompakte Kopien bleiben nichtmodal.
export function syncFloatFocus(ctx) {
  const overlay=Boolean(ctx.cs.state.quick?.open && ctx.cs.state.focusWin==='quick' || ctx.td?.open || Object.values(ctx.layers || {}).some(value=>value===true) || ctx.cs.state.flowlens?.open);
  const visible = !ctx.tourOpen && !overlay;
  const configured = ctx.cs.state.floats.find(f => f.size === 'full');
  const full = visible ? configured : null;
  const id = full?.id || '';
  const changed = id !== (ctx.fullFloatId || '');
  const previous = ctx.fullFloatId;
  if (configured && !ctx.modalFloatId) ctx.floatReturnFocus = document.activeElement;
  const previousModal=ctx.modalFloatId;ctx.modalFloatId=configured?.id || '';
  const main = document.querySelector('#app');
  if (main) main.inert = Boolean(id);
  for (const name of ['#layer-td','#layer-course','#layer-atlas','#layer-flowlens','#layer-offline']) {
    const layer = document.querySelector(name);
    if (layer) layer.inert = Boolean(id);
  }
  const quick = document.querySelector('#quick');
  if (quick) quick.inert = Boolean(id) || ctx.tourOpen;
  for (const card of document.querySelectorAll('[data-float]')) {
    card.inert = Boolean(id) && card.dataset.float !== id;
    if (card.dataset.float === id) {card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');}
    else {card.removeAttribute('role');card.removeAttribute('aria-modal');}
  }
  ctx.fullFloatId = id;
  const popup = document.querySelector('#popup.show');
  if (id && !popup && (changed || !document.activeElement?.closest(`[data-float="${id}"]`))) {
    document.querySelector(`[data-float="${id}"] .fh button`)?.focus({preventScroll:true});
  } else if (!configured && previousModal) {
    if(!overlay && !ctx.tourOpen && ctx.floatReturnFocus?.isConnected)ctx.floatReturnFocus.focus({preventScroll:true});
    ctx.floatReturnFocus = null;
  }
  const requested=ctx.cs.state.quickFocusRequested;
  if(requested && !id && !ctx.tourOpen){const input=document.querySelector(`[data-qid="${requested}"] [data-qinput]`);input?.focus({preventScroll:true});input?.scrollIntoView({block:'nearest'});ctx.cs.state.quickFocusRequested=null;}
}

export function trapFloatTab(ctx, event) {
  if (event.key !== 'Tab' || !ctx.fullFloatId || document.querySelector('#popup.show')) return false;
  const card = document.querySelector(`[data-float="${ctx.fullFloatId}"]`);
  const controls = [...(card?.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),summary,[tabindex="0"]') || [])]
    .filter(el=>!el.closest('[hidden]') && ![el,...ancestors(el,card)].some(node=>node.style?.display==='none'));
  if (!controls.length) return false;
  const first=controls[0], last=controls.at(-1), current=document.activeElement;
  if (event.shiftKey && (current===first || !card.contains(current))) {event.preventDefault();last.focus();return true;}
  if (!event.shiftKey && (current===last || !card.contains(current))) {event.preventDefault();first.focus();return true;}
  return false;
}

function ancestors(el,stop) {const result=[];let parent=el.parentElement;while(parent && parent!==stop){result.push(parent);parent=parent.parentElement;}return result;}
