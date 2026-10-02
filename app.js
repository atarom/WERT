import {state} from './state.js';
import {$,els} from './dom.js';
import {parseAccepted,parsePostpass} from './elements.js';
import {compileQuery,loadJson,getPostpassData,getPostpassCacheStatus} from './postpass.js';
import {rebuildCollections,hasUnsavedChanges,buildResultPayload,markCurrentChangesSaved,clearSessionChanges} from './changes.js';
import {createMap,renderMap,setMapHooks} from './map.js';
import {showError,clearError,renderList,renderCounters,renderTabs,renderChangesDialog,renderProposalManager,renderInfo,renderRegexTest} from './ui.js';
import {activity} from './activity.js';
import {downloadText,copyText} from './io.js';
import {refreshBaseHash,proposalFilename,buildProposalPayload,importProposalFiles,buildMergedPayload} from './proposals.js';
function renderAll(){
  renderTabs();
  renderCounters();
  renderList();
  renderMap();
}
setMapHooks({renderAll,renderList});
let reloadTimer=null;
let refreshBusy=false;
function updateReloadButton(){
  if(!state.config?.postpass)return;
  if(refreshBusy){
    els.reloadBtn.disabled=true;
    els.reloadBtn.classList.remove('cooldown');
    els.reloadBtn.style.setProperty('--cooldown-progress','100%');
    els.reloadBtn.textContent='Actualitzant…';
    els.reloadBtn.title='Consulta Postpass en curs';
    return;
  }
  const status=getPostpassCacheStatus();
  if(status.fresh){
    const seconds=Math.max(1,Math.ceil(status.remainingMs/1000));
    const progress=status.ttlMs?Math.max(0,Math.min(100,status.remainingMs/status.ttlMs*100)):0;
    els.reloadBtn.disabled=true;
    els.reloadBtn.classList.add('cooldown');
    els.reloadBtn.style.setProperty('--cooldown-progress',`${progress}%`);
    els.reloadBtn.textContent=`Actualitza ${seconds}s`;
    els.reloadBtn.title=`La memòria cau Postpass continua vigent. Nova consulta disponible en ${seconds} s`;
    return;
  }
  els.reloadBtn.disabled=false;
  els.reloadBtn.classList.remove('cooldown');
  els.reloadBtn.style.setProperty('--cooldown-progress','0%');
  els.reloadBtn.textContent='Actualitza';
  els.reloadBtn.title='Torna a consultar Postpass';
}
function startReloadClock(){
  clearInterval(reloadTimer);
  reloadTimer=null;
  updateReloadButton();
  if(refreshBusy||!getPostpassCacheStatus().fresh)return;
  reloadTimer=setInterval(()=>{updateReloadButton();if(!getPostpassCacheStatus().fresh){clearInterval(reloadTimer);reloadTimer=null;}},250);
}
function setMode(mode){
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
}
function selectTaskConfig(){
  const requested=new URLSearchParams(location.search).get('task');
  const tasks=state.appConfig.tasks||[];
  let task=tasks.find(item=>item.id===requested&&item.available);
  if(!task)task=tasks.find(item=>item.id===state.appConfig.defaultTaskId&&item.available)||tasks.find(item=>item.available);
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
  if(resetActivity)activity.begin('Actualitzant WERT','Carregant elementsOK.json');else activity.step('Carregant elementsOK.json');
  try{
    const acceptedPayload=await loadJson(state.config.elementsFile);
    const acceptedParsed=parseAccepted(acceptedPayload);
    state.accepted=acceptedParsed.items;
    state.inconsistencies=acceptedParsed.inconsistencies;
    activity.step(`${state.config.elementsFile} carregat: ${state.accepted.length} acceptats i ${state.inconsistencies.length} inconsistència${state.inconsistencies.length===1?'':'es'}`,'Calculant empremta SHA-256 de la base');
    await refreshBaseHash();
    activity.step(`Base identificada: ${state.baseHash.slice(0,10)}…`,'Comprovant memòria cau Postpass');
    const postpassResult=await getPostpassData();
    activity.step(postpassResult.source==='cache'?'Dades Postpass recuperades de la memòria cau':'Nova resposta Postpass rebuda','Validant GeoJSON i extraient elements');
    const parsed=parsePostpass(postpassResult.payload);
    state.rawFeatures=parsed.items;
    state.postpassTimestamp=parsed.timestamp;
    activity.step(`Postpass: ${state.rawFeatures.length} elements rebuts`,'Comparant resultats amb elementsOK.json');
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
  }
}
function wireEvents(){
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
    if(getPostpassCacheStatus().fresh)return;
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
    activity.begin('Generant elementsOK.json','Aplicant els canvis de la sessió');
    try{
      const result=buildResultPayload();
      activity.step(`Fitxer resultant: ${result.elements.length} elements`,'Preparant descàrrega');
      downloadText(state.config.elementsFile,JSON.stringify(result,null,2)+'\n','application/json;charset=utf-8');
      markCurrentChangesSaved();
      activity.done('elementsOK.json descarregat');
    }catch(error){activity.fail('No s’ha pogut generar elementsOK.json',error);}
  });
  els.copyOkBtn.addEventListener('click',async()=>{
    activity.begin('Copiant elementsOK.json','Aplicant els canvis de la sessió');
    try{
      const result=buildResultPayload();
      activity.step(`Fitxer resultant: ${result.elements.length} elements`,'Demanant accés al porta-retalls');
      await copyText(JSON.stringify(result,null,2)+'\n',els.copyOkBtn,'Copiat');
      markCurrentChangesSaved();
      activity.done('elementsOK.json copiat');
    }catch(error){
      showError('El navegador no ha permès copiar el JSON al porta-retalls.');
      activity.fail('No s’ha pogut copiar elementsOK.json',error);
    }
  });
  els.proposalDropzone.addEventListener('click',()=>els.proposalFileInput.click());
  els.proposalFileInput.addEventListener('change',async()=>{await handleProposalFiles([...els.proposalFileInput.files]);els.proposalFileInput.value='';});
  els.proposalDropzone.addEventListener('dragover',event=>{event.preventDefault();els.proposalDropzone.classList.add('dragover');});
  els.proposalDropzone.addEventListener('dragleave',()=>els.proposalDropzone.classList.remove('dragover'));
  els.proposalDropzone.addEventListener('drop',async event=>{event.preventDefault();els.proposalDropzone.classList.remove('dragover');await handleProposalFiles([...event.dataTransfer.files].filter(file=>file.name.toLowerCase().endsWith('.json')));});
  els.clearProposalsBtn.addEventListener('click',()=>{state.importedProposals=[];state.conflictResolutions.clear();els.proposalStatus.textContent='Sense propostes importades.';renderCounters();renderProposalManager();});
  els.downloadMergedBtn.addEventListener('click',()=>{
    activity.begin('Consolidant propostes','Calculant fusió sobre l’elementsOK.json actual');
    try{
      const merged=buildMergedPayload();
      activity.step(`Fusió calculada: ${merged.payload.elements.length} elements`);
      if(merged.unresolved.length){activity.fail('Hi ha decisions pendents',`${merged.unresolved.length} decisió${merged.unresolved.length===1?'':'s'} pendent${merged.unresolved.length===1?'':'s'}`);return;}
      activity.step('Sense decisions pendents','Preparant elementsOK.json consolidat');
      downloadText(state.config.elementsFile,JSON.stringify(merged.payload,null,2)+'\n','application/json;charset=utf-8');
      activity.done('elementsOK.json consolidat descarregat');
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
  window.addEventListener('storage',event=>{if(event.key?.startsWith('wert:postpass-cache:v2:'))startReloadClock();});
  window.addEventListener('focus',startReloadClock);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)startReloadClock();});
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
