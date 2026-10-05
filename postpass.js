import {activity} from './activity.js';
import {state} from './state.js';
import {trackedTagKeys} from './elements.js';
const POSTPASS_LOCK_KEY='wert:postpass-lock:v2';
const OK_CHECK_CACHE_PREFIX='wert:okcheck-cache:v1:';
const MONITOR_CACHE_PREFIX='wert:monitor-cache:v1:';
let memoryCache=null;
let memoryOkCheckCache=null;
let memoryMonitorCache=null;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function isMonitorTask(){
  return state.config?.mode==='monitor';
}
function objectClauses(items,alias='e'){
  const groups={N:new Set(),W:new Set(),R:new Set()};
  const codes={node:'N',way:'W',relation:'R'};
  for(const item of items||[]){
    const code=codes[String(item?.type||'').toLowerCase()];
    const id=Number(item?.id);
    if(code&&Number.isSafeInteger(id)&&id>0)groups[code].add(String(id));
  }
  const clauses=[];
  for(const code of['N','W','R']){
    const ids=[...groups[code]].sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));
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
export function compileOkCheckQuery(items){
  const clauses=objectClauses(items);
  if(!clauses.length)return'';
  return[`SELECT DISTINCT ON (e.osm_type,e.osm_id)`,`CASE e.osm_type WHEN 'N' THEN 'node' WHEN 'W' THEN 'way' WHEN 'R' THEN 'relation' END AS type,`,`e.osm_id AS id,`,`${trackedTagsExpression()} AS tags`,`FROM postpass_pointlinepolygon e`,`WHERE ${clauses.join('\nOR\n')}`,`ORDER BY e.osm_type,e.osm_id`].join('\n');
}
export function compileMonitorDetailQuery(items){
  const clauses=objectClauses(items);
  if(!clauses.length)return'';
  return[`SELECT DISTINCT ON (e.osm_type,e.osm_id)`,`CASE e.osm_type WHEN 'N' THEN 'node' WHEN 'W' THEN 'way' WHEN 'R' THEN 'relation' END AS type,`,`e.osm_id AS id,`,`e.tags->>'name' AS name,`,`e.tags AS tags,`,`ST_PointOnSurface(e.geom) AS geom`,`FROM postpass_pointlinepolygon e`,`WHERE ${clauses.join('\nOR\n')}`,`ORDER BY e.osm_type,e.osm_id`].join('\n');
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
function cacheKey(){
  return`wert:postpass-cache:v2:${state.taskId}`;
}
function cacheIdentity(){
  return{taskId:state.taskId,endpoint:String(state.config?.postpass?.endpoint||''),query:compileQuery()};
}
function matchesCache(entry){
  if(!entry||typeof entry!=='object'||!entry.payload||!Number.isFinite(Number(entry.savedAt)))return false;
  const identity=cacheIdentity();
  return entry.taskId===identity.taskId&&entry.endpoint===identity.endpoint&&entry.query===identity.query;
}
function readCache(){
  try{
    const raw=localStorage.getItem(cacheKey());
    if(raw){
      const parsed=JSON.parse(raw);
      if(matchesCache(parsed)){memoryCache=parsed;return parsed;}
    }
  }catch{}
  return matchesCache(memoryCache)?memoryCache:null;
}
function writeCache(payload){
  const identity=cacheIdentity();
  const entry={savedAt:Date.now(),taskId:identity.taskId,endpoint:identity.endpoint,query:identity.query,payload};
  memoryCache=entry;
  let persisted=true;
  try{localStorage.setItem(cacheKey(),JSON.stringify(entry));}catch{persisted=false;}
  return{entry,persisted};
}
export function getPostpassCacheStatus(){
  if(!state.config?.postpass)return emptyStatus(0);
  return statusForEntry(readCache());
}
function okCheckCacheKey(){
  return`${OK_CHECK_CACHE_PREFIX}${state.taskId}`;
}
function okCheckIdentity(items){
  return{taskId:state.taskId,endpoint:String(state.config?.postpass?.endpoint||''),query:compileOkCheckQuery(items)};
}
function matchesOkCheckCache(entry,items){
  if(!entry||typeof entry!=='object'||!entry.payload||!Number.isFinite(Number(entry.savedAt)))return false;
  const identity=okCheckIdentity(items);
  return entry.taskId===identity.taskId&&entry.endpoint===identity.endpoint&&entry.query===identity.query;
}
function readOkCheckCache(items){
  try{
    const raw=localStorage.getItem(okCheckCacheKey());
    if(raw){
      const parsed=JSON.parse(raw);
      if(matchesOkCheckCache(parsed,items)){memoryOkCheckCache=parsed;return parsed;}
    }
  }catch{}
  return matchesOkCheckCache(memoryOkCheckCache,items)?memoryOkCheckCache:null;
}
function writeOkCheckCache(items,payload){
  const identity=okCheckIdentity(items);
  const entry={savedAt:Date.now(),taskId:identity.taskId,endpoint:identity.endpoint,query:identity.query,payload};
  memoryOkCheckCache=entry;
  let persisted=true;
  try{localStorage.setItem(okCheckCacheKey(),JSON.stringify(entry));}catch{persisted=false;}
  return{entry,persisted};
}
export function getOkCheckCacheStatus(items){
  if(!state.config?.postpass)return emptyStatus();
  return statusForEntry(readOkCheckCache(items));
}
function monitorCacheKey(){
  return`${MONITOR_CACHE_PREFIX}${state.taskId}`;
}
function monitorIdentity(items){
  return{taskId:state.taskId,endpoint:String(state.config?.postpass?.endpoint||''),query:compileOkCheckQuery(items)};
}
function matchesMonitorCache(entry,items){
  if(!entry||typeof entry!=='object'||!entry.payload||!Number.isFinite(Number(entry.savedAt)))return false;
  const identity=monitorIdentity(items);
  return entry.taskId===identity.taskId&&entry.endpoint===identity.endpoint&&entry.query===identity.query;
}
function readMonitorCache(items){
  try{
    const raw=localStorage.getItem(monitorCacheKey());
    if(raw){
      const parsed=JSON.parse(raw);
      if(matchesMonitorCache(parsed,items)){memoryMonitorCache=parsed;return parsed;}
    }
  }catch{}
  return matchesMonitorCache(memoryMonitorCache,items)?memoryMonitorCache:null;
}
function writeMonitorCache(items,payload){
  const identity=monitorIdentity(items);
  const entry={savedAt:Date.now(),taskId:identity.taskId,endpoint:identity.endpoint,query:identity.query,payload};
  memoryMonitorCache=entry;
  let persisted=true;
  try{localStorage.setItem(monitorCacheKey(),JSON.stringify(entry));}catch{persisted=false;}
  return{entry,persisted};
}
export function getMonitorCacheStatus(items){
  if(!state.config?.postpass)return emptyStatus();
  return statusForEntry(readMonitorCache(items));
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
async function fetchOkCheckNetwork(items){
  const query=compileOkCheckQuery(items);
  if(!query)return{postpass_properties:{timestamp:new Date().toISOString()},result:[]};
  const payload=await postForm(query,{geojson:false,timeoutMs:Math.min(Number(state.config.postpass.timeoutMs)||180000,60000),progressLabel:`Consulta de comprovació preparada: ${items.length} elements i ${query.length} caràcters`,responseLabel:'Comprovació Postpass'});
  if(!Array.isArray(payload?.result))throw new Error('La comprovació Postpass no ha retornat un array result vàlid.');
  return payload;
}
async function fetchMonitorNetwork(items){
  const query=compileOkCheckQuery(items);
  if(!query)return{postpass_properties:{timestamp:new Date().toISOString()},result:[]};
  const payload=await postForm(query,{geojson:false,progressLabel:`Consulta monitor preparada: ${items.length} elements i ${query.length} caràcters`,responseLabel:'Monitor Postpass'});
  if(!Array.isArray(payload?.result))throw new Error('La consulta monitor no ha retornat un array result vàlid.');
  return payload;
}
async function fetchMonitorDetailNetwork(items){
  const query=compileMonitorDetailQuery(items);
  if(!query)return{postpass_properties:{timestamp:new Date().toISOString()},type:'FeatureCollection',features:[]};
  const payload=await postForm(query,{progressLabel:`Detall monitor preparat: ${items.length} elements i ${query.length} caràcters`,responseLabel:'Detall Postpass'});
  if(payload?.type!=='FeatureCollection'||!Array.isArray(payload?.features))throw new Error('El detall monitor no ha retornat un FeatureCollection GeoJSON vàlid.');
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
export async function getPostpassData(){
  const initial=readCache();
  const initialStatus=getPostpassCacheStatus();
  if(initial&&initialStatus.fresh){
    activity.step(`Usant memòria cau Postpass: ${Math.floor(initialStatus.ageMs/1000)} s d’antiguitat`,'No es fa una nova consulta al servidor');
    return{payload:initial.payload,source:'cache',savedAt:initialStatus.savedAt};
  }
  activity.step(initialStatus.exists?`Memòria cau Postpass caducada: ${Math.floor(initialStatus.ageMs/1000)} s d’antiguitat`:'No hi ha memòria cau Postpass','Esperant torn de consulta');
  return withQueryLock(async()=>{
    const current=readCache();
    const status=getPostpassCacheStatus();
    if(current&&status.fresh){
      activity.step('Una altra pestanya ha actualitzat la memòria cau','Reutilitzant la resposta sense consultar Postpass');
      return{payload:current.payload,source:'cache',savedAt:status.savedAt};
    }
    const payload=await fetchPostpassNetwork();
    const saved=writeCache(payload);
    activity.step(saved.persisted?`Resposta Postpass desada en memòria cau durant ${Math.round(cacheTtlMs()/1000)} s`:'Resposta Postpass en memòria cau temporal d’aquesta pestanya',saved.persisted?'La consulta queda bloquejada fins que caduqui la memòria cau':'L’emmagatzematge persistent del navegador no està disponible');
    return{payload,source:'network',savedAt:saved.entry.savedAt};
  });
}
export async function getOkCheckData(items){
  const query=compileOkCheckQuery(items);
  if(!query)return{payload:{postpass_properties:{timestamp:new Date().toISOString()},result:[]},source:'empty',savedAt:Date.now()};
  const initial=readOkCheckCache(items);
  const initialStatus=getOkCheckCacheStatus(items);
  if(initial&&initialStatus.fresh){
    activity.step(`Usant comprovació OK en memòria cau: ${Math.floor(initialStatus.ageMs/1000)} s d’antiguitat`,'No es fa una nova consulta de comprovació');
    return{payload:initial.payload,source:'cache',savedAt:initialStatus.savedAt};
  }
  activity.step(initialStatus.exists?`Comprovació OK caducada: ${Math.floor(initialStatus.ageMs/1000)} s d’antiguitat`:'No hi ha comprovació OK en memòria cau','Esperant torn de consulta');
  return withQueryLock(async()=>{
    const current=readOkCheckCache(items);
    const status=getOkCheckCacheStatus(items);
    if(current&&status.fresh){
      activity.step('Una altra pestanya ha comprovat els OK','Reutilitzant la resposta sense consultar Postpass');
      return{payload:current.payload,source:'cache',savedAt:status.savedAt};
    }
    const payload=await fetchOkCheckNetwork(items);
    const saved=writeOkCheckCache(items,payload);
    activity.step(saved.persisted?`Comprovació OK desada en memòria cau durant ${Math.round(cacheTtlMs()/1000)} s`:'Comprovació OK en memòria cau temporal d’aquesta pestanya',saved.persisted?'Nova comprovació disponible quan caduqui la memòria cau':'L’emmagatzematge persistent del navegador no està disponible');
    return{payload,source:'network',savedAt:saved.entry.savedAt};
  });
}
export async function getMonitorData(items){
  const query=compileOkCheckQuery(items);
  if(!query)return{payload:{postpass_properties:{timestamp:new Date().toISOString()},result:[]},source:'empty',savedAt:Date.now()};
  const initial=readMonitorCache(items);
  const initialStatus=getMonitorCacheStatus(items);
  if(initial&&initialStatus.fresh){
    activity.step(`Usant monitor en memòria cau: ${Math.floor(initialStatus.ageMs/1000)} s d’antiguitat`,'No es fa una nova consulta dels objectes vigilats');
    return{payload:initial.payload,source:'cache',savedAt:initialStatus.savedAt};
  }
  activity.step(initialStatus.exists?`Monitor caducat: ${Math.floor(initialStatus.ageMs/1000)} s d’antiguitat`:'No hi ha monitor en memòria cau','Esperant torn de consulta');
  return withQueryLock(async()=>{
    const current=readMonitorCache(items);
    const status=getMonitorCacheStatus(items);
    if(current&&status.fresh){
      activity.step('Una altra pestanya ha actualitzat el monitor','Reutilitzant la resposta sense consultar Postpass');
      return{payload:current.payload,source:'cache',savedAt:status.savedAt};
    }
    const payload=await fetchMonitorNetwork(items);
    const saved=writeMonitorCache(items,payload);
    activity.step(saved.persisted?`Monitor desat en memòria cau durant ${Math.round(cacheTtlMs()/1000)} s`:'Monitor en memòria cau temporal d’aquesta pestanya',saved.persisted?'Nova comprovació disponible quan caduqui la memòria cau':'L’emmagatzematge persistent del navegador no està disponible');
    return{payload,source:'network',savedAt:saved.entry.savedAt};
  });
}
export async function getMonitorDetailData(items){
  if(!items?.length)return{postpass_properties:{timestamp:new Date().toISOString()},type:'FeatureCollection',features:[]};
  return withQueryLock(()=>fetchMonitorDetailNetwork(items));
}
