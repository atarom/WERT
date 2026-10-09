import {state} from './state.js';
import {els} from './dom.js';
import {getMonitorSnapshotData} from './postpass.js';
import {parsePostpass,objectKeyFor,keyFor,sameState,fileElementToItem,trackedDifferences,trackedStateText,payloadFromItems,compareItemsByName} from './elements.js';
import {buildMergedPayload,conflictChoices} from './proposals.js';
import {downloadSnapshot} from './sqlite.js';
import {activity} from './activity.js';
let preview=null;
let busy=false;
let resolutions=new Map();
let detailMode=null;
let initialized=false;
let lastMessage=null;
function node(tag,className,value,parent){
  const result=document.createElement(tag);
  if(className)result.className=className;
  if(value!==undefined&&value!==null)result.textContent=String(value);
  if(parent)parent.append(result);
  return result;
}
function available(){
  const id=Number(state.config?.monitor?.sourceRelationId);
  return state.config?.mode==='monitor'&&Number.isSafeInteger(id)&&id>0;
}
function proposalSignature(){
  return JSON.stringify([state.taskId,state.baseHash,state.config?.elementsFile,state.config?.monitor?.sourceRelationId,state.importedProposals.map(p=>[p.id,p.filename,p.baseHash,p.add.map(keyFor),p.remove.map(keyFor),p.resolve.map(r=>[r.objectKey,r.issueSignature,r.desired?keyFor(r.desired):null])])]);
}
function invalidate(){
  preview=null;
  lastMessage=null;
  resolutions=new Map();
  detailMode=null;
  els.snapshotDetailSection?.classList.add('hidden');
  els.snapshotDetailList?.replaceChildren();
  const conflicts=document.getElementById('snapshot-auto-conflicts');
  conflicts?.replaceChildren();
  conflicts?.classList.add('hidden');
}
function plan(){
  if(!preview)throw new Error('Cal preparar el snapshot abans de descarregar.');
  if(!preview.proposals.length)return{payload:payloadFromItems(preview.osmItems),plan:{conflicts:[]},unresolved:[]};
  const originalAccepted=state.accepted;
  const originalIssues=state.inconsistencies;
  const originalResolutions=state.conflictResolutions;
  try{
    state.accepted=preview.osmItems;
    state.inconsistencies=[];
    state.conflictResolutions=resolutions;
    return buildMergedPayload();
  }finally{
    state.accepted=originalAccepted;
    state.inconsistencies=originalIssues;
    state.conflictResolutions=originalResolutions;
  }
}
function compare(baseItems,payload){
  const before=new Map(baseItems.map(item=>[objectKeyFor(item),item]));
  const after=new Map(payload.elements.map(value=>{const item=fileElementToItem(value);return[objectKeyFor(item),item];}));
  const added=[];
  const removed=[];
  const changed=[];
  let unchanged=0;
  for(const [key,item]of after){
    const original=before.get(key);
    if(!original)added.push(item);
    else if(sameState(original,item))unchanged++;
    else changed.push({before:original,after:item,differences:trackedDifferences(original,item)});
  }
  for(const [key,item]of before)if(!after.has(key))removed.push(item);
  added.sort(compareItemsByName);
  removed.sort(compareItemsByName);
  changed.sort((a,b)=>compareItemsByName(a.after,b.after));
  return{summary:{current:preview.baseRawCount,next:after.size,added:added.length,removed:removed.length,changed:changed.length,unchanged},details:{added,removed,changed}};
}
function tagText(value){return value===null?'(absent)':String(value);}
function showDetail(data){
  const section=els.snapshotDetailSection;
  const elements=els.snapshotDetailList;
  if(!section||!elements)return;
  for(const [card,mode] of [[els.snapshotAddedCard,'added'],[els.snapshotRemovedCard,'removed'],[els.snapshotChangedCard,'changed']])card?.setAttribute('aria-pressed',String(detailMode===mode));
  if(!detailMode||!data?.details?.[detailMode]?.length){
    section.classList.add('hidden');
    elements.replaceChildren();
    return;
  }
  const mode=detailMode;
  const rows=data.details[mode];
  const names={added:'Nous',removed:'Ja no hi són',changed:'Estat canviat'};
  els.snapshotDetailTitle.textContent=`${names[mode]} · ${rows.length}`;
  els.snapshotDetailHint.textContent=mode==='changed'?'Tags controlats abans i després.':mode==='added'?'Objectes incorporats al resultat final.':'Objectes retirats del resultat final.';
  const fragment=document.createDocumentFragment();
  for(const record of rows){
    const item=mode==='changed'?record.after:record;
    const row=node('a','change-row',null,fragment);
    row.href=`https://www.openstreetmap.org/${item.type}/${item.id}`;
    row.target='_blank';
    row.rel='noopener noreferrer';
    node('strong','',item.name||`${item.type} ${item.id}`,row);
    node('div','hint',`${item.type} ${item.id}`,row);
    node('div','',mode==='changed'?record.differences.map(d=>`${d.key}: ${tagText(d.before)} → ${tagText(d.after)}`).join(' · '):trackedStateText(item),row);
  }
  elements.replaceChildren(fragment);
  section.classList.remove('hidden');
}
function renderConflicts(merged){
  const section=document.getElementById('snapshot-auto-conflicts');
  if(!section)return;
  section.replaceChildren();
  section.classList.toggle('hidden',!merged.plan.conflicts.length);
  if(!merged.plan.conflicts.length)return;
  node('h3','',`Conflictes amb OSM · ${merged.plan.conflicts.length}`,section);
  node('p','hint','Només cal intervenir quan una proposta no coincideix amb OSM o amb una altra proposta.',section);
  const list=node('div','change-list',null,section);
  for(const conflict of merged.plan.conflicts){
    const row=node('div','change-row',null,list);
    node('strong','',conflict.current?.name||conflict.candidates.find(Boolean)?.name||conflict.objectKey,row);
    node('div','hint',`${conflict.objectKey} · ${conflict.sources.join(', ')}`,row);
    if(conflict.current)node('div','hint',`OSM: ${trackedStateText(conflict.current)}`,row);
    if(conflict.reasons.length)node('div','hint',conflict.reasons.join(' '),row);
    const select=node('select','conflict-options',null,row);
    const placeholder=node('option','','Selecciona l’estat final…',select);
    placeholder.value='';
    for(const choice of conflictChoices(conflict)){
      const option=node('option','',choice.label,select);
      option.value=choice.value;
    }
    select.value=resolutions.get(conflict.objectKey)||'';
    select.setAttribute('aria-label',`Decisió per a ${conflict.objectKey}`);
    select.addEventListener('change',()=>{
      if(select.value)resolutions.set(conflict.objectKey,select.value);
      else resolutions.delete(conflict.objectKey);
      lastMessage=null;
      render();
    });
  }
}
function render(){
  if(!els.snapshotAdminSection)return;
  const enabled=available();
  els.snapshotAdminSection.classList.toggle('hidden',!enabled);
  if(!enabled)return;
  if(preview&&preview.signature!==proposalSignature()){
    invalidate();
    lastMessage='Les propostes han canviat. Torna a comparar i preparar el snapshot.';
  }
  const count=state.importedProposals.length;
  const notice=document.getElementById('snapshot-auto-notice');
  if(notice)notice.textContent=count?`${count} proposta${count===1?'':'es'} importada${count===1?'':'es'}: s’aplicaran automàticament al snapshot d’OSM.`:'Sense propostes: es regenerarà el snapshot només des d’OSM.';
  els.snapshotCompareBtn.disabled=busy;
  els.snapshotCompareBtn.textContent=busy?'Preparant…':'Compara i prepara snapshot';
  els.snapshotDownloadBtn.disabled=true;
  els.snapshotDownloadBtn.textContent=count?'Descarrega snapshot amb propostes':'Descarrega snapshot nou';
  els.snapshotCurrentCount.textContent=String(state.accepted.length+state.inconsistencies.length);
  if(!preview){
    for(const el of [els.snapshotNewCount,els.snapshotAddedCount,els.snapshotRemovedCount,els.snapshotChangedCount,els.snapshotUnchangedCount])el.textContent='—';
    for(const button of [els.snapshotAddedCard,els.snapshotRemovedCard,els.snapshotChangedCard])button.disabled=true;
    showDetail(null);
    if(!busy)els.snapshotStatus.textContent=lastMessage||'Compara i prepara el snapshot per consultar el resultat final.';
    const conflicts=document.getElementById('snapshot-auto-conflicts');
    conflicts?.replaceChildren();
    conflicts?.classList.add('hidden');
    return;
  }
  const merged=plan();
  const data=compare(preview.baseItems,merged.payload);
  const counts=data.summary;
  els.snapshotCurrentCount.textContent=String(counts.current);
  els.snapshotNewCount.textContent=merged.unresolved.length?'—':String(counts.next);
  els.snapshotAddedCount.textContent=String(counts.added);
  els.snapshotRemovedCount.textContent=String(counts.removed);
  els.snapshotChangedCount.textContent=String(counts.changed);
  els.snapshotUnchangedCount.textContent=String(counts.unchanged);
  for(const [button,kind] of [[els.snapshotAddedCard,'added'],[els.snapshotRemovedCard,'removed'],[els.snapshotChangedCard,'changed']])button.disabled=busy||!data.details[kind].length;
  showDetail(data);
  renderConflicts(merged);
  const warning=preview.invalid?` ${preview.invalid} resultats no vàlids ignorats.`:'';
  const timestamp=preview.timestamp?new Date(preview.timestamp).toLocaleString('ca-ES',{dateStyle:'short',timeStyle:'short'}):'sense marca de temps';
  els.snapshotStatus.textContent=lastMessage||(merged.unresolved.length?`Cal resoldre ${merged.unresolved.length} conflicte${merged.unresolved.length===1?'':'s'} abans de descarregar.${warning}`:`Resultat preparat: ${counts.next} objectes · ${counts.added} nous · ${counts.removed} baixes · ${counts.changed} canviats · font ${timestamp}.${warning}`);
  els.snapshotDownloadBtn.disabled=busy||merged.unresolved.length>0;
}
async function prepare(){
  if(busy||!available())return;
  const signature=proposalSignature();
  busy=true;
  invalidate();
  render();
  els.snapshotStatus.textContent='Consultant OSM i preparant el resultat…';
  activity.begin('Regenerant snapshot',`Consultant OSM per a ${state.config.name}`);
  try{
    const baseItems=[...state.accepted];
    const baseRawCount=state.accepted.length+state.inconsistencies.length;
    const source=await getMonitorSnapshotData();
    if(!Array.isArray(source?.features))throw new Error('OSM no ha retornat una resposta vàlida.');
    if(!source.features.length&&baseItems.length)throw new Error('OSM ha retornat zero objectes.');
    const parsed=parsePostpass(source);
    if(!parsed.items.length&&baseItems.length)throw new Error('OSM no ha retornat cap objecte vàlid.');
    const unique=new Map();
    for(const item of parsed.items){
      const key=objectKeyFor(item);
      const old=unique.get(key);
      if(old&&!sameState(old,item))throw new Error(`OSM ha retornat diversos estats incompatibles per a ${key}.`);
      unique.set(key,item);
    }
    if(signature!==proposalSignature())throw new Error('La tasca o les propostes han canviat durant la consulta. Torna a preparar el snapshot.');
    preview={osmItems:[...unique.values()],baseItems,baseRawCount,invalid:Math.max(0,source.features.length-parsed.items.length),timestamp:parsed.timestamp,signature,proposals:[...state.importedProposals]};
    const merged=plan();
    activity.done(merged.unresolved.length?`Snapshot preparat amb ${merged.unresolved.length} conflictes pendents`:`Snapshot preparat: ${merged.payload.elements.length} objectes`);
  }catch(error){
    invalidate();
    activity.fail('No s’ha pogut preparar el snapshot',error);
    lastMessage=`Error: ${error?.message||error}`;
  }finally{
    busy=false;
    render();
  }
}
async function download(){
  if(busy||!preview||preview.signature!==proposalSignature())return;
  const merged=plan();
  if(merged.unresolved.length)return;
  const count=state.importedProposals.length;
  const filename=state.config.elementsFile;
  const description=count?`amb la base actual d’OSM i ${count} proposta${count===1?'':'es'} WERT`:'amb l’estat actual d’OSM';
  if(!window.confirm(`Es descarregarà ${filename} ${description}. Aquest serà el nou estat de referència del monitor. Vols continuar?`))return;
  busy=true;
  render();
  activity.begin('Generant snapshot',`Preparant ${filename}`);
  try{
    if(preview.signature!==proposalSignature())throw new Error('Les propostes han canviat. Torna a preparar el snapshot.');
    await downloadSnapshot(filename,merged.payload);
    activity.done(`${filename} descarregat`);
    lastMessage=`${filename} descarregat. Revisa’l abans de substituir manualment el fitxer al repositori.`;
  }catch(error){
    activity.fail('No s’ha pogut descarregar el snapshot',error);
    lastMessage=`Error: ${error?.message||error}`;
  }finally{
    busy=false;
    render();
  }
}
function intercept(button,handler){
  button?.addEventListener('click',event=>{
    event.preventDefault();
    event.stopImmediatePropagation();
    handler();
  },true);
}
export function initCombinedSnapshot(){
  if(initialized||!els.snapshotAdminSection||!els.snapshotCompareBtn||!els.snapshotDownloadBtn)return;
  initialized=true;
  intercept(els.snapshotCompareBtn,prepare);
  intercept(els.snapshotDownloadBtn,download);
  for(const [button,mode] of [[els.snapshotAddedCard,'added'],[els.snapshotRemovedCard,'removed'],[els.snapshotChangedCard,'changed']])intercept(button,()=>{
    if(!preview)return;
    detailMode=detailMode===mode?null:mode;
    render();
  });
  intercept(els.snapshotDetailCloseBtn,()=>{detailMode=null;render();});
  els.infoBtn?.addEventListener('click',render);
  els.taskSelect?.addEventListener('change',()=>{invalidate();render();});
  if(els.proposalsCount)new MutationObserver(render).observe(els.proposalsCount,{childList:true,subtree:true,characterData:true});
  render();
}
