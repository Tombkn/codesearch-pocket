import {abs, rel, clone} from './util.js';
import {parseProtocol, revisionFor, collectEvidence} from './investigation.js';
import {stateAtlas} from './views/miscviews.js';
import {buildAnalysisBrief, rememberPacket, analysisState} from './analysis-workbench.js';

export const SPEC_STORAGE_KEY = 'codesearch-pocket-specs-v1';
const LIMIT = 3500000;
const CONTENT = ['title','goal','scope','non_goals','constraints','requirements'];
const REQUIREMENT = ['id','title','given','when','then','counterexample','assertion'];
const REPORT = ['id','kind','requirement_id','requirement_snapshot','spec_revision','evidence_id','source_revision','origin','performed_at','procedure','observation','result','reason','observed'];
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype,null].includes(Object.getPrototypeOf(v));
const need = (ok, message) => { if (!ok) throw new Error(message); };
function plain(v, depth = 0) {
  need(depth <= 50, 'JSON zu tief');
  if (typeof v === 'string') { need(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v), 'Ungepaartes Unicode-Surrogate'); return; }
  if (v === null || typeof v === 'boolean') return;
  if (typeof v === 'number') { need(Number.isFinite(v), 'Nicht endliche Zahl'); return; }
  need(Array.isArray(v) || object(v), 'Nur eigene JSON-Daten erlaubt');
  for (const key of Object.keys(v)) { plain(key, depth + 1); const descriptor = Object.getOwnPropertyDescriptor(v,key); need(Object.hasOwn(descriptor,'value'), 'Getter sind keine JSON-Daten'); plain(descriptor.value,depth + 1); }
}
function fields(v, keys) { need(object(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k)), 'Unbekannte oder fehlende Schemafelder'); }
function text(v, max = 4000, required = false) { need(typeof v === 'string' && [...v].length <= max && (!required || v.length > 0), 'Ungültiger oder zu langer Text'); plain(v); }
export function canonical(v) { if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'; if (object(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'; return JSON.stringify(v); }
export function scalar(v) {
  if (v === null) return {type:'null',value:null};
  if (typeof v === 'boolean') return {type:'boolean',value:v};
  if (typeof v === 'number') { need(Number.isFinite(v) && (!Number.isInteger(v) || Number.isSafeInteger(v)), 'Number außerhalb des sicheren Bereichs'); return {type:'number',value:v}; }
  if (typeof v === 'string') { text(v); return {type:'string',value:v}; }
  throw new Error('Erwartung muss ein JSON-Skalar sein');
}
export function parseExpected(v) { text(v); return scalar(parseProtocol(v)); }
function requirement(v) {
  fields(v,REQUIREMENT);
  for (const k of REQUIREMENT.filter(k => k !== 'assertion')) text(v[k], k === 'id' ? 100 : k === 'title' ? 200 : 4000,k === 'id');
  if (v.assertion !== null) { fields(v.assertion,['state_id','expected_json']); text(v.assertion.state_id,2000,true); parseExpected(v.assertion.expected_json); }
}
function content(v) {
  fields(v,CONTENT);
  for (const k of CONTENT.filter(k => k !== 'requirements')) text(v[k],k === 'title' ? 200 : k === 'scope' ? 2000 : 4000,k === 'scope');
  need(Array.isArray(v.requirements) && v.requirements.length <= 32,'Maximal 32 Anforderungen');
  v.requirements.forEach(requirement);
  need(new Set(v.requirements.map(r => r.id)).size === v.requirements.length,'Doppelte Anforderungs-ID');
}
export function specRevision(v) { plain(v); content(v); return revisionFor({content:canonical(v)}); }
export function newSpec(scope,title,ident) {
  const c = {title,goal:'',scope,non_goals:'',constraints:'',requirements:[]}, revision = specRevision(c);
  return validateSpec({schema:'codesearch.spec.v1',id:ident,revision,revisions:{[revision]:c},evidence:{},reports:[]});
}
export function evaluateAssertion(r, packet) {
  plain(r); plain(packet);
  requirement(r);
  const unknown = reason => ({result:'unknown',reason,observed:null});
  if (!r.assertion) return unknown('no_assertion');
  const found = (packet.states || []).filter(s => s.id === r.assertion.state_id);
  if (found.length !== 1) return unknown('state_missing_or_ambiguous');
  const frozen = found[0].value;
  if (!object(frozen) || Object.keys(frozen).length !== 2 || !Object.hasOwn(frozen,'value') || !Object.hasOwn(frozen,'type')) return unknown('value_unavailable');
  const types = {bool:'boolean',boolean:'boolean',int:'number',float:'number',number:'number',str:'string',string:'string',NoneType:'null',null:'null'};
  let observed;
  try { observed = scalar(frozen.value); } catch { return unknown('value_unavailable'); }
  if (!Object.hasOwn(types,frozen.type) || types[frozen.type] !== observed.type) return unknown('value_unavailable');
  const expected = parseExpected(r.assertion.expected_json), equal = expected.type === observed.type && expected.value === observed.value;
  return {result:equal ? 'match' : 'mismatch',reason:equal ? 'scalar_equal' : 'scalar_different',observed};
}
export function validateSpec(doc) {
  plain(doc); need(new TextEncoder().encode(JSON.stringify(doc)).length <= LIMIT,'Spec überschreitet 3.500.000 Bytes');
  fields(doc,['schema','id','revision','revisions','evidence','reports']);
  need(doc.schema === 'codesearch.spec.v1','Schema codesearch.spec.v1 erforderlich');
  text(doc.id,100,true); need(/^[A-Za-z0-9_-]{1,100}$/.test(doc.id),'Unsichere Spec-ID');
  text(doc.revision,100,true);
  need(object(doc.revisions) && Object.keys(doc.revisions).length >= 1 && Object.keys(doc.revisions).length <= 65,'Maximal 65 Revisionen');
  need(object(doc.evidence) && Object.keys(doc.evidence).length <= 64 && Array.isArray(doc.reports) && doc.reports.length <= 64,'Maximal 64 Reports/Pakete');
  need(Object.hasOwn(doc.revisions,doc.revision),'Aktuelle Revision fehlt');
  for (const [rev,c] of Object.entries(doc.revisions)) need(specRevision(c) === rev,'Normative Revision stimmt nicht');
  for (const [id,p] of Object.entries(doc.evidence)) {
    need(object(p) && p.id === id && p.schema === 'codesearch.evidence.v1','Paket-ID/Schema stimmt nicht');
    need(Object.keys(p).every(k=>['schema','id','revision','scope','sources','states','captured','owners','calls','symbols','events','recording','outputs','coverage','label','intent'].includes(k)),'Unbekanntes Belegpaket-Feld');
    text(id,100,true); text(p.scope,2000,true);
    need(object(p.sources) && Object.keys(p.sources).length <= 100,'Ungültige Sources');
    for (const [path,source] of Object.entries(p.sources)) { text(path,2000,true); text(source,1000000); }
    need(p.revision === revisionFor(p.sources),'Quellenrevision stimmt nicht');
    need(Array.isArray(p.states) && p.states.every(s => object(s) && typeof s.id === 'string'),'Ungültige States');
  }
  const ids = new Set();
  for (const report of doc.reports) {
    fields(report,REPORT);
    for (const k of ['id','requirement_id','spec_revision','evidence_id','source_revision']) text(report[k],100,!['evidence_id','source_revision'].includes(k));
    for (const k of ['performed_at','procedure','observation']) text(report[k]);
    need(/T.*(?:Z|\+00:00)$/.test(report.performed_at) && Number.isFinite(Date.parse(report.performed_at)),'performed_at muss ISO-8601 UTC sein');
    need(!ids.has(report.id),'Doppelte Report-ID'); ids.add(report.id);
    const c = doc.revisions[report.spec_revision], r = c?.requirements.find(r => r.id === report.requirement_id);
    need(r && canonical(r) === canonical(report.requirement_snapshot),'Requirement-Snapshot stimmt nicht');
    if (report.kind === 'manual') {
      const expected = {evidence_id:'',source_revision:'',origin:'imported_manual',result:'not_checked',reason:'manual_observation',observed:null};
      need(Object.entries(expected).every(([k,v]) => canonical(report[k]) === canonical(v)),'Manueller Report darf keine Abnahme behaupten');
    } else {
      need(report.kind === 'snapshot','Ungültiger Report-Typ');
      const p = doc.evidence[report.evidence_id];
      need(p && p.revision === report.source_revision && p.scope === c.scope,'Report-Paketbindung stimmt nicht');
      need(['native','pocket_simulation'].includes(report.origin),'Ungültige Herkunft');
      need(Object.entries(evaluateAssertion(r,p)).every(([k,v]) => canonical(report[k]) === canonical(v)),'Gespeicherter Vergleich stimmt nicht');
    }
  }
  return clone(doc);
}
function prune(doc) {
  const revs = new Set([doc.revision,...doc.reports.map(r => r.spec_revision)]), packets = new Set(doc.reports.map(r => r.evidence_id));
  doc.revisions = Object.fromEntries(Object.entries(doc.revisions).filter(([k]) => revs.has(k)));
  doc.evidence = Object.fromEntries(Object.entries(doc.evidence).filter(([k]) => packets.has(k)));
  return doc;
}
export function reviseSpec(doc,c) { const candidate = validateSpec(doc), revision = specRevision(c); candidate.revisions[revision] = clone(c); candidate.revision = revision; return validateSpec(prune(candidate)); }
export function appendReport(doc,report,packet = null) {
  const candidate = validateSpec(doc);
  if (packet) { const previous = candidate.evidence[packet.id]; need(!previous || canonical(previous) === canonical(packet),'Paket-ID mit anderem Inhalt vorhanden'); candidate.evidence[packet.id] = clone(packet); }
  candidate.reports.push(clone(report)); return validateSpec(prune(candidate));
}
export function renderSpecMarkdown(doc) {
  doc = validateSpec(doc); const c = doc.revisions[doc.revision];
  const lines = ['# ' + c.title,'','Spec: ' + doc.id,'Revision: ' + doc.revision,'','Soll-Beschreibung. Reports sind keine globale Feature-Abnahme.'];
  for (const k of ['scope','goal','non_goals','constraints']) lines.push('','## ' + k,c[k]);
  for (const r of c.requirements) { lines.push('','## ' + r.title,'Requirement: ' + r.id); for (const k of ['given','when','then','counterexample']) lines.push('',k + ': ' + r[k]); if (r.assertion) lines.push('','Snapshot: ' + r.assertion.state_id + ' = ' + r.assertion.expected_json); }
  for (const r of doc.reports) {
    const saved=r.requirement_snapshot;
    lines.push('','## Report ' + r.id,`${r.kind} · ${r.result} · ${r.origin}`,
      `Zeitpunkt: ${r.performed_at}`,`Requirement-ID: ${r.requirement_id}`,`Spec-Revision: ${r.spec_revision}`,
      `Bezug: ${r.spec_revision===doc.revision?'aktuelle':'historische'} Spec-Revision`,
      `Paket-ID: ${r.evidence_id || 'keine'}`,`Quellenrevision: ${r.source_revision || 'keine'}`,
      'Historisch dokumentiert; Herkunft nicht unabhängig bestätigt.',
      '',`Damals geprüfte Anforderung: ${saved.title}`,
      ...['given','when','then','counterexample'].map(k=>`${k}: ${saved[k]}`),
      `Erwartung damals: ${saved.assertion ? JSON.stringify(saved.assertion) : 'kein Wertvergleich'}`,
      '',r.procedure,r.observation,`Beobachtet: ${JSON.stringify(r.observed)}`,
      'Der Wertvergleich bestätigt weder die Durchführung von Given/When noch das gesamte Feature.');
  }
  return lines.join('\n');
}
export function buildSpecBrief(doc,id,packet) {
  doc = validateSpec(doc); const c = doc.revisions[doc.revision], r = c.requirements.find(r => r.id === id);
  need(r,'Anforderung auswählen'); need(packet.scope === c.scope,'Paket-Scope passt nicht zur Spec');
  const brief = buildAnalysisBrief(packet,'change',c.goal);
  return {...brief,spec_id:doc.id,spec_revision:doc.revision,requirement_id:id,desired_spec:clone(c),requirement:clone(r),prompt:brief.prompt + '\nTrenne gewünschtes Verhalten (Soll), gesammelte Belege (Ist) und erst geplante Tests. Die Spec ist keine aus Code abgeleitete Wahrheit. Ein Snapshot-Vergleich bestätigt nicht Given/When oder den Eventverlauf. Keine globale Feature-Abnahme.'};
}

const uuid = () => globalThis.crypto.randomUUID();
export class SpecWorkbench {
  constructor(cs,storage) { this.cs=cs; this.storage=storage; this.document=null; this.selected=''; this.savedRevision=''; this.savedText=''; this.sessionReportIds=new Set(); this.pending=null; this.error=''; this.exportId=''; this.importId=''; this.briefId=''; this.epoch=0; this.importNote=''; }
  get current() { return this.document?.revisions[this.document.revision]; }
  get dirty() { return !!this.document && (this.inputDirty || JSON.stringify(this.document) !== this.savedText); }
  get requirement() { return this.current?.requirements.find(r => r.id === this.selected); }
  changed() { this.cs.emit(); }
  view() { this.cs.state.view='spec'; this.cs.state.selected=-1; this.cs.state.mode='map'; this.changed(); return this.snapshot(); }
  replace(doc,kind) {
    const candidate=validateSpec(doc);
    if (this.dirty) { this.pending={doc:candidate,kind}; this.changed(); return {ok:false,pending:true}; }
    return this.accept(candidate,kind);
  }
  accept(doc,kind) {
    if(kind==='import') {
      this.importNote='';
      let store;
      try {store=this.saved();}catch {store=null;}
      if(!store || (Object.hasOwn(store,doc.id) && canonical(store[doc.id])!==canonical(doc))) {
        doc={...doc,id:uuid()};this.importNote='Als neue Kopie importiert; gespeicherte Spec bleibt erhalten.';
      }
    }
    this.document=doc; this.selected=this.current.requirements[0]?.id || ''; this.sessionReportIds.clear(); this.pending=null; this.error='';
    this.epoch+=1; this.exportId='';this.importId='';this.briefId='';this.inputDirty=false;
    this.savedRevision=kind==='load' ? doc.revision : ''; this.savedText=kind==='load' ? JSON.stringify(doc) : '';
    if (kind==='import') this.importId=uuid();
    this.view(); return clone(doc);
  }
  confirm(discard) { if (!this.pending) return false; const next=this.pending; this.pending=null; if (discard) return this.accept(next.doc,next.kind); this.changed(); return false; }
  new(title='') { return this.replace(newSpec(abs(this.cs.codeTargetPath()),title,uuid()),'new'); }
  select(id) { need(this.current?.requirements.some(r=>r.id===id),'Anforderung fehlt'); this.selected=id; this.changed(); return id; }
  add(title='') {
    need(this.document,'Zuerst neue Spec anlegen'); const c=clone(this.current), id=uuid();
    c.requirements.push({id,title,given:'',when:'',then:'',counterexample:'',assertion:null}); this.document=reviseSpec(this.document,c); this.selected=id; this.changed(); return id;
  }
  set(field,value,id='') {
    need(this.document,'Zuerst neue Spec anlegen'); const c=clone(this.current), r=id ? c.requirements.find(r=>r.id===id) : null;
    if (id) {
      need(r,'Anforderung fehlt');
      if (['state_id','expected_json'].includes(field)) {
        if (field==='state_id' && value==='') r.assertion=null;
        else { need(field==='state_id' || r.assertion,'Zuerst State auswählen'); r.assertion={...(r.assertion || {state_id:value,expected_json:'null'}),[field]:value}; }
      } else { need(['title','given','when','then','counterexample'].includes(field),'Unbekanntes Requirement-Feld'); r[field]=value; }
    } else { need(CONTENT.includes(field) && field!=='requirements','Unbekanntes Spec-Feld'); c[field]=value; }
    this.document=reviseSpec(this.document,c); this.error=''; this.changed(); return this.document.revision;
  }
  packet() { need(this.document,'Zuerst Spec anlegen'); const target=rel(this.current.scope); need(this.cs.net.op(target),'Gespeicherter Scope fehlt; keine Ersatzauswahl verwendet'); return collectEvidence(this.cs,stateAtlas(this.cs,target),target); }
  states() { return this.packet().states; }
  reportBase(id) { const r=this.current?.requirements.find(r=>r.id===(id || this.selected)); need(r,'Anforderung auswählen'); return {id:uuid(),requirement_id:r.id,requirement_snapshot:clone(r),spec_revision:this.document.revision,performed_at:new Date().toISOString(),procedure:'',observation:''}; }
  check(id='') {
    const base=this.reportBase(id), packet=this.packet(), report={...base,kind:'snapshot',evidence_id:packet.id,source_revision:packet.revision,origin:'pocket_simulation',...evaluateAssertion(base.requirement_snapshot,packet)};
    const candidate=appendReport(this.document,report,packet); this.document=candidate; this.sessionReportIds.add(report.id); this.error=''; this.changed(); return clone(report);
  }
  observe(procedure,observation,id='') { const report={...this.reportBase(id),kind:'manual',evidence_id:'',source_revision:'',origin:'imported_manual',procedure,observation,result:'not_checked',reason:'manual_observation',observed:null}; this.document=appendReport(this.document,report); this.sessionReportIds.add(report.id); this.changed(); return clone(report); }
  brief() { const packet=this.packet(), result=buildSpecBrief(this.document,this.selected,packet); rememberPacket(this.cs,packet); analysisState(this.cs).packetId=packet.id; this.cs.copy(JSON.stringify(result,null,2),'spec-brief'); this.briefId=uuid(); this.changed(); return result; }
  saved() { need(this.storage,'Speicher nicht verfügbar; Entwurf bleibt als Datei exportierbar'); const raw=this.storage.getItem(SPEC_STORAGE_KEY); const data=raw ? parseProtocol(raw,35000000,35000000,51) : Object.create(null); need(object(data),'Ungültiger Spec-Speicher'); return data; }
  list() { try { return Object.entries(this.saved()).map(([id,doc])=>({id,title:validateSpec(doc).revisions[doc.revision].title})); } catch { return []; } }
  save() {
    try { need(this.document,'Keine Spec vorhanden'); const checked=validateSpec(this.document), store=this.saved(); store[checked.id]=checked; this.storage.setItem(SPEC_STORAGE_KEY,JSON.stringify(store)); this.savedRevision=checked.revision; this.savedText=JSON.stringify(checked); this.error=''; this.changed(); return SPEC_STORAGE_KEY; }
    catch(error) { this.error='Speichern fehlgeschlagen: '+error.message; this.changed(); throw error; }
  }
  load(id) { const store=this.saved(); need(Object.hasOwn(store,id),'Gespeicherte Spec fehlt'); return this.replace(store[id],'load'); }
  import(text) { return this.replace(validateSpec(parseProtocol(text,LIMIT,LIMIT,50)),'import'); }
  export() { const result=validateSpec(this.document); this.cs.copy(JSON.stringify(result),'spec-json'); this.exportId=uuid(); this.changed(); return result; }
  markdown() { const result=renderSpecMarkdown(this.document); this.cs.copy(result,'spec-markdown'); this.exportId=uuid(); this.changed(); return result; }
  sourceCurrent(report) { const p=this.document?.evidence[report?.evidence_id]; if (!p) return null; return Object.entries(p.sources).every(([path,source]) => this.cs.net.op(rel(path)) && this.cs.net.lines(rel(path)).join('\n')===source); }
  snapshot() {
    const d=this.document,r=d?.reports.at(-1), values={spec_id:d?.id || '',spec_revision:d?.revision || '',spec_view:this.cs.state.view==='spec',spec_dirty:this.dirty,spec_requirement_count:this.current?.requirements.length || 0,spec_requirement_id:this.selected,spec_expected_json:this.requirement?.assertion?.expected_json || '',spec_report_count:d?.reports.length || 0,spec_report_id:r?.id || '',spec_report_result:r?.result || '',spec_report_kind:r?.kind || '',spec_report_spec_revision:r?.spec_revision || '',spec_report_current:!!r && r.spec_revision===d.revision,spec_report_session:!!r && this.sessionReportIds.has(r.id),spec_report_origin:r?.origin || '',spec_report_evidence_id:r?.evidence_id || '',spec_saved_revision:this.savedRevision,spec_export_id:this.exportId,spec_import_id:this.importId,spec_brief_id:this.briefId};
    return {...values,...Object.fromEntries(Object.entries(values).map(([k,v])=>['investigation.'+k,v]))};
  }
}
