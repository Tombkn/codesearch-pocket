import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {RegexQueue} from '../js/core/regex-queue.js';
function harness(timeout=1000){const workers=[];const queue=new RegexQueue(()=>{const worker={postMessage(payload){this.payload=payload;},terminate(){this.dead=true;}};workers.push(worker);return worker;},timeout);return {queue,workers};}
test('Nur ein Regex-Worker, gleiche Query cached, überholte Resultate ignoriert',()=>{
  const {queue,workers}=harness();const got=[];
  queue.request('main','a',{query:'a'},r=>got.push(['old',r]));queue.request('quick','b',{query:'b'},r=>got.push(['quick',r]));
  assert.equal(workers.length,1);queue.request('main','c',{query:'c'},r=>got.push(['new',r]));
  assert.equal(workers[0].dead,true);assert.equal(workers.length,2);
  workers[0].onmessage({data:{matches:['old']}});assert.deepEqual(got,[]);
  workers[1].onmessage({data:{matches:['b']}});assert.equal(got[0][0],'quick');assert.equal(workers.length,3);
  workers[2].onmessage({data:{matches:['c']}});assert.equal(got[1][0],'new');
  assert.ok(queue.request('other','c',{},()=>{}).matches.has('c'));assert.equal(workers.length,3);queue.dispose();
});
test('Wiederholtes Rendern startet denselben aktiven Regex nicht neu',()=>{
  const {queue,workers}=harness();let result;
  queue.request('main','a',{},()=>{});queue.request('main','a',{},r=>result=r);
  assert.equal(workers.length,1);workers[0].onmessage({data:{matches:['a']}});assert.ok(result.matches.has('a'));queue.dispose();
});
test('Schließen beendet eigenen Worker und lässt andere Suchfenster weiterarbeiten',()=>{
  const {queue,workers}=harness();let result;
  queue.request('one','a',{},()=>assert.fail('geschlossene Session'));queue.request('two','b',{},r=>result=r);
  queue.cancel('one');assert.equal(workers[0].dead,true);assert.equal(workers.length,2);
  workers[1].onmessage({data:{matches:['b']}});assert.ok(result.matches.has('b'));queue.dispose();
});
test('Zeitlimit beendet Worker und liefert sichtbaren Fehler; Dispose liefert keine späte Antwort',async()=>{
  const {queue,workers}=harness(10);let result;
  queue.request('main','slow',{},r=>result=r);await delay(30);
  assert.equal(workers[0].dead,true);assert.match(result.error,/langsam/);
  queue.request('main','close',{},()=>assert.fail('nach Dispose'));queue.dispose();workers[1].onmessage({data:{matches:['late']}});
});


test('Worker-Startfehler meldet nach Request-Rückkehr einen gecachten Fehler statt dauerhaft pending',async()=>{
  const queue=new RegexQueue(()=>{throw new Error('blocked');});let result;
  assert.equal(queue.request('main','a',{},r=>result=r),null);assert.equal(result,undefined);
  await Promise.resolve();assert.match(result.error,/blocked/);assert.equal(queue.request('main','a',{},()=>{}),result);queue.dispose();
});
