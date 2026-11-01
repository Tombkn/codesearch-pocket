import {abs,rel} from './util.js';
import {buildFlow} from './views/netviews.js';
import {notice} from './views/common.js';

export function newFlowState() {
  return {pinned:false,anchor:null,scope:null,raw:null,generation:0,refreshedAt:null,
    filters:{direction:'both',family:'all',links:'all',depth:64}};
}
export function flowAnchor(cs) {
  const s=cs.state;
  return s.flow.pinned?s.flow.anchor:cs.contextActive()?s.paneOwner:s.focus;
}
export function flowScope(cs) {
  return {root:cs.scopeRoot(),flat:cs.cs.Scope==='currentflat',includeSys:cs.cs.Includesys};
}
export function refreshFlow(cs, anchor=null) {
  const s=cs.state,f=s.flow,key=selectionKey(cs.selectedHit);
  if(anchor!==null){f.anchor=rel(anchor);f.scope=flowScope(cs);}
  if(f.anchor===null || (!f.pinned && anchor===null)){f.anchor=flowAnchor(cs);f.scope=flowScope(cs);}
  f.generation++;
  f.raw=buildFlow(cs,f.anchor,f.scope);f.refreshedAt=Date.now();
  if(s.mode==='chain'){
    cs.rebuild();const selected=s.hits.findIndex(row=>selectionKey(row)===key);if(selected>=0)s.selected=selected;
  }
  cs.emit();
}
function selectionKey(h){return h?`${h.kind}|${h.path}|${h.dist}|${h.art}`:'';}
export function presentFlow(cs) {
  const f=cs.state.flow,anchor=flowAnchor(cs);
  if(!cs.net.op(anchor))return {rows:[notice(`FLOW-Ziel ${abs(anchor)} ist nicht mehr vorhanden. Wähle ausdrücklich ein neues Ziel.`)],up:[],down:[],anchor};
  const raw=f.pinned && f.raw?f.raw:buildFlow(cs,anchor,flowScope(cs));
  const filters=f.filters;
  const rows=raw.rows.filter(h=>{
    if(h.kind!=='chain' || h.anchor)return true;
    if(filters.direction==='up' && h.dist>0 || filters.direction==='down' && h.dist<0)return false;
    if(filters.family!=='all' && h.family?.toLowerCase()!==filters.family)return false;
    if(Math.abs(h.dist || 0)>filters.depth)return false;
    const wire=['WIRE','COMP-IN','COMP-OUT','RÜCKKOPPLUNG'].includes(h.art);
    if(filters.links==='wire'&&!wire || filters.links==='refs'&&wire)return false;
    return true;
  }).map(h=>({...h}));
  for(let i=0;i<rows.length;i++)if(rows[i].kind==='section'){
    let count=0;for(let j=i+1;j<rows.length&&rows[j].kind!=='section';j++)count++;
    rows[i].count=count;
  }
  const up=rows.filter(h=>h.kind==='chain'&&h.dist<0),down=rows.filter(h=>h.kind==='chain'&&h.dist>0);
  if(rows[0]?.kind==='flow')rows[0].text=`QUELLEN ${up.length} → ZIEL → FOLGEN ${down.length}`;
  return {...raw,rows,anchor,scope:f.pinned?f.scope:flowScope(cs),shownUp:up,shownDown:down};
}
export function pinFlow(cs, on=!cs.state.flow.pinned) {
  const f=cs.state.flow;
  if(on){f.anchor=flowAnchor(cs);f.scope=flowScope(cs);f.pinned=true;refreshFlow(cs);}
  else {f.pinned=false;cs.rebuild();}
}
export function flowStoryText(cs) {
  const flow=presentFlow(cs),lines=[`# FLOW-Story ${abs(flow.anchor)}`,cs.state.flow.pinned?'Fixiertes Ziel · Stand der letzten Aktualisierung':'Aktueller Flow',''];
  for(const row of flow.rows)if(row.kind==='section')lines.push(row.text+':');else if(row.kind==='chain')lines.push(`${row.art} · ${row.path} · ${row.dist ?? ''}`);
  return lines.join('\n');
}
