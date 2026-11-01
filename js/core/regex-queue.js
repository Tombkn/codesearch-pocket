// Regex läuft im Browser außerhalb des UI-Threads. Ein langsames Muster darf
// weder Scrollen noch die übrigen drei Suchfenster blockieren.
const WORKER_SOURCE=`onmessage=event=>{try{const {query,caseSensitive,texts}=event.data;const regex=new RegExp(query,caseSensitive?'':'i');postMessage({matches:texts.filter(text=>regex.test(text))});}catch(error){postMessage({error:error.message});}};`;

export class RegexQueue {
  constructor(makeWorker,timeout=400) {this.makeWorker=makeWorker;this.timeout=timeout;this.owners=new Map();this.cache=new Map();this.active=null;}
  request(owner,key,payload,ready) {
    const previous=this.owners.get(owner);
    if(previous?.key===key){previous.ready=ready;return null;}
    this.cancel(owner,false);
    if(this.cache.has(key)){this.pump();return this.cache.get(key);}
    this.owners.set(owner,{owner,key,payload,ready});this.pump();return null;
  }
  cancel(owner,advance=true) {
    this.owners.delete(owner);
    if(this.active?.job.owner===owner){this.active.worker.terminate();clearTimeout(this.active.timer);this.active=null;}
    if(advance)this.pump();
  }
  pump() {
    if(this.active || !this.owners.size)return;
    const job=this.owners.values().next().value;
    const cached=this.cache.get(job.key);
    if(cached){this.owners.delete(job.owner);job.ready(cached);this.pump();return;}
    let worker;
    try{worker=this.makeWorker();}catch(error){this.owners.delete(job.owner);const result={error:'Regex-Worker nicht verfügbar: '+error.message};this.cache.set(job.key,result);while(this.cache.size>4)this.cache.delete(this.cache.keys().next().value);queueMicrotask(()=>job.ready(result));this.pump();return;}
    const active={job,worker,timer:null};this.active=active;
    const finish=result=>{
      if(this.active!==active)return;
      worker.terminate();clearTimeout(active.timer);this.active=null;this.owners.delete(job.owner);
      this.cache.set(job.key,result);while(this.cache.size>4)this.cache.delete(this.cache.keys().next().value);
      job.ready(result);this.pump();
    };
    worker.onmessage=event=>finish(event.data.error?{error:event.data.error}:{matches:new Set(event.data.matches)});
    worker.onerror=event=>finish({error:event.message || 'Regex-Worker fehlgeschlagen'});
    active.timer=setTimeout(()=>finish({error:'Regex zu langsam. Muster vereinfachen oder ohne Regex suchen.'}),this.timeout);
    try{worker.postMessage(job.payload);}catch(error){queueMicrotask(()=>finish({error:error.message}));}
  }
  dispose(){for(const owner of [...this.owners.keys()])this.cancel(owner,false);this.cache.clear();}
}

let workerURL;
export function browserRegexQueue() {
  if(typeof Worker==='undefined' || typeof URL.createObjectURL!=='function')return null;
  return new RegexQueue(()=>{
    workerURL ??= URL.createObjectURL(new Blob([WORKER_SOURCE],{type:'text/javascript'}));
    return new Worker(workerURL);
  });
}
