import {abs,rel} from './util.js';

export function selectableHit(hit) {
  return Boolean(hit?.path) && !['section','notice','info','empty','button','flow','whyhistory'].includes(hit.kind);
}
export function selectionIdentity(hit) {
  if(!selectableHit(hit))return null;
  return JSON.stringify([hit.kind,hit.path,hit.ctx,hit.line,hit.par,hit.cat,hit.art,hit.row,hit.col,hit.from,hit.text]);
}
export function selectedHits(cs) {
  return [...cs.state.multi].sort((a,b)=>a-b).map(index=>cs.state.hits[index]).filter(selectableHit);
}
export function copySelection(cs,kind='rows',origin='') {
  const hits=selectedHits(cs);if(!hits.length){cs.state.status='Keine kopierbaren Einträge ausgewählt.';cs.emit();return false;}
  const parts=[],seen=new Set();let skipped=0;
  for(const hit of hits){
    const path=rel(hit.path),source=abs(path),member=hit.ctx?cs.net.member(path,hit.ctx):null;
    const locator=source+(hit.line?':'+hit.line:'')+(hit.ctx?' · '+hit.ctx:'');
    if(kind==='paths'){if(!seen.has(locator)){parts.push(locator);seen.add(locator);}continue;}
    if(kind==='rows'){parts.push([hit.art,hit.ctx,hit.text,locator].filter(Boolean).join(' · '));continue;}
    const lines=path==='BranchLab/experiment_script'?cs.lab.script.split('\n'):cs.net.lines(path);
    if(!lines.length || (!member && !hit.line)){skipped++;continue;}
    const start=member?.line || hit.line,end=member?.end || start,key=`${source}:${start}:${end}`;
    if(seen.has(key))continue;seen.add(key);
    parts.push(`### ${locator}\nSource-Zeilen ${start}–${end}\n\n\`\`\`python\n${lines.slice(start-1,end).join('\n')}\n\`\`\``);
  }
  if(!parts.length){cs.state.status='Die Auswahl enthält keinen verfügbaren Quellcode. Fundstellen oder Zeilen kopieren.';cs.emit();return false;}
  let text=parts.join('\n\n');
  if(kind==='analysis')text='# Ausgewählte CodeSearch-Quellen\n\nAuftrag: Untersuche die Rollen, Beziehungen und mögliche Fehler dieser ausdrücklich ausgewählten Einträge. Belege Aussagen mit Source und Zeile. Benenne fehlende Abhängigkeiten und benötigte Gegenproben. Führe nichts automatisch aus.\n\nHerkunft: Pocket-Übungsmodell. Diese Auswahl ist kein vollständiges Projekt und kein Laufzeitnachweis. Für gebundene Nachfragen und Antwortprüfung LLM ANALYSE verwenden.\n\n'+text;
  if(skipped)text+=`\n\n${skipped} ausgewählte Einträge besitzen keinen verfügbaren Codeausschnitt; zusätzlich Fundstellen kopieren.`;
  if(text.length>500000){cs.state.status='Auswahl größer als 500.000 Zeichen. Bitte in kleinere Gruppen teilen; Zwischenablage unverändert.';cs.emit();return false;}
  cs.copy(text,'',origin);cs.state.status=`${hits.length} ausgewählte Einträge kopiert${skipped?' · '+skipped+' ohne Codeausschnitt':''}`;cs.emit();return true;
}
