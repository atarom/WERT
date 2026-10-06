import {state} from './state.js';
import {$,els} from './dom.js';
import {parseAccepted,parsePostpass} from './elements.js';
import {compileQuery,loadJson,getPostpassData,getPostpassCacheStatus,getMonitorCacheStatus,isMonitorTask} from './postpass.js';
import {rebuildCollections,hasUnsavedChanges,buildResultPayload,markCurrentChangesSaved,clearSessionChanges} from './changes.js';
import {createMap,renderMap,setMapHooks} from './map.js';
import {showError,clearError,renderList,renderCounters,renderTabs,renderChangesDialog,renderProposalManager,renderInfo,renderRegexTest} from './ui.js';
import {activity} from './activity.js';
import {downloadText,copyText,stringifyJson} from './io.js';
import {refreshBaseHash,proposalFilename,buildProposalPayload,importProposalFiles,buildMergedPayload} from './proposals.js';
import {getOkBaseItems,setOkCheckBase,performOkCheck,startOkCheckClock,wireOkCheck,performMonitorCheck,renderSnapshotAdmin,resetSnapshotAdmin,wireMonitorSnapshot} from './monitor.js';
function renderAll(){
  renderTabs();
  renderCounters();
  renderList();
  renderMap();
}
setMapHooks({renderAll,renderList});
let reloadTimer=null;
let refreshBusy=false;
const TASK_SWITCH_KEY='wert:task-switch';
const MAINTAINER_KEY='wert:maintainer-mode';
function setMaintainerMode(enabled){
  const button=$('maintainer-btn');
  document.body.classList.toggle('maintainer-mode',enabled);
  if(button){
    button.setAttribute('aria-pressed',String(enabled));
    button.title=enabled?'Desactiva el mode mantenedor':'Activa el mode mantenedor';
  }
  try{if(enabled)sessionStorage.setItem(MAINTAINER_KEY,'1');else sessionStorage.removeItem(MAINTAINER_KEY);}catch{}
}
function restoreMaintainerMode(){
  let enabled=false;
  try{enabled=sessionStorage.getItem(MAINTAINER_KEY)==='1';}catch{}
  setMaintainerMode(enabled);
}
function reloadCacheStatus(){
  return isMonitorTask()?getMonitorCacheStatus(getOkBaseItems()):getPostpassCacheStatus();
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
function applyTaskConfig(task){
  state.taskId=task.id;
  state.config=task;
  const url=new URL(location.href);
  url.searchParams.set('task',task.id);
  history.replaceState(null,'',url);
}
async function selectTaskConfig(){
  const tasks=(state.appConfig.tasks||[]).filter(task=>task.available);
  if(!tasks.length)throw new Error('No hi ha cap tasca disponible a config.json.');
  let switched='';
  try{switched=sessionStorage.getItem(TASK_SWITCH_KEY)||'';sessionStorage.removeItem(TASK_SWITCH_KEY);}catch{}
  const switchedTask=tasks.find(task=>task.id===switched);
  if(switchedTask){applyTaskConfig(switchedTask);return;}
  const dialog=$('task-start-dialog');
  const list=$('task-start-list');
  if(!dialog||!list)throw new Error('No s’ha trobat el selector inicial de tasques.');
  const requested=new URLSearchParams(location.search).get('task');
  const preferred=tasks.find(task=>task.id===requested)||tasks.find(task=>task.id===state.appConfig.defaultTaskId)||tasks[0];
  list.replaceChildren();
  await new Promise(resolve=>{
    const blockCancel=event=>event.preventDefault();
    dialog.addEventListener('cancel',blockCancel);
    let preferredButton=null;
    for(const task of tasks){
      const button=document.createElement('button');
      button.type='button';
      button.className='task-start-option';
      const name=document.createElement('strong');
      name.textContent=task.name;
      const detail=document.createElement('span');
      detail.textContent=task.mode==='monitor'?'Monitorització':'Revisió';
      button.append(name,detail);
      button.addEventListener('click',()=>{
        dialog.removeEventListener('cancel',blockCancel);
        applyTaskConfig(task);
        dialog.close();
        resolve();
      },{once:true});
      list.append(button);
      if(task.id===preferred.id)preferredButton=button;
    }
    dialog.showModal();
    (preferredButton||list.firstElementChild)?.focus();
  });
}
async function handleProposalFiles(files){
  activity.begin('Important propostes',`${files.length} fitxer${pluralS(files.length)} seleccionat${pluralS(files.length)}`);
  try{
    const messages=await importProposalFiles(files);
    els.proposalStatus.textContent=messages.join(' · ');
    activity.step('Analitzant concurrència, inconsistències i conflictes');
    renderCounters();
    renderProposalManager();
    const merged=buildMergedPayload();
    activity.done(`Importació acabada: ${state.importedProposals.length} proposta${state.importedProposals.length===1?'':'es'} i ${merged.unresolved.length} decisió${pluralS(merged.unresolved.length)} pendent${pluralS(merged.unresolved.length)}`);
  }catch(error){
    activity.fail('Error en importar propostes',error);
    throw error;
  }
}
function pluralS(count){
  return count===1?'':'s';
}
function downloadJson(filename,payload){
  downloadText(filename,stringifyJson(payload),'application/json;charset=utf-8');
}
function copyJson(payload,button,label){
  return copyText(stringifyJson(payload),button,label);
}
function failUnresolved(merged){
  const count=merged.unresolved.length;
  if(!count)return false;
  activity.fail('Hi ha decisions pendents',`${count} decisió${pluralS(count)} pendent${pluralS(count)}`);
  return true;
}
async function exportProposal(copy){
  activity.begin(copy?'Copiant proposta WERT':'Generant proposta WERT',copy?'Generant contingut JSON':'Recollint altes, baixes, resolucions i estat base');
  try{
    const proposal=buildProposalPayload();
    activity.step(`Proposta ${proposal.id} preparada`,copy?'Demanant accés al porta-retalls':'Generant fitxer JSON');
    if(copy)await copyJson(proposal,els.copyProposalBtn,'Copiada');
    else downloadJson(proposalFilename(proposal),proposal);
    markCurrentChangesSaved();
    activity.done(copy?'Proposta copiada al porta-retalls':`Proposta descarregada: ${proposal.changes.add.length} altes, ${proposal.changes.remove.length} baixes i ${proposal.changes.resolve.length} resolucions`);
  }catch(error){
    if(copy)showError('El navegador no ha permès copiar la proposta al porta-retalls.');
    activity.fail(copy?'No s’ha pogut copiar la proposta':'No s’ha pogut generar la proposta',error);
  }
}
async function exportOk(copy){
  const filename=state.config.elementsFile;
  activity.begin(`${copy?'Copiant':'Generant'} ${filename}`,'Aplicant els canvis de la sessió');
  try{
    const result=buildResultPayload();
    activity.step(`Fitxer resultant: ${result.elements.length} elements`,copy?'Demanant accés al porta-retalls':'Preparant descàrrega');
    if(copy)await copyJson(result,els.copyOkBtn,'Copiat');
    else downloadJson(filename,result);
    markCurrentChangesSaved();
    activity.done(`${filename} ${copy?'copiat':'descarregat'}`);
  }catch(error){
    if(copy)showError('El navegador no ha permès copiar el JSON al porta-retalls.');
    activity.fail(`${copy?'No s’ha pogut copiar':'No s’ha pogut generar'} ${filename}`,error);
  }
}
async function exportMerged(copy){
  const filename=state.config.elementsFile;
  activity.begin(copy?'Copiant consolidat':'Consolidant propostes',copy?'Calculant fusió de propostes':`Calculant fusió sobre ${filename}`);
  try{
    const merged=buildMergedPayload();
    activity.step(`Fusió calculada: ${merged.payload.elements.length} elements`);
    if(failUnresolved(merged))return;
    activity.step('Sense decisions pendents',copy?'Demanant accés al porta-retalls':`Preparant ${filename} consolidat`);
    if(copy)await copyJson(merged.payload,els.copyMergedBtn,'Copiat');
    else downloadJson(filename,merged.payload);
    activity.done(copy?'Consolidat copiat al porta-retalls':`${filename} consolidat descarregat`);
  }catch(error){
    if(copy)showError('El navegador no ha permès copiar el consolidat al porta-retalls.');
    activity.fail(copy?'No s’ha pogut copiar el consolidat':'No s’ha pogut consolidar',error);
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
    resetSnapshotAdmin();
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
    startClocks();
  }
}
function startClocks(){
  startReloadClock();
  startOkCheckClock();
}
function wireEvents(){
  wireOkCheck(renderAll);
  wireMonitorSnapshot();
  $('maintainer-btn')?.addEventListener('click',event=>setMaintainerMode(event.currentTarget.getAttribute('aria-pressed')!=='true'));
  els.pendingTab.addEventListener('click',()=>setMode('pending'));
  els.acceptedTab.addEventListener('click',()=>setMode('accepted'));
  els.inconsistenciesTab.addEventListener('click',()=>setMode('inconsistency'));
  els.taskSelect.addEventListener('change',()=>{
    if(els.taskSelect.value===state.taskId)return;
    if(hasUnsavedChanges()&&!window.confirm('Hi ha canvis sense exportar. Si canvies de tasca es perdran. Vols continuar?')){els.taskSelect.value=state.taskId;return;}
    try{sessionStorage.setItem(TASK_SWITCH_KEY,els.taskSelect.value);}catch{}
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
  els.infoBtn.addEventListener('click',()=>{renderInfo();renderSnapshotAdmin();els.infoDialog.showModal();});
  els.regexTesterInput.addEventListener('input',renderRegexTest);
  els.proposalsBtn.addEventListener('click',()=>{renderProposalManager();els.proposalsDialog.showModal();});
  els.changesBtn.addEventListener('click',()=>{renderChangesDialog();els.changesDialog.showModal();});
  for(const button of document.querySelectorAll('[data-close-dialog]'))button.addEventListener('click',()=>$(button.dataset.closeDialog)?.close());
  els.copyQueryBtn.addEventListener('click',async()=>{try{await copyText(compileQuery(),els.copyQueryBtn,'Copiada');}catch{showError('El navegador no ha permès copiar la consulta al porta-retalls.');}});
  els.downloadProposalBtn.addEventListener('click',()=>exportProposal(false));
  els.copyProposalBtn.addEventListener('click',()=>exportProposal(true));
  els.downloadOkBtn.addEventListener('click',()=>exportOk(false));
  els.copyOkBtn.addEventListener('click',()=>exportOk(true));
  els.proposalDropzone.addEventListener('click',()=>els.proposalFileInput.click());
  els.proposalFileInput.addEventListener('change',async()=>{await handleProposalFiles([...els.proposalFileInput.files]);els.proposalFileInput.value='';});
  els.proposalDropzone.addEventListener('dragover',event=>{event.preventDefault();els.proposalDropzone.classList.add('dragover');});
  els.proposalDropzone.addEventListener('dragleave',()=>els.proposalDropzone.classList.remove('dragover'));
  els.proposalDropzone.addEventListener('drop',async event=>{event.preventDefault();els.proposalDropzone.classList.remove('dragover');await handleProposalFiles([...event.dataTransfer.files].filter(file=>file.name.toLowerCase().endsWith('.json')));});
  els.clearProposalsBtn.addEventListener('click',()=>{state.importedProposals=[];state.conflictResolutions.clear();els.proposalStatus.textContent='Sense propostes importades.';renderCounters();renderProposalManager();});
  els.downloadMergedBtn.addEventListener('click',()=>exportMerged(false));
  els.copyMergedBtn.addEventListener('click',()=>exportMerged(true));
  els.discardBtn.addEventListener('click',discardChanges);
  window.addEventListener('beforeunload',event=>{if(!hasUnsavedChanges())return;event.preventDefault();event.returnValue='';});
  window.addEventListener('storage',event=>{if(event.key?.startsWith('wert:postpass-cache:v2:')||event.key?.startsWith('wert:monitor-cache:v1:'))startReloadClock();if(event.key?.startsWith('wert:okcheck-cache:v1:'))startOkCheckClock();});
  window.addEventListener('focus',startClocks);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)startClocks();});
}
async function start(){
  activity.step('Mòduls JavaScript carregats','Carregant config.json');
  try{
    state.appConfig=await loadJson('config.json');
    activity.hide();
    await Promise.resolve();
    await selectTaskConfig();
    restoreMaintainerMode();
    activity.begin('Iniciant WERT',`Tasca seleccionada: ${state.config.name}`);
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
