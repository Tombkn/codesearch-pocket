// Modell- und DOM-Gegenproben; kein physischer Safari-/Wischtest.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {createApp} from '../js/core/boot.js';
import {renderFloats} from '../js/ui/layers.js';
import {openCopy,captureCode} from '../js/core/float-copies.js';
import {applyLook} from '../js/ui/looks.js';
import {syncFloatFocus, trapFloatTab} from '../js/ui/float-focus.js';
import {horizontalScroller, shiftWheelHorizontal} from '../js/ui/wheel.js';

const load = name => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url),'utf8'));
const data = {course:load('course'),net:load('net'),code:load('code'),ui:load('ui')};
const setup = () => createApp(data);
function dom(app) {
  const page = new JSDOM('<body><div id="floats"></div></body>');
  globalThis.document = page.window.document;
  const ctx = {cs:app.cs,ui:data.ui,g:{mods:{}},tour:app.tour,layers:{},td:{open:false}};
  return {page,ctx,render:() => renderFloats(ctx)};
}

test('Code bleibt eingefroren nach Quelländerung und unabhängig von aktueller Auswahl', () => {
  const {cs,lab} = setup();
  cs.state.codeView = {path:'BranchLab/experiment_script',line:1};
  const f=openCopy(cs,'code','side',captureCode(cs,'BranchLab/experiment_script',1));
  const text=f.text;
  lab.script='throw new Error("neuer Stand")';
  cs.state.codeView={path:'nicht_mehr_vorhanden',line:500};
  const {render}=dom({cs}); render();
  assert.equal(f.text,text);
  assert.equal(document.querySelectorAll('[data-id],[data-detail],[data-act]').length,0);
  assert.ok(document.querySelector('.code').textContent.includes(f.code.lines[0]));
  assert.ok(!document.querySelector('.code').textContent.includes('neuer Stand'));
});

test('Live-Liste folgt aktuellen Informationen und erzeugt Originalaktionen mit eindeutigen IDs',()=>{
  const {cs}=setup();cs.state.hits=[{kind:'code',text:'zuerst',ctx:'Run()',path:'/alt',hitkind:'CODE'}];
  const f=cs.floatList();const {render}=dom({cs});render();
  cs.state.hits[0].text='verändert';render();
  assert.ok(f.text.includes('verändert'));assert.ok(document.querySelector('[data-row="0"]').textContent.includes('verändert'));
  cs.floatList();render();const ids=[...document.querySelectorAll('[id]')].map(el=>el.id);assert.equal(new Set(ids).size,ids.length);
  assert.equal(document.querySelectorAll('[data-act="analysis"]').length,2);
});

test('Groß/Klein verändert weder Hauptansicht noch Daten und öffnet nur ein großes Fenster', () => {
  const {cs}=setup(); const a=cs.floatList(), b=cs.floatList();
  const previous={mode:cs.state.mode,focus:cs.state.focus,view:cs.state.view};
  const content=a.text;
  cs.floatSize(a.id,'full'); cs.floatSize(b.id,'full');
  assert.equal(a.size,'side'); assert.equal(b.size,'full');
  cs.floatSize(b.id,'side'); cs.floatClose(b.id);
  assert.deepEqual({mode:cs.state.mode,focus:cs.state.focus,view:cs.state.view},previous);
  assert.equal(a.text,content);
  assert.equal(cs.state.floats.length,1);
});

test('Ctrl+C folgt der gemeinsamen Auswahl und aktuellem Code',()=>{
  const {cs,gestures:g}=setup();cs.state.hits=[{kind:'code',text:'line',ctx:'Run()'}];
  const f=cs.floatList();g.key('Ctrl+C');assert.equal(cs.clipboard,f.text);
  cs.select(0);const original=cs.ctrlC.bind(cs);let calls=0;cs.ctrlC=()=>{calls++;original();};
  g.key('Ctrl+C');assert.equal(calls,1);
  cs.state.codeView={path:'BranchLab/experiment_script',line:1};const code=cs.floatCopy('code');
  g.key('Ctrl+C');assert.equal(cs.clipboard,code.text);
});

test('Lookwechsel und unverändertes Rendern erhalten Inhalt und Scrollposition', () => {
  const app=setup(); app.cs.state.hits=Array.from({length:70},(_,i)=>({kind:'code',text:'Zeile '+i}));
  const f=app.cs.floatList(); const {render}=dom(app); render();
  const body=document.querySelector('.fb'); body.scrollTop=180;
  const text=f.text;
  const keys=Object.keys(data.ui.CODESEARCH_LOOKS);
  applyLook(document.body,data.ui,keys[0]); const color=document.body.style.getPropertyValue('--panel');
  applyLook(document.body,data.ui,keys.find(k=>data.ui.CODESEARCH_LOOKS[k][8])); render();
  assert.notEqual(document.body.style.getPropertyValue('--panel'),color);
  assert.equal(document.querySelector('.fb'),body);
  assert.equal(body.scrollTop,180);
  app.cs.floatSize(f.id,'full'); render();
  assert.equal(document.querySelector('.fb').scrollTop,180);
  assert.equal(f.text,text);
  assert.ok(document.querySelector('[data-fsize]'));
});

test('Analyse- und Speckopie erfassen nichts neu und verändern den Entwurf nicht', () => {
  const {cs}=setup(); cs.analysis();
  const before=JSON.stringify(cs.state.inv.analysis);
  const f=cs.floatCopy('analysis');
  assert.ok(f.text.includes(cs.state.inv.analysis.packetId));
  assert.equal(JSON.stringify(cs.state.inv.analysis),before);
  cs.NewSpec('Mein Ziel'); const doc=JSON.stringify(cs.spec.document), dirty=cs.spec.dirty;
  const clipboard=cs.clipboard;
  const spec=cs.floatCopy('spec');
  assert.match(spec.text,/Mein Ziel/);
  assert.equal(JSON.stringify(cs.spec.document),doc); assert.equal(cs.spec.dirty,dirty);
  assert.equal(cs.clipboard,clipboard);
});

test('Leere Fehleransicht erfindet keinen Fehlerbericht', () => {
  const {cs}=setup(); cs.state.mode='errors'; cs.state.hits=[];
  assert.equal(cs.floatCopy('errors').text,'Keine Fehler in dieser Ansicht.');
});

test('Netzwechsel zieht aktuellen Suchbereich nach, erhält GLOBAL, IN und gebundene Analyse', () => {
  const {cs,gestures:g}=setup();
  cs.setScope('currentpane'); let calls=0; const rebuild=cs.rebuild.bind(cs);
  cs.rebuild=()=>{calls++; return rebuild();};
  g.netEnter('SignalGarden'); assert.equal(cs.scopeRoot(),'SignalGarden'); assert.equal(calls,1);
  cs.cs.Scope='project'; g.netEnter('BranchLab'); assert.equal(cs.scopeRoot(),''); assert.equal(calls,1);
  cs.cs.Scope='comp'; cs.cs.Scopecomp='/project1/CodeSearch_Tutorial/SignalGarden';
  g.netEnter('BranchLab'); assert.equal(cs.scopeRoot(),'SignalGarden');
  cs.analysis(); const packet=cs.state.inv.analysis.packetId;
  cs.cs.Scope='currentpane'; calls=0; g.netEnter('SignalGarden');
  assert.equal(calls,0); assert.equal(cs.state.view,'analysis'); assert.equal(cs.state.inv.analysis.packetId,packet);
});

test('Livefenster führt Originalaktionen auch bei geschlossenem Hauptfenster aus; Esc schließt nur dieses Fenster',()=>{
  const {cs,gestures:g}=setup();const f=cs.floatList();let activated=0;
  cs.state.mainopen=false;cs.state.selected=0;cs.activate=()=>activated++;cs.ctrlEnter=()=>activated++;cs.impact=()=>activated++;
  g.key('Enter');g.key('Ctrl+Enter');g.key('Ctrl+I');assert.equal(activated,3);
  g.key('Esc');assert.equal(cs.state.mainopen,false);assert.ok(!cs.state.floats.includes(f));
});

test('Große Lesekopie hält Fokus und Tab, Klein stellt den ursprünglichen Fokus wieder her', () => {
  const app=setup(), {ctx,render,page}=dom(app);
  const main=document.createElement('div');main.id='app';main.innerHTML='<button>Hauptansicht</button>';document.body.prepend(main);
  const original=main.firstChild;original.focus();
  const f=app.cs.floatList('full');render();syncFloatFocus(ctx);
  assert.equal(main.inert,true);assert.equal(document.activeElement.closest('[data-float]').dataset.float,f.id);
  const controls=[...document.querySelectorAll('.float button:not([disabled]),.float input,.float [tabindex="0"]')].filter(el=>!el.closest('[hidden]') && !el.closest('.cs-scopes[style*="none"]')); controls.at(-1).focus();
  const ev=new page.window.KeyboardEvent('keydown',{key:'Tab',cancelable:true});
  assert.equal(trapFloatTab(ctx,ev),true);assert.equal(document.activeElement,controls[0]);
  app.cs.floatSize(f.id,'side');render();syncFloatFocus(ctx);
  assert.equal(main.inert,false);assert.equal(document.activeElement,original);
});

test('Kopienzoom erreicht Inhalt und bleibt bei wiederholten Tasten lesbar begrenzt', () => {
  const app=setup(), f=app.cs.floatList();
  for(let i=0;i<40;i++)app.gestures.key('Ctrl+Plus');
  assert.equal(f.zoom,2.5);
  dom(app).render();assert.equal(document.querySelector('.float').style.getPropertyValue('--copy-zoom'),'2.5');
  for(let i=0;i<40;i++)app.gestures.key('Ctrl+Minus');
  assert.ok(Math.abs(f.zoom-0.25)<1e-9, 'Fensterzoom reicht bis 25 %');
  app.gestures.key('Alt+0');assert.equal(f.zoom,1);
});

test('Definitionsfenster benennt die Methode und öffnet die aktuelle Definition', () => {
  const {cs}=setup(), f=cs.floatDefinition('StateLab/StateLabExt','_finish');
  assert.match(f.title,/Definition · _finish/);
  assert.ok(f.text.includes('def _finish'));
  assert.equal(cs.state.codeView.line,cs.net.member('StateLab/StateLabExt','_finish').line);assert.equal(f.live,true);
});

test('Shift+Mausrad scrollt nur den Bereich unter dem Zeiger waagerecht', () => {
  const page=new JSDOM('<div id="detail"><div id="code"><pre id="line">x</pre></div></div><div id="list"></div>');
  const d=page.window.document, styles={code:'auto',detail:'hidden',list:'auto',line:'visible'};
  const styleOf=node=>({overflowX:styles[node.id]||'visible'});
  for(const [id,sw,cw] of [['code',900,300],['detail',300,300],['list',800,300]])Object.defineProperties(d.getElementById(id),{scrollWidth:{value:sw},clientWidth:{value:cw}});
  assert.equal(horizontalScroller(d.getElementById('line'),styleOf).id,'code');
  let prevented=0;
  const wheel=(target,extra)=>({target,deltaX:0,deltaY:40,shiftKey:true,ctrlKey:false,metaKey:false,altKey:false,preventDefault(){prevented++;},...extra});
  assert.equal(shiftWheelHorizontal(wheel(d.getElementById('line')),styleOf),true);
  assert.equal(d.getElementById('code').scrollLeft,40);assert.equal(d.getElementById('list').scrollLeft,0);assert.equal(prevented,1);
  assert.equal(shiftWheelHorizontal(wheel(d.getElementById('line'),{shiftKey:false}),styleOf),false);
  assert.equal(shiftWheelHorizontal(wheel(d.getElementById('detail')),styleOf),false,'ohne waagerechten Überstand bleibt das Rad beim Browser');
  assert.equal(prevented,1);
});

test('Liste und Details geben Rad-Enden nicht an äußere Bereiche weiter', () => {
  const css=readFileSync(new URL('../css/app.css', import.meta.url),'utf8');
  for(const selector of ['.cs-list','.cs-detail'])assert.match(css,new RegExp(selector.replace('.','\.')+' \{[^}]*overscroll-behavior: contain'));
  assert.match(css,/\.code-viewport \{[^}]*overscroll-behavior: contain/);
});

test('Eingabefelder sind in jedem Look sichtbar abgesetzt (Feldfarbe und Akzentrahmen)', async () => {
  const {lookVariables}=await import('../js/ui/looks.js');
  const parse=value=>value.match(/\d+/g).slice(0,3).map(Number);
  for(const [key,palette] of Object.entries(data.ui.CODESEARCH_LOOKS)){
    const vars=lookVariables(palette);
    assert.ok(vars['--field'] && vars['--field-line'], key);
    const field=parse(vars['--field']), panel=parse(vars['--panel']);
    assert.ok(field.reduce((sum,v,i)=>sum+Math.abs(v-panel[i]),0) > 10, `${key}: Feld hebt sich von der Fläche ab`);
  }
  const css=readFileSync(new URL('../css/app.css', import.meta.url),'utf8');
  for(const selector of ['.cs-field input','.quick .qf input','.cs-analysis textarea','.popup textarea'])
    assert.ok(css.split(selector+' {').slice(1).some(rest=>rest.split('}')[0].includes('background: var(--field)')),selector);
});
