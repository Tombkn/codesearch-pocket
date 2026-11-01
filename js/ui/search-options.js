import {esc} from './dom.js';

export function searchOptions(values, attr='data-qoption') {
  const choices=[['caseSensitive','Groß-/Kleinschreibung'],['regex','Regex'],['includeTables','Table-Inhalte'],['includeSys','System- und Helper-DATs']];
  return `<details class="search-options" data-persist="search-options"><summary>Suchoptionen ▾</summary><div class="search-options-body">${choices.map(([key,label])=>`<label><input type="checkbox" ${attr}="${key}" ${values[key]?'checked':''}>${label}</label>`).join('')}<label>Treffergrenze<select ${attr}="maxResults">${[50,100,300,500,1000,2000].map(n=>`<option value="${n}" ${n===Number(values.maxResults)?'selected':''}>${n}</option>`).join('')}</select></label><p>Wörter = UND · <code>a | b</code> = ODER · <code>^wort</code> = ausschließen · <code>*teil*</code> = Teiltext · <code>"genauer Text"</code> = Phrase. Regex nutzt eigene Mustersyntax.</p></div></details>`;
}

export function searchScopeOptions(cs,q) {
  const selected=q.scopeRoot===''&&!q.flat?'global':`${q.flat?'flat':'comp'}:${q.scopeRoot}`;
  const options=[['global','GLOBAL · gesamtes Übungsprojekt']];
  for(const [path,op] of cs.net.ops)if(op.family==='COMP' && !path.split('/').some(p=>['ExtUtils','ExtUtils1','Tour'].includes(p))) {
    const label=path||'Tutorial';options.push([`comp:${path}`,`${label} · rekursiv`],[`flat:${path}`,`${label} · nur direkt`]);
  }
  return options.map(([value,label])=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`).join('');
}
