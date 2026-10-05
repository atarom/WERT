import {state} from './state.js';
import {$,els} from './dom.js';
import {parseAccepted,parsePostpass,objectKeyFor,acceptedToItem,isCompleteItem,trackedDifferences,sameState,trackedState} from './elements.js';
import {compileQuery,loadJson,getPostpassData,getPostpassCacheStatus,getOkCheckData,getOkCheckCacheStatus,getMonitorData,getMonitorCacheStatus,getMonitorDetailData,isMonitorTask} from './postpass.js';
import {rebuildCollections,hasUnsavedChanges,buildResultPayload,markCurrentChangesSaved,clearSessionChanges} from './changes.js';
import {createMap,renderMap,setMapHooks} from './map.js';
import {showError,clearError,renderList,renderCounters,renderTabs,renderChangesDialog,renderProposalManager,renderInfo,renderRegexTest} from './ui.js';
import {activity} from './activity.js';
import {downloadText,copyText} from './io.js';
import {refreshBaseHash,proposalFilename,buildProposalPayload,importProposalFiles,buildMergedPayload} from './proposals.js';
import {compareMonitorPayload} from './monitor.js';
function renderAll(){
  renderTabs();
  renderCounters();
  renderList();
  renderMap();
}
setMapHooks({renderAll,renderList});
let reloadTimer=null;
let refreshBusy=false;
let okCheckTimer=null;
let okCheckBusy=false;
let okCheckButton=null;
let okBaseItems=[];
let okBaseInconsistencies=[];
function reloadCacheStatus(){
  return isMonitorTask()?getMonitorCacheStatus(okBaseItems):getPostpassCacheStatus();
}
function updateReloadButton(){
  if(!state.config?.postpass)return;
  const label=isMonitorTask()?'Comprova':'Actualitza';
  if(refreshBusy){
    els.reloadBtn.disabled=true;
    els.reloadBtn.classList.remove('cooldown');
    els.reloadBtn.style.setProperty('--cooldown-progress','100%');
    els.reloadBtn.textContent=isMonitorTask()?'Comprovant…':'Actualitzant…';
    els.reloadBtn.title='Consulta Postpass en curs';
    return;
  }
  const status=reloadCacheStatus();
  if(status.fresh){
    const seconds=Math.max(1,Math.ceil(status.remainingMs/1000));
    const progress=status.ttlMs?Math.max(0,Math.min(100,status.remainingMs/status.ttlMs*100)):0;
    els.reloadBtn.disabled=true;
    els.reloadBtn.classList.add('cooldown');
    els.reloadBtn.style.setProperty('--cooldown-progress',`${progress}%`);
    els.reloadBtn.textContent=`${label} ${seconds}s`;
    els.reloadBtn.title=`La memòria cau Postpass continua vigent. Nova consulta disponible en ${seconds} s`;
    return;
  }
  els.reloadBtn.disabled=false;
  els.reloadBtn.classList.remove('cooldown');
  els.reloadBtn.style.setProperty('--cooldown-progress','0%');
  els.reloadBtn.textContent=label;
  els.reloadBtn.title=isMonitorTask()?'Torna a comprovar els objectes monitoritzats':'Torna a consultar Postpass';
}
function startReloadClock(){
  clearInterval(reloadTimer);
  reloadTimer=null;
  updateReloadButton();
  if(refreshBusy||!reloadCacheStatus().fresh)return;
  reloadTimer=setInterval(()=>{updateReloadButton();if(!reloadCacheStatus().fresh){clearInterval(reloadTimer);reloadTimer=null;}},250);
}
function ensureOkCheckButton(){
  if(okCheckButton)return okCheckButton;
  okCheckButton=document.createElement('button');
  okCheckButton.id='verify-ok-btn';
  okCheckButton.className='button button-ghost';
  okCheckButton.type='button';
  okCheckButton.textContent='Comprova OK';
  els.reloadBtn.insertAdjacentElement('afterend',okCheckButton);
  okCheckButton.addEventListener('click',async()=>{
    if(okCheckBusy||!okBaseItems.length||getOkCheckCacheStatus(okBaseItems).fresh)return;
    clearError();
    activity.begin('Comprovant elements OK',`Verificant ${okBaseItems.length} elements per type + id`);
    try{
      const summary=await performOkCheck(true);
      activity.done(formatOkCheckSummary(summary));
    }catch(error){
      showError(`No s’han pogut comprovar els elements OK. ${error?.message||error}`);
      activity.fail('No s’han pogut comprovar els elements OK',error);
    }
  });
  updateOkCheckButton();
  return okCheckButton;
}
function updateOkCheckButton(){
  if(!okCheckButton)return;
  okCheckButton.classList.toggle('hidden',isMonitorTask());
  if(isMonitorTask())return;
  const compact=window.matchMedia('(max-width:760px)').matches;
  if(okCheckBusy){
    okCheckButton.disabled=true;
    okCheckButton.textContent=compact?'OK…':'Comprovant OK…';
    okCheckButton.title='Comprovació dels elements OK en curs';
    return;
  }
  if(!okBaseItems.length){
    okCheckButton.disabled=true;
    okCheckButton.textContent=compact?'OK':'Comprova OK';
    okCheckButton.title='No hi ha elements OK vàlids per comprovar';
    return;
  }
  const status=getOkCheckCacheStatus(okBaseItems);
  if(status.fresh){
    const seconds=Math.max(1,Math.ceil(status.remainingMs/1000));
    okCheckButton.disabled=true;
    okCheckButton.textContent=compact?`OK ${seconds}s`:`Comprova OK ${seconds}s`;
    okCheckButton.title=`Comprovació recent. Nova consulta disponible en ${seconds} s`;
    return;
  }
  okCheckButton.disabled=false;
  okCheckButton.textContent=compact?'OK':'Comprova OK';
  okCheckButton.title=`Comprova que els elements de ${state.config?.elementsFile||'la base OK'} existeixen i mantenen els tags controlats`;
}
function startOkCheckClock(){
  clearInterval(okCheckTimer);
  okCheckTimer=null;
  updateOkCheckButton();
  if(isMonitorTask())return;
  if(okCheckBusy||!okBaseItems.length||!getOkCheckCacheStatus(okBaseItems).fresh)return;
  okCheckTimer=setInterval(()=>{updateOkCheckButton();if(!getOkCheckCacheStatus(okBaseItems).fresh){clearInterval(okCheckTimer);okCheckTimer=null;}},250);
}
function cloneBaseIssue(issue){
  return{...issue,candidates:[...(issue.candidates||[])]};
}
function setOkCheckBase(parsed){
  okBaseItems=parsed.items.map(item=>({...item,tags:{...(item.tags||{})}}));
  okBaseInconsistencies=parsed.inconsistencies.map(cloneBaseIssue);
  state.accepted=okBaseItems.map(item=>({...item,tags:{...(item.tags||{})}}));
  state.inconsistencies=okBaseInconsistencies.map(cloneBaseIssue);
  startOkCheckClock();
}
function makeOkCheckIssue(item,row,kind){
  const objectKey=objectKeyFor(item);
  const currentCandidate=row?acceptedToItem({type:item.type,id:item.id,coordinates:item.coordinates,tags:row.tags}):null;
  const current=currentCandidate&&isCompleteItem(currentCandidate)?currentCandidate:null;
  const differences=currentCandidate?trackedDifferences(item,currentCandidate):[];
  const detail=differences.map(change=>`${change.key}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`).join(' · ');
  const message=kind==='osm-missing'?`L’objecte ${item.type} ${item.id} no apareix a la base actual de Postpass i s’ha marcat per eliminar d’OK.`:`Han canviat els tags controlats${detail?`: ${detail}`:''}. S’ha marcat per eliminar d’OK.`;
  return{issueId:`issue:okcheck:${objectKey}`,objectKey,lookupObjectKey:objectKey,type:item.type,id:item.id,name:item.name,coordinates:item.coordinates,candidates:[item],current,duplicateCount:1,sourceCount:1,kind,message,rawEntries:[],tags:item.tags||{},signature:JSON.stringify({objectKey,kind,expected:trackedState(item),current:currentCandidate?trackedState(currentCandidate):null})};
}
function applyOkCheckPayload(payload){
  if(!Array.isArray(payload?.result))throw new Error('La resposta de comprovació no conté un array result vàlid.');
  const previousIssues=new Map(state.inconsistencies.map(issue=>[issue.objectKey,issue]));
  const byObject=new Map();
  for(const row of payload.result){
    const type=String(row?.type||'').toLowerCase();
    const id=Number(row?.id);
    if(!['node','way','relation'].includes(type)||!Number.isSafeInteger(id)||id<=0)continue;
    byObject.set(`${type}:${id}`,row);
  }
  const accepted=[];
  const issues=[];
  let missing=0;
  let changed=0;
  for(const item of okBaseItems){
    const objectKey=objectKeyFor(item);
    const row=byObject.get(objectKey);
    if(!row){
      missing++;
      issues.push(makeOkCheckIssue(item,null,'osm-missing'));
      continue;
    }
    const current=acceptedToItem({type:item.type,id:item.id,coordinates:item.coordinates,tags:row.tags});
    if(!sameState(item,current)){
      changed++;
      issues.push(makeOkCheckIssue(item,row,'osm-state-changed'));
      continue;
    }
    accepted.push({...item,tags:{...item.tags}});
  }
  state.accepted=accepted;
  state.inconsistencies=[...okBaseInconsistencies.map(cloneBaseIssue),...issues];
  const validIssueKeys=new Set(state.inconsistencies.map(issue=>issue.objectKey));
  for(const key of[...state.inconsistencyResolutions.keys()])if(!validIssueKeys.has(key))state.inconsistencyResolutions.delete(key);
  for(const issue of issues){
    const previous=previousIssues.get(issue.objectKey);
    if(!previous||previous.signature!==issue.signature||!state.inconsistencyResolutions.has(issue.objectKey))state.inconsistencyResolutions.set(issue.objectKey,{desired:null});
  }
  return{checked:okBaseItems.length,ok:accepted.length,missing,changed,issues:issues.length};
}
function formatOkCheckSummary(summary){
  return`Comprovació OK: ${summary.checked} comprovats · ${summary.ok} correctes · ${summary.missing} inexistents · ${summary.changed} estats canviats`;
}
async function performOkCheck(rebuildNow){
  okCheckBusy=true;
  updateOkCheckButton();
  try{
    const result=await getOkCheckData(okBaseItems);
    activity.step(result.source==='cache'?'Comprovació OK recuperada de la memòria cau':result.source==='empty'?'No hi ha elements OK per comprovar':'Nova comprovació OK rebuda',`Comparant type, id i tags controlats amb ${state.config.elementsFile}`);
    const summary=applyOkCheckPayload(result.payload);
    activity.step(formatOkCheckSummary(summary),summary.issues?'Classificant incidències com a eliminar d’OK':'Tots els elements OK continuen vigents');
    if(rebuildNow){
      rebuildCollections();
      renderAll();
    }
    return summary;
  }finally{
    okCheckBusy=false;
    startOkCheckClock();
  }
}
async function performMonitorCheck(){
  const result=await getMonitorData(okBaseItems);
  activity.step(result.source==='cache'?'Monitor recuperat de la memòria cau':result.source==='empty'?'No hi ha objectes per monitoritzar':'Nova comprovació monitor rebuda',`Comparant ${okBaseItems.length} objectes per type + id i tags controlats`);
  const comparison=compareMonitorPayload(okBaseItems,okBaseInconsistencies,result.payload);
  state.accepted=okBaseItems.map(item=>({...item,tags:{...(item.tags||{})}}));
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
function setMode(mode){
  if(isMonitorTask()&&mode==='accepted')mode='pending';
  if(state.mode===mode)return;
  state.mode=mode;
  state.selectedKey=null;
  state.popup?.remove();
  state.search='';
  state.type='all';
  els.searchInput.value='';
  els.typeFilter.value='all';
  renderAll();
}
function discardChanges(){
  if(!state.addKeys.size&&!state.removeKeys.size&&!state.inconsistencyResolutions.size)return;
  if(!window.confirm('Vols descartar tots els canvis seleccionats d’aquesta sessió?'))return;
  clearSessionChanges();
  state.popup?.remove();
  renderAll();
  renderChangesDialog();
}
function configureTasks(){
  els.taskSelect.replaceChildren();
  for(const task of state.appConfig.tasks||[]){
    const option=document.createElement('option');
    option.value=task.id;
    option.textContent=task.name;
    option.disabled=!task.available;
    option.selected=task.id===state.taskId;
    els.taskSelect.append(option);
  }
  const pendingText=els.pendingTab.childNodes[0];
  if(pendingText)pendingText.textContent=isMonitorTask()?'Canvis ':'Pendents ';
  els.acceptedTab.classList.toggle('hidden',isMonitorTask());
  if(isMonitorTask()&&state.mode==='accepted')state.mode='pending';
}
function selectTaskConfig(){
  const requested=new URLSearchParams(location.search).get('task');
  const tasks=state.appConfig.tasks||[];
  const matches=(item,value)=>item.id===value;
  let task=tasks.find(item=>requested&&matches(item,requested)&&item.available);
  if(!task)task=tasks.find(item=>matches(item,state.appConfig.defaultTaskId)&&item.available)||tasks.find(item=>item.available);
  if(!task)throw new Error('No hi ha cap tasca disponible a config.json.');
  state.taskId=task.id;
  state.config=task;
}
async function handleProposalFiles(files){
  activity.begin('Important propostes',`${files.length} fitxer${files.length===1?'':'s'} seleccionat${files.length===1?'':'s'}`);
  try{
    const messages=await importProposalFiles(files);
    els.proposalStatus.textContent=messages.join(' · ');
    activity.step('Analitzant concurrència, inconsistències i conflictes');
    renderCounters();
    renderProposalManager();
    const merged=buildMergedPayload();
    activity.done(`Importació acabada: ${state.importedProposals.length} proposta${state.importedProposals.length===1?'':'es'} i ${merged.unresolved.length} decisió${merged.unresolved.length===1?'':'s'} pendent${merged.unresolved.length===1?'':'s'}`);
  }catch(error){
    activity.fail('Error en importar propostes',error);
    throw error;
  }
}
async function refreshData(resetActivity=true){
  clearError();
  refreshBusy=true;
  updateReloadButton();
  if(resetActivity)activity.begin('Actualitzant WERT',`Carregant ${state.config.elementsFile}`);else activity.step(`Carregant ${state.config.elementsFile}`);
  try{
    const acceptedPayload=await loadJson(state.config.elementsFile);
    const acceptedParsed=parseAccepted(acceptedPayload);
    setOkCheckBase(acceptedParsed);
    activity.step(`${state.config.elementsFile} carregat: ${state.accepted.length} acceptats i ${state.inconsistencies.length} inconsistència${state.inconsistencies.length===1?'':'es'}`,'Calculant empremta SHA-256 de la base');
    await refreshBaseHash();
    if(isMonitorTask()){
      activity.step(`Base identificada: ${state.baseHash.slice(0,10)}…`,'Comprovant els objectes monitoritzats per type + id');
      const summary=await performMonitorCheck();
      activity.step(`Monitor: ${summary.ok} sense canvis, ${summary.changed} modificats, ${summary.missing} inexistents i ${summary.invalid} amb estat invàlid`,'Actualitzant interfície i mapa');
      renderInfo();
      renderAll();
      activity.done(`WERT llest: ${summary.changed} canvis i ${summary.issues} incidències`);
      return;
    }
    activity.step(`Base identificada: ${state.baseHash.slice(0,10)}…`,'Comprovant elements OK per type + id');
    try{
      const summary=await performOkCheck(false);
      activity.step(`Comprovació OK correcta: ${summary.ok} correctes i ${summary.issues} incidències`,'Comprovant memòria cau Postpass principal');
    }catch(error){
      const detail=error?.message||String(error);
      showError(`La comprovació automàtica dels elements OK ha fallat. ${detail} La consulta Postpass principal ha continuat; torna a provar amb Comprova OK.`);
      activity.step(`Comprovació OK fallida: ${detail}`,'Continuant amb la consulta Postpass principal');
    }
    const postpassResult=await getPostpassData();
    activity.step(postpassResult.source==='cache'?'Dades Postpass recuperades de la memòria cau':'Nova resposta Postpass rebuda','Validant GeoJSON i extraient elements');
    const parsed=parsePostpass(postpassResult.payload);
    state.rawFeatures=parsed.items;
    state.postpassTimestamp=parsed.timestamp;
    activity.step(`Postpass: ${state.rawFeatures.length} elements rebuts`,`Comparant resultats amb ${state.config.elementsFile}`);
    rebuildCollections();
    activity.step(`Comparació acabada: ${state.pending.length} pendents, ${state.accepted.length} acceptats i ${state.inconsistencies.length} inconsistència${state.inconsistencies.length===1?'':'es'}`,'Actualitzant interfície i mapa');
    renderInfo();
    renderAll();
    activity.done(`WERT llest: ${state.pending.length} pendents`);
  }catch(error){
    const message=error?.name==='AbortError'?'La consulta Postpass ha superat el temps màxim configurat.':`No s’han pogut carregar les dades. ${error?.message||error}`;
    showError(message);
    activity.fail('No s’han pogut carregar les dades',error);
    throw error;
  }finally{
    refreshBusy=false;
    startReloadClock();
    startOkCheckClock();
  }
}
function wireEvents(){
  ensureOkCheckButton();
  els.pendingTab.addEventListener('click',()=>setMode('pending'));
  els.acceptedTab.addEventListener('click',()=>setMode('accepted'));
  els.inconsistenciesTab.addEventListener('click',()=>setMode('inconsistency'));
  els.taskSelect.addEventListener('change',()=>{
    if(els.taskSelect.value===state.taskId)return;
    if(hasUnsavedChanges()&&!window.confirm('Hi ha canvis sense exportar. Si canvies de tasca es perdran. Vols continuar?')){els.taskSelect.value=state.taskId;return;}
    const url=new URL(location.href);
    url.searchParams.set('task',els.taskSelect.value);
    location.href=url.toString();
  });
  els.searchInput.addEventListener('input',()=>{state.search=els.searchInput.value;state.selectedKey=null;state.popup?.remove();renderAll();});
  els.typeFilter.addEventListener('change',()=>{state.type=els.typeFilter.value;state.selectedKey=null;state.popup?.remove();renderAll();});
  els.reloadBtn.addEventListener('click',async()=>{
    if(reloadCacheStatus().fresh)return;
    if(hasUnsavedChanges()&&!window.confirm('Hi ha canvis sense exportar. Si actualitzes les dades només es mantindran quan continuïn sent vàlids. Vols continuar?'))return;
    try{await refreshData();}catch{}
  });
  els.infoBtn.addEventListener('click',()=>{renderInfo();els.infoDialog.showModal();});
  els.regexTesterInput.addEventListener('input',renderRegexTest);
  els.proposalsBtn.addEventListener('click',()=>{renderProposalManager();els.proposalsDialog.showModal();});
  els.changesBtn.addEventListener('click',()=>{renderChangesDialog();els.changesDialog.showModal();});
  for(const button of document.querySelectorAll('[data-close-dialog]'))button.addEventListener('click',()=>$(button.dataset.closeDialog)?.close());
  els.copyQueryBtn.addEventListener('click',async()=>{try{await copyText(compileQuery(),els.copyQueryBtn,'Copiada');}catch{showError('El navegador no ha permès copiar la consulta al porta-retalls.');}});
  els.downloadProposalBtn.addEventListener('click',()=>{
    activity.begin('Generant proposta WERT','Recollint altes, baixes, resolucions i estat base');
    try{
      const proposal=buildProposalPayload();
      activity.step(`Proposta ${proposal.id} preparada`,'Generant fitxer JSON');
      downloadText(proposalFilename(proposal),JSON.stringify(proposal,null,2)+'\n','application/json;charset=utf-8');
      markCurrentChangesSaved();
      activity.done(`Proposta descarregada: ${proposal.changes.add.length} altes, ${proposal.changes.remove.length} baixes i ${proposal.changes.resolve.length} resolucions`);
    }catch(error){activity.fail('No s’ha pogut generar la proposta',error);}
  });
  els.copyProposalBtn.addEventListener('click',async()=>{
    activity.begin('Copiant proposta WERT','Generant contingut JSON');
    try{
      const proposal=buildProposalPayload();
      activity.step(`Proposta ${proposal.id} preparada`,'Demanant accés al porta-retalls');
      await copyText(JSON.stringify(proposal,null,2)+'\n',els.copyProposalBtn,'Copiada');
      markCurrentChangesSaved();
      activity.done('Proposta copiada al porta-retalls');
    }catch(error){
      showError('El navegador no ha permès copiar la proposta al porta-retalls.');
      activity.fail('No s’ha pogut copiar la proposta',error);
    }
  });
  els.downloadOkBtn.addEventListener('click',()=>{
    activity.begin(`Generant ${state.config.elementsFile}`,'Aplicant els canvis de la sessió');
    try{
      const result=buildResultPayload();
      activity.step(`Fitxer resultant: ${result.elements.length} elements`,'Preparant descàrrega');
      downloadText(state.config.elementsFile,JSON.stringify(result,null,2)+'\n','application/json;charset=utf-8');
      markCurrentChangesSaved();
      activity.done(`${state.config.elementsFile} descarregat`);
    }catch(error){activity.fail(`No s’ha pogut generar ${state.config.elementsFile}`,error);}
  });
  els.copyOkBtn.addEventListener('click',async()=>{
    activity.begin(`Copiant ${state.config.elementsFile}`,'Aplicant els canvis de la sessió');
    try{
      const result=buildResultPayload();
      activity.step(`Fitxer resultant: ${result.elements.length} elements`,'Demanant accés al porta-retalls');
      await copyText(JSON.stringify(result,null,2)+'\n',els.copyOkBtn,'Copiat');
      markCurrentChangesSaved();
      activity.done(`${state.config.elementsFile} copiat`);
    }catch(error){
      showError('El navegador no ha permès copiar el JSON al porta-retalls.');
      activity.fail(`No s’ha pogut copiar ${state.config.elementsFile}`,error);
    }
  });
  els.proposalDropzone.addEventListener('click',()=>els.proposalFileInput.click());
  els.proposalFileInput.addEventListener('change',async()=>{await handleProposalFiles([...els.proposalFileInput.files]);els.proposalFileInput.value='';});
  els.proposalDropzone.addEventListener('dragover',event=>{event.preventDefault();els.proposalDropzone.classList.add('dragover');});
  els.proposalDropzone.addEventListener('dragleave',()=>els.proposalDropzone.classList.remove('dragover'));
  els.proposalDropzone.addEventListener('drop',async event=>{event.preventDefault();els.proposalDropzone.classList.remove('dragover');await handleProposalFiles([...event.dataTransfer.files].filter(file=>file.name.toLowerCase().endsWith('.json')));});
  els.clearProposalsBtn.addEventListener('click',()=>{state.importedProposals=[];state.conflictResolutions.clear();els.proposalStatus.textContent='Sense propostes importades.';renderCounters();renderProposalManager();});
  els.downloadMergedBtn.addEventListener('click',()=>{
    activity.begin('Consolidant propostes',`Calculant fusió sobre ${state.config.elementsFile}`);
    try{
      const merged=buildMergedPayload();
      activity.step(`Fusió calculada: ${merged.payload.elements.length} elements`);
      if(merged.unresolved.length){activity.fail('Hi ha decisions pendents',`${merged.unresolved.length} decisió${merged.unresolved.length===1?'':'s'} pendent${merged.unresolved.length===1?'':'s'}`);return;}
      activity.step('Sense decisions pendents',`Preparant ${state.config.elementsFile} consolidat`);
      downloadText(state.config.elementsFile,JSON.stringify(merged.payload,null,2)+'\n','application/json;charset=utf-8');
      activity.done(`${state.config.elementsFile} consolidat descarregat`);
    }catch(error){activity.fail('No s’ha pogut consolidar',error);}
  });
  els.copyMergedBtn.addEventListener('click',async()=>{
    activity.begin('Copiant consolidat','Calculant fusió de propostes');
    try{
      const merged=buildMergedPayload();
      activity.step(`Fusió calculada: ${merged.payload.elements.length} elements`);
      if(merged.unresolved.length){activity.fail('Hi ha decisions pendents',`${merged.unresolved.length} decisió${merged.unresolved.length===1?'':'s'} pendent${merged.unresolved.length===1?'':'s'}`);return;}
      activity.step('Sense decisions pendents','Demanant accés al porta-retalls');
      await copyText(JSON.stringify(merged.payload,null,2)+'\n',els.copyMergedBtn,'Copiat');
      activity.done('Consolidat copiat al porta-retalls');
    }catch(error){
      showError('El navegador no ha permès copiar el consolidat al porta-retalls.');
      activity.fail('No s’ha pogut copiar el consolidat',error);
    }
  });
  els.discardBtn.addEventListener('click',discardChanges);
  window.addEventListener('beforeunload',event=>{if(!hasUnsavedChanges())return;event.preventDefault();event.returnValue='';});
  window.addEventListener('storage',event=>{if(event.key?.startsWith('wert:postpass-cache:v2:')||event.key?.startsWith('wert:monitor-cache:v1:'))startReloadClock();if(event.key?.startsWith('wert:okcheck-cache:v1:'))startOkCheckClock();});
  window.addEventListener('focus',()=>{startReloadClock();startOkCheckClock();});
  window.addEventListener('resize',updateOkCheckButton);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){startReloadClock();startOkCheckClock();}});
}
async function start(){
  activity.step('Mòduls JavaScript carregats','Carregant config.json');
  try{
    state.appConfig=await loadJson('config.json');
    selectTaskConfig();
    configureTasks();
    activity.step(`Configuració carregada: ${state.config.name}`,'Preparant interfície');
    renderInfo();
    wireEvents();
    activity.step('Interfície preparada','Inicialitzant mapa WebGL');
    createMap();
    activity.step('Mapa inicialitzat','Carregant dades de revisió');
    await refreshData(false);
  }catch(error){
    showError(`WERT no s’ha pogut iniciar. ${error?.message||error}`);
    activity.fail('WERT no s’ha pogut iniciar',error);
  }
}
start();
