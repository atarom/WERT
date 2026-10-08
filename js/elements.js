import {state} from './state.js';
export function trackedTagKeys(){
  const configured=state.config?.trackedTags;
  return Array.isArray(configured)&&configured.length?[...new Set(configured.map(value=>String(value).trim()).filter(Boolean))]:['name'];
}
export function displayTagKey(){
  return String(state.config?.displayTag||trackedTagKeys()[0]||'name');
}
export function normalizeType(type){
  const value=String(type||'').toLowerCase();
  if(value==='n')return'node';
  if(value==='w')return'way';
  if(value==='r')return'relation';
  return value;
}
export function fileTypeCode(type){
  const value=normalizeType(type);
  if(value==='node')return'N';
  if(value==='way')return'W';
  if(value==='relation')return'R';
  return'';
}
export function fileTypeToInternal(type){
  if(type==='N')return'node';
  if(type==='W')return'way';
  if(type==='R')return'relation';
  return'';
}
export function normalizeCoordinates(value){
  if(!Array.isArray(value)||value.length<2)return null;
  const lon=Number(value[0]);
  const lat=Number(value[1]);
  if(!Number.isFinite(lon)||!Number.isFinite(lat)||lon<-180||lon>180||lat<-90||lat>90)return null;
  return[lon,lat];
}
export function normalizeTags(value){
  if(value&&typeof value==='object'&&!Array.isArray(value))return{...value};
  if(typeof value!=='string'||!value)return{};
  try{
    const parsed=JSON.parse(value);
    return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?{...parsed}:{};
  }catch{return{};}
}
function normalizeItemTags(value,tags){
  const result=normalizeTags(tags);
  const displayTag=displayTagKey();
  if(!Object.prototype.hasOwnProperty.call(result,displayTag)&&value?.name!==undefined&&value?.name!==null)result[displayTag]=String(value.name);
  return result;
}
export function itemTagValue(item,key){
  const tags=item?.tags;
  if(tags&&Object.prototype.hasOwnProperty.call(tags,key)&&tags[key]!==undefined&&tags[key]!==null)return String(tags[key]);
  if(key===displayTagKey()&&item?.name!==undefined&&item?.name!==null)return String(item.name);
  return null;
}
export function trackedState(item){
  const result={};
  for(const key of trackedTagKeys())result[key]=itemTagValue(item,key);
  return result;
}
export function trackedStateText(item,includeDisplay=true){
  const displayTag=displayTagKey();
  return trackedTagKeys().filter(key=>includeDisplay||key!==displayTag).map(key=>`${key}: ${itemTagValue(item,key)??'(absent)'}`).join(' · ');
}
export function itemDisplayLabel(item){
  const detail=trackedStateText(item,false);
  return detail?`${item.name} · ${detail}`:String(item.name||'');
}
export function keyFor(item){
  return`${item.type}:${String(item.id)}:${JSON.stringify(trackedState(item))}`;
}
export function objectKeyFor(item){
  return`${item.type}:${String(item.id)}`;
}
export function uiKeyFor(item){
  return item.issueId||keyFor(item);
}
export function featureToItem(feature){
  const properties=feature?.properties||{};
  const tags=normalizeItemTags(properties,properties.tags);
  const displayTag=displayTagKey();
  const name=Object.prototype.hasOwnProperty.call(tags,displayTag)&&tags[displayTag]!==null&&tags[displayTag]!==undefined?String(tags[displayTag]):String(properties.name??'');
  return{type:normalizeType(properties.type),id:properties.id,name,coordinates:normalizeCoordinates(feature?.geometry?.coordinates),tags};
}
export function acceptedToItem(value){
  const tags=normalizeItemTags(value,value?.tags);
  const displayTag=displayTagKey();
  const name=Object.prototype.hasOwnProperty.call(tags,displayTag)&&tags[displayTag]!==null&&tags[displayTag]!==undefined?String(tags[displayTag]):String(value?.name??'');
  return{type:normalizeType(value?.type),id:value?.id,name,coordinates:normalizeCoordinates(value?.coordinates),tags};
}
export function fileElementToItem(value){
  const tags=normalizeTags(value?.tags);
  const displayTag=displayTagKey();
  const name=Object.prototype.hasOwnProperty.call(tags,displayTag)&&tags[displayTag]!==null&&tags[displayTag]!==undefined?String(tags[displayTag]):'';
  return{type:fileTypeToInternal(value?.type),id:value?.id,name,coordinates:normalizeCoordinates(value?.coordinates),tags};
}
export function hasValidIdentity(item){
  const id=Number(item?.id);
  return['node','way','relation'].includes(item?.type)&&Number.isSafeInteger(id)&&id>0;
}
export function hasValidName(item){
  return typeof item?.name==='string'&&item.name.length>0&&item.name.trim()===item.name;
}
export function hasTrackedState(item){
  return trackedTagKeys().every(key=>itemTagValue(item,key)!==null);
}
export function isValidItem(item){
  return hasValidIdentity(item)&&hasValidName(item)&&hasTrackedState(item);
}
export function isCompleteItem(item){
  return isValidItem(item)&&Array.isArray(item.coordinates);
}
export function trackedDifferences(expected,current){
  const differences=[];
  for(const key of trackedTagKeys()){
    const before=itemTagValue(expected,key);
    const after=itemTagValue(current,key);
    if(before!==after)differences.push({key,before,after});
  }
  return differences;
}
function compactTags(item){
  const tags={};
  for(const key of trackedTagKeys()){
    const value=itemTagValue(item,key);
    if(value!==null)tags[key]=value;
  }
  return tags;
}
function rawSnapshot(value,index){
  const item=fileElementToItem(value);
  return{index:index+1,type:value?.type??null,id:value?.id??null,tags:compactTags(item),coordinates:Array.isArray(value?.coordinates)?value.coordinates:null};
}
function issueSignatureValue(objectKey,kind,rawEntries){
  return JSON.stringify({objectKey,kind,rawEntries});
}
function malformedIssue(value,index,item){
  const identityValid=hasValidIdentity(item);
  const nameValid=hasValidName(item);
  const trackedValid=hasTrackedState(item);
  const coordsValid=Array.isArray(item.coordinates);
  const objectKey=identityValid?objectKeyFor(item):`invalid:${index+1}`;
  const reasons=[];
  if(!identityValid)reasons.push('El tipus o l’identificador OSM no és vàlid.');
  if(!nameValid)reasons.push('El nom de visualització és buit, conté espais sobrants o no és vàlid.');
  if(!trackedValid)reasons.push(`Falten tags controlats: ${trackedTagKeys().filter(key=>itemTagValue(item,key)===null).join(', ')}.`);
  if(!coordsValid)reasons.push('Les coordenades falten o no són vàlides.');
  const rawEntries=[rawSnapshot(value,index)];
  const displayType=identityValid?item.type:String(value?.type??'—');
  const displayId=identityValid?item.id:value?.id??'—';
  const displayName=nameValid?item.name:'(sense nom vàlid)';
  return{issueId:`issue:${objectKey}`,objectKey,lookupObjectKey:identityValid?objectKey:null,type:displayType,id:displayId,name:displayName,coordinates:identityValid&&coordsValid?item.coordinates:null,candidates:[],duplicateCount:1,sourceCount:1,kind:'invalid-data',message:reasons.join(' '),rawEntries,tags:item.tags||{},signature:issueSignatureValue(objectKey,'invalid-data',rawEntries)};
}
export function parseAccepted(payload){
  const source=payload?.elements;
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||!Array.isArray(source))throw new Error(`${state.config?.elementsFile||'El snapshot SQLite'} no ha retornat una col·lecció d'elements vàlida.`);
  if(source.some(value=>!['N','W','R'].includes(value?.type)))throw new Error(`${state.config?.elementsFile||'El fitxer OK'} només admet type "N", "W" o "R".`);
  const groups=new Map();
  const inconsistencies=[];
  source.forEach((value,index)=>{
    const item=fileElementToItem(value);
    if(!hasValidIdentity(item)){inconsistencies.push(malformedIssue(value,index,item));return;}
    const objectKey=objectKeyFor(item);
    if(!groups.has(objectKey))groups.set(objectKey,[]);
    groups.get(objectKey).push({item,index,value,nameValid:hasValidName(item),trackedValid:hasTrackedState(item),coordsValid:Array.isArray(item.coordinates)});
  });
  const items=[];
  for(const[objectKey,entries]of groups){
    if(entries.length===1&&entries[0].nameValid&&entries[0].trackedValid&&entries[0].coordsValid){items.push(entries[0].item);continue;}
    const rawEntries=entries.map(entry=>rawSnapshot(entry.value,entry.index));
    const validCandidates=entries.filter(entry=>entry.nameValid&&entry.trackedValid&&entry.coordsValid).map(entry=>entry.item);
    const candidates=[...new Map(validCandidates.map(item=>[keyFor(item),item])).values()];
    const distinctStates=[...new Set(validCandidates.map(keyFor))];
    const reasons=[];
    let kind='invalid-data';
    if(entries.length>1){
      if(distinctStates.length>1){reasons.push('El mateix objecte OSM apareix al fitxer OK amb més d’un estat controlat.');kind='conflicting-states';}
      else{reasons.push('La mateixa entrada apareix repetida al fitxer OK.');kind='duplicate';}
    }
    if(entries.some(entry=>!entry.nameValid)){reasons.push('Una o més entrades tenen un nom de visualització buit o no vàlid.');kind=kind==='duplicate'||kind==='conflicting-states'?kind:'invalid-data';}
    if(entries.some(entry=>!entry.trackedValid)){reasons.push('Una o més entrades no contenen tots els tags controlats de la tasca.');kind=kind==='duplicate'||kind==='conflicting-states'?kind:'invalid-data';}
    if(entries.some(entry=>!entry.coordsValid)){reasons.push('Una o més entrades tenen coordenades inexistents o no vàlides.');kind=kind==='duplicate'||kind==='conflicting-states'?kind:'invalid-coordinates';}
    const first=candidates[0]||entries.find(entry=>entry.nameValid)?.item||entries[0].item;
    inconsistencies.push({issueId:`issue:${objectKey}`,objectKey,lookupObjectKey:objectKey,type:first.type,id:first.id,name:hasValidName(first)?first.name:'(sense nom vàlid)',coordinates:first.coordinates||null,candidates,duplicateCount:entries.length,sourceCount:entries.length,kind,message:reasons.join(' '),rawEntries,tags:first.tags||{},signature:issueSignatureValue(objectKey,kind,rawEntries)});
  }
  return{items,inconsistencies,rawCount:source.length};
}
export function parsePostpass(payload){
  if(!payload||payload.type!=='FeatureCollection'||!Array.isArray(payload.features))throw new Error('Postpass no ha retornat un FeatureCollection GeoJSON vàlid.');
  const seen=new Set();
  const items=payload.features.map(featureToItem).filter(isCompleteItem).filter(item=>{const key=keyFor(item);if(seen.has(key))return false;seen.add(key);return true;});
  return{items,timestamp:payload.postpass_properties?.timestamp||null};
}
export function elementForFile(item){
  return{type:fileTypeCode(item.type),id:typeof item.id==='number'?item.id:Number.isSafeInteger(Number(item.id))?Number(item.id):String(item.id),coordinates:item.coordinates||null,tags:compactTags(item)};
}
export function compareItemsByName(a,b){
  return String(a.name||'').localeCompare(String(b.name||''),'ca',{sensitivity:'base',numeric:true})||trackedStateText(a).localeCompare(trackedStateText(b),'ca',{sensitivity:'base',numeric:true})||String(a.type||'').localeCompare(String(b.type||''),'ca')||String(a.id).localeCompare(String(b.id),'ca',{numeric:true});
}
export function sortElements(items){
  return[...items].sort(compareItemsByName);
}
export function payloadFromItems(items){
  const byObject=new Map();
  for(const item of items)byObject.set(objectKeyFor(item),elementForFile(item));
  return{elements:sortElements([...byObject.values()])};
}
export function sameState(a,b){
  if(a===null&&b===null)return true;
  if(!a||!b)return false;
  return objectKeyFor(a)===objectKeyFor(b)&&keyFor(a)===keyFor(b);
}
export function issueSignature(issue){
  if(!issue?.signature)throw new Error('La inconsistència no té signatura.');
  return issue.signature;
}
