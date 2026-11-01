// Echte Modellaktionen; kein physischer Keyboard- oder Safari-Test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApp} from '../js/core/boot.js';
const load=name=>JSON.parse(readFileSync(new URL(`../data/${name}.json`,import.meta.url),'utf8'));
const data={course:load('course'),net:load('net'),code:load('code'),ui:load('ui')};
const setup=()=>createApp(data);
const palette='BranchLab/ColorEngine/palette', colors='SignalGarden/Palette/colors';

test('TABLE Undo/Redo folgt Änderungen über beide Tabellen, unabhängig von der aktuellen Auswahl',()=>{
  const {cs,lab,gestures:g}=setup();
  const a=lab.palette[1][1],b=lab.garden.table[1][1];
  cs.state.table.path=palette;g.tableEdit(1,1,'0.11');
  cs.state.table.path=colors;g.tableEdit(1,1,'0.22');
  cs.state.focus='StateLab';g.key('Ctrl+Z');assert.equal(lab.garden.table[1][1],b);assert.equal(lab.palette[1][1],'0.11');
  g.key('Ctrl+Z');assert.equal(lab.palette[1][1],a);
  g.key('Ctrl+Y');assert.equal(lab.palette[1][1],'0.11');
  g.key('Ctrl+Shift+Z');assert.equal(lab.garden.table[1][1],'0.22');
});
test('Neue Änderung verwirft Redo; identische Werte und ungültige Zellen erzeugen keinen Schritt',()=>{
  const {cs,lab,gestures:g}=setup();cs.state.table.path=palette;
  const before=lab.palette[1][1];g.tableEdit(1,1,before);assert.equal(lab.tableUndo.length,0);
  assert.equal(lab.editCell(-1,2,'x'),false);assert.equal(lab.editCell(1,900,'x'),false);
  g.tableEdit(1,1,'0.1');g.key('Ctrl+Z');g.tableEdit(1,2,'0.2');
  g.key('Ctrl+Y');assert.equal(lab.palette[1][1],before);assert.match(cs.state.status,/Keine/);
});
test('Strukturaktionen und geschriebene Sortierung sind jeweils ein Undo-Schritt',()=>{
  for(const label of ['Zeile einfügen','Zeile löschen','Spalte einfügen','Spalte löschen','Sortierung in']) {
    const {cs,lab,gestures:g}=setup();cs.state.table.path=palette;
    const before=structuredClone(lab.palette);cs.tableSort(0);cs.tableMenu(1,1);g.menu(label);
    if(cs.state.dialog)g.key('Enter');
    const after=structuredClone(lab.palette);assert.notDeepEqual(after,before,label);
    assert.equal(lab.tableUndo.length,1,label);g.key('Ctrl+Z');assert.deepEqual(lab.palette,before,label);
    g.key('Ctrl+Y');assert.deepEqual(lab.palette,after,label);
  }
});
test('Unabhängige neue Tabellendaten werden nicht von einem alten Undo überschrieben',()=>{
  const {lab}=setup();lab.editCell(1,1,'0.1');lab.setPalette('empty');
  assert.equal(lab.undoTable(),false);assert.equal(lab.palette.length,1);assert.match(lab.tableHistoryError,/inzwischen/);
});
test('DIESE COMP nimmt den offenen Owner, erhält Auswahl und Analyse-Pin',()=>{
  for(const mode of ['trace','refs','chain']) {
    const {cs,gestures:g}=setup();cs.state.focus='BranchLab/control';cs.state.targets=['/unverändert'];cs.cs.Analysistarget='/project1/CodeSearch_Tutorial/StateLab';
    cs.net.edges=[...cs.net.edges,
      {src:'SignalGarden',dst:'BranchLab/level_expr',kind:'expr',par:'opacity',text:'DIRECT_GARDEN'},
      {src:'SignalGarden/Sensor',dst:'BranchLab/level_expr',kind:'expr',par:'opacity',text:'CHILD_ONLY'},
      {src:'BranchLab',dst:'BranchLab/level_export',kind:'expr',par:'opacity',text:'DIRECT_BRANCH'},
      {src:'BranchLab/control',dst:'BranchLab/switch_route',kind:'expr',par:'index',text:'DIRECT_SELECTION'}];
    cs.state.paneOwner='SignalGarden';cs.cs.Scope='project';cs.SetMode(mode);g.context('comp');
    const shared={focus:cs.state.focus,targets:[...cs.state.targets],pin:cs.cs.Analysistarget};
    const expectTarget=(path,marker)=>mode==='refs'
      ? assert.ok(cs.state.hits.some(h=>h.text.includes(marker)),marker)
      : assert.equal(cs.state.hits[0].path,'/project1/CodeSearch_Tutorial/'+path,mode);
    assert.equal(cs.scopeRoot(),'');expectTarget('SignalGarden','DIRECT_GARDEN');
    if(mode==='refs')assert.ok(!cs.state.hits.some(h=>h.text.includes('CHILD_ONLY')));
    g.netEnter('BranchLab');expectTarget('BranchLab','DIRECT_BRANCH');
    assert.deepEqual({focus:cs.state.focus,targets:cs.state.targets,pin:cs.cs.Analysistarget},shared);
    g.context('selection');expectTarget('BranchLab/control','DIRECT_SELECTION');
  }
});
test('Gelöschter COMP fällt nicht auf eine alte Auswahl oder Analyse-Pin zurück',()=>{
  const {cs,gestures:g}=setup();cs.SetMode('trace');g.context('comp');g.netEnter('nicht_da');
  assert.match(cs.state.hits[0].text,/nicht mehr vorhanden/);
});


test('COMP STRUCTURE und AUDIT sammeln nur aktuelle Nachfahren trotz fremdem Pin',()=>{
  const {cs,gestures:g}=setup();cs.cs.Analysistarget='/project1/CodeSearch_Tutorial/StateLab';cs.state.focus='BranchLab';cs.state.paneOwner='SignalGarden';
  cs.SetMode('map');g.context('comp');
  for(const name of ['SensorExt','SceneControllerExt','PaletteExt'])assert.ok(cs.state.hits.some(h=>h.path.includes(name)),name);
  assert.ok(!cs.state.hits.some(h=>h.path.includes('StateLab')));
  assert.ok(!cs.state.hits.some(h=>['SAVEMAP','LANDKARTE','CONTEXT'].includes(h.action_key)));
  const free=cs.state.meta.sources.modules[0];assert.ok(free);
  const open=cs.state.hits.findIndex(h=>h.action_key==='OPENCONTEXTSOURCE' && h.path.endsWith('/'+free));
  cs.activate(open);assert.equal(cs.state.context,'selection');assert.equal(cs.codeTargetPath(),free);assert.ok(cs.state.hits.every(h=>!h.path || h.path.endsWith('/'+free)));
  g.context('comp');cs.SetMode('check');assert.ok(cs.state.hits.some(h=>h.detail.includes('Abdeckungslücke')));
  assert.ok(!cs.state.hits.some(h=>h.text.includes('keine toten Binds')));assert.ok(!cs.state.hits.some(h=>h.path.includes('StateLab')));
});
