import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApp} from '../js/core/boot.js';
import {selectedHits} from '../js/core/multi-selection.js';
const load=n=>JSON.parse(readFileSync(new URL(`../data/${n}.json`,import.meta.url),'utf8'));
function setup(){const app=createApp({course:load('course'),net:load('net'),code:load('code'),ui:load('ui')});app.cs.OpenAt('map',{target:'StateLab'});return app;}
const row=(cs,name)=>cs.state.hits.findIndex(h=>h.ctx===name&&h.kind==='method');

test('Ctrl-Klick fügt einzelne Methoden hinzu und entfernt sie wieder ohne Nachbarzeilen',()=>{
  const {cs}=setup(),fire=row(cs,'Fire'),mutate=row(cs,'Mutate'),notify=row(cs,'Notify');assert.ok(fire>=0&&mutate>=0&&notify>=0);
  cs.select(fire);cs.select(notify,{ctrl:true});assert.deepEqual(selectedHits(cs).map(h=>h.ctx),['Fire','Notify']);
  cs.select(fire,{ctrl:true});assert.deepEqual(selectedHits(cs).map(h=>h.ctx),['Notify']);
  cs.select(notify,{ctrl:true});assert.equal(selectedHits(cs).length,0);assert.equal(cs.state.selected,-1);
  cs.select(fire);cs.select(notify,{ctrl:true});cs.select(notify,{ctrl:true});assert.equal(cs.state.codeView.focus,'Fire');
});
test('Copy umfasst nur ausgewählte Methoden, mit Source und begrenzter Analyseaussage',()=>{
  const {cs}=setup();cs.select(row(cs,'Fire'));cs.select(row(cs,'Notify'),{ctrl:true});
  cs.selectionCopy('code');assert.match(cs.clipboard,/def Fire\(/);assert.match(cs.clipboard,/def Notify\(/);assert.doesNotMatch(cs.clipboard,/def Mutate\(/);assert.match(cs.clipboard,/Source-Zeilen/);
  cs.selectionCopy('paths');assert.match(cs.clipboard,/StateLabExt/);assert.match(cs.clipboard,/Notify/);
  cs.selectionCopy('analysis');assert.match(cs.clipboard,/kein vollständiges Projekt/);assert.match(cs.clipboard,/Pocket/);
  cs.ctrlC();assert.match(cs.clipboard,/Fire/);assert.match(cs.clipboard,/Notify/);
});
test('Rechtsklick auf ausgewählten Eintrag erhält die gesamte Auswahl',()=>{
  const {cs,gestures:g}=setup();cs.select(row(cs,'Fire'));cs.select(row(cs,'Notify'),{ctrl:true});g.rowMenu(row(cs,'Fire'));
  assert.equal(selectedHits(cs).length,2);assert.match(cs.state.menu.title,/2 Einträge/);assert.ok(cs.state.menu.items.some(i=>i.label.includes('Quellcode')));
});
test('Rebuild bindet Auswahl an Einträge statt an alte Zeilennummern',()=>{
  const {cs}=setup();cs.select(row(cs,'Fire'));cs.select(row(cs,'Notify'),{ctrl:true});const old=[...cs.state.hits];
  cs._build=()=>({rows:[{kind:'notice',text:'Neue Information'},...old]});cs.rebuild();assert.deepEqual(selectedHits(cs).map(h=>h.ctx),['Fire','Notify']);
  cs._build=()=>({rows:old.filter(h=>h.ctx!=='Notify')});cs.rebuild();assert.deepEqual(selectedHits(cs).map(h=>h.ctx),['Fire']);
});
test('Mobiler Auswahlmodus führt beim Antippen keine Methode aus',()=>{
  const {cs,gestures:g,lab}=setup();cs.state.multiSelect=true;const count=lab.stateLab.count;
  g.tapRow(row(cs,'Fire'));g.tapRow(row(cs,'Notify'));assert.equal(selectedHits(cs).length,2);assert.equal(lab.stateLab.count,count);
  g.tapRow(row(cs,'Fire'));assert.deepEqual(selectedHits(cs).map(h=>h.ctx),['Notify']);
});
