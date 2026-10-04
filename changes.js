import {state} from './state.js';
import {keyFor,objectKeyFor,uiKeyFor,payloadFromItems,compareItemsByName} from './elements.js';
export function rebuildCollections(){
  const rawByKey=new Map(state.rawFeatures.map(item=>[keyFor(item),item]));
  const rawByObject=new Map();
  for(const item of state.rawFeatures)if(!rawByObject.has(objectKeyFor(item)))rawByObject.set(objectKeyFor(item),item);
  state.accepted=state.accepted.map(item=>{
    const current=rawByKey.get(keyFor(item));
    return current?{...item,coordinates:current.coordinates||item.coordinates,tags:current.tags||item.tags}:item;
  });
  state.inconsistencies=state.inconsistencies.map(issue=>{
    const lookupKey=issue.lookupObjectKey||(!String(issue.objectKey).startsWith('invalid:')?issue.objectKey:null);
    const current=lookupKey?rawByObject.get(lookupKey)||issue.current||null:issue.current||null;
    const matching=current?(issue.candidates||[]).find(candidate=>keyFor(candidate)===keyFor(current)):null;
    const coordinates=current?.coordinates||matching?.coordinates||issue.coordinates||(issue.candidates||[]).find(candidate=>candidate.coordinates)?.coordinates||null;
    return{...issue,current,name:current?.name||(issue.candidates||[])[0]?.name||issue.name,coordinates,tags:current?.tags||issue.tags||{}};
  });
  const acceptedKeys=new Set(state.accepted.map(keyFor));
  const inconsistentObjects=new Set(state.inconsistencies.map(issue=>issue.lookupObjectKey).filter(Boolean));
  state.pending=state.rawFeatures.filter(item=>!acceptedKeys.has(keyFor(item))&&!inconsistentObjects.has(objectKeyFor(item)));
  const pendingKeys=new Set(state.pending.map(keyFor));
  for(const key of[...state.addKeys])if(!pendingKeys.has(key))state.addKeys.delete(key);
  const acceptedKeysNow=new Set(state.accepted.map(keyFor));
  for(const key of[...state.removeKeys])if(!acceptedKeysNow.has(key))state.removeKeys.delete(key);
  const issueKeys=new Set(state.inconsistencies.map(issue=>issue.objectKey));
  for(const key of[...state.inconsistencyResolutions.keys()])if(!issueKeys.has(key))state.inconsistencyResolutions.delete(key);
  if(state.selectedKey&&!getCurrentItems().some(item=>uiKeyFor(item)===state.selectedKey))state.selectedKey=null;
}
export function currentAction(item){
  if(item.issueId){
    const resolution=state.inconsistencyResolutions.get(item.objectKey);
    if(!resolution)return'issue';
    return resolution.desired?'add':'remove';
  }
  const key=keyFor(item);
  if(state.mode==='pending'&&state.addKeys.has(key))return'add';
  if(state.mode==='accepted'&&state.removeKeys.has(key))return'remove';
  return'';
}
export function getCurrentItems(){
  if(state.mode==='pending')return state.pending;
  if(state.mode==='accepted')return state.accepted;
  return state.inconsistencies;
}
function itemTags(item){
  const tags=item?.tags||item?.current?.tags;
  return tags&&typeof tags==='object'&&!Array.isArray(tags)?tags:{};
}
let tagFilterMode=state.mode;
function syncTagFilterMode(){
  if(tagFilterMode===state.mode)return;
  tagFilterMode=state.mode;
  state.tagKey='';
  state.tagValue='';
}
export function getFilteredItems(){
  syncTagFilterMode();
  const q=state.search.trim().toLocaleLowerCase('ca');
  const tagKey=String(state.tagKey||'');
  const tagValue=String(state.tagValue||'');
  return getCurrentItems().filter(item=>{
    if(state.type!=='all'&&item.type!==state.type)return false;
    if(q){
      const extra=item.issueId?`${item.message} ${(item.candidates||[]).map(candidate=>candidate.name).join(' ')} ${item.current?.name||''}`:'';
      if(!`${item.name} ${item.id} ${extra}`.toLocaleLowerCase('ca').includes(q))return false;
    }
    if(!tagKey)return true;
    const tags=itemTags(item);
    if(!Object.prototype.hasOwnProperty.call(tags,tagKey))return false;
    if(!tagValue)return true;
    return String(tags[tagKey]??'')===tagValue;
  }).sort(compareItemsByName);
}
export function getInconsistencyChoices(issue){
  const choices=[];
  const seen=new Set();
  for(const item of issue.candidates||[]){
    const value=`item:${keyFor(item)}`;
    if(seen.has(value))continue;
    seen.add(value);
    choices.push({value,label:`Conservar: ${item.name}`,item});
  }
  if(issue.current){
    const value=`item:${keyFor(issue.current)}`;
    if(!seen.has(value)){
      seen.add(value);
      choices.push({value,label:`Fer OK l'actual: ${issue.current.name}`,item:issue.current});
    }
  }
  choices.push({value:'remove',label:"Eliminar d'OK",item:null});
  return choices;
}
export function setInconsistencyResolution(issue,value){
  if(!value){state.inconsistencyResolutions.delete(issue.objectKey);return;}
  if(value==='remove'){state.inconsistencyResolutions.set(issue.objectKey,{desired:null});return;}
  if(value.startsWith('item:')){
    const wanted=value.slice(5);
    const item=[...(issue.candidates||[]),issue.current].filter(Boolean).find(candidate=>keyFor(candidate)===wanted);
    if(item)state.inconsistencyResolutions.set(issue.objectKey,{desired:item});
  }
}
export function getInconsistencyResolutionValue(issue){
  const resolution=state.inconsistencyResolutions.get(issue.objectKey);
  if(!resolution)return'';
  return resolution.desired?`item:${keyFor(resolution.desired)}`:'remove';
}
export function getResolvedInconsistencies(){
  return state.inconsistencies.filter(issue=>state.inconsistencyResolutions.has(issue.objectKey)).map(issue=>({issue,resolution:state.inconsistencyResolutions.get(issue.objectKey)})).sort((a,b)=>compareItemsByName(a.issue,b.issue));
}
export function getUnresolvedInconsistencies(){
  return state.inconsistencies.filter(issue=>!state.inconsistencyResolutions.has(issue.objectKey));
}
export function selectionSignature(){
  const adds=[...state.addKeys].sort();
  const removes=[...state.removeKeys].sort();
  const issues=[...state.inconsistencyResolutions.entries()].map(([objectKey,resolution])=>[objectKey,resolution.desired?keyFor(resolution.desired):null]).sort((a,b)=>a[0].localeCompare(b[0]));
  if(!adds.length&&!removes.length&&!issues.length)return'';
  return JSON.stringify({adds,removes,issues});
}
export function hasUnsavedChanges(){
  const signature=selectionSignature();
  return signature!==''&&signature!==state.savedSignature;
}
export function buildResultPayload(){
  const unresolved=getUnresolvedInconsistencies();
  if(unresolved.length)throw new Error(`Cal resoldre ${unresolved.length} inconsistència${unresolved.length===1?'':'es'} abans de generar elementsOK.json.`);
  const byObject=new Map(state.accepted.map(item=>[objectKeyFor(item),item]));
  for(const{issue,resolution}of getResolvedInconsistencies()){
    if(resolution.desired)byObject.set(objectKeyFor(resolution.desired),resolution.desired);
    else byObject.delete(issue.objectKey);
  }
  for(const key of state.removeKeys){
    const item=state.accepted.find(candidate=>keyFor(candidate)===key);
    if(!item)continue;
    const current=byObject.get(objectKeyFor(item));
    if(current&&keyFor(current)===key)byObject.delete(objectKeyFor(item));
  }
  const pendingByKey=new Map(state.pending.map(item=>[keyFor(item),item]));
  for(const key of state.addKeys){
    const item=pendingByKey.get(key);
    if(item)byObject.set(objectKeyFor(item),item);
  }
  return payloadFromItems([...byObject.values()]);
}
export function getAddedItems(){
  const byKey=new Map(state.pending.map(item=>[keyFor(item),item]));
  return[...state.addKeys].map(key=>byKey.get(key)).filter(Boolean).sort(compareItemsByName);
}
export function getRemovedItems(){
  const byKey=new Map(state.accepted.map(item=>[keyFor(item),item]));
  return[...state.removeKeys].map(key=>byKey.get(key)).filter(Boolean).sort(compareItemsByName);
}
export function markCurrentChangesSaved(){
  state.savedSignature=selectionSignature();
}
export function clearSessionChanges(){
  state.addKeys.clear();
  state.removeKeys.clear();
  state.inconsistencyResolutions.clear();
  state.savedSignature='';
}
