export function createVirtualList(container,createCard,itemKey){
  container.style.overflowAnchor='none';
  const estimatedHeight=72;
  const overscan=450;
  const top=document.createElement('div');
  const rows=document.createElement('div');
  const bottom=document.createElement('div');
  top.setAttribute('aria-hidden','true');
  bottom.setAttribute('aria-hidden','true');
  let items=[];
  let heights=[];
  let offsets=[0];
  let first=-1;
  let last=-1;
  let frame=0;
  let width=container.clientWidth;
  function buildOffsets(){
    offsets=new Array(items.length+1);
    offsets[0]=0;
    for(let i=0;i<items.length;i++)offsets[i+1]=offsets[i]+heights[i];
  }
  function updateSpacers(){
    top.style.height=`${offsets[Math.max(0,first)]||0}px`;
    bottom.style.height=`${Math.max(0,offsets[items.length]-offsets[Math.max(0,last)]||0)}px`;
  }
  function indexAt(position){
    let low=0;
    let high=items.length;
    while(low<high){
      const mid=(low+high)>>1;
      if(offsets[mid+1]<=position)low=mid+1;
      else high=mid;
    }
    return low;
  }
  const measure=new ResizeObserver(entries=>{
    let changed=false;
    for(const entry of entries){
      const index=Number(entry.target.dataset.virtualIndex);
      if(!Number.isInteger(index)||index<first||index>=last)continue;
      const height=Math.max(1,Math.ceil(entry.borderBoxSize?.[0]?.blockSize||entry.target.getBoundingClientRect().height));
      if(heights[index]===height)continue;
      heights[index]=height;
      changed=true;
    }
    if(changed){buildOffsets();updateSpacers();schedule();}
  });
  function draw(force=false){
    if(!items.length)return;
    const start=indexAt(Math.max(0,container.scrollTop-overscan));
    const end=Math.min(items.length,indexAt(container.scrollTop+(container.clientHeight||500)+overscan)+1);
    if(!force&&start===first&&end===last)return;
    const active=document.activeElement;
    const focusedCard=active?.closest?.('.item-card');
    const focusedIndex=focusedCard&&rows.contains(focusedCard)?Number(focusedCard.dataset.virtualIndex):-1;
    const focusPath=[];
    if(focusedIndex>=start&&focusedIndex<end){
      let node=active;
      while(node!==focusedCard){
        focusPath.unshift(Array.from(node.parentElement.children).indexOf(node));
        node=node.parentElement;
      }
    }
    first=start;
    last=end;
    measure.disconnect();
    const fragment=document.createDocumentFragment();
    for(let i=start;i<end;i++){
      const card=createCard(items[i]);
      card.dataset.virtualIndex=String(i);
      fragment.append(card);
    }
    rows.replaceChildren(fragment);
    if(focusedIndex>=start&&focusedIndex<end){
      let target=rows.children[focusedIndex-start];
      for(const position of focusPath)target=target?.children[position];
      target?.focus({preventScroll:true});
    }
    updateSpacers();
    for(const card of rows.children)measure.observe(card);
  }
  function schedule(){
    if(frame)return;
    frame=requestAnimationFrame(()=>{frame=0;draw();});
  }
  function scrollToIndex(index,focus=false){
    if(index<0||index>=items.length)return;
    const position=offsets[index];
    const end=offsets[index+1];
    const viewport=container.clientHeight||500;
    if(position<container.scrollTop)container.scrollTop=position;
    else if(end>container.scrollTop+viewport)container.scrollTop=Math.max(0,end-viewport);
    draw();
    const card=Array.from(rows.children).find(element=>Number(element.dataset.virtualIndex)===index);
    if(card){
      if(focus)card.focus({preventScroll:true});
      else card.scrollIntoView({block:'nearest'});
    }
  }
  container.addEventListener('scroll',schedule,{passive:true});
  container.addEventListener('keydown',event=>{
    if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;
    const card=event.target.closest('.item-card');
    if(!card||event.target!==card)return;
    const index=Number(card.dataset.virtualIndex)+(event.key==='ArrowDown'?1:-1);
    if(index<0||index>=items.length)return;
    event.preventDefault();
    scrollToIndex(index,true);
  });
  const resize=new ResizeObserver(()=>{
    if(!items.length)return;
    if(container.clientWidth!==width){
      width=container.clientWidth;
      heights.fill(estimatedHeight);
      buildOffsets();
      draw(true);
    }else schedule();
  });
  resize.observe(container);
  return{
    setItems(nextItems,emptyMessage){
      if(nextItems!==items){
        items=nextItems;
        heights=new Array(items.length).fill(estimatedHeight);
        buildOffsets();
        first=-1;
        last=-1;
        measure.disconnect();
        rows.replaceChildren();
        container.scrollTop=0;
        container.replaceChildren(top,rows,bottom);
      }
      if(!items.length){
        measure.disconnect();
        rows.replaceChildren();
        top.style.height='0px';
        bottom.style.height='0px';
        const empty=document.createElement('div');
        empty.className='empty-state';
        empty.textContent=emptyMessage;
        rows.append(empty);
        return;
      }
      draw(true);
    },
    scrollToKey(key){
      const index=items.findIndex(item=>itemKey(item)===key);
      if(index>=0)scrollToIndex(index);
    }
  };
}
