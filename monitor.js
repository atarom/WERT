import {state} from './state.js';
import {els} from './dom.js';
import {acceptedToItem,isCompleteItem,objectKeyFor,sameState,trackedDifferences,trackedState,trackedStateText,compareItemsByName,parsePostpass,payloadFromItems} from './elements.js';
import {getOkCheckData,getOkCheckCacheStatus,getMonitorData,getMonitorDetailData,getMonitorSnapshotData,isMonitorTask} from './postpass.js';
import {rebuildCollections} from './changes.js';
import {activity} from './activity.js';
import {showError,clearError} from './ui.js';
import {downloadText,stringifyJson} from './io.js';
let okTimer=null;
let okClock=null;
let okBusy=false;
let okButton=null;
let renderAll=()=>{};
let baseItems=[];
let baseInconsistencies=[];
let baseRawCount=0;
let snapshotPreview=null;
let snapshotBusy=false;
let snapshotDetailMode=null;
function cloneItem(item){
  return{...item,tags:{...(item.tags||{})}};
}
function cloneIssue(issue){
  return{...issue,candidates:[...(issue.candidates||[])]};
}
function captureOkClock(status){
  const ttlMs=Math.max(0,Number(status?.ttlMs)||0);
  const savedAt=Number(status?.savedAt)||0;
  okClock={exists:Boolean(status?.exists),savedAt,ttlMs,expiresAt:savedAt&&ttlMs?savedAt+ttlMs:0};
}
function projectedOkStatus(){
  if(!okClock)return null;
  if(!okClock.exists)return{exists:false,fresh:false,ageMs:Infinity,remainingMs:0,savedAt:0,ttlMs:okClock.ttlMs};
  const remainingMs=Math.max(0,okClock.expiresAt-Date.now());
  const ageMs=Math.max(0,okClock.ttlMs-remainingMs);
  return{exists:true,fresh:remainingMs>0,ageMs,remainingMs,savedAt:okClock.savedAt,ttlMs:okClock.ttlMs};
}
function currentOkStatus(){
  return projectedOkStatus()||getOkCheckCacheStatus(baseItems);
}
function okClockDelay(status){
  const seconds=Math.max(1,Math.ceil(status.remainingMs/1000));
  return Math.max(50,Math.min(1000,status.remainingMs-(seconds-1)*1000+10));
}
function resultRows(payload,message){
  if(!Array.isArray(payload?.result))throw new Error(message);
  const rows=new Map();
  for(const row of payload.result){
    const type=String(row?.type||'').toLowerCase();
    const id=Number(row?.id);
    if(['node','way','relation'].includes(type)&&Number.isSafeInteger(id)&&id>0)rows.set(`${type}:${id}`,row);
  }
  return rows;
}
function issueState(item,row){
  const candidate=row?acceptedToItem({type:item.type,id:item.id,coordinates:item.coordinates,tags:row.tags}):null;
  const current=candidate&&isCompleteItem(candidate)?candidate:null;
  const differences=candidate?trackedDifferences(item,candidate):[];
  return{candidate,current,detail:differences.map(change=>`${change.key}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`).join(' · ')};
}
export function getOkBaseItems(){
  return baseItems;
}
export function setOkCheckBase(parsed){
  baseItems=parsed.items.map(cloneItem);
  baseInconsistencies=parsed.inconsistencies.map(cloneIssue);
  baseRawCount=Number(parsed.rawCount)||baseItems.length+baseInconsistencies.length;
  state.accepted=baseItems.map(cloneItem);
  state.inconsistencies=baseInconsistencies.map(cloneIssue);
  startOkCheckClock();
}
function makeOkIssue(item,row,kind){
  const objectKey=objectKeyFor(item);
  const{candidate,current,detail}=issueState(item,row);
  const message=kind==='osm-missing'?`L’objecte ${item.type} ${item.id} no apareix a la base actual de Postpass i s’ha marcat per eliminar d’OK.`:`Han canviat els tags controlats${detail?`: ${detail}`:''}. S’ha marcat per eliminar d’OK.`;
  return{issueId:`issue:okcheck:${objectKey}`,objectKey,lookupObjectKey:objectKey,type:item.type,id:item.id,name:item.name,coordinates:item.coordinates,candidates:[item],current,duplicateCount:1,sourceCount:1,kind,message,rawEntries:[],tags:item.tags||{},signature:JSON.stringify({objectKey,kind,expected:trackedState(item),current:candidate?trackedState(candidate):null})};
}
function applyOkPayload(payload){
  const previousIssues=new Map(state.inconsistencies.map(issue=>[issue.objectKey,issue]));
  const byObject=resultRows(payload,'La resposta de comprovació no conté un array result vàlid.');
  const accepted=[];
  const issues=[];
  let missing=0;
  let changed=0;
  for(const item of baseItems){
    const objectKey=objectKeyFor(item);
    const row=byObject.get(objectKey);
    if(!row){
      missing++;
      issues.push(makeOkIssue(item,null,'osm-missing'));
      continue;
    }
    const current=acceptedToItem({type:item.type,id:item.id,coordinates:item.coordinates,tags:row.tags});
    if(!sameState(item,current)){
      changed++;
      issues.push(makeOkIssue(item,row,'osm-state-changed'));
      continue;
    }
    accepted.push(cloneItem(item));
  }
  state.accepted=accepted;
  state.inconsistencies=[...baseInconsistencies.map(cloneIssue),...issues];
  const validIssueKeys=new Set(state.inconsistencies.map(issue=>issue.objectKey));
  for(const key of[...state.inconsistencyResolutions.keys()])if(!validIssueKeys.has(key))state.inconsistencyResolutions.delete(key);
  for(const issue of issues){
    const previous=previousIssues.get(issue.objectKey);
    if(!previous||previous.signature!==issue.signature||!state.inconsistencyResolutions.has(issue.objectKey))state.inconsistencyResolutions.set(issue.objectKey,{desired:null});
  }
  return{checked:baseItems.length,ok:accepted.length,missing,changed,issues:issues.length};
}
function okSummary(summary){
  return`Comprovació OK: ${summary.checked} comprovats · ${summary.ok} correctes · ${summary.missing} inexistents · ${summary.changed} estats canviats`;
}
export async function performOkCheck(rebuildNow){
  okBusy=true;
  updateOkCheckButton();
  try{
    const result=await getOkCheckData(baseItems);
    activity.step(result.source==='cache'?'Comprovació OK recuperada de la memòria cau':result.source==='empty'?'No hi ha elements OK per comprovar':'Nova comprovació OK rebuda',`Comparant type, id i tags controlats amb ${state.config.elementsFile}`);
    const summary=applyOkPayload(result.payload);
    activity.step(okSummary(summary),summary.issues?'Classificant incidències com a eliminar d’OK':'Tots els elements OK continuen vigents');
    if(rebuildNow){
      rebuildCollections();
      renderAll();
    }
    return summary;
  }finally{
    okBusy=false;
    startOkCheckClock();
  }
}
function ensureOkButton(){
  if(okButton)return;
  okButton=document.createElement('button');
  okButton.id='verify-ok-btn';
  okButton.className='button button-ghost';
  okButton.type='button';
  okButton.textContent='Comprova OK';
  els.reloadBtn.insertAdjacentElement('afterend',okButton);
  okButton.addEventListener('click',async()=>{
    if(okBusy||!baseItems.length||currentOkStatus().fresh)return;
    clearError();
    activity.begin('Comprovant elements OK',`Verificant ${baseItems.length} elements per type + id`);
    try{
      const summary=await performOkCheck(true);
      activity.done(okSummary(summary));
    }catch(error){
      showError(`No s’han pogut comprovar els elements OK. ${error?.message||error}`);
      activity.fail('No s’han pogut comprovar els elements OK',error);
    }
  });
}
export function updateOkCheckButton(status=null){
  if(!okButton)return;
  okButton.classList.toggle('hidden',isMonitorTask());
  if(isMonitorTask())return;
  const compact=window.matchMedia('(max-width:760px)').matches;
  if(okBusy){
    okButton.disabled=true;
    okButton.textContent=compact?'OK…':'Comprovant OK…';
    okButton.title='Comprovació dels elements OK en curs';
    return;
  }
  if(!baseItems.length){
    okButton.disabled=true;
    okButton.textContent=compact?'OK':'Comprova OK';
    okButton.title='No hi ha elements OK vàlids per comprovar';
    return;
  }
  const current=status||currentOkStatus();
  if(current.fresh){
    const seconds=Math.max(1,Math.ceil(current.remainingMs/1000));
    okButton.disabled=true;
    okButton.textContent=compact?`OK ${seconds}s`:`Comprova OK ${seconds}s`;
    okButton.title=`Comprovació recent. Nova consulta disponible en ${seconds} s`;
    return;
  }
  okButton.disabled=false;
  okButton.textContent=compact?'OK':'Comprova OK';
  okButton.title=`Comprova que els elements de ${state.config?.elementsFile||'la base OK'} existeixen i mantenen els tags controlats`;
}
function runOkCheckClock(){
  const status=projectedOkStatus();
  if(!status||document.hidden){okTimer=null;return;}
  updateOkCheckButton(status);
  if(!status.fresh){okTimer=null;return;}
  okTimer=setTimeout(runOkCheckClock,okClockDelay(status));
}
export function startOkCheckClock(){
  clearTimeout(okTimer);
  okTimer=null;
  if(isMonitorTask()){updateOkCheckButton();return;}
  if(!baseItems.length){okClock=null;updateOkCheckButton();return;}
  const status=getOkCheckCacheStatus(baseItems);
  captureOkClock(status);
  updateOkCheckButton(status);
  if(okBusy||!status.fresh||document.hidden)return;
  okTimer=setTimeout(runOkCheckClock,okClockDelay(status));
}
export function wireOkCheck(render){
  renderAll=render;
  ensureOkButton();
  updateOkCheckButton();
  window.addEventListener('resize',()=>updateOkCheckButton(projectedOkStatus()));
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(okTimer);okTimer=null;}});
}
function monitorIssue(item,row,kind){
  const objectKey=objectKeyFor(item);
  const{candidate,current,detail}=issueState(item,row);
  const message=kind==='monitor-missing'?`L’objecte ${item.type} ${item.id} ja no apareix a Postpass. Decideix si es conserva al monitor o s’elimina.`:`L’objecte continua existint però no té un estat controlat vàlid${detail?`: ${detail}`:''}. Decideix si es conserva al monitor o s’elimina.`;
  return{issueId:`issue:monitor:${objectKey}`,objectKey,lookupObjectKey:objectKey,type:item.type,id:item.id,name:item.name,coordinates:item.coordinates,candidates:[item],current,duplicateCount:1,sourceCount:1,kind,message,rawEntries:[],tags:row?.tags||item.tags||{},signature:JSON.stringify({objectKey,kind,expected:trackedState(item),current:candidate?trackedState(candidate):null})};
}
export function compareMonitorPayload(items,inconsistencies,payload){
  const byObject=resultRows(payload,'La resposta del monitor no conté un array result vàlid.');
  const changed=[];
  const issues=inconsistencies.map(cloneIssue);
  let ok=0;
  let missing=0;
  let invalid=0;
  for(const item of items){
    const row=byObject.get(objectKeyFor(item));
    if(!row){
      missing++;
      issues.push(monitorIssue(item,null,'monitor-missing'));
      continue;
    }
    const current=acceptedToItem({type:item.type,id:item.id,coordinates:item.coordinates,tags:row.tags});
    if(sameState(item,current)){
      ok++;
      continue;
    }
    if(!isCompleteItem(current)){
      invalid++;
      issues.push(monitorIssue(item,row,'monitor-invalid-state'));
      continue;
    }
    changed.push(current);
  }
  return{changed,issues,summary:{checked:items.length,ok,changed:changed.length,missing,invalid,issues:issues.length-inconsistencies.length},timestamp:payload.postpass_properties?.timestamp||null};
}
export async function performMonitorCheck(){
  const result=await getMonitorData(baseItems);
  activity.step(result.source==='cache'?'Monitor recuperat de la memòria cau':result.source==='empty'?'No hi ha objectes per monitoritzar':'Nova comprovació monitor rebuda',`Comparant ${baseItems.length} objectes per type + id i tags controlats`);
  const comparison=compareMonitorPayload(baseItems,baseInconsistencies,result.payload);
  state.accepted=baseItems.map(cloneItem);
  state.inconsistencies=comparison.issues;
  state.rawFeatures=comparison.changed;
  state.postpassTimestamp=comparison.timestamp;
  if(comparison.changed.length){
    activity.step(`${comparison.changed.length} canvis detectats`,'Carregant geometria i tags complets només dels objectes modificats');
    try{
      const detailPayload=await getMonitorDetailData(comparison.changed);
      const detail=parsePostpass(detailPayload);
      const detailByObject=new Map(detail.items.map(item=>[objectKeyFor(item),item]));
      state.rawFeatures=comparison.changed.map(item=>detailByObject.get(objectKeyFor(item))||item);
      state.postpassTimestamp=detail.timestamp||comparison.timestamp;
      activity.step(`Detall carregat per ${detail.items.length} objectes modificats`,'Preparant la revisió');
    }catch(error){
      activity.step(`No s’ha pogut carregar el detall dels canvis: ${error?.message||error}`,'Es mostraran amb els tags controlats i les coordenades guardades');
    }
  }
  rebuildCollections();
  return comparison.summary;
}
function snapshotSourceAvailable(){
  const relationId=Number(state.config?.monitor?.sourceRelationId);
  return isMonitorTask()&&Number.isSafeInteger(relationId)&&relationId>0;
}
function snapshotDetailButtons(){
  return[[els.snapshotAddedCard,'added'],[els.snapshotRemovedCard,'removed'],[els.snapshotChangedCard,'changed']];
}
function snapshotTagValue(value){
  return value===null?'(absent)':String(value);
}
function snapshotDetailDescription(mode){
  if(mode==='added')return'Objectes que entren al snapshot nou. Es mostren els tags controlats que s’adoptaran.';
  if(mode==='removed')return'Objectes presents al snapshot actual que ja no apareixen a la font.';
  return'Objectes que continuen presents però tenen algun tag controlat diferent.';
}
function snapshotDetailLabel(mode){
  if(mode==='added')return'Nous';
  if(mode==='removed')return'Ja no hi són';
  return'Estat canviat';
}
function renderSnapshotDetail(){
  if(!els.snapshotDetailSection)return;
  for(const[button,mode]of snapshotDetailButtons())if(button)button.setAttribute('aria-pressed',String(Boolean(snapshotPreview)&&snapshotDetailMode===mode));
  if(!snapshotPreview||!snapshotDetailMode){
    els.snapshotDetailSection.classList.add('hidden');
    els.snapshotDetailList?.replaceChildren();
    return;
  }
  const records=snapshotPreview.details?.[snapshotDetailMode]||[];
  if(!records.length){
    snapshotDetailMode=null;
    els.snapshotDetailSection.classList.add('hidden');
    els.snapshotDetailList?.replaceChildren();
    return;
  }
  els.snapshotDetailSection.classList.remove('hidden');
  els.snapshotDetailTitle.textContent=`${snapshotDetailLabel(snapshotDetailMode)} · ${records.length}`;
  els.snapshotDetailHint.textContent=snapshotDetailDescription(snapshotDetailMode);
  const fragment=document.createDocumentFragment();
  for(const record of records){
    const item=snapshotDetailMode==='changed'?record.after:record;
    const row=document.createElement('a');
    row.className='change-row';
    row.href=`https://www.openstreetmap.org/${item.type}/${item.id}`;
    row.target='_blank';
    row.rel='noopener noreferrer';
    row.title='Obre a OpenStreetMap';
    row.style.display='block';
    row.style.color='inherit';
    row.style.textDecoration='none';
    const name=document.createElement('strong');
    name.textContent=String(item.name||'(sense nom)');
    const meta=document.createElement('span');
    meta.textContent=`${item.type} ${item.id}`;
    const detail=document.createElement('div');
    detail.textContent=snapshotDetailMode==='changed'?record.differences.map(change=>`${change.key}: ${snapshotTagValue(change.before)} → ${snapshotTagValue(change.after)}`).join(' · '):trackedStateText(item);
    row.append(name,meta,detail);
    fragment.append(row);
  }
  els.snapshotDetailList.replaceChildren(fragment);
}
function setSnapshotDetailMode(mode){
  if(!snapshotPreview)return;
  const records=snapshotPreview.details?.[mode]||[];
  if(!records.length)return;
  snapshotDetailMode=snapshotDetailMode===mode?null:mode;
  renderSnapshotDetail();
}
export function renderSnapshotAdmin(){
  if(!els.snapshotAdminSection)return;
  const available=snapshotSourceAvailable();
  els.snapshotAdminSection.classList.toggle('hidden',!available);
  if(!available)return;
  const relationId=Number(state.config.monitor.sourceRelationId);
  const required=Array.isArray(state.config.monitor.sourceRequireTags)&&state.config.monitor.sourceRequireTags.length?state.config.monitor.sourceRequireTags:state.config.trackedTags||[];
  els.snapshotSourceText.textContent=`Font: relació OSM ${relationId} · tags obligatoris: ${required.join(', ')||'—'}.`;
  els.snapshotCurrentCount.textContent=String(baseRawCount||baseItems.length);
  els.snapshotCompareBtn.disabled=snapshotBusy;
  els.snapshotCompareBtn.textContent=snapshotBusy?'Preparant…':'Compara i prepara snapshot';
  els.snapshotDownloadBtn.disabled=snapshotBusy||!snapshotPreview;
  const detailCounts=snapshotPreview?.summary||{};
  for(const[button,mode]of snapshotDetailButtons())if(button)button.disabled=snapshotBusy||!snapshotPreview||!Number(detailCounts[mode]);
  if(!snapshotPreview){
    for(const element of[els.snapshotNewCount,els.snapshotAddedCount,els.snapshotRemovedCount,els.snapshotChangedCount,els.snapshotUnchangedCount])element.textContent='—';
    els.snapshotStatus.textContent=baseInconsistencies.length?`El snapshot actual conté ${baseInconsistencies.length} inconsistència${baseInconsistencies.length===1?'':'es'}. La regeneració partirà directament de l’estat actual d’OSM.`:'Encara no s’ha generat cap previsualització.';
    renderSnapshotDetail();
    return;
  }
  const summary=snapshotPreview.summary;
  els.snapshotNewCount.textContent=String(summary.next);
  els.snapshotAddedCount.textContent=String(summary.added);
  els.snapshotRemovedCount.textContent=String(summary.removed);
  els.snapshotChangedCount.textContent=String(summary.changed);
  els.snapshotUnchangedCount.textContent=String(summary.unchanged);
  const timestamp=snapshotPreview.timestamp?new Date(snapshotPreview.timestamp).toLocaleString('ca-ES',{dateStyle:'medium',timeStyle:'medium'}):'sense timestamp';
  const warnings=[];
  if(snapshotPreview.invalid){
    const suffix=snapshotPreview.invalid===1?'':'s';
    warnings.push(`${snapshotPreview.invalid} resultat${suffix} invàlid${suffix} ignorat${suffix}`);
  }
  if(baseInconsistencies.length)warnings.push(`${baseInconsistencies.length} inconsistència${baseInconsistencies.length===1?'':'es'} al snapshot actual`);
  els.snapshotStatus.textContent=`Previsualització preparada amb dades de ${timestamp}.${warnings.length?` ${warnings.join(' · ')}.`:''}`;
  renderSnapshotDetail();
}
function compareSnapshotItems(nextItems){
  const currentByObject=new Map(baseItems.map(item=>[objectKeyFor(item),item]));
  const nextByObject=new Map(nextItems.map(item=>[objectKeyFor(item),item]));
  const added=[];
  const removed=[];
  const changed=[];
  let unchanged=0;
  for(const[itemKey,item]of nextByObject){
    const current=currentByObject.get(itemKey);
    if(!current){added.push(item);continue;}
    if(sameState(current,item))unchanged++;
    else changed.push({before:current,after:item,differences:trackedDifferences(current,item)});
  }
  for(const[itemKey,item]of currentByObject)if(!nextByObject.has(itemKey))removed.push(item);
  added.sort(compareItemsByName);
  removed.sort(compareItemsByName);
  changed.sort((a,b)=>compareItemsByName(a.after,b.after));
  return{summary:{current:baseRawCount||baseItems.length,next:nextByObject.size,added:added.length,removed:removed.length,changed:changed.length,unchanged},details:{added,removed,changed}};
}
export async function prepareMonitorSnapshot(){
  if(!snapshotSourceAvailable())throw new Error('La tasca no té una font de snapshot configurada.');
  snapshotBusy=true;
  snapshotPreview=null;
  snapshotDetailMode=null;
  renderSnapshotAdmin();
  activity.begin('Regenerant snapshot',`Consultant la font actual de ${state.config.name}`);
  try{
    const source=await getMonitorSnapshotData();
    if(!source.features.length&&baseItems.length)throw new Error('La font no ha retornat cap objecte. No es generarà un snapshot buit.');
    activity.step(`Font rebuda: ${source.features.length} resultats`,'Validant objectes i preparant el JSON compacte');
    const parsed=parsePostpass(source);
    if(!parsed.items.length&&baseItems.length)throw new Error('La font no ha produït cap objecte vàlid. No es generarà un snapshot buit.');
    const payload=payloadFromItems(parsed.items);
    const comparison=compareSnapshotItems(parsed.items);
    const summary=comparison.summary;
    const invalid=Math.max(0,source.features.length-parsed.items.length);
    snapshotPreview={payload,summary,details:comparison.details,invalid,timestamp:parsed.timestamp};
    renderSnapshotAdmin();
    activity.done(`Snapshot preparat: ${summary.next} objectes · ${summary.added} nous · ${summary.removed} ja no hi són · ${summary.changed} canviats`);
  }catch(error){
    snapshotPreview=null;
    snapshotDetailMode=null;
    renderSnapshotAdmin();
    showError(`No s’ha pogut preparar el snapshot. ${error?.message||error}`);
    activity.fail('No s’ha pogut preparar el snapshot',error);
    throw error;
  }finally{
    snapshotBusy=false;
    renderSnapshotAdmin();
  }
}
function downloadSnapshot(){
  if(!snapshotPreview)return;
  const message=`Es descarregarà un ${state.config.elementsFile} complet amb l’estat actual d’OSM. Això farà que tots els noms actuals passin a ser la nova referència del monitor. Vols continuar?`;
  if(!window.confirm(message))return;
  downloadText(state.config.elementsFile,stringifyJson(snapshotPreview.payload),'application/json;charset=utf-8');
  els.snapshotStatus.textContent=`${state.config.elementsFile} descarregat. Substitueix el fitxer del repositori només si vols adoptar aquest snapshot com a nova referència.`;
}
export function resetSnapshotAdmin(){
  snapshotPreview=null;
  snapshotDetailMode=null;
  renderSnapshotAdmin();
}
export function wireMonitorSnapshot(){
  els.snapshotCompareBtn?.addEventListener('click',async()=>{if(snapshotBusy)return;try{await prepareMonitorSnapshot();}catch{}});
  els.snapshotDownloadBtn?.addEventListener('click',downloadSnapshot);
  for(const[button,mode]of snapshotDetailButtons())button?.addEventListener('click',()=>setSnapshotDetailMode(mode));
  els.snapshotDetailCloseBtn?.addEventListener('click',()=>{snapshotDetailMode=null;renderSnapshotDetail();});
}
