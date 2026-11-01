import {hostQuery} from './cs-host.js';
import {$,esc,updateHtml} from './dom.js';

const labels={title:'Titel',goal:'Gewünschtes Verhalten',scope:'Gespeicherter Scope',non_goals:'Nicht Teil dieser Änderung',constraints:'Randbedingungen',given:'Given · Ausgangslage',when:'When · eigener Handgriff',then:'Then · erwartete Beobachtung',counterexample:'Gegenprobe'};
const button=(action,label)=>`<button type="button" data-spec-act="${action}">${label}</button>`;
const fieldKey=(ctx,field,id='')=>`${ctx.cs.spec.document?.id || ''}|${id}|${field}`;
function hasDraftErrors(ctx) { return Object.keys(ctx.specDraftErrors || {}).some(k=>k.startsWith((ctx.cs.spec.document?.id || '')+'|')); }
function refreshStates(ctx) {
  const s=ctx.cs.spec;
  ctx.specCache={scope:s.current?.scope,epoch:s.epoch,states:s.document?s.states():[],sources:new Map()};
}
function field(name,value,requirement=false) { return `<label>${labels[name]}<textarea rows="${['title','scope'].includes(name)?1:3}" data-spec-field="${name}" data-requirement="${requirement}" maxlength="${name==='title'?200:name==='scope'?2000:4000}">${esc(value)}</textarea></label>`; }
export function renderSpec(ctx) {
  const $ = selector => hostQuery(ctx, selector);
  const cs=ctx.cs, s=cs.spec, root=$('#cs-spec');
  if (!root) return;
  const active=cs.state.view==='spec'; root.hidden=!active; $('#cs-body').classList.toggle('spec-open',active);
  if (!active) {ctx.specWasActive=false;return;}
  if (!ctx.specWasActive || ctx.specCache?.scope!==s.current?.scope || ctx.specCache?.epoch!==s.epoch) {
    try {refreshStates(ctx);}catch(error){s.error=error.message;ctx.specCache={scope:s.current?.scope,epoch:s.epoch,states:[],sources:new Map()};}
  }
  ctx.specWasActive=true;
  if (!root.firstElementChild) root.innerHTML=`<header class="analysis-heading"><h2>Spec-Arbeitsplatz</h2><p>Gewünschtes Verhalten festhalten → selbst ausprobieren → Belege getrennt beurteilen.</p><p class="analysis-note">Pocket-Simulation. Ein Snapshot vergleicht einen Wert; er führt Given/When nicht aus und gibt kein Feature frei.</p>${button('analysis','Zur LLM-Analyse ↗')}</header><section class="analysis-card"><div class="analysis-actions">${button('new','Neue Spec')}${button('save','Speichern')}${button('json','JSON-Datei')}${button('markdown','Markdown-Datei')}</div><p id="spec-save-status" role="status"></p><div id="spec-error" role="alert"></div><label>Gespeicherte Spec öffnen<select id="spec-saved"><option value="">Spec auswählen …</option></select></label>${button('load','Ausgewählte Spec öffnen')}<details data-persist="spec-import"><summary>Spec importieren</summary><label>JSON-Datei<input id="spec-file" type="file" accept=".json,application/json"></label><label>Oder JSON einfügen<textarea id="spec-import-text" rows="5"></textarea></label>${button('import','Import prüfen')}</details></section><div id="spec-pending"></div><section id="spec-document" class="analysis-card"></section><section id="spec-requirement" class="analysis-card"></section><section id="spec-reports" class="analysis-card"></section>`;
  updateHtml($('#spec-save-status'),s.document ? `${s.dirty?'Ungespeicherter Entwurf':'Gespeichert'} · ${esc(s.document.id)}<br><small>${esc(s.document.revision)}</small>`:'Noch keine Spec. „Neue Spec“ übernimmt den aktuellen Scope.');
  const errors=Object.entries(ctx.specDraftErrors || {}).filter(([k])=>k.startsWith((s.document?.id || '')+'|')).map(([,v])=>v);
  updateHtml($('#spec-error'),esc(errors.length?errors.join(' · '):s.error || s.importNote || ''));
  const select=$('#spec-saved'), selected=select.value;
  const saved=s.list(); updateHtml(select,'<option value="">Spec auswählen …</option>'+saved.map(d=>`<option value="${esc(d.id)}">${esc(d.title || d.id)}</option>`).join('')); select.value=selected;
  updateHtml($('#spec-pending'),s.pending ? `<section class="analysis-card" role="alertdialog" aria-label="Ungespeicherte Änderungen"><h3>Ungespeicherten Entwurf ersetzen?</h3><p>Die geprüfte ${s.pending.kind==='import'?'Importdatei':'Spec'} wird erst nach deiner Entscheidung übernommen. Abbrechen behält deinen Entwurf.</p>${button('discard','Entwurf verwerfen und fortfahren')}${button('cancel','Abbrechen')}</section>`:'');
  const doc=$('#spec-document'),req=$('#spec-requirement'),reports=$('#spec-reports');
  if (!s.document) { doc.hidden=true;req.hidden=true;reports.hidden=true;return; }
  doc.hidden=false;req.hidden=false;reports.hidden=false;
  if (doc.dataset.document!==s.document.id) { doc.innerHTML=`<h3>1 · Gewünschtes Verhalten</h3>${['title','goal','scope','non_goals','constraints'].map(k=>field(k,s.current[k])).join('')}`; doc.dataset.document=s.document.id; }
  for (const el of doc.querySelectorAll('[data-spec-field]')) if (document.activeElement!==el) el.value=ctx.specDraftValues?.[fieldKey(ctx,el.dataset.specField)] ?? s.current[el.dataset.specField];
  const key=s.document.id+':'+s.selected;
  if (req.dataset.requirement!==key) {
    req.innerHTML=`<h3>2 · Anforderungen und eigener Versuch</h3><label>Anforderung<select id="spec-requirements"></select></label>${button('add','Anforderung hinzufügen')}<div id="spec-requirement-fields"></div>`;
    const r=s.requirement;
    if (r) $('#spec-requirement-fields').innerHTML=`${['title','given','when','then','counterexample'].map(k=>field(k,r[k],true)).join('')}<h4>Optionaler Snapshot-Vergleich</h4><label>Echter State im gespeicherten Scope<select id="spec-state"></select></label>${button('refresh','Werte und Quellen aktualisieren')}<label>Erwartung als JSON-Skalar<input id="spec-expected" type="text" value="${esc(r.assertion?.expected_json || '')}" placeholder="false, 0.7, &quot;Text&quot; oder null"></label><p>Setze die Ausgangslage und führe den Handgriff selbst in TD aus. Erst danach „Wert prüfen“. Pocket sammelt ausschließlich den simulierten aktuellen Wert.</p><div class="analysis-actions">${button('check','Wert prüfen · Snapshot')}${button('brief','Gebundenen Analyseauftrag kopieren')}</div><details data-persist="spec-observation"><summary>Beobachtung dokumentieren</summary><label>Was hast du tatsächlich gemacht?<textarea id="spec-procedure" rows="3"></textarea></label><label>Was hast du beobachtet?<textarea id="spec-observation" rows="3"></textarea></label>${button('observe','Beobachtung festhalten · ungeprüft')}</details>`;
    req.dataset.requirement=key;
  }
  const reqSelect=$('#spec-requirements'); updateHtml(reqSelect,s.current.requirements.map((r,i)=>`<option value="${esc(r.id)}">${i+1} · ${esc(r.title || 'Noch ohne Titel')}</option>`).join('')); reqSelect.value=s.selected;
  const r=s.requirement;
  for (const name of ['spec-procedure','spec-observation','spec-import-text']) {
    const el=$('#'+name), key=`${s.document.id}|${s.selected}|${name}`;
    if(el && document.activeElement!==el) el.value=ctx.specFormDrafts?.[key] || '';
  }
  if (r) {
    for (const el of req.querySelectorAll('[data-spec-field]')) if (document.activeElement!==el) el.value=ctx.specDraftValues?.[fieldKey(ctx,el.dataset.specField,s.selected)] ?? r[el.dataset.specField];
    const states=ctx.specCache.states;
    const stateSelect=$('#spec-state');
    updateHtml(stateSelect,'<option value="">Kein automatischer Vergleich</option>'+states.map(v=>`<option value="${esc(v.id)}">${esc(v.name)} · ${esc(v.id)}</option>`).join('')+(r.assertion && !states.some(v=>v.id===r.assertion.state_id)?`<option value="${esc(r.assertion.state_id)}">Nicht gefunden: ${esc(r.assertion.state_id)}</option>`:'')); stateSelect.value=r.assertion?.state_id || '';
    const expected=$('#spec-expected'); if (document.activeElement!==expected) expected.value=ctx.specDraftValues?.[fieldKey(ctx,'expected_json',s.selected)] ?? r.assertion?.expected_json ?? '';
  }
  updateHtml(reports,'<h3>3 · Dokumentierte Ergebnisse</h3>'+(s.document.reports.length?s.document.reports.slice().reverse().map(report=>{
    if(!ctx.specCache.sources.has(report.id))ctx.specCache.sources.set(report.id,s.sourceCurrent(report));
    const source=ctx.specCache.sources.get(report.id);
    return `<article class="analysis-claim"><h4>${esc(report.requirement_snapshot.title)}</h4><p>${report.kind==='snapshot'?'Snapshot-Vergleich':'Manuelle Beobachtung'} · <b>${esc({match:'Wert stimmt überein',mismatch:'Wert weicht ab',unknown:'Nicht bestimmbar',not_checked:'Nicht geprüft'}[report.result])}</b></p><p>${s.sessionReportIds.has(report.id)?'In dieser Sitzung aufgenommen':'Historisch dokumentiert; Herkunft nicht unabhängig bestätigt'}. Pocket: Simulation, kein TD-Laufzeitnachweis.</p><p>Spec-Bezug: ${report.spec_revision===s.document.revision?'aktuelle Spec-Revision':'ältere Spec-Revision'}. Quellen beim letzten Abgleich: ${source===null?'kein Quellenvergleich':source?'Quelltext unverändert; Runtime kann anders sein':'geändert oder nicht verfügbar; erneut prüfen'}.</p><p>${esc(report.procedure)} ${esc(report.observation)}</p><details><summary>Wert, IDs und Bindung</summary><pre>${esc(JSON.stringify(report,null,2))}</pre></details></article>`;
  }).join(''):'<p>Noch kein Report. Ein passender Wert bestätigt weder die Durchführung des Versuchs noch das gesamte Feature.</p>'));
}

function download(text,name,type) {
  const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function bindSpec(ctx, host=hostQuery(ctx, '#cs')) {
  const $ = selector => hostQuery(ctx, selector);
  ctx.specDraftErrors ??= {};ctx.specDraftValues ??= {};ctx.specFormDrafts ??= {};
  const role = el => el.dataset.role || el.id;
  const run=fn=>{try { fn(); }catch(error){ctx.cs.spec.error=error.message;}ctx.render();};
  const input=(field,value,id='')=>{
    const key=fieldKey(ctx,field,id);
    ctx.specDraftValues[key]=value;
    try {ctx.cs.SetSpecField(field,value,id);delete ctx.specDraftValues[key];delete ctx.specDraftErrors[key];}
    catch(error){ctx.specDraftErrors[key]=`${field}: ${error.message}`;}
    ctx.cs.spec.inputDirty=hasDraftErrors(ctx);
    ctx.render();
  };
  host.addEventListener('input',event=>{
    const el=event.target;
    if(['spec-procedure','spec-observation','spec-import-text'].includes(role(el))) {
      ctx.specFormDrafts[`${ctx.cs.spec.document?.id}|${ctx.cs.spec.selected}|${role(el)}`]=el.value;
      ctx.render();
    }
    if (el.matches('[data-spec-field]')) input(el.dataset.specField,el.value,el.dataset.requirement==='true'?ctx.cs.spec.selected:'');
    if (role(el)==='spec-expected') input('expected_json',el.value,ctx.cs.spec.selected);
  });
  host.addEventListener('change',event=>{
    const el=event.target;
    if(role(el)==='spec-state') run(()=>ctx.cs.SetSpecField('state_id',el.value,ctx.cs.spec.selected));
    if(role(el)==='spec-requirements') run(()=>ctx.cs.SelectSpecRequirement(el.value));
    if(role(el)==='spec-file' && el.files[0]) {
      const file=el.files[0];
      if(file.size>3500000) {run(()=>{throw new Error('Datei überschreitet 3.500.000 Bytes');});return;}
      file.text().then(text=>run(()=>ctx.cs.ImportSpec(text)),error=>run(()=>{throw error;}));
    }
  });
  host.addEventListener('click',event=>{
    const action=event.target.closest('[data-spec-act]')?.dataset.specAct;if(!action)return;
    run(()=>{
      const cs=ctx.cs;
      if(hasDraftErrors(ctx) && ['save','check','brief','observe','json','markdown'].includes(action)) throw new Error('Ungültige Eingaben zuerst korrigieren. Dein eingegebener Text bleibt erhalten.');
      switch(action) {
        case 'analysis': return cs.analysis();
        case 'new': return cs.NewSpec();
        case 'save': return cs.SaveSpec();
        case 'load': return cs.LoadSpec($('#spec-saved').value);
        case 'add': return cs.AddSpecRequirement();
        case 'check': return cs.CheckSpecRequirement();
        case 'brief': return cs.SpecBrief();
        case 'observe': return cs.RecordSpecObservation($('#spec-procedure').value,$('#spec-observation').value);
        case 'import': return cs.ImportSpec($('#spec-import-text').value);
        case 'refresh': return refreshStates(ctx);
        case 'discard': ctx.specDraftValues={};ctx.specDraftErrors={};return cs.ConfirmSpecReplace(true);
        case 'cancel': return cs.ConfirmSpecReplace(false);
        case 'json': {const doc=cs.ExportSpec();download(JSON.stringify(doc),doc.id+'.json','application/json');return;}
        case 'markdown': {const text=cs.ExportSpecMarkdown();download(text,cs.spec.document.id+'.md','text/markdown');return;}
      }
    });
  });
}
