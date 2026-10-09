import {state} from './state.js';
import {els} from './dom.js';
import {getMonitorSnapshotData} from './postpass.js';
import {parsePostpass,objectKeyFor,keyFor,sameState,fileElementToItem,trackedStateText} from './elements.js';
import {buildMergedPayload,conflictChoices} from './proposals.js';
import {downloadSnapshot} from './sqlite.js';
import {activity} from './activity.js';
let preview=null;
let busy=false;
let resolutions=new Map();
let section=null;
let prepareButton=null;
let downloadButton=null;
let status=null;
let summary=null;
let conflicts=null;
function element(tag,className,value,parent){
  const node=document.createElement(tag);
  if(className)node.className=className;
  if(value!==undefined&&value!==null)node.textContent=String(value);
  if(parent)parent.append(node);
  return node;
}
function available(){
  const relationId=Number(state.config?.monitor?.sourceRelationId);
  return state.config?.mode==='monitor'&&Number.isSafeInteger(relationId)&&relationId>0;
}
function importSignature(){
  return JSON.stringify([state.taskId,state.baseHash,state.config?.elementsFile,state.config?.monitor?.sourceRelationId,state.importedProposals.map(proposal=>[proposal.id,proposal.filename,proposal.baseHash,proposal.add.map(keyFor),proposal.remove.map(keyFor),proposal.resolve.map(resolution=>[resolution.objectKey,resolution.issueSignature,resolution.desired?keyFor(resolution.desired):null])])]);
}
function planMerge(){
  if(!preview)throw new Error('No hi ha cap previsualització preparada.');
  const originalAccepted=state.accepted;
  const originalInconsistencies=state.inconsistencies;
  const originalResolutions=state.conflictResolutions;
  try{
    state.accepted=preview.items;
    state.inconsistencies=[];
    state.conflictResolutions=resolutions;
    return buildMergedPayload();
  }finally{
    state.accepted=originalAccepted;
    state.inconsistencies=originalInconsistencies;
    state.conflictResolutions=originalResolutions;
  }
}
function differences(payload){
  const previous=new Map(preview.items.map(item=>[objectKeyFor(item),item]));
  const next=new Map(payload.elements.map(raw=>{const item=fileElementToItem(raw);return[objectKeyFor(item),item];}));
  let added=0;
  let removed=0;
  let changed=0;
  for(const[key,item]of next){
    const before=previous.get(key);
    if(!before)added++;
    else if(!sameState(before,item))changed++;
  }
  for(const key of previous.keys())if(!next.has(key))removed++;
  return{added,removed,changed};
}
function field(label,value){
  const card=element('div','summary-card',null,summary);
  element('span','',label,card);
  element('strong','',value,card);
}
function invalidate(){
  preview=null;
  resolutions=new Map();
  summary.replaceChildren();
  conflicts.replaceChildren();
  downloadButton.disabled=true;
}
function update(){
  if(!section)return;
  const enabled=available();
  section.classList.toggle('hidden',!enabled);
  if(!enabled)return;
  if(preview&&preview.signature!==importSignature()){
    invalidate();
    status.textContent='La tasca o les propostes han canviat. Torna a preparar la combinació.';
  }
  prepareButton.disabled=busy||state.importedProposals.length===0;
  prepareButton.textContent=busy?'Preparant…':'Compara i prepara snapshot + propostes';
  downloadButton.disabled=true;
  if(!preview){
    if(!busy&&state.importedProposals.length===0)status.textContent='Importa una o més propostes WERT abans de preparar la combinació.';
    return;
  }
  const merged=planMerge();
  const change=differences(merged.payload);
  const unresolved=merged.unresolved.length;
  const allConflicts=merged.plan.conflicts;
  summary.replaceChildren();
  field('OSM actual',preview.items.length);
  field('Propostes',state.importedProposals.length);
  field('Resultat combinat',unresolved?'—':merged.payload.elements.length);
  field('Altes aplicades',unresolved?'—':change.added);
  field('Baixes aplicades',unresolved?'—':change.removed);
  field('Estats canviats',unresolved?'—':change.changed);
  field('Conflictes',allConflicts.length);
  conflicts.replaceChildren();
  if(allConflicts.length){
    element('h4','',`Conflictes amb OSM · ${allConflicts.length}`,conflicts);
    element('p','hint','Escull l’estat final de cada objecte abans de descarregar.',conflicts);
    for(const conflict of allConflicts){
      const card=element('div','change-row',null,conflicts);
      element('strong','',conflict.current?.name||conflict.objectKey,card);
      element('div','hint',`${conflict.objectKey} · ${conflict.sources.join(', ')}`,card);
      if(conflict.current)element('div','hint',`OSM: ${trackedStateText(conflict.current)}`,card);
      if(conflict.reasons.length)element('div','hint',conflict.reasons.join(' '),card);
      const select=element('select','conflict-options',null,card);
      const empty=element('option','', 'Selecciona l’estat final…',select);
      empty.value='';
      for(const choice of conflictChoices(conflict)){
        const option=element('option','',choice.label,select);
        option.value=choice.value;
      }
      select.value=resolutions.get(conflict.objectKey)||'';
      select.setAttribute('aria-label',`Decisió per a ${conflict.objectKey}`);
      select.addEventListener('change',()=>{
        if(select.value)resolutions.set(conflict.objectKey,select.value);
        else resolutions.delete(conflict.objectKey);
        update();
      });
    }
  }
  const rejected=preview.invalid?` · ${preview.invalid} registres descartats de la consulta`:'';
  status.textContent=unresolved?`Queden ${unresolved} conflictes o incidències pendents.${rejected}`:`Combinació preparada: ${merged.payload.elements.length} objectes; ${change.added} altes, ${change.removed} baixes i ${change.changed} estats canviats respecte a OSM.${rejected}`;
  downloadButton.disabled=busy||unresolved>0||!state.importedProposals.length;
}
async function prepare(){
  if(busy||!available()||!state.importedProposals.length)return;
  const signature=importSignature();
  busy=true;
  invalidate();
  status.textContent='Consultant OSM i preparant les propostes…';
  update();
  activity.begin('Preparant snapshot i propostes',`Consultant OSM per a ${state.config.name}`);
  try{
    const source=await getMonitorSnapshotData();
    if(!Array.isArray(source?.features))throw new Error('La font OSM no ha retornat una col·lecció vàlida.');
    if(!source.features.length&&state.accepted.length)throw new Error('La consulta OSM ha retornat zero objectes.');
    const parsed=parsePostpass(source);
    if(!parsed.items.length&&state.accepted.length)throw new Error('OSM no ha retornat cap objecte vàlid.');
    const unique=new Map();
    for(const item of parsed.items){
      const objectKey=objectKeyFor(item);
      const previous=unique.get(objectKey);
      if(previous&&!sameState(previous,item))throw new Error(`OSM ha retornat estats incompatibles per a ${objectKey}.`);
      unique.set(objectKey,item);
    }
    if(signature!==importSignature())throw new Error('Les propostes o la tasca han canviat durant la consulta. Torna a preparar la combinació.');
    preview={items:[...unique.values()],invalid:Math.max(0,source.features.length-parsed.items.length),timestamp:parsed.timestamp,signature};
    update();
    activity.done(`Consulta OSM preparada: ${preview.items.length} objectes i ${state.importedProposals.length} propostes`);
  }catch(error){
    invalidate();
    status.textContent=`No s’ha pogut preparar la combinació: ${error?.message||error}`;
    activity.fail('No s’ha pogut combinar snapshot i propostes',error);
  }finally{
    busy=false;
    update();
  }
}
async function download(){
  if(busy||!preview||preview.signature!==importSignature())return;
  const merged=planMerge();
  if(merged.unresolved.length||!state.importedProposals.length)return;
  const filename=state.config.elementsFile;
  if(!window.confirm(`Es descarregarà ${filename} amb la base actual d’OSM i les ${state.importedProposals.length} propostes importades. El repositori no es modificarà automàticament. Vols continuar?`))return;
  busy=true;
  update();
  activity.begin('Descarregant snapshot combinat',`Generant ${filename}`);
  try{
    if(preview.signature!==importSignature())throw new Error('Les propostes han canviat. Torna a preparar la combinació.');
    await downloadSnapshot(filename,merged.payload);
    activity.done(`${filename} combinat descarregat`);
    status.textContent=`${filename} combinat descarregat. Substitueix manualment el fitxer al repositori quan hagis verificat el resultat.`;
  }catch(error){
    status.textContent=`No s’ha pogut generar el fitxer: ${error?.message||error}`;
    activity.fail('Error de descàrrega combinada',error);
  }finally{
    busy=false;
    update();
  }
}
let initialized=false;
export function initCombinedSnapshot(){
  if(initialized)return;
  section=document.getElementById('snapshot-combined-section');
  if(!els.snapshotAdminSection||!section)return;
  prepareButton=document.getElementById('snapshot-combined-prepare-btn');
  downloadButton=document.getElementById('snapshot-combined-download-btn');
  summary=document.getElementById('snapshot-combined-summary');
  conflicts=document.getElementById('snapshot-combined-conflicts');
  status=document.getElementById('snapshot-combined-status');
  if(!prepareButton||!downloadButton||!summary||!conflicts||!status)return;
  initialized=true;
  prepareButton.addEventListener('click',prepare);
  downloadButton.addEventListener('click',download);
  els.infoBtn?.addEventListener('click',update);
  els.taskSelect?.addEventListener('change',()=>{invalidate();update();});
  if(els.proposalsCount)new MutationObserver(update).observe(els.proposalsCount,{childList:true,subtree:true,characterData:true});
  update();
}
