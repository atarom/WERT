const maplibregl=window.maplibregl;
import {state} from './state.js';
import {els} from './dom.js';
import {keyFor,uiKeyFor,displayTagKey,trackedDifferences,objectKeyFor} from './elements.js';
import {currentAction,getCurrentItems,getFilteredItems,getInconsistencyChoices,getInconsistencyResolutionValue,setInconsistencyResolution} from './changes.js';
import {osmViewUrl,osmEditUrl} from './osm.js';
const hooks={renderAll:()=>{}};
let highlightedKey=null;
function syncMapSelection(key){
  if(!state.mapReady)return;
  if(highlightedKey&&highlightedKey!==key)state.map.setFeatureState({source:'wert-points',id:highlightedKey},{selected:false});
  if(key)state.map.setFeatureState({source:'wert-points',id:key},{selected:true});
  highlightedKey=key;
}
function selectedCard(key){
  return key?els.itemList.querySelector(`.item-card[data-key="${CSS.escape(key)}"]`):null;
}
export function setMapHooks(value){
  hooks.renderAll=value.renderAll||hooks.renderAll;
}
export function createMap(){
  const cfg=state.config.map;
  state.map=new maplibregl.Map({container:'map',style:cfg.style,center:cfg.initialCenter,zoom:cfg.initialZoom,attributionControl:true});
  state.map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'top-right');
  state.map.on('load',()=>{
    state.mapReady=true;
    state.map.addSource('wert-points',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    state.map.addLayer({id:'wert-points',type:'circle',source:'wert-points',paint:{'circle-radius':['case',['boolean',['feature-state','selected'],false],8.5,6],'circle-color':['match',['get','action'],'add','#29b6f6','remove','#ff756d','accepted','#29b6f6','issue','#f0c45c','#d7ff5f'],'circle-stroke-width':['case',['boolean',['feature-state','selected'],false],3,1.5],'circle-stroke-color':['case',['boolean',['feature-state','selected'],false],'#f4f7ec','#182016'],'circle-opacity':0.94}});
    state.map.on('click','wert-points',event=>{const key=event.features?.[0]?.properties?.key;if(key)selectItem(key,{fly:false,popup:true,scroll:true});});
    state.map.on('mouseenter','wert-points',()=>{state.map.getCanvas().style.cursor='pointer';});
    state.map.on('mouseleave','wert-points',()=>{state.map.getCanvas().style.cursor='';});
    hooks.renderAll();
  });
}
export function itemToGeoJSON(item){
  const fallback=state.mode==='accepted'?'accepted':state.mode==='inconsistency'?'issue':'';
  return{type:'Feature',id:uiKeyFor(item),geometry:{type:'Point',coordinates:item.coordinates},properties:{key:uiKeyFor(item),type:item.type,id:String(item.id),name:item.name,action:currentAction(item)||fallback}};
}
export function renderMap(){
  if(!state.mapReady)return;
  const features=getFilteredItems().filter(item=>item.coordinates).map(itemToGeoJSON);
  state.map.getSource('wert-points').setData({type:'FeatureCollection',features});
  syncMapSelection(state.selectedKey);
}
function fitVisibleItems(){
  if(!state.mapReady)return;
  const coordinates=getFilteredItems().map(item=>item.coordinates).filter(Boolean);
  if(!coordinates.length)return;
  const bounds=new maplibregl.LngLatBounds();
  for(const coordinate of coordinates)bounds.extend(coordinate);
  state.map.fitBounds(bounds,{padding:48,maxZoom:Number(state.config.map.focusZoom)||17,duration:Number(state.config.map.focusDurationMs)||180,essential:true});
}
export function selectItem(key,options){
  options=options||{};
  const item=getCurrentItems().find(candidate=>uiKeyFor(candidate)===key);
  if(!item)return;
  const previousCard=els.itemList.querySelector('.item-card.selected');
  if(previousCard)previousCard.classList.remove('selected');
  if(state.selectedKey===key){
    state.selectedKey=null;
    state.popup?.remove();
    syncMapSelection(null);
    fitVisibleItems();
    return;
  }
  state.selectedKey=key;
  const card=selectedCard(key);
  if(card)card.classList.add('selected');
  syncMapSelection(key);
  if(options.scroll&&card)requestAnimationFrame(()=>card.scrollIntoView({behavior:'smooth',block:'nearest'}));
  if(item.coordinates&&options.fly!==false)state.map.easeTo({center:item.coordinates,zoom:Math.max(state.map.getZoom(),Number(state.config.map.focusZoom)||17),duration:Number(state.config.map.focusDurationMs)||180,essential:true});
  if(item.coordinates&&options.popup)openPopup(item);
}
function appendTagRows(container,entries){
  if(!entries.length)return;
  const list=document.createElement('dl');
  list.className='popup-tags';
  for(const[key,value]of entries){
    const row=document.createElement('div');
    row.className='popup-tag-row';
    const name=document.createElement('dt');
    name.textContent=key;
    const content=document.createElement('dd');
    content.textContent=String(value??'(absent)');
    row.append(name,content);
    list.append(row);
  }
  container.append(list);
}
function linkButton(label,url){
  const link=document.createElement('a');
  link.href=url;
  link.target='_blank';
  link.rel='noopener noreferrer';
  link.textContent=label;
  return link;
}
function appendIssuePopup(card,item){
  const note=document.createElement('div');
  note.className='popup-issue-note';
  note.textContent=item.message;
  const select=document.createElement('select');
  select.className='issue-resolution popup-issue-resolution';
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
  select.addEventListener('change',()=>{
    setInconsistencyResolution(item,select.value);
    hooks.renderAll();
    const fresh=getCurrentItems().find(candidate=>candidate.objectKey===item.objectKey);
    if(fresh)openPopup(fresh);
  });
  card.append(note,select);
}
export function openPopup(item){
  if(!state.mapReady||!item.coordinates)return;
  state.popup?.remove();
  const card=document.createElement('div');
  card.className='popup-card';
  const name=document.createElement('div');
  name.className='popup-name';
  name.textContent=item.name;
  const meta=document.createElement('div');
  meta.className='popup-meta';
  meta.textContent=`${item.type} / ${item.id}`;
  const details=document.createElement('div');
  details.className='popup-details';
  const displayTag=displayTagKey();
  const tags=Object.entries(item.tags||{}).filter(([key,value])=>value!==undefined&&value!==null);
  if(!tags.some(([key])=>key===displayTag)&&item.name)tags.push([displayTag,item.name]);
  tags.sort((a,b)=>a[0]===displayTag?-1:b[0]===displayTag?1:a[0].localeCompare(b[0],'ca'));
  appendTagRows(details,tags);
  const actions=document.createElement('div');
  actions.className='popup-actions';
  actions.append(linkButton('Veure a OSM',osmViewUrl(item)),linkButton('Editar amb iD',osmEditUrl(item)));
  if(state.config?.mode==='monitor'&&state.mode==='pending'){
    const previous=state.accepted.find(candidate=>objectKeyFor(candidate)===objectKeyFor(item));
    const differences=previous?trackedDifferences(previous,item):[];
    if(differences.length){
      const heading=document.createElement('div');
      heading.className='popup-section-title';
      heading.textContent='Canvis respecte al snapshot';
      details.append(heading);
      appendTagRows(details,differences.map(entry=>[entry.key,`${entry.before??'(absent)'} → ${entry.after??'(absent)'}`]));
    }
  }
  card.append(name,meta,details,actions);
  if(item.issueId)appendIssuePopup(details,item);
  else{
    const review=document.createElement('button');
    review.type='button';
    review.className=`popup-review ${state.mode==='pending'?'add':'remove'}`;
    const active=Boolean(currentAction(item));
    review.textContent=state.mode==='pending'?(state.config?.mode==='monitor'?(active?'Desmarcar canvi':'Acceptar canvi'):(active?'Desmarcar OK':'Marcar OK')):(active?'Conservar':'Retirar');
    review.addEventListener('click',()=>{
      toggleReview(item);
      const fresh=getCurrentItems().find(candidate=>keyFor(candidate)===keyFor(item));
      if(fresh)openPopup(fresh);
    });
    actions.append(review);
  }
  state.popup=new maplibregl.Popup({offset:12,closeButton:true}).setLngLat(item.coordinates).setDOMContent(card).addTo(state.map);
}
export function toggleReview(item){
  const key=keyFor(item);
  if(state.mode==='pending'){
    if(state.addKeys.has(key))state.addKeys.delete(key);
    else state.addKeys.add(key);
  }else if(state.mode==='accepted'){
    if(state.removeKeys.has(key))state.removeKeys.delete(key);
    else state.removeKeys.add(key);
  }
  hooks.renderAll();
}
