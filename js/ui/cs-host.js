// Mehrere DOM-Ansichten teilen denselben Arbeitsplatz, aber keine Element-IDs.
export function hostQuery(ctx, selector) {
  if (!ctx.host) return document.querySelector(selector);
  if (selector === '#cs') return ctx.host;
  const scoped = selector.replace(/#([\w-]+)/g, (_, id) => `[data-role="${id}"]`);
  const raw = selector.replace(/#([\w-]+)/g, (_, id) => `[id="${id}"]`);
  return ctx.host.querySelector(scoped) || ctx.host.querySelector(raw);
}

export function normalizeHostIds(host, suffix) {
  for (const el of host.querySelectorAll('[id]')) {
    if (!el.dataset.role) el.dataset.role = el.id;
    el.id = `${el.dataset.role}--${suffix}`;
  }
  for (const el of host.querySelectorAll('[for],[aria-labelledby],[aria-controls]')) {
    for (const attr of ['for','aria-labelledby','aria-controls']) {
      if (el.hasAttribute(attr)) el.setAttribute(attr,el.getAttribute(attr).split(' ').map(id => id.includes('--') ? id : `${id}--${suffix}`).join(' '));
    }
  }
}

export function createHostContext(ctx, host, id) {
  const child = Object.create(ctx);
  Object.assign(child, {host, hostId:id, detailKey:null, fieldSynced:null});
  for (const key of ['specDraftErrors','specDraftValues','specFormDrafts','fieldFocused','specCache','specWasActive']) {
    Object.defineProperty(child,key,{get:()=>ctx[key],set:value=>{ctx[key]=value;}});
  }
  return child;
}

export function hostTemplate() {
  return `<div class="cs-title" id="cs-title"></div><div class="cs-scopes" id="cs-scopes"></div><div class="cs-tabs" id="cs-tabs"></div><div class="cs-context" id="cs-context"></div><div class="cs-target" id="cs-target"></div>
    <div class="cs-field"><span class="cs-gt" id="cs-mode-label"></span><input id="cs-input" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go"><button class="cs-enter" id="cs-enter">⏎</button><button data-act="json">JSON</button></div>
    <div class="cs-filters" id="cs-filters"></div><div class="cs-data" id="cs-data"></div><div class="cs-record" id="cs-record"></div><div class="cs-flow" id="cs-flow"></div><div class="cs-crumb" id="cs-crumb"></div><div class="cs-groups" id="cs-groups"></div>
    <div class="cs-body" id="cs-body"><div class="cs-analysis" id="cs-analysis" role="region" aria-label="LLM-Analyse" tabindex="0" hidden></div><div class="cs-spec cs-analysis" id="cs-spec" role="region" aria-label="Spec-Arbeitsplatz" tabindex="0" hidden></div><div class="cs-list" id="cs-list"></div><div class="cs-split" id="cs-split"></div><aside class="cs-detail" id="cs-detail"></aside></div><div class="cs-status" id="cs-status"></div>`;
}
