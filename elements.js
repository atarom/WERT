export function keyFor(item){
  return `${item.type}:${String(item.id)}:${item.name??''}`;
}
export function objectKeyFor(item){
  return `${item.type}:${String(item.id)}`;
}
export function uiKeyFor(item){
  return item.issueId||keyFor(item);
}
export function normalizeType(type){
  const value=String(type||'').toLowerCase();
  if(value==='n')return'node';
  if(value==='w')return'way';
  if(value==='r')return'relation';
  return value;
}
export function normalizeCoordinates(value){
  if(!Array.isArray(value)||value.length<2)return null;
  const lon=Number(value[0]);
  const lat=Number(value[1]);
  if(!Number.isFinite(lon)||!Number.isFinite(lat)||lon<-180||lon>180||lat<-90||lat>90)return null;
  return[lon,lat];
}
export function featureToItem(feature){
  const properties=feature?.properties||{};
  return{type:normalizeType(properties.type),id:properties.id,name:String(properties.name??''),coordinates:normalizeCoordinates(feature?.geometry?.coordinates)};
}
export function acceptedToItem(value){
  return{type:normalizeType(value?.type),id:value?.id,name:String(value?.name??''),coordinates:normalizeCoordinates(value?.coordinates)};
}
export function hasValidIdentity(item){
  const id=Number(item?.id);
  return['node','way','relation'].includes(item?.type)&&Number.isSafeInteger(id)&&id>0;
}
export function hasValidName(item){
  return typeof item?.name==='string'&&item.name.length>0&&item.name.trim()===item.name;
}
export function isValidItem(item){
  return hasValidIdentity(item)&&hasValidName(item);
}
export function isCompleteItem(item){
  return isValidItem(item)&&Array.isArray(item.coordinates);
}
function rawSnapshot(value,index){
  return{index:index+1,type:value?.type??null,id:value?.id??null,name:value?.name??null,coordinates:Array.isArray(value?.coordinates)?value.coordinates:null};
}
function issueSignatureValue(objectKey,kind,rawEntries){
  return JSON.stringify({objectKey,kind,rawEntries});
}
function malformedIssue(value,index,item){
  const identityValid=hasValidIdentity(item);
  const nameValid=hasValidName(item);
  const coordsValid=Array.isArray(item.coordinates);
  const objectKey=identityValid?objectKeyFor(item):`invalid:${index+1}`;
  const reasons=[];
  if(!identityValid)reasons.push('El tipus o l’identificador OSM no és vàlid.');
  if(!nameValid)reasons.push('El nom és buit, conté espais sobrants o no és vàlid.');
  if(!coordsValid)reasons.push('Les coordenades falten o no són vàlides.');
  const rawEntries=[rawSnapshot(value,index)];
  const displayType=identityValid?item.type:String(value?.type??'—');
  const displayId=identityValid?item.id:value?.id??'—';
  const displayName=nameValid?item.name:'(sense nom vàlid)';
  return{issueId:`issue:${objectKey}`,objectKey,lookupObjectKey:identityValid?objectKey:null,type:displayType,id:displayId,name:displayName,coordinates:identityValid&&coordsValid?item.coordinates:null,candidates:[],duplicateCount:1,sourceCount:1,kind:'invalid-data',message:reasons.join(' '),rawEntries,signature:issueSignatureValue(objectKey,'invalid-data',rawEntries)};
}
export function parseAccepted(payload){
  const source=Array.isArray(payload)?payload:payload?.elements;
  if(!Array.isArray(source))throw new Error('elementsOK.json ha de contenir un array o un objecte amb "elements".');
  const groups=new Map();
  const inconsistencies=[];
  source.forEach((value,index)=>{
    const item=acceptedToItem(value);
    if(!hasValidIdentity(item)){inconsistencies.push(malformedIssue(value,index,item));return;}
    const objectKey=objectKeyFor(item);
    if(!groups.has(objectKey))groups.set(objectKey,[]);
    groups.get(objectKey).push({item,index,value,nameValid:hasValidName(item),coordsValid:Array.isArray(item.coordinates)});
  });
  const items=[];
  for(const[objectKey,entries]of groups){
    if(entries.length===1&&entries[0].nameValid&&entries[0].coordsValid){items.push(entries[0].item);continue;}
    const rawEntries=entries.map(entry=>rawSnapshot(entry.value,entry.index));
    const validCandidates=entries.filter(entry=>entry.nameValid&&entry.coordsValid).map(entry=>entry.item);
    const candidates=[...new Map(validCandidates.map(item=>[keyFor(item),item])).values()];
    const named=entries.filter(entry=>entry.nameValid).map(entry=>entry.item.name);
    const distinctNames=[...new Set(named)];
    const reasons=[];
    let kind='invalid-data';
    if(entries.length>1){
      if(distinctNames.length>1){reasons.push('El mateix objecte OSM apareix a elementsOK amb més d’un nom.');kind='conflicting-names';}
      else{reasons.push('La mateixa entrada apareix repetida a elementsOK.');kind='duplicate';}
    }
    if(entries.some(entry=>!entry.nameValid)){reasons.push('Una o més entrades tenen un nom buit o no vàlid.');kind=kind==='duplicate'||kind==='conflicting-names'?kind:'invalid-data';}
    if(entries.some(entry=>!entry.coordsValid)){reasons.push('Una o més entrades tenen coordenades inexistents o no vàlides.');kind=kind==='duplicate'||kind==='conflicting-names'?kind:'invalid-coordinates';}
    const first=candidates[0]||entries.find(entry=>entry.nameValid)?.item||entries[0].item;
    inconsistencies.push({issueId:`issue:${objectKey}`,objectKey,lookupObjectKey:objectKey,type:first.type,id:first.id,name:hasValidName(first)?first.name:'(sense nom vàlid)',coordinates:first.coordinates||null,candidates,duplicateCount:entries.length,sourceCount:entries.length,kind,message:reasons.join(' '),rawEntries,signature:issueSignatureValue(objectKey,kind,rawEntries)});
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
  return{type:item.type,id:typeof item.id==='number'?item.id:Number.isSafeInteger(Number(item.id))?Number(item.id):String(item.id),name:item.name,coordinates:item.coordinates||null};
}
export function compareItemsByName(a,b){
  return String(a.name||'').localeCompare(String(b.name||''),'ca',{sensitivity:'base',numeric:true})||String(a.type||'').localeCompare(String(b.type||''),'ca')||String(a.id).localeCompare(String(b.id),'ca',{numeric:true});
}
export function sortElements(items){
  return[...items].sort(compareItemsByName);
}
export function payloadFromItems(items){
  const byObject=new Map();
  for(const item of items)byObject.set(objectKeyFor(item),elementForFile(item));
  return{version:1,elements:sortElements([...byObject.values()])};
}
export function sameState(a,b){
  if(a===null&&b===null)return true;
  if(!a||!b)return false;
  return keyFor(a)===keyFor(b);
}
export function issueSignature(issue){
  if(issue?.signature)return issue.signature;
  return JSON.stringify({objectKey:issue.objectKey,kind:issue.kind||'legacy',duplicateCount:issue.duplicateCount||issue.sourceCount||0,candidates:(issue.candidates||[]).map(keyFor).sort()});
}
