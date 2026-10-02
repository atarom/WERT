import {state} from './state.js';
import {els} from './dom.js';
import {keyFor,uiKeyFor} from './elements.js';
import {currentAction,getCurrentItems,getFilteredItems,getAddedItems,getRemovedItems,getResolvedInconsistencies,getUnresolvedInconsistencies,getInconsistencyChoices,getInconsistencyResolutionValue,setInconsistencyResolution,buildResultPayload} from './changes.js';
import {selectItem,toggleReview,renderMap} from './map.js';
import {buildMergedPayload,conflictChoices,formatShortHash} from './proposals.js';
import {compileQuery} from './postpass.js';
export function showError(message){
  els.errorBanner.textContent=message;
  els.errorBanner.classList.remove('hidden');
}
export function clearError(){
  els.errorBanner.classList.add('hidden');
  els.errorBanner.textContent='';
}
function appendMeta(main,item,action){
  const meta=document.createElement('div');
  meta.className='item-meta';
  const type=document.createElement('span');
  type.className='type-badge';
  type.textContent=item.type;
  const id=document.createElement('span');
  id.className='item-id';
  id.textContent=String(item.id);
  meta.append(type,id);
  if(action){
    const badge=document.createElement('span');
    badge.className=`state-badge ${action}`;
    badge.textContent=action==='add'?'Afegir':action==='remove'?'Retirar':'Inconsistència';
    meta.append(badge);
  }
  main.append(meta);
}
function makeIssueCard(item){
  const key=uiKeyFor(item);
  const action=currentAction(item);
  const card=document.createElement('div');
  card.className=`item-card issue-card${state.selectedKey===key?' selected':''}${action?` action-${action}`:''}`;
  card.dataset.key=key;
  card.tabIndex=0;
  const main=document.createElement('div');
  main.className='item-main';
  const name=document.createElement('div');
  name.className='item-name';
  name.textContent=item.name;
  name.title=item.name;
  main.append(name);
  appendMeta(main,item,action||'issue');
  const note=document.createElement('div');
  note.className='issue-note';
  const variants=(item.candidates||[]).map(candidate=>candidate.name).join(' · ');
  const count=(item.sourceCount||item.duplicateCount||1)>1?`${item.sourceCount||item.duplicateCount} entrades`:'';
  note.textContent=[item.message,count,variants].filter(Boolean).join(' · ');
  const select=document.createElement('select');
  select.className='issue-resolution';
  select.setAttribute('aria-label',`Resolució per a ${item.type} ${item.id}`);
  const placeholder=document.createElement('option');
  placeholder.value='';
  placeholder.textContent='Tria una resolució';
  select.append(placeholder);
  for(const choice of getInconsistencyChoices(item)){
    const option=document.createElement('option');
    option.value=choice.value;
    option.textContent=choice.label;
    select.append(option);
  }
  select.value=getInconsistencyResolutionValue(item);
  select.addEventListener('click',event=>event.stopPropagation());
  select.addEventListener('change',event=>{
    event.stopPropagation();
    setInconsistencyResolution(item,select.value);
    renderCounters();
    renderList();
    renderMap();
  });
  const activate=()=>selectItem(key,{fly:true,popup:true,scroll:false});
  card.addEventListener('click',activate);
  card.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activate();}});
  card.append(main,note,select);
  return card;
}
export function makeItemCard(item){
  if(item.issueId)return makeIssueCard(item);
  const key=uiKeyFor(item);
  const action=currentAction(item);
  const card=document.createElement('div');
  card.className=`item-card${state.selectedKey===key?' selected':''}${action?` action-${action}`:''}`;
  card.dataset.key=key;
  card.tabIndex=0;
  const main=document.createElement('div');
  main.className='item-main';
  const name=document.createElement('div');
  name.className='item-name';
  name.textContent=item.name;
  name.title=item.name;
  main.append(name);
  appendMeta(main,item,action);
  const toggle=document.createElement('button');
  toggle.type='button';
  toggle.className=`item-toggle ${state.mode==='pending'?'add':'remove'}${action?' active':''}`;
  toggle.title=state.mode==='pending'?'Marcar o desmarcar com a OK':'Marcar o desmarcar per retirar';
  toggle.setAttribute('aria-label',toggle.title);
  toggle.textContent=state.mode==='pending'?'✓':'−';
  toggle.addEventListener('click',event=>{event.stopPropagation();toggleReview(item);});
  const activate=()=>selectItem(key,{fly:true,popup:true,scroll:false});
  card.addEventListener('click',activate);
  card.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activate();}});
  card.append(main,toggle);
  return card;
}
export function renderList(){
  const items=getFilteredItems();
  els.itemList.replaceChildren();
  if(!items.length){
    const empty=document.createElement('div');
    empty.className='empty-state';
    empty.textContent=state.mode==='pending'?'No hi ha elements pendents que coincideixin amb els filtres.':state.mode==='accepted'?'No hi ha elements acceptats que coincideixin amb els filtres.':'No hi ha inconsistències que coincideixin amb els filtres.';
    els.itemList.append(empty);
  }else{
    const fragment=document.createDocumentFragment();
    for(const item of items)fragment.append(makeItemCard(item));
    els.itemList.append(fragment);
  }
  els.statusLine.textContent=`${items.length} visibles de ${getCurrentItems().length}`;
}
export function renderCounters(){
  els.pendingCount.textContent=String(state.pending.length);
  els.acceptedCount.textContent=String(state.accepted.length);
  els.inconsistenciesCount.textContent=String(state.inconsistencies.length);
  const changes=state.addKeys.size+state.removeKeys.size+state.inconsistencyResolutions.size;
  els.changesCount.textContent=String(changes);
  els.changesBtn.classList.toggle('button-primary',changes>0);
  els.proposalsCount.textContent=String(state.importedProposals.length);
}
export function renderTabs(){
  const modes={pending:els.pendingTab,accepted:els.acceptedTab,inconsistency:els.inconsistenciesTab};
  for(const[mode,button]of Object.entries(modes)){
    const active=state.mode===mode;
    button.classList.toggle('active',active);
    button.setAttribute('aria-selected',String(active));
  }
}
export function makeChangeRow(item){
  const row=document.createElement('div');
  row.className='change-row';
  const name=document.createElement('strong');
  name.textContent=item.name;
  const meta=document.createElement('span');
  meta.textContent=`${item.type} / ${item.id}`;
  row.append(name,meta);
  return row;
}
function makeIssueChangeRow(entry){
  const row=makeChangeRow(entry.resolution.desired||entry.issue);
  const detail=document.createElement('span');
  detail.textContent=entry.resolution.desired?`Resolució: ${entry.resolution.desired.name}`:"Resolució: eliminar d'OK";
  row.append(detail);
  return row;
}
function fillChangeList(container,items,emptyText,renderer=makeChangeRow){
  container.replaceChildren();
  if(items.length){for(const item of items)container.append(renderer(item));return;}
  const empty=document.createElement('div');
  empty.className='empty-state';
  empty.textContent=emptyText;
  container.append(empty);
}
export function renderChangesDialog(){
  const added=getAddedItems();
  const removed=getRemovedItems();
  const resolved=getResolvedInconsistencies();
  const unresolved=getUnresolvedInconsistencies();
  els.addCount.textContent=String(added.length);
  els.removeCount.textContent=String(removed.length);
  els.resolvedIssuesCount.textContent=String(resolved.length);
  let result=null;
  if(!unresolved.length){
    try{result=buildResultPayload();}catch{}
  }
  els.resultCount.textContent=result?String(result.elements.length):'—';
  fillChangeList(els.addList,added,'Sense altes');
  fillChangeList(els.removeList,removed,'Sense baixes');
  fillChangeList(els.issueChangeList,resolved,'Sense resolucions',makeIssueChangeRow);
  const hasChanges=added.length+removed.length+resolved.length>0;
  els.downloadProposalBtn.disabled=!hasChanges;
  els.copyProposalBtn.disabled=!hasChanges;
  els.downloadOkBtn.disabled=!hasChanges||unresolved.length>0;
  els.copyOkBtn.disabled=!hasChanges||unresolved.length>0;
  els.discardBtn.disabled=!hasChanges;
  els.changesHint.textContent=unresolved.length?`Hi ha ${unresolved.length} inconsistència${unresolved.length===1?'':'es'} sense resoldre. Pots descarregar una proposta WERT, però cal resoldre-les totes per generar elementsOK.json.`:'Totes les inconsistències actuals estan resoltes o no n’hi ha.';
}
export function makeProposalCard(proposal){
  const card=document.createElement('div');
  const stale=proposal.baseHash!==state.baseHash;
  card.className=`proposal-card${stale?' stale':''}`;
  const main=document.createElement('div');
  main.className='proposal-main';
  const title=document.createElement('div');
  title.className='proposal-title';
  title.textContent=proposal.filename;
  const meta=document.createElement('div');
  meta.className='proposal-meta';
  const addTag=document.createElement('span');
  addTag.className='proposal-tag';
  addTag.textContent=`+${proposal.add.length}`;
  const removeTag=document.createElement('span');
  removeTag.className='proposal-tag';
  removeTag.textContent=`−${proposal.remove.length}`;
  const issueTag=document.createElement('span');
  issueTag.className='proposal-tag';
  issueTag.textContent=`!${proposal.resolve.length}`;
  const baseTag=document.createElement('span');
  baseTag.className=`proposal-tag${stale?' stale':''}`;
  baseTag.textContent=stale?`Base diferent ${formatShortHash(proposal.baseHash)}`:'Base actual';
  meta.append(addTag,removeTag,issueTag,baseTag);
  const button=document.createElement('button');
  button.type='button';
  button.className='proposal-remove';
  button.textContent='×';
  button.setAttribute('aria-label',`Treure ${proposal.filename}`);
  button.addEventListener('click',()=>{state.importedProposals=state.importedProposals.filter(item=>item.id!==proposal.id);state.conflictResolutions.clear();renderCounters();renderProposalManager();});
  main.append(title,meta);
  card.append(main,button);
  return card;
}
export function makeConflictCard(conflict){
  const card=document.createElement('div');
  card.className='conflict-card';
  const title=document.createElement('h4');
  title.textContent=conflict.objectKey;
  const details=document.createElement('div');
  details.className='conflict-details';
  const names=conflict.candidates.filter(Boolean).map(item=>item.name).join(' · ');
  const reasons=conflict.reasons.length?` · ${conflict.reasons.join(' ')}`:'';
  details.textContent=`Propostes: ${conflict.sources.join(', ')}${names?` · Estats proposats: ${names}`:''}${reasons}`;
  const select=document.createElement('select');
  select.className='conflict-options';
  const placeholder=document.createElement('option');
  placeholder.value='';
  placeholder.textContent='Tria com resoldre aquest objecte';
  select.append(placeholder);
  for(const choice of conflictChoices(conflict)){
    const option=document.createElement('option');
    option.value=choice.value;
    option.textContent=choice.label;
    select.append(option);
  }
  select.value=state.conflictResolutions.get(conflict.objectKey)||'';
  select.addEventListener('change',()=>{if(select.value)state.conflictResolutions.set(conflict.objectKey,select.value);else state.conflictResolutions.delete(conflict.objectKey);renderProposalManager();});
  card.append(title,details,select);
  return card;
}
export function renderProposalManager(){
  els.proposalList.replaceChildren();
  for(const proposal of state.importedProposals)els.proposalList.append(makeProposalCard(proposal));
  if(!state.importedProposals.length){
    const empty=document.createElement('div');
    empty.className='empty-state';
    empty.textContent='Importa propostes per preparar una consolidació.';
    els.proposalList.append(empty);
  }
  const stale=state.importedProposals.filter(proposal=>proposal.baseHash!==state.baseHash).length;
  const merged=buildMergedPayload();
  els.proposalSummaryCount.textContent=String(state.importedProposals.length);
  els.proposalStaleCount.textContent=String(stale);
  els.proposalConflictCount.textContent=String(merged.plan.conflicts.length);
  els.proposalResultCount.textContent=merged.unresolved.length?'—':String(merged.payload.elements.length);
  els.conflictList.replaceChildren();
  for(const conflict of merged.plan.conflicts)els.conflictList.append(makeConflictCard(conflict));
  els.conflictsSection.classList.toggle('hidden',merged.plan.conflicts.length===0);
  const ready=state.importedProposals.length>0&&merged.unresolved.length===0;
  els.downloadMergedBtn.disabled=!ready;
  els.copyMergedBtn.disabled=!ready;
  els.clearProposalsBtn.disabled=state.importedProposals.length===0;
  if(!state.importedProposals.length)els.mergeHint.textContent='No hi ha propostes carregades.';
  else if(merged.unresolved.length){
    const issueCount=merged.unresolved.filter(item=>item.type==='inconsistency').length;
    const conflictCount=merged.unresolved.filter(item=>item.type==='conflict').length;
    els.mergeHint.textContent=`Cal resoldre ${conflictCount} conflicte${conflictCount===1?'':'s'} i ${issueCount} inconsistència${issueCount===1?'':'es'} abans de generar el consolidat.`;
  }else if(stale)els.mergeHint.textContent=`${stale} proposta${stale===1?'':'es'} parteix${stale===1?'':'en'} d’una versió diferent d’elementsOK.json. S’aplicaran de manera idempotent sobre la versió actual.`;
  else els.mergeHint.textContent='Les propostes es poden consolidar sobre l’elementsOK.json actual.';
}
export function renderRegexTest(){
  const box=els.regexTesterBox;
  const input=els.regexTesterInput;
  const status=els.regexTesterStatus;
  if(!box||!input||!status)return;
  const value=input.value;
  box.dataset.state='neutral';
  if(!value){status.textContent='Escriu un text per provar-lo.';return;}
  try{
    const expression=new RegExp(state.config.postpass.nameRegex||'','i');
    const matched=expression.test(value);
    box.dataset.state=matched?'match':'miss';
    status.textContent=matched?'Coincideix amb la regex actual.':'No coincideix amb la regex actual.';
  }catch(error){
    box.dataset.state='error';
    status.textContent=`La regex no és compatible amb el provador local del navegador: ${error?.message||error}`;
  }
}
export function renderInfo(){
  els.regexText.textContent=state.config.postpass.nameRegex||'';
  els.queryText.textContent=compileQuery();
  els.endpointText.textContent=state.config.postpass.endpoint||'';
  els.timestampText.textContent=state.postpassTimestamp?new Date(state.postpassTimestamp).toLocaleString('ca-ES',{dateStyle:'medium',timeStyle:'medium'}):'Sense carregar';
  renderRegexTest();
}
