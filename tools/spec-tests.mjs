import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApp} from '../js/core/boot.js';
import {newSpec,specRevision,reviseSpec,validateSpec,evaluateAssertion,parseExpected,appendReport,canonical} from '../js/core/spec-workbench.js';
import {parseProtocol} from '../js/core/investigation.js';

const data=Object.fromEntries(['course','net','code','ui'].map(k=>[k,JSON.parse(readFileSync(new URL(`../data/${k}.json`,import.meta.url),'utf8'))]));
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};};
const app=(store=storage())=>createApp(data,store);
function ready(store=storage()) {
 const {cs}=app(store);cs.cs.Analysistarget='/project1/CodeSearch_Tutorial/SignalGarden/Sensor';cs.NewSpec('Eintrittsschwelle');const id=cs.AddSpecRequirement('Unterhalb');
 const state=cs.SpecStates().find(s=>s.name.endsWith('._present'));
 assert.ok(state);cs.SetSpecField('state_id',state.id,id);cs.SetSpecField('expected_json','false',id);return cs;
}
test('Gemeinsame Native Hash-/Scalar-Fixture',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/spec-contract.json',import.meta.url),'utf8'));
 assert.equal(specRevision(fixture.content),fixture.revision);
 for(const c of fixture.scalar_cases){const r=structuredClone(fixture.content.requirements[0]);r.assertion.expected_json=c.expected;assert.equal(evaluateAssertion(r,{states:[{id:r.assertion.state_id,value:c.observed}]}).result,c.result);}
});
test('Unicode, Leerraum und Array-Reihenfolge bleiben normativ',()=>{
 const doc=newSpec('/Sensor','Licht 🌀 café','safe'),c=structuredClone(doc.revisions[doc.revision]);c.goal=' Ziel ';const rev=specRevision(c);c.goal='Ziel';assert.notEqual(specRevision(c),rev);assert.throws(()=>newSpec('/Sensor','\ud800','x'));
});
test('Scalar-Typen, sichere Integer und Resttext',()=>{
 for(const v of ['NaN','Infinity','{}','[]','1 trailing','9007199254740992'])assert.throws(()=>parseExpected(v));
 assert.deepEqual(parseExpected('1.0'),{type:'number',value:1});assert.deepEqual(parseExpected('null'),{type:'null',value:null});
});
test('Keine Getter oder geerbten Benutzerdaten akzeptieren',()=>{
 let called=false;const doc=newSpec('/Sensor','','safe');Object.defineProperty(doc,'evil',{enumerable:true,get(){called=true;return 1;}});assert.throws(()=>validateSpec(doc));assert.equal(called,false);
 assert.throws(()=>validateSpec(Object.create({schema:'codesearch.spec.v1'})));
});
test('Unsichere IDs und unbekannte Felder werden abgewiesen',()=>{
 for(const id of ['../bad','a/b',''])assert.throws(()=>newSpec('/Sensor','',id));const doc=newSpec('/Sensor','','safe');doc.extra=true;assert.throws(()=>validateSpec(doc));
 assert.throws(()=>parseProtocol('{"a":1,"a":2}'));
});
test('Snapshot erzeugt echten aktuellen Simulationswert, kein Given/When-Autotest',()=>{
 const cs=ready(),before=JSON.stringify(cs.lab.garden.attributes('sensor'));const rev=cs.spec.document.revision,r=cs.CheckSpecRequirement();assert.equal(r.result,'match');assert.equal(r.origin,'pocket_simulation');assert.equal(cs.spec.document.revision,rev);assert.equal(JSON.stringify(cs.lab.garden.attributes('sensor')),before);assert.equal(cs.investigationSnapshot().spec_report_session,true);
});
test('Fehlender gespeicherter Scope erzeugt keinen Ersatzreport',()=>{
 const cs=ready();cs.SetSpecField('scope','/missing');const before=JSON.stringify(cs.spec.document);assert.throws(()=>cs.CheckSpecRequirement());assert.equal(JSON.stringify(cs.spec.document),before);
});
test('Snapshot fehlt/mehrdeutig/gekuerzt/unsafe ergibt unknown',()=>{
 const cs=ready(),r=cs.spec.requirement,p=cs.spec.packet();p.states=[];assert.equal(evaluateAssertion(r,p).result,'unknown');
 p.states=[{id:r.assertion.state_id,value:{type:'number',value:9007199254740992}}];assert.equal(evaluateAssertion(r,p).reason,'value_unavailable');p.states=[...p.states,...p.states];assert.equal(evaluateAssertion(r,p).reason,'state_missing_or_ambiguous');
});
test('Manipulierte Results, Bindungen, Quellen und Requirement-Snapshots zurückweisen',()=>{
 const cs=ready();cs.CheckSpecRequirement();const original=cs.ExportSpec();
 for(const mutate of [d=>d.reports[0].result='mismatch',d=>d.reports[0].requirement_snapshot.title='lie',d=>d.reports[0].source_revision='x',d=>d.evidence[d.reports[0].evidence_id].sources.a='fake',d=>d.reports[0].spec_revision='missing']) {const doc=structuredClone(original);mutate(doc);assert.throws(()=>validateSpec(doc));}
});
test('Historische Requirements bleiben nach Entfernen durch Report erhalten',()=>{
 const cs=ready();cs.CheckSpecRequirement();const old=cs.spec.document.revision,c=structuredClone(cs.spec.current);c.requirements=[];const next=reviseSpec(cs.spec.document,c);assert.ok(next.revisions[old]);assert.equal(next.reports.length,1);
});
test('Reports ändern Soll-Revision nicht; Specänderung macht Report historisch',()=>{
 const cs=ready(),rev=cs.spec.document.revision;cs.CheckSpecRequirement();assert.equal(cs.spec.document.revision,rev);cs.SetSpecField('goal','Neue Änderung');assert.equal(cs.investigationSnapshot().spec_report_current,false);
});

test('Markdown bewahrt Report-Bindungen und damalige Anforderung nach Specänderung',()=>{
 const cs=ready(),report=cs.CheckSpecRequirement(),previous=report.requirement_snapshot.then;
 cs.SetSpecField('goal','Späterer Auftrag');const markdown=cs.ExportSpecMarkdown();
 for(const value of [report.id,report.requirement_id,report.spec_revision,report.evidence_id,report.source_revision,previous])assert.ok(markdown.includes(value),value);
 assert.match(markdown,/historische Spec-Revision/);assert.match(markdown,/Durchführung von Given\/When/);
});
test('Manualreport bleibt not_checked; manipuliertes match verboten',()=>{
 const cs=ready(),r=cs.RecordSpecObservation('Sample gedrückt','Keine Änderung');assert.equal(r.result,'not_checked');const d=cs.ExportSpec();d.reports[0].result='match';assert.throws(()=>validateSpec(d));
});
test('Paket-ID darf nicht mit anderem Inhalt wiederverwendet werden',()=>{
 const cs=ready(),r=cs.CheckSpecRequirement(),p=structuredClone(cs.spec.document.evidence[r.evidence_id]);p.captured.utc='changed';assert.throws(()=>appendReport(cs.spec.document,{...r,id:'second'},p));
});
test('Storage Roundtrip und importierte native Herkunft erzeugen keinen Session-Trust',()=>{
 const store=storage(),cs=ready(store);cs.CheckSpecRequirement();cs.SaveSpec();const doc=cs.ExportSpec();doc.reports[0].origin='native';cs.ImportSpec(JSON.stringify(doc));assert.equal(cs.investigationSnapshot().spec_report_session,false);assert.equal(cs.investigationSnapshot().spec_dirty,true);assert.equal(cs.investigationSnapshot().spec_saved_revision,'');
 const other=app(store).cs;other.LoadSpec(doc.id);assert.equal(other.investigationSnapshot().spec_report_session,false);assert.equal(other.spec.dirty,false);
});
test('Dirty Import/Laden erfordert Verwerfen oder Abbrechen, validiert zuerst',()=>{
 const cs=ready(),previous=canonical(cs.spec.document),other=newSpec('/other','Andere','other');
 assert.equal(cs.ImportSpec(JSON.stringify(other)).pending,true);assert.equal(canonical(cs.spec.document),previous);cs.ConfirmSpecReplace(false);assert.equal(canonical(cs.spec.document),previous);
 assert.throws(()=>cs.ImportSpec('{"schema":"bad"}'));assert.equal(canonical(cs.spec.document),previous);
 cs.ImportSpec(JSON.stringify(other));cs.ConfirmSpecReplace(true);assert.equal(cs.spec.document.id,'other');
});
test('Quota-Fehler lässt Entwurf, Reports und JSON/Markdown-Export intakt',()=>{
 const store={getItem:()=>null,setItem:()=>{throw new Error('QuotaExceededError');}},cs=ready(store);cs.CheckSpecRequirement();const before=canonical(cs.spec.document);assert.throws(()=>cs.SaveSpec());assert.equal(canonical(cs.spec.document),before);assert.equal(cs.spec.savedRevision,'');assert.ok(cs.spec.error.includes('Quota'));assert.equal(cs.ExportSpec().id,cs.spec.document.id);assert.ok(cs.ExportSpecMarkdown().includes('Historisch dokumentiert'));
});
test('Mehr als32Requirements und64Reports verändert Entwurf nicht',()=>{
 const cs=ready();for(let i=1;i<32;i++)cs.AddSpecRequirement('r');const before=canonical(cs.spec.document);assert.throws(()=>cs.AddSpecRequirement('overflow'));assert.equal(canonical(cs.spec.document),before);
 for(let i=0;i<64;i++)cs.RecordSpecObservation('','');const beforeReports=canonical(cs.spec.document);assert.throws(()=>cs.RecordSpecObservation('',''));assert.equal(canonical(cs.spec.document),beforeReports);
});
test('Brief bindet Soll, Requirement und frisches Paket, Analysecache-Eviction verliert keine Specbelege',()=>{
 const cs=ready();const r=cs.CheckSpecRequirement(),brief=cs.SpecBrief();assert.equal(brief.spec_revision,cs.spec.document.revision);assert.equal(brief.requirement_id,cs.spec.selected);assert.ok(brief.prompt.includes('Given/When'));for(let i=0;i<10;i++)cs.refreshAnalysis();assert.ok(cs.spec.document.evidence[r.evidence_id]);
});
test('Public Commands und Snapshot-Keys sind kurskompatibel',()=>{
 const cs=app().cs;cs.command('>spec neu Kurs');cs.command('>spec anforderung Test');cs.command('>spec setzen given Reset');assert.equal(cs.spec.requirement.given,'Reset');const snap=cs.investigationSnapshot();assert.equal(snap['investigation.spec_requirement_count'],1);assert.equal(snap['investigation.spec_view'],true);
});
test('Import mit abweichendem gespeicherten Inhalt erzeugt Kopie statt Überschreiben',()=>{
 const store=storage(),cs=ready(store);cs.SaveSpec();const original=cs.ExportSpec(),c=structuredClone(cs.spec.current);c.goal='Andere Revision';const incoming=reviseSpec(original,c);cs.ImportSpec(JSON.stringify(incoming));assert.notEqual(cs.spec.document.id,original.id);assert.match(cs.spec.importNote,/Kopie/);cs.SaveSpec();const other=app(store).cs;other.LoadSpec(original.id);assert.equal(canonical(other.spec.document),canonical(original));
});
test('Reservierte Object-Keys sind eigene Storage-Keys; Save/Load verliert keine Daten',()=>{
 const store=storage(),cs=app(store).cs;cs.ImportSpec(JSON.stringify(newSpec('/Sensor','Prototype','__proto__')));cs.SaveSpec();assert.equal(cs.spec.dirty,false);const other=app(store).cs;other.LoadSpec('__proto__');assert.equal(other.spec.document.id,'__proto__');assert.equal(other.spec.current.title,'Prototype');
});
test('Großes gültiges kompaktes Dokument bleibt unter Importlimit und Roundtrip-fähig',()=>{
 const cs=ready(),r=cs.CheckSpecRequirement(),doc=cs.ExportSpec(),p=doc.evidence[r.evidence_id];
 for(let i=0;i<45000;i++)p.states.push({id:'extra'+i,value:{type:'bool',value:false}});
 validateSpec(doc);assert.ok(new TextEncoder().encode(JSON.stringify(doc)).length<3500000);assert.ok(new TextEncoder().encode(JSON.stringify(doc,null,2)).length>3500000);
 const other=app().cs;other.ImportSpec(JSON.stringify(doc));const exported=other.ExportSpec();assert.equal(other.clipboard,JSON.stringify(exported));const again=app().cs;again.ImportSpec(other.clipboard);assert.equal(again.spec.document.reports.length,1);
});
test('Ungültiger Frozen-Typ und Getter werden nicht ausgeführt',()=>{
 const cs=ready(),r=cs.spec.requirement,p={states:[{id:r.assertion.state_id,value:{type:[],value:false}}]};assert.equal(evaluateAssertion(r,p).result,'unknown');let called=false;Object.defineProperty(p.states[0].value,'value',{enumerable:true,get(){called=true;return false;}});assert.throws(()=>evaluateAssertion(r,p));assert.equal(called,false);
});
