// Bedienbare Zweitansichten; historische Quellen bleiben ausdrücklich getrennt.
import {abs, rel, uid, clone} from './util.js';
import {errorReport} from './views/miscviews.js';
import {renderSpecMarkdown} from './spec-workbench.js';

export function captureCode(cs, dat, line = 1, from = null, to = null) {
  dat = rel(dat);
  const lines = dat === 'BranchLab/experiment_script' ? cs.lab.script.split('\n') : cs.net.lines(dat);
  if (!lines.length) return null;
  const name = cs.net.enclosingFunction(dat, line || 1);
  const member = name ? cs.net.member(dat, name) : null;
  const start = from ?? Math.max(1, member ? member.line - 1 : (line || 1) - 6);
  const end = Math.min(lines.length, to ?? (member ? (member.end || member.line) + 1 : (line || 1) + 8));
  return {dat, line, start, lines: lines.slice(start - 1, end), members: cs.net.members(dat).map(m => m.name)};
}

// Eine normale Zweitansicht liest denselben Arbeitsplatz bei jedem Rendern neu.
// Ausschließlich ausdrücklich übergebene historische Quellen bleiben eingefroren.
export function floatText(cs, f) {
  if (!f.live) return f.text || '';
  const s=cs.state;
  if (s.view==='spec') return cs.spec.document ? renderSpecMarkdown(cs.spec.document) : 'Noch keine Spec.';
  if (s.view==='analysis') {
    const a=s.inv.analysis || {}, packet=a.packets?.find(p=>p.id===a.packetId);
    return ['Frage: '+(a.question || ''),'Pocket-Simulation',JSON.stringify(a.result || packet || {},null,2)].join('\n\n');
  }
  if (f.kind==='code') return captureCode(cs,s.codeView.path,s.codeView.line)?.lines.join('\n') || 'Kein Code ausgewählt.';
  if (f.kind==='details') {
    const hit=cs.selectedHit || (s.mode==='table' ? cs.tableSelectedHit() : null);
    return hit ? cs.detailFor(hit).map(b=>b.title+'\n'+b.rows.map(([k,v])=>`${k}: ${v}`).join('\n')).join('\n\n') : 'Keine Zeile ausgewählt.';
  }
  if (f.kind==='errors') return s.hits.filter(h=>h.kind==='error').map(h=>errorReport(cs,h)).join('\n\n') || 'Keine Fehler in dieser Ansicht.';
  if (s.mode==='table') return cs.tableData().map(row=>row.join('\t')).join('\n');
  return s.hits.map(h=>[h.art,h.ctx,h.text,h.detail,h.path].filter(Boolean).join(' · ')).join('\n');
}

export function openCopy(cs, kind='list', size='side', historical=null) {
  const s=cs.state;
  if (kind==='code' && !historical && !captureCode(cs,s.codeView.path,s.codeView.line)) {s.status='Zuerst eine Codezeile öffnen.';cs.emit();return null;}
  const f={id:uid('f'),kind,size:size==='full'?'full':'side',selected:-1,zoom:1,zoomStart:1,live:!historical};
  if (historical) {f.code=clone(historical);f.text=f.code.lines.join('\n');f.title='Historische Quelle · '+abs(f.code.dat);}
  else {
    f.title=({list:'Liste',details:'Details',code:'Code',analysis:'LLM ANALYSE',spec:'SPEC',errors:'Fehler',workspace:'Arbeitsplatz'})[kind]+' · Zweitansicht';
    Object.defineProperty(f,'text',{get:()=>floatText(cs,f)});
  }
  if(f.size==='full')for(const item of s.floats)item.size='side';
  s.floats.push(f);s.floatFocus=f.id;cs.emit();return f;
}

export function copyMenu(cs) {
  const kind=['analysis','spec'].includes(cs.state.view)?cs.state.view:'list';
  const choices=[[kind,'Diese Ansicht'],['details','Ausgewählte Details'],['code','Angezeigter Code'],['workspace','Ganzer Arbeitsplatz']];
  if(cs.state.mode==='errors')choices.push(['errors','Fehleransicht']);
  cs.state.menu={title:'ZWEITANSICHT · gemeinsamer Arbeitsplatz',description:'Gleiche Informationen und Aktionen. Auswahl und Änderungen wirken in allen Ansichten; Schließen betrifft nur dieses Fenster.',items:choices.flatMap(([k,label])=>
    [['side','Fenster daneben'],['full','Groß öffnen']].map(([size,suffix])=>({label:`${label} · ${suffix}`,run:()=>openCopy(cs,k,size)})))};
  cs.emit();
}

export function sizeCopy(cs, id, size) {
  const f = cs.state.floats.find(item => item.id === id);
  if (!f) return;
  if (size === 'full') for (const item of cs.state.floats) item.size = 'side';
  f.size = size === 'full' ? 'full' : 'side';
  cs.state.floatFocus = id;
  cs.emit();
}
