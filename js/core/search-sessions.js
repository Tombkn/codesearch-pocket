// Hauptsuche + drei Nebenfenster teilen Daten, niemals Suchzustand.
import {buildSearch} from './views/search.js';
import {abs,rel} from './util.js';

export const MAX_SEARCH_WINDOWS=10;   // unabhängige Suchfenster zusätzlich zur Hauptsuche (wie nativ)
export function newSearchSession(number) {
  return {id:`search-${number}`,number,open:false,query:'',filter:'all',family:'all',address:'all',
    caseSensitive:false,regex:false,includeTables:true,includeSys:false,maxResults:300,
    scopeRoot:'',flat:false,initialized:false,hits:[],selected:-1,generation:0,total:0,error:''};
}
export function sessionRequest(q) {
  return {query:q.query,filter:q.filter,family:q.family,address:q.address,caseSensitive:q.caseSensitive,
    regex:q.regex,includeTables:q.includeTables,includeSys:q.includeSys,maxResults:q.maxResults,
    scopeRoot:q.scopeRoot,flat:q.flat};
}
export function openSearch(cs, fresh=false) {
  const s=cs.state;
  if(!s.searchWindows?.length)s.searchWindows=[s.quick];
  let q=s.quick;
  if(fresh) {
    q=s.searchWindows.find(item=>!item.open);
    if(!q && s.searchWindows.length>=MAX_SEARCH_WINDOWS-1) {
      s.status=`${MAX_SEARCH_WINDOWS} zusätzliche Suchfenster sind offen. Schließe zuerst eines.`;cs.emit();return null;
    }
    if(!q) {q=newSearchSession(s.searchWindows.length+2);s.searchWindows.push(q);}
    else Object.assign(q,newSearchSession(q.number || 2));
  }
  if(!q.initialized) {
    Object.assign(q,{scopeRoot:cs.scopeRoot(),flat:cs.cs.Scope==='currentflat'&&!cs.contextActive(),
      caseSensitive:cs.cs.Casesensitive,regex:cs.cs.Regex,includeTables:cs.cs.Includetables,
      includeSys:cs.cs.Includesys,maxResults:cs.cs.Maxresults,initialized:true});
  }
  q.open=true;s.quick=q;s.focusWin='quick';s.floatFocus=null;s.quickFocusRequested=q.id;
  if(q.pending)searchSession(cs,q.query,q.id);else cs.emit();return q;
}
export function searchSession(cs,text,id=cs.state.quick.id) {
  const q=cs.state.searchWindows.find(item=>item.id===id);
  if(!q)return;
  q.query=String(text);q.generation++;q.selected=-1;
  const generation=q.generation;
  const result=buildSearch(cs,{...sessionRequest(q),owner:q.id,onReady:()=>{if(q.open && q.generation===generation)searchSession(cs,q.query,q.id);}});
  q.hits=result.rows;q.total=result.total || 0;q.error=result.error || '';q.pending=Boolean(result.pending);q.indexKey=result.indexKey;
  cs.emit();return result;
}
export function scopeSession(cs,value,id=cs.state.quick.id) {
  const q=cs.state.searchWindows.find(item=>item.id===id);if(!q)return;
  const [mode,...path]=value.split(':');const root=rel(path.join(':'));
  if(mode!=='global' && !cs.net.isComp(root)) {q.error='Dieser Suchbereich existiert nicht mehr.';cs.emit();return;}
  q.scopeRoot=mode==='global'?'':root;q.flat=mode==='flat';searchSession(cs,q.query,id);
}
export function transferSearch(cs,id,index) {
  const q=cs.state.searchWindows.find(item=>item.id===id);if(!q)return;
  const h=q.hits[index], s=cs.state;
  Object.assign(cs.cs,{Scope:q.flat?'currentflat':'comp',Scopecomp:abs(q.scopeRoot),Searchfilter:q.filter,Opfamily:q.family,
    Casesensitive:q.caseSensitive,Regex:q.regex,Includetables:q.includeTables,Includesys:q.includeSys,Maxresults:q.maxResults});
  if(q.flat)s.paneOwner=q.scopeRoot;
  Object.assign(s,{mode:'search',view:'',overview:'',context:'selection',query:q.query,fieldDraft:'',opAddress:q.address,mainopen:true,focusWin:'main'});
  q.open=false;cs.regexQueue?.cancel(q.id);cs.rebuild();
  if(h)s.selected=s.hits.findIndex(x=>x.path===h.path&&x.line===h.line&&x.kind===h.kind&&x.par===h.par);
  cs.emit();
}
