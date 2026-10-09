export const state={
  appConfig:null,
  config:null,
  taskId:'',
  map:null,
  popup:null,
  rawFeatures:[],
  pending:[],
  accepted:[],
  inconsistencies:[],
  mode:'pending',
  selectedKey:null,
  addKeys:new Set(),
  removeKeys:new Set(),
  inconsistencyResolutions:new Map(),
  savedSignature:'',
  postpassTimestamp:null,
  baseHash:'',
  importedProposals:[],
  conflictResolutions:new Map(),
  search:'',
  type:'all',
  tagKey:'',
  tagValue:'',
  mapReady:false
};
if(typeof document!=='undefined'){
  const init=()=>import('./combined-snapshot.js').then(module=>module.initCombinedSnapshot()).catch(error=>{const banner=document.getElementById('error-banner');if(banner){banner.textContent=`No s'ha pogut iniciar la consolidació combinada: ${error?.message||error}`;banner.classList.remove('hidden');}});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
}
