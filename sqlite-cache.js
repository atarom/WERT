import {sqliteEngine} from './sqlite.js';
const DATABASE_NAME='wert-sqlite-cache-v1';
const DATABASE_KEY='postpass-cache.sqlite';
const TABLE='CREATE TABLE IF NOT EXISTS responses (kind TEXT NOT NULL,task_id TEXT NOT NULL,endpoint TEXT NOT NULL,signature TEXT,query TEXT,saved_at INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,task_id))';
let pendingWrites=Promise.resolve();
function openStore(){
  return new Promise((resolve,reject)=>{
    if(!window.indexedDB){reject(new Error('IndexedDB no disponible'));return;}
    const request=indexedDB.open(DATABASE_NAME,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('files');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function readFile(){
  const store=await openStore();
  try{
    return await new Promise((resolve,reject)=>{
      const transaction=store.transaction('files','readonly');
      const request=transaction.objectStore('files').get(DATABASE_KEY);
      request.onsuccess=()=>resolve(request.result||null);
      request.onerror=()=>reject(request.error);
    });
  }finally{store.close();}
}
async function writeFile(bytes){
  const store=await openStore();
  try{
    await new Promise((resolve,reject)=>{
      const transaction=store.transaction('files','readwrite');
      transaction.objectStore('files').put(bytes,DATABASE_KEY);
      transaction.oncomplete=()=>resolve();
      transaction.onerror=()=>reject(transaction.error);
      transaction.onabort=()=>reject(transaction.error);
    });
  }finally{store.close();}
}
async function openDatabase(){
  const SQL=await sqliteEngine();
  const bytes=await readFile();
  const db=bytes?new SQL.Database(new Uint8Array(bytes)):new SQL.Database();
  db.run(TABLE);
  return db;
}
export async function readStoredCache(kind,taskId){
  let db;
  try{
    db=await openDatabase();
    const stmt=db.prepare('SELECT endpoint,signature,query,saved_at,payload FROM responses WHERE kind=? AND task_id=?');
    try{
      stmt.bind([kind,taskId]);
      if(!stmt.step())return null;
      const [endpoint,signature,query,savedAt,payload]=stmt.get();
      return{taskId,endpoint,signature,query,savedAt,payload:JSON.parse(payload)};
    }finally{stmt.free();}
  }finally{db?.close();}
}
async function persistEntry(kind,entry){
  let db;
  try{
    db=await openDatabase();
    db.run('INSERT OR REPLACE INTO responses(kind,task_id,endpoint,signature,query,saved_at,payload) VALUES (?,?,?,?,?,?,?)',[kind,entry.taskId,entry.endpoint,entry.signature||null,entry.query||null,entry.savedAt,JSON.stringify(entry.payload)]);
    db.run('VACUUM');
    await writeFile(db.export());
    if(typeof BroadcastChannel==='function'){
      const channel=new BroadcastChannel('wert-sqlite-cache-v1');
      channel.postMessage({kind,taskId:entry.taskId,savedAt:entry.savedAt});
      channel.close();
    }
    return true;
  }finally{db?.close();}
}
export async function writeStoredCache(kind,entry){
  const commit=()=>{
    if(navigator.locks?.request)return navigator.locks.request('wert-sqlite-cache-write',{mode:'exclusive'},()=>persistEntry(kind,entry));
    return persistEntry(kind,entry);
  };
  const queued=pendingWrites.then(commit,commit);
  pendingWrites=queued.catch(()=>{});
  return queued;
}
