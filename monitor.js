import {acceptedToItem,isCompleteItem,objectKeyFor,sameState,trackedDifferences,trackedState} from './elements.js';
function cloneIssue(issue){
  return{...issue,candidates:[...(issue.candidates||[])]};
}
function monitorIssue(item,row,kind){
  const objectKey=objectKeyFor(item);
  const candidate=row?acceptedToItem({type:item.type,id:item.id,coordinates:item.coordinates,tags:row.tags}):null;
  const current=candidate&&isCompleteItem(candidate)?candidate:null;
  const differences=candidate?trackedDifferences(item,candidate):[];
  const detail=differences.map(change=>`${change.key}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`).join(' · ');
  const message=kind==='monitor-missing'?`L’objecte ${item.type} ${item.id} ja no apareix a Postpass. Decideix si es conserva al monitor o s’elimina.`:`L’objecte continua existint però no té un estat controlat vàlid${detail?`: ${detail}`:''}. Decideix si es conserva al monitor o s’elimina.`;
  return{issueId:`issue:monitor:${objectKey}`,objectKey,lookupObjectKey:objectKey,type:item.type,id:item.id,name:item.name,coordinates:item.coordinates,candidates:[item],current,duplicateCount:1,sourceCount:1,kind,message,rawEntries:[],tags:row?.tags||item.tags||{},signature:JSON.stringify({objectKey,kind,expected:trackedState(item),current:candidate?trackedState(candidate):null})};
}
export function compareMonitorPayload(baseItems,baseInconsistencies,payload){
  if(!Array.isArray(payload?.result))throw new Error('La resposta del monitor no conté un array result vàlid.');
  const byObject=new Map();
  for(const row of payload.result){
    const type=String(row?.type||'').toLowerCase();
    const id=Number(row?.id);
    if(!['node','way','relation'].includes(type)||!Number.isSafeInteger(id)||id<=0)continue;
    byObject.set(`${type}:${id}`,row);
  }
  const changed=[];
  const issues=baseInconsistencies.map(cloneIssue);
  let ok=0;
  let missing=0;
  let invalid=0;
  for(const item of baseItems){
    const objectKey=objectKeyFor(item);
    const row=byObject.get(objectKey);
    if(!row){
      missing++;
      issues.push(monitorIssue(item,null,'monitor-missing'));
      continue;
    }
    const current=acceptedToItem({type:item.type,id:item.id,coordinates:item.coordinates,tags:row.tags});
    if(sameState(item,current)){
      ok++;
      continue;
    }
    if(!isCompleteItem(current)){
      invalid++;
      issues.push(monitorIssue(item,row,'monitor-invalid-state'));
      continue;
    }
    changed.push(current);
  }
  return{changed,issues,summary:{checked:baseItems.length,ok,changed:changed.length,missing,invalid,issues:issues.length-baseInconsistencies.length},timestamp:payload.postpass_properties?.timestamp||null};
}
