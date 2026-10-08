import {activity} from './activity.js';
import {state} from './state.js';
import {trackedTagKeys,displayTagKey} from './elements.js';
import {readStoredCache,writeStoredCache} from './sqlite-cache.js';
const POSTPASS_LOCK_KEY='wert:postpass-lock:v2';
const caches={
  postpass:{memory:null},
  ok:{memory:null},
  monitor:{memory:null}
};
const compiledOkCheckCache=new WeakMap();
const okCheckSignatureCache=new WeakMap();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function isMonitorTask(){
  return state.config?.mode==='monitor';
}
function groupedObjectIds(items){
  const groups={N:new Set(),W:new Set(),R:new Set()};
  const codes={node:'N',way:'W',relation:'R'};
  for(const item of items||[]){
    const code=codes[String(item?.type||'').toLowerCase()];
    const id=Number(item?.id);
    if(code&&Number.isSafeInteger(id)&&id>0)groups[code].add(id);
  }
  return groups;
}
function objectClauses(items,alias='e'){
  const groups=groupedObjectIds(items);
  const clauses=[];
  for(const code of['N','W','R']){
    const ids=[...groups[code]].sort((a,b)=>a-b);
    if(ids.length)clauses.push(`(${alias}.osm_type='${code}' AND ${alias}.osm_id=ANY(ARRAY[${ids.join(',')}]::bigint[]))`);
  }
  return clauses;
}
function trackedTagsExpression(alias='e'){
  const tagArgs=[];
  for(const key of trackedTagKeys()){
    const escaped=key.replaceAll("'","''");
    tagArgs.push(`'${escaped}'`,`${alias}.tags->>'${escaped}'`);
  }
  return tagArgs.length?`jsonb_build_object(${tagArgs.join(',')})`:`'{}'::jsonb`;
}
function okCheckSignature(items){
  if(Array.isArray(items)){
    const cached=okCheckSignatureCache.get(items);
    if(cached)return cached;
  }
  const groups=groupedObjectIds(items);
  let first=2166136261;
  let second=2246822519;
  let length=0;
  const feed=value=>{
    const text=String(value);
    length+=text.length;
    for(let index=0;index<text.length;index++){
      const char=text.charCodeAt(index);
      first=Math.imul(first^char,16777619);
      second=Math.imul(second^char,3266489917);
    }
  };
  for(const key of trackedTagKeys()){feed('T');feed(key.length);feed(':');feed(key);feed(';');}
  for(const code of['N','W','R']){
    feed(code);
    feed(':');
    for(const id of[...groups[code]].sort((a,b)=>a-b)){feed(id);feed(',');}
    feed(';');
  }
  const signature=`${length}:${(first>>>0).toString(16).padStart(8,'0')}${(second>>>0).toString(16).padStart(8,'0')}`;
  if(Array.isArray(items))okCheckSignatureCache.set(items,signature);
  return signature;
}
function buildOkCheckQuery(items){
  const clauses=objectClauses(items);
  if(!clauses.length)return'';
  return[`SELECT DISTINCT ON (e.osm_type,e.osm_id)`,`CASE e.osm_type WHEN 'N' THEN 'node' WHEN 'W' THEN 'way' WHEN 'R' THEN 'relation' END AS type,`,`e.osm_id AS id,`,`${trackedTagsExpression()} AS tags`,`FROM postpass_pointlinepolygon e`,`WHERE ${clauses.join('\nOR\n')}`,`ORDER BY e.osm_type,e.osm_id`].join('\n');
}
export function compileOkCheckQuery(items){
  if(Array.isArray(items)){
    const cached=compiledOkCheckCache.get(items);
    if(cached!==undefined)return cached;
  }
  const query=buildOkCheckQuery(items);
  if(Array.isArray(items))compiledOkCheckCache.set(items,query);
  return query;
}
export function compileMonitorDetailQuery(items){
  const clauses=objectClauses(items);
  if(!clauses.length)return'';
  const displayTag=displayTagKey().replaceAll("'","''");
  return[`SELECT DISTINCT ON (e.osm_type,e.osm_id)`,`CASE e.osm_type WHEN 'N' THEN 'node' WHEN 'W' THEN 'way' WHEN 'R' THEN 'relation' END AS type,`,`e.osm_id AS id,`,`e.tags->>'${displayTag}' AS name,`,`e.tags AS tags,`,`ST_PointOnSurface(e.geom) AS geom`,`FROM postpass_pointlinepolygon e`,`WHERE ${clauses.join('\nOR\n')}`,`ORDER BY e.osm_type,e.osm_id`].join('\n');
}
export function compileMonitorSnapshotQuery(){
  const relationId=Number(state.config?.monitor?.sourceRelationId);
  if(!Number.isSafeInteger(relationId)||relationId<=0)return'';
  const required=Array.isArray(state.config?.monitor?.sourceRequireTags)&&state.config.monitor.sourceRequireTags.length?state.config.monitor.sourceRequireTags:trackedTagKeys();
  const tagConditions=[...new Set(required.map(value=>String(value).trim()).filter(Boolean))].map(key=>`tags ? '${key.replaceAll("'","''")}'`);
  const displayTag=displayTagKey().replaceAll("'","''");
  return[`WITH area AS MATERIALIZED (`,`SELECT geom`,`FROM postpass_polygon`,`WHERE osm_type='R'`,`AND osm_id=${relationId}`,`)`,`SELECT DISTINCT ON (e.osm_type,e.osm_id)`,`CASE e.osm_type WHEN 'N' THEN 'node' WHEN 'W' THEN 'way' WHEN 'R' THEN 'relation' END AS type,`,`e.osm_id AS id,`,`e.tags->>'${displayTag}' AS name,`,`${trackedTagsExpression()} AS tags,`,`ST_PointOnSurface(e.geom) AS geom`,`FROM area a`,`CROSS JOIN LATERAL (`,`SELECT osm_type,osm_id,tags,geom`,`FROM postpass_pointlinepolygon`,`WHERE geom && a.geom${tagConditions.length?`\nAND ${tagConditions.join('\nAND ')}`:''}`,`) e`,`WHERE ST_Intersects(a.geom,ST_PointOnSurface(e.geom))`,`ORDER BY e.osm_type,e.osm_id`].join('\n');
}
export function compileQuery(){
  if(isMonitorTask())return compileOkCheckQuery(state.accepted);
  const postpass=state.config.postpass;
  const escaped=String(postpass.nameRegex||'').replaceAll("'","''");
  return String(postpass.query||'').replaceAll('__NAME_REGEX__',escaped).trim();
}
export async function loadJson(url){
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok)throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}
function cacheTtlMs(){
  return Math.max(1000,Number(state.config?.postpass?.cacheSeconds??60)*1000);
}
function emptyStatus(ttlMs=cacheTtlMs()){
  return{exists:false,fresh:false,ageMs:Infinity,remainingMs:0,savedAt:0,ttlMs};
}
function statusForEntry(entry,ttlMs=cacheTtlMs()){
  if(!entry)return emptyStatus(ttlMs);
  const ageMs=Math.max(0,Date.now()-Number(entry.savedAt));
  const remainingMs=Math.max(0,ttlMs-ageMs);
  return{exists:true,fresh:remainingMs>0,ageMs,remainingMs,savedAt:Number(entry.savedAt),ttlMs};
}
function cacheIdentity(kind,items){
  const identity={taskId:state.taskId,endpoint:String(state.config?.postpass?.endpoint||'')};
  if(kind==='postpass')identity.query=compileQuery();
  else identity.signature=okCheckSignature(items);
  return identity;
}
function matchesCache(entry,identity){
  if(!entry||typeof entry!=='object'||!entry.payload||!Number.isFinite(Number(entry.savedAt)))return false;
  return Object.entries(identity).every(([key,value])=>entry[key]===value);
}
async function readCache(kind,items){
  const cache=caches[kind];
  const identity=cacheIdentity(kind,items);
  try{
    const stored=await readStoredCache(kind,identity.taskId);
    if(matchesCache(stored,identity)){cache.memory=stored;return stored;}
  }catch{}
  return matchesCache(cache.memory,identity)?cache.memory:null;
}
async function writeCache(kind,items,payload){
  const cache=caches[kind];
  const identity=cacheIdentity(kind,items);
  const entry={savedAt:Date.now(),...identity,payload};
  cache.memory=entry;
  let persisted=false;
  try{persisted=await writeStoredCache(kind,entry);}catch{}
  return{entry,persisted};
}
export function getPostpassCacheStatus(){
  if(!state.config?.postpass)return emptyStatus(0);
  return statusForEntry(caches.postpass.memory&&matchesCache(caches.postpass.memory,cacheIdentity('postpass'))?caches.postpass.memory:null);
}
export function getOkCheckCacheStatus(items){
  if(!state.config?.postpass)return emptyStatus();
  return statusForEntry(caches.ok.memory&&matchesCache(caches.ok.memory,cacheIdentity('ok',items))?caches.ok.memory:null);
}
export function getMonitorCacheStatus(items){
  if(!state.config?.postpass)return emptyStatus();
  return statusForEntry(caches.monitor.memory&&matchesCache(caches.monitor.memory,cacheIdentity('monitor',items))?caches.monitor.memory:null);
}
async function postForm(query,{geojson=true,timeoutMs,progressLabel,responseLabel}={}){
  const postpass=state.config.postpass;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Number(timeoutMs)||Number(postpass.timeoutMs)||180000);
  const params=new URLSearchParams();
  params.set('data',query);
  if(!geojson)params.set('options[geojson]','false');
  activity.step(progressLabel||`Consulta Postpass preparada: ${query.length} caràcters`,`Enviant petició a ${postpass.endpoint}`);
  try{
    const response=await fetch(postpass.endpoint,{method:postpass.method||'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:params.toString(),signal:controller.signal});
    activity.step(`${responseLabel||'Postpass'} ha respost HTTP ${response.status}`,geojson?'Llegint resposta GeoJSON':'Llegint resposta tabular JSON');
    if(!response.ok){
      const detail=await response.text().catch(()=>'');
      throw new Error(`Postpass ha respost HTTP ${response.status}${detail?`: ${detail.slice(0,300)}`:''}`);
    }
    return await response.json();
  }finally{clearTimeout(timer);}
}
async function fetchPostpassNetwork(){
  const query=compileQuery();
  return postForm(query,{progressLabel:`Consulta Postpass preparada: ${query.length} caràcters`,responseLabel:'Postpass'});
}
async function fetchCheckNetwork(items,monitor){
  const query=compileOkCheckQuery(items);
  if(!query)return{postpass_properties:{timestamp:new Date().toISOString()},result:[]};
  const payload=await postForm(query,{
    geojson:false,
    ...(monitor?{}:{timeoutMs:Math.min(Number(state.config.postpass.timeoutMs)||180000,60000)}),
    progressLabel:monitor?`Consulta monitor preparada: ${items.length} elements i ${query.length} caràcters`:`Consulta de comprovació preparada: ${items.length} elements i ${query.length} caràcters`,
    responseLabel:monitor?'Monitor Postpass':'Comprovació Postpass'
  });
  if(!Array.isArray(payload?.result))throw new Error(monitor?'La consulta monitor no ha retornat un array result vàlid.':'La comprovació Postpass no ha retornat un array result vàlid.');
  return payload;
}
async function fetchMonitorDetailNetwork(items){
  const query=compileMonitorDetailQuery(items);
  if(!query)return{postpass_properties:{timestamp:new Date().toISOString()},type:'FeatureCollection',features:[]};
  const payload=await postForm(query,{progressLabel:`Detall monitor preparat: ${items.length} elements i ${query.length} caràcters`,responseLabel:'Detall Postpass'});
  if(payload?.type!=='FeatureCollection'||!Array.isArray(payload?.features))throw new Error('El detall monitor no ha retornat un FeatureCollection GeoJSON vàlid.');
  return payload;
}
async function fetchMonitorSnapshotNetwork(){
  const query=compileMonitorSnapshotQuery();
  if(!query)throw new Error('La tasca monitor no té una font de snapshot vàlida configurada.');
  const payload=await postForm(query,{progressLabel:`Regeneració de snapshot preparada: ${query.length} caràcters`,responseLabel:'Snapshot Postpass'});
  if(payload?.type!=='FeatureCollection'||!Array.isArray(payload?.features))throw new Error('La regeneració del snapshot no ha retornat un FeatureCollection GeoJSON vàlid.');
  return payload;
}
async function fallbackLock(task){
  const token=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`;
  const maxWait=Math.max(10000,Number(state.config?.postpass?.timeoutMs)||180000)+5000;
  const deadline=Date.now()+maxWait;
  while(Date.now()<deadline){
    const now=Date.now();
    let current=null;
    try{current=JSON.parse(localStorage.getItem(POSTPASS_LOCK_KEY)||'null');}catch{}
    if(!current||Number(current.expiresAt)<=now){
      const candidate={token,expiresAt:now+maxWait};
      try{
        localStorage.setItem(POSTPASS_LOCK_KEY,JSON.stringify(candidate));
        await sleep(50);
        const check=JSON.parse(localStorage.getItem(POSTPASS_LOCK_KEY)||'null');
        if(check?.token===token){
          try{return await task();}
          finally{
            try{
              const finalLock=JSON.parse(localStorage.getItem(POSTPASS_LOCK_KEY)||'null');
              if(finalLock?.token===token)localStorage.removeItem(POSTPASS_LOCK_KEY);
            }catch{}
          }
        }
      }catch{return await task();}
    }
    await sleep(150);
  }
  throw new Error('No s’ha pogut obtenir el torn per consultar Postpass.');
}
async function withQueryLock(task){
  if(navigator.locks?.request)return navigator.locks.request('wert-postpass-query',{mode:'exclusive'},task);
  return fallbackLock(task);
}
const cacheMessages={
  postpass:{
    using:'Usant memòria cau Postpass',
    skip:'No es fa una nova consulta al servidor',
    expired:'Memòria cau Postpass caducada',
    missing:'No hi ha memòria cau Postpass',
    updated:'Una altra pestanya ha actualitzat la memòria cau',
    saved:'Resposta Postpass desada en memòria cau',
    temporary:'Resposta Postpass en memòria cau temporal d’aquesta pestanya',
    persisted:'La consulta queda bloquejada fins que caduqui la memòria cau'
  },
  ok:{
    using:'Usant comprovació OK en memòria cau',
    skip:'No es fa una nova consulta de comprovació',
    expired:'Comprovació OK caducada',
    missing:'No hi ha comprovació OK en memòria cau',
    updated:'Una altra pestanya ha comprovat els OK',
    saved:'Comprovació OK desada en memòria cau',
    temporary:'Comprovació OK en memòria cau temporal d’aquesta pestanya',
    persisted:'Nova comprovació disponible quan caduqui la memòria cau'
  },
  monitor:{
    using:'Usant monitor en memòria cau',
    skip:'No es fa una nova consulta dels objectes vigilats',
    expired:'Monitor caducat',
    missing:'No hi ha monitor en memòria cau',
    updated:'Una altra pestanya ha actualitzat el monitor',
    saved:'Monitor desat en memòria cau',
    temporary:'Monitor en memòria cau temporal d’aquesta pestanya',
    persisted:'Nova comprovació disponible quan caduqui la memòria cau'
  }
};
async function getCachedData(kind,items,fetchNetwork){
  const messages=cacheMessages[kind];
  const initial=await readCache(kind,items);
  const initialStatus=statusForEntry(initial);
  if(initial&&initialStatus.fresh){
    activity.step(`${messages.using}: ${Math.floor(initialStatus.ageMs/1000)} s d’antiguitat`,messages.skip);
    return{payload:initial.payload,source:'cache',savedAt:initialStatus.savedAt};
  }
  activity.step(initialStatus.exists?`${messages.expired}: ${Math.floor(initialStatus.ageMs/1000)} s d’antiguitat`:messages.missing,'Esperant torn de consulta');
  return withQueryLock(async()=>{
    const current=await readCache(kind,items);
    const status=statusForEntry(current);
    if(current&&status.fresh){
      activity.step(messages.updated,'Reutilitzant la resposta sense consultar Postpass');
      return{payload:current.payload,source:'cache',savedAt:status.savedAt};
    }
    const payload=await fetchNetwork();
    const saved=await writeCache(kind,items,payload);
    activity.step(saved.persisted?`${messages.saved} durant ${Math.round(cacheTtlMs()/1000)} s`:messages.temporary,saved.persisted?messages.persisted:'L’emmagatzematge persistent del navegador no està disponible');
    return{payload,source:'network',savedAt:saved.entry.savedAt};
  });
}
function emptyCheckData(){
  return{payload:{postpass_properties:{timestamp:new Date().toISOString()},result:[]},source:'empty',savedAt:Date.now()};
}
export function getPostpassData(){
  return getCachedData('postpass',null,fetchPostpassNetwork);
}
export function getOkCheckData(items){
  if(!compileOkCheckQuery(items))return Promise.resolve(emptyCheckData());
  return getCachedData('ok',items,()=>fetchCheckNetwork(items,false));
}
export function getMonitorData(items){
  if(!compileOkCheckQuery(items))return Promise.resolve(emptyCheckData());
  return getCachedData('monitor',items,()=>fetchCheckNetwork(items,true));
}
export async function getMonitorDetailData(items){
  if(!items?.length)return{postpass_properties:{timestamp:new Date().toISOString()},type:'FeatureCollection',features:[]};
  return withQueryLock(()=>fetchMonitorDetailNetwork(items));
}
export async function getMonitorSnapshotData(){
  if(!isMonitorTask())throw new Error('La regeneració de snapshot només està disponible en tasques monitor.');
  return withQueryLock(()=>fetchMonitorSnapshotNetwork());
}
