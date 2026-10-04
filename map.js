const maplibregl=window.maplibregl;
import {state} from './state.js';
import './tagfilters.js';
import {els} from './dom.js';
import {keyFor,uiKeyFor} from './elements.js';
import {currentAction,getCurrentItems,getFilteredItems,getInconsistencyChoices,getInconsistencyResolutionValue,setInconsistencyResolution} from './changes.js';
import {osmViewUrl,osmEditUrl} from './osm.js';
const hooks={renderAll:()=>{},renderList:()=>{}};
export function setMapHooks(value){
  hooks.renderAll=value.renderAll||hooks.renderAll;
  hooks.renderList=value.renderList||hooks.renderList;
}
export function createMap(){
  const cfg=state.config.map;
  state.map=new maplibregl.Map({container:'map',style:cfg.style,center:cfg.initialCenter,zoom:cfg.initialZoom,attributionControl:true});
  state.map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'top-right');
  state.map.on('load',()=>{
    state.mapReady=true;
    state.map.addSource('wert-points',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    state.map.addLayer({id:'wert-points',type:'circle',source:'wert-points',paint:{'circle-radius':['case',['==',['get','selected'],true],9,6.5],'circle-color':['match',['get','action'],'add','#7ee6ad','remove','#ff9eae','accepted','#7ee6ad','issue','#f4d57d','#c7a6ff'],'circle-stroke-width':['case',['==',['get','selected'],true],3,1.5],'circle-stroke-color':['case',['==',['get','selected'],true],'#ffffff','#202532'],'circle-opacity':0.95}});
    state.map.on('click','wert-points',event=>{const key=event.features?.[0]?.properties?.key;if(key)selectItem(key,{fly:false,popup:true,scroll:true});});
    state.map.on('mouseenter','wert-points',()=>{state.map.getCanvas().style.cursor='pointer';});
    state.map.on('mouseleave','wert-points',()=>{state.map.getCanvas().style.cursor='';});
    hooks.renderAll();
  });
}
export function itemToGeoJSON(item){
  const fallback=state.mode==='accepted'?'accepted':state.mode==='inconsistency'?'issue':'';
  return{type:'Feature',geometry:{type:'Point',coordinates:item.coordinates},properties:{key:uiKeyFor(item),type:item.type,id:String(item.id),name:item.name,action:currentAction(item)||fallback,selected:state.selectedKey===uiKeyFor(item)}};
}
export function renderMap(){
  if(!state.mapReady)return;
  const features=getFilteredItems().filter(item=>item.coordinates).map(itemToGeoJSON);
  state.map.getSource('wert-points').setData({type:'FeatureCollection',features});
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
  if(state.selectedKey===key){
    state.selectedKey=null;
    state.popup?.remove();
    hooks.renderList();
    renderMap();
    fitVisibleItems();
    return;
  }
  state.selectedKey=key;
  hooks.renderList();
  renderMap();
  if(options.scroll)requestAnimationFrame(()=>{const card=Array.from(els.itemList.querySelectorAll('.item-card')).find(node=>node.dataset.key===key);if(card)card.scrollIntoView({behavior:'smooth',block:'nearest'});});
  if(item.coordinates&&options.fly!==false)state.map.easeTo({center:item.coordinates,zoom:Math.max(state.map.getZoom(),Number(state.config.map.focusZoom)||17),duration:Number(state.config.map.focusDurationMs)||180,essential:true});
  if(item.coordinates&&options.popup)openPopup(item);
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
  const actions=document.createElement('div');
  actions.className='popup-actions';
  actions.append(linkButton('Veure a OSM',osmViewUrl(item)),linkButton('Editar amb iD',osmEditUrl(item)));
  card.append(name,meta,actions);
  if(item.issueId)appendIssuePopup(card,item);
  else{
    const review=document.createElement('button');
    review.type='button';
    review.className=`popup-review ${state.mode==='pending'?'add':'remove'}`;
    const active=Boolean(currentAction(item));
    review.textContent=state.mode==='pending'?(active?'Desmarcar OK':'Marcar OK'):(active?'Conservar':'Retirar');
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
