import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {createApp} from '../js/core/boot.js';
import {renderSpec,bindSpec} from '../js/ui/spec.js';
import {newSpec} from '../js/core/spec-workbench.js';
const data=Object.fromEntries(['course','net','code','ui'].map(k=>[k,JSON.parse(readFileSync(new URL(`../data/${k}.json`,import.meta.url),'utf8'))]));
function setup(storage) {
 const values=new Map();storage ||= {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
 const dom=new JSDOM('<div id="cs"><div id="cs-body"><div id="cs-spec" hidden></div></div></div>',{url:'https://pocket.test'});
 globalThis.window=dom.window;globalThis.document=dom.window.document;
 const {cs}=createApp(data,storage);cs.cs.Analysistarget='/project1/CodeSearch_Tutorial/SignalGarden/Sensor';cs.NewSpec('Sensor');cs.AddSpecRequirement('Schwelle');
 const ctx={cs,render:()=>renderSpec(ctx)};bindSpec(ctx);renderSpec(ctx);
 const el=s=>document.querySelector(s),click=a=>el(`[data-spec-act="${a}"]`).click();
 const input=(selector,value)=>{const node=el(selector);node.focus();node.value=value;node.dispatchEvent(new dom.window.Event('input',{bubbles:true}));return node;};
 const change=(selector,value)=>{const node=el(selector);node.value=value;node.dispatchEvent(new dom.window.Event('change',{bubbles:true}));};
 const state=cs.SpecStates().find(s=>s.name.endsWith('._present'));
 return {dom,cs,ctx,el,click,input,change,state,values};
}
test('Beschriftete Formulare bearbeiten Soll, echte State-Auswahl und Snapshot',()=>{
 const {cs,el,input,change,click,state}=setup();input('#spec-document [data-spec-field="goal"]','Erst bei0.7 eintreten');input('#spec-requirement [data-spec-field="given"]','Reset');change('#spec-state',state.id);input('#spec-expected','false');click('check');
 assert.equal(cs.spec.requirement.given,'Reset');assert.equal(cs.spec.document.reports[0].result,'match');assert.match(el('#spec-reports').textContent,/In dieser Sitzung aufgenommen/);assert.match(el('#cs-spec').textContent,/führt Given\/When nicht aus/);
});
test('iPhone-Eingabe hält DOM-Knoten, Fokus und Scrollposition',()=>{
 const {el,input,ctx}=setup(),node=el('#spec-document [data-spec-field="goal"]'),root=el('#cs-spec');root.scrollTop=240;
 input('#spec-document [data-spec-field="goal"]','Langer Text');ctx.render();assert.equal(el('#spec-document [data-spec-field="goal"]'),node);assert.equal(document.activeElement,node);assert.equal(root.scrollTop,240);
});
test('Ungültige Erwartung bleibt pro Feld erhalten; anderes gültiges Feld erlaubt keinen Save',()=>{
 const {cs,el,input,change,click,state}=setup();change('#spec-state',state.id);input('#spec-expected','false');input('#spec-expected','tru');input('#spec-document [data-spec-field="goal"]','Gültiges Ziel');
 assert.equal(el('#spec-expected').value,'tru');assert.match(el('#spec-error').textContent,/expected_json/);click('save');click('check');click('brief');click('observe');assert.equal(cs.spec.savedRevision,'');assert.equal(cs.spec.document.reports.length,0);assert.equal(cs.spec.briefId,'');
 input('#spec-expected','true');click('save');assert.equal(cs.spec.dirty,false);
});
test('State-Collector läuft nicht auf jedem Keystroke; explizites Aktualisieren funktioniert',()=>{
 const {cs,ctx,input,click}=setup();let captures=0;const original=cs.spec.states.bind(cs.spec);cs.spec.states=()=>{captures++;return original();};
 for(let i=0;i<5;i++)input('#spec-document [data-spec-field="goal"]','Ziel'+i);assert.equal(captures,0);click('refresh');assert.equal(captures,1);ctx.render();assert.equal(captures,1);
});
test('Dirty Import Dialog bietet Verwerfen/Abbrechen und bleibt atomar',()=>{
 const {cs,el,input,click}=setup(),old=cs.spec.document.id;
 input('#spec-import-text',JSON.stringify(newSpec('/other','Andere','other')));click('import');assert.ok(el('[role="alertdialog"]'));assert.equal(cs.spec.document.id,old);click('cancel');assert.equal(cs.spec.document.id,old);
 click('import');click('discard');assert.equal(cs.spec.document.id,'other');assert.equal(cs.investigationSnapshot().spec_report_session,false);
});
test('Auch nur ungültiger Feldentwurf verlangt vor Import Verwerfen oder Abbrechen',()=>{
 const {cs,input,change,click,state,el}=setup();change('#spec-state',state.id);input('#spec-expected','false');click('save');assert.equal(cs.spec.dirty,false);
 input('#spec-expected','tru');assert.equal(cs.spec.dirty,true);input('#spec-import-text',JSON.stringify(newSpec('/other','Andere','other')));click('import');assert.ok(el('[role="alertdialog"]'));click('cancel');assert.equal(el('#spec-expected').value,'tru');assert.notEqual(cs.spec.document.id,'other');
});
test('Quota-Status bleibt sichtbar und nach Freigabe kann Speichern wiederholt werden',()=>{
 let fail=true,value=null;const {cs,el,click}=setup({getItem:()=>value,setItem:(_,v)=>{if(fail)throw new Error('QuotaExceededError');value=v;}});
 click('save');assert.match(el('#spec-error').textContent,/Quota/);assert.equal(cs.spec.dirty,true);fail=false;click('save');assert.equal(cs.spec.dirty,false);assert.match(el('#spec-save-status').textContent,/Gespeichert/);
});
test('Manuelle Beobachtung besitzt keine Bestanden-Schaltfläche',()=>{
 const {cs,input,click,el}=setup();input('#spec-procedure','Reset und Sample');input('#spec-observation','Ausgang blieb false');click('observe');assert.equal(cs.spec.document.reports[0].result,'not_checked');assert.match(el('#spec-reports').textContent,/Nicht geprüft/);assert.equal(el('[data-spec-act="pass"]'),null);
});
test('JSON-Dateiexport ist auch bei Quota-Fehler verfügbar und kompakt',async()=>{
 const {cs,click,dom}=setup({getItem:()=>null,setItem:()=>{throw new Error('Quota');}});const exports=[];const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
 URL.createObjectURL=blob=>{exports.push(blob);return 'blob:spec';};URL.revokeObjectURL=()=>{};dom.window.HTMLAnchorElement.prototype.click=function(){};
 try{click('save');click('json');assert.equal(exports.length,1);assert.equal(await exports[0].text(),JSON.stringify(cs.spec.document));assert.ok(cs.spec.exportId);}finally{URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;}
});
test('44px Targets, 16px Inputs und normaler vertikaler Scroll sind definiert',()=>{
 const css=readFileSync(new URL('../css/app.css',import.meta.url),'utf8');assert.match(css,/\.cs-analysis button\s*\{[^}]*min-height: 44px/s);assert.match(css,/\.cs-spec textarea, \.cs-spec input, \.cs-spec select\s*\{[^}]*font-size: 16px/s);assert.match(css,/\.cs-analysis\s*\{[^}]*overflow-y: auto[^}]*touch-action: pan-y/s);
});
