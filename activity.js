const fallback={begin(){},step(){},done(){},fail(){},hide(){},detail(){}};
const activity=window.WERTActivity||fallback;
const overlay=document.getElementById('loading-overlay');
let locked=false;
let suspendedDialogs=[];
function suspendOpenDialogs(){
  for(const dialog of document.querySelectorAll('dialog[open]')){
    if(suspendedDialogs.includes(dialog))continue;
    suspendedDialogs.push(dialog);
    dialog.close();
  }
}
function restoreDialogs(){
  const dialogs=suspendedDialogs;
  suspendedDialogs=[];
  for(const dialog of dialogs){
    if(!dialog.isConnected||dialog.open)continue;
    try{dialog.showModal();}catch{}
  }
}
function blockOutsideOverlay(event){
  if(!locked||!overlay||overlay.contains(event.target))return;
  event.preventDefault();
  event.stopImmediatePropagation();
}
function keepFocusInside(event){
  if(!locked||!overlay||overlay.contains(event.target))return;
  event.stopImmediatePropagation();
  overlay.focus({preventScroll:true});
}
function addGuards(){
  document.addEventListener('pointerdown',blockOutsideOverlay,true);
  document.addEventListener('click',blockOutsideOverlay,true);
  document.addEventListener('touchstart',blockOutsideOverlay,{capture:true,passive:false});
  document.addEventListener('wheel',blockOutsideOverlay,{capture:true,passive:false});
  document.addEventListener('keydown',blockOutsideOverlay,true);
  document.addEventListener('focusin',keepFocusInside,true);
}
function removeGuards(){
  document.removeEventListener('pointerdown',blockOutsideOverlay,true);
  document.removeEventListener('click',blockOutsideOverlay,true);
  document.removeEventListener('touchstart',blockOutsideOverlay,true);
  document.removeEventListener('wheel',blockOutsideOverlay,true);
  document.removeEventListener('keydown',blockOutsideOverlay,true);
  document.removeEventListener('focusin',keepFocusInside,true);
}
function lock(){
  if(!overlay||locked)return;
  locked=true;
  suspendOpenDialogs();
  addGuards();
  overlay.focus({preventScroll:true});
}
function unlock(){
  if(!locked)return;
  locked=false;
  removeGuards();
  restoreDialogs();
}
if(overlay){
  document.body.append(overlay);
  overlay.style.position='fixed';
  overlay.style.inset='0';
  overlay.style.zIndex='2147483647';
  overlay.style.width='100vw';
  overlay.style.height='100dvh';
  overlay.style.maxWidth='none';
  overlay.style.maxHeight='none';
  overlay.style.margin='0';
  overlay.style.pointerEvents='auto';
  overlay.tabIndex=-1;
  const sync=()=>overlay.classList.contains('hidden')?unlock():lock();
  new MutationObserver(sync).observe(overlay,{attributes:true,attributeFilter:['class']});
  new MutationObserver(()=>{if(locked)suspendOpenDialogs();}).observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
  sync();
}
export{activity};
