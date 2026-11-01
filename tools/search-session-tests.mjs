import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApp} from '../js/core/boot.js';
import {buildSearch} from '../js/core/views/search.js';
import {RegexQueue} from '../js/core/regex-queue.js';
const load=n=>JSON.parse(readFileSync(new URL(`../data/${n}.json`,import.meta.url),'utf8'));
const setup=()=>createApp({course:load('course'),net:load('net'),code:load('code'),ui:load('ui')});

test('Hauptsuche und drei zusätzliche Suchfenster haben getrennte Queries, Scopes und Filter',()=>{
  const {cs}=setup();cs.cs.Scope='project';cs.state.query='gain';cs.rebuild();
  const original=JSON.stringify({hits:cs.state.hits,query:cs.state.query,pars:cs.cs});
  const a=cs.quickOpen();cs.quickSearch('Sample');cs.quickScope('comp:SignalGarden');cs.quickFilter('code');
  const b=cs.quickOpen(true);cs.quickSearch('gain');cs.quickScope('comp:BranchLab');cs.quickFilter('par');
  const c=cs.quickOpen(true);cs.quickSearch('Fire');cs.quickScope('comp:StateLab');
  assert.equal(cs.state.searchWindows.filter(q=>q.open).length,3);
  while(cs.state.searchWindows.filter(q=>q.open).length<9)assert.ok(cs.quickOpen(true),'bis zu zehn Suchfenster');
  assert.equal(cs.quickOpen(true),null);
  assert.equal(a.query,'Sample');assert.equal(a.scopeRoot,'SignalGarden');assert.equal(a.filter,'code');
  assert.equal(b.query,'gain');assert.equal(b.scopeRoot,'BranchLab');assert.equal(b.filter,'par');
  assert.equal(c.query,'Fire');assert.equal(c.scopeRoot,'StateLab');
  assert.equal(JSON.stringify({hits:cs.state.hits,query:cs.state.query,pars:cs.cs}),original);
});

test('Gleicher Bereich verwendet denselben Index über unterschiedliche Suchfenster',()=>{
  const {cs}=setup();cs.cs.Scope='project';cs.state.query='gain';cs.rebuild();const builds=cs.searchIndexBuilds;
  const first=cs.quickOpen();cs.quickSearch('Sample');const key=first.indexKey;
  const second=cs.quickOpen(true);cs.quickSearch('Fire');
  assert.equal(second.indexKey,key);assert.equal(cs.searchIndexBuilds,builds);assert.equal(cs.searchIndexCache.size,1);
  cs.quickSearch('nothing');assert.equal(cs.searchIndexBuilds,builds);
  cs.lab.editCell(1,1,'unique-current-table');cs.quickSearch('unique-current-table');
  assert.equal(cs.searchIndexBuilds,builds+1);assert.ok(second.hits.some(h=>h.text.includes('unique-current-table')));
});

test('Bewusste Übergabe überträgt alle Suchoptionen, die normale Auswahl verändert Main nicht',()=>{
  const {cs}=setup();const q=cs.quickOpen();cs.quickScope('flat:SignalGarden');q.caseSensitive=true;q.includeTables=false;q.filter='code';q.maxResults=50;
  cs.quickSearch('Submit');const index=q.hits.findIndex(h=>h.kind==='code');assert.ok(index>=0);
  cs.quickSelect(index);assert.notEqual(cs.state.query,q.query);
  cs.quickToMain(index);assert.equal(cs.state.query,'Submit');assert.equal(cs.scopeRoot(),'SignalGarden');assert.equal(cs.cs.Scope,'currentflat');
  assert.equal(cs.cs.Casesensitive,true);assert.equal(cs.cs.Includetables,false);assert.equal(cs.cs.Searchfilter,'code');assert.equal(cs.cs.Maxresults,50);
});

test('Scope bleibt nach Netzwerkwechsel gebunden, Schließen und erneutes Öffnen erzeugt keinen vierten Nebenindex',()=>{
  const {cs,gestures:g}=setup();cs.cs.Scope='currentpane';cs.state.paneOwner='BranchLab';const q=cs.quickOpen();
  cs.quickSearch('gain');g.netEnter('SignalGarden');cs.quickSearch('gain');assert.equal(q.scopeRoot,'BranchLab');
  cs.quickClose();const reopened=cs.quickOpen();assert.equal(reopened,q);assert.equal(reopened.query,'gain');
  cs.quickOpen(true);cs.quickOpen(true);cs.quickClose(q.id);cs.quickOpen(true);assert.equal(cs.state.searchWindows.length,3);
});

test('Ungültiger Regex und zu lange Query sind sichtbare Fehler ohne falsche Treffer',()=>{
  const {cs}=setup();const bad=buildSearch(cs,{query:'[',regex:true});assert.ok(bad.error);assert.equal(bad.total,0);
  const long=buildSearch(cs,{query:'a'.repeat(513)});assert.match(long.error,/lang/);
});


test('Neue Suche in geschlossenem Slot übernimmt aktuellen Scope; Tastatur bleibt in ihrer Liste',()=>{
  const {cs,gestures:g}=setup();cs.cs.Scope='currentpane';cs.state.paneOwner='BranchLab';const q=cs.quickOpen();cs.quickClose();
  cs.state.paneOwner='SignalGarden';assert.equal(cs.quickOpen(true).scopeRoot,'SignalGarden');cs.quickSearch('Sample');
  const main=cs.state.selected;g.key('Down');assert.ok(q.selected>=0);assert.equal(cs.state.selected,main);
  g.key('Ctrl+C');assert.ok(cs.clipboard.includes('Sample'));g.key('Esc');assert.equal(q.open,false);
});

test('Abgebrochene Regex-Suche startet beim Wiederöffnen neu; alle Fenster schließen beendet alle Jobs',()=>{
  const {cs}=setup(),workers=[];globalThis.window={};
  cs.regexQueue=new RegexQueue(()=>{const worker={postMessage(){},terminate(){this.stopped=true;}};workers.push(worker);return worker;},10000);
  try{
    const q=cs.quickOpen();q.regex=true;cs.quickSearch('Sample');assert.equal(q.pending,true);assert.equal(workers.length,1);
    cs.quickClose();assert.equal(workers[0].stopped,true);cs.quickOpen();assert.equal(workers.length,2);
    workers[1].onmessage({data:{matches:[]}});assert.equal(q.pending,false);
    cs.quickOpen(true).regex=true;cs.quickSearch('Tick');cs.quickOpen(true).regex=true;cs.quickSearch('Fire');
    cs.closeAllSearchWindows();assert.ok(cs.state.searchWindows.every(q=>!q.open));assert.equal(cs.regexQueue.owners.size,0);assert.equal(cs.regexQueue.active,null);
  }finally{cs.regexQueue.dispose();delete globalThis.window;}
});
