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
  if(!Number.isFinite(lon)||!Number.isFinite(lat))return null;
  return[lon,lat];
}
export function featureToItem(feature){
  const properties=feature?.properties||{};
  return{type:normalizeType(properties.type),id:properties.id,name:String(properties.name??''),coordinates:normalizeCoordinates(feature?.geometry?.coordinates)};
}
export function acceptedToItem(value){
  return{type:normalizeType(value?.type),id:value?.id,name:String(value?.name??''),coordinates:normalizeCoordinates(value?.coordinates)};
}
export function isValidItem(item){
  return['node','way','relation'].includes(item.type)&&item.id!==undefined&&item.id!==null&&item.name.length>0;
}
export function parseAccepted(payload){
  const source=Array.isArray(payload)?payload:payload?.elements;
  if(!Array.isArray(source))throw new Error('elementsOK.json ha de contenir un array o un objecte amb "elements".');
  const groups=new Map();
  source.forEach((value,index)=>{
    const item=acceptedToItem(value);
    if(!isValidItem(item))throw new Error(`elementsOK.json conté una entrada no vàlida a la posició ${index+1}.`);
    const objectKey=objectKeyFor(item);
    if(!groups.has(objectKey))groups.set(objectKey,[]);
    groups.get(objectKey).push(item);
  });
  const items=[];
  const inconsistencies=[];
  for(const[objectKey,entries]of groups){
    if(entries.length===1){items.push(entries[0]);continue;}
    const candidates=[...new Map(entries.map(item=>[keyFor(item),item])).values()];
    const first=candidates[0];
    const conflicting=candidates.length>1;
    inconsistencies.push({issueId:`issue:${objectKey}`,objectKey,type:first.type,id:first.id,name:first.name,coordinates:first.coordinates,candidates,duplicateCount:entries.length,kind:conflicting?'conflicting-names':'duplicate',message:conflicting?'El mateix objecte OSM apareix a elementsOK amb més d’un nom.':'La mateixa entrada apareix repetida a elementsOK.'});
  }
  return{items,inconsistencies,rawCount:source.length};
}
export function parsePostpass(payload){
  if(!payload||payload.type!=='FeatureCollection'||!Array.isArray(payload.features))throw new Error('Postpass no ha retornat un FeatureCollection GeoJSON vàlid.');
  const seen=new Set();
  const items=payload.features.map(featureToItem).filter(isValidItem).filter(item=>{const key=keyFor(item);if(seen.has(key))return false;seen.add(key);return true;});
  return{items,timestamp:payload.postpass_properties?.timestamp||null};
}
export function elementForFile(item){
  return{type:item.type,id:typeof item.id==='number'?item.id:Number.isSafeInteger(Number(item.id))?Number(item.id):String(item.id),name:item.name,coordinates:item.coordinates||null};
}
export function compareItemsByName(a,b){
  return String(a.name||'').localeCompare(String(b.name||''),'ca',{sensitivity:'base',numeric:true})||String(a.type||'').localeCompare(String(b.type||''),'ca')||String(a.id).localeCompare(String(b.id),'ca',{numeric:true});
}
export function sortElements(items){
  return[...items].sort((a,b)=>a.type.localeCompare(b.type)||Number(a.id)-Number(b.id)||a.name.localeCompare(b.name,'ca'));
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
  return JSON.stringify({objectKey:issue.objectKey,duplicateCount:issue.duplicateCount,candidates:issue.candidates.map(keyFor).sort()});
}
