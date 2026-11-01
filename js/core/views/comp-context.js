// Rekursive Codeübersicht. Jede Zeile behält ihre tatsächliche Quelldatei.
import {abs} from '../util.js';
import {section,action,notice} from './common.js';
import {buildStructure,buildModuleStructure} from './codeviews.js';
import {buildAudit} from './miscviews.js';

export function compSources(cs, root) {
  const inside=path=>cs.net.isInside(path,root);
  return {
    extensions:[...cs.net.extDat.keys()].filter(inside).sort(),
    modules:Object.keys(cs.net.code).filter(path=>inside(path)&&!cs.net.datComp.has(path)).sort(),
  };
}

export function buildCompCode(cs, root, audit=false) {
  const sources=compSources(cs,root), rows=[];
  rows.push(notice(`${abs(root)} · ${sources.extensions.length} Extension-COMPs · ${sources.modules.length} weitere Python-DATs`, 'Rekursiver Inhalt; der vorhandene Analyse-Pin bleibt erhalten.'));
  if(audit) rows.push(action('NEU','Befunde des gesamten Bereichs neu aufbauen','RECHECK'));
  for(const comp of sources.extensions) {
    rows.push(section(abs(comp),'Extension im geöffneten Netzwerk'));
    rows.push(action('QUELLE',`Quelle einzeln untersuchen → ${abs(comp)}`,'OPENCONTEXTSOURCE',comp));
    const result=audit?buildAudit(cs,comp):buildStructure(cs,comp);
    rows.push(...result.rows.filter(h=>h.kind!=='button' && h.kind!=='mapfile'
      && !(h.kind==='section' && ['GESPEICHERTE KARTEN','MODUL- UND CALLBACK-DATS'].includes(h.text))
      && !(audit && (h.text==='BLOCKIERT / KAPUTT' || h.text.startsWith('OK   ·   keine toten')))));
  }
  for(const dat of sources.modules) {
    rows.push(section(abs(dat),audit?'Abdeckungslücke':'Freier Modul- oder Callback-DAT'));
    rows.push(action('QUELLE',`Quelle einzeln untersuchen → ${abs(dat)}`,'OPENCONTEXTSOURCE',dat));
    if(audit) rows.push(notice('Für diesen freien Python-DAT sind die Extension-Auditregeln in Pocket nicht anwendbar. Kein fehlerfreier Befund behauptet.'));
    else rows.push(...buildModuleStructure(cs,dat).rows);
  }
  if(audit) rows.push(notice('Pocket prüft die enthaltenen Code-Regeln. Dynamische Bindings, Exports und echte Cook-Fehler müssen im Laptop-Projekt geprüft werden.'));
  return {rows,comp:root,sources};
}
