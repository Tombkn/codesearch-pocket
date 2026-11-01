// Pocket kann nur die mitgelieferten SignalGarden-Parameter wirklich ausführen.
// Unbekannte Typen/Verbindungen werden erklärt und nicht scheinbar promoviert.
import {abs,rel,baseName} from './util.js';
const OWNERS={'SignalGarden':'root','SignalGarden/Sensor':'sensor','SignalGarden/Scenes':'scenes','SignalGarden/Palette':'palette'};
const supported=new Set(['Float','Int','Toggle','Str','Menu','Pulse']);
const clone=value=>JSON.parse(JSON.stringify(value));
const key=(path,name)=>`${path}:${name}`;
export function promotionPlan(cs,path) {
  path=rel(path);const source=cs.net.op(path),parent=source&&cs.net.op(source.parent);
  if(!source || source.family!=='COMP' || !parent)throw new Error('Ein vorhandener COMP mit direktem Parent wird benötigt.');
  const sourceOwner=OWNERS[path],parentOwner=OWNERS[source.parent],pars=cs.lab.garden.pars[sourceOwner];
  const names=new Set([...(parent.custom || []).map(p=>p.name),...Object.keys(parent.pars || {}),...Object.keys(cs.lab.garden.pars[parentOwner] || {})]);
  const groups=(source.custom || []).map(par=>{
    const current=source.pars?.[par.name],bound=cs.promotedBindings?.get(key(path,par.name));
    let outcome='create',reason='Constant-Parameter verbunden übernehmen';
    if(bound && bound.parent===source.parent && names.has(par.name)){outcome='already_connected';reason='Bereits mit diesem Parent verbunden';}
    else if(current?.b || bound){outcome='collision';reason='Bestehende fremde Bindung';}
    else if(names.has(par.name)){outcome='collision';reason='Name oben bereits vorhanden';}
    else if(!sourceOwner || !parentOwner){outcome='unsupported';reason='Dieser COMP hat in Pocket kein ausführbares Parameter-Modell; am Laptop prüfen';}
    else if(par.readOnly || par.menuSource || par.enableExpr || par.sequence || current?.e || current?.export || !supported.has(par.style)){
      outcome='unsupported';reason=par.readOnly?'Anzeigeparameter bleibt am Ursprung':'Typ, Expression, Export oder dynamische Metadaten hier nicht unterstützt';
    }
    return {name:par.name,style:par.style,page:`${source.name}:${par.page || 'Custom'}`,outcome,reason,value:par.style==='Pulse'?null:pars?.[par.name],metadata:clone(par)};
  });
  const snapshot={source:path,parent:source.parent,sourceCustom:source.custom,sourcePars:source.pars || {},parentCustom:parent.custom || [],parentPars:parent.pars || {},values:pars || {},groups};
  const plan={source:path,parent:source.parent,sourceOwner,parentOwner,groups,revision:JSON.stringify(snapshot)};
  Object.defineProperties(plan,{sourceObject:{value:source},parentObject:{value:parent}});return plan;
}

export function applyPromotion(cs,plan) {
  const fresh=promotionPlan(cs,plan.source);
  if(fresh.sourceObject!==plan.sourceObject || fresh.parentObject!==plan.parentObject || JSON.stringify(fresh)!==JSON.stringify(plan))throw new Error('Vorschau ist veraltet oder verändert. Erneut öffnen und prüfen.');
  const groups=plan.groups.filter(group=>group.outcome==='create');if(!groups.length)return {changed:false,created:0};
  const source=cs.net.op(plan.source),parent=cs.net.op(plan.parent),sourcePars=cs.lab.garden.pars[plan.sourceOwner],parentPars=cs.lab.garden.pars[plan.parentOwner];
  const bindings=cs.promotedBindings??=new Map(),pulseBindings=cs.promotedPulses??=new Map();
  cs.promotionSerial=(cs.promotionSerial || 0)+1;const id=`promotion-${cs.promotionSerial}`;
  const initial=Object.fromEntries(groups.filter(g=>g.style!=='Pulse').map(g=>[g.name,sourcePars[g.name]]));
  // Eigene unveränderliche Netz-Kopien behalten ihre logische Identität.
  // Ein fremd eingesetztes Objekt erhält keinen Token und bleibt gesperrt.
  const identities=cs.promotionOwnerIdentities??=new WeakMap();
  for(const owner of [source,parent])if(!identities.has(owner))identities.set(owner,{});
  const sourceIdentity=identities.get(source),parentIdentity=identities.get(parent);
  const inserted=groups.map(group=>({...clone(group.metadata),page:group.page,promotedFrom:plan.source}));
  const sourceDescriptors=Object.fromEntries(groups.filter(g=>g.style!=='Pulse').map(g=>[g.name,Object.getOwnPropertyDescriptor(sourcePars,g.name)]));
  const accessors=Object.fromEntries(groups.filter(g=>g.style!=='Pulse').map(g=>[g.name,{configurable:true,enumerable:true,get:()=>parentPars[g.name],set:value=>{parentPars[g.name]=value;}}]));
  const checkOwners=()=>{
    if(identities.get(cs.net.op(plan.source))!==sourceIdentity || identities.get(cs.net.op(plan.parent))!==parentIdentity)throw new Error('Ein COMP wurde inzwischen ersetzt. Promotion nicht angewendet.');
    if(cs.lab.garden.pars[plan.sourceOwner]!==sourcePars || cs.lab.garden.pars[plan.parentOwner]!==parentPars)throw new Error('Parameter-State wurde inzwischen ersetzt. Promotion nicht angewendet.');
  };
  const publish=(sourceCopy,parentCopy)=>{
    identities.set(sourceCopy,sourceIdentity);identities.set(parentCopy,parentIdentity);
    cs.net.ops.set(plan.source,sourceCopy);cs.net.ops.set(plan.parent,parentCopy);cs.searchIndexCache?.clear();
  };
  const changeDescriptors=(forward)=>{
    const before=[];
    // Erst jede Schreibstelle prüfen, dann ändern. Im Fehlerfall auch die
    // bereits geschriebenen Werte und Accessors exakt wiederherstellen.
    for(const group of groups.filter(g=>g.style!=='Pulse')){
      const child=Object.getOwnPropertyDescriptor(sourcePars,group.name),upper=Object.getOwnPropertyDescriptor(parentPars,group.name);
      if(!child?.configurable || (forward ? upper || !Object.isExtensible(parentPars) : !upper?.configurable || child.get!==accessors[group.name].get))throw new Error('Parameter ist gesperrt oder inzwischen verändert. Promotion nicht angewendet.');
      before.push([sourcePars,group.name,child],[parentPars,group.name,upper]);
    }
    try {
      for(const group of groups.filter(g=>g.style!=='Pulse')){
        if(forward){
          Object.defineProperty(parentPars,group.name,{configurable:true,enumerable:true,writable:true,value:initial[group.name]});
          Object.defineProperty(sourcePars,group.name,accessors[group.name]);
        } else {
          Object.defineProperty(sourcePars,group.name,sourceDescriptors[group.name]);
          delete parentPars[group.name];
        }
      }
    } catch(error){
      for(const [object,name,descriptor] of before.reverse()){
        if(descriptor)Object.defineProperty(object,name,descriptor);else delete object[name];
      }
      throw error;
    }
  };
  const attach=()=>{
    checkOwners();
    for(const group of groups){
      if(cs.net.op(plan.parent).custom?.some(p=>p.name===group.name) || Object.hasOwn(cs.net.op(plan.parent).pars || {},group.name) || Object.hasOwn(parentPars,group.name))throw new Error('Zielparameter existiert inzwischen; alte Promotion wird nicht überschrieben.');
      if(JSON.stringify(cs.net.op(plan.source).pars?.[group.name])!==JSON.stringify(source.pars?.[group.name]) || (group.style!=='Pulse' && sourcePars[group.name]!==initial[group.name]))throw new Error('Quellparameter wurde inzwischen verändert. Alte Promotion nicht angewendet.');
    }
    const sourceCopy={...cs.net.op(plan.source),pars:{...(cs.net.op(plan.source).pars || {})}},parentCopy={...cs.net.op(plan.parent),custom:[...(cs.net.op(plan.parent).custom || [])]};
    parentCopy.custom.push(...inserted);
    for(const group of groups)sourceCopy.pars[group.name]={b:`parent().par.${group.name}`};
    const edges=groups.map(group=>({kind:'bind',src:plan.parent,dst:plan.source,par:group.name,text:`parent().par.${group.name}`,promotion:id}));
    changeDescriptors(true);
    for(const group of groups){
      if(group.style==='Pulse')pulseBindings.set(key(plan.parent,group.name),{owner:plan.sourceOwner,name:group.name});
      bindings.set(key(plan.source,group.name),{parent:plan.parent,id});
    }
    cs.net.edges=[...cs.net.edges,...edges];publish(sourceCopy,parentCopy);cs.promotionResult={changed:true,created:groups.length,source:plan.source};
  };
  const detach=()=>{
    checkOwners();
    if(groups.some(g=>bindings.get(key(plan.source,g.name))?.id!==id))throw new Error('Die Bindung wurde inzwischen verändert. Promotion-Undo wurde nicht angewendet.');
    const sourceCopy={...cs.net.op(plan.source),pars:{...(cs.net.op(plan.source).pars || {})}},parentCopy={...cs.net.op(plan.parent),custom:cs.net.op(plan.parent).custom.filter(p=>!inserted.includes(p))};
    changeDescriptors(false);
    for(const group of groups){
      bindings.delete(key(plan.source,group.name));pulseBindings.delete(key(plan.parent,group.name));
      if(source.pars && Object.hasOwn(source.pars,group.name))sourceCopy.pars[group.name]=source.pars[group.name];else delete sourceCopy.pars[group.name];
    }
    if(!Object.hasOwn(source,'pars') && !Object.keys(sourceCopy.pars).length)delete sourceCopy.pars;
    cs.net.edges=cs.net.edges.filter(edge=>edge.promotion!==id);publish(sourceCopy,parentCopy);cs.promotionResult={changed:false,created:0,source:plan.source};
  };
  attach();cs.lab.recordEdit(detach,attach);return {changed:true,created:groups.length};
}

export function showPromotion(cs,path) {
  const plan=promotionPlan(cs,path),labels={create:'ÜBERNEHMEN',already_connected:'VERBUNDEN',collision:'KONFLIKT',unsupported:'AUSGELASSEN'};
  cs.promotionPreviewSerial=(cs.promotionPreviewSerial || 0)+1;
  let settled=false;
  const claim=()=>{if(settled || cs.state.dialog!==dialog)return false;settled=true;return true;};
  const dialog={title:'Parameter nach oben · Vorschau',confirmLabel:'Verbinden',cancelLabel:'Abbrechen',lines:[`Quelle: ${abs(plan.source)}\nZiel: ${abs(plan.parent)}`,
    ...plan.groups.map(g=>`${labels[g.outcome]} · ${g.name} · ${g.reason}`),
    'Oben entstehen passende Controls; unten wird gebunden. Kein Pulse wird beim Übernehmen ausgelöst. Abbrechen verändert nichts. Pocket simuliert nur seine bekannten SignalGarden-Controls.'],
    cancel:()=>{if(claim())cs.promotionCancelSerial=(cs.promotionCancelSerial || 0)+1;},
    confirm:plan.groups.some(g=>g.outcome==='create')?()=>{if(!claim())return;try{const result=applyPromotion(cs,plan);cs.state.status=`${result.created} Parameter verbunden übernommen · Undo verfügbar`;}catch(error){cs.state.status=error.message;}}:null};
  cs.state.dialog=dialog;cs.emit();
}

export function compOperations(cs) {
  const path=cs.state.paneOwner,comp=cs.net.op(path);
  if(!comp || comp.family!=='COMP'){cs.state.status='Der geöffnete COMP ist nicht mehr vorhanden.';cs.emit();return;}
  const boundAction=fn=>()=>{if(cs.net.op(path)!==comp){cs.state.status='COMP wurde inzwischen ersetzt. Menü erneut öffnen.';return cs.emit();}return fn();};
  cs.state.menu={title:`DIESE COMP · ${baseName(path) || '/'}`,description:abs(path),items:[
    {label:'Parameter nach oben …',run:boundAction(()=>showPromotion(cs,path))},
    {label:'Parameter ansehen',run:boundAction(()=>{cs.state.parameterViewRequested=path;cs.emit();})},
    {label:'Im zweiten Netzwerk öffnen',run:boundAction(()=>cs.openNetworkPane(path))},
    ...[['trace','USES · eigene Eingänge'],['refs','USED BY · eigene Leser'],['chain','FLOW · Strecke']].map(([mode,label])=>({label,run:boundAction(()=>cs.OpenAt(mode,{target:path}))})),
    {label:'COMP-Pfad kopieren',run:boundAction(()=>cs.copy(abs(path)))},
  ]};cs.emit();
}

export function promotedPulse(cs,owner,name) {
  const path=Object.keys(OWNERS).find(path=>OWNERS[path]===owner),target=cs.promotedPulses?.get(key(path,name));
  if(!target)return false;cs.lab.garden.pulse(target.owner,target.name);return true;
}
