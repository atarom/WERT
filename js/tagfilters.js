import {state} from './state.js';
import {getCurrentItems,itemTags,matchesBaseFilters} from './changes.js';
let keySelect=null;
let valueSelect=null;
let refreshSource=null;
let refreshSearch=null;
let refreshType=null;
let refreshTagKey=null;
function contextualItems(){
  const q=state.search.trim().toLocaleLowerCase('ca');
  return getCurrentItems().filter(item=>matchesBaseFilters(item,q));
}
function allKeys(items){
  const keys=new Set();
  for(const item of items)for(const key of Object.keys(itemTags(item)))keys.add(key);
  return[...keys].sort((a,b)=>a.localeCompare(b,'ca',{sensitivity:'base',numeric:true}));
}
function allValues(items,key){
  const values=new Set();
  for(const item of items){
    const tags=itemTags(item);
    if(Object.prototype.hasOwnProperty.call(tags,key))values.add(String(tags[key]??''));
  }
  return[...values].sort((a,b)=>a.localeCompare(b,'ca',{sensitivity:'base',numeric:true}));
}
function addOption(select,value,label){
  const option=document.createElement('option');
  option.value=value;
  option.textContent=label;
  select.append(option);
}
function triggerRender(){
  const input=document.getElementById('search-input');
  if(input)input.dispatchEvent(new Event('input',{bubbles:true}));
}
function ensureControls(){
  if(keySelect&&valueSelect)return true;
  const filters=document.querySelector('.filters');
  if(!filters)return false;
  keySelect=document.getElementById('tag-key-filter');
  valueSelect=document.getElementById('tag-value-filter');
  if(!keySelect){
    keySelect=document.createElement('select');
    keySelect.id='tag-key-filter';
    keySelect.className='select';
    keySelect.setAttribute('aria-label','Filtra per tag key');
    filters.append(keySelect);
  }
  if(!valueSelect){
    valueSelect=document.createElement('select');
    valueSelect.id='tag-value-filter';
    valueSelect.className='select';
    valueSelect.setAttribute('aria-label','Filtra per valor de tag');
    filters.append(valueSelect);
  }
  keySelect.addEventListener('change',()=>{
    state.tagKey=keySelect.value;
    state.tagValue='';
    state.selectedKey=null;
    state.popup?.remove();
    refreshTagFilters();
    triggerRender();
  });
  valueSelect.addEventListener('change',()=>{
    state.tagValue=valueSelect.value;
    state.selectedKey=null;
    state.popup?.remove();
    triggerRender();
  });
  return true;
}
export function refreshTagFilters(){
  if(!ensureControls())return false;
  const source=getCurrentItems();
  const search=state.search;
  const type=state.type;
  const tagKey=state.tagKey;
  if(refreshSource===source&&refreshSearch===search&&refreshType===type&&refreshTagKey===tagKey)return false;
  let changed=false;
  const items=contextualItems();
  const keys=allKeys(items);
  if(state.tagKey&&!keys.includes(state.tagKey)){
    state.tagKey='';
    state.tagValue='';
    changed=true;
  }
  keySelect.replaceChildren();
  addOption(keySelect,'','Totes les tags');
  for(const key of keys)addOption(keySelect,key,key);
  keySelect.value=state.tagKey;
  valueSelect.replaceChildren();
  if(!state.tagKey){
    addOption(valueSelect,'','Qualsevol valor');
    valueSelect.disabled=true;
    refreshSource=source;
    refreshSearch=search;
    refreshType=type;
    refreshTagKey=state.tagKey;
    return changed;
  }
  const values=allValues(items,state.tagKey);
  if(state.tagValue&&!values.includes(state.tagValue)){state.tagValue='';changed=true;}
  addOption(valueSelect,'','Qualsevol valor');
  for(const value of values)addOption(valueSelect,value,value||'(buit)');
  valueSelect.value=state.tagValue;
  valueSelect.disabled=false;
  refreshSource=source;
  refreshSearch=search;
  refreshType=type;
  refreshTagKey=state.tagKey;
  return changed;
}
refreshTagFilters();
