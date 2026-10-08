function containsArray(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  return Object.values(value).some(item=>Array.isArray(item)||(item&&typeof item==='object'&&!Array.isArray(item)&&containsArray(item)));
}
function formatJson(value){
  if(Array.isArray(value)){
    if(!value.length)return'[]';
    return`[\n${value.map(item=>JSON.stringify(item)??'null').join(',\n')}\n]`;
  }
  if(value&&typeof value==='object'){
    if(!containsArray(value))return JSON.stringify(value)??'null';
    const entries=Object.entries(value).filter(([,item])=>item!==undefined&&typeof item!=='function'&&typeof item!=='symbol');
    if(!entries.length)return'{}';
    return`{\n${entries.map(([key,item])=>`${JSON.stringify(key)}:${formatJson(item)}`).join(',\n')}\n}`;
  }
  return JSON.stringify(value)??'null';
}
export function stringifyJson(value){
  return`${formatJson(value)}\n`;
}
export function downloadText(filename,text,type){
  const blob=new Blob([text],{type});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download=filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function copyText(text,button,label){
  await navigator.clipboard.writeText(text);
  const original=button.textContent;
  button.textContent=label;
  setTimeout(()=>{button.textContent=original;},1400);
}
