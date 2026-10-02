import {activity} from './activity.js';
import {state} from './state.js';
const POSTPASS_LOCK_KEY='wert:postpass-lock:v2';
let memoryCache=null;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function compileQuery(){
  const postpass=state.config.postpass;
  const escaped=String(postpass.nameRegex||'').replaceAll("'","''");
  return String(postpass.query||'').replaceAll('__NAME_REGEX__',escaped).trim();
}
export async function loadJson(url){
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok)throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}
function cacheKey(){
  return`wert:postpass-cache:v2:${state.taskId}`;
}
function cacheTtlMs(){
  return Math.max(1000,Number(state.config?.postpass?.cacheSeconds??60)*1000);
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
  if(!state.config?.postpass)return{exists:false,fresh:false,ageMs:Infinity,remainingMs:0,savedAt:0,ttlMs:0};
  const entry=readCache();
  const ttlMs=cacheTtlMs();
  if(!entry)return{exists:false,fresh:false,ageMs:Infinity,remainingMs:0,savedAt:0,ttlMs};
  const ageMs=Math.max(0,Date.now()-Number(entry.savedAt));
  const remainingMs=Math.max(0,ttlMs-ageMs);
  return{exists:true,fresh:remainingMs>0,ageMs,remainingMs,savedAt:Number(entry.savedAt),ttlMs};
}
async function fetchPostpassNetwork(){
  const postpass=state.config.postpass;
  const query=compileQuery();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Number(postpass.timeoutMs)||180000);
  const params=new URLSearchParams();
  params.set('data',query);
  activity.step(`Consulta Postpass preparada: ${query.length} caràcters`,`Enviant petició a ${postpass.endpoint}`);
  try{
    const response=await fetch(postpass.endpoint,{method:postpass.method||'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:params.toString(),signal:controller.signal});
    activity.step(`Postpass ha respost HTTP ${response.status}`,'Llegint resposta GeoJSON');
    if(!response.ok){
      const detail=await response.text().catch(()=>'');
      throw new Error(`Postpass ha respost HTTP ${response.status}${detail?`: ${detail.slice(0,300)}`:''}`);
    }
    return await response.json();
  }finally{clearTimeout(timer);}
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
