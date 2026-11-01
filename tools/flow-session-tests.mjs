import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApp} from '../js/core/boot.js';
import {buildFlow} from '../js/core/views/netviews.js';
const load=n=>JSON.parse(readFileSync(new URL(`../data/${n}.json`,import.meta.url),'utf8'));
const setup=()=>createApp({course:load('course'),net:load('net'),code:load('code'),ui:load('ui')});

test('Fixierter FLOW erhält Ziel, Scope und Filter bei Auswahl, Netzwerk- und Tabwechsel',()=>{
  const {cs,gestures:g}=setup();cs.OpenAt('chain',{target:'BranchLab/control',scope:'BranchLab'});cs.flowFilter('direction','down');cs.flowPin(true);
  const rows=JSON.stringify(cs.state.hits),scope=JSON.stringify(cs.state.flow.scope);
  g.netEnter('SignalGarden');g.netSelect('SignalGarden/Sensor');cs.cs.Scope='project';cs.SetMode('search');cs.SetMode('chain');
  assert.equal(cs.flowTarget(),'BranchLab/control');assert.equal(JSON.stringify(cs.state.hits),rows);assert.equal(JSON.stringify(cs.state.flow.scope),scope);assert.equal(cs.state.flow.filters.direction,'down');
});
test('Projektänderung erscheint bei Fixierung erst nach Aktualisieren; Story nutzt denselben Stand',()=>{
  const {cs}=setup();cs.OpenAt('chain',{target:'BranchLab/control',scope:'BranchLab'});cs.flowPin(true);
  const edge={src:'BranchLab/control',dst:'BranchLab/new_reader',kind:'expr',par:'value'};
  cs.net.ops.set(edge.dst,{path:edge.dst,parent:'BranchLab',name:'new_reader',family:'TOP',type:'nullTOP',pars:{}});cs.net.edges.push(edge);
  cs.rebuild();assert.ok(!cs.state.hits.some(h=>h.path.endsWith('/new_reader')));cs.command('story');assert.ok(!cs.clipboard.includes('new_reader'));
  cs.flowRefresh();assert.ok(cs.state.hits.some(h=>h.path.endsWith('/new_reader')));cs.command('story');assert.match(cs.clipboard,/new_reader/);
});
test('Scope begrenzt nachgelagerte Parameterleser, Kabel bleiben bereichsübergreifend',()=>{
  const {cs}=setup();const source='BranchLab/control';
  cs.net.edges.push({src:source,dst:'SignalGarden/Sensor',kind:'expr',par:'Value'},{src:source,dst:'SignalGarden/Output/out1',kind:'wire'});
  const flow=buildFlow(cs,source,{root:'BranchLab',flat:false,includeSys:false});
  assert.ok(!flow.down.some(h=>h.path==='SignalGarden/Sensor'));assert.ok(flow.down.some(h=>h.path==='SignalGarden/Output/out1'));
});
test('Zweite Pane verändert weder Hauptnetz noch Auswahl; wiederholtes Öffnen verwendet denselben State',()=>{
  const {cs}=setup();cs.OpenAt('chain',{target:'BranchLab/control'});cs.flowPin(true);
  const before=JSON.stringify({owner:cs.state.paneOwner,focus:cs.state.focus,selected:cs.state.networkSelected,rows:cs.state.hits}),pane=cs.state.secondaryPane;
  cs.openNetworkPane('SignalGarden/Sensor');cs.secondaryNetwork('enter','SignalGarden/Sensor');cs.secondaryNetwork('select','SignalGarden/Sensor/SensorExt');cs.secondaryNetwork('up');
  cs.openNetworkPane('StateLab');assert.equal(cs.state.secondaryPane,pane);
  assert.equal(JSON.stringify({owner:cs.state.paneOwner,focus:cs.state.focus,selected:cs.state.networkSelected,rows:cs.state.hits}),before);
});
test('Explizites neues Ziel ersetzt Pin; gelöschtes Ziel zeigt Fehler statt fremder Strecke',()=>{
  const {cs}=setup();cs.OpenAt('chain',{target:'BranchLab/control'});cs.flowPin(true);cs.OpenAt('chain',{target:'SignalGarden/Sensor'});assert.equal(cs.flowTarget(),'SignalGarden/Sensor');
  cs.fieldEnter('BranchLab/control');assert.equal(cs.flowTarget(),'BranchLab/control');
  cs.net.ops.delete('BranchLab/control');cs.flowRefresh();assert.match(cs.state.hits[0].text,/nicht mehr vorhanden/);assert.equal(cs.state.hits.filter(h=>h.kind==='chain').length,0);
  cs.flowPin(false);cs.OpenAt('chain',{target:'SignalGarden/Sensor'});cs.flowRefresh();assert.equal(cs.state.flow.anchor,'SignalGarden/Sensor');
});

test('COMP-Kontext erhält NUR und ausdrückliche Ziele wechseln vollständig zu AUSWAHL',()=>{
  const {cs}=setup();cs.OpenAt('chain',{target:'BranchLab'});cs.state.context='comp';cs.cs.Scope='currentflat';cs.flowPin(true);assert.equal(cs.state.flow.scope.flat,true);
  cs.flowPin(false);cs.OpenAt('chain',{target:'BranchLab/control'});assert.equal(cs.state.context,'selection');assert.equal(cs.flowTarget(),'BranchLab/control');
  cs.flowPin(true);const index=cs.state.hits.findIndex(h=>h.kind==='chain'&&h.dist>0),target=cs.state.hits[index].path;
  cs.ctrlEnter(index);assert.equal(cs.state.targets[0],target);assert.equal(cs.state.history.at(-1).focus,cs.flowTarget());
});
test('Fixierter FLOW behält die ausgewählte Station bei Followselection',()=>{
  const {cs}=setup();cs.OpenAt('chain',{target:'BranchLab/control'});cs.cs.Followselection=true;cs.flowPin(true);
  const index=cs.state.hits.findIndex(h=>h.kind==='chain'&&h.dist>0);cs.select(index);const row=cs.selectedHit;
  cs.networkSelect('SignalGarden/Sensor');assert.equal(cs.selectedHit,row);assert.equal(cs.state.selected,index);
});
