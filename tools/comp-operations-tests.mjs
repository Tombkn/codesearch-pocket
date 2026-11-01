import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApp} from '../js/core/boot.js';
import {promotionPlan,applyPromotion,showPromotion} from '../js/core/comp-operations.js';
const load=n=>JSON.parse(readFileSync(new URL(`../data/${n}.json`,import.meta.url),'utf8'));
const setup=()=>createApp({course:load('course'),net:load('net'),code:load('code'),ui:load('ui')});
const path='SignalGarden/Sensor';

test('Vorschau nennt unterstützte Controls, Kollisionen und Anzeigen; Abbrechen verändert nichts',()=>{
  const {cs,lab}=setup(),before=JSON.stringify([...cs.net.ops]);showPromotion(cs,path);
  assert.match(cs.state.dialog.lines.join('\n'),/KONFLIKT · Status/);assert.match(cs.state.dialog.lines.join('\n'),/AUSGELASSEN · Present/);
  cs.escape();assert.equal(JSON.stringify([...cs.net.ops]),before);assert.equal(lab.tableUndo.length,0);assert.equal(lab.garden.samples,0);
});
test('Verbunden übernehmen erzeugt sechs Controls ohne Pulse, Werte wirken in beide Richtungen',()=>{
  const {cs,lab,gestures:g}=setup(),result=applyPromotion(cs,promotionPlan(cs,path));assert.equal(result.created,6);assert.equal(lab.garden.samples,0);
  g.gardenPar('root','Value',.8);assert.equal(lab.garden.pars.sensor.Value,.8);
  g.gardenPar('sensor','Value',.3);assert.equal(lab.garden.pars.root.Value,.3);
  g.gardenPulse('root','Sample');assert.equal(lab.garden.samples,1);
  assert.ok(cs.net.edges.some(edge=>edge.kind==='bind'&&edge.src==='SignalGarden'&&edge.dst===path));
});
test('Undo/Redo verwendet eine gemeinsame Reihenfolge mit TABLE und Parameteränderung',()=>{
  const {cs,lab,gestures:g}=setup(),source=JSON.stringify(cs.net.op(path)),parent=JSON.stringify(cs.net.op('SignalGarden'));
  applyPromotion(cs,promotionPlan(cs,path));g.gardenPar('root','Value',.8);lab.editCell(1,1,'0.42');
  cs.undoTD();assert.equal(lab.palette[1][1],'0.95');cs.undoTD();assert.equal(lab.garden.pars.sensor.Value,.2);
  cs.undoTD();assert.equal(JSON.stringify(cs.net.op(path)),source);assert.equal(JSON.stringify(cs.net.op('SignalGarden')),parent);
  assert.ok(!Object.hasOwn(lab.garden.pars.root,'Value'));assert.equal(lab.garden.pars.sensor.Value,.2);
  cs.redoTD();cs.redoTD();assert.equal(lab.garden.pars.sensor.Value,.8);cs.redoTD();assert.equal(lab.palette[1][1],'0.42');
});
test('Gleiche vollständige Verbindung ist No-op und erzeugt keinen zusätzlichen Undo-Schritt',()=>{
  const {cs,lab}=setup();applyPromotion(cs,promotionPlan(cs,path));const count=lab.tableUndo.length;
  const plan=promotionPlan(cs,path);assert.equal(plan.groups.filter(g=>g.outcome==='already_connected').length,6);
  assert.equal(applyPromotion(cs,plan).changed,false);assert.equal(lab.tableUndo.length,count);
});
test('Wertänderung, ausgetauschter Owner und manipulierter Plan werden vor Writes abgewiesen',()=>{
  for(const change of ['value','owner','plan']){
    const {cs,lab}=setup(),plan=promotionPlan(cs,path);
    if(change==='value')lab.garden.pars.sensor.Value=.9;
    if(change==='owner')cs.net.ops.set(path,{...cs.net.op(path)});
    if(change==='plan')plan.groups[0].name='Fremd';
    assert.throws(()=>applyPromotion(cs,plan),/veraltet/);assert.equal(lab.tableUndo.length,0);assert.ok(!Object.hasOwn(lab.garden.pars.root,'Value'));
  }
});
test('DIESE COMP-Menü bleibt am geöffneten COMP gebunden',()=>{
  const {cs,gestures:g}=setup();cs.state.paneOwner=path;g.compMenu();const item=cs.state.menu.items.find(item=>item.label.startsWith('Parameter nach oben'));
  cs.state.paneOwner='BranchLab';item.run();assert.match(cs.state.dialog.lines[0],/SignalGarden\/Sensor/);
});

test('Zwei Promotions zum gleichen Parent lassen sich vollständig rückwärts und vorwärts anwenden',()=>{
  const {cs,lab}=setup(),before=JSON.stringify([...cs.net.ops]);
  applyPromotion(cs,promotionPlan(cs,path));applyPromotion(cs,promotionPlan(cs,'SignalGarden/Scenes'));
  const after=JSON.stringify([...cs.net.ops]);
  assert.equal(lab.undoTable(),true);assert.equal(lab.undoTable(),true);assert.equal(JSON.stringify([...cs.net.ops]),before);
  assert.equal(lab.redoTable(),true);assert.equal(lab.redoTable(),true);assert.equal(JSON.stringify([...cs.net.ops]),after);
});

test('Gesperrter zweiter Parameter verhindert Apply und Undo ohne teilweise Änderungen',()=>{
  for(const undo of [false,true]){
    const {cs,lab}=setup();if(undo)applyPromotion(cs,promotionPlan(cs,path));
    Object.defineProperty(lab.garden.pars.sensor,'Valid',{configurable:false});
    const snapshot=()=>JSON.stringify({ops:[...cs.net.ops],edges:cs.net.edges,pars:lab.garden.pars,bindings:[...(cs.promotedBindings || [])]});
    const before=snapshot(),descriptor=Object.getOwnPropertyDescriptor(lab.garden.pars.sensor,'Value');
    if(undo)assert.equal(lab.undoTable(),false);else assert.throws(()=>applyPromotion(cs,promotionPlan(cs,path)),/gesperrt/);
    assert.equal(snapshot(),before);assert.deepEqual(Object.getOwnPropertyDescriptor(lab.garden.pars.sensor,'Value'),descriptor);
    assert.equal(lab.tableUndo.length,undo?1:0);
  }
});

test('Redo überschreibt keine nachträglich angelegten Zielparameter oder veränderten Quellwerte',()=>{
  for(const where of ['metadata','runtime','source']){
    const {cs,lab}=setup();applyPromotion(cs,promotionPlan(cs,path));assert.equal(lab.undoTable(),true);
    if(where==='metadata')cs.net.op('SignalGarden').pars={Value:{e:'op("new")'}};
    if(where==='runtime')lab.garden.pars.root.Value=.9;
    if(where==='source')lab.garden.pars.sensor.Value=.9;
    const before=JSON.stringify({ops:[...cs.net.ops],pars:lab.garden.pars,edges:cs.net.edges});
    assert.equal(lab.redoTable(),false);assert.equal(JSON.stringify({ops:[...cs.net.ops],pars:lab.garden.pars,edges:cs.net.edges}),before);
  }
});
