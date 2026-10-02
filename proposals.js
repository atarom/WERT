import {activity} from './activity.js';
import {state} from './state.js';
import {acceptedToItem,isCompleteItem,keyFor,objectKeyFor,normalizeType,elementForFile,payloadFromItems,sameState,issueSignature} from './elements.js';
import {getAddedItems,getRemovedItems,getResolvedInconsistencies} from './changes.js';
function baseRepresentation(){
  return JSON.stringify({taskId:state.taskId,accepted:payloadFromItems(state.accepted).elements,inconsistencies:state.inconsistencies.map(issue=>({objectKey:issue.objectKey,signature:issueSignature(issue)})).sort((a,b)=>a.objectKey.localeCompare(b.objectKey))});
}
export async function sha256Text(text){
  const data=new TextEncoder().encode(text);
  const digest=await crypto.subtle.digest('SHA-256',data);
  return[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export async function refreshBaseHash(){
  state.baseHash=await sha256Text(baseRepresentation());
}
export function randomProposalId(){
  const bytes=new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const suffix=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
  const stamp=new Date().toISOString().replace(/\D/g,'').slice(0,14);
  return`wert-${state.taskId}-${stamp}-${suffix}`;
}
export function proposalFilename(proposal){
  return`${proposal.id}.json`;
}
export function buildProposalPayload(){
  const added=getAddedItems();
  const removed=getRemovedItems();
  const resolved=getResolvedInconsistencies();
  const currentByObject=new Map(state.accepted.map(item=>[objectKeyFor(item),item]));
  const touched=new Map();
  for(const item of[...added,...removed]){
    const objectKey=objectKeyFor(item);
    if(touched.has(objectKey))continue;
    const current=currentByObject.get(objectKey)||null;
    touched.set(objectKey,{type:item.type,id:typeof item.id==='number'?item.id:Number.isSafeInteger(Number(item.id))?Number(item.id):String(item.id),accepted:current?elementForFile(current):null});
  }
  return{format:'WERT-proposal',version:1,id:randomProposalId(),createdAt:new Date().toISOString(),taskId:state.taskId,taskName:state.config.name,base:{sha256:state.baseHash,elementsCount:state.accepted.length+state.inconsistencies.reduce((sum,issue)=>sum+(issue.sourceCount||issue.duplicateCount||1),0),elementsFile:state.config.elementsFile},baseState:[...touched.values()],source:{postpassTimestamp:state.postpassTimestamp},changes:{add:added.map(elementForFile),remove:removed.map(elementForFile),resolve:resolved.map(({issue,resolution})=>({issueKey:issue.objectKey,issueSignature:issueSignature(issue),desired:resolution.desired?elementForFile(resolution.desired):null}))}};
}
export function normalizeProposalItem(value){
  const item=acceptedToItem(value);
  if(!isCompleteItem(item))throw new Error('La proposta conté un element no vàlid o sense coordenades.');
  return item;
}
function normalizeResolution(value){
  const objectKey=String(value?.issueKey||'').trim();
  const signature=String(value?.issueSignature||'').trim();
  if(!objectKey||!signature)throw new Error('La proposta conté una resolució d’inconsistència no vàlida.');
  const desired=value.desired===null?null:normalizeProposalItem(value.desired);
  if(desired&&!objectKey.startsWith('invalid:')&&objectKeyFor(desired)!==objectKey)throw new Error('L’estat final de la resolució no correspon al mateix objecte.');
  if(desired&&objectKey.startsWith('invalid:'))throw new Error('Una entrada sense identitat OSM vàlida només es pot eliminar.');
  return{objectKey,issueSignature:signature,desired};
}
export function normalizeProposal(payload,filename){
  const version=Number(payload?.version);
  if(payload?.format!=='WERT-proposal'||version!==1)throw new Error('No és una proposta WERT compatible.');
  if(String(payload?.taskId||'')!==state.taskId)throw new Error(`La proposta pertany a la tasca "${payload?.taskId||'desconeguda'}", no a "${state.taskId}".`);
  const add=payload?.changes?.add;
  const remove=payload?.changes?.remove;
  const resolve=payload?.changes?.resolve;
  const baseState=payload?.baseState;
  if(!Array.isArray(add)||!Array.isArray(remove)||!Array.isArray(resolve)||!Array.isArray(baseState))throw new Error('La proposta no conté canvis o estat base vàlids.');
  const id=String(payload.id||'').trim();
  if(!id)throw new Error('La proposta no té identificador.');
  const normalizedAdd=add.map(normalizeProposalItem);
  const normalizedRemove=remove.map(normalizeProposalItem);
  const normalizedResolve=resolve.map(normalizeResolution);
  const addByObject=new Map();
  for(const item of normalizedAdd){
    const objectKey=objectKeyFor(item);
    const previous=addByObject.get(objectKey);
    if(previous&&keyFor(previous)!==keyFor(item))throw new Error(`La proposta conté més d’un estat final per a ${objectKey}.`);
    addByObject.set(objectKey,item);
  }
  const resolutionObjects=new Set();
  for(const resolution of normalizedResolve){
    if(resolutionObjects.has(resolution.objectKey))throw new Error(`La proposta conté més d’una resolució per a ${resolution.objectKey}.`);
    resolutionObjects.add(resolution.objectKey);
  }
  for(const objectKey of addByObject.keys())if(resolutionObjects.has(objectKey))throw new Error(`La proposta barreja un canvi normal i una resolució per a ${objectKey}.`);
  const normalizedBase=new Map();
  for(const entry of baseState){
    const type=normalizeType(entry?.type);
    const idValue=entry?.id;
    if(!['node','way','relation'].includes(type)||idValue===undefined||idValue===null)throw new Error('La proposta conté un estat base no vàlid.');
    const objectKey=`${type}:${String(idValue)}`;
    const accepted=entry.accepted===null?null:normalizeProposalItem(entry.accepted);
    if(accepted&&objectKeyFor(accepted)!==objectKey)throw new Error('L’estat base no coincideix amb l’objecte indicat.');
    normalizedBase.set(objectKey,accepted);
  }
  const touched=new Set([...normalizedAdd,...normalizedRemove].map(objectKeyFor));
  for(const objectKey of touched)if(!normalizedBase.has(objectKey))throw new Error(`Falta l’estat base de ${objectKey}.`);
  return{version,id,filename,createdAt:payload.createdAt||null,baseHash:String(payload?.base?.sha256||''),baseCount:Number(payload?.base?.elementsCount),baseState:normalizedBase,add:normalizedAdd,remove:normalizedRemove,resolve:normalizedResolve};
}
export async function importProposalFiles(files){
  const messages=[];
  for(const file of files){
    activity.step(`Llegint ${file.name}`,`${file.size} bytes`);
    try{
      const text=await file.text();
      const payload=JSON.parse(text);
      const proposal=normalizeProposal(payload,file.name);
      if(state.importedProposals.some(item=>item.id===proposal.id)){messages.push(`${file.name}: ja estava importada`);continue;}
      state.importedProposals.push(proposal);
      messages.push(`${file.name}: importada`);
      activity.step(`${file.name}: proposta vàlida`,`${proposal.add.length} altes, ${proposal.remove.length} baixes i ${proposal.resolve.length} resolucions`);
    }catch(error){
      messages.push(`${file.name}: ${error?.message||error}`);
      activity.step(`${file.name}: rebutjada`,error?.message||String(error));
    }
  }
  state.conflictResolutions.clear();
  return messages;
}
function baselineIssueMatches(issue,resolution){
  return!!issue&&issueSignature(issue)===resolution.issueSignature;
}
function candidateKey(item){
  return item?`item:${keyFor(item)}`:'remove';
}
export function mergePlan(){
  const currentByObject=new Map(state.accepted.map(item=>[objectKeyFor(item),item]));
  const currentIssues=new Map(state.inconsistencies.map(issue=>[issue.objectKey,issue]));
  const intents=new Map();
  const push=(objectKey,intent)=>{if(!intents.has(objectKey))intents.set(objectKey,[]);intents.get(objectKey).push(intent);};
  for(const proposal of state.importedProposals){
    const addsByObject=new Map(proposal.add.map(item=>[objectKeyFor(item),item]));
    const removes=new Set(proposal.remove.map(objectKeyFor));
    const touched=new Set([...addsByObject.keys(),...removes]);
    for(const objectKey of touched)push(objectKey,{source:proposal.filename,kind:'normal',baseline:proposal.baseState.get(objectKey)??null,desired:addsByObject.get(objectKey)||null});
    for(const resolution of proposal.resolve)push(resolution.objectKey,{source:proposal.filename,kind:'issue',baseline:resolution,desired:resolution.desired});
  }
  for(const[objectKey,resolution]of state.inconsistencyResolutions){
    const issue=currentIssues.get(objectKey);
    if(issue)push(objectKey,{source:'Sessió actual',kind:'issue-local',baseline:{issueSignature:issueSignature(issue)},desired:resolution.desired});
  }
  const changes=new Map();
  const conflicts=[];
  for(const[objectKey,objectIntents]of intents){
    const current=currentByObject.get(objectKey)||null;
    const currentIssue=currentIssues.get(objectKey)||null;
    const candidates=new Map();
    const reasons=[];
    const sources=new Set();
    for(const intent of objectIntents){
      sources.add(intent.source);
      if(intent.kind==='normal'){
        if(currentIssue){
          candidates.set(candidateKey(intent.desired),intent.desired);
          reasons.push(`${intent.source} parteix d’un estat normal però l’objecte és inconsistent actualment.`);
          continue;
        }
        if(sameState(current,intent.desired))continue;
        candidates.set(candidateKey(intent.desired),intent.desired);
        if(!sameState(current,intent.baseline))reasons.push(`${intent.source} parteix d’un altre estat per a aquest objecte.`);
        continue;
      }
      if(currentIssue){
        const matches=intent.kind==='issue-local'||baselineIssueMatches(currentIssue,intent.baseline);
        candidates.set(candidateKey(intent.desired),intent.desired);
        if(!matches)reasons.push(`${intent.source} parteix d’una inconsistència diferent de l’actual.`);
        continue;
      }
      if(sameState(current,intent.desired))continue;
      candidates.set(candidateKey(intent.desired),intent.desired);
      reasons.push(`${intent.source} intenta resoldre una inconsistència que ja no existeix o ha canviat.`);
    }
    if(reasons.length||candidates.size>1){
      conflicts.push({objectKey,current,currentIssue,candidates:[...candidates.values()],sources:[...sources],reasons:[...new Set(reasons)]});
      continue;
    }
    if(candidates.size===1)changes.set(objectKey,[...candidates.values()][0]);
  }
  return{currentByObject,currentIssues,conflicts,changes};
}
export function conflictChoices(conflict){
  const choices=[];
  const seen=new Set();
  const add=(value,label,item)=>{if(seen.has(value))return;seen.add(value);choices.push({value,label,item});};
  if(conflict.current)add(`item:${keyFor(conflict.current)}`,`Conservar l’actual: ${conflict.current.name}`,conflict.current);
  for(const item of conflict.currentIssue?.candidates||[])add(`item:${keyFor(item)}`,`Conservar d’elementsOK: ${item.name}`,item);
  for(const item of conflict.candidates.filter(Boolean))add(`item:${keyFor(item)}`,`Acceptar proposta: ${item.name}`,item);
  add('remove',"Eliminar d'OK",null);
  return choices;
}
export function buildMergedPayload(){
  const plan=mergePlan();
  const result=new Map(plan.currentByObject);
  for(const[objectKey,item]of plan.changes){
    if(item)result.set(objectKey,item);
    else result.delete(objectKey);
  }
  const unresolved=[];
  const resolvedObjects=new Set(plan.changes.keys());
  for(const conflict of plan.conflicts){
    const resolution=state.conflictResolutions.get(conflict.objectKey);
    if(!resolution){unresolved.push({type:'conflict',conflict});continue;}
    resolvedObjects.add(conflict.objectKey);
    if(resolution==='remove'){result.delete(conflict.objectKey);continue;}
    if(resolution.startsWith('item:')){
      const wanted=resolution.slice(5);
      const item=[conflict.current,...(conflict.currentIssue?.candidates||[]),...conflict.candidates].filter(Boolean).find(candidate=>keyFor(candidate)===wanted);
      if(item)result.set(conflict.objectKey,item);
      else unresolved.push({type:'conflict',conflict});
    }
  }
  for(const issue of state.inconsistencies)if(!resolvedObjects.has(issue.objectKey))unresolved.push({type:'inconsistency',issue});
  return{payload:payloadFromItems([...result.values()]),plan,unresolved};
}
export function formatShortHash(value){
  return value?value.slice(0,10):'sense hash';
}
